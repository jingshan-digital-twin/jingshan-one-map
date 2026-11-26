import assert from 'node:assert/strict'
import test from 'node:test'
import {buildEventAssessment, defaultAssessmentInputs, locateEventVenue} from '../src/jingshan/event-assessment.ts'
import {loadLiveRoads} from '../src/jingshan/event-live-roads.ts'
import {buildEventReview,defaultReviewId,directionStats,reviewReportSections} from '../src/jingshan/event-post-review.ts'
import {surveyedRoadControls, withSurveyRoads, needsSurveyRoads} from '../src/jingshan/event-survey-roads.ts'
import {roadControlPaint,roadControlPosition,roadControlStyles} from '../src/jingshan/road-controls.ts'
import {trafficRoadsForMap} from '../src/jingshan/event-traffic-proposals.ts'
import {inPolygon} from '../src/jingshan/analytics.ts'
import {eventVenueDetail,eventVenueOverview} from '../src/jingshan/event-venue-map.ts'

const point=(id,name,extra={})=>({id,type:'Feature',geometry:{type:'Point',coordinates:[113.1,31]},properties:{name,kind:'point',region:'京山市',...extra}})
const layer=(id,...features)=>({id,features})

test('未推送的道路建议可分类型预览，已推送和归档地图遵守该版勾选',()=>{
  const closed=point('c','网球路',{action:'封闭建议'}), restricted=point('r','温泉路',{action:'限行建议'})
  const plan={status:'draft',roads:[closed,restricted]}
  const selected=new Set()
  assert.deepEqual(trafficRoadsForMap(plan,selected,'all',null),[closed,restricted])
  assert.deepEqual(trafficRoadsForMap(plan,selected,'限行建议',null),[restricted])
  assert.deepEqual(trafficRoadsForMap(plan,selected,'待联系核实',null),[])
  assert.equal(selected.size,0)
  const sent={...plan,status:'review'}, checked=new Set(['r'])
  assert.deepEqual(trafficRoadsForMap(sent,checked,'all',null),[restricted])
  assert.deepEqual(trafficRoadsForMap(sent,checked,'封闭建议','c'),[closed])
  assert.deepEqual(trafficRoadsForMap({...sent,status:'completed'},checked,'all','c'),[restricted])
})

test('赛前建议按道路面与核心区、缓冲环带相交，源编号、孔洞和其他未推送子项可追溯',()=>{
  const ring=(left,lo,right,hi)=>[[left,lo],[right,lo],[right,hi],[left,hi],[left,lo]]
  const center=[113.1,31]
  const road={id:'surface',type:'Feature',geometry:{type:'Polygon',coordinates:[
    ring(113.0998,30.987,113.1002,31.013),ring(113.09985,30.99985,113.10015,31.00015)]},
    properties:{name:'登记路名',kind:'road-surface',region:'京山市',sourceServiceId:'cim-04',sourceFeatureId:'way-6',sectionName:'东起甲街，西至乙街'}}
  const outside={...road,id:'outside',geometry:{type:'Polygon',coordinates:[ring(113.2,31,113.21,31.01)]}}
  const inputs={bufferM:1000,coreM:300}
  const controls=surveyedRoadControls('event',inputs,center,[road,outside])
  assert.deepEqual(controls.map(r=>r.properties.controlStatus),['closed','restricted'])
  assert.equal(controls[1].geometry.type,'MultiPolygon')
  for(const r of controls){
    const paint=roadControlPaint(r.properties,false)
    assert.equal(paint.fillColor,roadControlStyles[r.properties.controlStatus].color)
    assert.equal(paint.dashed,r.properties.controlStatus==='restricted')
    assert.ok(roadControlPaint(r.properties,true).fillOpacity>paint.fillOpacity)
    const parts=r.geometry.type==='Polygon'?[r.geometry.coordinates]:r.geometry.coordinates
    assert.ok(r.properties.areaM2>0 && r.properties.sourceFeatureId==='way-6')
    assert.ok(parts.some(part=>inPolygon(roadControlPosition(r),part)))
    assert.ok(parts.every(part=>!inPolygon(center,part)))
  }
  const geometry=structuredClone(road.geometry)
  const old={eventId:'event',status:'draft',inputs,position:center,roads:[{...road,id:'old'}],risks:[],taskIds:[],topics:[
    {id:'traffic',items:[{id:'old',title:'未命名道路',featureId:'old'},{id:'parking',title:'停车场'}]},
    {id:'food',items:[{id:'food',title:'餐饮'}]}]}
  const fresh=withSurveyRoads(old,[road])
  assert.ok(needsSurveyRoads(old))
  assert.ok(!needsSurveyRoads(fresh)&&!needsSurveyRoads({...old,status:'review'}))
  assert.deepEqual(old.roads[0].geometry,geometry)
  assert.equal(old.topics[0].items[0].title,'未命名道路')
  assert.deepEqual(fresh.topics[0].items.map(i=>i.title),['登记路名','登记路名','停车场'])
  assert.ok(fresh.topics[0].items[0].detail.includes('平方米'))
  assert.deepEqual(fresh.topics[1],old.topics[1])
})

