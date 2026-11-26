import type {CityFeature} from './types.ts'

type Values = CityFeature['properties']
const record=(value:unknown):Record<string,unknown> => value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : {}
const nonnegative=(value:unknown)=>typeof value==='number' && Number.isFinite(value) && value>=0

function observationRows(value:unknown,key:'destinations'|'trend') {
  if(typeof value!=='string' || !value.trim())return
  const label=key==='trend'?'每日客流':'消费去向'
  let rows:unknown
  try { rows=JSON.parse(value) } catch { throw Error(label+'须填写 JSON 数组') }
  if(!Array.isArray(rows))throw Error(label+'须填写 JSON 数组')
  rows.forEach((row,i)=>{
    const r=record(row)
    const valid=key==='trend'
      ? typeof r.date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && new Date(r.date).toJSON()?.slice(0,10)===r.date &&
        (r.event==null||nonnegative(r.event)) && (r.tourism==null||nonnegative(r.tourism)) && (r.event!=null||r.tourism!=null)
      : ['scenic','dining','lodging','other'].includes(String(r.group)) && nonnegative(r.visits) &&
        (typeof r.name==='string'&&!!r.name.trim() || typeof r.dataset==='string'&&!!r.dataset.trim() && typeof r.id==='string'&&!!r.id.trim())
    if (!valid) throw Error(label+'第 '+(i+1)+' 条资料不完整或数值无效')
  })
  return rows
}

export function eventReviewObservations(actual?:Values, example?: Record<string,unknown>) {
  const saved=record(actual?.postReview)
  const defaults = actual && Object.hasOwn(actual,'postReview') && !Object.keys(saved).length ? {} : example
  const result={...defaults,...saved}
  if (!actual) return result
  for(const key of ['satisfaction','diningVisits','returnIntent']){
    if (Object.hasOwn(actual,key)) result[key]=actual[key]
  }
  const scores = Object.hasOwn(saved,'scores') && !Object.keys(record(saved.scores)).length ? {}
    : {...record(defaults?.scores),...record(saved.scores)}
  for (const key of ['traffic','medical','volunteers','emergency']) {
    if(Object.hasOwn(actual,key+'Score'))scores[key]=actual[key+'Score']
  }
  result.scores=scores
  for(const key of ['destinations','trend'] as const) {
    const printable=actual[key+'Json']
    const parsed=observationRows(printable,key)
    if(Object.hasOwn(actual,key+'Json'))result[key]=parsed ?? []
  }
  return result
}
