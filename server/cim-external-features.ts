import type { Feature } from 'geojson'
import type { CimAdminService } from '../src/jingshan/cim-types.ts'
import { workbookOrigin } from './cim-config.ts'
import { CimError } from './cim-error.ts'

type Read = (url:URL, byteLimit:number)=>Promise<{data:Buffer}>
type FeatureSource = Pick<CimAdminService,'kind'|'url'>
type Window = {start:number; size:number}
const maxBytes=24*1024*1024
const maxFeatures=100_000

export function externalFeatureUrl(source:FeatureSource) {
  const url=new URL(source.url)
  const origins=(process.env.CIM_FEATURE_ORIGINS ?? '').split(',').map(origin=>origin.trim()).filter(Boolean)
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.hash || ![workbookOrigin,...origins].includes(url.origin))
    throw new CimError('该服务来源未获许可。请在服务端 CIM_FEATURE_ORIGINS 配置完整来源（协议、主机和端口）。',400)
  if (source.kind==='arcgis' && (!/\/FeatureServer\/\d+\/?$/i.test(url.pathname)
      || [...url.searchParams.keys()].some(key=>!['token','gdbVersion'].includes(key))))
    throw new CimError('ArcGIS 地址应指向 FeatureServer 的数字图层编号，可附带 token 或 gdbVersion。',400)
  return url
}

function record(value:unknown): value is Record<string,unknown> {
  return value!==null && typeof value==='object' && !Array.isArray(value)
}
function geographic(value:unknown) {
  return value==null || (record(value) && value.type==='name' && record(value.properties) &&
    /^(EPSG:4326|urn:ogc:def:crs:EPSG::4326|urn:ogc:def:crs:OGC:1\.3:CRS84|OGC:CRS84|CRS84)$/i.test(String(value.properties.name)))
}
function position(value:unknown) {
  return Array.isArray(value) && value.length>=2 && value.every(Number.isFinite) && Math.abs(value[0])<=180 && Math.abs(value[1])<=90
}
function line(value:unknown) {return Array.isArray(value) && value.length>=2 && value.every(position)}
function ring(value:unknown) {
  if (!Array.isArray(value) || value.length<4 || !line(value)) return false
  const start=value[0], end=value.at(-1)
  return start.length===end.length && start.every((coord:number,i:number)=>coord===end[i])
}
function polygon(value:unknown) {return Array.isArray(value) && value.length>0 && value.every(ring)}
function geometry(value:unknown, depth=0):boolean {
  if (!record(value) || depth>12 || !geographic(value.crs)) return false
  const coords=value.coordinates
  switch(value.type) {
    case 'Point': return position(coords)
    case 'MultiPoint': return Array.isArray(coords) && coords.every(position)
    case 'LineString': return line(coords)
    case 'MultiLineString': return Array.isArray(coords) && coords.every(line)
    case 'Polygon': return polygon(coords)
    case 'MultiPolygon': return Array.isArray(coords) && coords.every(polygon)
    case 'GeometryCollection': return Array.isArray(value.geometries) && value.geometries.every(item=>geometry(item,depth+1))
    default: return false
  }
}
function collection(value:Record<string,unknown>): Feature[] {
  if (value.type!=='FeatureCollection' || !Array.isArray(value.features)) throw new CimError('服务未返回 GeoJSON FeatureCollection。')
  if (!geographic(value.crs)) throw new CimError('请提供 WGS84 经纬度的 GeoJSON 要素集合。')
  if (value.features.length>maxFeatures) throw new CimError('图层超过十万条要素。')
  for (const [index,item] of value.features.entries()) {
    if (!record(item) || item.type!=='Feature' || !geographic(item.crs) || (item.geometry!==null && !geometry(item.geometry)) ||
        (item.properties!==null && !record(item.properties)) || (item.id!==undefined && typeof item.id!=='string' && !Number.isFinite(item.id)))
      throw new CimError('第 '+(index+1)+' 条要素的经纬度、几何或属性格式无效。')
  }
  return value.features as Feature[]
}

