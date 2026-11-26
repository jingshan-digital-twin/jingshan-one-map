import assert from 'node:assert/strict'
import test from 'node:test'
import { readCollectedResources, withCollectedResources, publicResourceData } from '../server/collected-resources.ts'
import {buildChainCatalog, chainMapFeature, scopeEnterprises} from '../src/jingshan/industry-panorama.ts'
import {facilityDetailMap} from '../src/jingshan/service-scene-map.ts'
import { numberedVenueCourts, venueFieldCounts } from '../src/jingshan/court-ledger.ts'
import { checkDataset } from '../src/jingshan/validate.ts'
import { facilityDirectory, nearbyProviders, resourceSupply, supportAssessment, supportSummary, uniqueFacilitySites } from '../src/jingshan/venue-support.ts'

test('初装使用最新逐片场地台账，保留实测面及缺填属性，重装保留后台更新和主动删除',async()=>{
  const pack=await readCollectedResources()
  const source=pack.find(d=>d.id==='tennis1124')
  checkDataset(source)
  assert.equal(source.features.length,221)
  assert.ok(source.features.every(f=>f.properties.kind==='court-footprint'))
  assert.equal(source.features.filter(f=>!f.properties['所属行政区']).length,4)
  const installed=withCollectedResources({mode:'live',rules:{},datasets:[]},[source])
  assert.equal(installed.datasets.find(d=>d.id==='venues').features.length,107)
  assert.equal(installed.datasets.find(d=>d.id==='courts').features.filter(f=>f.properties.open).length,157)
  installed.datasets[0].features=installed.datasets[0].features.slice(1)
  assert.equal(withCollectedResources(installed,[source]),installed)
})

test('采集台账按行号去重，人工修订保留，值班联系信息只保存在管理端数据中', async () => {
  const pack = await readCollectedResources()
  const shelter = pack.find(d => d.id === 'emergency_shelters').features[0]
  const contacts = {[shelter.id]:'测试值班岗'}
  const imported = withCollectedResources({mode:'live',rules:{},datasets:[]},pack,contacts)
  const row = imported.datasets.find(d => d.id === 'emergency_shelters').features[0]
  row.properties.address = '已核实的更新地址'
  const repeated = withCollectedResources(imported,pack,contacts)
  assert.equal(repeated,imported)
  const screenRow = publicResourceData(repeated).datasets.find(d => d.id === 'emergency_shelters').features[0]
  assert.equal(screenRow.properties.address,'已核实的更新地址')
  assert.equal(Object.hasOwn(screenRow.properties,'dutyContact'),false)
  assert.equal(row.properties.dutyContact,'测试值班岗')
})

test('球场台账的联系人和电话留在管理数据，公开图层保留几何和业务属性', () => {
  const properties = {name:'测试球场',region:'新市街道',kind:'court-footprint',权属:'村镇',
    联系人:'测试联系人',联系电话:'测试电话',CONTACT:'测试联系人',PHONE:'测试电话'}
  const row = {type:'Feature',id:'court-1',geometry:{type:'Polygon',coordinates:[]},properties}
  const doc = {mode:'live',rules:{},datasets:[{id:'court_footprints_ledger',features:[row]}]}
  const released = publicResourceData(doc).datasets[0].features[0]
  assert.deepEqual(released.properties,{name:'测试球场',region:'新市街道',kind:'court-footprint',权属:'村镇'})
  assert.deepEqual(released.geometry,row.geometry)
  assert.equal(row.properties.联系电话,'测试电话')
})

test('有坐标的站点按枪计数，待定位单位与未确认投运的枪不作为已知可用量', async () => {
  const data = await readCollectedResources()
  const stations = data.find(d => d.id === 'charging').features
  const pendingStation = stations.find(f => !f.properties.commissionedOn)
  const facilities = facilityDirectory(data)
  const nearby = nearbyProviders({position:pendingStation.geometry.coordinates},facilities,200)
  assert.ok(nearby.some(f => f.feature.id === pendingStation.id))
  assert.ok(nearby.every(f => f.feature.geometry.type === 'Point'))
  const rows = supportAssessment(nearby,data,{guests:300,overnight:50,dining:50,driving:40,perCar:2,charging:20,reserve:10})
  const guns = rows.find(row => row.id === 'charging')
  assert.equal(guns.unit,'把')
  assert.ok(guns.maximum >= pendingStation.properties.gunCount)
  assert.equal(guns.sustainable,undefined)
  assert.equal(guns.availableCount,undefined)
  const seats = rows.find(row => row.id === 'seats')
  assert.equal(seats.unlocated,data.find(d=>d.id==='commerce_food').features.filter(f=>f.geometry.type==='GeometryCollection').length)
  assert.equal(seats.maximum,undefined)
  assert.equal(seats.verdict,'余量待核实')
})

