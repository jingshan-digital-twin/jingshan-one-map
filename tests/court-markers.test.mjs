import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { indexCourtFeatures, layoutCourtMarkers, locateCourtAreas } from '../src/jingshan/court-markers.ts'
import { createFacilityBoundaryIndex } from '../src/jingshan/facility-boundaries.ts'
import { surveyedCourtsInRange } from '../src/jingshan/analytics.ts'
import { courtViews } from '../src/jingshan/court-ledger.ts'

const ledger = JSON.parse(readFileSync(new URL('../server/resource-sources/court-ledger.json',import.meta.url),'utf8'))
const dataset = courtViews(ledger).find(layer=>layer.id==='court_footprints')
const simulated = {...dataset.features[0],id:'fixture:simulated',properties:{
  kind:'court',name:'测试场馆',region:'温泉街道',facilityId:'test-venue',count:15,
}}

test('两级场地统计按发布边界归属，同名村社分开，一片场地在每级只计一次', () => {
  const shape = (id,kind,x,y,w,h,props={}) => ({id,type:'Feature',
    geometry:{type:'Polygon',coordinates:[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]},
    properties:{kind,name:id,region:'台账旧区划',...props}})
  const west = shape('west','town-boundary',0,0,1,1,{adcode:'1'})
  const east = shape('east','town-boundary',1,0,1,1,{adcode:'2'})
  const first = shape('v1','community',0,0,1,.5,{name:'同名村',regionCode:'1'})
  const second = shape('v2','community',1,0,1,1,{name:'同名村',regionCode:'2'})
  const boundaries = createFacilityBoundaryIndex([east,west],[first,second])
  const geometry = (id,x,y) => shape(id,'court-footprint',x,y,.005,.005,{count:99})
  const rows = [geometry('a',.99,.2),geometry('b',.98,.2),geometry('c',1.01,.2),geometry('d',.15,.8)]
  const index = indexCourtFeatures(rows,true,boundaries)
  assert.equal(index.count,4)
  assert.deepEqual([...index.districts].map(([id,group])=>[id,group.count]),[['west',3],['east',1]])
  assert.deepEqual(index.districts.get('west').bounds,[0,0,1,1])
  assert.deepEqual(index.villages.get('v1').bounds,[0,0,1,.5])
  assert.equal(index.villages.get('v1').count,2)
  assert.equal(index.villages.get('v2').count,1)
  assert.equal(index.villages.get('v2').featureId,undefined)
  assert.deepEqual(index.courts.map(court=>[court.feature.id,court.townId,court.villageId]),
    [['a','west','v1'],['b','west','v1'],['c','east','v2'],['d','west',undefined]])
  assert.equal([...index.villages.values()].reduce((sum,g)=>sum+g.count,0),4)
  assert.equal(locateCourtAreas(rows[0],boundaries).village,first)

  const fixed=indexCourtFeatures([...rows].reverse(),true,boundaries,true)
  assert.deepEqual(fixed.districts.get('west').position,[.5,.5])
  assert.deepEqual(fixed.villages.get('v1').position,[.5,.25])
  for(const [scale,groups] of [['town',fixed.districts],['village',fixed.villages]]){
    const projected=[...groups].map(([id,g],i)=>({...g,id,x:240.3+i*3,y:196.7+i*4}))
    const markers=layoutCourtMarkers(projected,scale,600,500,true)
    for(const marker of markers){
      const origin=projected.find(g=>g.id===marker.id)
      assert.deepEqual([marker.x,marker.y,marker.position],[origin.x,origin.y,origin.position])
      assert.equal(marker.leader,undefined)
    }
    assert.equal(markers.length,groups.size)
    assert.ok(markers[0].label)
  }

  for (const [scale,groups] of [['town',index.districts],['village',index.villages]]) {
    const markers = layoutCourtMarkers([...groups].map(([id,g])=>({...g,id,x:250,y:250})),scale,600,500,true)
    assert.equal(markers.length,groups.size)
    assert.ok(markers.every(m=>!m.leader && !m.featureId))
    assert.ok(markers[0].label)
    assert.equal(markers[0].count,scale==='town'?3:2)
    assert.equal(markers[0].townId,'west')
  }
})

test('密集村社徽标最多微调24像素，并优先保留高片数地名', () => {
  const groups = Array.from({length:8},(_,i)=>({
    id:'v'+i,name:'第'+i+'村',position:[112,31],count:i===0?40:1,x:100+(i%4)*14,y:120+Math.floor(i/4)*18,
  }))
  const markers = layoutCourtMarkers(groups,'village',380,260,true)
  assert.equal(markers.length,8)
  assert.ok(markers[0].label)
  assert.deepEqual([markers[0].x,markers[0].y],[100,120])
  for (const marker of markers) {
    const group = groups.find(g=>g.id===marker.id)
    assert.ok(Math.hypot(marker.x-group.x,marker.y-group.y)<=24)
    assert.equal(marker.leader,undefined)
  }
})

