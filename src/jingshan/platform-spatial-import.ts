import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { ZipItem } from 'but-unzip'
import { resolveDbfEncoding, type DbfEncoding } from './dbf-encoding.ts'
import { readCsv } from './platform-form-table.ts'
import { localFileLimit } from './platform-local-data.ts'
import { isCourtLedgerId } from './court-ledger.ts'
export type { DbfEncoding } from './dbf-encoding.ts'

export function spatialCsv(text: string) {
  const [header = [], ...body] = readCsv(text)
  const fields = header.map(name => name.trim()), lower=fields.map(key=>key.toLowerCase())
  if (fields.some(key => !key) || new Set(lower).size !== fields.length) throw new Error('CSV 列名缺失或重复')
  const lon=lower.findIndex(k=>['经度','longitude','lon','lng'].includes(k))
  const lat=lower.findIndex(k=>['纬度','latitude','lat'].includes(k))
  if (lon<0 || lat<0) throw new Error('CSV 需要经度、纬度两列（或 longitude、latitude）')
  const features=body.flatMap((values,i)=>{
    if (!values.some(v=>v.trim())) return []
    if (values.length!==fields.length) throw new Error('CSV 第 '+(i+2)+' 行的列数与表头不符')
    const x=Number(values[lon]),y=Number(values[lat])
    if (![x,y].every(Number.isFinite) || !values[lon].trim() || !values[lat].trim() || Math.abs(x)>180 || Math.abs(y)>90) {
      throw new Error('CSV 第 '+(i+2)+' 行的 WGS84 经纬度无效')
    }
    const properties=Object.fromEntries(fields.map((key,col)=>[key,values[col]]).filter(([key])=>key.toLowerCase()!=='id'))
    return [{type:'Feature',id:values[lower.indexOf('id')] || undefined,geometry:{type:'Point',coordinates:[x,y]},properties}]
  })
  return {type:'FeatureCollection',features}
}

// Read only the directory before decompressing a user-supplied archive.
function checkArchive(buffer: ArrayBuffer) {
  const view=new DataView(buffer)
  let end=buffer.byteLength-22
  const first=Math.max(0,end-65535)
  while (end>=first && view.getUint32(end,true)!==0x06054b50) end--
  if (end<first) throw new Error('无法读取 ZIP 文件目录')
  const count=view.getUint16(end+10,true)
  let offset=view.getUint32(end+16,true), size=0
  const names:string[]=[]
  const utf8=new TextDecoder('utf-8',{fatal:true}), legacyName=new TextDecoder('gb18030')
  if (count>150) throw new Error('ZIP 最多支持 150 个文件')
  for (let i=0;i<count;i++) {
    if (offset+46>end || view.getUint32(offset,true)!==0x02014b50) throw new Error('ZIP 文件目录不完整')
    size+=view.getUint32(offset+24,true)
    if (size>localFileLimit*4) throw new Error('解压后的文件总量超过 72 MiB')
    const length=view.getUint16(offset+28,true)
    const nameBytes=new Uint8Array(buffer,offset+46,length)
    // Older Windows GIS archives use local-codepage member names.
    try { names.push(utf8.decode(nameBytes)) } catch { names.push(legacyName.decode(nameBytes)) }
    offset+=46+length+view.getUint16(offset+30,true)+view.getUint16(offset+32,true)
  }
  return names
}

