import { SaxesParser } from 'saxes'
import type { CimRasterConfig } from '../src/jingshan/cim-types.ts'
import { CimError } from './cim-error.ts'

const wmts = 'http://www.opengis.net/wmts/1.0'
const ows = 'http://www.opengis.net/ows/1.1'
const mercatorRadius = Math.PI * 6378137
type Element = { name:string; uri:string; text:string; children:Element[]; isDefault:boolean }

function readContents(xml:Buffer) {
  const parser = new SaxesParser({xmlns:true})
  const stack: (Element | undefined)[] = []
  let root:Element | undefined
  parser.on('doctype', () => { throw new Error('DTD') })
  parser.on('opentag', tag => {
    const parent = stack.at(-1)
    if (!stack.length && (tag.uri !== wmts || tag.local !== 'Capabilities' || tag.attributes.version?.value !== '1.0.0')) {
      throw new CimError('该接口尚未返回 WMTS 1.0.0 服务能力文档。')
    }
    // Only retain the metadata tree. Advertised remote URLs and credentials are never used.
    const keep = !stack.length || (parent && (tag.uri === wmts || tag.uri === ows)
      && (stack.length !== 1 || tag.local === 'Contents' && tag.uri === wmts)
      && tag.local !== 'ResourceURL' && tag.local !== 'Metadata')
    let item:Element | undefined
    if (keep) {
      item = {name:tag.local,uri:tag.uri,text:'',children:[],isDefault:['true','1'].includes(tag.attributes.isDefault?.value)}
      if (parent) parent.children.push(item)
      else root = item
    }
    stack.push(item)
  })
  function collect(value:string) {
    const item=stack.at(-1)
    if (item) item.text += value
  }
  parser.on('text',collect)
  parser.on('cdata',collect)
  parser.on('closetag',()=>{stack.pop()})
  try { parser.write(new TextDecoder('utf-8',{fatal:true}).decode(xml)).close() }
  catch (error) {
    if (error instanceof CimError) throw error
    throw new CimError('无法解析影像服务的 WMTS XML。')
  }
  const contents=root && children(root,'Contents')[0]
  if (!contents) throw new CimError('影像 WMTS 文档缺少 Contents。')
  return contents
}

function children(node:Element,name:string,uri=wmts) {
  return node.children.filter(child=>child.name===name && child.uri===uri)
}
function field(node:Element,name:string,uri=wmts) {
  return children(node,name,uri)[0]?.text.trim() ?? ''
}
const identifier=(node:Element)=>field(node,'Identifier',ows)

function chooseLayer(layers:Element[]) {
  if(layers.length===1)return layers[0]
  const matches=layers.map(node=>({node,name:[identifier(node),...children(node,'Title',ows).map(v=>v.text)].join(' ')}))
    .filter(({name})=>/JMS2026N05MYX|(?:^|[^0-9])(?:0[.．d_]5\s*(?:米|m)|50\s*(?:厘米|cm))/i.test(name))
  const year=matches.filter(({name})=>name.includes('2026'))
  const specific=year.length?year:matches.filter(({name})=>!/(?:19|20)\d{2}/.test(name))
  if(specific.length!==1)throw new CimError('WMTS 图层清单未能唯一确定荆门市 2026 年 0.5 米影像。')
  return specific[0].node
}

function gridType(crs:string) {
  const id=crs.trim().toUpperCase()
  // Accept EPSG identifiers in short, OGC URN and OGC definition URL forms.
  if (/^(?:EPSG:|URN:OGC:DEF:CRS:EPSG:[^:]*:|HTTPS?:\/\/WWW\.OPENGIS\.NET\/DEF\/CRS\/EPSG\/[^/]+\/)(3857|4326|4490)$/.test(id)) {
    if(id.endsWith('4490'))return 'cgcs2000'
    return id.endsWith('3857')?'mercator':'lat-lon'
  }
  if (/^(?:CRS:84|OGC:CRS84|URN:OGC:DEF:CRS:OGC:[^:]*:CRS84|HTTPS?:\/\/WWW\.OPENGIS\.NET\/DEF\/CRS\/OGC\/[^/]+\/CRS84)$/.test(id))return 'lon-lat'
}

