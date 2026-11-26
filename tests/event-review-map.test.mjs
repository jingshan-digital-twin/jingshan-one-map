import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEventReview, resolveReviewMapVenue, reviewMapFeatures, reviewReportSections, reviewSupportSites } from '../src/jingshan/event-post-review.ts'

const point = (id,name,position,props={}) => ({type:'Feature',id,geometry:{type:'Point',coordinates:position},
  properties:{name,region:'京山市',kind:'point',...props}})
const layer = (id,...features) => ({id,features})

test('复盘按已发布场馆定位，旧示例坐标和含糊场馆不生成配套点',()=>{
  const source = {venue:'京山国际网球中心',position:[113,31],sample:true,points:[]}
  const surveyed = point('venue','京山市国际网球赛事中心',[113.138,30.994])
  const layers = [layer('venues',surveyed)]
  assert.deepEqual(resolveReviewMapVenue(source,layers).position,surveyed.geometry.coordinates)
  assert.equal(resolveReviewMapVenue(source,[]).position,null)
  const unknown=resolveReviewMapVenue({...source,sample:false,venue:'待定'},layers)
  assert.deepEqual(reviewMapFeatures(unknown,'',[]),[])
  assert.deepEqual(reviewSupportSites(layers,unknown),[])
})

test('复盘区分配套与观测，同一住宿点仅绘制一次，分类只显示关联点',()=>{
  const hotel=point('hotel','登记酒店',[113.101,31],{beds:0,address:'温泉路'})
  const layers=[layer('commerce_hotels',hotel),layer('parking',point('parking','场馆停车场',[113.1012,31],{spaces:16}),
    point('exercise','演练停车场',[113.1011,31],{sample:true}),point('remote','远处停车场',[113.15,31])),
    layer('medical',...[1,2,3].map(n=>point('m'+n,'卫生室'+n,[113.1+n/1000,31])))]
  const review={venue:'场馆',position:[113.1,31],points:[
    {id:'d',sourceId:'hotel',datasetId:'commerce_hotels',position:hotel.geometry.coordinates,name:'登记酒店',visits:9,group:'lodging'},
    {id:'unknown',position:null,name:'未定位目的地',visits:3,group:'scenic'},
    {id:'zero',position:[113.105,31],name:'零到访',visits:0,group:'dining'},
  ]}
  const sites=reviewSupportSites(layers,review)
  assert.equal(sites.length,4)
  assert.equal(sites.find(s=>s.kind==='hotels').capacityLabel,'登记床位 0 张')
  assert.equal(sites.find(s=>s.kind==='hotels').observedPointId,'d')
  assert.deepEqual(sites.filter(s=>s.kind==='medical').map(s=>s.name),['卫生室1','卫生室2'])
  const map=reviewMapFeatures(review,'',sites)
  assert.equal(map.filter(f=>f.properties.mapRole==='link').length,1)
  assert.equal(map.filter(f=>f.geometry.type==='Point'&&f.properties.name==='登记酒店').length,1)
  assert.ok(map.some(f=>f.properties.capacityLabel==='登记车位 16 个'))
  assert.deepEqual(reviewMapFeatures(review,'lodging',sites).map(f=>f.id),['review-venue','d-flow','d'])
})

test('归档配套章节使用快照点位的距离和容量，兼容原有报告',()=>{
  const venue=point('v','球馆',[113.1,31]), hotel=point('h','接待酒店',[113.101,31],{beds:120})
  const event=point('e','比赛',[113.2,31],{venue:'球馆',status:'已办结'})
  const doc={mode:'live',datasets:[layer('events',event),layer('venues',venue),layer('hotels',hotel)]}
  const oldReview=buildEventReview(doc,event.id)
  const report={review:oldReview, version:1, selectedIssues:[],generatedAt:'2026-10-10T00:00:00Z',archivedAt:'2026-10-11T00:00:00Z'}
  const site=oldReview.supportSites[0]
  assert.deepEqual(oldReview.position,venue.geometry.coordinates)
  assert.equal(site.capacityLabel,'登记床位 120 张')
  assert.ok(reviewMapFeatures(oldReview,'',oldReview.supportSites).some(f=>f.properties.distanceLabel===site.distanceLabel&&f.properties.capacityLabel===site.capacityLabel))
  hotel.properties.beds=230
  assert.equal(buildEventReview(doc,event.id).supportSites[0].capacityLabel,'登记床位 230 张')
  const section=reviewReportSections(report,[]).find(row=>row.title==='场馆 1 公里内配套点位')
  assert.deepEqual(section.lines,['接待酒店 · 住宿 · 距场馆 '+site.distanceLabel+' · 登记床位 120 张'])
  const {supportSites,...legacy}=oldReview
  assert.ok(!reviewReportSections({...report,review:legacy},[]).some(row=>row.title===section.title))
})
