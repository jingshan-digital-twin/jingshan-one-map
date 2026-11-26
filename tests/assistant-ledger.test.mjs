import assert from 'node:assert/strict'
import test from 'node:test'
import { queryLedger } from '../src/jingshan/assistant-ledger.ts'

const stations = { id: 'charging', name: '京源充电站', features: [
  { properties: { name: '公园充电站', region: '新市街道' } },
  { properties: { name: '广场充电站', region: '宋河镇' } },
] }
const venues = { id: 'venues', name: '赛事场馆', features: [
  { properties: { name: '中心球馆', region: '宋河镇' } },
] }
const ask = (question, previous) => queryLedger(question, [stations, venues], '京山市', () => true, '', previous)

test('完整场地实体名称优先于名称中的学校分类词', () => {
  const name='京山市中等职业技术学校1号场'
  const schools={id:'schools',name:'学校',features:[{properties:{name:'京山市中等职业技术学校'}}]}
  const courts={id:'court_footprints',name:'网球场地边界',features:[{properties:{name}}]}
  const lookup=(q,selected='')=>queryLedger(q,[schools,courts],'京山市',()=>true,selected)
  assert.deepEqual(lookup(name).hits.map(hit=>hit.feature.properties.name),[name])
  assert.equal(lookup('请问'+name+'在哪里？').layerId,'court_footprints')
  assert.equal(lookup(name,'schools').layerId,'schools')
})

test('按镇街追问沿用上一轮台账，明确提到新类别时切换', () => {
  const reply = ask('新市街道有哪些充电站？')
  assert.deepEqual(reply.hits.map(hit => hit.feature.properties.name), ['公园充电站'])
  assert.deepEqual(ask('那宋河镇呢？', reply).hits.map(hit => hit.feature.properties.name), ['广场充电站'])
  assert.equal(ask('有哪些场馆？', reply).layerId, 'venues')
})
test('概览与名称查询都遵守当前地图范围和台账筛选', () => {
  const scoped = q => queryLedger(q, [stations, venues], '新市街道', f => f.properties.region === '新市街道', 'charging')
  assert.match(scoped('台账概览').text, /京源充电站　1 条$/)
  assert.equal(scoped('广场充电站').hits, undefined)
  assert.equal(scoped('查看京源充电站').hits.length, 1)
})