test('研判总览按场馆台账显示所有已定位场馆，详情仅使用一公里内正式配套',()=>{
  const training=point('training','训练基地')
  const noPosition={...point('empty','待定位场馆'),geometry:null}
  const distant={...point('far','异地餐饮'),geometry:{type:'Point',coordinates:[113.12,31]}}
  const datasets=[layer('venues',training,point('park','未办赛场馆'),noPosition,point('demo','演练场馆',{sample:true})),
    layer('food',point('near','周边餐饮'),distant,point('sample','演练餐饮',{sample:true})), layer('courts',point('court','场地'))]
  const directory=eventVenueOverview(datasets)
  assert.deepEqual(directory.map(f=>f.properties.name),['训练基地','未办赛场馆'])
  assert.ok(directory.every(f=>f.properties.mapRole==='venue' && f.properties.clusterFacilities && f.properties.legendLabel==='网球场馆'))
  assert.equal(locateEventVenue('待定位场馆',datasets).position,null)
  const ring=[[113.1,31],[113.1001,31],[113.1001,31.0001],[113.1,31.0001],[113.1,31]]
  const court=(id,facilityId)=>({...point(id,'场地',{kind:'court-footprint',facilityId}),geometry:{type:'Polygon',coordinates:[ring]}})
  datasets.push(layer('court_footprints',court('own','training'),court('other','park')))
  const detail=eventVenueDetail(datasets,{id:'event',venueNames:['训练基地']},'训练基地')
  assert.equal(detail.fitFeature.properties.radiusKm,1)
  assert.equal(detail.features.find(f=>f.properties.serviceRangeCenter)?.id,training.id)
  assert.deepEqual(detail.features.filter(f=>f.properties.kind==='court-footprint').map(f=>f.id),['own'])
  const neighbors=detail.features.filter(f=>f.properties.mapRole==='support')
  assert.deepEqual(neighbors.map(f=>f.id),['near'])
  assert.equal(neighbors[0].properties.markerStyle,'service-range-pin')
  assert.equal(neighbors[0].properties.legendLabel,'餐饮')
})

test('无明确场馆不画服务圈，未匹配台账的备选场馆不借用首馆坐标或模型',()=>{
  const position=[113.138,30.994], name='京山国际网球中心'
  const event={id:'calendar',venueNames:[name,'另一个场馆'],position}
  assert.equal(eventVenueDetail([],{...event,venueNames:[]},''),undefined)
  assert.equal(eventVenueDetail([],{...event,venueNames:['待定']},'待定'),undefined)
  assert.equal(eventVenueDetail([],event,'另一个场馆'),undefined)
  const detail=eventVenueDetail([],event,name)
  assert.deepEqual(detail.anchor,position)
  assert.ok(detail.calendarLocation)
  assert.equal(detail.venueModelFocus,undefined)
  assert.equal(detail.courtFootprints,undefined)
})

test('赛前以当前发布场馆和配套测算，空路网和样例设施不能生成实地管控建议',()=>{
  const venue=point('surveyed','网球训练基地',{ledgerVenue:true})
  const datasets=[layer('venues',venue,point('other','天裕国际名城网球场')),
    layer('commerce_hotels',point('hotel','已登记住宿',{beds:46})),
    layer('hotels',point('sample','演练酒店',{beds:270,sample:true}))]
  assert.equal(locateEventVenue('网球训练基地',datasets).venue,venue)
  assert.equal(locateEventVenue('另一个国际赛事场地',datasets).position,null)
  const event={id:'registered',year:2026,participants:120,venueNames:['网球训练基地'],name:'周末联赛'}
  const plan=buildEventAssessment(event,{...defaultAssessmentInputs(event),scenario:true},datasets,[],1,'2026-11-24T00:00:00Z')
  assert.equal(plan.lodgingSupply,46)
  assert.equal(plan.parkingSupply,null)
  assert.deepEqual(plan.roads,[])
  assert.ok(plan.features.some(f=>f.id==='hotel'))
  assert.ok(!plan.features.some(f=>f.id==='sample'))
  assert.ok(plan.topics.every(topic=>topic.items.every(item=>!item.id.includes(':mock-road:'))))
  const unknown={...event,name:'新增赛事',position:[113.2,31.3],venueNames:[]}
  const registered=buildEventAssessment(unknown,defaultAssessmentInputs(unknown),datasets,[],2,'2026-11-24T00:00:00Z')
  assert.deepEqual(registered.position,unknown.position)
  assert.equal(registered.features.find(f=>f.id===unknown.id).properties.name,unknown.name)
})