function arcUrl(base:URL, query:boolean, parameters:Record<string,string>) {
  const url=new URL(base)
  if (query) url.pathname=url.pathname.replace(/\/$/,'')+'/query'
  Object.entries(parameters).forEach(([name,value])=>url.searchParams.set(name,value))
  return url
}

export async function readExternalFeatures(source:FeatureSource, read:Read, window?:Window) {
  const base=externalFeatureUrl(source)
  let remaining=maxBytes
  const deadline=Date.now()+60_000
  async function json(url:URL, limit=remaining) {
    if (Date.now()>deadline) throw new CimError('读取要素服务超时，请缩小服务范围或重试。',502,'offline')
    if (remaining<=0) throw new CimError('要素总大小超过 24 MB。')
    const {data}=await read(url,Math.min(limit,remaining))
    remaining-=data.byteLength
    let result:unknown
    try {result=JSON.parse(data.toString('utf8').replace(/^\uFEFF/,''))} catch {throw new CimError('要素服务未返回有效的 JSON。')}
    if (!record(result)) throw new CimError('要素服务返回的 JSON 结构无效。')
    if (record(result.error)) throw new CimError('上游要素服务返回错误 '+(Number(result.error.code)||'')+'。',502,[401,403,498,499].includes(Number(result.error.code))?'auth':'invalid')
    return result
  }
  if (source.kind==='geojson') {
    const items=collection(await json(base))
    return {features:window?items.slice(window.start,window.start+window.size):items,total:items.length}
  }
  const meta=await json(arcUrl(base,false,{f:'json'}),1024*1024)
  if (meta.type!=='Feature Layer' || !String(meta.capabilities).split(',').some(c=>c.trim().toLowerCase()==='query') ||
      (meta.supportedQueryFormats && !String(meta.supportedQueryFormats).split(',').some(c=>c.trim().toLowerCase()==='geojson')))
    throw new CimError('此 ArcGIS 图层须支持空间要素 Query 查询及 GeoJSON 输出。')
  const index=await json(arcUrl(base,true,{f:'json',where:'1=1',returnIdsOnly:'true'}),2*1024*1024)
  const ids=index.objectIds
  const field=index.objectIdFieldName ?? meta.objectIdField
  if (typeof field!=='string' || !field || !Array.isArray(ids) || ids.length>maxFeatures || !ids.every(Number.isSafeInteger) || new Set(ids).size!==ids.length)
    throw new CimError('ArcGIS 未返回有效数字对象编号，或图层超过十万条要素。')
  // Object IDs make every query repeatable even when the upstream ignores paging offsets.
  ids.sort((a:number,b:number)=>a-b)
  const wanted=window?ids.slice(window.start,window.start+window.size):ids
  const size=Math.min(300,Number.isSafeInteger(meta.maxRecordCount) && Number(meta.maxRecordCount)>0 ? Number(meta.maxRecordCount) : 300)
  if (Math.ceil(wanted.length/size)>400) throw new CimError('ArcGIS 图层的单页上限过小，无法在请求限制内完整读取。')
  const features:Feature[]=[]
  for (let start=0;start<wanted.length;start+=size) {
    const batch=wanted.slice(start,start+size)
    const page=await json(arcUrl(base,true,{objectIds:batch.join(','),outFields:'*',returnGeometry:'true',outSR:'4326',f:'geojson'}))
    const rows=collection(page)
    const requested=new Set(batch)
    for (const row of rows) {
      const id=row.properties?.[field] ?? row.id
      if (!Number.isSafeInteger(id) || !requested.delete(id)) throw new CimError('ArcGIS 查询的对象编号与请求不符，请重试。')
      row.id=id
    }
    if (requested.size || page.exceededTransferLimit===true) throw new CimError('ArcGIS 未完整返回请求的对象，请检查图层传输限制或重试。')
    rows.sort((a,b)=>Number(a.id)-Number(b.id))
    features.push(...rows)
  }
  return {features,total:ids.length}
}
