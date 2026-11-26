import {distanceM} from './analytics.ts'
import {venueOwnershipGroup} from './venue-ownership.ts'
import {courtVenueId,unavailableCourt} from './opening-schedule.ts'
import type {CityFeature,Dataset} from './types.ts'
import type {venueCapacity,VenueCapacityCell,VenueFacilityCapacity} from './venue-capacity.ts'

export const periods={
  weekdayEvening:{label:'工作日晚间',weekend:false,from:'18:00',until:'21:00'},
  weekendMorning:{label:'周末上午',weekend:true,from:'09:00',until:'12:00'},
  weekdayMorning:{label:'工作日上午',weekend:false,from:'09:00',until:'12:00'},
  weekendEvening:{label:'周末晚间',weekend:true,from:'18:00',until:'21:00'},
} as const
export type Period=keyof typeof periods
export const gapLabels={coverage:'覆盖',capacity:'容量',time:'时段'} as const
export type GapType=keyof typeof gapLabels
export type GapSource={id:string;name:string;kinds:GapType[];period:Period}
type DayLoad={total:number;booked:number;hours:Set<string>}
type Pressure={days:number;high:number;booked:number;total:number;sufficient:boolean}
const reserved=new Set(['已预约','已预订','已使用','已核销','爽约'])
const vacant=new Set(['可预约','未预订','空闲','未预约'])
function intersectionCount(entries:Map<string,Map<string,DayLoad>>,ids:string[]):Pressure {
  // Compare like days. A missing venue is not a zero-booking venue.
  const out={days:0,high:0,booked:0,total:0,sufficient:false}
  const first=entries.get(ids[0])
  if(!first)return out
  for(const date of first.keys()){
    const loads=ids.map(id=>entries.get(id)?.get(date))
    if(!loads.every((v):v is DayLoad=>!!v&&v.hours.size===3))continue
    const total=loads.reduce((s,v)=>s+v.total,0),booked=loads.reduce((s,v)=>s+v.booked,0)
    out.days++;out.total+=total;out.booked+=booked
    if(booked/total>=.9)out.high++
  }
  out.sufficient=out.days>=3
  return out
}
function slotEvidence(datasets:Dataset[],period:Period,today:string,includeSamples:boolean) {
  const band=periods[period],courts=datasets.find(d=>d.id==='courts')?.features??[]
  const calendar=new Map<string,Map<string,DayLoad>>(),venueByCourt=new Map(courts.map(f=>[f.id,courtVenueId(f)]))
  const since=new Date(Date.parse(today+'T00:00:00Z')-28*86400000).toISOString().slice(0,10)
  const unique=new Map<string,{venue:string;date:string;time:string;booked:boolean;stamp:string;conflict:boolean}>()
  for(const f of datasets.find(d=>d.id==='court_slots')?.features??[]){
    const p=f.properties,date=String(p.date??''),time=String(p.time??'').slice(0,5),status=String(p.status??'')
    if(!includeSamples&&p.sample===true)continue
    const venue=venueByCourt.get(String(p.courtId))
    if(!venue||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<since||date>=today||!/^\d{2}:[0-5]\d$/.test(time)||time<band.from||time>=band.until)continue
    const weekday=new Date(date+'T00:00:00Z').getUTCDay()
    if((weekday===6||weekday===0)!==band.weekend || (!reserved.has(status)&&!vacant.has(status)))continue
    const key=JSON.stringify([p.courtId,date,time]),stamp=String(p.updatedAt??''),old=unique.get(key),booked=reserved.has(status)
    if(!old||stamp>old.stamp)unique.set(key,{venue,date,time,booked,stamp,conflict:false})
    else if(stamp===old.stamp&&old.booked!==booked)old.conflict=true
  }
  for(const row of unique.values()){
    if(row.conflict)continue
    const days=calendar.get(row.venue)??new Map<string,DayLoad>(), load=days.get(row.date)??{total:0,booked:0,hours:new Set<string>()}
    load.total++;load.booked+=Number(row.booked);load.hours.add(row.time.slice(0,2))
    days.set(row.date,load);calendar.set(row.venue,days)
  }
  return calendar
}
export function coordinatingOffice(f:Pick<CityFeature,'properties'>){
  const p=f.properties
  if((p.ledgerId || p.ledgerVenue) && typeof p['管理单位']==='string' && p['管理单位'].trim()) return p['管理单位'].trim()
  const owner=venueOwnershipGroup(p.ownership)?.label
  if(owner==='学校')return '教育局'
  if(owner==='机关单位')return '机关事务服务中心'
  for(const value of [p.managementUnit,p.operator]){
    if(typeof value==='string'&&value.trim()&&!['属地运营','社会运营机构','产权单位管理','学校管理'].includes(value.trim()))return value.trim()
  }
  return '文旅局'
}
// Return unknown for free-form or mixed schedules that have not been normalized.
function matchesHours(hours:string,period:Period):boolean|undefined{
  if(hours.includes('|')) {
    const parts=hours.split('|').map(h=>matchesHours(h,period))
    return parts.some(Boolean) ? true : parts.every(v=>v===false) ? false : undefined
  }
  const b=periods[period]
  const m=hours.trim().match(/^(?:(周末|双休日?|工作日|每日|每天)\s*)?(\d{1,2}:[0-5]\d)\s*[至~～—–-]\s*(\d{1,2}:[0-5]\d)(?:[（(]错时[）)])?$/)
  if(!m)return undefined
  if((m[1]==='工作日'&&b.weekend)||(/^(周末|双休)/.test(m[1]??'')&&!b.weekend))return false
  const start=m[2].padStart(5,'0'),end=m[3].padStart(5,'0')
  if(start>=end||end>'24:00')return undefined
  return start<b.until&&end>b.from
}
export type GapCandidate={venue:VenueFacilityCapacity;distance:number;department:string;reason:string;action:string}
export type ServiceGap={source:GapSource;cell:VenueCapacityCell;feature:CityFeature;pressure:Pressure;hoursGap:boolean;openVenues:number;candidates:GapCandidate[]}
export function diagnoseGaps(cap:ReturnType<typeof venueCapacity>,datasets:Dataset[],period:Period,today:string,includeSamples=false):ServiceGap[]{
  const calendar=slotEvidence(datasets,period,today,includeSamples)
  const courtGroups=new Map<string,CityFeature[]>()
  for(const f of datasets.find(d=>d.id==='courts')?.features??[]){
    const id=courtVenueId(f),list=courtGroups.get(id)??[];list.push(f);courtGroups.set(id,list)
  }
  const facilities=cap.facilities.map(venue=>{
    const courts=courtGroups.get(venue.id)??[]
    const openCourts=courts.filter(c=>c.properties.open===true)
    const hoursFor=(c:CityFeature)=>matchesHours(String(c.properties.openingHours||venue.feature.properties.openingHours||''),period)
    const band=periods[period]
    const outsideHours=venue.openCourts>0&&(openCourts.length
      ? openCourts.every(c=>{
          const windows=c.properties.openingWindows
          const scheduled=c.properties.scheduledOpening&&Array.isArray(windows)&&windows.some(w=>w.from<band.until&&w.until>band.from&&w.days.some((day:number)=>(day===0||day===6)===band.weekend))
          return !scheduled&&(c.properties.scheduledOnly===true||hoursFor(c)===false)
        })
      : hoursFor(venue.feature)===false)
    return {venue,courts,outsideHours,pressure:intersectionCount(calendar,[venue.id])}
  })
  return cap.capacityCells.flatMap((cell):ServiceGap[]=>{
    const near=facilities.map(f=>({...f,distance:distanceM(cell.position,f.venue.position)})).filter(f=>f.distance<=cap.radiusM)
    const open=near.filter(f=>f.venue.openCourts>0)
    const hoursGap=open.length>0&&open.every(f=>f.outsideHours)
    const pressure=intersectionCount(calendar,open.filter(f=>!f.outsideHours).map(f=>f.venue.id))
    const kinds:GapType[]=[]
    if(cell.outsidePopulation>0)kinds.push('coverage')
    if(cell.capacityShortfallPopulation>0)kinds.push('capacity')
    if(hoursGap||pressure.high>=3)kinds.push('time')
    if(!kinds.length)return []
    const candidates:GapCandidate[]=[]
    for(const row of near){
      const {venue,distance,courts}=row
      const closed=courts.filter(c=>!c.properties.open && !unavailableCourt(c) && (!c.properties.ledgerId || (c.properties['建设状态']==='已建' && c.properties['是否可协调']==='是')))
      const hasEquipment=(c:CityFeature)=>!(periods[period].from==='18:00'&&c.properties.indoor!==true&&c.properties.lighting===false)
      const eligible=closed.filter(c=>matchesHours(String(c.properties.openingHours||venue.feature.properties.openingHours||''),period)!==false&&hasEquipment(c))
      const pieces=eligible.reduce((n,c)=>n+Number(c.properties.count??1),0)
      let reason='',action=''
      if(pieces>0){reason=pieces+' 片待核实开放意向、可用时段及入场条件';action='协调开放'}
      else if(!courts.length&&venue.totalCourts>venue.openCourts&&matchesHours(String(venue.feature.properties.openingHours??''),period)!==false&&hasEquipment(venue.feature)){
        reason='有未开放存量，先核实逐片场地和开放条件';action='核实场地'
      }else if(hoursGap&&row.outsideHours&&(courts.length?courts.some(c=>c.properties.open===true&&!unavailableCourt(c)&&hasEquipment(c)):hasEquipment(venue.feature))){
        reason='现行开放时间与所选时段错开，可协调延长或调整开放时间';action='协调时段'
      }else if(kinds.includes('time')&&venue.openCourts>0&&row.pressure.sufficient&&row.pressure.total>row.pressure.booked&&row.pressure.high===0){
        reason='同一时段有未订记录，需确认当前余量';action='协调分流'
      }
      if(action)candidates.push({venue,distance,department:coordinatingOffice(venue.feature),reason,action})
    }
    candidates.sort((a,b)=>a.distance-b.distance||a.venue.id.localeCompare(b.venue.id))
    const source={id:cell.feature.id,name:cell.feature.properties.name,kinds,period}
    const feature:CityFeature={...cell.feature,id:'service-gap:'+source.id,properties:{...cell.feature.properties,kind:'service-gap',sourceId:source.id,
      color:kinds.includes('coverage')?'#e66a55':kinds.includes('capacity')?'#f5a246':'#aa77d4'}}
    return [{source,cell,feature,pressure,hoursGap,openVenues:open.length,candidates}]
  }).sort((a,b)=>b.cell.underservedPopulation-a.cell.underservedPopulation||b.pressure.high-a.pressure.high||a.source.id.localeCompare(b.source.id))
}

