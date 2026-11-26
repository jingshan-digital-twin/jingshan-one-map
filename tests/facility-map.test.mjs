import assert from 'node:assert/strict'
import test from 'node:test'
import { distanceM } from '../src/jingshan/analytics.ts'
import { facilityDirectory, facilityDirectoryRows, nearbyFacilitySites, reverseVenues, serviceDetailRadiusKm, serviceDistance, supportSummary } from '../src/jingshan/venue-support.ts'
import { facilityDetailMap, providerPin, resourceDetailMap, supportOverviewMap, venueDetailMap, venuePin } from '../src/jingshan/service-scene-map.ts'
import {layoutServiceCaptions, serviceCaptionResolution, serviceSymbols} from '../src/jingshan/service-point-markers.ts'

function point(id, lon = 113, properties = {}) {
  return { type:'Feature', id, properties:{name:id,region:'京山市',kind:'resource',...properties},
    geometry:{type:'Point',coordinates:[lon,31]} }
}
function venue(id, lon) {
  const feature=point(id,lon,{kind:'venue'})
  return {id,name:id,position:feature.geometry.coordinates,feature}
}

test('全部设施按类别交错展示；同一站点在总览只出现一次，各项服务可独立筛选', () => {
  const providers=facilityDirectory([
    {id:'hotels',features:[point('酒店甲'),point('酒店乙')]},
    {id:'parking',features:[point('充电停车场',113,{charging:8})]},
    {id:'charging',features:[point('充电站')]},
  ])
  const all=facilityDirectoryRows(providers,'')
  assert.deepEqual(all.map(item=>item.feature.id),['酒店甲','充电停车场','充电站','酒店乙'])
  assert.deepEqual(facilityDirectoryRows(providers,'charging').map(item=>item.feature.id),['充电停车场','充电站'])
  const unmapped={...all[0],feature:{...point('待定位酒店'),geometry:{type:'GeometryCollection',geometries:[]}}}
  assert.deepEqual(facilityDirectoryRows([unmapped,...providers],'hotels').map(p=>p.feature.id),['酒店甲','酒店乙','待定位酒店'])
  const view=supportOverviewMap([...all,unmapped])
  assert.equal(view.focus,'county')
  assert.deepEqual(view.features.map(f=>f.id),all.map(f=>f.feature.id))
  assert.ok(view.features.every(f=>f.geometry.type==='Point'&&f.properties.mapRole==='support'))
})

test('名录分别统计景区和温泉，排除避难场所和普通公园，同源商户去重', () => {
  const providers=facilityDirectory([
    {id:'tourism',features:[point('青山景区'),point('山谷浴场',113,{type:'温泉休闲'})]},
    {id:'merchants',features:[
      point('山谷温泉度假区',113,{category:'景区温泉',sourceId:'山谷浴场'}),
      point('城市温泉',113,{category:'温泉'}),
      point('温泉街道体育公园',113,{category:'景区温泉'}),
    ]},
    {id:'cim_parks',features:[point('温泉体育公园')]},
    {id:'emergency',features:[point('疏散点',113,{category:'避难场所'})]},
    {id:'emergency_shelters',features:[point('避难点')]},
  ])
  assert.deepEqual(facilityDirectoryRows(providers,'tourism').map(p=>p.feature.id),['青山景区'])
  assert.deepEqual(facilityDirectoryRows(providers,'springs').map(p=>p.feature.id),['山谷浴场','城市温泉'])
  const rows=supportSummary(providers,true)
  assert.equal(rows.length,10)
  assert.equal(rows.find(r=>r.kind==='springs').count,2)
  assert.equal(rows.find(r=>r.kind==='hotels').count,0)
  assert.equal(rows.reduce((n,r)=>n+r.count,0),3)
})

test('设施服务圈中的场馆图标与右栏距离使用同一半径及场馆清单', () => {
  const [provider]=facilityDirectory([{id:'parking',features:[point('停车场')]}])
  const venues=[venue('近馆',113.003),venue('远馆',113.018),venue('圈外',113.06)]
  for(const km of [1,3,5]){
    const served=reverseVenues(provider,venues,km*1000)
    const view=facilityDetailMap(provider,served,km)
    assert.equal(view.focus,'area')
    assert.deepEqual(view.anchor,provider.feature.geometry.coordinates)
    assert.equal(view.features.some(f=>f.geometry.type==='LineString'||f.properties.mapRole==='link'),false)
    const range=view.features.find(f=>f.properties.mapRole==='range')
    assert.equal(view.fitFeature,range)
    assert.ok(Math.abs(distanceM(view.anchor,range.geometry.coordinates[0][0])-km*1000)<5)
    const pins=view.features.filter(f=>f.properties.mapRole==='venue' && f.properties.markerStyle==='service-range-pin')
    assert.deepEqual(pins.map(f=>f.id),served.map(s=>s.venue.id))
    assert.ok(pins.every(f=>f.properties.clusterFacilities))
    assert.deepEqual(pins.map(f=>f.properties.label),served.map(row=>row.venue.name+' · '+serviceDistance(row.meters)))
    assert.equal(view.features.find(f=>f.id===provider.feature.id).properties.legendLabel,'当前设施')
  }
})

