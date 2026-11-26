import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDemands, demandMap, investmentOverview, siteOptions } from '../src/jingshan/investment-demand.ts'
import { eligibleReserve,geometryStamp,groupReserveParcels,matchesReserve,reserveDrillView,reserveLayerId,reserveMapFeature,reserveScaleAt,urbanExtentText,urbanPlacement } from '../src/jingshan/investment-planning.ts'
import { createFacilityBoundaryIndex } from '../src/jingshan/facility-boundaries.ts'
import { assessVenueSupport } from '../src/jingshan/venue-support-demand.ts'
import { denseGapAreas } from '../src/jingshan/investment-population.ts'
import { isCityWhiteModel, isLocalSceneModel } from '../src/jingshan/scene-map.ts'
import { resourceDetailMap } from '../src/jingshan/service-scene-map.ts'
import { venueModelForFocus } from '../src/jingshan/service-model-location.ts'

const feature = (id, properties) => ({type:'Feature',id,geometry:{type:'Point',coordinates:[113.14,31]},properties:{name:id,region:'新市街道',kind:'test',...properties}})
const layer = (id,features) => ({id,features})

test('产业、场馆和配套仅采用完成筛查且在业务范围内的实测地块',()=>{
  const gap=(id,region,population)=>({id,name:id,region,population,reachableCourts:0,gap:2,feature:feature(id,{region})})
  const leads=buildDemands([],'京山市',[gap('B','新市街道',8000),gap('A','新市街道',9000),gap('C','温泉街道',6000)])
  assert.equal(leads.filter(d=>d.category==='chain').length,12)
  assert.deepEqual(leads.filter(d=>d.category==='venue').map(d=>d.blind.id),['A','C'])
  assert.equal(leads.find(d=>d.blind)?.areaPeople,17000)
  const parcel=feature('survey-1',{sourceFid:1,area:900,landUseCode:'1201',landUse:'空闲地',inBusinessArea:true,screened:true})
  parcel.geometry={type:'Polygon',coordinates:[[[113.139,31],[113.141,31],[113.14,31.001],[113.139,31]]]}
  parcel.properties.screenedBoundary=geometryStamp(parcel)
  const outside={...parcel,id:'outside',properties:{...parcel.properties,inBusinessArea:false}}
  const edited={...parcel,id:'edited',geometry:{type:'Polygon',coordinates:[[[114,31],[115,31],[114,32],[114,31]]]}}
  const data=[layer('parcels',[parcel]),layer(reserveLayerId,[parcel,outside,edited])]
  for(const category of ['chain','venue','support']){
    const lead={...leads[0],category,anchor:[113.14,31],radiusM:1000}
    assert.deepEqual(siteOptions(lead,[]),[])
    const options=siteOptions(lead,data)
    assert.deepEqual(options.map(o=>o.id),['survey-1'])
    assert.ok(demandMap(lead,options,options[0].id).features.some(f=>f.id===parcel.id && f.properties.selected))
    if(category!=='chain')assert.equal(siteOptions({...lead,anchor:[113.3,31]},data).length,0)
  }
})

test('建设用地按调查地类检索，镇街计数锚定区划中心，未核实图斑退出比选',()=>{
  const ring=[[[113,31],[113.02,31],[113.02,31.02],[113,31.02],[113,31]]]
  const town={...feature('town',{name:'钱场镇',kind:'town-boundary',center:[113.008,31.01]}),geometry:{type:'Polygon',coordinates:ring}}
  const survey=(id,landUseCode,changes={})=>{
    const plot={...feature(id,{kind:'investment-reserve',region:'钱场镇',surveyUnit:'舒家岭村',landUseCode,sourceFid:71,
      inBusinessArea:true,screened:true,...changes}),geometry:town.geometry}
    plot.properties.screenedBoundary=geometryStamp(plot)
    return plot
  }
  const source=[survey('I','0601'),survey('W','0508'),survey('C','05H1'),survey('mine','0602'),
    survey('outside','1201',{inBusinessArea:false}),survey('demonstration','0601',{sample:true}),survey('unchecked','0601',{screened:false})]
  const ready=source.filter(eligibleReserve)
  assert.deepEqual(ready.map(f=>f.id),['I','W','C'])
  assert.deepEqual(ready.filter(f=>matchesReserve(f,{landUse:'0601',search:'钱场 71'})).map(f=>f.id),['I'])
  const {marker}=groupReserveParcels(ready,[town]).towns.get('reserve-town:town')
  assert.equal(marker.properties.count,3)
  assert.deepEqual(marker.geometry.coordinates,town.properties.center)
  assert.equal(reserveMapFeature(ready[0],true).properties.showLabel,false)
  assert.equal(ready[0].properties.mapRole,undefined)
})

