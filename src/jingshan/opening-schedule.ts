import { OpeningError, openingDate } from './venue-opening.ts'
import type { CityFeature, Dataset } from './types.ts'

export type SchedulePlan = {
  startsOn:string; endsOn:string; days:number[]; from:string; until:string; courtIds:string[]; courtVenues?:Record<string,string>
}
export type OpeningSchedule = SchedulePlan & {taskId:string;venueId:string;revision:number;cancelled:boolean}
export const dayNames = ['日','一','二','三','四','五','六']
export const courtVenueId = (f:CityFeature) => typeof f.properties.facilityId === 'string' && f.properties.facilityId.trim() ? f.properties.facilityId : f.id
export function unavailableCourt(f:CityFeature) {
  if(f.properties.ledgerId && f.properties['建设状态']!=='已建') return true
  return ['维修','维护','维修中','维护中','停用','施工','施工中','拆除'].includes(String(f.properties.status))
}
export function canScheduleCourt(f:CityFeature) {
  return !(f.properties.ledgerId && f.properties['是否可协调']!=='是') && !unavailableCourt(f) && (f.properties.count === undefined || f.properties.count === 1)
}
export function checkedPlan(input:Record<string,unknown>,courts:CityFeature[],venueId:string|undefined):SchedulePlan {
  const startsOn=openingDate(input.startsOn,'生效日期')
  const endsOn=input.endsOn ? openingDate(input.endsOn,'截止日期') : ''
  if (endsOn && endsOn<startsOn) throw new OpeningError('截止日期不能早于生效日期')
  const {from,until,days,courtIds}=input
  const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/
  if (typeof from!=='string'||typeof until!=='string'||!time.test(from)||!(time.test(until)||until==='24:00')||from>=until) throw new OpeningError('请选择同一天内有效的起止时段')
  if (!Array.isArray(days)||!days.length||days.length>7||days.some(day=>!Number.isInteger(day)||day<0||day>6)) throw new OpeningError('请选择每周开放日')
  const available=new Set(courts.filter(f=>(venueId===undefined||courtVenueId(f)===venueId) && canScheduleCourt(f)).map(f=>f.id))
  if (!Array.isArray(courtIds)||!courtIds.length||courtIds.some(id=>typeof id!=='string'||!available.has(id))) throw new OpeningError('请从该场馆的可排期场地中选择')
  return {startsOn,endsOn,days:[...new Set<number>(days)].sort(),from,until,courtIds:[...new Set<string>(courtIds)].sort()}
}
export function chinaClock(at:number) {
  const d=new Date(at+8*3600000),stamp=d.toISOString()
  return {date:stamp.slice(0,10),time:stamp.slice(11,16),day:d.getUTCDay()}
}
export function scheduleState(s:Pick<OpeningSchedule,'startsOn'|'endsOn'|'days'|'from'|'until'|'cancelled'>,at:number) {
  const c=chinaClock(at)
  if(s.cancelled)return '已停排'
  if(c.date<s.startsOn)return '待生效'
  if(s.endsOn && c.date>s.endsOn)return '已到期'
  return s.days.includes(c.day)&&c.time>=s.from&&c.time<s.until?'当前时段开放':'当前不在开放时段'
}
// Only project registered court IDs onto the published inventory. Overlapping plans open one court once.
export function applyOpeningSchedules(data:Dataset[],plans:OpeningSchedule[],at:number):Dataset[] {
  const active=plans.filter(s=>scheduleState(s,at)==='当前时段开放')
  if (!active.length) return data
  const byVenue=new Map<string,Map<string,OpeningSchedule[]>>()
  for(const s of active){
    const courts=byVenue.get(s.venueId)??new Map<string,OpeningSchedule[]>()
    for(const id of s.courtIds)courts.set(id,[...(courts.get(id)??[]),s])
    byVenue.set(s.venueId,courts)
  }
  const venues=new Map<string,Set<string>>()
  const courts=data.find(d=>d.id==='courts')
  if(!courts)return data
  const projected=courts.features.map(f=>{
    const venue=courtVenueId(f)
    const plans=byVenue.get(venue)?.get(f.id)
    if (!plans||!canScheduleCourt(f))return f
    const labels=venues.get(venue)??new Set<string>()
    plans.forEach(s=>labels.add('周'+s.days.map(d=>dayNames[d]).join('、')+' '+s.from+'–'+s.until))
    venues.set(venue,labels)
    return {...f,properties:{...f.properties,open:true,status:f.properties.open===true?f.properties.status:'错时开放',scheduledOpening:true,
      scheduledOnly:f.properties.open!==true,openingWindows:plans.map(({days,from,until})=>({days,from,until}))}}
  })
  if(!venues.size)return data
  return data.map(d=>d.id==='courts'?{...d,features:projected}:d.id==='venues'?{...d,features:d.features.map(f=>venues.has(f.id)
    ? {...f,properties:{...f.properties,open:true,currentScheduleHours:[...venues.get(f.id)!].join('；')}}:f)}:d)
}

