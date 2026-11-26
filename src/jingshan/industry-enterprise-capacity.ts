import { chain, type ChainStage, type ChainTopic } from './chain-taxonomy.ts'
import { commerceChainTopics, scopeEnterprises, type CatalogEnterprise } from './industry-panorama.ts'
import type { DataDocument, Dataset } from './types.ts'

export const enterpriseAnnualId = 'industry_enterprise_annual'

type Status = boolean | null
type AnnualEntry = {
  year: number
  enterpriseId: string
  topic: ChainTopic
  operating: Status
  aboveScale: Status
  revenue: number | null
}
type Member = {
  entry: CatalogEnterprise
  operating: Status
  aboveScale: Status
  revenue: number | null
}

// The ledger references the registered business ID, or the commerce row for a newly listed enterprise.
// topicRevenueWan is revenue allocated to this topic, in 万元 for the selected year.
function annualRecords(datasets: Dataset[], region: string) {
  const rows: AnnualEntry[] = []
  const topics = new Set<string>(chain.flatMap(part => [...part.topics]))
  for (const { properties: p } of datasets.find(layer => layer.id === enterpriseAnnualId)?.features ?? []) {
    if (typeof p.year !== 'number' || !Number.isInteger(p.year) || p.year < 1000 || p.year > 9999 ||
      p.sourceStatus !== '已核验' || p.sample === true || p.simulation === true || p.simulated === true ||
      typeof p.enterpriseId !== 'string' || !p.enterpriseId.trim() || typeof p.topic !== 'string' || !topics.has(p.topic) ||
      (region !== '京山市' && p.region !== region)) continue
    const record = {
      year: p.year,
      enterpriseId: p.enterpriseId,
      topic: p.topic as ChainTopic,
      operating: typeof p.operating === 'boolean' ? p.operating : null,
      aboveScale: typeof p.aboveScale === 'boolean' ? p.aboveScale : null,
      revenue: typeof p.topicRevenueWan === 'number' && Number.isFinite(p.topicRevenueWan) && p.topicRevenueWan >= 0
        ? p.topicRevenueWan : null,
    }
    if (record.operating !== null || record.aboveScale !== null || record.revenue !== null) rows.push(record)
  }
  return rows
}

export function enterpriseAnnualYears(datasets: Dataset[], region: string): number[] {
  return [...new Set(annualRecords(datasets, region).map(row => row.year))].sort((a,b) => b-a)
}

// Identical reports agree. Conflicting values stay unknown pending reconciliation.
function agreed<T>(values: (T | null)[]): T | null {
  const distinct = new Set(values.filter((value): value is NonNullable<T> => value !== null))
  return distinct.size === 1 ? [...distinct][0] : null
}

function countMetric(flags: Status[]) {
  return { yes: flags.filter(value => value === true).length,
    verified: flags.filter(value => value !== null).length, total: flags.length }
}

export function formatCapacityCount(metric: ReturnType<typeof countMetric>) {
  if (!metric.verified) return '待核'
  if (metric.verified === metric.total) return String(metric.yes)
  return metric.yes ? '≥' + metric.yes : '待核'
}

function activeAboveScale(member: Member): Status {
  if (member.operating === false || member.aboveScale === false) return false
  return member.operating === true && member.aboveScale === true ? true : null
}

function enterpriseReports(rows: CatalogEnterprise[], annual: AnnualEntry[], year: number | null) {
  const records = new Map<string, AnnualEntry[]>()
  for (const record of annual) {
    if (record.year !== year) continue
    const group = records.get(record.enterpriseId) ?? []
    group.push(record)
    records.set(record.enterpriseId, group)
  }
  return new Map(rows.map(entry => {
    const ids = new Set<string>()
    for (const source of [entry, ...entry.points]) {
      if (source.datasetId === 'businesses' || commerceChainTopics[source.datasetId]) ids.add(source.feature.id)
      for (const id of [source.feature.properties.enterpriseId, source.feature.properties.businessId,
        source.datasetId === 'merchants' && source.feature.properties.sourceId]) {
        if (typeof id === 'string' && id) ids.add(id)
      }
    }
    const entries = [...ids].flatMap(id => records.get(id) ?? [])
    return [entry.key, { entries, aboveScale: agreed(entries.map(record => record.aboveScale)) }] as const
  }))
}

