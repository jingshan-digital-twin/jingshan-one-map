import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aboveScaleOrThresholdCount, enterpriseAnnualId, enterpriseAnnualYears, enterpriseCapacity, formatCapacityCount } from '../src/jingshan/industry-enterprise-capacity.ts'

const region = '新市街道'
const venue = '场馆运营'
const training = '培训陪练'
const row = (id, topics, fields = {}) => ({
  key: id, datasetId: 'businesses', feature: { id, properties: { name: id, region, ...fields } },
  memberships: [{ stage: '中游', topics }], points: [],
})
const annual = (enterpriseId, topic, fields) => ({ properties: {
  region, year: 2025, sourceStatus: '已核验', enterpriseId, topic, ...fields,
} })
const layer = features => [{ id: enterpriseAnnualId, features }]
const diagnose = (rows, features) => enterpriseCapacity(layer(features), rows, region, 'live', 2025, '中游', null)

test('工商存续、名录样例和其他年度或镇街都不算作该年实际经营', () => {
  const rows = [row('甲', [venue], { registrationStatus: '存续', registeredCapital: '1000万元' }),
    row('乙', [training], { sample: true })]
  const records = [
    annual('甲', venue, { year: 2024, operating: true }),
    annual('甲', venue, { year: 2026, region: '曹武镇', operating: true }),
    annual('甲', venue, { year: 2028, operating: true, sourceStatus: '待核' }),
    annual('甲', venue, { year: 2029, operating: true, sample: true }),
    annual('甲', venue, { year: 2029, operating: true, simulated: true }),
    annual('甲', venue, { year: 2030 }),
  ]
  const result = diagnose(rows, records)
  assert.equal(result.count, 1)
  assert.equal(result.nodes.length, 4)
  assert.equal(formatCapacityCount(result.actual), '待核')
  assert.equal(result.nodes[0].firstShare, null)
  assert.deepEqual(enterpriseAnnualYears(layer(records), region), [2024])
  assert.deepEqual(enterpriseAnnualYears(layer(records), '京山市'), [2026, 2024])
})

test('企业跨环节去重，环节营收独立归集，已核实名录提供首家占比，零值可辨', () => {
  const rows = [row('甲', [venue, training]), row('乙', [venue]), row('丙', [venue])]
  const records = [
    annual('甲', venue, { operating: true, aboveScale: true, topicRevenueWan: 90 }),
    annual('甲', venue, { operating: true, aboveScale: true, topicRevenueWan: 90 }),
    annual('甲', training, { operating: true, topicRevenueWan: 0 }),
    annual('乙', venue, { operating: true, aboveScale: false, topicRevenueWan: 60 }),
    annual('丙', venue, { operating: false }),
  ]
  const report = diagnose(rows, records)
  const [v, , t] = report.nodes
  assert.deepEqual(report.actual, { yes: 2, verified: 3, total: 3 })
  assert.equal(report.scaled.yes, 1)
  assert.equal(v.firstShare, 60)
  assert.equal(v.sum, 150)
  assert.equal(v.reported[0].entry.key, '甲')
  assert.equal(formatCapacityCount(t.scaled), '1')
  assert.equal(t.complete, true)
  assert.equal(t.sum, 0)
  assert.equal(t.firstShare, null)
})

test('账目不完整、冲突或仅给企业全年总营收时保留占比未知', () => {
  const rows = [row('甲', [venue]), row('乙', [venue])]
  const base = annual('甲', venue, { operating: true, aboveScale: false, topicRevenueWan: 40 })
  for (const other of [
    { operating: true, revenueWan: 20 }, { operating: false, topicRevenueWan: 20 },
    { operating: true, topicRevenueWan: -10 },
  ]) {
    assert.equal(diagnose(rows, [base, annual('乙', venue, other)]).nodes[0].firstShare, null)
  }
  const partial = diagnose(rows, [base])
  assert.equal(formatCapacityCount(partial.actual), '≥1')
  const conflict = diagnose(rows, [base, annual('甲', venue, { topicRevenueWan: 80 }),
    annual('乙', venue, { operating: true, aboveScale: false, topicRevenueWan: 0 })])
  assert.equal(conflict.nodes[0].firstShare, null)
  assert.equal(conflict.nodes[0].reported.length, 1)
  assert.equal(formatCapacityCount(conflict.nodes[0].scaled), '0')
})

test('首页规上与限上按名录企业去重，采用最新核验年度并排除样例',()=>{
  const threshold = {...row('甲',[venue]),aboveThreshold:true}
  const directory = [threshold,threshold,row('乙',[training]),row('丙',[venue],{aboveScale:true}),row('样例',[training],{sample:true,aboveScale:true})]
  const reports=layer([annual('甲',venue,{aboveScale:true}),annual('乙',training,{aboveScale:true}),
    annual('丙',venue,{aboveScale:true,year:2024}),annual('丙',venue,{aboveScale:false})])
  assert.equal(aboveScaleOrThresholdCount(reports,directory,region),2)
})
