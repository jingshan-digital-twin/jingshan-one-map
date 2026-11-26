import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildChainCatalog, buildPanoramaCatalog, scopeEnterprises } from '../src/jingshan/industry-panorama.ts'
import { panoramaProviderGroup, tourismProviderId } from '../src/jingshan/tourism-providers.ts'
import { fusionDestinationsId } from '../src/jingshan/fusion-destinations.ts'
import { industry } from '../src/jingshan/analytics.ts'
import { v3Panels } from '../src/jingshan/v3-panels.ts'

function record(id, name, properties = {}, positioned = true) {
  return { id, type: 'Feature', properties: { name, region: '绿林镇', ...properties },
    geometry: positioned ? { type: 'Point', coordinates: [113.1, 31.1] } : { type: 'GeometryCollection', geometries: [] } }
}

test('体育培训归中游，已登记主体保留其原有环节及各培训地点', () => {
  const sports = { providerType: '培训机构', classification: '体育类' }
  const agency = record('travel', '绿林旅行社', { providerType: '旅行社' })
  const club = record('club', '绿林网球俱乐部', { providerType: '网球俱乐部' })
  const records = [
    record('fitness', '乙体育培训', sports, false),
    record('branch', '乙体育培训', { ...sports, region: '钱场镇' }),
    record('tennis', '丙网球学校', sports),
    record('arts', '网球文化艺术学校', { providerType: '培训机构', classification: '文化艺术类' }),
    record('sample', '演示体育培训', { ...sports, sample: true }),
    record('unknown', '其他机构', { providerType: '培训机构' }),
    agency, club,
  ]
  assert.deepEqual(records.map(panoramaProviderGroup), ['体育培训','体育培训','体育培训',undefined,undefined,undefined,'旅行社','网球俱乐部'])
  const inputs = [
    { id: 'businesses', features: [record('existing', '乙体育培训', { chainTopics: ['赛事组织'] }, false)] },
    { id: tourismProviderId, features: records },
  ]
  const city = buildPanoramaCatalog(inputs, '京山市')
  assert.equal(city.length, 4)
  const training = scopeEnterprises(city, '中游', '培训陪练')
  assert.equal(training.length, 2)
  const original = training.find(row => row.feature.id === 'existing')
  assert.equal(scopeEnterprises(city, '中游', '赛事组织')[0].key, original.key)
  assert.deepEqual(original.records.map(row => row.feature.id), ['existing','fitness','branch'])
  assert.deepEqual(original.points.map(row => row.feature.id), ['branch'])
  assert.equal(original.records[1].feature.properties.mainBusiness, '体育培训')
  assert.equal(training.find(row => row.feature.id === 'tennis').feature.properties.mainBusiness, '网球培训')
  const local = scopeEnterprises(buildPanoramaCatalog(inputs, '绿林镇'), '中游', '培训陪练')
  assert.equal(local.find(row => row.key === original.key).points.length, 0)
})

test('产业全景合并已发布主体，保留跨镇经营点和未定位机构', () => {
  const company = '甲旅游开发有限公司'
  const club = '乙网球俱乐部'
  const inputs = [
    { id: 'businesses', features: [record('corp', company, { chainTopics: ['景区游览'] })] },
    { id: tourismProviderId, features: [
      record('club', club, { providerType: '网球俱乐部' }),
      record('branch', '丙旅行社门市部', { providerType: '旅行社' }, false),
      record('arts', '丁文化艺术学校', { providerType: '培训机构', classification: '文化艺术类', address: '网球场旁' }),
    ] },
    { id: fusionDestinationsId, features: [
      record('park', '绿林景区', { scope: '京山', operator: company, category: '景区' }),
      record('spring', '钱场温泉', { scope: '京山', operator: company, category: '温泉', region: '钱场镇', scaleEnterprise: '是' }),
      record('village', '乡村游览地', { scope: '京山', operator: '村集体' }),
      record('outside', '市外景区', { scope: '荆门', operator: '外地公司' }),
    ] },
  ]
  assert.equal(buildChainCatalog(inputs, '京山市').length, 1)
  const city = buildPanoramaCatalog(inputs, '京山市')
  assert.equal(city.length, 3)
  assert.equal(industry(inputs, '京山市', true).total, city.length)
  assert.equal(scopeEnterprises(city, '中游', '俱乐部运营')[0].feature.properties.name, club)
  assert.equal(scopeEnterprises(city, '下游', '景区游览').length, 2)
  assert.equal(city.find(row => row.feature.id === 'branch').points.length, 0)
  const operator = scopeEnterprises(city, '下游', '运动康养')[0]
  assert.equal(operator.feature.properties.aboveScale, true)
  assert.equal(operator.aboveThreshold, false)
  assert.deepEqual(operator.points.map(point => point.feature.id), ['corp','park','spring'])
  assert.ok(operator.points.every(point => point.feature.properties.panoramaEntityKey === operator.key))
  const [local] = buildPanoramaCatalog(inputs, '钱场镇')
  assert.equal(local.key, operator.key)
  assert.equal(local.feature.properties.name, company)
  assert.deepEqual(local.records.map(row => row.feature.id), ['spring'])
  assert.equal(local.points[0].feature.properties.name, '钱场温泉')
  const republished = inputs.map(dataset => dataset.id === tourismProviderId ? { ...dataset, features: [] } : dataset)
  assert.equal(buildPanoramaCatalog(republished, '京山市').length, 1)
  for (const [datasets, region, expected] of [
    [inputs, '京山市', 3],
    [inputs, '钱场镇', 1],
    [republished, '京山市', 1],
    [[inputs[0]], '京山市', 1],
  ]) {
    const { left } = v3Panels('overview', { datasets, region })
    assert.equal(left.metrics.find(item => item.label === '产业链主体')?.value, String(expected))
  }
})
