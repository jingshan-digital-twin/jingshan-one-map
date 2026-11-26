import { chain } from './chain-taxonomy.ts'
import { formId } from './form-designer-id.ts'
import { buildChainCatalog } from './industry-panorama.ts'
import type { CityFeature, Dataset } from './types.ts'

export const ledgerTemplates = [
  { id: 'industry_output', name: '产业年度产值', description: '按行政区、年度填报全链、阶段或单个环节的年度产值，单位为万元。每条记录可选择实报或估算。' },
  { id: 'industry_enterprise_annual', name: '企业年度经营', description: '按企业、年度及环节填报经营情况、规上情况与该环节营收。' },
  { id: 'industry_procurement', name: '实际采购明细', description: '按凭证逐项登记实际采购的品类、供应商、金额和外采原因。' },
] as const
export type LedgerId = typeof ledgerTemplates[number]['id']
export const ledgerTemplate = (id?: string) => ledgerTemplates.find(template => template.id === id)

export function ledgerEnterprises(datasets: Dataset[]) {
  return buildChainCatalog(datasets, '京山市').flatMap(entry => {
    const topics = [...new Set(entry.memberships.flatMap(member => member.topics))]
    if (entry.aboveThreshold && topics.length) {
      const {businessId, name, region} = entry.feature.properties
      return [{id:typeof businessId === 'string' && businessId ? businessId : entry.feature.id, name, region, topics}]
    }
    const business = [entry, ...entry.points].find(point => point.datasetId === 'businesses' &&
      point.feature.properties.sample !== true && point.feature.properties.simulation !== true)
    return business && topics.length ? [{id: business.feature.id, name: business.feature.properties.name,
      region: business.feature.properties.region, topics}] : []
  }).sort((a,b) => a.name.localeCompare(b.name,'zh-CN'))
}

export function newLedgerFeature(id: LedgerId): CityFeature {
  return {
    type: 'Feature', id: id + '-' + formId(),
    geometry: {type:'GeometryCollection', geometries:[]},
    properties: {name:'', region:'', kind:id, ...(id === 'industry_enterprise_annual' ? {sourceStatus:'待核验'} :
      id === 'industry_procurement' ? {verified:false} : {outputBasis:'reported'})},
  }
}

export function outputBasisLabel(basis: unknown) {
  if (basis == null || basis === 'reported') return '实报'
  return basis === 'estimate' ? '估算' : '待核对'
}

export function ledgerPeriod(p: Record<string, unknown>, id: LedgerId) {
  return String((id === 'industry_procurement' ? p.purchasedAt : p.year) ?? '—')
}

export function ledgerRecordName(p: Record<string, unknown>, id: LedgerId, entityName?: string) {
  const detail = id === 'industry_output' ? [p.year, p.chainStage, p.chainTopic ?? (p.chainStage ? '合计' : '全链产值')]
    : id === 'industry_enterprise_annual' ? [p.year, entityName || p.enterpriseId, p.topic]
    : [p.orderId, p.buyer, p.category]
  return detail.filter(Boolean).join(' · ').slice(0, 120)
}

export function validateLedgerEdit(id: LedgerId, p: Record<string, unknown>, enterprises: ReturnType<typeof ledgerEnterprises> = []) {
  function requireText(keys: string[], message: string) {
    if (!keys.every(key => typeof p[key] === 'string' && String(p[key]).trim())) throw new Error(message)
  }
  function amount(key: string, optional: boolean) {
    const raw = p[key]
    if (optional && (raw === null || raw === undefined)) return
    if ((typeof raw !== 'number' && typeof raw !== 'string') || !String(raw).trim() ||
      !Number.isFinite(Number(raw)) || Number(raw) < 0) throw new Error('金额须为非负数')
  }
  if (id !== 'industry_procurement') {
    const year = Number(p.year)
    if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new Error('请填写四位统计年度')
  }
  if (id === 'industry_output') {
    if (p.outputBasis != null && p.outputBasis !== 'reported' && p.outputBasis !== 'estimate') throw new Error('产值口径请选择实报或估算')
    amount('outputWanYuan', false)
    if (p.chainTopic && !p.chainStage) throw new Error('填报环节产值时请先选择所属阶段')
    return
  }
  if (id === 'industry_enterprise_annual') {
    requireText(['enterpriseId','topic'], '请选择统计企业和产业环节')
    const enterprise = enterprises.find(item => item.id === p.enterpriseId)
    if (!enterprise || !enterprise.topics.some(topic => topic === p.topic)) throw new Error('请选择已归入该产业环节的名录企业')
    if (p.region !== '京山市' && enterprise.region !== p.region) throw new Error('行政区应与企业名录的镇街一致，市级报表请选择京山市')
    amount('topicRevenueWan', true)
    if (p.sourceStatus !== '已核验' && p.sourceStatus !== '待核验') throw new Error('请选择核验状态')
    return
  }
  requireText(['purchasedAt','orderId','buyer','category','chainStage','chainTopic','receipt'], '请补全采购日期、订单号、采购方、所属环节、品类和凭证编号')
  const date = String(p.purchasedAt)
  const parsed = Date.parse(date + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0,10) !== date) throw new Error('采购日期无效')
  if (!chain.some(stage => stage.id === p.chainStage && stage.topics.some(topic => topic === p.chainTopic))) throw new Error('采购方的产业阶段与环节不匹配')
  if (p.supplierLocality === '京山市内' || p.supplierLocality === '京山市外') requireText(['supplier'], '请填写已核实属地的供应商名称')
  amount('amountYuan', true)
  if (p.amountYuan != null && !/^\d+(?:\.\d{1,2})?$/.test(String(p.amountYuan))) throw new Error('采购金额请以元填写，最多保留两位小数')
}
