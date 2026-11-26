import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeIndustryEconomy, growthFinding, scaleFinding } from '../src/jingshan/industry-economy.ts'
import { createCityOutputEstimateDataset } from '../server/industry-output-estimate.ts'

const city = '京山市'
const entry = (year, output, stage, topic, extra) => ({
  properties: {region: city, year, outputWanYuan: output * 10000, chainStage: stage, chainTopic: topic, ...extra},
})
const report = (rows, year = 2025, region = city, section = 'growth') => analyzeIndustryEconomy(
  [{id: 'industry_output', features: rows}], region, 'live', year, section,
)
const middle = result => result.stages.find(group => group.stage === '中游')

test('连续年度分别计算阶段和环节的占比、增量、增速及百分点变化', () => {
  const rows = [
    entry(2024, 10), entry(2024, 4, '中游'),
    entry(2024, 2, '中游', '场馆运营'), entry(2024, 0.1, '中游', '俱乐部运营'),
    entry(2024, 1, '中游', '培训陪练'), entry(2024, 0.9, '中游', '赛事组织'),
    entry(2025, 12), entry(2025, 6, '中游'),
    entry(2025, 4, '中游', '场馆运营'), entry(2025, 0.3, '中游', '俱乐部运营'),
    entry(2025, 0, '中游', '培训陪练'), entry(2025, 1.7, '中游', '赛事组织'),
  ]
  const result = report(rows)
  const group = middle(result)
  assert.equal(result.total.delta, 2)
  assert.equal(group.row.share, 50)
  assert.equal(group.row.shareChange, 10)
  assert.deepEqual(group.nodes.map(row => row.name), ['场馆运营', '俱乐部运营', '培训陪练', '赛事组织'])
  assert.equal(group.nodes[1].previousShare, 2.5)
  assert.ok(Math.abs(group.nodes[1].shareChange - 2.5) < 1e-8)
  assert.equal(group.nodes[1].delta, 0.2)
  assert.equal(group.nodes[1].rate, 200)
  assert.equal(group.nodes[2].rate, -100)
  assert.match(scaleFinding(group.nodes), /场馆运营.*占所属阶段的 66.7%/)
  assert.match(growthFinding(group.nodes), /场馆运营增加 2 亿元.*俱乐部运营同比增长 200%.*上年产值为 0.1 亿元/)
})

test('2025 年估算可逐级下钻，编辑分项会同步重算，其他地区和年份保持各自口径', () => {
  const rows = createCityOutputEstimateDataset().features
  const scale = (data, year = 2025, region = city) => report(data, year, region, 'scale')
  const model = scale(rows)
  assert.equal(model.estimated, true)
  assert.equal(model.total.current, 35)
  assert.deepEqual(model.stages.map(group => group.row.current), [4.95, 17.24, 12.81])
  assert.deepEqual(middle(model).nodes.map(row => Number(row.share.toFixed(1))), [21.6, 10.4, 40.7, 27.3])
  assert.equal(model.stages.flatMap(group => group.nodes).length, 12)
  assert.equal(scale(rows, 2024).total.current, null)
  assert.equal(scale(rows, null, '宋河镇').total.current, null)
  rows.find(row => row.properties.chainTopic === '场馆运营').properties.outputWanYuan += 10000
  assert.equal(middle(scale(rows)).row.current, 18.24)
  assert.equal(scale(rows).total.current, 36)
})

test('同年有实报时仅按实报分析，估算不充当同比基期', () => {
  const rows = createCityOutputEstimateDataset().features
  const partial = report([...rows, entry(2025, 2, '中游')], 2025, city, 'scale')
  assert.equal(partial.estimated, false)
  assert.equal(middle(partial).row.current, 2)
  assert.equal(partial.total.current, null)
  assert.equal(middle(partial).row.share, null)
  assert.equal(middle(partial).nodes[0].current, null)
  assert.equal(report([...rows, entry(2024, 20)]).hasCurrent, false)
  const future = report([...rows, entry(2026, 40)], 2026)
  assert.equal(future.hasPrevious, false)
  assert.equal(future.total.delta, null)
  assert.equal(report([], 2025, city, 'scale').total.current, 35)
})

test('跳年、样本和其他地区均不充作对比基期；零基数保留增量', () => {
  const rows = [entry(2023, 10), entry(2024, 4, undefined, undefined, {sample: true}),
    entry(2024, 4, undefined, undefined, {simulation: true}), entry(2024, 4, undefined, undefined, {simulated: true}),
    entry(2024, 6, undefined, undefined, {region:'宋河镇'}), entry(2025, 7)]
  assert.equal(report(rows).hasPrevious, false)
  assert.equal(report(rows).total.delta, null)
  const fromZero = report([entry(2024, 0), entry(2025, 7)]).total
  assert.equal(fromZero.delta, 7)
  assert.equal(fromZero.rate, null)
})

test('合并报送不拆分；阶段总额冲突时保留金额、暂缓占比', () => {
  const group = middle(report([entry(2025, 3, '中游'), entry(2025, 1.5, '中游', '培训健身')]))
  assert.deepEqual(group.nodes.slice(1, 3).map(row => [row.current, row.share, row.combined]),
    [[null, null, '培训健身'], [null, null, '培训健身']])
  const conflict = middle(report([entry(2025, 2, '中游'), entry(2025, 3, '中游', '场馆运营')]))
  assert.equal(conflict.inconsistent, true)
  assert.equal(conflict.nodes[0].current, 3)
  assert.equal(conflict.nodes[0].share, null)
})
