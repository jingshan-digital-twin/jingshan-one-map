import { Router, json } from 'express'
import type { Request, Response, RequestHandler } from 'express'
import type { Pool,PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'
import { availableServiceSql, hostedSource, publishedLayer, publishHostedLayer, sendPublishedFeatures } from './hosted-layers.ts'
import { populationRaster, rasterPage, populationRecordCount } from '../src/jingshan/population-raster.ts'
import type { CimAdminService, CimKind, CimStatus } from '../src/jingshan/cim-types.ts'
import { cimProtocols, isFeatureService, isRasterService } from '../src/jingshan/cim-types.ts'
import { externalFeatureUrl } from './cim-external-features.ts'
import { acceptsMapService, type MapBinding } from '../src/jingshan/map-bindings.ts'
import { rasterConfig, rasterMime, rasterUrl } from './cim-raster.ts'
import { CimError, inspectService, upstream, wmsUrl, checkPng, fetchCimFeatures, sourceRecords } from './cim-upstream.ts'
import { jingmenMapGateway } from './jingmen-map.ts'
import { workbookOrigin } from './cim-config.ts'
import { localTilesetId, localTilesRouter, readLocalTileset } from './local-tiles.ts'
import { isPlanningArchive, planningArchive, planningRecords, planningRoof, planningTile, sendPlanningFeatures } from './planning-layers.ts'
import { defaultRasterConfig } from '../src/jingshan/cim-types.ts'
export { fetchCimFeatures }

type Fields = Pick<CimAdminService,'name'|'category'|'kind'|'url'|'layer'|'version'|'enabled'|'defaultVisible'|'sortOrder'|'description'|'raster'>
type Row = Omit<CimAdminService,'checkedAt'|'mapUrl'> & {checkedAt:Date|null}
const columns = `id, name, category, kind, url, layer, version, enabled, default_visible AS "defaultVisible",
    sort_order AS "sortOrder", description, source_sheet AS "sourceSheet", source_row AS "sourceRow",
    revision, status, status_message AS "statusMessage", checked_at AS "checkedAt", raster`
const originalWms = workbookOrigin ? workbookOrigin + '/agserver/topp/ows' : null
// EX_GeographicBoundingBox from the supplied WMS GetCapabilities for these exact services.
const extents: Record<string,[number,number,number,number]> = {
  'topp:jms_ygyx_1m':[111.8470130963,30.3786487075,113.5165195891,31.6289459907],
  'topp:jss_zydc_csdl':[113.0797805786,30.9527988434,113.3081741333,31.2063236237],
  'topp:jss_skjc_xzq_qxj':[112.7494477305,30.6975988107,113.4891540208,31.4500751947],
  'topp:jss_skjc_xzq_xzj':[112.7494477300,30.6975988110,113.4891540210,31.4500751950],
  'topp:jss_skjc_xzq_sqcj':[112.7457427979,30.6938343048,113.4928588867,31.4538402557],
  'topp:jss_skjc_xzq_sqwg':[112.7457427979,30.6938343048,113.4928588867,31.4538402557],
}
function serviceFrom(row: Row): CimAdminService {
  const wmsUrl = row.kind === 'wms' ? new URL(row.url) : undefined
  const wmsCrs = wmsUrl && [...wmsUrl.searchParams].some(([key, value]) =>
    /^(crs|srs)$/i.test(key) && value.toUpperCase() === 'EPSG:4490') ? 'EPSG:4490' as const : undefined
  const paths: Record<CimKind,string> = { wms:'map', wfs:'features', geojson:'features', arcgis:'features', '3dtiles':'tiles/tileset.json', xyz:'raster/{z}/{x}/{y}', wmts:'raster/{z}/{x}/{y}' }
  const planning=row.kind==='xyz' && isPlanningArchive(row.url)
  const mapUrl = planning ? row.url : row.kind === '3dtiles' && localTilesetId(row.url)
    ? row.url : '/api/jingshan/cim/services/'+row.id+'/'+paths[row.kind]
  let bounds = wmsUrl && wmsUrl.origin + wmsUrl.pathname === originalWms ? extents[row.layer] : undefined
  let reliefUrl:string|undefined
  if(planning) {
    try { const {info}=planningArchive(row.url);bounds=info.bounds
      if(info.roofs)reliefUrl=mapUrl.replace('/raster/{z}/{x}/{y}','/relief')
    } catch (e) { if(!(e instanceof CimError))throw e }
  }
  const supportsRecords = planning || isFeatureService(row.kind) || (Boolean(bounds) && row.layer !== 'topp:jms_ygyx_1m')
  return {...row, hostedDatasetId:hostedSource(row.id,row.url), checkedAt:row.checkedAt?.toISOString() || null, mapUrl, wmsCrs, bounds, supportsRecords,reliefUrl}
}
export async function getCimService(pool: Pool|PoolClient,id:string) {
  const result = await pool.query<Row>('SELECT '+columns+' FROM jingshan_cim_services s WHERE id=$1 AND NOT deleted AND '+availableServiceSql,[id])
  return result.rows[0] ? serviceFrom(result.rows[0]) : null
}

async function changeReferencedService<T>(pool:Pool,id:string,next:Fields | null,change:(db:PoolClient)=>Promise<T>) {
  const db=await pool.connect()
  try {
    await db.query('BEGIN')
    // Publication also locks the workspace before the service rows.
    const current=await db.query<{bindings:MapBinding[]|null; draftBindings:MapBinding[]|null; inFolder:boolean}>(`
      SELECT published->'mapBindings' AS bindings,draft->'mapBindings' AS "draftBindings",
        EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(published#>'{portalCatalog,folders}','[]'::jsonb)
          || coalesce(draft#>'{portalCatalog,folders}','[]'::jsonb)) f WHERE (f->'resources') ? $1) AS "inFolder"
      FROM jingshan_workspace WHERE id FOR SHARE`,['service:'+id])
    const bindings=(current.rows[0]?.bindings ?? []).filter(binding=>binding.serviceId===id)
    if (bindings.some(binding=>!next || !acceptsMapService(binding.slot,{id,...next})))
      throw new CimError('正在使用此服务的已发布图层需要先更换来源，再停用、移除或更改协议。',409)
    if (!next && (current.rows[0]?.inFolder || current.rows[0]?.draftBindings?.some(b=>b.serviceId===id)))
      throw new CimError('该服务仍有目录或草稿引用，请刷新服务目录后重新确认下线。',409)
    const updated=await change(db)
    await db.query('COMMIT')
    return updated
  } catch(error) {
    await db.query('ROLLBACK')
    throw error
  } finally {db.release()}
}

function textField(value: unknown, max: number, allowBlank = false) {
  if (typeof value !== 'string' || value.trim().length > max || (!allowBlank && !value.trim()) || value.includes('\0')) throw new CimError('请核对文本字段的长度和内容。',400)
  return value.trim()
}
function fields(input: Record<string,unknown>, hosted?:CimAdminService|null): Fields {
  const name=textField(input.name,120), category=textField(input.category,80), kind=input.kind as CimKind
  if (!Object.hasOwn(cimProtocols,kind)) throw new CimError('不支持的服务类型。',400)
  const url=textField(input.url,4000), description=textField(input.description || '',800,true)
  if (hosted?.hostedDatasetId && (kind!=='geojson' || url!==hosted.url)) throw new CimError('托管服务的协议和来源由已发布图层确定。',400)
  const planning=kind==='xyz' && isPlanningArchive(url) && hosted?.url===url
  if (!planning && !hosted?.hostedDatasetId && !(kind === '3dtiles' && localTilesetId(url))) {
    let parsed: URL
    try { parsed=new URL(url) } catch {
      throw new CimError(kind === '3dtiles' ? '请填写完整的 HTTP(S) 服务地址或本机模型的瓦片集路径。' : '请填写完整的 HTTP 或 HTTPS 服务地址。',400)
    }
    if (!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash || /^(localhost\.?|127\.|0\.|169\.254\.|\[::|\[fe80:)/i.test(parsed.hostname)) throw new CimError('服务地址协议、主机或凭据格式无效。',400)
    if (kind==='3dtiles' && !/\.json$/i.test(parsed.pathname)) throw new CimError('3D Tiles 地址应指向瓦片集 JSON。',400)
    if (kind==='geojson' || kind==='arcgis') externalFeatureUrl({kind,url})
  }
  const ogc = ['wms','wfs','wmts'].includes(kind)
  const version = ogc ? textField(input.version,12) : '', layer = ogc ? textField(input.layer,200) : ''
  if (ogc && !/^[\p{L}\p{N}_.:-]+$/u.test(layer)) throw new CimError('请填写单个 OGC 图层标识。',400)
  if ((kind==='wms' && !['1.1.1','1.3.0'].includes(version)) || (kind==='wfs' && !['1.0.0','1.1.0','2.0.0'].includes(version)) || (kind==='wmts' && version!=='1.0.0')) throw new CimError('服务版本与 OGC 类型不匹配。',400)
  if (typeof input.enabled!=='boolean' || typeof input.defaultVisible!=='boolean' || !Number.isSafeInteger(input.sortOrder) || Math.abs(input.sortOrder as number)>1000000) throw new CimError('启用状态、默认可见或排序值无效。',400)
  const raster = planning ? {...defaultRasterConfig,maxLevel:planningArchive(url).info.maxZoom} : rasterConfig(kind,input.raster,url)
  return { name,category,kind,url,description,version,layer,raster,enabled:input.enabled,defaultVisible:input.defaultVisible,sortOrder:input.sortOrder as number }
}

function revision(input: unknown) {
  const n=Number(input)
  if (!Number.isSafeInteger(n) || n<=0) throw new CimError('缺少有效的图层配置版本。',400)
  return n
}

const checked = (fn: (req:Request,res:Response)=>Promise<void>):RequestHandler => async (req,res,next) => {
  try {await fn(req,res)} catch (error) {
    if (error instanceof CimError) { res.status(error.status).json({error:error.message}); return }
    next(error)
  }
}

function wmsParameters(req:Request) {
  const query=Object.fromEntries(Object.entries(req.query).map(([k,v])=>[k.toLowerCase(),typeof v==='string'?v:'']))
  const bbox=query.bbox?.split(',')
  if (!bbox || bbox.length!==4 || bbox.some(v=>!v.trim() || !Number.isFinite(Number(v))) || Number(bbox[0])>=Number(bbox[2]) || Number(bbox[1])>=Number(bbox[3])) throw new CimError('WMS 范围无效。',400)
  if (![query.width,query.height].every(v=>/^\d+$/.test(v) && Number(v)>0 && Number(v)<=2048)) throw new CimError('WMS 图块尺寸无效。',400)
  const crs=(query.crs || query.srs || 'EPSG:4326').toUpperCase()
  if (!/^(EPSG:\d{3,6}|CRS:84)$/.test(crs)) throw new CimError('WMS 坐标系无效。',400)
  return {bbox:bbox.join(','),width:query.width,height:query.height,crs}
}

function assetPath(raw:unknown) {
  const parts=Array.isArray(raw)?raw:typeof raw==='string'?raw.split('/'):[]
  if (!parts.length || parts.some(part=>typeof part!=='string' || !part || /[\\/?#:%\x00-\x1f]/.test(part) || part==='.' || part==='..')) throw new CimError('瓦片相对路径无效。',400)
  return parts.map(part=>encodeURIComponent(part)).join('/')
}

export function cimRouter(pool: Pool) {
  const router=Router()
  router.use(json({limit:'96kb'}))
  router.use('/local-tiles',localTilesRouter())
  const gateway=jingmenMapGateway()
  if(gateway){
    void gateway.check()
    router.post('/admin/jingmen-map/check',checked(async (_req,res)=>{
      await gateway.check()
      res.set('Cache-Control','no-store').json(gateway.status())
    }))
    router.get('/jingmen-map/raster/:z/:x/:y',checked(async (req,res)=>{
      const {z,x,y}=req.params
      if(![z,x,y].every(v=>typeof v==='string'&&/^\d{1,9}$/.test(v)))throw new CimError('瓦片行列号格式无效。',400)
      const {data,type}=await gateway.tile(Number(z),Number(x),Number(y))
      res.set('X-Content-Type-Options','nosniff').type(type).send(data)
    }))
  }
  const list = (admin:boolean) => checked(async (_req,res)=>{
    const entries=await pool.query<Row>('SELECT '+columns+' FROM jingshan_cim_services s WHERE NOT deleted AND '+availableServiceSql+(admin?'':' AND enabled')+' ORDER BY sort_order, id')
    const services=entries.rows.map(row=>{
      const full=serviceFrom(row)
      if(admin)return full
      const {url:_url,sourceSheet:_sheet,...item}=full
      return item
    })
    const imagery=admin?null:gateway?.layer()
    if(imagery)services.push(imagery)
    res.json({...(admin&&gateway?{gateway:gateway.status()}:{}),services})
  })
  router.get('/services',list(false))
  router.get('/admin/services',list(true))
  router.post('/admin/hosted/:id',checked(async (req,res)=>{
    const id=await publishHostedLayer(pool,String(req.params.id))
    res.json(await getCimService(pool,id))
  }))
  router.post('/admin/services',checked(async (req,res)=>{
    const s=fields(req.body || {})
    const id=randomUUID()
    const entry=await pool.query<Row>('INSERT INTO jingshan_cim_services (id,name,category,kind,url,layer,version,enabled,default_visible,sort_order,description,raster) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING '+columns,[id,s.name,s.category,s.kind,s.url,s.layer,s.version,s.enabled,s.defaultVisible,s.sortOrder,s.description,s.raster])
    res.status(201).json(serviceFrom(entry.rows[0]))
  }))
  router.put('/admin/services/:id',checked(async (req,res)=>{
    const s=fields(req.body || {},await getCimService(pool,String(req.params.id)))
    const changed='(kind,url,layer,version,raster) IS DISTINCT FROM ($4,$5,$6,$7,$13::jsonb)'
    const id=String(req.params.id)
    const result=await changeReferencedService(pool,id,s,db=>db.query<Row>('UPDATE jingshan_cim_services SET name=$2,category=$3,kind=$4,url=$5,layer=$6,version=$7,enabled=$8,default_visible=$9,sort_order=$10,description=$11,raster=$13,revision=revision+1,status=CASE WHEN '+changed+" THEN 'unchecked' ELSE status END, status_message=CASE WHEN "+changed+" THEN '' ELSE status_message END,checked_at=CASE WHEN "+changed+' THEN null ELSE checked_at END WHERE id=$1 AND NOT deleted AND revision=$12 RETURNING '+columns,[id,s.name,s.category,s.kind,s.url,s.layer,s.version,s.enabled,s.defaultVisible,s.sortOrder,s.description,revision(req.body.revision),s.raster]))
    if (!result.rows[0]) throw new CimError('图层已移除或被其他人更新，请刷新重试。',409)
    res.json(serviceFrom(result.rows[0]))
  }))
  router.delete('/admin/services/:id',checked(async (req,res)=>{
    const id=String(req.params.id)
    const result=await changeReferencedService(pool,id,null,db=>db.query('UPDATE jingshan_cim_services SET deleted=true, revision=revision+1 WHERE id=$1 AND NOT deleted AND revision=$2',[id,revision(req.query.revision)]))
    if (!result.rowCount) throw new CimError('图层已移除或被其他人更新，请刷新重试。',409)
    res.sendStatus(204)
  }))
  async function service(id:unknown, kind?:CimKind) {
    const s=await getCimService(pool,String(id))
    if (!s || (kind && (!s.enabled || s.kind!==kind))) throw new CimError('找不到已配置的图层。',404)
    return s
  }
  router.get('/admin/services/:id/records',checked(async (req,res)=>{
    const s=await service(req.params.id)
    if (!s.supportsRecords) throw new CimError('该服务未提供可查询的属性记录。',400)
    const page=Number(req.query.page ?? 1)
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) throw new CimError('请求的页码无效。',400)
    if(isPlanningArchive(s.url)){res.json(planningRecords(planningArchive(s.url),page));return}
    if (s.hostedDatasetId) {
      const {dataset,collection,version}=await publishedLayer(pool,s.hostedDatasetId)
      const pageSize=10, start=(page-1)*pageSize, grid=populationRaster(dataset), total=grid?.count ?? collection.features.length
      const items=grid ? rasterPage(grid,page,pageSize).rows : collection.features.slice(start,start+pageSize)
      const features=items.map(({id,properties})=>({id,properties}))
      res.set('X-Publication-Version',String(version)).json({features,total,page,pageSize,hasNext:start+features.length<total})
    } else res.json(await sourceRecords(s,page))
  }))
  router.post('/admin/services/:id/check',checked(async (req,res)=>{
    const s=await service(req.params.id)
    let status:CimStatus='online', message:string
    try {
      const localId=s.kind==='3dtiles' && localTilesetId(s.url)
      if(isPlanningArchive(s.url)){
        const archive=planningArchive(s.url)
        if(!archive.db.prepare('select 1 from tiles limit 1').get())throw new CimError('尚未生成规划图层瓦片')
        message='已发布 '+archive.info.count+' 个控制面 · 支持属性查询'
      } else if(s.hostedDatasetId){
        const {dataset,version}=await publishedLayer(pool,s.hostedDatasetId)
        message='已发布 V'+version+' · '+populationRecordCount(dataset)+' 个要素'
      } else message=localId ? '已读取本机 3D Tiles '+(await readLocalTileset(localId)).asset.version+' 瓦片集' : await inspectService(s)
    } catch(error) {
      if (!(error instanceof CimError)) throw error
      status=error.state; message=error.message
    }
    const result=await pool.query<Row>('UPDATE jingshan_cim_services SET status=$2,status_message=$3,checked_at=now() WHERE id=$1 AND NOT deleted AND revision=$4 RETURNING '+columns,[s.id,status,message,s.revision])
    if (!result.rows[0]) throw new CimError('检测期间配置已变更，请重试。',409)
    res.json(serviceFrom(result.rows[0]))
  }))
  router.get('/services/:id/map',checked(async (req,res)=>{
    const s=await service(req.params.id,'wms'),{crs,...tile}=wmsParameters(req)
    const {data}=await upstream(wmsUrl(s,{...tile,[s.version==='1.3.0'?'crs':'srs']:crs}),16*1024*1024)
    checkPng(data)
    res.type('image/png').send(data)
  }))
  router.get('/services/:id/features',checked(async (req,res)=>{
    const s=await service(req.params.id)
    if(s.enabled && isPlanningArchive(s.url)){await sendPlanningFeatures(planningArchive(s.url),res);return}
    if (!s.enabled || !isFeatureService(s.kind)) throw new CimError('找不到已启用的要素服务。',404)
    if(s.hostedDatasetId){
      const layer=await publishedLayer(pool,s.hostedDatasetId)
      res.set('Cache-Control','no-cache')
      await sendPublishedFeatures(res,layer)
    } else res.json(await fetchCimFeatures(s))
  }))
  router.get('/services/:id/relief',checked(async(req,res)=>{
    const s=await service(req.params.id,'xyz')
    if(!isPlanningArchive(s.url))throw new CimError('找不到规划立体贴图',404)
    if(req.query.edition && !s.url.endsWith('='+req.query.edition))throw new CimError('规划服务版本已更新',409)
    const district=typeof req.query.district==='string'?req.query.district:'京山市'
    if(district.length>100)throw new CimError('区划名称过长',400)
    const roof=planningRoof(planningArchive(s.url),district)
    res.set('Cache-Control',req.query.edition?'private, max-age=86400':'no-cache').set('X-Geo-Bounds',roof.bounds).type('image/png').send(roof.data)
  }))
  router.get('/services/:id/raster/:z/:x/:y',checked(async (req,res)=>{
    const s = await service(req.params.id)
    if (!s.enabled || !isRasterService(s.kind)) throw new CimError('找不到已启用的瓦片服务。',404)
    const {z,x,y} = req.params
    if (![z,x,y].every(v => typeof v === 'string' && /^\d{1,9}$/.test(v))) throw new CimError('瓦片行列号格式无效。',400)
    if(isPlanningArchive(s.url)){
      if(req.query.edition && !s.url.endsWith('='+req.query.edition))throw new CimError('请刷新已发布的规划服务版本',409)
      res.set('Cache-Control',req.query.edition?'private, max-age=86400':'no-cache').type('image/png').send(planningTile(planningArchive(s.url),Number(z),Number(x),Number(y)))
      return
    }
    const { data } = await upstream(rasterUrl(s,Number(z),Number(x),Number(y)),8 * 1024 * 1024)
    res.type(rasterMime(data)).send(data)
  }))
  router.get('/services/:id/tiles/*path',checked(async (req,res)=>{
    const s=await service(req.params.id,'3dtiles'), path=assetPath(req.params.path)
    if (localTilesetId(s.url)) {
      res.redirect(307,s.url.slice(0,s.url.lastIndexOf('/')+1)+path)
      return
    }
    const original=new URL(s.url)
    const url=path==='tileset.json' ? original : new URL(path,original)
    url.search=original.search
    const {data}=await upstream(url,64*1024*1024)
    if (/\.json$/i.test(url.pathname)) {
      try { const tileset=JSON.parse(data.toString('utf8'));res.json(tileset) }
      catch { throw new CimError('瓦片集服务未返回 JSON。') }
      return
    }
    res.type('application/octet-stream').send(data)
  }))
  return router
}
