import { chain } from './chain-taxonomy.ts'
import { completedPlanFeatures } from './event-platform-data.ts'
import { eventReviewObservations } from './event-review-observations.ts'
import { arrivalRecordKey, checkArrivalRecord, fusionArrivalsId } from './fusion-arrivals.ts'
import { ledgerEnterprises, ledgerTemplate, ledgerTemplates, validateLedgerEdit } from './industry-ledgers.ts'
import type { CityFeature, Dataset, FormField } from './types.ts'

type Entry = CityFeature['properties']
export type DisplayField = FormField & { integer?: boolean; max?: number; min?: number }
const num = (key: string, label: string, integer = true, max?: number): DisplayField =>
  ({key, label, type:'number', min:0, max, integer})
const operationalForms = [
  {id:'venue_operations', name:'场馆月度运营', description:'按场馆和月份登记预约时长、开放场地及使用率。', department:'文旅局',
    sourceId:'venues', linkKey:'venueId', linkLabel:'场馆', kind:'venue_operation',
    fields: [
      {key:'month', label:'统计月份', type:'text', required:true}, num('bookings','预约笔数'),
      num('bookedHours','预约时长（小时）',false), num('availableHours','可用时长（小时）',false),
      num('usedHours','实际使用时长（小时）',false), num('utilization','登记利用率（%）',false,100), num('freeCourts','空闲场地（片）'),
      num('openCourts','开放场地（片）'), num('scheduledCourts','错时开放场地（片）'),
      num('servicePopulation','服务人口'), {key:'updatedAt',label:'统计日期',type:'date'},
    ] as DisplayField[]},
  {id:'event_actuals', name:'赛后实绩', description:'按赛事登记参赛观赛人次、消费、保障缺口及任务完成情况。', department:'文旅局',
    sourceId:'events', linkKey:'eventId', linkLabel:'赛事', kind:'event_actual',
    fields: [
      {key:'confirmedAt',label:'核对日期',type:'date',required:true},
      num('attendance','实际参与人次'),num('forecastAttendance','预计参与人次'),num('visitors','外地人次'),
      num('spend','带动消费（万元）',false),num('parkingGap','实际停车缺口'),num('forecastParkingGap','预计停车缺口'),
      num('bedGap','实际床位缺口'),num('forecastBedGap','预计床位缺口'),num('tasksTotal','保障任务数'),
      num('tasksCompleted','已完成任务数'),num('originCount','客源样本人次'),
      num('players','实际参赛人数'),num('spectators','实际观众人数'),num('occupancyPeak','入住峰值（%）',false,100),
      num('scenicVisitors','景区到访人次'),num('nights','住宿间夜'),num('diningVisits','餐饮消费人次'),num('returnIntent','二次出游意向人数'),
      num('satisfaction','综合满意度（%）',false,100),num('trafficScore','交通组织评分',false,100),num('medicalScore','医疗保障评分',false,100),
      num('volunteersScore','志愿服务评分',false,100),num('emergencyScore','应急处置评分',false,100),
      {key:'destinationsJson',label:'消费去向明细',type:'textarea',hint:'例如 [{"group":"scenic","dataset":"tourism","id":"景区要素编号","visits":120}]。分类支持 scenic、dining、lodging、other，可用 name 填写未定位地点。'},
      {key:'trendJson',label:'每日客流明细',type:'textarea',hint:'例如 [{"date":"2026-11-24","event":120,"tourism":30}]。event 为赛事客流，tourism 为文旅客流。'},
      {key:'sourceStatus',label:'核验状态',type:'text'},
    ] as DisplayField[]},
] as const
export const platformFormTemplates = [
  ...ledgerTemplates.map(item => ({...item, department:'产业主管部门', category:'产业链诊断'})),
  ...operationalForms.map(item => ({...item, category:'运营统计'})),
]
export const operationalForm = (id:string) => operationalForms.find(item => item.id === id)
export function operationalRecordSources(datasets:Dataset[], formId:string) {
  const form=operationalForm(formId)
  if (!form) return []
  const current=datasets.find(d=>d.id===form.sourceId)?.features??[]
  return formId==='event_actuals' ? [...current,...completedPlanFeatures(datasets)] : current
}
export const isPlatformFormDataset = (dataset: Dataset) =>
  !!dataset.formSchema || platformFormTemplates.some(template => template.id === dataset.id)

export const formFieldTypes = {
  text:'短文本', textarea:'长文本', number:'数值', date:'日期', select:'单选', multiselect:'多选', boolean:'是 / 否',
}
const reserved = new Set(['name','kind','region','id','sample','simulation','simulated','sourceServiceId','sources',
  ...Object.getOwnPropertyNames(Object.prototype), 'prototype', '__proto__'])