test('储备地块按镇街、村社区逐级展开，数量随筛选，缩远恢复上级',()=>{
  const square=(id,kind,x,width,extra={})=>({
    ...feature(id,{region:'钱场镇',kind,...extra}),
    geometry:{type:'Polygon',coordinates:[[[x,31],[x+width,31],[x+width,31+width],[x,31+width],[x,31]]]},
  })
  const town=square('T','town-boundary',113,.1,{name:'钱场镇'})
  const village=square('V','community',113,.05,{center:[113.012,31.016]})
  const a=square('A','investment-reserve',113.01,.002)
  const b=square('B','investment-reserve',113.03,.002)
  const other=square('C','investment-reserve',113.08,.002)
  const index=createFacilityBoundaryIndex([town],[village])
  const groups=groupReserveParcels([a,b,other],[town],index)
  const parent=groups.towns.get('reserve-town:T'), child=groups.villages.get('reserve-village:V')
  assert.equal(parent.marker.properties.count,3)
  assert.equal(child.marker.properties.count,2)
  assert.deepEqual(child.marker.geometry.coordinates,village.properties.center)
  assert.deepEqual(child.parcels,[a,b])
  assert.deepEqual(groups.withoutVillage,[other])
  const filtered=groupReserveParcels([b],[town],index)
  assert.equal(filtered.villages.get(child.marker.id).marker.properties.count,1)
  const first=reserveDrillView(parent), second=reserveDrillView(child)
  assert.deepEqual(first.features,[town])
  assert.deepEqual(first.anchor,village.properties.center)
  assert.deepEqual(second.features,[a,b])
  assert.ok(second.anchor[0]>=113.01 && second.anchor[0]<=113.012)
  assert.deepEqual([100_000,first.minHeight,first.maxHeight,second.maxHeight,first.maxHeight,100_000].map(h=>reserveScaleAt(h,'city')),
    ['town','village','village','parcel','village','town'])
  assert.equal(reserveScaleAt(100_000,'town'),'village')
  assert.equal(reserveScaleAt(100_000,'community'),'parcel')
})

test('保护线冲突退出比选，城镇开发边界用于排序、筛选和规划核实',()=>{
  const parcel=(id,properties={})=>{
    const f=feature(id,{sourceFid:1,area:900,landUse:'工业用地',landUseCode:'0601',inBusinessArea:true,screened:true,...properties})
    f.geometry={type:'Polygon',coordinates:[[[113.139,31],[113.141,31],[113.14,31.001],[113.139,31]]]}
    f.properties.screenedBoundary=geometryStamp(f)
    return f
  }
  const inside=parcel('z',{urbanRelation:'inside'}),cross=parcel('b',{urbanRelation:'crossing',urbanInsidePercent:99.98})
  const outside=parcel('a',{urbanRelation:'outside'}),old=parcel('legacy')
  const records=[outside,old,inside,cross,parcel('protected',{urbanRelation:'inside',ecologyIntersects:true}),parcel('farmland',{farmlandIntersects:true})]
  const lead={id:'lead',category:'chain',region:'京山市',anchor:[113.14,31]}
  assert.deepEqual(siteOptions(lead,[layer(reserveLayerId,records)]).map(o=>o.id),['z','b','a','legacy'])
  assert.equal(urbanPlacement(old).label,'待核实')
  assert.equal(urbanExtentText(cross),'跨界，界内占比超过 99.9%')
  assert.equal(matchesReserve(cross,{urban:'crossing',town:'新市街道'}),true)
  assert.equal(matchesReserve(inside,{urban:'outside'}),false)
  assert.equal(matchesReserve(outside,{town:'钱场镇'}),false)
})

test('逐馆核查真实设施，圈内零记录和无可用台账分别处理',()=>{
  const v=feature('v',{name:'实测场馆'}), med=feature('hospital',{}), far={...feature('restaurant',{}),geometry:{type:'Point',coordinates:[113.3,31]}}
  const data=[layer('venues',[v,feature('sample-venue',{sample:true})]),layer('medical',[med]),layer('commerce_food',[far]),
    layer('food',[feature('sample-food',{sample:true})]),layer('parking',[feature('demo',{sample:true})])]
  const [assessment]=assessVenueSupport(data,'京山市')
  assert.deepEqual(assessment.missing.map(i=>i.label),['餐饮'])
  assert.deepEqual(assessment.pending.map(i=>i.label),['停车','日用品零售'])
  const leads=buildDemands(data,'京山市',[],1000,'support')
  assert.equal(leads.length,1)
  assert.deepEqual(leads[0].anchor,v.geometry.coordinates)
  const map=demandMap(leads[0],[],'')
  assert.ok(map.features.some(f=>f.id===med.id))
  assert.ok(!map.features.some(f=>f.properties.kind==='investment-parcel'))
})

