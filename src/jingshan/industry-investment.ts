import type { CityFeature, Dataset, Result } from './types.ts'

export type InvestmentLead = {
  id: string
  name: string
  source: string
  origin: string
  direction: string
  evidence: string
  status: string
  method: string
  siteRequired: boolean
  feature?: CityFeature
  parcelId?: string
}

function value(feature: CityFeature, ...keys: string[]) {
  for (const key of keys) {
    const field = feature.properties[key]
    if (typeof field === 'string' && field.trim()) return field
  }
  return ''
}

export function investmentLeads(datasets: Dataset[], region: string, demo: boolean, includeDefaultExamples = true): InvestmentLead[] {
  const features = datasets.find(item => item.id === 'investment_needs')?.features ?? []
  const scoped = features.filter(item => (region === '京山市' || item.properties.region === region) &&
    (demo || item.properties.sample !== true))
  const published = scoped.map(feature => {
    const supply = feature.properties.supply
    const demand = feature.properties.demand
    const parcelId = value(feature, 'parcelId')
    const siteRequired = typeof feature.properties.siteRequired === 'boolean' ? feature.properties.siteRequired : Boolean(parcelId)
    const evidence = value(feature, 'evidence') || (typeof supply === 'number' && typeof demand === 'number'
      ? '供给 ' + supply.toLocaleString('zh-CN') + '／需求 ' + demand.toLocaleString('zh-CN') : value(feature, 'rationale'))
    return {
      id: feature.id, name: feature.properties.name, source: value(feature, 'source') || '招商需求',
      origin: value(feature, 'origin', 'source') || '招商需求台账', direction: value(feature, 'direction', 'category') || '待明确',
      evidence: evidence || '待补录', status: value(feature, 'status', 'reviewStatus') || '待研判',
      method: value(feature, 'method', 'landingMethod') || '待明确', siteRequired, feature, parcelId,
    }
  })
  if (!demo || !includeDefaultExamples || region !== '京山市') return published
  const demoLeads: InvestmentLead[] = [
    {
      id: 'demo-string-supply', name: '补充球线规格供给', source: '产业全景', origin: '链条诊断',
      direction: '球线配套供应商', evidence: '本地可供 3 种／需求 10 种（演示）', status: '待核实',
      method: '供应商对接', siteRequired: false,
      feature: scoped.find(item => value(item, 'category').includes('器材')),
    },
    {
      id: 'demo-north-courts', name: '新市北片球场增建', source: '服务能力', origin: '人口覆盖与缺口',
      direction: '网球场建设与运营', evidence: '补齐新市北片场地服务（演示）', status: '拟推进',
      method: '场馆建设与运营主体对接', siteRequired: true,
      feature: scoped.find(item => item.properties.parcelId === 'parcel-a'), parcelId: 'parcel-a',
    },
    {
      id: 'demo-lodging', name: '赛事住宿保障', source: '人工录入', origin: '赛事接待线索',
      direction: '住宿保障服务主体', evidence: '大型赛事期间住宿保障需求（演示）', status: '待研判',
      method: '赛事保障合作对接', siteRequired: false,
      feature: scoped.find(item => value(item, 'category') === '住宿'),
    },
  ]
  const referencedIds = new Set(demoLeads.map(item => item.feature?.id))
  return [...demoLeads, ...published.filter(item => !referencedIds.has(item.id))]
}

export type DispatchMaterial = {
  title: string
  direction: string
  evidence: string
  sites: string
  department: string
  assignee: string
  deadline: string
  requirement: string
  enterpriseTypes?: string[]
  demandId?: string
  recordKind?: 'selection' | 'dispatch'
}

export type DispatchPayload = { title: string; department: string; summary: string; features: CityFeature[] }

const materialKeys = ['title', 'direction', 'evidence', 'sites', 'department', 'assignee', 'deadline', 'requirement'] as const

export function encodeDispatch(material: DispatchMaterial) {
  return JSON.stringify({ type: 'investment-dispatch', ...material })
}

export function readDispatch(result: Result): DispatchMaterial {
  try {
    const record: unknown = JSON.parse(result.summary)
    if (record && typeof record === 'object' && 'type' in record && record.type === 'investment-dispatch') {
      const fields = record as Partial<DispatchMaterial>
      if (materialKeys.every(key => typeof fields[key] === 'string')) {
        const material=fields as DispatchMaterial
        return {...material,enterpriseTypes:Array.isArray(material.enterpriseTypes)?material.enterpriseTypes.filter(t=>typeof t==='string'):undefined,
          recordKind:material.recordKind==='selection' || material.recordKind==='dispatch'?material.recordKind:undefined}
      }
    }
  } catch {
    // Older entries store a plain-text report.
  }
  return { title: result.title, direction: '', evidence: '', sites: result.features.map(item => item.properties.name).join('、'),
    department: result.department, assignee: '', deadline: '', requirement: result.summary }
}
