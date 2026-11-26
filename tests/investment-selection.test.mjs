import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { computed, effectScope, ref } from 'vue'
import { inPolygon } from '../src/jingshan/analytics.ts'
import { rankAvailableParcels, recommendedParcels, parcelPoint, pointsForRecord, isSiteRecord, targetEnterprises } from '../src/jingshan/investment-selection.ts'
import { readDispatch, encodeDispatch } from '../src/jingshan/industry-investment.ts'
import { useInvestmentSelection } from '../src/jingshan/use-investment-selection.ts'
import { geometryStamp, reserveLayerId } from '../src/jingshan/investment-planning.ts'

const industry={id:'chain:器材制造',topic:'器材制造',region:'京山市',anchor:[113.1,31]}
const retail={...industry,id:'chain:购物展销',topic:'购物展销'}
function parcel(id,lon,landUseCode='0601',urbanRelation='inside',region='新市街道'){
  return {type:'Feature',id,geometry:{type:'Point',coordinates:[lon,31]},
    properties:{kind:'available-parcel',name:id,region,landUseCode,urbanRelation,area:12000}}
}

test('按需求、区划和调查地类排序，仅对界内匹配的前三块加推荐章',()=>{
  const parcels=[parcel('跨界',113.1,'0601','crossing'),parcel('较远',113.14),parcel('商服',113.102,'05H1'),
    parcel('最近',113.101),parcel('界外',113.1,'0601','outside'),parcel('第二',113.11),parcel('外镇',113.13,'0601','inside','钱场镇')]
  const ranked=rankAvailableParcels(industry,parcels)
  assert.deepEqual(ranked.map(f=>f.id),['最近','第二','外镇','较远','商服','跨界','界外'])
  assert.deepEqual(recommendedParcels(industry,ranked).map(f=>f.id),['最近','第二','外镇'])
  assert.deepEqual(recommendedParcels(retail,rankAvailableParcels(retail,parcels)).map(f=>f.id),['商服'])
  assert.deepEqual(rankAvailableParcels({...industry,region:'钱场镇'},parcels).map(f=>f.id),['外镇'])
  const large=parcel('连片工业地',113.2)
  large.properties.area=300000
  assert.equal(rankAvailableParcels(industry,[...parcels,large])[0].id,large.id)
  assert.ok(targetEnterprises(industry).includes('网球器材制造企业'))
  assert.ok(targetEnterprises(retail).includes('体育用品零售企业'))
})

test('台账摘要只返回地块内部点，归档图形、调查编号和企业类型均可回看',()=>{
  const rings=[[[113,31],[114,31],[114,32],[113,32],[113,31]],[[113.3,31.3],[113.7,31.3],[113.7,31.7],[113.3,31.7],[113.3,31.3]]]
  const source={type:'Feature',id:'图斑',geometry:{type:'Polygon',coordinates:rings},
    properties:{kind:'investment-reserve',name:'图斑',region:'钱场镇',surveyParcel:'101',surveyId:'A-461111',center:[113.5,31.5]}}
  const point=parcelPoint(source)
  assert.equal(point.geometry.type,'Point')
  assert.equal(inPolygon(point.geometry.coordinates,rings),true)
  assert.equal(point.properties.surveyId,source.properties.surveyId)
  const material={title:'器材制造',direction:'器材生产',department:'招商事务中心',evidence:'项目需求',sites:'图斑',deadline:'2026-12-15',
    assignee:'',requirement:'对接企业',recordKind:'dispatch',enterpriseTypes:targetEnterprises(industry)}
  const archived={id:17,scene:'investment',title:material.title,summary:encodeDispatch(material),features:[source]}
  const display=pointsForRecord(archived)
  assert.deepEqual(display.features,[point])
  assert.equal(archived.features[0].geometry.type,'Polygon')
  assert.deepEqual(readDispatch(display).enterpriseTypes,material.enterpriseTypes)
  assert.ok(isSiteRecord(display))
  assert.equal(isSiteRecord({...display,features:[]}),false)
  assert.equal(isSiteRecord({...display,scene:'venues'}),false)
  assert.equal(readDispatch({...display,summary:encodeDispatch({...material,enterpriseTypes:'历史备注'})}).enterpriseTypes,undefined)
})

test('列表、地图共享同一勾选集，筛选和翻页保留所选，切换需求与版本时独立',async t=>{
  const ring=(lon,lat,size)=>[[lon,lat],[lon+size,lat],[lon+size,lat+size],[lon,lat+size],[lon,lat]]
  const rows=Array.from({length:12},(_,i)=>{
    const lon=113.1+i*.001, f=parcel('图斑'+i,lon)
    const mainland=[ring(lon,31,.0008),ring(lon+.0002,31.0002,.0002)]
    f.geometry=i===0?{type:'MultiPolygon',coordinates:[mainland,[ring(lon+.0009,31,.00005)]]}:{type:'Polygon',coordinates:mainland}
    Object.assign(f.properties,{kind:'investment-reserve',screened:true,inBusinessArea:true,sourceFid:i,screenedBoundary:geometryStamp(f)})
    return f
  })
  const stale={...rows[1],id:'未复核图斑',geometry:{type:'Polygon',coordinates:[ring(113.1,31,.001)]}}
  const lead=ref(),version=ref(7),scope=effectScope()
  const api=t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(url,'/api/jingshan/layers/'+reserveLayerId+'/features.geojson')
    return Response.json({type:'FeatureCollection',features:[...rows,stale]},
      {headers:{'X-Publication-Version':String(version.value)}})
  })
  t.after(()=>scope.stop())
  const list=scope.run(()=>useInvestmentSelection(computed(()=>lead.value),()=>version.value,()=>'京山市',()=>true))
  assert.equal(api.mock.callCount(),0)
  lead.value=industry
  await nextTurn()
  assert.equal(api.mock.callCount(),1)
  assert.equal(list.focus.id,'图斑0')
  assert.deepEqual(list.focus.geometry,rows[0].geometry)
  assert.equal(list.features.length,rows.length)
  assert.deepEqual(list.features.find(f=>f.properties.optionId==='图斑0').geometry,rows[0].geometry)
  assert.ok(list.features.every(f=>f.geometry.type==='Polygon' || f.geometry.type==='MultiPolygon'))
  assert.deepEqual(list.recommended,['图斑0','图斑1','图斑2'])
  assert.deepEqual(list.checkedIds,[])
  list.toggle('图斑0')
  list.page.go(2)
  list.toggle('图斑9')
  list.filters.search='没有这个地块'
  assert.equal(list.filtered.length,0)
  assert.deepEqual(list.features.filter(f=>f.properties.selected).map(f=>f.properties.optionId),['图斑0','图斑9'])
  assert.deepEqual(list.selected.map(f=>f.geometry),[rows[0].geometry,rows[9].geometry])
  list.toggle('图斑0')
  list.resetFilters()
  list.locate('图斑9')
  assert.equal(list.page.page,2)
  assert.equal(list.focus.id,'图斑9')
  lead.value=retail
  assert.deepEqual(list.checkedIds,[])
  lead.value=industry
  assert.deepEqual(list.checkedIds,['图斑9'])
  version.value=8
  await nextTurn()
  assert.equal(api.mock.callCount(),2)
  assert.deepEqual(list.checkedIds,[])
})
