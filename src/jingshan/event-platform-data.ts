import { eventCalendarStatus, eventVenueNames, isRegisteredCompetition, parseEventDate } from './event-plan-data.ts'
import { withLocalTourismSites } from './tourism-register.ts'
import type { EventCatalog, EventSource, PlannedEvent } from './event-plan-types.ts'
import type { CityFeature, Coordinate, DataDocument, Dataset, FormField } from './types.ts'

export const eventPlanDatasetId = 'event_plans'
const planFields:FormField[] = [
  {key:'year',label:'赛事年度',type:'number',required:true},
  {key:'sequence',label:'年度序号',type:'number'},
  {key:'dateText',label:'计划赛期',type:'text',hint:'例如 5月8日、5月8日至10日、9月26日-10月4日，或仅填 5月'},
  {key:'category',label:'活动类型',type:'select',options:['赛事','活动','培训','考试'],defaultValue:'赛事',required:true},
  {key:'level',label:'赛事级别',type:'text'},
  {key:'status',label:'办赛状态',type:'select',options:['计划中','进行中','已办结'],defaultValue:'计划中',required:true},
  {key:'assessment',label:'纳入赛前研判',type:'boolean',defaultValue:true},
  {key:'participants',label:'计划参赛人数',type:'number'},
  {key:'venueText',label:'举办场馆',type:'text',hint:'多个场馆以顿号分隔'},
  {key:'host',label:'主办单位',type:'text'}, {key:'organizer',label:'承办单位',type:'text'},
  {key:'introduction',label:'赛事简介',type:'textarea'},
  {key:'notesText',label:'数据说明',type:'textarea'},
  {key:'sourceFile',label:'来源文件',type:'text'}, {key:'sourceSheet',label:'来源工作表',type:'text'},
  {key:'sourceRow',label:'来源行号',type:'number'},
]
type PlanCatalog = Pick<EventCatalog,'events'|'checkedAt'|'sourceSummaries'>
type PlanDataset = Dataset & {eventPlanSummaries?:PlanCatalog['sourceSummaries']}
const string = (value:unknown) => typeof value === 'string' ? value.trim() : ''
const number = (value:unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null

export function makeEventPlanDataset(source:PlanCatalog):Dataset {
  const features:CityFeature[] = source.events.map(event => {
    const {id,venueNames,notes,months,startDate,endDate,datePrecision,reportedStatus,...fields}=event
    return {id,type:'Feature',geometry:{type:'GeometryCollection',geometries:[]},properties:{
      ...fields,kind:'event_plan',region:'京山市',venueText:venueNames.join('、'),notesText:notes.join('\n'),status:reportedStatus??'计划中',
    }}
  })
  const dataset:PlanDataset = {
    id:eventPlanDatasetId,name:'赛事引流 · 年度赛事计划',department:'文旅局',category:'赛事引流',
    description:'维护年度赛历、赛事规模、举办场馆和办赛状态。发布后供赛前研判、赛中监测和赛后复盘使用。',
    source:{serviceId:'jingshan_event_plan_register',serviceName:'京山市网球赛事年度计划及整合表',count:features.length,syncedAt:source.checkedAt},
    formSchema:{fields:planFields},eventPlanSummaries:source.sourceSummaries,features,
  }
  return dataset
}

export function checkEventPlanRecord(p:CityFeature['properties']) {
  if (!Number.isSafeInteger(p.year) || Number(p.year)<1900 || Number(p.year)>9999) throw Error('赛事年度须为四位整数')
  for (const [key,label] of [['participants','计划参赛人数'],['sequence','年度序号'],['sourceRow','来源行号']]) {
    if (p[key]!=null && p[key]!=='' && (!Number.isSafeInteger(p[key]) || Number(p[key])<(key==='participants'?0:1))) throw Error(label+'须为有效整数')
  }
  if (string(p.dateText) && parseEventDate(Number(p.year),string(p.dateText)).datePrecision==='unknown')
    throw Error('计划赛期应填写有效的月日或月份范围，如 5月8日至10日、9月26日-10月4日或 5月')
}

function asPlan(f:CityFeature,index:number):PlannedEvent {
  const p=f.properties, year=Number(p.year), dateText=string(p.dateText)
  const dates=parseEventDate(year,dateText)
  const sources:EventSource[]=Array.isArray(p.sources)?p.sources.filter((s):s is EventSource =>
    !!s && typeof s.title==='string' && typeof s.url==='string' && /^https?:\/\//i.test(s.url) && Array.isArray(s.fields)): []
  const point=f.geometry.type==='Point' ? f.geometry.coordinates.slice(0,2) as Coordinate : undefined
  return {id:f.id, name:p.name,year,sequence:number(p.sequence)??index+1,...(point ? {position:point} : {}),
    sourceRow:number(p.sourceRow)??0,sourceFile:string(p.sourceFile)||'后台登记',sourceSheet:string(p.sourceSheet),
    monthText:string(p.monthText)||dates.months.map(n=>n+'月').join('、'),dateText,...dates,
    host:string(p.host)||'无',organizer:string(p.organizer)||'无',participants:number(p.participants),
    level:string(p.level)||'无',category:string(p.category)||'赛事',venueNames:string(p.venueText).split(/[、；;\n]/u).map(s=>s.trim()).filter(Boolean),
    ...(string(p.introduction)?{introduction:string(p.introduction)}:{}),assessment:p.assessment===true,
    ...(p.status==='进行中'||p.status==='已办结'?{reportedStatus:p.status}:{}),
    ...(p.sample===true ? {sample:true} : {}),
    ...(p.cancelled===true || p.status==='已取消' || p.status==='取消' ? {cancelled:true} : {}),
    sources,notes:string(p.notesText).split('\n').filter(Boolean),original:Array.isArray(p.original)?p.original:[],
  }
}

export function publishedEventCatalog(doc:Pick<DataDocument,'datasets'>):PlanCatalog {
  const dataset=doc.datasets.find(d=>d.id===eventPlanDatasetId) as PlanDataset|undefined
  const events=(dataset?.features??[]).map(asPlan)
  const sourceSummaries=[...new Set(events.map(e=>e.year))].sort().map(year=>{
    const rows=events.filter(e=>e.year===year), original=dataset?.eventPlanSummaries?.find(s=>s.year===year)
    const computedParticipants=rows.reduce((n,e)=>n+(e.participants??0),0)
    const declaredParticipants=original?.declaredParticipants??null
    const note=declaredParticipants!==null && declaredParticipants!==computedParticipants
      ? '原表合计 '+declaredParticipants.toLocaleString('zh-CN')+' 人，当前台账逐行合计 '+computedParticipants.toLocaleString('zh-CN')+' 人。' : ''
    return {year,file:[...new Set(rows.map(e=>e.sourceFile))].join('、'),count:rows.length,declaredParticipants,computedParticipants,note}
  })
  return {events,sourceSummaries,checkedAt:dataset?.source?.syncedAt??''}
}

export function publishedCompetitions(datasets:readonly Dataset[]):PlannedEvent[] {
  const plan = datasets.find(dataset => dataset.id === eventPlanDatasetId)
  return (plan?.features ?? []).map(asPlan).filter(isRegisteredCompetition)
}

export function upcomingCompetitions(competitions:readonly PlannedEvent[], today:string):PlannedEvent[] {
  const dateKey = (event:PlannedEvent) => event.startDate ?? `${event.year}-${String(event.months[0]).padStart(2,'0')}`
  return competitions.filter(event => event.months.length && eventCalendarStatus(event,today) === '待开赛')
    .sort((a,b) => dateKey(a).localeCompare(dateKey(b)) || a.sequence - b.sequence)
}

export function completedPlanFeatures(datasets:Dataset[]):CityFeature[] {
  const plans=datasets.find(d=>d.id===eventPlanDatasetId)?.features??[]
  const venues=datasets.find(d=>d.id==='venues')?.features??[]
  return plans.filter(f=>f.properties.status==='已办结').map(f=>{
    const p=f.properties, dates=parseEventDate(Number(p.year),string(p.dateText))
    const venue=string(p.venueText).split('、')[0]
    const place=eventVenueNames(venue).map(name=>venues.find(v=>v.properties.name===name)).find(Boolean)
    return {...f,geometry:f.geometry.type==='GeometryCollection' && place?place.geometry:f.geometry,
      properties:{...p,kind:'event',venue,date:dates.startDate,endDate:dates.endDate,region:place?.properties.region??p.region}}
  })
}
export function eventReviewDocument<T extends Pick<DataDocument,'datasets'>>(data:T):T {
  const layers=withLocalTourismSites(data.datasets)
  const completed=completedPlanFeatures(layers)
  if (!completed.length) return layers === data.datasets ? data : {...data,datasets:layers}
  const layer=layers.find(d=>d.id==='events')
  const events:Dataset={...(layer??{id:'events',name:'赛事',department:'文旅局',category:'赛事引流',description:''}),
    features:[...(layer?.features??[]),...completed]}
  return {...data,datasets:[...layers.filter(d=>d.id!=='events'),events]}
}