function gridConfig(set:Element,link:Element) {
  const type=gridType(field(set,'SupportedCRS',ows))
  if(!type)return
  const geographic=type!=='mercator'
  const origin=geographic?(type==='lon-lat'?[-180,90]:[90,-180]):[-mercatorRadius,mercatorRadius]
  const limits=children(link,'TileMatrixSetLimits')[0]
  const available=limits && new Set(children(limits,'TileMatrixLimits').map(limit=>field(limit,'TileMatrix')))
  const matrices=children(set,'TileMatrix').filter(m=>!available || available.has(identifier(m)))
  const levels=new Set<number>()
  let matrixOffset:number|undefined, matrixPrefix=''
  for(const matrix of matrices){
    if(Number(field(matrix,'TileHeight'))!==256||Number(field(matrix,'TileWidth'))!==256)return
    const corner=field(matrix,'TopLeftCorner').split(/\s+/).map(Number)
    const tolerance=geographic?1e-8:0.1
    if(corner.length!==2||!corner.every((v,i)=>Number.isFinite(v)&&Math.abs(v-origin[i])<=tolerance))return
    const scale=Number(field(matrix,'ScaleDenominator'))
    const width=Number(field(matrix,'MatrixWidth')), height=Number(field(matrix,'MatrixHeight'))
    const baseScale=2*mercatorRadius / (256*(geographic?2:1)*0.00028)
    if(!Number.isFinite(scale)||scale<=0)return
    const level=Math.round(Math.log2(baseScale/scale))
    // The ArcGIS CGCS2000 cache has an extra one-tile world overview. Its
    // remaining matrices use the global origin but end at the imagery extent.
    if(type==='cgcs2000'&&level===-1&&width===1&&height===1)continue
    if(level<0||levels.has(level))return
    if(level>24)continue
    const cols=2**level*(geographic?2:1), rows=2**level
    if(type==='cgcs2000'){
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>cols||height>rows)return
    }else if(width!==cols||height!==rows)return
    const expected=baseScale/2**level
    if(!Number.isFinite(scale)||Math.abs(scale/expected-1)>1e-6)return
    const id=identifier(matrix)
    if(id.length>160)return
    const match=/^(.*?)(\d+)$/.exec(id)
    if(!match)return
    const offset=Number(match[2])-level
    if(!Number.isInteger(offset)||Math.abs(offset)>24||match[1]+(level+offset)!==id)return
    if(matrixOffset!==undefined&&(offset!==matrixOffset||match[1]!==matrixPrefix))return
    matrixOffset=offset
    matrixPrefix=match[1]
    levels.add(level)
  }
  const maxLevel=Math.max(...levels)
  if(matrixOffset===undefined||levels.size!==maxLevel+1)return
  return {projection:geographic?'EPSG:4326' as const:'EPSG:3857' as const,maxLevel,matrixOffset,matrixPrefix}
}

export function parseJingmenWmts(xml:Buffer):{layer:string;raster:CimRasterConfig} {
  const contents=readContents(xml)
  const node=chooseLayer(children(contents,'Layer'))
  const layer=identifier(node), styles=children(node,'Style')
  const style=styles.find(s=>s.isDefault)??(styles.length===1?styles[0]:undefined)
  const supported=children(node,'Format').map(f=>f.text.trim())
  const format=(['image/jpeg','image/png','image/webp','image/jpgpng'] as const).find(f=>supported.includes(f))
  if(!layer||!style||!identifier(style)||!format)throw new CimError('影像 WMTS 图层缺少可用的标识、默认样式或栅格图片格式。')
  const sets=children(contents,'TileMatrixSet')
  for(const link of children(node,'TileMatrixSetLink')){
    const matrixSet=field(link,'TileMatrixSet')
    const set=sets.find(set=>matrixSet && identifier(set)===matrixSet)
    const config=set && gridConfig(set,link)
    if(config)return {layer,raster:{...config,matrixSet,style:identifier(style),format}}
  }
  throw new CimError('影像 WMTS 缺少与当前地图兼容的全球瓦片矩阵，请核对坐标系、原点、比例尺和连续级别。')
}
