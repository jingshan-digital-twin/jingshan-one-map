import { chain, type ChainStage, type ChainTopic } from './chain-taxonomy.ts'
import { buildIndustryOutput, buildScaleOutput, cityOutputEstimate, formatIndustryOutput } from './industry-output.ts'
import type { DataDocument, Dataset } from './types.ts'

function groupShares(parent: number | null, parts: (number | null)[]) {
  const reported = parts.filter((part): part is number => part !== null)
  const sumYuan = reported.reduce((sum, part) => sum + Math.round(part * 1e8), 0)
  const parentYuan = parent === null ? null : Math.round(parent * 1e8)
  const inconsistent = parentYuan !== null && (sumYuan > parentYuan ||
    (reported.length === parts.length && sumYuan !== parentYuan))
  return {
    inconsistent,
    shares: parts.map(part => !inconsistent && part !== null && parent !== null && parent > 0
      ? part / parent * 100 : null),
  }
}

export type EconomyRow = {
  name: string
  stage: ChainStage | null
  topic: ChainTopic | null
  current: number | null
  previous: number | null
  share: number | null
  previousShare: number | null
  delta: number | null
  rate: number | null
  shareChange: number | null
  combined: string | null
}

function compare(
  name: string, stage: ChainStage | null, topic: ChainTopic | null,
  current: number | null, previous: number | null, share: number | null = null,
  previousShare: number | null = null, combined: string | null = null,
): EconomyRow {
  const delta = current !== null && previous !== null
    ? (Math.round(current * 1e8) - Math.round(previous * 1e8)) / 1e8 : null
  return {
    name, stage, topic, current, previous, share, previousShare, combined, delta,
    rate: delta !== null && previous !== null && previous > 0 ? delta / previous * 100 : null,
    shareChange: share !== null && previousShare !== null ? share - previousShare : null,
  }
}

export function analyzeIndustryEconomy(
  datasets: Dataset[], region: string, mode: DataDocument['mode'], requestedYear: number | null, section: 'scale' | 'growth',
) {
  const current = section === 'scale'
    ? buildScaleOutput(datasets, region, mode, requestedYear ?? undefined)
    : buildIndustryOutput(datasets, region, mode, requestedYear ?? undefined)
  const year = current.year ?? (region === cityOutputEstimate.region ? cityOutputEstimate.year : null)
  const previousYear = year === null ? null : year - 1
  const previous = section === 'growth' && previousYear !== null ? buildIndustryOutput(datasets, region, mode, previousYear) : null
  const total = current.amount()
  const previousTotal = previous?.amount() ?? null
  const stageValues = chain.map(stage => current.amount(stage.id))
  const previousStageValues = chain.map(stage => previous?.amount(stage.id) ?? null)
  const stageShares = groupShares(total, stageValues)
  const previousStageShares = groupShares(previousTotal, previousStageValues)
  return {
    year, previousYear,
    hasCurrent: current.basis === 'reported' && year !== null && current.years.includes(year),
    hasPrevious: previousYear !== null && previous?.years.includes(previousYear) === true,
    total: compare('全产业链', null, null, total, previousTotal),
    estimated: current.basis === 'estimate',
    inconsistent: stageShares.inconsistent,
    stages: chain.map((stage, i) => {
      const nodeValues = stage.topics.map(topic => current.amount(stage.id, topic))
      const previousNodeValues = stage.topics.map(topic => previous?.amount(stage.id, topic) ?? null)
      const shares = groupShares(stageValues[i], nodeValues)
      const previousShares = groupShares(previousStageValues[i], previousNodeValues)
      return {
        stage: stage.id, title: stage.title, inconsistent: shares.inconsistent,
        row: compare(stage.id, stage.id, null, stageValues[i], previousStageValues[i], stageShares.shares[i], previousStageShares.shares[i]),
        nodes: stage.topics.map((topic, j) => compare(topic, stage.id, topic,
          nodeValues[j], previousNodeValues[j], shares.shares[j], previousShares.shares[j],
          current.broaderScope(stage.id, topic))),
      }
    }),
  }
}

export function formatPercent(value: number, signed = false) {
  if (value === 0) return '0'
  const magnitude = Math.abs(value)
  const text = magnitude < 0.1 ? '<0.1' : magnitude.toLocaleString('zh-CN', {maximumFractionDigits: 1})
  return (value < 0 ? '−' : signed ? '+' : '') + text
}

export function formatChange(value: number) {
  return (value > 0 ? '+' : value < 0 ? '−' : '') + formatIndustryOutput(Math.abs(value))
}

export function scaleFinding(rows: EconomyRow[]) {
  const comparable = rows.filter(row => row.current !== null)
  if (!comparable.length) return ''
  const top = Math.max(...comparable.map(row => row.current!))
  if (top === 0) return ''
  const leaders = comparable.filter(row => row.current === top)
  const share = leaders[0].share
  const scope = comparable.length === rows.length ? '' : '在已单列产值的' + comparable.length + '项中，'
  return scope + leaders.map(row => row.name).join('、') + (leaders.length > 1 ? '并列' : '') +
    '居首，' + (leaders.length > 1 ? '各' : '') + '为 ' + formatIndustryOutput(top) + ' 亿元' +
    (share === null ? '' : '，占' + (leaders[0].topic ? '所属阶段' : '全链') + '的 ' + formatPercent(share) + '%') + '。'
}

export function growthFinding(rows: EconomyRow[]) {
  const comparable = rows.filter(row => row.delta !== null)
  if (!comparable.length) return ''
  const names = (group: EconomyRow[]) => group.map(row => row.name).join('、')
  const max = Math.max(...comparable.map(row => row.delta!))
  const scope = comparable.length < rows.length ? '已取得连续两年数据的' + comparable.length + '项中，' : ''
  if (max <= 0) {
    const min = Math.min(...comparable.map(row => row.delta!))
    if (min === 0) return scope + '各项产值均与上年持平。'
    const losses = comparable.filter(row => row.delta === min)
    return scope + names(losses) + (losses.length > 1 ? '各' : '') + '减少 ' +
      formatIndustryOutput(Math.abs(min)) + ' 亿元，降额最大。'
  }
  const leaders = comparable.filter(row => row.delta === max)
  let finding = scope + names(leaders) + (leaders.length > 1 ? '各' : '') + '增加 ' +
    formatIndustryOutput(max) + ' 亿元，增量最大。'
  const positive = comparable.filter(row => row.rate !== null && row.rate > 0)
  if (!positive.length) return finding
  const highest = Math.max(...positive.map(row => row.rate!))
  const fastest = positive.filter(row => row.rate === highest)
  finding += names(fastest) + '同比增长 ' + formatPercent(highest) + '%，增速最快。'
  if (fastest.length === 1 && leaders.length === 1 && fastest[0].previous! < leaders[0].previous! && fastest[0] !== leaders[0]) {
    finding += fastest[0].name + '上年产值为 ' + formatIndustryOutput(fastest[0].previous) +
      ' 亿元，低于' + leaders[0].name + '的 ' + formatIndustryOutput(leaders[0].previous) + ' 亿元。'
  }
  return finding
}
