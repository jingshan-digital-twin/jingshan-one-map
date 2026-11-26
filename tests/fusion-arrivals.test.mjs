import test from 'node:test'
import assert from 'node:assert/strict'
import { withFusionArrivals } from '../server/fusion-arrivals-source.ts'
import { fusionArrivals, fusionArrivalsId } from '../src/jingshan/fusion-arrivals.ts'
import { checkDataset } from '../src/jingshan/validate.ts'
import { checkPlatformRecord } from '../src/jingshan/platform-forms.ts'

const doc=mode=>({mode,rules:{},datasets:[]})
const official=(id,properties)=>({type:'Feature', id, geometry:{type:'GeometryCollection',geometries:[]},
  properties:{name:id,kind:'form_record',region:'京山市',reportDate:'2026-11-23',rowType:'客源分项',sample:false,sourceName:'汇总表',...properties}})

test('七期演示日报含按日去重汇总，客源具备地图关联，实接模式过滤全部演示记录',()=>{
  const published=withFusionArrivals(doc('demo')), d=published.datasets[0]
  checkDataset(d)
  assert.equal(withFusionArrivals(published),published)
  assert.equal(d.id,fusionArrivalsId)
  const day=fusionArrivals([d],'','demo')
  assert.equal(day.date,'2026-11-24')
  assert.deepEqual([day.people,day.vehicles,day.sample],[2437,765,true])
  assert.equal(day.dates.length,7)
  assert.deepEqual(day.trend.map(r=>r.date),day.dates.toReversed())
  assert.ok(day.origins.every(o=>o.position && o.people!==null && o.vehicles!==null))
  assert.equal(day.origins[0].id,'武汉')
  assert.ok(Math.abs(day.origins.reduce((n,o)=>n+o.share,0)-100)<0.0001)
  assert.equal(fusionArrivals([d],'','live').dates.length,0)
  assert.equal(withFusionArrivals(doc('live')).datasets[0].features.length,0)
})

test('已报实数优先；空值、真实零、缺失来源维度区分，趋势不混入其他来源',()=>{
  const [d]=withFusionArrivals(doc('demo')).datasets
  d.features.push(official('enquiry',{originCity:'恩施土家族苗族自治州',people:0}))
  const partial=fusionArrivals([d],'','demo')
  assert.equal(partial.date,'2026-11-23')
  assert.deepEqual([partial.reported,partial.sample,partial.people,partial.vehicles],[true,false,null,null])
  assert.deepEqual(partial.sources,['汇总表'])
  assert.deepEqual(partial.origins.map(o=>[o.people,o.vehicles,o.share]),[[0,null,null]])
  d.features.push(official('whole',{rowType:'全市汇总',people:10,vehicles:0}))
  d.features.push({...official('location',{originCity:'广州市',people:4}),geometry:{type:'Point',coordinates:[113.26,23.11]}})
  checkDataset(d)
  const day=fusionArrivals([d],'2026-11-23','live')
  assert.deepEqual([day.people,day.vehicles],[10,0])
  assert.deepEqual(day.origins[0].position,[113.26,23.11])
  assert.equal(day.origins[0].share,40)
  assert.ok(day.trend.slice(0,-1).every(r=>r.people===null && r.vehicles===null))
  assert.equal(fusionArrivals([d],'2026-11-24','demo').trend.at(-2).people,null)
  const missing=fusionArrivals([d],'2026-11-30','live')
  assert.deepEqual([missing.reported,missing.vehicles,missing.people],[false,null,null])
})

test('防止重复统计，拒绝负数、无效日期及没有来源地的分项',()=>{
  const [d]=withFusionArrivals(doc('live')).datasets
  const f=official('hubei',{originCity:'武汉市',vehicles:10})
  assert.doesNotThrow(()=>checkPlatformRecord(d,f,[d]))
  for(const p of [{vehicles:-1},{vehicles:1.2},{vehicles:null},{originCity:' '},{rowType:'全市汇总'},{reportDate:'2026-02-31'},
    {sample:'true'},{sourceName:' '}]){
    const row={...f,properties:{...f.properties,...p}}
    assert.throws(()=>checkPlatformRecord(d,row,[d]))
  }
  d.features.push(f,official('hubei-02',{originCity:'武汉',people:12}))
  assert.throws(()=>checkDataset(d),/不能重复/)
})
