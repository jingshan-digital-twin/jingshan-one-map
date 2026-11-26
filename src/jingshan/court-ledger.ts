import { featureCenter, type CityFeature, type DataDocument, type Dataset } from './types.ts'
import { venueOwnershipGroup } from './venue-ownership.ts'

export const courtLedgerId = 'court_footprints_ledger'
export const surveyCourtLedgerId = 'tennis1124'
export const courtServiceId = 'hosted-' + courtLedgerId
export const courtMapSlot = 'dataset:court_footprints'
export function isCourtLedgerId(id?:string|null) {
  return id===surveyCourtLedgerId || id===courtLedgerId || !!id && /^court_footprints_ledger_[a-z0-9][a-z0-9_-]*$/.test(id)
}
export function boundCourtSource(data:Pick<DataDocument,'mapBindings'>) {
  const service=data.mapBindings?.find(b=>b.scope==='all' && b.slot===courtMapSlot)?.serviceId
  const id=service?.startsWith('hosted-') ? service.slice(7) : undefined
  return isCourtLedgerId(id) ? id : undefined
}
export function activeCourtSourceId(data:Pick<DataDocument,'datasets'|'mapBindings'>) {
  return boundCourtSource(data) ?? data.datasets.find(d=>d.id==='courts' && isCourtLedgerId(d.derivedFrom))?.derivedFrom
    ?? (data.datasets.some(d=>d.id===surveyCourtLedgerId) ? surveyCourtLedgerId : courtLedgerId)
}
export function activeCourtSource(data:Pick<DataDocument,'datasets'|'mapBindings'>) {
  const id=activeCourtSourceId(data)
  return data.datasets.find(d=>d.id===id)
}
// Editions have distinct source records. Matching survey boundaries keep their
// court and footprint IDs so existing schedules can still identify the court.
export function courtIdentity(sourceId:string, recordId:string, priorRecordId?:unknown) {
  // The 1124 survey carries the prior ledger record ID in its DBF. Keep that
  // court's published ID while the hosted source retains its own feature ID.
  if (sourceId===surveyCourtLedgerId && typeof priorRecordId==='string') {
    const prior=priorRecordId.trim(), split=prior.indexOf(':')
    if (split>0 && split<prior.length-1 && isCourtLedgerId(prior.slice(0,split))) return prior.slice(split+1)
  }
  const prefix=sourceId+':'
  return recordId.startsWith(prefix) ? recordId.slice(prefix.length) : recordId
}
export const ledgerFields = [
  '名称','所属场馆','权属','镇街或片区','场地形式','地面类型','建设状态','管理单位','运营单位',
  '开放方式','开放条件','开放时段','是否可协调','可协调日期类型','可协调时段','协调限制',
] as const
export const courtViewIds = ['courts','venues','court_footprints'] as const
// Source GeoJSON keeps the survey's DBF field names; business views use the shared ledger schema.
export const surveyCourtFields:Record<string,string> = {'名称':'实体名称','镇街或片区':'所属行政区','可协调日期类型':'协调日期类'}
export function courtSourceField(sourceId:string, field:string) {
  return sourceId===surveyCourtLedgerId && Object.hasOwn(surveyCourtFields,field) ? surveyCourtFields[field] : field
}
export function surveyCourtName(properties:Record<string,unknown>):string {
  const name=properties['实体名称']
  if (typeof name!=='string' || !name.trim()) throw Error('请填写网球场地的实体名称。')
  return name
}

function value(row: CityFeature, field: string) {
  const raw = row.properties[field]
  return typeof raw === 'string' ? raw.trim() : ''
}

function openingMode(row: CityFeature) {
  const mode = value(row,'开放方式')
  return mode === '不开' ? '不开放' : mode
}

export function ledgerDetails(row: CityFeature): [string, string][] {
  return ledgerFields.map(field => [field, value(row,field) || '未填'])
}

/** Short navigation numbers stay local to the venue; the selected record retains its source name. */
export function numberedVenueCourts(courts: CityFeature[]) {
  const used = new Set<number>()
  const rows = courts.map(court => {
    const match = String(court.properties['名称'] || court.properties.name).normalize('NFKC').match(/(\d+)\s*号(?:网球)?场/)
    const number = match ? Number(match[1]) : 0
    if (!number || used.has(number)) return {court, number:0}
    used.add(number)
    return {court, number}
  })
  let next = 1
  for (const row of rows) {
    if (row.number) continue
    while (used.has(next)) next++
    row.number = next++
  }
  return rows.sort((a,b) => a.number-b.number)
}