const object = (v:unknown): v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const shortText = (v:unknown, max:number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !v.includes('\0')

export function checkFormSchema(schema:unknown): asserts schema is {fields:FormField[]} {
  if (!object(schema) || !Array.isArray(schema.fields) || !schema.fields.length || schema.fields.length > 60)
    throw new Error('自定义表单需要 1 至 60 个字段')
  const keys = new Set<string>(), labels = new Set<string>()
  for (const f of schema.fields) {
    if (!object(f) || typeof f.key !== 'string' || !/^[a-z][a-zA-Z0-9_]{0,63}$/.test(f.key) ||
        reserved.has(f.key) || keys.has(f.key)) throw new Error('字段标识须以小写字母开头，且不能使用重复或保留标识')
    if (!shortText(f.label,60) || labels.has(f.label.trim())) throw new Error('请填写不同的字段名称，每项最多 60 字')
    if (typeof f.type !== 'string' || !Object.hasOwn(formFieldTypes,f.type) ||
        (f.required !== undefined && typeof f.required !== 'boolean')) throw new Error(f.label+' 的字段类型或必填设置有误')
    if ((f.type === 'select' || f.type === 'multiselect') && (!Array.isArray(f.options) || !f.options.length || f.options.length > 100 ||
      !f.options.every(v => shortText(v,120) && v === v.trim()) || new Set(f.options).size !== f.options.length))
      throw new Error(f.label+' 需要 1 至 100 个不重复的选项')
    if ((f.unique !== undefined && typeof f.unique !== 'boolean') || (f.hint !== undefined && (typeof f.hint !== 'string' || f.hint.length > 180)))
      throw new Error(f.label+' 的唯一性或提示文字设置有误')
    if (f.defaultValue !== undefined) checkFormValues([f as FormField], {name:'',region:'',kind:'', [f.key]:f.defaultValue})
    keys.add(f.key); labels.add(f.label.trim())
  }
}

function validDate(raw:unknown) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false
  const d = new Date(raw+'T00:00:00Z')
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === raw
}
export function checkFormValues(fields: DisplayField[], p: Entry) {
  for (const f of fields) {
    const v = p[f.key]
    if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) {
      if (f.required) throw new Error('请填写'+f.label)
      continue
    }
    if (f.type === 'number' && (typeof v !== 'number' || !Number.isFinite(v) || (f.integer && !Number.isSafeInteger(v)) ||
      (f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max))) throw new Error(f.label+' 的数值或范围有误')
    if (f.type === 'boolean' && typeof v !== 'boolean') throw new Error(f.label+' 请选择是或否')
    if (f.type === 'date' && !validDate(v)) throw new Error(f.label+' 需要有效日期')
    if (f.type === 'select' && (typeof v !== 'string' || !f.options?.includes(v))) throw new Error(f.label+' 的值不在备选项中')
    if (f.type === 'multiselect' && (!Array.isArray(v) || (f.required && !v.length) || new Set(v).size !== v.length || !v.every(item=>typeof item === 'string' && f.options?.includes(item))))
      throw new Error(f.label+' 请选择有效且不重复的选项')
    if ((f.type === 'text' || f.type === 'textarea') && !shortText(v,f.type === 'text' ? 500 : 10000)) throw new Error(f.label+' 的文字过长或格式有误')
  }
}

export function formRecordKey(id:string,p:Entry) {
  switch (id) {
    case fusionArrivalsId: return arrivalRecordKey(p)
    case 'industry_output': return JSON.stringify([p.year,p.region,p.chainStage??'',p.chainTopic??'',p.outputBasis??'reported'])
    case 'industry_enterprise_annual': return JSON.stringify([p.year,p.enterpriseId,p.topic,p.region])
    case 'venue_operations': return JSON.stringify([p.venueId,p.month])
    case 'event_actuals': return JSON.stringify([p.eventId])
    default: return undefined
  }
}

export function checkPlatformRecord(dataset:Dataset, feature:CityFeature, datasets:Dataset[], enterprises?:ReturnType<typeof ledgerEnterprises>) {
  const p = feature.properties, ledger = ledgerTemplate(dataset.id), op = operationalForm(dataset.id)
  if (dataset.id===fusionArrivalsId) checkArrivalRecord(p)
  if (dataset.formSchema) { checkFormValues(dataset.formSchema.fields,p); return }
  if (ledger) {
    validateLedgerEdit(ledger.id,p,enterprises ?? (ledger.id === 'industry_enterprise_annual' ? ledgerEnterprises(datasets) : []))
    if (ledger.id === 'industry_output' && p.chainStage && !chain.some(s=>s.id === p.chainStage)) throw new Error('请选择有效的产值阶段')
    return
  }
  if (!op) return
  checkFormValues(op.fields,p)
  if(op.id==='event_actuals') eventReviewObservations(p)
  if (!op.fields.some(f=>f.type === 'number' && typeof p[f.key] === 'number'))
    throw new Error('请至少填写一项统计指标')
  if (!operationalRecordSources(datasets,op.id).some(item => item.id === p[op.linkKey]))
    throw new Error('请选择已有'+op.linkLabel)
  if (op.id === 'venue_operations' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(p.month))) throw new Error('统计月份格式应为 YYYY-MM')
  if (typeof p.tasksTotal === 'number' && typeof p.tasksCompleted === 'number' && p.tasksCompleted > p.tasksTotal)
    throw new Error('已完成任务数不能超过保障任务数')
}

export function checkFormRowChanges(dataset:Dataset, before:Dataset|undefined, datasets:Dataset[], equal:(a:unknown,b:unknown)=>boolean) {
  const oldRows=new Map(before?.features.map(row=>[row.id,row]))
  const counts=new Map<string,number>()
  for (const row of dataset.features) {
    const key=formRecordKey(dataset.id,row.properties)
    if (key!==undefined) counts.set(key,(counts.get(key)??0)+1)
  }
  let enterprises:ReturnType<typeof ledgerEnterprises>|undefined
  for (const row of dataset.features) {
    const original=oldRows.get(row.id)
    if (equal(original,row)) continue
    if (dataset.id==='industry_enterprise_annual') enterprises ??= ledgerEnterprises(datasets)
    try {
      checkPlatformRecord(dataset,row,datasets,enterprises)
      const key=formRecordKey(dataset.id,row.properties)
      if (key!==undefined && (counts.get(key)??0)>1 && (!original || formRecordKey(dataset.id,original.properties)!==key))
        throw new Error('已存在相同统计对象和周期的记录')
    } catch (e) {
      throw new Error(row.id+'：'+(e instanceof Error?e.message:'表单记录格式有误'))
    }
  }
}
