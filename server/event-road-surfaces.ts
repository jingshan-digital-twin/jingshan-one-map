import type { Pool, PoolClient } from 'pg'
import type { Feature, Position } from 'geojson'
import type { RequestHandler } from 'express'
import { inPolygon } from '../src/jingshan/analytics.ts'
import { resolveMapBindings, type MapBinding } from '../src/jingshan/map-bindings.ts'
import type { CityFeature, Coordinate } from '../src/jingshan/types.ts'
import { getCimService, fetchCimFeatures } from './cim.ts'
import { CimError } from './cim-error.ts'
import { hostedSource, publishedLayer } from './hosted-layers.ts'

type Db=Pool|PoolClient
const cache = new Map<string,{expires:number;rows:Promise<CityFeature[]>}>()

function normalize(row:Feature, serviceId:string, serviceName:string):CityFeature[] {
  const p=row.properties??{}, geo=row.geometry
  if (p.sample===true || !geo || (geo.type!=='MultiPolygon' && geo.type!=='Polygon')) return []
  const name=String(p.dlmc??p['道路名称']??p.name??'').trim()
  const sourceId=String(row.id??p.wyid??p.bh??'').trim()
  if (!name || !sourceId) return []
  return [{type:'Feature',id:serviceId+':'+sourceId,geometry:geo,properties:{
    name,region:String(p.xzjxzqhmc||p.qxxzqhmc||p.region||'京山市'),kind:'road-surface',
    sourceServiceId:serviceId,sourceFeatureId:sourceId,source:serviceName,roadCode:p.wyid??p.bh??p.roadCode,
    roadClass:p.dldj??p.roadClass,sectionName:p.qz??p.sectionName,sourceUpdatedAt:p.gxsj??p.sourceUpdatedAt,
  }}]
}

// Test the measured road footprint, including segments crossing the search circle and holes.
function nearRoad(parts:Position[][][],center:Coordinate,radius:number) {
  const scaleX=111195*Math.cos(center[1]*Math.PI/180)
  const limit=radius*radius
  for (const rings of parts) {
    if (inPolygon(center,rings)) return true
    for (const ring of rings) {
      for (let i=1;i<ring.length;i++) {
        const a=ring[i-1],b=ring[i]
        const x=(a[0]-center[0])*scaleX,y=(a[1]-center[1])*111195
        const dx=(b[0]-a[0])*scaleX,dy=(b[1]-a[1])*111195
        const length=dx*dx+dy*dy
        const t=length?Math.max(0,Math.min(1,-(x*dx+y*dy)/length)):0
        if ((x+t*dx)**2+(y+t*dy)**2 <= limit) return true
      }
    }
  }
  return false
}

export async function eventRoadSurfaces(db:Db,center:Coordinate,radiusM:number,scope:'events'|'liveEvent'='events'):Promise<CityFeature[]> {
  const result=await db.query<{bindings:MapBinding[]|null}>("SELECT published->'mapBindings' AS bindings FROM jingshan_workspace WHERE id")
  const bindings=resolveMapBindings(result.rows[0]?.bindings??[],scope)
  const id=bindings.has('roadNetwork')?bindings.get('roadNetwork'):'cim-04'
  if(!id) return []
  const service=await getCimService(db,id)
  if (!service?.enabled) throw new CimError('京山道路面服务未启用，请检查后台地图绑定。',503)
  const hosted=hostedSource(id,service.url)
  let rows:CityFeature[]
  if(hosted) {
    rows=(await publishedLayer(db,hosted)).dataset.features.flatMap(f=>normalize(f,id,service.name))
  } else {
    if(!['wms','wfs','geojson','arcgis'].includes(service.kind)) throw new CimError('已绑定的道路服务不支持读取道路面。',422)
    const key=JSON.stringify([id,service.revision,service.url,service.layer])
    const now=Date.now()
    for(const [k,entry] of cache) if(entry.expires<=now)cache.delete(k)
    let entry=cache.get(key)
    if(!entry) {
      const source=service.kind==='wms'?{...service,kind:'wfs' as const,version:'1.1.0'}:service
      const pending=fetchCimFeatures(source,500).then(fc=>fc.features.flatMap(f=>normalize(f,id,service.name)))
      entry={expires:now+5*60_000,rows:pending}
      cache.set(key,entry)
      pending.catch(()=>{if(cache.get(key)===entry)cache.delete(key)})
    }
    rows=await entry.rows
  }
  return rows.filter(f=>f.geometry.type==='Polygon'?nearRoad([f.geometry.coordinates],center,radiusM):
    f.geometry.type==='MultiPolygon' && nearRoad(f.geometry.coordinates,center,radiusM))
}

export function roadSurfaceHandler(db:Pool):RequestHandler {
  return async(req,res,next)=>{
    const {lon,lat,radius,scope='events'}=req.query
    const numbers=[lon,lat,radius].map(v=>typeof v==='string' && v.trim()?Number(v):NaN)
    const [x,y,r]=numbers
    if(!numbers.every(Number.isFinite) || Math.abs(y)>90 || Math.abs(x)>180 || r<=0 || r>10000 || (scope!=='events' && scope!=='liveEvent')) {
      res.status(400).json({error:'请输入有效的经纬度及 10 公里内的查询半径。'})
      return
    }
    try {
      const features=await eventRoadSurfaces(db,[x,y],r,scope)
      res.set('Cache-Control','no-cache').json({type:'FeatureCollection',features})
    }catch(error){
      if(error instanceof CimError){res.status(error.status).json({error:error.message});return}
      next(error)
    }
  }
}