test('已发布台账只补符合原登记的待定位记录，重复导入不覆盖手工修改', async () => {
  const source = (await readCollectedResources()).find(d=>d.id==='commerce_food')
  const [verified,unknown] = [true,false].map(wanted=>source.features.find(f=>Boolean(f.properties.locationReview?.poi)===wanted))
  const old = f => {
    const {locationReview,locationSource,locationRef,...properties} = f.properties
    return {...f,geometry:{type:'GeometryCollection',geometries:[]},properties:{...properties,seats:45}}
  }
  const data = {datasets:[{...source,features:[old(verified),old(unknown)]}],mode:'live',rules:{}}
  const subset = [{...source,features:[verified,unknown]}]
  const merged = withCollectedResources(data,subset)
  const [mapped,pending] = merged.datasets[0].features
  assert.deepEqual(mapped.geometry,verified.geometry)
  assert.equal(mapped.properties.seats,45)
  assert.equal(pending.geometry.type,'GeometryCollection')
  assert.ok(pending.properties.locationReview.note)
  assert.equal(withCollectedResources(merged,subset),merged)
  const previousCheck = structuredClone(data)
  previousCheck.datasets[0].features[0].properties.locationReview = {
    checkedOn:verified.properties.locationReview.checkedOn,note:'第一次核对时只有道路信息。'
  }
  assert.deepEqual(withCollectedResources(previousCheck,subset).datasets[0].features[0].geometry,verified.geometry)
  for(const change of [r=>{r.properties.name+='新店'},r=>{r.properties.address='已迁址'},r=>{r.properties.locationManuallyEdited=true},
    r=>{r.geometry={type:'Point',coordinates:[113.11,31.02]}}]){
    const draft=structuredClone(data)
    change(draft.datasets[0].features[0])
    assert.deepEqual(withCollectedResources(draft,subset).datasets[0].features[0],draft.datasets[0].features[0])
  }
})

test('同一已核实的酒店床位只汇总一次，两个登记数不一致时留待核实', async () => {
  const source=(await readCollectedResources()).find(d=>d.id==='commerce_hotels')
  const rows=source.features.filter(f=>['commerce-hotel-7','commerce-hotel-14'].includes(f.id))
  assert.equal(rows.length,2)
  assert.equal(rows[0].properties.locationReview.poi.uid,rows[1].properties.locationReview.poi.uid)
  const data=[{...source,features:rows}]
  const beds=()=>resourceSupply(nearbyProviders({position:rows[0].geometry.coordinates},facilityDirectory(data),200),data).find(r=>r.id==='beds').maximum
  assert.equal(beds(),102)
  assert.equal(uniqueFacilitySites(facilityDirectory(data)).length,1)
  assert.deepEqual(supportSummary(facilityDirectory(data)),[{kind:'hotels',label:'床位',value:102,unit:'张',count:1}])
  rows[1].properties.beds+=1
  assert.equal(beds(),undefined)
  assert.deepEqual(supportSummary(facilityDirectory(data)),[{kind:'hotels',label:'酒店',value:1,unit:'家',count:1}])
})

test('配套总览区分门店数和完整容量，同一停车充电点在构成图中只占一处', () => {
  const data=[
    {id:'food',features:[{id:'a',properties:{seats:0}},{id:'b',properties:{}}]},
    {id:'parking',features:[{id:'p',properties:{spaces:20,charging:4}}]},
  ]
  const rows=()=>supportSummary(facilityDirectory(data))
  assert.deepEqual(rows(),[
    {kind:'food',label:'餐饮门店',value:2,unit:'家',count:2},
    {kind:'parking',label:'停车位',value:20,unit:'个',count:1},
    {kind:'charging',label:'充电桩',value:4,unit:'个',count:0},
  ])
  data[0].features[1].properties.seats=0
  assert.deepEqual(rows()[0],{kind:'food',label:'餐位',value:0,unit:'个',count:2})
  assert.deepEqual(supportSummary([]),[])
})


test('住宿与餐饮以限上清单作为产业链名录，每家均可在一张图定位', async () => {
  const data = (await readCollectedResources()).filter(layer => ['commerce_hotels','commerce_food'].includes(layer.id))
  const catalog = buildChainCatalog(data,'京山市')
  const facilities = facilityDirectory(data)
  for (const [topic,layerId,count] of [['住宿接待','commerce_hotels',15],['餐饮服务','commerce_food',43]]) {
    const members = scopeEnterprises(catalog,'下游',topic)
    assert.equal(members.length,count)
    assert.equal(new Set(members.map(member => member.feature.id)).size,count)
    for (const member of members) {
      const [point] = member.points
      const source = member.feature
      assert.ok(member.aboveThreshold,source.id)
      assert.equal(point.datasetId,layerId)
      assert.equal(point.feature.id,source.id)
      assert.equal(point.feature.geometry.type,'Point')
      const [lng,lat] = point.feature.geometry.coordinates
      assert.ok(lng>112.6 && lng<113.6 && lat>30.65 && lat<31.65,source.id)
      if (source.geometry.type === 'Point') {
        assert.deepEqual(point.feature.geometry,source.geometry)
        continue
      }
      const address = source.properties.locationReview.chainLocation
      assert.ok(address.label && address.precision && address.reference.uid,source.id)
      assert.deepEqual(point.feature.geometry.coordinates,address.coordinates)
      const item = facilities.find(item=>item.feature.id===source.id)
      const detail = facilityDetailMap(item,[],1)
      assert.deepEqual(detail.anchor,address.coordinates)
      assert.equal(detail.features[0].id,source.id)
      assert.equal(detail.features.length,1)
      assert.ok(!nearbyProviders({position:address.coordinates},[item],1000).length)
    }
  }
  const company = data[0].features.find(f=>f.geometry.type==='GeometryCollection')
  const surveyed = {...company,geometry:{type:'Point',coordinates:[113.12,31.04]}}
  assert.equal(chainMapFeature(surveyed,data[0].id),surveyed)
})

test('逐片选择保留原场号并补齐无编号或重号，完整列出不同开放时段',()=>{
  const court = (id,name,hours='') => ({id,properties:{name,'开放时段':hours}})
  const rows = [court('a','中心场'),court('b','训练基地１０号场','08:00-12:00|14:00-18:00'),
    court('c','公园1号网球场'),court('d','分场1号场')]
  assert.deepEqual(numberedVenueCourts(rows).map(({court,number})=>[court.id,number]),[['c',1],['a',2],['d',3],['b',10]])
  assert.deepEqual(venueFieldCounts(rows,'开放时段'),[['08:00-12:00|14:00-18:00',1],['未填',3]])
})
