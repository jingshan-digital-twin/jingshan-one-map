import type { CityFeature, Result } from './types.ts'
import { featureCenter } from './types.ts'
import { districtCenter } from './facility-boundaries.ts'
import type { Demand } from './investment-demand.ts'
import { urbanPlacement, urbanRelationOf } from './investment-planning.ts'
import { distanceM } from './analytics.ts'
import { readDispatch } from './industry-investment.ts'
import type { ChainTopic } from './chain-taxonomy.ts'

const enterpriseTypes:Record<ChainTopic,string[]> = {
  器材制造:['网球器材制造企业','体育装备研发企业'],运动服饰:['运动服饰生产企业','功能面料企业'],
  场地建设:['体育场地工程企业','体育设施材料企业'],场馆运营:['体育场馆运营企业'],
  俱乐部运营:['体育俱乐部运营企业'],培训陪练:['体育培训机构'],赛事组织:['体育赛事运营企业'],
  住宿接待:['酒店及住宿运营企业'],餐饮服务:['餐饮及团餐服务企业'],景区游览:['文旅线路运营企业'],
  运动康养:['运动康复服务机构'],购物展销:['体育用品零售企业','会展服务企业'],
}

const supportEnterprises:Record<string,string>={'医疗':'医疗服务机构','餐饮':'餐饮及团餐服务企业','停车':'停车设施建设运营企业','日用品零售':'社区零售企业'}
export function targetEnterprises(demand:Demand) {
  if(demand.blind)return ['体育场地建设企业','体育场馆运营企业']
  if(demand.support?.missing.length)return demand.support.missing.map(item=>supportEnterprises[item.label]??item.label)
  return enterpriseTypes[demand.topic] ?? [demand.direction]
}

// The dispatch ledger uses compact interior points. Site selection keeps the published rings.
export function parcelPoint(feature:CityFeature):CityFeature | undefined {
  const at=feature.geometry.type==='Point' ? featureCenter(feature) : districtCenter(feature) ?? featureCenter(feature)
  if(!at)return
  const p=feature.properties
  return {type:'Feature',id:feature.id,geometry:{type:'Point',coordinates:at},properties:{
    name:p.name,region:p.region,kind:'available-parcel',center:at,area:p.area,landUse:p.landUse,landUseCode:p.landUseCode,
    urbanRelation:p.urbanRelation,urbanInsidePercent:p.urbanInsidePercent,surveyUnit:p.surveyUnit,surveyParcel:p.surveyParcel,
    surveyId:p.surveyId,sourceFid:p.sourceFid,
  }}
}
export function recordPoint(f:CityFeature):CityFeature|undefined {
  if(f.geometry.type==='Point')return f
  if(f.properties.kind==='investment-reserve')return parcelPoint(f)
  const at=featureCenter(f)
  return at ? {...f,geometry:{type:'Point',coordinates:at}} : undefined
}
export function pointsForRecord(row:Result):Result {
  return {...row,features:row.features.flatMap(f=>recordPoint(f)??[])}
}
export function preferredLandUse(demand:Demand){
  return ['器材制造','运动服饰','场地建设'].includes(demand.topic) ? '0601' : '05H1'
}
export function rankAvailableParcels(demand:Demand,parcels:CityFeature[]) {
  const use=preferredLandUse(demand)
  return parcels.flatMap(f=>{
    if(demand.region!=='京山市' && f.properties.region!==demand.region)return []
    const at=f.geometry.type==='Point' ? featureCenter(f) : districtCenter(f)
    if(!at)return []
    return [{f,rank:urbanPlacement(f).rank,match:f.properties.landUseCode===use,
      distance:demand.anchor ? distanceM(demand.anchor,at) : 0}]
  }).sort((a,b)=>{
    const area=Number(b.f.properties.area)-Number(a.f.properties.area)
    // A town reference point is not a factory address. Prefer contiguous area for industrial leads.
    return a.rank-b.rank || Number(b.match)-Number(a.match) || (use==='0601'?area:0) ||
      a.distance-b.distance || area || a.f.id.localeCompare(b.f.id)
  }).map(o=>o.f)
}
export function recommendedParcels(demand:Demand,options:CityFeature[]) {
  return options.filter(f=>urbanRelationOf(f)==='inside' && f.properties.landUseCode===preferredLandUse(demand)).slice(0,3)
}
export function isSiteRecord(result:Result){
  return result.scene==='investment' && (readDispatch(result).recordKind==='selection' ||
    result.features.some(f=>['investment-reserve','available-parcel','investment-parcel','parcel'].includes(f.properties.kind)))
}