export function venueFieldCounts(courts: CityFeature[], field: string) {
  const counts = new Map<string,number>()
  for (const court of courts) {
    const label = value(court,field) || '未填'
    counts.set(label,(counts.get(label) ?? 0) + 1)
  }
  return [...counts].sort(([a,n],[b,m]) => Number(a==='未填')-Number(b==='未填') || m-n || a.localeCompare(b,'zh-CN'))
}

function venueKey(name: string) { return 'ledger-venue:' + name }

function courtRow(row: CityFeature, sourceId:string): CityFeature {
  const venue = value(row,'所属场馆'), form = value(row,'场地形式'), opening = openingMode(row)
  const state = value(row,'建设状态')
  const id = 'court:' + courtIdentity(sourceId,row.id,row.properties['实体业务ID'])
  const properties = Object.fromEntries(ledgerFields.map(key => [key,value(row,courtSourceField(sourceId,key))]))
  if (sourceId===surveyCourtLedgerId) properties['名称']=surveyCourtName(row.properties)
  return {type:'Feature', id, geometry:row.geometry, properties:{
    ...properties, '开放方式':opening, name:properties['名称'] || row.properties.name, region:row.properties.region, kind:'court',
    ledgerId:row.id, facilityId:venue ? venueKey(venue) : id, facilityName:venue || undefined, count:1,
    ownership:value(row,'权属'), operator:value(row,'运营单位'), managementUnit:value(row,'管理单位'), surface:value(row,'地面类型'),
    indoor:form === '室内球场' ? true : form === '室外球场' ? false : undefined,
    openMode:opening, openingHours:value(row,'开放时段'), status:opening || undefined,
    open:state === '已建' && (opening === '全天开放' || opening === '错时开放'),
  }}
}

function venueRow(name: string, courts: CityFeature[]): CityFeature {
  const shared = (key: string) => [...new Set(courts.map(c => value(c,key)).filter(Boolean))].join('、')
  const regions = new Map<string,number>()
  for (const c of courts) regions.set(c.properties.region,(regions.get(c.properties.region) ?? 0) + 1)
  const region = [...regions].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0],'zh-CN'))[0][0]
  const points = courts.map(c => featureCenter(c)!)
  const position = [0,1].map(i => points.reduce((n,p) => n+p[i],0) / points.length)
  const id = venueKey(name)
  return {type:'Feature',id,geometry:{type:'Point',coordinates:position},properties:{
    name,region,kind:'venue',facilityId:id,facilityName:name,count:courts.length, ledgerVenue:true,
    ownership:shared('权属'),operator:shared('运营单位'),openingHours:shared('开放时段'),
    openMode:shared('开放方式'),status:shared('开放方式'),open:courts.some(c=>c.properties.open),
    indoorCourts:courts.filter(c=>value(c,'场地形式')==='室内球场').length,
    outdoorCourts:courts.filter(c=>value(c,'场地形式')==='室外球场').length,
    coveredCourts:courts.filter(c=>value(c,'场地形式')==='风雨球场').length,
    '管理单位':shared('管理单位'),'运营单位':shared('运营单位'),'建设状态':shared('建设状态'),
    '是否可协调':shared('是否可协调'),'场地形式':shared('场地形式'),'地面类型':shared('地面类型'),
    '开放方式':shared('开放方式'),'开放条件':shared('开放条件'),'可协调时段':shared('可协调时段'),
  }}
}

export function courtViews(source: Dataset): Dataset[] {
  const grouped = new Map<string,CityFeature[]>()
  const courts = source.features.map(row => {
    if (row.geometry.type !== 'Polygon' && row.geometry.type !== 'MultiPolygon') throw Error('网球场地台账需使用实测面边界：' + row.id)
    const court = courtRow(row,source.id), name = value(row,'所属场馆')
    if (name) {
      const group = grouped.get(name)
      if (group) group.push(court)
      else grouped.set(name,[court])
    }
    return court
  })
  const view = (id:string,name:string,features:CityFeature[]):Dataset => ({
    id,name,department:source.department,category:source.category,description:'由「'+source.name+'」随发布版本生成。',derivedFrom:source.id,features,
  })
  return [
    view('courts','网球场地',courts),
    view('venues','网球场馆',[...grouped].map(([name,rows])=>venueRow(name,rows))),
    view('court_footprints','网球场地边界',courts.map(c=>({...c,id:'boundary:'+c.id.slice('court:'.length),properties:{...c.properties,kind:'court-footprint',courtId:c.id}}))),
  ]
}

