import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildEnterpriseProximity } from '../src/jingshan/enterprise-proximity.ts'

const point = (coordinates) => ({ type: 'Point', coordinates })
function feature(id, name, geometry, extra = {}) {
  return { id, type: 'Feature', geometry, properties: { name, region: '京山市', kind: 'test', ...extra } }
}
function enterprise(extra = {}) {
  const row = { datasetId: 'businesses', feature: feature('biz', '测试主体', point([113, 31]), {
    locationSource: '已测经营点', locationLabel: '测试经营点', siteNames: ['自营场馆'], ...extra,
  }) }
  return { ...row, key: 'biz', memberships: [{ stage: '下游', topics: ['住宿接待'] }], points: [row] }
}
const layer = (id, features) => ({ id, features })
function subject(topics, extra = {}) {
  const row = enterprise(extra)
  return { ...row, memberships: [{ stage: '下游', topics }] }
}

test('空间连线使用有来源的设施，过滤演示、同址、自营、重复记录和半径外设施', () => {
  const court = (id, name, lon, extra = {}) => feature(id, name, point([lon, 31]), { source: '场地普查', ...extra })
  const datasets = [layer('courts', [
    court('sample', '演示场', 113.001, { sample: true }),
    court('unmarked-sample', '默认球场', 113.001, { source: 'Demo survey' }),
    court('planned', '另一个球场', 113.0015, { sourceAttributes: { objstate: '在建' } }),
    court('missing', '无来源', 113.002, { source: '' }),
    court('far', '远处球场', 113.05),
    court('own-anchor', '同址球场', 113),
    court('own-by-name', '自营场馆', 113.002),
    court('own-by-id', '自营分场', 113.0025),
    court('real', '社区球场', 113.003),
    court('repeat', '社区球场', 113.0031),
  ])]
  const result = buildEnterpriseProximity(datasets, enterprise({ locationFeatureId: 'own-by-id' }))
  assert.equal(result.located, true)
  assert.equal(result.radiusKm, 3)
  assert.deepEqual(result.matches.map(x => x.feature.id), ['real'])
  assert.match(result.matches[0].label, /邻近球场 · 约 290 米/)
  assert.equal(buildEnterpriseProximity(datasets, enterprise(), 0.1).matches.length, 0)
  assert.equal(buildEnterpriseProximity(datasets, enterprise({ locationSource: '' })).located, false)
  assert.equal(buildEnterpriseProximity(datasets, enterprise({ sample: true })).located, false)
})

test('面设施取最近边界，被覆盖记零，位于内环按内环边界测距，支持多面', () => {
  const envelope = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]]
  const outer = envelope(112.99, 30.99, 113.01, 31.01)
  const hole = envelope(112.999, 30.999, 113.001, 31.001)
  const farPart = [envelope(113.1, 31.1, 113.12, 31.12)]
  const nextPart = [envelope(113.002, 30.999, 113.018, 31.001)]
  const polygon = (id, geometry) => feature(id, id, geometry, { source: '测绘成果' })
  const dataset = layer('venues', [
    polygon('包围', { type: 'Polygon', coordinates: [outer] }),
    polygon('有内环', { type: 'Polygon', coordinates: [outer, hole] }),
    polygon('多面', { type: 'MultiPolygon', coordinates: [farPart, nextPart] }),
    polygon('无效环', { type: 'Polygon', coordinates: [[[113,31], [114,31], [114,32], [113,32]]] }),
  ])
  const result = buildEnterpriseProximity([dataset], enterprise(), 0.2)
  assert.deepEqual(result.matches.map(x => x.feature.id), ['包围', '有内环', '多面'])
  assert.equal(result.matches[0].distanceMeters, 0)
  assert.equal(result.matches[0].label, '位于场馆范围内')
  assert.ok(result.matches[1].distanceMeters > 90 && result.matches[1].distanceMeters < 100)
  assert.ok(result.matches[2].distanceMeters > 185 && result.matches[2].distanceMeters < 195)
})

test('文峰公园以公园点位和赛事依据表示，普通学校不会成为网球设施', () => {
  const datasets = [
    layer('cim_parks', [feature('park', '文峰公园', point([113.01, 31]), { sourceServiceId: 'cim-13', source: '京山市公园' })]),
    layer('schools', [feature('school', '中心小学', point([113.001, 31]), { source: '京山市学校' })]),
  ]
  const matches = buildEnterpriseProximity(datasets, enterprise()).matches
  assert.equal(matches.length, 1)
  assert.equal(matches[0].category, '网球赛事举办地')
  assert.match(matches[0].sourceUrl, /sport\.gov\.cn/)
  assert.match(matches[0].method, /公园 CIM 标注点/)
})

test('只有实际到场服务参与测距，制造建设、单纯办赛、线上或临时销售即便有坐标也不生成空间边', () => {
  const court = layer('courts', [feature('venue', '网球场', point([113.001, 31]), { source: '体育普查' })])
  for (const company of [
    subject(['器材制造']), subject(['运动服饰']), subject(['场地建设']), subject(['赛事组织']),
    subject(['住宿接待'], { mainBusiness: '仅负责投资，酒店交由其他企业经营。' }),
    subject(['购物展销'], { mainBusiness: '运营线上商城，在嘉年华展销农产品，尚无实体店。' }),
    subject(['购物展销'], { mainBusiness: '向体育门店供货。' }),
    subject(['餐饮服务'], { mainBusiness: '在嘉年华现场供餐。' }),
  ]) {
    const result = buildEnterpriseProximity([court], company)
    assert.equal(result.policy.eligible, false)
    assert.equal(result.matches.length, 0)
  }
  const shop = subject(['器材制造', '购物展销'], { mainBusiness: '在京山直营店提供网球用品零售服务。' })
  const result = buildEnterpriseProximity([court], shop)
  assert.equal(result.policy.eligible, true)
  assert.deepEqual(result.policy.topics, ['购物展销'])
  assert.equal(result.matches.length, 1)
})

test('到场业务匹配相应目的地；注册大楼不能替代接待点', () => {
  const site = (name, other = {}) => feature(name, name, point([113.001, 31]), { source: '本地设施底图', ...other })
  const layers = [
    layer('courts', [site('中心球场')]), layer('tourism', [site('山水景区')]),
    layer('cim_parks', [site('社区游园'), site('体育公园')]), layer('cim_squares', [site('商业广场')]),
    layer('medical', [site('人民医院')]), layer('hotels', [site('某酒店')]), layer('food', [site('某餐厅')]),
  ]
  const hotel = buildEnterpriseProximity(layers, subject(['住宿接待']))
  assert.deepEqual(hotel.matches.map(m => m.name).sort(), ['中心球场', '体育公园', '山水景区'].sort())
  const training = buildEnterpriseProximity(layers, subject(['培训陪练', '赛事组织']))
  assert.deepEqual(training.matches.map(m => m.name).sort(), ['中心球场', '体育公园'].sort())
  assert.ok(training.matches.every(m => m.serviceContext.includes('培训陪练')))
  const registeredOnly = buildEnterpriseProximity(layers, subject(['景区游览'], { locationLabel: '登记地址所在建筑 · 某大酒店' }))
  assert.equal(registeredOnly.policy.eligible, true)
  assert.equal(registeredOnly.located, false)
  assert.deepEqual(registeredOnly.matches, [])
})