async function readPlatformArchive(entries:ZipItem[]){
  const get=(name:string)=>entries.find(e=>e.filename===name)
  const manifest=get('fields.json')
  if(!manifest)return
  const decode=(v:Uint8Array)=>new TextDecoder().decode(v)
  let format
  try{format=JSON.parse(decode(await manifest.read())).format}catch{return}
  if(format!=='jingshan-spatial/v1')return
  const propsFile=get('attributes.json')
  if(!propsFile)throw Error('缺少原始属性对照表')
  const originals=JSON.parse(decode(await propsFile.read())) as {id:string;geometryType:Geometry['type'];properties:Record<string,unknown>}[]
  const positions=new Map<string,Geometry>()
  const {default:readShape}=await import('shpjs')
  for(const shape of entries.filter(e=>/\.shp$/i.test(e.filename))){
    const stem=shape.filename.slice(0,-4), attribute=get(stem+'.dbf'), projection=get(stem+'.prj')
    if(!attribute)throw Error('缺少 '+stem+' 的 DBF 属性表')
    const fc=await readShape({shp:await shape.read(),dbf:await attribute.read(),prj:await projection?.read(),cpg:'UTF-8'}) as FeatureCollection
    for(const feature of fc.features)if(feature.geometry)positions.set(String(feature.properties?.SOURCE_ID),feature.geometry)
  }
  const z=get('geometry-z.geojson')
  if(z){
    const original=JSON.parse(decode(await z.read())) as FeatureCollection
    for(const feature of original.features)positions.set(String(feature.id),feature.geometry)
  }
  const features:Feature[]=originals.map(row=>{
    let geometry=positions.get(row.id)
    if(!geometry && row.geometryType==='GeometryCollection')geometry={type:'GeometryCollection',geometries:[]}
    if(!geometry)throw Error('缺少要素 '+row.id+' 的几何')
    if(geometry.type!==row.geometryType && 'coordinates' in geometry){
      if(row.geometryType==='Multi'+geometry.type)geometry={type:row.geometryType,coordinates:[geometry.coordinates]} as Geometry
      else if(geometry.type==='Multi'+row.geometryType && geometry.coordinates.length===1)
        geometry={type:row.geometryType,coordinates:geometry.coordinates[0]} as Geometry
    }
    return {type:'Feature',id:row.id,properties:row.properties,geometry}
  })
  return {type:'FeatureCollection',features}
}

async function readExternalShape(entries:ZipItem[], targetDataset:string, encoding:DbfEncoding) {
  const shapes=entries.filter(e=>/\.shp$/i.test(e.filename))
  if(shapes.length!==1)throw Error('每个外部 ZIP 需包含一个 SHP 图层及其配套文件')
  const {default:readShape}=await import('shpjs')
  const shape=shapes[0]
  const stem = shape.filename.slice(0,-4).toLowerCase()
  const part = (ext:string) => entries.find(e=>e.filename.toLowerCase()===stem+ext)?.read()
  const [shp,dbf,prj,cpg] = await Promise.all([shape.read(),part('.dbf'),part('.prj'),part('.cpg')])
  const ledger=isCourtLedgerId(targetDataset)
  if (!dbf && ledger) throw Error('网球场地台账缺少配套的 DBF 属性表')
  const dbfEncodingUsed=dbf ? resolveDbfEncoding(dbf,cpg,encoding) : undefined
  const collection=await readShape({shp,dbf,prj,cpg:dbfEncodingUsed})
  return {...collection,fileName:shape.filename.slice(0,-4),
    ...(dbfEncodingUsed && {dbfEncodingUsed}), ...((ledger || targetDataset==='court_footprints') && {courtShape:true})}
}

export async function readSpatialFile(file:File, targetDataset='', dbfEncoding:DbfEncoding='auto'):Promise<unknown> {
  if (file.size>localFileLimit) throw new Error('文件超过 18 MiB，请分批导入或简化几何')
  if (/\.csv$/i.test(file.name)) return spatialCsv(await file.text())
  if (/\.gpkg$/i.test(file.name)) {
    const [{default:init},{default:wasm},{readFeaturePackage}] = await Promise.all([
      import('sql.js'),import('sql.js/dist/sql-wasm.wasm?url'),import('./platform-geopackage.ts'),
    ])
    const SQL=await init({locateFile:()=>wasm}), db=new SQL.Database(new Uint8Array(await file.arrayBuffer()))
    try {return readFeaturePackage(db,targetDataset)} finally {db.close()}
  }
  if (/\.zip$/i.test(file.name)) {
    const bytes=await file.arrayBuffer()
    const names=checkArchive(bytes)
    try {
      const {iter}=await import('but-unzip')
      const entries=Array.from(iter(new Uint8Array(bytes)),(entry,i)=>({...entry,filename:names[i]}))
        .filter(e=>!e.filename.includes('__MACOSX'))
      const original=await readPlatformArchive(entries)
      if(original)return original
      return await readExternalShape(entries,targetDataset,dbfEncoding)
    } catch(e) {throw new Error('SHP 无法读取，请检查图层、投影和配套文件。'+(e instanceof Error ? e.message : ''))}
  }
  return JSON.parse((await file.text()).replace(/^\uFEFF/,''))
}
