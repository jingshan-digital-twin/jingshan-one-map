import assert from 'node:assert/strict'
import test from 'node:test'
import {planningInventory,openingPreview,proposalGroups,weeklyWindow} from '../src/jingshan/opening-proposal.ts'
import {capacityFigure,facilityDirectory,nearbyProviders,reverseVenues,supportAssessment} from '../src/jingshan/venue-support.ts'
const f=(id,properties={},x=113)=>({type:'Feature',id,properties:{name:id,region:'孙桥镇',...properties},geometry:{type:'Point',coordinates:[x,31]}})
const ds=(id,features)=>({id,features})
const venue=id=>f(id,{ownership:'学校'})
const court=(id,v,other={})=>f(id,{facilityId:v,ownership:'学校',open:false,lighting:true,...other})
const w=weeklyWindow({days:[6],from:'09:00',until:'12:00'})
const date='2026-11-19'
test('同一居民区与重叠排期去重，预览按所选时段加权，不改正式台账',()=>{
  const data=[ds('venues',[venue('一小'),venue('二小')]),ds('courts',[court('a','一小'),court('b','二小')]),ds('population',[f('片区',{population:100})])]
  const schedule={taskId:'t',venueId:'一小',startsOn:date,endsOn:'',days:[6],from:'09:00',until:'10:00',courtIds:['a'],revision:1}
  const inventory=planningInventory(data,[schedule,schedule],w,date)
  assert.deepEqual(inventory.choices.map(c=>c.missingMinutes),[120,180])
  const result=openingPreview(data,inventory,new Set(['a','b']),{peoplePerCourt:100},'京山市')
  assert.equal(result.hours,5);assert.equal(Math.round(result.totals.beforeOutside),67);assert.equal(result.totals.afterUnserved,0)
  assert.equal(result.improvements.length,1);assert.equal(data[1].features[0].properties.open,false)
  assert.equal(proposalGroups(inventory.choices).length,1);assert.equal(proposalGroups(inventory.choices)[0].venues.length,2)
  assert.equal(planningInventory(data,[{...schedule,until:'12:00'}],w,date).choices.length,1)
})
test('排除维修和无照明室外晚场，允许协调仅白天开放的场地',()=>{
  const data=[ds('courts',[court('a','甲',{open:true,openingHours:'08:00–17:00'}),court('b','甲',{lighting:false,indoor:false}),court('c','乙',{status:'维修'})])]
  assert.deepEqual(planningInventory(data,[],{days:[1],from:'18:00',until:'21:00'},date).choices.map(c=>c.id),['a'])
  assert.throws(()=>weeklyWindow({days:[],from:'09:00',until:'10:00'}))
})
test('周边供应商与反查使用同一半径，训练机构凭已登记人数分类，签约服务额外标识',()=>{
  const data=[ds('training',[f('机构',{coaches:3,sparringPartners:2,venueIds:['远馆']})]),ds('medical',[f('卫生院')])]
  const list=facilityDirectory(data),a={id:'近馆',position:[113,31]},b={id:'远馆',position:[115,31]}
  assert.deepEqual(list.map(i=>i.kind),['coaches','partners','medical'])
  assert.equal(nearbyProviders(a,list,3000).length,3)
  assert.deepEqual(reverseVenues(list[0],[a,b],3000).map(r=>[r.venue.id,r.bound]),[['远馆',true],['近馆',false]])
  assert.equal(reverseVenues(list[2],[a,b],3000).length,1)
})
test('床位、餐位、车位和充电按同一场馆独立测算；缺少余量时只给有依据的结论',()=>{
  const data=[ds('hotels',[f('旅馆',{beds:120,available:100})]),ds('food',[f('餐馆',{seats:240})]),ds('parking',[f('停车',{spaces:100,available:88,charging:12})])]
  const places=nearbyProviders({position:[113,31]},facilityDirectory(data),3000)
  const rows=supportAssessment(places,data,{guests:400,overnight:20,driving:40,perCar:2,dining:80,charging:10,reserve:10})
  assert.deepEqual(rows.map(r=>[r.id,r.maximum,r.sustainable,r.target,r.verdict]),[['beds',120,90,80,'适宜'],['spaces',100,79,80,'不足'],['charging',12,10,8,'余量待核实'],['seats',240,216,320,'不足']])
  assert.equal(rows[3].deficit,104);assert.equal(rows[0].providers[0].feature.id,'旅馆')
})


test('同类商户部分报送时，估算保留已知余量约束',()=>{
  const data=[ds('hotels',[f('甲',{beds:100,available:2}),f('乙',{beds:10})])]
  const places=nearbyProviders({position:[113,31]},facilityDirectory(data),3000)
  const [beds]=supportAssessment(places,data,{guests:100,overnight:70,driving:40,perCar:2,dining:80,charging:10,reserve:10})
  assert.equal(beds.maximum,110);assert.equal(beds.sustainable,10);assert.equal(beds.verdict,'不足');assert.equal(beds.deficit,60)
})

test('周边容量卡保留已知下限，无法汇总数量时只计不同设施',()=>{
  const at={position:[113,31]}
  const inputs={guests:100,overnight:20,driving:40,perCar:2,dining:80,charging:10,reserve:10}
  const hotel=(id,beds,uid)=>f(id,{beds,locationReview:{poi:{uid}}})
  const rows=[hotel('甲',30,'a'),hotel('同店',30,'a'),hotel('乙',undefined,'b')]
  const data=[ds('commerce_hotels',rows),ds('food',[f('门店')]),ds('parking',[f('车场',{spaces:0})])]
  const metrics=datasets=>supportAssessment(nearbyProviders(at,facilityDirectory(datasets),1000),datasets,inputs).map(capacityFigure)
  const figures=metrics(data)
  assert.deepEqual(figures[0],{label:'床位',value:30,unit:'张',minimum:true})
  assert.deepEqual(figures[1],{label:'停车位',value:0,unit:'个',minimum:false})
  assert.deepEqual(figures[3],{label:'餐饮门店',value:1,unit:'家',minimum:false})
  rows[1]=hotel('同店',40,'a')
  assert.deepEqual(metrics(data)[0],{label:'酒店',value:2,unit:'家',minimum:false})
  assert.deepEqual(metrics([])[0],{label:'床位',value:undefined,unit:'张',minimum:false})
})
