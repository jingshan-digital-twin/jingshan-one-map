import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import { createHash, X509Certificate } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import type { Feature, FeatureCollection } from 'geojson'
import type { CimAdminService } from '../src/jingshan/cim-types.ts'
import { isRasterService } from '../src/jingshan/cim-types.ts'
import { CimError } from './cim-error.ts'
import { readExternalFeatures } from './cim-external-features.ts'
import { rasterMime, rasterUrl, sampleTile } from './cim-raster.ts'
export { CimError }

import { workbookOrigin, pinnedCimOrigin } from './cim-config.ts'
import { pinnedWmsAgent } from './wms-tls.ts'
const httpAgent = new http.Agent({ keepAlive:true, maxSockets:16, maxFreeSockets:4 })
const httpsAgent = new https.Agent({ keepAlive:true, maxSockets:16, maxFreeSockets:4 })
const fixedPin = () => (process.env.CIM_TLS_SHA256 || '').replaceAll(':', '').trim().toLowerCase()
let trustedCertificate: { pin: string; promise: Promise<string> } | undefined

function trustedLeaf(target: URL, pin: string) {
  if (!/^[0-9a-f]{64}$/.test(pin)) throw new CimError('本机配置的 CIM 证书指纹格式有误。')
  if (trustedCertificate?.pin === pin) return trustedCertificate.promise
  // Inspect only the TLS certificate before any application request. Subsequent
  // HTTPS connections use this exact leaf as their CA and verify its fingerprint again.
  const promise = new Promise<string>((resolve, reject) => {
    const socket = tls.connect({ host: target.hostname, port: Number(target.port || 443), rejectUnauthorized: false })
    socket.setTimeout(8000, () => socket.destroy(new Error('CIM TLS timeout')))
    socket.once('error', reject)
    socket.once('secureConnect', () => {
      try {
        const cert = new X509Certificate(socket.getPeerCertificate().raw)
        if (createHash('sha256').update(cert.raw).digest('hex') !== pin) throw new CimError('CIM 服务证书指纹与本机信任配置不符。', 502, 'auth')
        resolve(cert.toString())
      } catch (error) { reject(error) }
      finally { socket.destroy() }
    })
  }).catch(error => { if (trustedCertificate?.pin === pin) trustedCertificate = undefined; throw error })
  trustedCertificate = { pin, promise }
  return promise
}

async function readUpstream(url: URL, limit: number, headers?: Readonly<Record<string,string>>) {
  const pinned = url.protocol === 'https:' && url.origin === workbookOrigin && url.origin === pinnedCimOrigin && fixedPin()
  const agent = url.protocol === 'https:' ? ((!headers && pinnedWmsAgent(url)) || httpsAgent) : httpAgent
  const options: https.RequestOptions = { agent, headers: { ...headers, 'Accept-Encoding':'identity' }, signal: AbortSignal.timeout(20000) }
  try {
    if (pinned) {
      options.ca = await trustedLeaf(url, pinned)
      options.rejectUnauthorized = true
      options.checkServerIdentity = (_host, cert) => createHash('sha256').update(cert.raw).digest('hex') === pinned ? undefined : new Error('CIM certificate fingerprint mismatch')
    }
    const get = url.protocol === 'https:' ? https.get : http.get
    return await new Promise<{data:Buffer; type:string}>((resolve, reject) => {
      const req = get(url, options, res => {
        const code = res.statusCode || 500
        if (code < 200 || code >= 300) {
          res.destroy()
          reject(new CimError('上游服务返回 HTTP ' + code + '。', 502, code === 401 || code === 403 ? 'auth' : code >= 500 ? 'offline' : 'invalid'))
          return
        }
        const parts: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > limit) { const error = new CimError('单次服务响应超过大小限制。'); reject(error); res.destroy(error); return }
          parts.push(chunk)
        })
        res.on('error', reject)
        res.on('end', () => {
          try {
            let data: Buffer = Buffer.concat(parts)
            if (res.headers['content-encoding'] === 'gzip') data = gunzipSync(data, { maxOutputLength: limit })
            resolve({data, type: res.headers['content-type'] || ''})
          } catch(error) { reject(error) }
        })
      })
      req.on('error', reject)
    })
  } catch (error) {
    if (error instanceof CimError) throw error
    const code = String((error as NodeJS.ErrnoException).code || '')
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) throw new CimError('服务证书未通过校验，请核对 CIM 证书信任配置。', 502, 'auth')
    throw error
  }
}

