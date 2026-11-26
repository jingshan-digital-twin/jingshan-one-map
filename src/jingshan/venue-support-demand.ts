import { distanceM } from './analytics.ts'
import { featureCenter, type CityFeature, type Coordinate, type Dataset } from './types.ts'

export const supportRadiusM=1000
export const venueStandardUrl='https://www.sport.gov.cn/n4/n23362064/n23362030/c28171875/part/28171832.pdf'
export const venueStandardTitle='《城市公共体育馆建设标准》'
export const stadiumStandardUrl='https://www.sport.gov.cn/n4/n23362064/n23362030/c28171875/content.html'
export const stadiumStandardTitle='《城市公共体育场建设标准》'
// The standard identifies service functions. The surrounding-POI radius and minimum
// presence are local screening parameters, not statutory capacity requirements.
const categories=[
  {label:'医疗',layers:['medical']},
  {label:'餐饮',layers:['food','commerce_food']},
  {label:'停车',layers:['parking']},
  {label:'日用品零售',layers:['commerce_retail','shopping']},
] as const
export type SupportItem={label:string; count:number; inventoried:boolean; unlocated:number; nearby:CityFeature[]}
export type VenueSupport={venue:CityFeature; anchor:Coordinate; items:SupportItem[]; missing:SupportItem[]; pending:SupportItem[]}

export function assessVenueSupport(data:Dataset[],region:string):VenueSupport[] {
  const layers=new Map(data.map(d=>[d.id,d.features]))
  const supplies=categories.map(({label,layers:ids})=>{
    const distinct=new Map<string,{feature:CityFeature; at:Coordinate}>()
    let unlocated=0
    for(const id of ids)for(const feature of layers.get(id)??[]){
      if(feature.properties.sample===true)continue
      const at=feature.geometry && featureCenter(feature)
      if(!at){unlocated++;continue}
      distinct.set([feature.properties.name,...at.map(n=>n.toFixed(5))].join('|'),{feature,at})
    }
    return {label,sites:[...distinct.values()],unlocated}
  })
  const results:VenueSupport[]=[]
  for(const venue of layers.get('venues')??[]){
    if(venue.properties.sample===true || (region!=='京山市' && venue.properties.region!==region))continue
    const anchor=featureCenter(venue)
    if(!anchor)continue
    const items=supplies.map(({label,sites,unlocated})=>{
      const nearby=sites.filter(s=>distanceM(anchor,s.at)<=supportRadiusM).map(s=>s.feature)
      return {label,count:nearby.length,inventoried:sites.length>0,unlocated,nearby}
    })
    results.push({venue,anchor,items,missing:items.filter(i=>i.inventoried && !i.count),pending:items.filter(i=>!i.inventoried)})
  }
  return results.sort((a,b)=>b.missing.length-a.missing.length || a.venue.properties.name.localeCompare(b.venue.properties.name,'zh-CN'))
}
