import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { courtFootprintDetails } from '../src/jingshan/overview-court-inventory.ts'
import { courtViews, ledgerStatistics, withCourtLedger } from '../src/jingshan/court-ledger.ts'

const layer = JSON.parse(
  await readFile(new URL('../server/resource-sources/court-footprints.json', import.meta.url), 'utf8'),
)

const ledger=JSON.parse(await readFile(new URL('../server/resource-sources/court-ledger.json',import.meta.url),'utf8'))
test('首页按实测场地统计，各类别含缺项，占比使用同一地区的场地数',()=>{
  const city=ledgerStatistics(ledger,'京山市')
  assert.equal(city.courts,185)
  assert.equal(city.venues,75)
  assert.equal(city.unassigned,3)
  assert.deepEqual(['国有','学校','机关单位','民营和社会','村镇','未填'].map(city.ownership),[88,25,29,23,17,3])
  assert.deepEqual(Object.fromEntries(city.opening),{'全天开放':92,'不开放':90,'未填':3})
  assert.equal(ledgerStatistics(ledger,'新市街道').courts,ledger.features.filter(f=>f.properties.region==='新市街道').length)
  assert.equal(ledgerStatistics(undefined,'京山市').courts,undefined)
  assert.equal(ledgerStatistics({features:[]},'京山市').courts,0)
})
test('重新发布台账会同步变更属性、场馆归属、地图边界与统计',()=>{
  const source=structuredClone(ledger)
  const row=source.features.find(f=>f.properties['所属场馆'])
  row.properties['所属场馆']='核验场馆';row.properties['地面类型']='核验面层';row.properties['联系人']='仅管理端'
  const data=withCourtLedger({mode:'live',rules:{},datasets:[source]})
  const [courts,venues,bounds]=courtViews(source)
  const court=courts.features.find(f=>f.properties.ledgerId===row.id)
  const footprint=bounds.features.find(f=>f.properties.courtId===court.id)
  assert.equal(venues.features.find(v=>v.id===court.properties.facilityId).properties.name,'核验场馆')
  assert.equal(Object.fromEntries(courtFootprintDetails(footprint))['地面类型'],'核验面层')
  assert.equal(footprint.properties['联系人'],undefined)
  assert.deepEqual(withCourtLedger(data),data)
})

test('原表未填写的属性和重复标准字段不占据详情', () => {
  const feature = structuredClone(layer.features[0])
  feature.properties.sourceAttributes['面层材料'] = '丙烯酸'
  const properties = Object.fromEntries(courtFootprintDetails(feature))
  assert.equal(properties['面层材料'], '丙烯酸')
  assert.ok(properties.registrationCode)
  assert.ok(properties['登记经度'])
  assert.equal(properties['统一识别码'], undefined)
  assert.equal(properties['SHAPE_AREA'], undefined)
  assert.equal(properties['别名'], undefined)
  assert.equal(properties['status'], undefined)
})
