import test from 'node:test'
import assert from 'node:assert/strict'
import { diagnoseProcurement, procurementYears, formatProcurementAmount } from '../src/jingshan/industry-procurement.ts'

const full = { year: 2025, region: '京山市', stage: null, topic: null }
function purchase(id, overrides = {}) {
  return { id, properties: {
    purchasedAt: '2025-02-10', region: '新市街道', chainStage: '中游', chainTopic: '场馆运营',
    buyer: '采购方甲', category: '器材', supplier: '供货方乙', supplierLocality: '京山市内',
    orderId: id, amountYuan: 20, receipt: '验收单-' + id, verified: true, ...overrides,
  } }
}
const dataset = (...features) => [{ id: 'industry_procurement', features }]

test('按采购方、年度和环节筛选，实采金额按分累计，同单拆项只算一个订单', () => {
  const local = purchase('local', { amountYuan: '34.11' })
  const data = dataset(local, local, purchase('second', { orderId: 'local', amountYuan: '15.89' }),
    purchase('out', { supplierLocality: '京山市外', amountYuan: 150 }),
    purchase('otherTown', { region: '永兴街道', purchasedAt: '2024-12-31' }),
    purchase('event', { chainTopic: '赛事组织', amountYuan: 500 }))
  const report = diagnoseProcurement(data, { ...full, region: '新市街道', stage: '中游', topic: '场馆运营' })
  assert.deepEqual([report.orderCount, report.rows.length, report.localFen, report.knownFen, report.share], [2, 3, 5000n, 20000n, 25])
  assert.deepEqual(procurementYears(data), [2025, 2024])
  assert.deepEqual(procurementYears(data, '永兴街道'), [2024])
  assert.equal(diagnoseProcurement(data, { ...full, stage: '上游' }).rows.length, 0)
  assert.equal(diagnoseProcurement(data, { ...full, region: '永兴街道' }).share, null)
})

test('金额、属地缺失或分母为零，不推算本地金额占比', () => {
  const data = dataset(purchase('ok'), purchase('amount', { amountYuan: '' }), purchase('locality', { supplierLocality: '' }),
    purchase('supplier', { supplier: '', supplierLocality: '京山市内', amountYuan: '0.52' }))
  const report = diagnoseProcurement(data, full)
  assert.equal(report.missingAmount, 1)
  assert.equal(report.missingLocality, 2)
  assert.equal(report.unknownFen, 2052n)
  assert.equal(report.share, null)
  assert.equal(report.categories[0].share, null)
  assert.equal(diagnoseProcurement(dataset(purchase('free', { amountYuan: 0 })), full).share, null)
  assert.equal(diagnoseProcurement(dataset(purchase('paid'), purchase('free', { amountYuan: 0, supplierLocality: '' })), full).share, 100)
})

test('回溯到所选年度，要求相同采购方与品类在不同月份有独立采购决策', () => {
  const outside = (id, date, options = {}) => purchase(id, { purchasedAt: date, supplierLocality: '京山市外', externalReason: '本地无供应商', ...options })
  const data = dataset(outside('old', '2024-12-20'), outside('new', '2025-01-20'),
    outside('instalment', '2025-02-20', { orderId: 'new' }), outside('future', '2026-02-20'),
    outside('other', '2025-06-10', { buyer: '另一企业' }))
  const report = diagnoseProcurement(data, full)
  assert.equal(report.rows.length, 3)
  assert.equal(report.review.length, 1)
  assert.deepEqual([report.review[0].orders, report.review[0].months, report.review[0].first, report.review[0].last], [2, 2, '2024-12-20', '2025-01-20'])
  assert.match(report.review[0].actions[0], /招商核查/)
  assert.equal(diagnoseProcurement(data, { ...full, year: 2024 }).review.length, 0)
})

test('区分对接、扩产和招商线索，保留无原因和未归类原话', () => {
  const row = (id, reason, category) => purchase(id, { category, externalReason: reason, supplierLocality: '京山市外' })
  const report = diagnoseProcurement(dataset(row('a', '未对接本地供应商', '护具'), row('b', '本地产能不足', '球拍'),
    row('c', '并非本地产能不足', '网绳'), row('d', '', '网球'), row('e', '本地无同规格产品', '服装')), full)
  assert.equal(report.review.length, 2)
  assert.match(report.review.find(item => item.category === '护具').actions.join(''), /对接/)
  assert.match(report.review.find(item => item.category === '球拍').actions.join(''), /扩产意愿/)
  assert.equal(report.reasons.length, 5)
  assert.ok(report.reasons.some(item => item.reason === ''))
})

test('缺凭证、意向、演示、无有效成交日、重复明细冲突和其他数据集均不计为实采', () => {
  const data = dataset(purchase('sample', { sample: true }), purchase('intent', { status: '采购意向' }),
    purchase('simulated', { simulation: true }), purchase('mock', { simulated: true }),
    purchase('no-proof-of-status', { verified: undefined }), purchase('contradiction', { status: '已取消', procurementStatus: '已完成' }),
    purchase('unverified', { verified: false }), purchase('invalid', { purchasedAt: '2025-02-31' }),
    purchase('missing', { receipt: '' }), purchase('conflict'), purchase('conflict', { amountYuan: 9999 }))
  data.push({ id: 'chain_diagnostics', features: [purchase('spec')] })
  const report = diagnoseProcurement(data, { ...full, year: null })
  assert.equal(report.year, null)
  assert.equal(report.rows.length, 0)
  assert.equal(report.share, null)
  assert.equal(diagnoseProcurement(dataset(purchase('actual', { verified: undefined, status: '已验收' })), full).rows.length, 1)
})