export async function upstream(url: URL, limit = 24 * 1024 * 1024, headers?: Readonly<Record<string,string>>) {
  for (let attempt = 0; ; attempt++) {
    try { return await readUpstream(url, limit, headers) }
    catch (error) {
      if (error instanceof CimError) throw error
      const code = (error as NodeJS.ErrnoException).code || ''
      if (attempt === 0 && ['ECONNRESET','ETIMEDOUT','EPIPE','ABORT_ERR','ERR_STREAM_PREMATURE_CLOSE'].includes(code)) continue
      throw new CimError('无法连接至图层服务或请求超时。', 502, 'offline')
    }
  }
}

function ogcUrl(service: CimAdminService, values: Record<string, string>) {
  const u = new URL(service.url)
  const controlled = ['service','request','version','typename','typenames','layers','count','maxfeatures','startindex','resulttype','srsname','outputformat','width','height','bbox','crs','srs','styles','transparent','format']
  for (const key of [...u.searchParams.keys()]) if (controlled.includes(key.toLowerCase())) u.searchParams.delete(key)
  for (const [key,val] of Object.entries(values)) u.searchParams.set(key,val)
  return u
}

export function wmsUrl(s: CimAdminService, params: Record<string,string>) {
  return ogcUrl(s, { ...params, service:'WMS', request:'GetMap', layers:s.layer, version:s.version, styles: '', format: 'image/png', transparent:'true' })
}