test('五百米缺口汇总只统计掩膜选中的高密度未覆盖人口',()=>{
  const block={offset:0,people:[80,65,10,20],zones:[0,0,0,1],regions:['甲镇','乙镇'],
    lon:[113,113,113,113],lat:[31,31,31,31]}
  const areas=denseGapAreas({grid:{blocks:[block]},mask:new Uint8Array([13,3,5,13]),bit:8},4000)
  assert.deepEqual(areas.map(a=>[a.region,a.population]),[['甲镇',80],['乙镇',20]])
})

test('两处场馆的配套需求和赛历别称分别匹配已启用的实景瓦片',()=>{
  const model=slug=>({kind:'3dtiles',enabled:true,mapUrl:'/api/jingshan/cim/local-tiles/'+slug+'/tileset.json'})
  const sw=model('tennis-southwest'), ne=model('tennis-northeast')
  const services=[model('central-white'),ne,sw]
  const center={name:'京山国际网球中心',position:[113.137562692,30.993952626]}
  const base={name:'京山网球训练基地',position:[113.140428282,30.996013317]}
  const venues=[center,base].map(({name,position})=>({...feature('ledger-venue:'+name,{name}),geometry:{type:'Point',coordinates:position}}))
  const remoteClinic={...feature('远处医疗点',{}),geometry:{type:'Point',coordinates:[113.18,31.05]}}
  const demands=buildDemands([layer('venues',venues),layer('medical',[remoteClinic])],'京山市',[],1000,'support')
  assert.equal(demands.length,2)
  for (const d of demands) {
    const view=demandMap(d,[],'')
    assert.equal(venueModelForFocus(view.venueModelFocus,services),d.support.venue.properties.name===base.name?ne:sw)
  }
  assert.equal(venueModelForFocus({...center,name:'京山国际网球赛事中心'},services),sw)
  assert.equal(venueModelForFocus({...base,name:'京山网球训练基地（二期）'},services),undefined)
  assert.equal(venueModelForFocus({...center,position:base.position},services),undefined)
  assert.equal(venueModelForFocus(base,[sw,{...ne,enabled:false}]),undefined)
})

test('精模近景只自动启用网球馆；配套建筑须同时属于服务清单且点位落在实测轮廓内',()=>{
  const model=(slug,name)=>({kind:'3dtiles',name,enabled:true,mapUrl:'/api/jingshan/cim/local-tiles/'+slug+'/tileset.json'})
  const city=model('central-white','京山市中心城区白模')
  assert.ok(isCityWhiteModel(city))
  assert.equal(isLocalSceneModel(city),false)
  assert.ok(isLocalSceneModel(model('tennis-southwest','网球中心室内馆')))
  const venue=feature('venue-international',{mapRole:'venue'})
  const provider={...feature('cim-10-e0b958e9683ef1474255f0',{mapRole:'support'}),geometry:{type:'Point',coordinates:[113.1415573,30.97418887]}}
  const buildings=(list,modelEnabled=true)=>resourceDetailMap(venue,list,3,true,modelEnabled).features.filter(f=>f.properties.mapRole==='building')
  assert.equal(buildings([provider])[0].properties.pickFeatureId,provider.id)
  assert.equal(buildings([]).length,0)
  assert.equal(buildings([provider],false).length,0)
  assert.equal(buildings([{...provider,geometry:{type:'Point',coordinates:[113,31]}}]).length,0)
})

test('已交办或在建本身不能充当签约记录，项目概算不能充当到位资金',()=>{
  const projects=[feature('P1',{status:'在建',investment:5000}),feature('P2',{status:'在谈',investment:100})]
  const summary=investmentOverview([layer('projects',projects)],'京山市',[],[])
  const cards=Object.fromEntries(summary.cards)
  assert.equal(cards['签约项目'],'0 项')
  assert.equal(cards['落地项目'],'1 项')
  assert.equal(cards['到位资金'],'待登记')
  assert.equal(summary.conversion,'50.0%')
})