test('圈外登记关系留在台账，未定位的设施不绘制服务圈或关联点', () => {
  const center=point('教练服务点',113,{venueIds:['登记场馆']})
  const venues=[venue('近馆',113.001),venue('登记场馆',114)]
  const item={kind:'coaches',layer:'coaches',feature:center}
  const registered=reverseVenues(item,venues,1000)
  assert.ok(registered.some(row=>row.venue.id==='登记场馆'&&row.bound))
  const map=facilityDetailMap(item,registered,serviceDetailRadiusKm)
  assert.deepEqual(map.features.filter(f=>f.properties.mapRole==='venue').map(f=>f.id),['近馆'])
  const missing={...item,feature:{...center,geometry:{type:'GeometryCollection',geometries:[]}}}
  const view=facilityDetailMap(missing,reverseVenues(missing,venues,1000),1)
  assert.equal(view.focus,undefined)
  assert.equal(view.facilityView,'detail')
  assert.deepEqual(view.features,[])
})

test('设施仅展示一公里内的场馆、景区、温泉；场馆档案仍展示周边配套',()=>{
  const here=[113,31]
  const layers=[
    {id:'hotels',features:[point('酒店')]},
    {id:'food',features:[point('餐馆',113.003),point('圈外餐馆',113.015)]},
    {id:'tourism',features:[point('景区',113.004),point('圈外景区',113.035)]},
    {id:'springs',features:[point('温泉',113.006)]},
    {id:'merchants',features:[point('商店',113.004,{category:'购物'}),point('餐饮归档',113.003,{category:'餐饮'})]},
    {id:'emergency_shelters',features:[point('应急点',113.005)]},
    {id:'medical',features:[point('卫生院',113.006)]},
    {id:'training',features:[point('培训中心',113.007,{coaches:3,sparringPartners:2})]},
  ]
  const providers=facilityDirectory(layers)
  const focus=providers.find(f=>f.kind==='hotels')
  const nearby=nearbyFacilitySites(here,providers,serviceDetailRadiusKm*1000,'酒店')
  const localVenue=venue('场馆',113.002)
  const attached=facilityDetailMap(focus,reverseVenues(focus,[localVenue],1000),1,providers)
  assert.deepEqual(new Set(attached.features.filter(f=>f.geometry.type==='Point').map(f=>f.id)),new Set(['酒店','温泉','景区','场馆']))
  assert.equal(attached.facilityView,'detail')
  assert.equal(attached.courtFootprints,undefined)
  assert.ok(nearby.some(item=>item.kind==='food'))
  const venueView=venueDetailMap(localVenue,providers,1,false)
  const mixed=resourceDetailMap(venuePin(localVenue,true),[venuePin(venue('邻近场馆',113.004)),...providers.map(f=>providerPin(f))],1,true,false)
  assert.deepEqual(mixed,venueView)
  for(const view of [attached,venueView]){
    const pins=view.features.filter(f=>f.geometry.type==='Point')
    const kind = f => f.properties.supportKind ?? f.properties.mapRole
    if(view===venueView){
      assert.deepEqual(new Set(pins.map(kind)), new Set(['hotels','food','tourism','springs','shopping','medical','coaches','venue']))
      assert.equal(view.venueDetail,true)
      assert.deepEqual(view.courtFootprints,{radiusM:1000,facilityId:localVenue.id})
      assert.deepEqual(pins.filter(f=>f.properties.mapRole==='venue').map(f=>f.id),[localVenue.id])
      assert.deepEqual(view.features.filter(f=>f.properties.serviceRangeCenter).map(f=>f.id),[localVenue.id])
      assert.ok(pins.every(f=>f.properties.markerStyle==='service-range-pin'&&f.properties.clusterFacilities))
      assert.equal(pins.find(f=>f.id===localVenue.id).properties.legendLabel,'当前场馆')
    }
    assert.ok(pins.every(f=>f.properties.color === serviceSymbols[kind(f)].color))
    assert.equal(new Set(pins.map(f=>f.id)).size,pins.length)
    assert.ok(pins.every(f=>distanceM(view.anchor,f.geometry.coordinates)<=1000))
    assert.deepEqual(view.features.filter(f=>f.properties.mapRole==='range').map(f=>f.properties.radiusKm),[1])
    assert.equal(view.features.some(f=>f.geometry.type==='LineString'),false)
    assert.equal(view.fitFeature.properties.radiusKm,1)
  }
})

test('选中单位可以显示名称，其他设施只在精细缩放时显示互不遮挡的全名', () => {
  const sites = Array.from({length:24}, (_,i) => ({
    id:String(i), name:'配套单位' + i, selected:i === 0,
    x:60 + (i % 6) * 92, y:80 + Math.floor(i / 6) * 95, metersPerPixel:8,
  }))
  assert.deepEqual(layoutServiceCaptions(sites,600,500,'1').map(c => c.name), ['配套单位0'])
  assert.deepEqual(layoutServiceCaptions(sites.map(p => ({...p,selected:false})),600,500), [])

  const close = sites.map(p => ({...p,metersPerPixel:serviceCaptionResolution}))
  close[1] = {...close[1],x:close[0].x,y:close[0].y}
  const captions = layoutServiceCaptions(close.reverse(),600,500,'1')
  assert.equal(captions[0].id,'0')
  assert.ok(captions.length > 1)
  assert.ok(captions.every(c => c.id !== '1' && c.name === '配套单位' + c.id))
  captions.forEach((a,i) => assert.ok(captions.slice(i+1).every(b =>
    Math.abs(a.x-b.x)*2 >= a.width+b.width || Math.abs(a.y-b.y) >= 28)))
})
