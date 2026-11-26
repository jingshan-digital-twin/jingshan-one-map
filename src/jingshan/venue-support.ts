import {distanceM} from './analytics.ts'
import { isTourismReference } from './tourism-register.ts'
import {featureCenter,type CityFeature,type Dataset,type Coordinate} from './types.ts'
import type {VenueFacilityCapacity} from './venue-capacity.ts'

export const supportCategories={hotels:'住宿',food:'餐饮',shopping:'购物',medical:'医疗',parking:'停车',charging:'充电',coaches:'教练',partners:'陪练',tourism:'景区',springs:'温泉'} as const
export type SupportKind=keyof typeof supportCategories
export const supportFilterOrder = Object.keys(supportCategories) as SupportKind[]
export type Facility={feature:CityFeature;layer:string;kind:SupportKind}
export const serviceDetailRadiusKm=1
const collectedKinds:Readonly<Record<string,SupportKind>>={
  commerce_hotels:'hotels',commerce_food:'food',
}
export const supportLayerIds=['hotels','food','parking','charging','medical','training','coaches','sparring_partners','tourism','springs','merchants',...Object.keys(collectedKinds)]
export function isFacilityAttraction(item: Facility) {
  return item.kind === 'tourism' || item.kind === 'springs'
}
export const resources=[
  {id:'beds',label:'床位',unit:'床',kind:'hotels',registered:'beds',available:'available'},
  {id:'spaces',label:'停车位',unit:'个',kind:'parking',registered:'spaces',available:'available'},
  {id:'charging',label:'充电桩',unit:'个',kind:'charging',registered:'charging',available:'availableCharging'},
  {id:'seats',label:'餐位',unit:'位',kind:'food',registered:'seats',available:'availableSeats'},
] as const
export type ResourceId=typeof resources[number]['id']
const gunResource={id:'charging',label:'充电枪',unit:'把',kind:'charging',registered:'gunCount',available:'availableGuns'} as const
export function facilityResource(item:Facility){
  return item.kind==='charging' && item.feature.properties.gunCount!==undefined ? gunResource : resources.find(r=>r.kind===item.kind)
}
export function amount(value:unknown){
  return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:undefined
}
export function facilitySiteKey({feature,layer}:Pick<Facility,'feature'|'layer'>) {
  // A tourism partner can reference the same site already listed in the attraction register.
  const {category,sourceId} = feature.properties
  if (layer==='merchants' && ['景区','温泉','景区温泉'].includes(String(category)) && typeof sourceId==='string' && sourceId)
    return sourceId
  const uid = feature.properties.locationReview?.poi?.uid
  return layer==='commerce_hotels' && uid ? 'baidu-hotel:'+uid : feature.id
}
export function uniqueFacilitySites<T extends Facility>(providers:T[]):T[] {
  const sites = new Map<string,T>()
  for (const item of providers) {
    const key = facilitySiteKey(item)
    if (!sites.has(key)) sites.set(key,item)
  }
  return [...sites.values()]
}
export function facilityDirectoryRows(providers:Facility[],kind:SupportKind|'') {
  const sites = uniqueFacilitySites(kind ? providers.filter(item => item.kind === kind) : providers)
  const priority = (item:Facility) => (item.feature.properties.sample === true ? 2 : 0) + (featureCenter(item.feature) ? 0 : 1)
  sites.sort((a,b) => priority(a) - priority(b))
  if (kind) return sites
  const groups = supportFilterOrder.map(category => sites.filter(item => item.kind === category))
  const longest = Math.max(0,...groups.map(group => group.length))
  const rows:Facility[] = []
  for (let index = 0; index < longest; index++) {
    for (const group of groups) if (group[index]) rows.push(group[index])
  }
  return rows
}
// Two registrations for one hotel may report the same beds. Disagreeing figures need review.
export function siteAmounts(items:Facility[], read:(item:Facility)=>number|undefined) {
  const amounts = new Map<string,number|undefined>()
  for (const item of items) {
    const key = facilitySiteKey(item), value = read(item)
    amounts.set(key,amounts.has(key) && amounts.get(key)!==value ? undefined : value)
  }
  return [...amounts.values()]
}

const summaryMeasures = {
  hotels:   {field:'beds', label:'床位', unit:'张', fallback:'酒店', siteUnit:'家'},
  food:     {field:'seats', label:'餐位', unit:'个', fallback:'餐饮门店', siteUnit:'家'},
  medical:  {field:'', label:'', unit:'', fallback:'医疗机构', siteUnit:'处'},
  springs:  {field:'', label:'', unit:'', fallback:'温泉', siteUnit:'处'},
  parking:  {field:'spaces', label:'停车位', unit:'个', fallback:'停车场', siteUnit:'处'},
  charging: {field:'charging', label:'充电桩', unit:'个', fallback:'充电站点', siteUnit:'处'},
  coaches:  {field:'coaches', label:'教练', unit:'人', fallback:'教练服务点', siteUnit:'处'},
  partners: {field:'sparringPartners', label:'陪练', unit:'人', fallback:'陪练服务点', siteUnit:'处'},
  tourism:  {field:'', label:'', unit:'', fallback:'景区', siteUnit:'处'},
  shopping: {field:'', label:'', unit:'', fallback:'购物门店', siteUnit:'家'},
} as const

