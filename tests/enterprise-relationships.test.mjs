import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { buildEnterpriseRelationships } from '../src/jingshan/enterprise-relationships.ts'
import { enterprisePartners, matterKey } from '../src/jingshan/enterprise-network.ts'
import { buildChainCatalog } from '../src/jingshan/industry-panorama.ts'

const operator = '京山市网球产业发展有限公司'
const club = '京山市世杰体育培训有限公司'
const hotel = '京山市京源美华酒店管理有限公司'
const contractor = '湖北顺星建设有限公司'
const outside = '北京华体创研工程设计咨询有限公司'
const facts = ['upstream', 'middle', 'downstream'].flatMap(file =>
  JSON.parse(readFileSync(new URL('../server/industry-sources/' + file + '.json', import.meta.url), 'utf8')))

function directory(entries) {
  return { id: 'businesses', features: entries.map(({ name, stage, topics, relationRecords }) => ({
    id: name, geometry: null, properties: { name, chainStage: stage, chainTopics: topics, relationRecords },
  })) }
}
function graph(data, name) {
  return buildEnterpriseRelationships(data, buildChainCatalog(data, '京山市').find(r => r.feature.properties.name === name))
}

test('实际名录的同一材料关联去重，股权和中标方向随中心企业切换', () => {
  const data = [directory(facts)]
  const { edges, unlinked } = graph(data, operator)
  assert.equal(edges.length, 4)
  assert.equal(unlinked.length, 0)
  const partner = name => edges.find(e => e.partnerName === name)
  assert.equal(partner(hotel).label, '持股 100%')
  assert.equal(partner(hotel).direction, 'out')
  assert.deepEqual(partner(hotel).stages, ['下游'])
  assert.equal(partner(club).label, '共同承办')
  assert.equal(partner(club).direction, 'none')
  assert.equal(partner(outside).inDirectory, false)
  assert.deepEqual(partner(outside).stages, [])
  assert.equal(partner(contractor).partnerRole, '联合中标方')
  assert.equal(partner(contractor).centerRole, '招标人')
  const reverse = graph(data, hotel).edges[0]
  assert.deepEqual([reverse.partnerName, reverse.label, reverse.direction], [operator, '股东持股 100%', 'in'])
  const awards = graph(data, contractor).edges
  assert.equal(awards.filter(e => e.label === '联合中标').length, 2)
  assert.equal(awards.find(e => e.partnerName === operator).direction, 'in')
})

test('同一工程的两个伙伴归到一项凭证，可以互查，不混入赛事和股权关系', () => {
  const datasets = [directory(facts)]
  const center = buildChainCatalog(datasets, '京山市').find(row => row.feature.properties.name === operator)
  const { nodes, matters } = enterprisePartners(datasets, center)
  const award = nodes.find(node => node.target === contractor)
  const parties = matters.get(matterKey(award.relations[0].record))
  assert.equal(matters.size, 3)
  assert.deepEqual(nodes.filter(node => parties.has(node.id)).map(node => node.target).sort(), [contractor, outside].sort())
})

test('一份实名材料可双向查到，缺凭证和同场记录保留登记内容', () => {
  const relation = facts.find(f => f.name === operator).relationRecords.find(r => r.activity.includes('共同承办'))
  const docs = [
    { ...relation, activity: operator + '、' + club + '共同出席会议。' },
    { ...relation, activity: operator + '、' + club + '分别投标。' },
    { ...relation, receipt: '', url: undefined },
    { ...relation, sample: true },
  ]
  const businesses = directory(facts.filter(f => [operator, club].includes(f.name)).map(f =>
    ({ ...f, relationRecords: f.name === operator ? docs : [] })))
  const data = [businesses]
  assert.equal(graph(data, operator).edges.length, 0)
  assert.equal(graph(data, operator).unlinked.length, 3)
  data.push({ id: 'business_relations', features: [{ properties: { businessId: operator, ...relation } }] })
  assert.equal(graph(data, club).edges[0].partnerName, operator)
  assert.equal(graph(data, operator).edges.length, 1)
  assert.equal(graph(data, operator).unlinked.length, 3)
})

test('实名供货在单方登记后双向可查，合同编号可用于内部凭证', () => {
  const registry = { product: '场地维护用球供应', receiptNo: 'JS-2026-01',
    relationship: { type: '供货', from: contractor, to: club, status: '已核验' } }
  const businesses = directory(facts.map(f => ({ ...f, relationRecords: f.name === club ? [registry] : [] })))
  const data = [businesses, { id: 'business_relations', features: [{ properties: registry }] }]
  const from = graph(data, contractor).edges
  const to = graph(data, club).edges
  assert.equal(from.length, 1)
  assert.deepEqual([from[0].partnerName, from[0].label, from[0].direction], [club, '向其供货', 'out'])
  assert.deepEqual([to[0].partnerName, to[0].label, to[0].direction], [contractor, '向其采购', 'in'])
  assert.equal(to[0].record.receipt, registry.receiptNo)
  assert.ok(to[0].record.activity.includes(club))
})

test('独立服务合同只连接明确的双方，保留名录外提供方', () => {
  const other = '上海测试场地咨询有限公司'
  const registry = { product: '场馆服务协议', activity: '场地验收服务。', receipt: '签署公告',
    url: 'https://example.com/contract', relationship: { type: '服务合同', from: other, to: club, status: '已核验' } }
  const local = directory([{ name: club, topics: ['培训陪练'] }, { name: '市', topics: ['培训陪练'] }])
  const data = [local, { id: 'business_relations', features: [{ properties: registry }] }]
  const [edge] = graph(data, club).edges
  assert.deepEqual([edge.partnerName, edge.label, edge.direction, edge.inDirectory], [other, '采购服务', 'in', false])
  assert.equal(graph(data, '市').edges.length, 0)
  const wrongOwner = [{ ...local, features: local.features.map(f => f.id === '市'
    ? { ...f, properties: { ...f.properties, relationRecords: [registry] } } : f) }]
  assert.deepEqual(graph(wrongOwner, '市'), { edges: [], unlinked: [] })
  assert.equal(graph(wrongOwner, club).edges.length, 0)
})

test('作废、未核实、缺凭证、有演示标记和同场登记都不会产生合同关系', () => {
  const registry = { product: '业务登记', activity: operator + '、' + club + '共同承办比赛。', receipt: '承办登记',
    url: 'https://example.com/report', relationship: { type: '服务合同', from: operator, to: club, status: '已核验' } }
  const pending = [
    { ...registry, relationship: { ...registry.relationship, status: '待核验' } },
    { ...registry, relationship: { ...registry.relationship, type: '同场活动' } },
    { ...registry, sourceStatus: '未核实' }, { ...registry, sample: true },
    { ...registry, receipt: undefined }, { ...registry, url: undefined }, { ...registry, status: '已作废' },
    { ...registry, relationship: { ...registry.relationship, from: club } },
  ]
  const data = [directory(facts.map(f => ({ ...f, relationRecords: f.name === operator ? pending : [] })))]
  assert.equal(graph(data, operator).edges.length, 0)
  assert.equal(graph(data, club).edges.length, 0)
})
