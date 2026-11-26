import { chain, type ChainStage, type ChainTopic } from './chain-taxonomy.ts'
import type { DataDocument, Dataset } from './types.ts'

export const cityOutputEstimate = {
  region: '京山市',
  year: 2025,
  amountYiYuan: 35,
} as const

const legacyTopics = {
  器材制造:['球拍','球线','网球'],
  运动服饰:['服装鞋帽'],
  场地建设:['场地材料'],
  场馆运营:['场馆运营'],
  俱乐部运营:['俱乐部'],
  培训陪练:['培训','训练与陪练'],
  赛事组织:['赛事运营'],
  住宿接待:[],
  餐饮服务:[],
  景区游览:['景区温泉'],
  运动康养:['运动康复'],
  购物展销:['网球用品零售','赛事展销与伴手礼'],
} as const satisfies Record<ChainTopic, readonly string[]>

const previousTopics = {
  装备制造:['器材制造','运动服饰'], 场地建设:['场地建设'], 场馆运营:['场馆运营'],
  培训健身:['俱乐部运营','培训陪练'], 赛事组织:['赛事组织'],
  食宿接待:['住宿接待','餐饮服务'], 游览康养:['景区游览','运动康养'], 购物展销:['购物展销'],
} as const satisfies Record<string, readonly ChainTopic[]>
type PreviousTopic = keyof typeof previousTopics

const legacyTopicGroups = {
  装备制造:[...legacyTopics.器材制造, ...legacyTopics.运动服饰],
  场地建设:legacyTopics.场地建设, 场馆运营:legacyTopics.场馆运营,
  培训健身:[...legacyTopics.培训陪练, ...legacyTopics.俱乐部运营], 赛事组织:legacyTopics.赛事组织,
  食宿接待:['住宿餐饮'], 游览康养:[...legacyTopics.景区游览, ...legacyTopics.运动康养],
  购物展销:legacyTopics.购物展销,
} as const satisfies Record<PreviousTopic, readonly string[]>

function chainTopicMembers(stage: ChainStage, raw: string): readonly ChainTopic[] {
  const name = raw.trim()
  const topics = chain.find(item => item.id === stage)?.topics ?? []
  const single = topics.find(topic =>
    topic === name || legacyTopics[topic].some(legacy => legacy === name))
  if (single) return [single]
  const previous = name === '住宿餐饮' || name === '食宿' ? '食宿接待' : name
  if (!Object.hasOwn(previousTopics, previous)) return []
  const members: readonly ChainTopic[] = previousTopics[previous as PreviousTopic]
  return topics.filter(topic => members.includes(topic))
}

type OutputRow = {
  year: number
  stage: ChainStage | null
  topic: string | null
  yuan: number
}

type OutputBasis = 'reported' | 'estimate'
export type IndustryOutput = {
  year: number | null
  years: number[]
  basis: OutputBasis
  sample: boolean
  /** Annual output in 亿元. Null means the scope has no complete figure. */
  amount: (stage?: ChainStage | null, topic?: ChainTopic | null) => number | null
  /** Published combined scope when the selected leaf has no separate return. */
  broaderScope: (stage?: ChainStage | null, topic?: ChainTopic | null) => string | null
}

const previousGroups = Object.keys(previousTopics) as PreviousTopic[]

// Published industry_output records provide {region, year, outputWanYuan,
// chainStage?, chainTopic?}. Each row is the annual total for that exact
// scope, not an enterprise-level observation. Missing stage = whole chain;
// missing topic = stage subtotal. No aggregation across years or regions.
function readStatements(dataset: Dataset, region: string, basis: OutputBasis): OutputRow[] {
  const rows: OutputRow[] = []
  for (const { properties: p } of dataset.features) {
    if (p.region !== region || p.sample === true || p.simulated === true || p.simulation === true) continue
    if ((p.outputBasis ?? 'reported') !== basis) continue
    const year = Number(p.year)
    if (!Number.isInteger(year) || year < 1000 || year > 9999) continue
    if (typeof p.outputWanYuan !== 'number' || !Number.isFinite(p.outputWanYuan) || p.outputWanYuan < 0) continue
    const yuan = Math.round(p.outputWanYuan * 10000)
    if (!Number.isSafeInteger(yuan)) continue
    const stage = chain.find(item => item.id === p.chainStage)
    if (p.chainStage != null && !stage) continue
    const topic = typeof p.chainTopic === 'string' ? p.chainTopic.trim() : p.chainTopic
    if (topic != null && (typeof topic !== 'string' || !stage || !chainTopicMembers(stage.id, topic).length)) continue
    rows.push({ year, stage: stage?.id ?? null, topic: topic ?? null, yuan })
  }
  return rows
}