// Retired sample itineraries also contained the former venue as a line endpoint.
const sampleDestinations = new Set(['京山国际网球中心','文峰网球主题公园','京山网球训练基地'])
function removeSampleVenueReferences(dataset:Dataset):Dataset {
  if (['venue_operations','court_slots'].includes(dataset.id)) return {...dataset,features:dataset.features.filter(f=>f.properties.sample!==true)}
  if (dataset.id==='investment_hotspots' || dataset.id==='investment_needs') return {...dataset,features:dataset.features.filter(f=>
    !f.properties.sample || !String(f.properties.hotspotId ?? f.id).startsWith('hotspot-venue-'))}
  if (!['events','origins','routes','route_packages','operations_monthly','schools'].includes(dataset.id)) return dataset
  return {...dataset,features:dataset.features.map(f=>{
    if (f.properties.sample!==true) return f
    const properties = {...f.properties}
    let geometry=f.geometry
    if (dataset.id==='operations_monthly') delete properties.bookings
    if (dataset.id==='schools') {
      delete properties.courts
      delete properties.facilityId
    }
    if (String(properties.venueId ?? '').startsWith('venue-')) {
      delete properties.venueId
      delete properties.venue
    }
    const endpoint=dataset.id==='origins' ? 'to' : 'from'
    if (sampleDestinations.has(String(properties[endpoint] ?? ''))) {
      delete properties[endpoint]
      if (geometry.type==='LineString') geometry={type:'Point',coordinates:endpoint==='to' ? geometry.coordinates[0] : geometry.coordinates.at(-1)!}
      if (Array.isArray(properties.itinerary)) properties.itinerary=properties.itinerary.filter(line=>
        typeof line==='string' && ![...sampleDestinations].some(name=>line.includes(name)))
    }
    return {...f,properties,geometry}
  })}
}

export function withCourtViews(data: DataDocument, source: Dataset): DataDocument {
  if (source.id===surveyCourtLedgerId) {
    source={...source,features:source.features.map(row=>{
      const name=surveyCourtName(row.properties)
      return row.properties.name===name ? row : {...row,properties:{...row.properties,name}}
    })}
  }
  const views = new Map(courtViews(source).map(d=>[d.id,d]))
  const datasets = data.datasets.map(d=>{
    const derived = views.get(d.id)
    if (derived) { views.delete(d.id); return derived }
    return d.id===source.id ? source : d
  })
  if (!datasets.some(d=>d.id===source.id)) datasets.push(source)
  return {...data,datasets:[...datasets,...views.values()]}
}

export function withCourtLedger(data: DataDocument, source = activeCourtSource(data)): DataDocument {
  if (!source) return data
  const datasets=data.datasets.filter(d=>d.id!=='form_overview_court_stats').map(removeSampleVenueReferences)
  return withCourtViews({...data,datasets},source)
}

export function ledgerStatistics(courts: Pick<Dataset,'features'> | undefined, region: string) {
  const rows = courts?.features.filter(c=>region==='京山市' || c.properties.region===region)
  const count = (test:(c:CityFeature)=>boolean) => rows?.filter(test).length
  const opening = new Map<string,number>()
  if (rows) for (const c of rows) {
    const label = openingMode(c) || '未填'
    opening.set(label,(opening.get(label) ?? 0)+1)
  }
  return {
    courts:rows?.length, venues:rows && new Set(rows.map(c=>value(c,'所属场馆')).filter(Boolean)).size,
    unassigned:count(c=>!value(c,'所属场馆')), ownership:(label:string)=>count(c=>(venueOwnershipGroup(value(c,'权属'))?.label ?? '未填')===label),
    opening: [...opening].sort(([a],[b])=>Number(a==='未填')-Number(b==='未填') || a.localeCompare(b,'zh-CN')),
  }
}
