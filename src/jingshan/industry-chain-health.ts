import { chain, type ChainStage, type ChainTopic } from './chain-taxonomy.ts'
import { chainDiagnosis, type CatalogEnterprise } from './industry-panorama.ts'
import { diagnoseProcurement } from './industry-procurement.ts'
import { diagnoseStructure } from './industry-structure.ts'
import type { Dataset } from './types.ts'

export type ChainHealthStatus = 'weak' | 'candidate' | 'unassessed' | 'covered'

// Citywide markings from the reference diagram. A verified local benchmark
// supersedes the city preset. Other regions use their own assessments.
const cityDiagramWeakTopics = new Set<ChainTopic>(['运动服饰', '俱乐部运营', '运动康养'])

export function panoramaWeakTopics(datasets: Dataset[], region: string): ReadonlySet<ChainTopic> {
  return new Set(chain.flatMap(stage => stage.topics.filter(topic => {
    if (topic === '场馆运营') return false
    const record = chainDiagnosis(datasets, stage.id, topic, false, region)
    if (record.verified && record.coverage !== undefined && record.threshold !== undefined) return record.weak
    return region === '京山市' && cityDiagramWeakTopics.has(topic)
  })))
}

export type ChainHealthNode = {
  stage: ChainStage
  topic: ChainTopic
  count: number
  enterpriseNames: string[]
  status: ChainHealthStatus
  label: string
  signal: string
  reason: string
  nextCheck: string
}

/** Compare the latest published supply assessment and actual procurement with the current regional directory. */
export function buildChainHealth(datasets: Dataset[], catalog: CatalogEnterprise[], region: string): ChainHealthNode[] {
  const directory = catalog.filter(({ feature: { properties } }) =>
    properties.simulation !== true && properties.simulated !== true)
  const structure = diagnoseStructure(directory, null, null)
  const purchasing = diagnoseProcurement(datasets, { region, stage: null, topic: null, year: null })

  return structure.topics.map(node => {
    const { stage, topic, count, enterpriseNames, nextCheck, reason } = node
    const base = { stage, topic, count, enterpriseNames, nextCheck }
    const specs = chainDiagnosis(datasets, stage, topic, false, region)
    const hasBenchmark = specs.coverage !== undefined && specs.threshold !== undefined
    const benchmark = (specs.period === '未记录' ? '' : specs.period + '，') +
      '本地供给覆盖 ' + specs.coverage + '% 的需求规格，台账阈值为 ' + specs.threshold + '%。'

    if (specs.verified && specs.weak) {
      return { ...base, status: 'weak', label: '弱链', signal: '供给覆盖 ' + specs.coverage + '%，低于 ' + specs.threshold + '%', reason: benchmark }
    }
    const purchase = purchasing.review.find(row => row.topic === topic && row.repeatedSupplyConstraint)
    const constraint = purchase?.repeatedSupplyConstraint
    if (purchase && constraint) {
      return { ...base, status: 'candidate', label: '弱链线索', signal: constraint.months + ' 个月外采受本地供给限制',
        reason: purchase.buyer + '采购“' + purchase.category + '”时，有 ' + constraint.months +
          ' 个月的独立外采订单记录了本地供给限制。' + purchasing.year + ' 年订单原因为“' + constraint.reasons.join('、') + '”。',
        nextCheck: constraint.action }
    }
    if (specs.weak) {
      return { ...base, status: 'candidate', label: '弱链线索', signal: '规格供给偏低，待核验', reason: benchmark + '这项供需记录尚待核验。' }
    }
    if (specs.verified && hasBenchmark) {
      return { ...base, status: 'covered', label: '规格达标', signal: '本地规格覆盖达标', reason: benchmark }
    }
    if (count === 1 || node.status === '投产待核') {
      return { ...base, status: 'candidate', label: '弱链线索', signal: node.status === '投产待核' ? '项目投产待核' : '名录仅收录 1 家', reason }
    }
    return { ...base, status: 'unassessed', label: '待核实', signal: node.status, reason }
  })
}