export function buildIndustryOutput(
  datasets: Dataset[], region: string, _mode: DataDocument['mode'], requestedYear?: number,
  basis: OutputBasis = 'reported',
): IndustryOutput {
  const dataset = datasets.find(layer => layer.id === 'industry_output')
  const rows = dataset ? readStatements(dataset, region, basis) : []
  const years = [...new Set(rows.map(row => row.year))].sort((a,b) => b - a)
  const year = requestedYear ?? years[0] ?? null
  const annual = rows.filter(row => row.year === year)
  const totals = new Map<string, number | null>()
  const key = (stage: ChainStage | null, topic: string | null) => (stage ?? '') + '/' + (topic ?? '')
  for (const row of annual) {
    const id = key(row.stage, row.topic)
    const known = totals.get(id)
    totals.set(id, known === undefined || known === row.yuan ? row.yuan : null)
  }

  // Undefined = unreported (a broader independent return may still exist).
  // Null = conflicting records or an unsafe sum.
  function completeSum(values: (number | null | undefined)[]) {
    if (values.includes(null)) return null
    let sum = 0
    if (!values.length) return undefined
    for (const value of values) {
      if (value == null) return undefined
      sum += value
    }
    return Number.isSafeInteger(sum) ? sum : null
  }

  function leafYuan(stage: ChainStage, topic: ChainTopic) {
    const direct = totals.get(key(stage, topic))
    return direct === undefined
      ? completeSum(legacyTopics[topic].map(detail => totals.get(key(stage, detail))))
      : direct
  }

  function combinedReturn(stage: ChainStage, group: PreviousTopic, parts: (number | null | undefined)[]) {
    // A single legacy category covering the entire group is an equivalent
    // published subtotal (e.g. 住宿餐饮 and 食宿接待). Never allocate it to leaves.
    const legacy = legacyTopicGroups[group]
    const aliases: string[] = legacy.length === 1 ? [group, legacy[0]] : [group]
    if (group === '食宿接待') aliases.push('食宿')
    const name = aliases.find(label => totals.has(key(stage, label)))
    if (!name || parts.includes(null)) return null
    const value = totals.get(key(stage, name))
    if (value == null || aliases.some(label => totals.has(key(stage, label)) && totals.get(key(stage, label)) !== value)) return null
    const known = parts.reduce<number>((sum, part) => sum + (part ?? 0), 0)
    return known <= value ? { name, value } : null
  }

  function amountYuan(stage: ChainStage | null, topic: ChainTopic | null): number | null | undefined {
    if (topic) return stage ? leafYuan(stage, topic) : null
    const direct = totals.get(key(stage, null))
    if (direct !== undefined) return direct
    if (!stage) return completeSum(chain.map(item => amountYuan(item.id, null)))
    const groups = previousGroups.filter(group => chainTopicMembers(stage, group).length)
    return completeSum(groups.map(group => {
      const parts = previousTopics[group].map(node => leafYuan(stage, node))
      const total = completeSum(parts)
      return total === undefined ? combinedReturn(stage, group, parts)?.value : total
    }))
  }

  return {
    year, years, basis, sample: false,
    amount(stage = null, topic = null) {
      const value = amountYuan(stage, topic)
      return value == null ? null : value / 100000000
    },
    broaderScope(stage, topic) {
      if (!stage || !topic || leafYuan(stage, topic) !== undefined) return null
      const group = previousGroups.find(name => previousTopics[name].length > 1 && chainTopicMembers(stage, name).includes(topic))
      if (!group) return null
      const parts = previousTopics[group].map(node => leafYuan(stage, node))
      return combinedReturn(stage, group, parts)?.name ?? null
    },
  }
}

// Use one basis for the entire region/year so every share has a comparable denominator.
export function buildScaleOutput(
  datasets: Dataset[], region: string, mode: DataDocument['mode'], requestedYear?: number,
): IndustryOutput {
  const reported = buildIndustryOutput(datasets, region, mode, requestedYear)
  const estimates = buildIndustryOutput(datasets, region, mode, requestedYear, 'estimate')
  const legacyCity = region === cityOutputEstimate.region
  const years = [...new Set([...reported.years, ...estimates.years, ...(legacyCity ? [cityOutputEstimate.year] : [])])].sort((a,b) => b-a)
  const year = requestedYear ?? years[0] ?? null
  if (year !== null && reported.years.includes(year)) return { ...reported, years }
  if (year !== null && estimates.years.includes(year)) return { ...estimates, years }
  if (legacyCity && year === cityOutputEstimate.year) return {
    ...estimates, year, years,
    amount: (stage, topic) => !stage && !topic ? cityOutputEstimate.amountYiYuan : null,
    broaderScope: () => null,
  }
  return { ...reported, years }
}

export function formatIndustryOutput(amount: number | null): string {
  if (amount === null) return '—'
  if (amount > 0 && amount < 0.0001) return '<0.0001'
  return amount.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
}
