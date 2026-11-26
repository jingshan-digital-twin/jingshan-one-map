import { chain, type ChainStage, type ChainTopic } from './chain-taxonomy.ts'
import type { CityFeature, Dataset } from './types.ts'

type Scope = { year: number | null; region: string; stage: ChainStage | null; topic: ChainTopic | null }
type Locality = '京山市内' | '京山市外' | '待核实'
type Purchase = {
  id: string; date: string; year: number; region: string; stage: ChainStage; topic: ChainTopic
  order: string; buyer: string; category: string; supplier: string; locality: Locality
  amountFen: bigint | null; receipt: string; reason: string
}

const label = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const actualStatuses = new Set(['已采购', '已成交', '已履约', '已验收', '已结算', '已支付', '已完成'])

function dateValue(value: unknown) {
  const date = label(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
  const timestamp = Date.parse(date + 'T00:00:00Z')
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date ? date : ''
}

function readFen(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const yuan = String(value).trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(yuan)) return null
  const [whole, fraction = ''] = yuan.split('.')
  const fen = BigInt(whole + fraction.padEnd(2, '0'))
  return typeof value === 'number' && fen > BigInt(Number.MAX_SAFE_INTEGER) ? null : fen
}

const integerFormat = new Intl.NumberFormat('zh-CN')
export function formatProcurementAmount(fen: bigint) {
  const fraction = (fen % 100n).toString().padStart(2, '0').replace(/0+$/, '')
  return integerFormat.format(fen / 100n) + (fraction ? '.' + fraction : '')
}

function purchaseFrom(feature: CityFeature): Purchase | null {
  const p = feature.properties
  const statuses = [p.procurementStatus, p.status].map(label).filter(Boolean)
  if (p.sample === true || p.simulation === true || p.simulated === true || p.verified === false ||
      statuses.some(status => !actualStatuses.has(status)) || (p.verified !== true && !statuses.length)) return null
  const date = dateValue(p.purchasedAt)
  const stage = chain.find(item => item.id === p.chainStage)
  const topic = stage?.topics.find(item => item === p.chainTopic)
  const order = label(p.orderId), buyer = label(p.buyer), category = label(p.category)
  const region = label(p.region), receipt = label(p.receipt)
  if (!feature.id || !date || !region || !stage || !topic || !order || !buyer || !category || !receipt) return null
  const supplier = label(p.supplier)
  const locality = supplier ? p.supplierLocality : null
  return {
    id: feature.id, date, year: Number(date.slice(0, 4)), region, stage: stage.id, topic,
    order, buyer, category, supplier, receipt, reason: label(p.externalReason),
    locality: locality === '京山市内' || locality === '京山市外' ? locality : '待核实',
    amountFen: readFen(p.amountYuan),
  }
}

function ledger(datasets: Dataset[]) {
  const records = new Map<string, Purchase | null>()
  for (const dataset of datasets.filter(item => item.id === 'industry_procurement')) {
    for (const feature of dataset.features) {
      const row = purchaseFrom(feature)
      if (!row) continue
      const previous = records.get(row.id)
      if (previous === undefined) records.set(row.id, row)
      else if (previous && (Object.keys(row) as (keyof Purchase)[]).some(key => previous[key] !== row[key])) records.set(row.id, null)
    }
  }
  return [...records.values()].filter((row): row is Purchase => row !== null)
}

const inRegion = (row: Purchase, region: string) => region === '京山市' || row.region === region
export function procurementYears(datasets: Dataset[], region = '京山市') {
  return [...new Set(ledger(datasets).filter(row => inRegion(row, region)).map(row => row.year))].sort((a, b) => b - a)
}

function spend(rows: Purchase[]) {
  let localFen = 0n, externalFen = 0n, unknownFen = 0n, missingAmount = 0, missingLocality = 0
  for (const row of rows) {
    if (row.locality === '待核实') missingLocality++
    if (row.amountFen === null) missingAmount++
    else if (row.locality === '京山市内') localFen += row.amountFen
    else if (row.locality === '京山市外') externalFen += row.amountFen
    else unknownFen += row.amountFen
  }
  const knownFen = localFen + externalFen + unknownFen
  const share = !missingAmount && !unknownFen && knownFen > 0n
    ? Number((10000n * localFen + knownFen / 2n) / knownFen) / 100 : null
  return { localFen, externalFen, unknownFen, knownFen, missingAmount, missingLocality, share }
}

const byAmountDescending = (left: bigint, right: bigint) => left > right ? -1 : left < right ? 1 : 0

function groups<T>(rows: T[], identify: (row: T) => string) {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const key = identify(row)
    const items = map.get(key)
    if (items) items.push(row)
    else map.set(key, [row])
  }
  return [...map.values()]
}

const countOrders = (rows: Purchase[]) => groups(rows, row => JSON.stringify([row.buyer, row.order])).length