// The overview counts distinct enterprises in either official register.
export function aboveScaleOrThresholdCount(datasets: Dataset[], rows: CatalogEnterprise[], region:string) {
  const directory = rows.filter(({feature:{properties:p}}) => !p.sample && !p.simulation && !p.simulated)
  const annual = annualRecords(datasets,region)
  const latestYear = annual.reduce((max,entry) => Math.max(max,entry.year),0)
  const reports = enterpriseReports(directory,annual,latestYear)
  return new Set(directory.filter(entry => {
    const report = reports.get(entry.key)!
    const aboveScale = report.entries.some(row => row.aboveScale !== null) ? report.aboveScale : entry.feature.properties.aboveScale
    return entry.aboveThreshold || aboveScale === true
  }).map(entry=>entry.key)).size
}

export function enterpriseCapacity(
  datasets: Dataset[], rows: CatalogEnterprise[], region: string, _mode: DataDocument['mode'],
  year: number | null, stage: ChainStage | null, topic: ChainTopic | null,
) {
  const directory = scopeEnterprises(rows.filter(row => row.feature.properties.sample !== true &&
    row.feature.properties.simulation !== true && row.feature.properties.simulated !== true), stage, topic)
  const unique = [...new Map(directory.map(entry => [entry.key, entry])).values()]
  const ledger = enterpriseReports(unique, annualRecords(datasets,region), year)
  const nodes = chain.filter(item => !stage || stage === item.id).flatMap(part =>
    part.topics.filter(name => !topic || topic === name).map(name => {
      const members: Member[] = scopeEnterprises(unique, part.id, name).map(entry => {
        const report = ledger.get(entry.key)!
        const annual = report.entries.filter(record => record.topic === name)
        const revenue = agreed(annual.map(record => record.revenue))
        let operating = agreed(annual.map(record => record.operating))
        if (operating === false && annual.some(record => record.revenue !== null && record.revenue > 0)) operating = null
        return { entry, operating, aboveScale: report.aboveScale, revenue }
      })
      const actual = countMetric(members.map(row => row.operating))
      const scaled = countMetric(members.map(activeAboveScale))
      const reported = members.filter((row): row is Member & { revenue: number } => row.operating === true && row.revenue !== null)
        .sort((a, b) => b.revenue - a.revenue || a.entry.feature.properties.name.localeCompare(b.entry.feature.properties.name, 'zh-CN'))
      const complete = actual.total > 0 && actual.verified === actual.total && actual.yes === reported.length
      const sum = reported.reduce((total, row) => total + row.revenue, 0)
      const share = (count: number) => complete && sum > 0
        ? reported.slice(0, count).reduce((total, row) => total + row.revenue, 0) * 100 / sum : null
      return { stage: part.id, topic: name, members, actual, scaled, reported, complete, sum,
        firstShare: share(1), threeShare: share(3) }
    }))
  const statuses = new Map<string, Status[]>()
  for (const node of nodes) {
    for (const member of node.members) {
      const flags = statuses.get(member.entry.key) ?? []
      flags.push(member.operating)
      statuses.set(member.entry.key, flags)
    }
  }
  const scoped = unique.map(entry => {
    const flags = statuses.get(entry.key) ?? []
    // Stage-only memberships still have no verified operating topic in that stage.
    const unclassified = entry.memberships.some(part => !topic && (!stage || part.stage === stage) && !part.topics.length)
    const operating = flags.includes(true) ? true
      : !unclassified && flags.length && flags.every(value => value === false) ? false : null
    return { entry, operating, aboveScale: ledger.get(entry.key)!.aboveScale, revenue: null }
  })
  return { count: unique.length, actual: countMetric(scoped.map(row => row.operating)),
    scaled: countMetric(scoped.map(activeAboveScale)), nodes }
}
