import assert from 'node:assert/strict'
import test from 'node:test'
import { addAddressMark, addressLayerId, coordinateAddress, findMapAddresses, hasAddressMark, indexMapAddresses } from '../src/jingshan/platform-address-search.ts'

const park = { type: 'Feature', id: 'park-1', geometry: { type: 'Point', coordinates: [113.12,31.02] },
  properties: { name: '文峰公园', kind: 'park', region: '新市街道', address: '城中路与文峰西路交接处' } }
const layer = (id, features) => ({ id, name: id, category: '本地空间数据', department: '本地数据', description: '', features })
const parks = layer('parks', [park])

test('地址、镇街和异体输入可以定位，精确地名优先，未定位记录和人口网格不占据结果', () => {
  const entrance = { ...park, id: 'gate', properties: { ...park.properties, name: '文峰公园北门' } }
  const pending = { ...park, id:'pending', geometry:{type:'GeometryCollection',geometries:[]} }
  const grid = layer('worldpop_population_2025', [park])
  const index = indexMapAddresses([grid, layer('parks', [entrance, pending, park])])
  assert.equal(index.length, 2)
  assert.equal(findMapAddresses(index, '文峰公园')[0].sourceKey, 'parks:park-1')
  for (const query of ['京山市城中路', '湖北省荆门市京山市 新市街道　文峰西路', '京山市新市街道城中路']) {
    assert.equal(findMapAddresses(index, query).length, 2, query)
  }
  assert.deepEqual(findMapAddresses(index, '城中路9999号'), [])
})

test('同名异址分别保留，重合的同名几何优先使用当前图层', () => {
  const other = { ...park, id: 'far', geometry: { type: 'Point', coordinates: [113.2,31.2] } }
  const result = findMapAddresses(indexMapAddresses([parks, layer('survey', [park,other])]), '文峰公园', 'survey')
  assert.deepEqual(result.map(p => p.sourceKey), ['survey:park-1','survey:far'])
})

test('导入图层中的坐落字段、镇街和村社区可用于地址检索', () => {
  const imported = { ...park, properties: { name: '体育公园', kind: 'park',
    sourceAttributes: { zl: '文峰西路36号', xzjxzqhmc: '新市街道', sqjcwhmc: '文峰社区' } } }
  const index = indexMapAddresses([layer('imported', [imported])])
  for (const q of ['京山市文峰西路36号', '新市街道文峰社区体育公园', '文峰社区 西路']) {
    assert.equal(findMapAddresses(index, q)[0]?.sourceKey, 'imported:park-1')
  }
})

test('定位点落在有孔面、多段道路和多点要素自身的位置上', () => {
  const shape = (name, geometry) => ({ ...park, id:name, properties:{ ...park.properties, name }, geometry })
  const features = [
    shape('环形公园', {type:'Polygon', coordinates:[
      [[110,30],[114,30],[114,34],[110,34],[110,30]],
      [[111,31],[113,31],[113,33],[111,33],[111,31]],
    ]}),
    shape('分段道路', {type:'MultiLineString', coordinates:[
      [[110,30],[110,31]], [[112,30],[112,34],[114,34]],
    ]}),
    shape('多处入口', {type:'MultiPoint',coordinates:[[112,31],[113,31]]}),
  ]
  const index = indexMapAddresses([layer('locations', features)])
  const [x,y] = findMapAddresses(index, '环形公园')[0].position
  assert.ok(x >= 110 && x <= 114 && y >= 30 && y <= 34)
  assert.ok(x < 111 || x > 113 || y < 31 || y > 33)
  assert.deepEqual(findMapAddresses(index, '分段道路')[0].position, [112,33])
  assert.deepEqual(findMapAddresses(index, '多处入口')[0].position, [112,31])
})

test('WGS84 经纬度可直接定位，非法或颠倒的经纬度不会被当作位置', () => {
  assert.deepEqual(coordinateAddress('１１３．１２，３１．０２').position, [113.12,31.02])
  assert.deepEqual(findMapAddresses([], '113.12 31.02')[0].position, [113.12,31.02])
  for (const query of ['31.02,113.12','181,31','113,','文峰 113 31']) assert.equal(coordinateAddress(query), undefined)
})

test('新增地址写入独立点图层，重复定位和保存后重新搜索都不会重复添加', () => {
  const draft = { mode: 'live', rules: {}, datasets: [parks] }
  const [place] = findMapAddresses(indexMapAddresses(draft.datasets), '文峰公园')
  const updated = addAddressMark(draft, place)
  const marks = updated.datasets.find(layer => layer.id === addressLayerId)
  assert.equal(draft.datasets.length, 1)
  assert.equal(updated.datasets[0], parks)
  assert.deepEqual(marks.features[0].geometry, park.geometry)
  assert.equal(marks.features[0].properties.address, park.properties.address)
  assert.equal(marks.features[0].properties.sourceKey, 'parks:park-1')
  assert.equal(addAddressMark(updated, place), updated)
  const reloaded = structuredClone(updated)
  const [saved] = findMapAddresses(indexMapAddresses(reloaded.datasets), '文峰公园', addressLayerId)
  assert.equal(hasAddressMark(reloaded.datasets[1], saved), true)
  assert.equal(addAddressMark(reloaded, saved), reloaded)
  const manual = { name: '新地址', region: '', address: '新地址', position: [113.32,30.95], source: '地图选点' }
  const withManual = addAddressMark(reloaded, manual)
  assert.equal(withManual.datasets[1].features.length, 2)
  assert.equal(addAddressMark(withManual, manual), withManual)
  assert.deepEqual(findMapAddresses(indexMapAddresses(withManual.datasets), '新地址')[0].position, manual.position)
})