export function checkPng(data: Buffer) {
  if (data.length < 24 || data.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw new CimError('WMS 未返回 PNG 图像，请检查图层名和空间参考。')
}

async function wfsPage(s: CimAdminService, start: number, size: number, propertyNames?: string[]) {
  const isV2 = s.version.startsWith('2.')
  const target = ogcUrl(s, { service:'WFS', request:'GetFeature', version:s.version, [isV2 ? 'typeNames' : 'typeName']:s.layer, [isV2 ? 'count' : 'maxFeatures']:String(size), startIndex:String(start), outputFormat:'application/json', srsName:'EPSG:4326' })
  if (propertyNames?.length) target.searchParams.set('propertyName', propertyNames.join(','))
  const {data} = await upstream(target)
  const page = parseJson(data)
  if (page?.type !== 'FeatureCollection' || !Array.isArray(page.features) || page.features.some((f: Feature) => !f || f.type !== 'Feature')) throw new CimError('WFS 返回内容不是 GeoJSON 要素集合。')
  const crs = page.crs?.properties?.name
  if (crs && !/(?:4326|CRS:?84)$/i.test(crs)) throw new CimError('WFS 未按请求返回 WGS84 坐标，已停止加载。')
  return page as FeatureCollection & { numberMatched?: string|number; totalFeatures?: string|number }
}

function featureCount(page: { numberMatched?: string|number; totalFeatures?: string|number }) {
  for (const total of [page.numberMatched, page.totalFeatures]) {
    if (total !== undefined && /^\d+$/.test(String(total)) && Number.isSafeInteger(Number(total))) return Number(total)
  }
  return null
}

const recordFields = new Map<string, { revision:number; expires:number; fields:string[] }>()

async function scalarFields(s: CimAdminService) {
  const cached = recordFields.get(s.id)
  if (cached && cached.revision === s.revision && cached.expires > Date.now()) return cached.fields
  const params = {service:'WFS',request:'DescribeFeatureType',version:s.version,[s.version.startsWith('2.')?'typeNames':'typeName']:s.layer}
  const u = ogcUrl(s, params)
  let fields: string[] = []
  try {
    const {data} = await upstream(u, 2 * 1024 * 1024)
    const xml = data.toString('utf8')
    // Read only elements inside a sequence. The service's schema imports are never followed.
    const sequence = xml.match(/<(?:[\w.-]+:)?sequence\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?sequence>/i)?.[1] || ''
    for (const [element] of sequence.matchAll(/<(?:[\w.-]+:)?element\b[^>]*>/gi)) {
      const name = /\bname\s*=\s*["']([^"']+)["']/i.exec(element)?.[1]
      const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(element)?.[1]
      if (name && type && !/^(?:gml|gml32):/i.test(type) && /^[\p{L}\p{N}_.-]{1,150}$/u.test(name)) fields.push(name)
    }
    // On a server without a usable DescribeFeatureType, the small page below is still available.
    if (fields.length > 256) fields = []
  } catch (error) {
    if (!(error instanceof CimError) || error.state !== 'invalid') throw error
  }
  if (recordFields.size > 256) recordFields.clear()
  recordFields.set(s.id,{revision:s.revision,expires:Date.now()+300_000,fields})
  return fields
}

export async function sourceRecords(s: CimAdminService, page:number) {
  const pageSize=10, start=(page-1)*pageSize
  if (s.kind==='geojson' || s.kind==='arcgis') {
    const result=await readExternalFeatures(s,upstream,{start,size:pageSize})
    return {features:result.features.map((f,i)=>({id:String(f.id ?? start+i+1),properties:f.properties ?? {}})),
      total:result.total,page,pageSize,hasNext:start+result.features.length<result.total}
  }
  const wfs:CimAdminService = s.kind === 'wfs' ? s : {...s,kind:'wfs',version:'1.1.0'}
  const fields=await scalarFields(wfs)
  const data=await wfsPage(wfs,start,pageSize,fields)
  const total=featureCount(data)
  const features=data.features.slice(0,pageSize).map((f,i)=>({id:String(f.id ?? f.properties?.objid ?? start+i+1),properties:f.properties ?? {}}))
  return {features,total,page,pageSize,hasNext:total === null ? features.length === pageSize : start+features.length < total}
}

export async function fetchCimFeatures(s: CimAdminService, pageSize = 1000): Promise<FeatureCollection> {
  if (s.kind==='geojson' || s.kind==='arcgis') return {type:'FeatureCollection',features:(await readExternalFeatures(s,upstream)).features}
  if (s.kind !== 'wfs') throw new CimError('该图层不支持要素查询。', 400)
  const features: Feature[] = []
  const seen = new Set<string>()
  let target: number | null = null
  for (let request = 0; request < 120; request++) {
    const page = await wfsPage(s, features.length, pageSize)
    const matched = featureCount(page)
    if (target !== null && matched !== null && target !== matched) throw new CimError('读取期间图层总数有变化，请重新同步。')
    if (matched !== null) target = matched
    if (target !== null && target > 100000) throw new CimError('图层超过单次十万条的导入上限。')
    if (!page.features.length) {
      if (target !== null && features.length !== target) throw new CimError('WFS 分页未读到声明的全部要素。')
      return {type:'FeatureCollection', features}
    }
    for (const f of page.features) {
      const id = f.id === undefined ? createHash('sha256').update(JSON.stringify(f)).digest('hex') : String(f.id)
      if (seen.has(id)) throw new CimError('WFS 分页出现重复要素，请检查服务的分页设置。')
      seen.add(id)
      features.push(f)
    }
    if (target !== null && features.length === target) return {type:'FeatureCollection',features}
    if (features.length > 100000 || (target !== null && features.length > target)) throw new CimError('WFS 总数与分页结果不一致或超过导入上限。')
  }
  throw new CimError('WFS 分页未正常结束，已停止读取。')
}

function parseJson(data: Buffer) {
  try { return JSON.parse(data.toString('utf8').replace(/^\uFEFF/,'')) }
  catch { throw new CimError('服务未返回可识别的 JSON 数据。') }
}

export async function inspectService(s: CimAdminService): Promise<string> {
  if (s.kind==='geojson' || s.kind==='arcgis') {
    const page=await readExternalFeatures(s,upstream,{start:0,size:1})
    return '服务包含 '+page.total+' 条要素'
  }
  if (isRasterService(s.kind)) {
    const { z,x,y } = sampleTile(s)
    const { data } = await upstream(rasterUrl(s,z,x,y), 8 * 1024 * 1024)
    return '已取得京山样点的 ' + rasterMime(data) + ' 图块（' + z + ' 级）'
  }
  if (s.kind === 'wms') {
    const v13 = s.version === '1.3.0'
    const {data} = await upstream(wmsUrl(s,{ width:'64',height:'64',[v13?'crs':'srs']:s.wmsCrs ?? 'EPSG:4326',bbox:v13?'30.65,112.65,31.6,113.6':'112.65,30.65,113.6,31.6' }))
    checkPng(data)
    return '已取得该图层的地图图块'
  }
  if (s.kind === 'wfs') {
    const page = await wfsPage(s,0,1)
    const count = featureCount(page)
    return count === null ? '已取得 GeoJSON 要素集合' : '服务报告 ' + count + ' 条要素'
  }
  const {data} = await upstream(new URL(s.url))
  const root = parseJson(data)
  if (!root?.asset?.version || !root.root?.boundingVolume) throw new CimError('无法识别为 3D Tiles 瓦片集。')
  return '已取得 3D Tiles ' + root.asset.version + ' 瓦片集'
}