test('大额明细仍按分精确求和，缺少有效精度的数值等待核实', () => {
  const report = diagnoseProcurement(dataset(purchase('base', { amountYuan: '90071992547409.91' }),
    purchase('cent', { amountYuan: '0.02' })), full)
  assert.equal(report.knownFen, 9007199254740993n)
  assert.equal(formatProcurementAmount(report.knownFen), '90,071,992,547,409.93')
  assert.equal(report.share, 100)
  const invalid = diagnoseProcurement(dataset(purchase('rounded', { amountYuan: 1e17 }),
    purchase('negative', { amountYuan: -1 }), purchase('fraction', { amountYuan: '1.001' })), full)
  assert.equal(invalid.missingAmount, 3)
  assert.equal(invalid.share, null)
})

test('中游四环节共用所选镇街和年度，各自按金额计算占比，区分无记录、待核算和零占比', () => {
  const scope = { ...full, year: null, region: '新市街道', stage: '中游' }
  const data = dataset(
    purchase('local', { amountYuan: '40.00' }),
    purchase('next-line', { orderId: 'local', amountYuan: 20 }),
    purchase('out', { amountYuan: 90, supplierLocality: '京山市外' }),
    purchase('club', { chainTopic: '俱乐部运营', supplierLocality: '待核实', amountYuan: '' }),
    purchase('event', { chainTopic: '赛事组织', supplierLocality: '京山市外' }),
    purchase('training-old', { chainTopic: '培训陪练', purchasedAt: '2024-11-30' }),
    purchase('other-region', { region: '永兴街道', purchasedAt: '2026-01-02' }))
  const report = diagnoseProcurement(data, scope)
  assert.equal(report.year, 2025)
  assert.deepEqual(report.topicComparison.map(row => [row.topic, row.share, row.localFen, row.knownFen, row.orderCount]), [
    ['场馆运营', 40, 6000n, 15000n, 2], ['俱乐部运营', null, 0n, 0n, 1],
    ['培训陪练', null, 0n, 0n, 0], ['赛事组织', 0, 0n, 2000n, 1],
  ])
  assert.equal(report.topicComparison[1].missingAmount, 1)
  assert.equal(report.topicComparison[1].missingLocality, 1)
  assert.deepEqual(report.topicComparison[2].externalCategories, [])
  const empty = diagnoseProcurement([], scope)
  assert.equal(empty.topicComparison.length, 4)
  assert.ok(empty.topicComparison.every(row => row.share === null && row.orderCount === 0))
  assert.deepEqual(diagnoseProcurement(data, full).topicComparison, [])
  assert.deepEqual(diagnoseProcurement(data, { ...scope, topic: '场馆运营' }).topicComparison, [])
})

test('外采按环节、采购方和品类追溯，原因归属本期采购方，同单分期不计为反复采购', () => {
  const outside = (id, date, options = {}) => purchase(id, {
    purchasedAt: date, supplierLocality: '京山市外', ...options,
  })
  const data = dataset(
    outside('old', '2024-12-01', { externalReason: '旧规格' }),
    outside('renewed', '2025-02-01', { externalReason: '认证要求' }),
    outside('split', '2025-03-01', { orderId: 'renewed' }),
    outside('one-off', '2025-04-01', { buyer: '采购方丙', externalReason: '交期紧' }),
    outside('club', '2025-05-01', { chainTopic: '俱乐部运营', externalReason: '指定品牌' }),
    outside('club-pay', '2025-06-15', { chainTopic: '俱乐部运营', orderId: 'club', externalReason: '指定品牌' }),
    outside('club-next', '2026-07-01', { chainTopic: '俱乐部运营', externalReason: '下年度采购' }))
  const report = diagnoseProcurement(data, { ...full, stage: '中游' })
  const [venue, club] = report.topicComparison.map(row => row.externalCategories[0])
  assert.equal(venue.orderCount, 2)
  assert.equal(venue.category, '器材')
  assert.equal(venue.repeated, true)
  assert.deepEqual(new Set(venue.reasons), new Set(['认证要求', '交期紧']))
  assert.equal(venue.missingReason, true)
  assert.deepEqual(venue.repeatedBuyers, [
    { buyer: '采购方甲', months: 2, orders: 2, reasons: ['认证要求'], missingReason: true },
  ])
  assert.deepEqual(club, {
    category: '器材', orderCount: 1, reasons: ['指定品牌'], missingReason: false, repeated: false, repeatedBuyers: [],
  })
  assert.deepEqual(diagnoseProcurement(data, full).review.map(row => [row.topic, row.orders]), [['场馆运营', 2]])
})