test('真实赛中图层只绘制后台登记的路段，无场馆坐标可继续显示已发布路段',async()=>{
  const road={id:'road01',type:'Feature',geometry:{type:'LineString',coordinates:[[113,31],[113.01,31.1]]},properties:{name:'登记路段',trafficStatus:'closed',kind:'event-live-road'}}
  const event={id:'live',position:null,demo:false,routes:[road,{...road,properties:{...road.properties,demo:true}}]}
  const actual=await loadLiveRoads(event)
  assert.equal(actual.source,'published')
  assert.equal(actual.roads.length,1)
  assert.equal(actual.roads[0].properties.trafficStatus,'closed')
  assert.deepEqual(actual.roads[0].geometry,road.geometry)
  assert.deepEqual((await loadLiveRoads({...event,routes:[]})).roads,[])
})

test('已办赛事实绩优先使用后台记录，未采集的满意度和消费去向留空',()=>{
  const id='event-20261012-open'
  const event=point(id,'测试已办赛事',{status:'已办结',sample:true,players:100,spectators:200,nights:10})
  const actual=point('measure','实绩',{eventId:id,sample:true,players:25,spectators:0,nights:3,occupancyPeak:43})
  const doc={mode:'demo',datasets:[layer('events',event),layer('event_actuals',actual)]}
  const review=buildEventReview(doc,id)
  assert.deepEqual(review.metrics.map(m=>m.value),[25,0,null,43,null,null])
  assert.equal(review.funnel.find(m=>m.label==='住宿消费').value,3)
  assert.deepEqual(review.points,[])
  actual.properties.satisfaction=80
  actual.properties.destinationsJson='[{"group":"dining","name":"餐饮街","visits":8}]'
  const next=buildEventReview(doc,id)
  assert.equal(next.metrics.at(-1).value,80)
  assert.equal(next.points[0].name,'餐饮街')
})

test('公开赛演示复盘可重现原稿，后台修订和正式记录优先',()=>{
  const id='event-20261012-open'
  const open=point(id,'京山网球公开赛',{status:'已办结',sample:true})
  const official=point('finished','正式赛事',{status:'已办结'})
  const actual=point('actual-'+id,'公开赛核验',{eventId:id,sample:true,parkingGap:2})
  const doc={mode:'demo',datasets:[layer('events',open,official),layer('event_actuals',actual),
    layer('tourism',point('tourism-3','已换名的其他项目')),
    layer('form_fusion_destinations',point('current','空山洞景区',{scope:'京山'}))]}
  assert.equal(defaultReviewId(doc,[official.id,id]),id)
  const demo=buildEventReview(doc,id)
  assert.equal(demo.score,92)
  assert.deepEqual(directionStats(demo.points).map(r=>r.share),[38,29,22,11])
  assert.equal(demo.points.find(p=>p.name==='温泉度假区').position,null)
  assert.deepEqual(demo.points.find(p=>p.name==='空山洞景区').position,[113.1,31])
  const sections=reviewReportSections({review:demo,selectedIssues:['parkingGap'],version:1,generatedAt:'2026-10-20',archivedAt:null},[])
  assert.ok(sections.find(s=>s.title==='保障评估').lines.some(row=>row.includes('92 分')))
  assert.ok(sections.find(s=>s.title==='问题与改进').lines[0].includes('纳入复用'))
  assert.equal(buildEventReview({...doc,mode:'live'},id).score,null)
  actual.properties.trafficScore=0
  actual.properties.trendJson='[]'
  assert.equal(buildEventReview(doc,id).score,70)
  assert.deepEqual(buildEventReview(doc,id).trend,[])
  actual.properties.postReview={scores:null,destinations:[]}
  const cleared=buildEventReview(doc,id)
  assert.deepEqual(cleared.scores.map(s=>s.value),[0,null,null,null])
  assert.deepEqual(cleared.points,[])
  doc.datasets[1].features.push(point('official-actual','正式核验',{eventId:official.id,confirmedAt:'2026-10-22',medicalScore:90}))
  assert.equal(defaultReviewId(doc,[id,official.id]),official.id)
  assert.equal(buildEventReview(doc,official.id).score,null)
})