test('场馆服务范围按面相交筛实测球场，保留跨边界轮廓，排除模拟场地', () => {
  const rect = (west,south,east,north) => [[west,south],[east,south],[east,north],[west,north],[west,south]]
  const measured = (id,ring) => ({...dataset.features[0],id,geometry:{type:'Polygon',coordinates:[ring]}})
  const range = measured('服务范围',rect(0,0,10,10))
  const inside = measured('另一街道内的球场',rect(2,2,3,3))
  const edge = measured('穿过范围边缘',rect(9,1,14,2))
  const outside = measured('邻近但在范围外',rect(10.1,1,11,2))
  const multipart = {...outside,id:'多部件球场',geometry:{type:'MultiPolygon',coordinates:[outside.geometry.coordinates,inside.geometry.coordinates]}}
  const fixtures = [inside,edge,outside,multipart,{...simulated,geometry:inside.geometry}]
  const selected = surveyedCourtsInRange(fixtures,range)
  assert.deepEqual(selected,[inside,edge,multipart])
  assert.strictEqual(selected[1].geometry,edge.geometry)
  assert.deepEqual(surveyedCourtsInRange(fixtures),[])
  const owned = (feature,id) => ({...feature,properties:{...feature.properties,facilityId:id}})
  const a = owned(edge,'场馆甲'), b = owned(inside,'场馆乙')
  assert.deepEqual(surveyedCourtsInRange([a,b,inside,owned(outside,'场馆甲')],range,'场馆甲'),[a])
})

test('总览按每条实测场地面计一片，同乡镇、附近聚合和明细合计一致', () => {
  const index = indexCourtFeatures([...dataset.features,simulated],true)
  assert.equal(index.count,185)
  assert.equal(index.courts.length,185)
  assert.equal([...index.districts.values()].reduce((total,district) => total + district.count,0),185)
  assert.equal(index.districts.get('温泉街道').count,96)
  assert.equal(index.facilities.size,185)
  assert.ok(index.courts.every(({feature}) => feature.properties.kind === 'court-footprint'))
  const points = [...index.facilities].map(([id,group],i) => ({...group,id,x:100 + (i%10)*3,y:100}))
  const [cluster] = layoutCourtMarkers(points,false,800,600,true)
  assert.equal(cluster.count,185)
  assert.equal(cluster.featureId,undefined)
  for(const point of points) {
    assert.ok(point.position[0] >= cluster.bounds[0] && point.position[0] <= cluster.bounds[2])
    assert.ok(point.position[1] >= cluster.bounds[1] && point.position[1] <= cluster.bounds[3])
  }
})

test('单个实测场地保留原始选择 ID，按片聚合不借用模拟数或场馆关系', () => {
  const row = {...dataset.features[0],properties:{...dataset.features[0].properties,count:20,facilityId:'test-venue'}}
  const index = indexCourtFeatures([row],true)
  const [group] = index.facilities.values()
  const [pin] = layoutCourtMarkers([{...group,id:'map-pin',x:100,y:100}],false,800,600,true)
  assert.equal(pin.count,1)
  assert.equal(pin.featureId,row.id)
  assert.equal(pin.detail,row.properties.name)
  assert.equal(index.districts.get(row.properties.region).featureId,row.id)
  assert.equal(indexCourtFeatures([simulated],true).count,0)
  const legacy = indexCourtFeatures([row,simulated],false)
  assert.equal(legacy.count,15)
  assert.ok(legacy.facilities.has('test-venue'))
})

test('服务专题只聚合范围内传入的实测面，场馆锚点和关联设施不增加片数', () => {
  const courts = dataset.features.filter(f => f.properties.region === '新市街道')
  const anchor = { ...simulated, id:'facility:demo', geometry:{type:'Point',coordinates:[113.13,31.02]},
    properties:{kind:'venue',mapRole:'venue',name:'所选场馆',region:'新市街道',count:4} }
  const support = {...anchor,id:'school',properties:{...anchor.properties,kind:'school',mapRole:'support'}}
  const index = indexCourtFeatures([anchor,support,simulated,...courts],true)
  assert.equal(index.count,34)
  assert.deepEqual([...index.districts.keys()],['新市街道'])
  const markers = layoutCourtMarkers([...index.facilities].map(([id,group],i) => ({
    ...group,id,x:100 + (i % 10) * 4,y:100,
  })),false,800,600,true)
  assert.equal(markers.reduce((sum,item) => sum + item.count,0),34)
  assert.ok(markers.every(item => item.bounds && item.diameter >= 26))
  assert.equal(indexCourtFeatures([anchor,support],true).count,0)
})