function recordedReasons(rows: Purchase[]) {
  return {
    reasons: [...new Set(rows.map(row => row.reason).filter(Boolean))],
    missingReason: rows.some(row => !row.reason),
  }
}

// Only confirmed, explicitly worded causes trigger a proposed action. Retain all other wording for review.
const followUps = [
  { supplyConstraint: false, reasons: ['供需信息不通', '未对接本地供应商', '不了解本地供应商'], minimumMonths: 1, action: '组织供需对接，安排本地企业按采购规格报价。' },
  { supplyConstraint: true, reasons: ['本地产能不足', '本地供应商产能不足', '本地供应商排期已满'], minimumMonths: 1, action: '走访本地供应商，核实订单量、交期和扩产意愿。' },
  { supplyConstraint: true, reasons: ['本地无供应商', '本地无相应资质供应商', '本地无同规格产品'], minimumMonths: 2, action: '列为招商核查线索，核实本地供给和后续订单规模。' },
]

export function diagnoseProcurement(datasets: Dataset[], scope: Scope) {
  const scoped = ledger(datasets).filter(row => inRegion(row, scope.region) &&
    (!scope.stage || row.stage === scope.stage) && (!scope.topic || row.topic === scope.topic))
  const year = scope.year ?? (scoped.length ? scoped.reduce((max, row) => Math.max(max, row.year), 0) : null)
  const rows = scoped.filter(row => row.year === year).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  const categories = groups(rows, row => JSON.stringify([row.topic, row.category])).map(items => ({
    topic: items[0].topic, category: items[0].category, count: items.length, ...spend(items),
  })).sort((a, b) => byAmountDescending(a.knownFen, b.knownFen) || a.topic.localeCompare(b.topic, 'zh-CN') || a.category.localeCompare(b.category, 'zh-CN'))
  const external = rows.filter(row => row.locality === '京山市外')
  const reasons = groups(external, row => row.reason).map(items => ({
    reason: items[0].reason, count: items.length, ...spend(items),
  })).sort((a, b) => b.count - a.count || byAmountDescending(a.knownFen, b.knownFen))
  const historicalExternal = scoped.filter(row => year !== null && row.year <= year && row.locality === '京山市外')
  const review = groups(historicalExternal, row => JSON.stringify([row.topic, row.buyer, row.category])).flatMap(items => {
    const current = items.filter(row => row.year === year)
    if (!current.length) return []
    // Several payments, invoices or items on one order still represent a single purchasing decision.
    const orders = groups(items, row => row.order)
      .map(lines => ({ date: lines.reduce((earliest, row) => row.date < earliest ? row.date : earliest, lines[0].date), lines }))
    const orderDates = orders.map(order => order.date).sort()
    const months = new Set(orderDates.map(date => date.slice(0, 7))).size
    const findings = followUps.flatMap(rule => {
      const reasons = [...new Set(current.map(row => row.reason).filter(reason => rule.reasons.includes(reason)))]
      if (!reasons.length) return []
      const dates = orders.filter(order => order.lines.some(row => rule.reasons.includes(row.reason)))
        .map(order => order.date.slice(0, 7))
      const months = new Set(dates).size
      return months >= rule.minimumMonths ? [{ ...rule, reasons, months }] : []
    })
    const actions = findings.map(item => item.action)
    const repeatedSupplyConstraint = findings.find(item => item.supplyConstraint && item.months >= 2)
    if (months < 2 && !actions.length) return []
    return [{
      topic: items[0].topic, buyer: items[0].buyer, category: items[0].category, months, orders: orders.length, repeated: months >= 2,
      first: orderDates[0], last: orderDates[orderDates.length - 1], ...spend(current),
      ...recordedReasons(current),
      actions, repeatedSupplyConstraint,
    }]
  }).sort((a, b) => b.months - a.months || byAmountDescending(a.externalFen, b.externalFen))
  const comparisonTopics = scope.stage === '中游' && !scope.topic
    ? chain.find(stage => stage.id === '中游')!.topics : []
  const topicComparison = comparisonTopics.map(topic => {
    const topicRows = rows.filter(row => row.topic === topic)
    const externalCategories = groups(topicRows.filter(row => row.locality === '京山市外'), row => row.category)
      .map(items => {
        const category = items[0].category
        const repeatedBuyers = review
          .filter(item => item.topic === topic && item.category === category && item.repeated)
          .map(({ buyer, orders, months, reasons, missingReason }) => ({ buyer, orders, months, reasons, missingReason }))
        return { category, orderCount: countOrders(items), ...recordedReasons(items), repeated: repeatedBuyers.length > 0, repeatedBuyers }
      }).sort((a, b) => Number(b.repeated) - Number(a.repeated) || b.orderCount - a.orderCount || a.category.localeCompare(b.category, 'zh-CN'))
    return { topic, ...spend(topicRows), orderCount: countOrders(topicRows), externalCategories }
  })
  return { rows, year, orderCount: countOrders(rows), categories, reasons, review, topicComparison, ...spend(rows) }
}