export function supportSummary(providers: Facility[], includeEmpty = false) {
  // facilityDirectory lists the site's primary activity before any additional services.
  const primaryCounts = new Map<SupportKind, number>()
  for (const {kind} of uniqueFacilitySites(providers)) primaryCounts.set(kind, (primaryCounts.get(kind) ?? 0) + 1)

  return supportFilterOrder.flatMap(kind => {
    const group = providers.filter(item => item.kind === kind)
    const measure = summaryMeasures[kind]
    if (!group.length) return includeEmpty ? [{kind,label:measure.fallback,value:0,unit:measure.siteUnit,count:0}] : []
    let {field, label, unit}: {field:string; label:string; unit:string} = measure
    if (kind === 'charging' && group.some(item => amount(item.feature.properties.gunCount) !== undefined)) {
      field = 'gunCount'
      label = '充电枪'
      unit = '把'
    }
    const values = siteAmounts(group, item => amount(item.feature.properties[field]))
    const count = primaryCounts.get(kind) ?? 0
    if (field && values.every((value): value is number => value !== undefined)) {
      return [{kind, label, value:values.reduce((sum,value) => sum + value, 0), unit, count}]
    }
    return [{kind, label:measure.fallback, value:values.length, unit:measure.siteUnit, count}]
  })
}
export function facilityKinds(id:string,f:CityFeature):SupportKind[] {
  if (id==='tourism' && isTourismReference(f)) return []
  const kinds:SupportKind[]=[]
  if(Object.hasOwn(collectedKinds,id))kinds.push(collectedKinds[id])
  if(['hotels','food','parking','medical','springs'].includes(id))kinds.push(id as SupportKind)
  const {category,type,facilityType,name}=f.properties
  if(id==='merchants'&&category==='购物')kinds.push('shopping')
  if(id==='tourism'||id==='merchants'&&['景区','温泉','景区温泉'].includes(String(category))){
    // The mixed merchant register also contains public parks and sports stops.
    // Only classify those entries when their own record identifies an attraction.
    const spring = category==='温泉' || [type,facilityType].some(value=>/^温泉/.test(String(value))) ||
      /温泉(?:度假|疗养|康养|景区|浴场|公馆|中心|$)/.test(name)
    if(spring)kinds.push('springs')
    else if(id==='tourism'||category==='景区'||/景区|旅游区|度假区/.test(name))kinds.push('tourism')
  }
  if(id==='charging'||id==='parking'&&(amount(f.properties.charging)??0)>0)kinds.push('charging')
  if(id==='training'&&(amount(f.properties.coaches)??0)>0||id==='coaches')kinds.push('coaches')
  if(id==='training'&&(amount(f.properties.sparringPartners)??0)>0||id==='sparring_partners')kinds.push('partners')
  return kinds
}
export function facilityDirectory(datasets:Dataset[]):Facility[]{
  const directory:Facility[]=[]
  for(const {id,features} of datasets)for(const feature of features){
    for(const kind of facilityKinds(id,feature))directory.push({feature,layer:id,kind})
  }
  const priority=({feature}:Facility)=>feature.properties.recordSource?0:feature.properties.sample===true?2:1
  return directory.sort((a,b)=>priority(a)-priority(b))
}
function meters(from:Coordinate,facility:Facility){
  const pos=facility.feature.geometry&&featureCenter(facility.feature)
  return pos?distanceM(from,pos):Infinity
}
export function nearbyProviders(venue:Pick<VenueFacilityCapacity,'position'>,facilities:Facility[],radius:number){
  return facilities.map(item=>({...item,meters:meters(venue.position,item)})).filter(item=>item.meters<=radius).sort((a,b)=>a.meters-b.meters)
}
export function nearbyFacilitySites(center:Coordinate|null|undefined,facilities:Facility[],radius:number,exclude?:string) {
  if (!center) return []
  const nearby=nearbyProviders({position:center},facilities,radius)
  return uniqueFacilitySites(nearby).filter(item=>facilitySiteKey(item)!==exclude)
}
export type ServedVenue = { venue:VenueFacilityCapacity; meters:number; bound:boolean }
export function reverseVenues(facility:Facility,venues:VenueFacilityCapacity[],radius:number):ServedVenue[]{
  const p=facility.feature.properties
  const bound=new Set([p.venueId,...(Array.isArray(p.venueIds)?p.venueIds:[])].filter(v=>typeof v==='string'))
  const personnel=facility.kind==='coaches'||facility.kind==='partners'
  return venues.map(venue=>({venue,meters:meters(venue.position,facility),bound:bound.has(venue.id)}))
    .filter(row=>row.meters<=radius||personnel&&row.bound).sort((a,b)=>Number(b.bound)-Number(a.bound)||a.meters-b.meters)
}
export function serviceDistance(meters:number) {
  if (!Number.isFinite(meters)) return '—'
  return meters < 1000 ? Math.round(meters) + ' 米' : (meters / 1000).toFixed(1) + ' 公里'
}
export type DemandAssumptions={guests:number;overnight:number;dining:number;driving:number;perCar:number;charging:number;reserve:number}
export function resourceSupply(places:ReturnType<typeof nearbyProviders>,datasets:Dataset[]){
  const hasGuns=datasets.some(d=>d.id==='charging'&&d.features.some(f=>amount(f.properties.gunCount)!==undefined))
  return resources.map(base=>{
    const resource=hasGuns&&base.kind==='charging'?gunResource:base
    const guns=resource===gunResource
    const inventory=datasets.filter(d=>d.id===resource.kind||collectedKinds[d.id]===resource.kind||
      (!guns&&resource.kind==='charging'&&d.id==='parking'))
    const providers=places.filter(f=>f.kind===resource.kind&&(!guns||f.layer==='charging'))
    const unlocated=inventory.reduce((sum,d)=>sum+d.features.filter(f=>!featureCenter(f)).length,0)
    const reported=(key:string)=>{
      if(!inventory.length || (!providers.length&&unlocated))return undefined
      if(!guns&&resource.kind==='charging'&&places.some(f=>f.kind==='parking'&&amount(f.feature.properties.charging)===undefined))return undefined
      const values=siteAmounts(providers,f=>amount(f.feature.properties[key]))
      return values.some(v=>v===undefined)?undefined:(values as number[]).reduce((s,v)=>s+v,0)
    }
    return {...resource,providers,unlocated,maximum:reported(resource.registered),availableCount:reported(resource.available)}
  })
}
export function supportAssessment(places:ReturnType<typeof nearbyProviders>,datasets:Dataset[],inputs:DemandAssumptions){
  const {guests,overnight,dining,driving,perCar,charging}=inputs
  const cars=Math.ceil(guests*driving/100/perCar)
  const targets={beds:Math.ceil(guests*overnight/100),seats:Math.ceil(guests*dining/100),spaces:cars,charging:Math.ceil(cars*charging/100)}
  return resourceSupply(places,datasets).map(resource=>{
    const {providers,maximum,availableCount:available}=resource,target=targets[resource.id]
    const usable=available===undefined?undefined:Math.min(maximum??Infinity,available)
    // Preserve reported availability when only some providers have supplied a current balance.
    const limits=siteAmounts(providers,({feature})=>{
      const cap=amount(feature.properties[resource.registered]),free=amount(feature.properties[resource.available])
      if(resource.registered==='gunCount'&&!feature.properties.commissionedOn&&free===undefined)return undefined
      return free===undefined?cap:Math.min(cap??Infinity,free)
    })
    const bounded=usable!==undefined?usable:maximum!==undefined&&limits.every(n=>n!==undefined)
      ?limits.reduce<number>((sum,n)=>sum+(n??0),0):undefined
    const sustainable=bounded===undefined?undefined:Math.floor(bounded*(100-inputs.reserve)/100)
    const shortage=sustainable!==undefined&&sustainable<target
    const deficit=shortage&&resource.unlocated?undefined:usable!==undefined?Math.max(0,target-sustainable!):shortage?target-sustainable!:undefined
    const verdict=deficit===undefined?'余量待核实':deficit>0?'不足':'适宜'
    return {...resource,providers,maximum,sustainable,availableCount:usable,target,deficit,verdict}
  })
}

export type SupportMetric = ReturnType<typeof supportAssessment>[number]

export function capacityUnit(resource: {id:ResourceId; unit:string}) {
  return resource.id === 'beds' ? '张' : resource.id === 'seats' ? '个' : resource.unit
}

export function capacityFigure(row: SupportMetric) {
  const unit = capacityUnit(row)
  if (row.maximum !== undefined) return {label:row.label, value:row.maximum, unit, minimum:false}
  const known = siteAmounts(row.providers, item => amount(item.feature.properties[row.registered]))
  const subtotal = known.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  if (subtotal > 0) return {label:row.label, value:subtotal, unit, minimum:true}
  const measure = summaryMeasures[row.kind]
  return known.length
    ? {label:measure.fallback, value:known.length, unit:measure.siteUnit, minimum:false}
    : {label:row.label, value:undefined, unit, minimum:false}
}

