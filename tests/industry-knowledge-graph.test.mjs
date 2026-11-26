import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { buildEnterpriseGraph, companyNodeId } from '../src/jingshan/industry-knowledge-graph.ts'
import { buildChainCatalog } from '../src/jingshan/industry-panorama.ts'

const inventory = ['upstream', 'middle', 'downstream'].flatMap(file =>
  JSON.parse(readFileSync(new URL('../server/industry-sources/' + file + '.json', import.meta.url), 'utf8')))
const businesses = { id: 'businesses', features: inventory.map(p => ({
  id: p.name, type: 'Feature', geometry: { type: 'GeometryCollection', geometries: [] },
  properties: { ...p, segment: p.stage, chainTopics: p.topics },
})) }
const operator = '京山市网球产业发展有限公司'
const hotel = '京山市京源美华酒店管理有限公司'
const contractor = '湖北顺星建设有限公司'
const club = '京山市世杰体育培训有限公司'
const outside = '北京华体创研工程设计咨询有限公司'
function graph(name, datasets = [businesses]) {
  const center = buildChainCatalog(datasets, '京山市').find(row => row.feature.properties.name === name)
  return buildEnterpriseGraph(datasets, center)
}

test('中心企业的一跳子图只收录四家直接相连企业，保留名录外中标方及项目凭证', () => {
  const { nodes, edges } = graph(operator)
  assert.deepEqual([...nodes.values()].map(node => node.name).sort(), [operator, hotel, contractor, club, outside].sort())
  assert.ok([...nodes.values()].every(node => node.kind === 'enterprise'))
  const center = [...nodes.values()].find(node => node.name === operator)
  assert.equal(edges.size, 4)
  assert.ok([...edges.values()].every(edge => (edge.from === center.id || edge.to === center.id) && edge.evidence.length))
  const external = [...nodes.values()].find(node => node.name === outside)
  assert.equal(external.row, undefined)
  const award = [...edges.values()].find(edge => edge.to === external.id)
  assert.equal(award.label, '招标与中标')
  assert.match(award.evidence[0].title, /EPC/)
})

test('切换中心不会引入二跳企业，反向查阅持股仍由股东方指向被投资企业', () => {
  const { nodes, edges, connections } = graph(hotel)
  assert.deepEqual([...nodes.values()].map(node => node.name).sort(), [hotel, operator].sort())
  assert.equal(edges.size, 1)
  const [stake] = edges.values()
  assert.deepEqual([nodes.get(stake.from).name, nodes.get(stake.to).name, stake.label], [operator, hotel, '持股 100%'])
  assert.deepEqual(connections.get(stake.to), [stake])
})

test('同一伙伴多种关系及多份凭证均保留，模拟交易和具名场馆不生成企业节点', () => {
  const purchase = (supplier, receiptNo, extra = {}) => ({ properties: {
    product: '训练器材采购', activity: '按合同供货。', receiptNo, ...extra,
    relationship: { type: '供货', from: supplier, to: operator, status: '已核验' },
  } })
  const first = purchase(club, '合同001')
  const data = [businesses, { id: 'business_relations', features: [
    first, first, purchase(club, '合同002'), purchase(club, '演练003', {simulation:true}),
    purchase('京山市国际网球赛事中心', '场馆001'), purchase('张三', '个人001'),
  ] }]
  const { nodes, edges } = graph(operator, data)
  assert.equal(nodes.size, 5)
  const peer = [...nodes.values()].find(node => node.name === club)
  const pair = [...edges.values()].filter(edge => edge.from === peer.id || edge.to === peer.id)
  assert.deepEqual(pair.map(e => e.label).sort(), ['共同承办','供货'].sort())
  const supplies = pair.find(e => e.label === '供货')
  assert.equal(supplies.from, peer.id)
  assert.deepEqual(supplies.evidence.map(item => item.sources[0].title).sort(), ['合同001','合同002'])
})

test('仅有无关或演示记录的企业只显示中心', () => {
  const maker = '京山市铸梦体育用品有限公司'
  const empty = graph(maker)
  assert.deepEqual([...empty.nodes.values()].map(n => n.name), [maker])
  assert.equal(empty.edges.size, 0)
  const center = buildChainCatalog([businesses], '京山市').find(row => row.feature.properties.name === operator)
  const sample = {...center, feature:{...center.feature, properties:{...center.feature.properties, sample:true}}}
  const example = buildEnterpriseGraph([businesses], sample)
  assert.deepEqual([...example.nodes.keys()], [companyNodeId(center.key)])
  assert.deepEqual(example.connections.get(companyNodeId(center.key)), [])
})
