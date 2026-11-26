import {venueCapacity,type VenueCapacityCell} from './venue-capacity.ts'
import {distanceM} from './analytics.ts'
import {canScheduleCourt,unavailableCourt,chinaClock,courtVenueId,type OpeningSchedule} from './opening-schedule.ts'
import {coordinatingOffice} from './service-gaps.ts'
import {OpeningError} from './venue-opening.ts'
import type {CityFeature,Dataset} from './types.ts'

export type WeeklyWindow={days:number[];from:string;until:string}
export type ProposedVenue={id:string;name:string;region:string;courts:{id:string;name:string}[]}
export type OpeningProposal=WeeklyWindow & {batchId:string;signature:string;venues:ProposedVenue[]}
export function weeklyWindow(input:Record<string,unknown>):WeeklyWindow{
  const {days,from,until}=input
  const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/
  if(!Array.isArray(days)||!days.length||days.some(d=>!Number.isInteger(d)||d<0||d>6))throw new OpeningError('请选择每周开放日')
  if(typeof from!=='string'||typeof until!=='string'||!time.test(from)||!(time.test(until)||until==='24:00')||from>=until)throw new OpeningError('请填写有效的同日起止时间')
  return {days:[...new Set<number>(days)].sort(),from,until}
}
const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3))
/** null is a known span on another weekday; undefined means the text is unrecognised. */
export function registeredOpeningSpan(span:string,day:number):[number,number]|null|undefined {
  const match=span.trim().match(/^(?:(周末|双休日?|工作日|每日|每天)\s*)?(\d{1,2}:\d{2})\s*[–—~～至-]\s*(\d{1,2}:\d{2})(?:[（(]错时[）)])?$/)
  if(!match)return undefined
  const clock=/^(?:[01]?\d|2[0-3]):[0-5]\d$/
  if(!clock.test(match[2]) || (!clock.test(match[3]) && match[3]!=='24:00'))return undefined
  if(match[1]==='工作日'&&(day===0||day===6)||/^(周末|双休)/.test(match[1]??'')&&day>0&&day<6)return null
  return [minutes(match[2].padStart(5,'0')),minutes(match[3].padStart(5,'0'))]
}
function registeredWindow(f:CityFeature,day:number,venue?:CityFeature){
  const p=f.properties
  if(p.open!==true||unavailableCourt(f))return []
  const hours=String(p.openingHours || (p.ledgerId ? '' : venue?.properties.openingHours) || '').trim()
  if(!hours) return !p.ledgerId || p.openMode==='全天开放' ? [[0,1440]] : []
  return hours.split('|').flatMap(span=>{
    const window=registeredOpeningSpan(span,day)
    if(window===undefined)return p.ledgerId ? [] : [[0,1440]]
    return window ? [window] : []
  })
}
export function planningInventory(data:Dataset[],plans:OpeningSchedule[],window:WeeklyWindow,today:string){
  const courts=data.find(d=>d.id==='courts')?.features??[]
  const venues=new Map(data.find(d=>d.id==='venues')?.features.map(f=>[f.id,f]))
  const start=minutes(window.from),end=minutes(window.until)
  const slices=new Map<string,{open:Set<string>;duration:number}>()
  const availableMinutes=new Map<string,number>()
  const midnight=Date.parse(today+'T00:00:00+08:00')
  for(let offset=0;offset<7;offset++){
    const {date,day}=chinaClock(midnight+offset*86400000)
    if(!window.days.includes(day))continue
    const spans=new Map(courts.map(f=>[f.id,registeredWindow(f,day,venues.get(courtVenueId(f)))]))
    for(const plan of plans){
      if(plan.cancelled||date<plan.startsOn||plan.endsOn&&date>plan.endsOn||!plan.days.includes(day))continue
      for(const id of plan.courtIds){
        const f=courts.find(row=>row.id===id)
        if(f&&courtVenueId(f)===plan.venueId&&canScheduleCourt(f))spans.get(id)?.push([minutes(plan.from),minutes(plan.until)])
      }
    }
    const cuts=new Set([start,end])
    for(const ranges of spans.values())for(const range of ranges)for(const bound of range)if(bound>start&&bound<end)cuts.add(bound)
    const sorted=[...cuts].sort((a,b)=>a-b)
    for(let i=1;i<sorted.length;i++){
      const t=sorted[i-1],duration=sorted[i]-t
      const open=new Set(courts.filter(f=>spans.get(f.id)?.some(([a,b])=>a<=t&&t<b)).map(f=>f.id))
      for(const id of open)availableMinutes.set(id,(availableMinutes.get(id)??0)+duration)
      const key=JSON.stringify([...open])
      const previous=slices.get(key)
      if(previous)previous.duration+=duration
      else slices.set(key,{open,duration})
    }
  }
  const totalMinutes=(end-start)*window.days.length
  const choices=courts.flatMap(f=>{
    const missing=totalMinutes-(availableMinutes.get(f.id)??0)
    if(!missing||!canScheduleCourt(f)||(end>18*60||start<6*60)&&f.properties.indoor!==true&&f.properties.lighting===false)return []
    const venueId=courtVenueId(f),venue=venues.get(venueId)??f
    const name=String(venue.properties.facilityName||venue.properties.name)
    return [{id:f.id,name:f.properties.name,venueId,venueName:name,region:venue.properties.region,office:coordinatingOffice(venue),
      status:f.properties.open===true?'时段未全开':'未开放',missingMinutes:missing,feature:f}]
  })
  return {choices,slices:[...slices.values()],totalMinutes}
}
export type CourtChoice=ReturnType<typeof planningInventory>['choices'][number]
export function proposalGroups(choices:CourtChoice[]){
  const offices=new Map<string,Map<string,ProposedVenue>>()
  for(const c of choices){
    const group=offices.get(c.office)??new Map<string,ProposedVenue>()
    const venue=group.get(c.venueId)??{id:c.venueId,name:c.venueName,region:c.region,courts:[]}
    venue.courts.push({id:c.id,name:c.name});group.set(c.venueId,venue);offices.set(c.office,group)
  }
  return [...offices].map(([department,venues])=>({department,venues:[...venues.values()]}))
}
export function openingPreview(data:Dataset[],inventory:ReturnType<typeof planningInventory>,selection:Set<string>,rules:Record<string,number>,region:string,gridId?:string){
  const totals={beforeOutside:0,afterOutside:0,beforeUnserved:0,afterUnserved:0,beforeCapacity:0,afterCapacity:0}
  const gapCells=new Map<string,CityFeature>()
  const improvements=new Map<string,CityFeature>()
  const remaining=new Map<string,{cell:VenueCapacityCell;unserved:number;outside:number}>()
  const valid=new Set(inventory.choices.filter(c=>selection.has(c.id)).map(c=>c.id))
  const inventoryFor=(ids:Set<string>)=>venueCapacity(data.map(d=>d.id!=='courts'?d:{...d,features:d.features.map(f=>({...f,properties:{...f.properties,open:ids.has(f.id)}}))}),{mode:'walk',region},rules)
  let radius=0
  for(const slice of inventory.slices){
    const before=inventoryFor(slice.open)
    const after=valid.size?inventoryFor(new Set([...slice.open,...valid])):before
    radius=before.radiusM
    const afterById=new Map(after.capacityCells.map(c=>[c.feature.id,c]))
    const weight=slice.duration/inventory.totalMinutes
    for(const cell of before.capacityCells){
      if(gridId&&cell.feature.id!==gridId)continue
      if(cell.underservedPopulation>0)gapCells.set(cell.feature.id,{...cell.feature,properties:{...cell.feature.properties,color:cell.outsidePopulation?'#e66a55':'#f5a246'}})
      const next=afterById.get(cell.feature.id)!
      totals.beforeOutside+=cell.outsidePopulation*weight;totals.afterOutside+=next.outsidePopulation*weight
      totals.beforeUnserved+=cell.underservedPopulation*weight;totals.afterUnserved+=next.underservedPopulation*weight
      totals.beforeCapacity+=cell.capacityShortfallPopulation*weight;totals.afterCapacity+=next.capacityShortfallPopulation*weight
      if(next.underservedPopulation<cell.underservedPopulation||next.outsidePopulation<cell.outsidePopulation)improvements.set(cell.feature.id,cell.feature)
      if(next.underservedPopulation>0){
        const previous=remaining.get(cell.feature.id)
        remaining.set(cell.feature.id,{cell:next,unserved:(previous?.unserved??0)+next.underservedPopulation*weight,
          outside:(previous?.outside??0)+next.outsidePopulation*weight})
      }
    }
  }
  return {totals,gapCells:[...gapCells.values()],improvements:[...improvements.values()],remaining:[...remaining.values()],radius,
    hours:inventory.choices.filter(c=>valid.has(c.id)).reduce((n,c)=>n+c.missingMinutes/60,0)}
}
export function opportunity(position:[number,number],preview:ReturnType<typeof openingPreview>){
  const nearby=preview.remaining.filter(r=>distanceM(position,r.cell.position)<=preview.radius)
  const population=nearby.reduce((n,r)=>n+r.unserved,0)
  const outside=nearby.reduce((n,r)=>n+r.outside,0)
  return {areas:nearby.length,population:Math.round(population),outside:Math.round(outside),capacity:Math.round(population-outside)}
}

