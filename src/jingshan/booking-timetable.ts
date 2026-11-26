import type { CityFeature } from './types.ts'
import type { BookingHourRow } from './venue-booking-analysis.ts'
import { registeredOpeningSpan } from './opening-proposal.ts'
import { canScheduleCourt, courtVenueId, unavailableCourt, type OpeningSchedule } from './opening-schedule.ts'

type Span = [number, number]
type DayOpening = { spans:Span[]; known:boolean }

export const shortCourtName = (name:string, venue:string) =>
  name.match(/\d+\s*号(?:网球)?场/)?.[0] || (name.startsWith(venue) && name.slice(venue.length)) || name

const asMinutes = (time:string) => Number(time.slice(0,2)) * 60 + Number(time.slice(3))
export function minuteTime(total:number) {
  return String(Math.floor(total / 60)).padStart(2,'0') + ':' + String(total % 60).padStart(2,'0')
}

export function openingForDate(court:CityFeature|undefined, date:string, plans:OpeningSchedule[]):DayOpening {
  if (!court) return {spans:[], known:false}
  if (unavailableCourt(court)) return {spans:[], known:true}
  const day = new Date(date + 'T00:00:00Z').getUTCDay()
  const p = court.properties
  const hours = String(p.openingHours || p['开放时段'] || '').trim()
  const mode = p.openMode || p['开放方式']
  const explicitlyClosed = mode === '不开放' || mode === '不开'
  const spans:Span[] = []
  let known = explicitlyClosed
  if (!explicitlyClosed && hours) {
    known = true
    for (const part of hours.split('|')) {
      const span = registeredOpeningSpan(part,day)
      if (span === null) continue
      if (!span || span[0] < 0 || span[0] >= span[1] || span[1] > 1440) known = false
      else spans.push(span)
    }
  }
  if (canScheduleCourt(court)) {
    for (const plan of plans) {
      if (plan.cancelled || date < plan.startsOn || (plan.endsOn && date > plan.endsOn) || !plan.days.includes(day)) continue
      if (plan.venueId === courtVenueId(court) && plan.courtIds.includes(court.id)) {
        spans.push([asMinutes(plan.from), asMinutes(plan.until)])
      }
    }
  }
  const merged:Span[] = []
  for (const span of spans.sort((a,b) => a[0] - b[0])) {
    const last = merged.at(-1)
    if (last && last[1] >= span[0]) last[1] = Math.max(last[1], span[1])
    else merged.push(span)
  }
  return {spans:merged, known}
}

export const slotDisplay = {
  occupied:{label:'已占用', mark:'占'}, partOccupied:{label:'部分占用', mark:'半占'},
  open:{label:'开放', mark:'开'}, partOpen:{label:'部分开放', mark:'半开'}, closed:{label:'未开放', mark:'闭'},
  noOccupancy:{label:'未见占用', mark:'空'}, unknown:{label:'未登记', mark:'—'},
}
export type SlotState = keyof typeof slotDisplay

export function timetableSlot(hour:number,record:BookingHourRow|undefined,opening:DayOpening) {
  const start = hour * 60, end = start + 60
  const spans = opening.spans.filter(([a,b]) => a < end && b > start)
    .map(([a,b]) => [Math.max(a,start), Math.min(b,end)] as Span)
  const openMinutes = spans.reduce((total,[a,b]) => total + b-a, 0)
  const occupiedMinutes = record && record.capacity > 0 ? Math.round(record.occupied * 60) : null
  let state:SlotState
  if (occupiedMinutes !== null && occupiedMinutes > 0) state = occupiedMinutes >= 60 ? 'occupied' : 'partOccupied'
  else if (openMinutes === 60) state = 'open'
  else if (openMinutes > 0) state = 'partOpen'
  else if (opening.known) state = 'closed'
  else state = occupiedMinutes === 0 ? 'noOccupancy' : 'unknown'
  const openingText = spans.length
    ? spans.map(([a,b]) => minuteTime(a) + '–' + minuteTime(b)).join('、')
    : opening.known ? '未开放' : '未登记'
  return {hour, state, occupiedMinutes, openingText}
}
