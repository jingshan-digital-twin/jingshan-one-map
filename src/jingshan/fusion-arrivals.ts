import { fusionReturnCities } from './fusion-origin-cities.ts'
import type { CityFeature, Coordinate, Dataset } from './types.ts'

export const fusionArrivalsId = 'form_fusion_arrivals'
type Counts = { people:number|null; vehicles:number|null }
export type FusionOrigin = Counts & { id:string; name:string; share:number|null; position:Coordinate|null }
export interface FusionArrivals extends Counts {
  date:string
  dates:string[]
  reported:boolean
  sample:boolean
  origins:FusionOrigin[]
  sources:string[]
  trend:(Counts & {date:string})[]
}

const totalType = '全市汇总'
const originType = '客源分项'
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const cityKey = (name:string) => name.trim().replace(/市$/u,'')
const count = (n:unknown) => typeof n==='number' && Number.isSafeInteger(n) && n>=0 ? n : null
const counts = (row?:CityFeature):Counts => ({people:count(row?.properties.people), vehicles:count(row?.properties.vehicles)})

export function arrivalRecordKey(p:CityFeature['properties']) {
  return JSON.stringify([p.sample===true,p.reportDate,p.rowType,
    p.rowType===originType && typeof p.originCity==='string' ? cityKey(p.originCity) : ''])
}

export function checkArrivalRecord(p:CityFeature['properties']) {
  if (p.sample!=null && typeof p.sample!=='boolean') throw Error('请选择正式填报或演示数据')
  if (typeof p.sourceName!=='string' || !p.sourceName.trim()) throw Error('请填写日报的数据来源')
  if (typeof p.reportDate!=='string' || !datePattern.test(p.reportDate) || !Number.isFinite(Date.parse(p.reportDate)) ||
      new Date(p.reportDate).toISOString().slice(0,10)!==p.reportDate) throw Error('请填写有效的统计日期')
  if (p.rowType!==totalType && p.rowType!==originType) throw Error('请选择全市汇总或客源分项')
  if (p.rowType===originType && (typeof p.originCity!=='string' || !cityKey(p.originCity))) throw Error('请填写客源地市')
  if (p.rowType===totalType && typeof p.originCity==='string' && p.originCity.trim()) throw Error('全市汇总行的客源地市应留空')
  if (count(p.people)===null && count(p.vehicles)===null) throw Error('请填写来京山人数或车辆数')
  for (const key of ['people','vehicles']) {
    if (p[key]!=null && p[key]!=='' && count(p[key])===null) throw Error('来京山人数和车辆数须为非负整数')
  }
}

function dayBefore(date:string, offset:number) {
  return new Date(Date.parse(date)-offset*86_400_000).toISOString().slice(0,10)
}

/** A city's physical arrivals are reported separately from event attendance and booking-phone origins. */
export function fusionArrivals(datasets:readonly Dataset[], date:string, mode:'demo'|'live'):FusionArrivals {
  const rows = datasets.find(d=>d.id===fusionArrivalsId)?.features ?? []
  const days = new Map<string, {reported:CityFeature[]; demo:CityFeature[]}>()
  for (const row of rows) {
    const p = row.properties
    if (typeof p.reportDate!=='string' || !datePattern.test(p.reportDate) || (p.sample===true && mode!=='demo')) continue
    const bucket = days.get(p.reportDate) ?? {reported:[],demo:[]}
    const series = p.sample===true ? bucket.demo : bucket.reported
    series.push(row)
    days.set(p.reportDate,bucket)
  }
  const dates = [...days.keys()].sort().reverse()
  const selected = date || dates.find(key=>days.get(key)!.reported.length>0) || dates[0] || ''
  const day = days.get(selected)
  const sample = !!day && day.reported.length===0 && day.demo.length>0
  const active = day ? (sample ? day.demo : day.reported) : []
  // The reported city total can include visitors whose origin could not be resolved.
  const total = counts(active.find(row=>row.properties.rowType===totalType))
  const origins = active.flatMap((row):FusionOrigin[] => {
    const p=row.properties
    if (p.rowType!==originType || typeof p.originCity!=='string' || !p.originCity.trim()) return []
    const id=cityKey(p.originCity), metrics=counts(row)
    const source = row.geometry.type==='Point' ? row.geometry.coordinates : undefined
    const position:Coordinate|null = source ? [source[0],source[1]] :
      fusionReturnCities.find(city=>cityKey(city.name)===id)?.position ?? null
    return [{id, name:p.originCity.trim(), ...metrics, position,
      share:metrics.people!==null && total.people!==null && total.people>0 ? metrics.people*100/total.people : null}]
  }).sort((a,b)=>(b.people??-1)-(a.people??-1) || (b.vehicles??-1)-(a.vehicles??-1) || a.name.localeCompare(b.name,'zh-CN'))
  const trend = datePattern.test(selected) && Number.isFinite(Date.parse(selected))
    ? Array.from({length:7},(_,i)=>{
      const key=dayBefore(selected,6-i), bucket=days.get(key)
      const matching = sample ? (bucket?.reported.length ? [] : bucket?.demo) : bucket?.reported
      return {date:key,...counts(matching?.find(row=>row.properties.rowType===totalType))}
    }) : []
  const sources=[...new Set(active.map(row=>row.properties.sourceName).filter((s):s is string=>typeof s==='string' && !!s.trim()))]
  return {date:selected,dates,...total,origins,sources,reported:active.length>0,sample,trend}
}
