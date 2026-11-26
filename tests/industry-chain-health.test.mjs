import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChainHealth, panoramaWeakTopics } from '../src/jingshan/industry-chain-health.ts'
import { buildChainCatalog } from '../src/jingshan/industry-panorama.ts'

function assess(datasets, region = '京山市') {
  return buildChainHealth(datasets, buildChainCatalog(datasets, region), region)
}
const dataset = (id, ...features) => ({ id, features })
const enterprise = (id, properties = {}) => ({
  id, properties: { name: id, region: '新市街道', chainTopics: ['运动服饰'], ...properties },
})
const assessment = (properties = {}) => ({
  properties: { chainStage: '上游', chainTopic: '运动服饰', region: '京山市', coverageRate: 30, threshold: 80, ...properties },
})

test('全市图谱按参考图标记，镇街按本地台账判定，场馆运营始终不加标', () => {
  assert.deepEqual([...panoramaWeakTopics([], '京山市')], ['运动服饰', '俱乐部运营', '运动康养'])
  const datasets = [dataset('industry_diagnostics',
    assessment({ verified: true, coverageRate: 100 }),
    assessment({ verified: true, chainStage: '中游', chainTopic: '场馆运营' }),
    assessment({ verified: true, region: '新市街道', chainStage: '中游', chainTopic: '培训陪练' }),
  )]
  assert.deepEqual([...panoramaWeakTopics(datasets, '京山市')], ['俱乐部运营', '运动康养'])
  assert.deepEqual([...panoramaWeakTopics(datasets, '新市街道')], ['培训陪练'])
})

test('仅有一家或均在筹建时为结构性线索，未知名录、样例和估算均不能确认弱链', () => {
  const datasets = [dataset('businesses', enterprise('服装厂'), enterprise('A', {chainTopics: ['器材制造'], businessPhase: '筹建'}),
    enterprise('B', {chainTopics: ['器材制造'], businessPhase: '在建'}), enterprise('演示', {chainTopics: ['场地建设'], sample: true}),
    enterprise('模拟经营者', {simulated: true})),
    dataset('industry_diagnostics', ...[{ simulated: true }, { simulation: true }, { sample: true }, { outputBasis: 'estimate' }]
      .map(flags => assessment({ ...flags, verified: true }))),
    dataset('industry_output', {properties: {chainStage: '中游', chainTopic: '场馆运营', outputBasis: 'estimate', year: 2025, outputWanYuan: 0}})]
  const rows = assess(datasets)
  assert.equal(rows.length, 12)
  assert.deepEqual(rows.filter(row => row.status === 'candidate').map(row => row.topic), ['器材制造', '运动服饰'])
  assert.equal(rows.find(row => row.topic === '运动服饰').count, 1)
  assert.ok(rows.every(row => row.status !== 'weak'))
  assert.ok(assess(datasets, '永兴街道').every(row => row.status === 'unassessed'))
})

test('已核实规格覆盖低于阈值才标弱链，达到阈值显示规格达标，按辖区取诊断', () => {
  const source = dataset('industry_diagnostics', assessment({ verified: true, coverageRate: 0 }),
    assessment({ region: '新市街道', verified: true, coverageRate: 80 }), assessment({ region: '永兴街道', verified: false }))
  const node = region => assess([source], region).find(row => row.topic === '运动服饰')
  assert.deepEqual([node('京山市').status, node('新市街道').status, node('永兴街道').status], ['weak', 'covered', 'candidate'])
  assert.match(node('京山市').reason, /0%.*80%/)
  assert.equal(assess([dataset('industry_diagnostics', assessment({ verified: true, threshold: undefined }))])
    .find(row => row.topic === '运动服饰').status, 'unassessed')
})

test('同一采购方与品类跨月重复出现本地供给限制才形成采购线索，同单分期和指定品牌均不触发', () => {
  function order(id, date, reason, extra = {}) {
    return { id, properties: { orderId: id, purchasedAt: date, chainStage: '中游', chainTopic: '赛事组织', region: '新市街道',
      buyer: '赛务公司', category: '运动服', supplier: '服装公司', verified: true, receipt: '凭证' + id,
      supplierLocality: '京山市外', externalReason: reason, amountYuan: 10, ...extra } }
  }
  const receipts = [order('1', '2024-12-01', '指定品牌'), order('2', '2025-01-20', '本地产能不足'),
    order('3', '2025-02-01', '本地产能不足', {orderId: '2'})]
  const node = orders => assess([dataset('industry_procurement', ...orders)]).find(row => row.topic === '赛事组织')
  assert.equal(node(receipts).status, 'unassessed')
  const candidate = node([...receipts, order('4', '2025-03-01', '本地产能不足')])
  assert.equal(candidate.status, 'candidate')
  assert.match(candidate.reason, /赛务公司.*运动服.*2 个月.*本地产能不足/)
  assert.match(candidate.nextCheck, /扩产意愿/)
})
