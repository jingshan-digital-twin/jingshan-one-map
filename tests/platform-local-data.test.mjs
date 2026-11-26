import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { courtLedgerId, courtMapSlot, courtServiceId, withCourtViews } from '../src/jingshan/court-ledger.ts'
import { checkDatasetRemovals } from '../src/jingshan/resource-removal.ts'
import { prepareGeoImport, removeLocalFeature, withLocalDataset } from '../src/jingshan/platform-local-data.ts'
import { localFields, extraProperties, applyLocalProperties } from '../src/jingshan/local-feature-fields.ts'

const row = (id,properties = {}) => ({type:'Feature', id, geometry:{type:'Point',coordinates:[113.1,31.1]},properties})
const one = row('o1',{name:'旧场馆',region:'新市街道',kind:'venue',capacity:50,sourceServiceId:'svc-1'})
const two = row('o2',{name:'其他场馆',region:'京山市',kind:'venue'})
const source = {serviceId:'svc-1',serviceName:'场馆服务',syncedAt:'2026-11-01T00:00:00Z',count:2}
const layer = {id:'venues',name:'场馆',department:'文旅局',category:'体育',description:'',source,features:[one,two]}
const other = {...layer,id:'extra',features:[row('global-key',{name:'停车场',region:'京山市',kind:'parking'})]}
const draft = {mode:'live',rules:{},datasets:[layer,other]}
const collection = (...features) => ({type:'FeatureCollection',features})
const plan = (input,mode) => prepareGeoImport(draft,layer,input,mode)

test('按 ID 批量更新保留未提供属性、本地记录、来源与其他数据集',() => {
  const input = collection(row('o1',{name:'更新名称'}),row(17,{'名称':'公园入口','所属乡镇':'三阳镇'}))
  const result = plan(input,'merge')
  assert.deepEqual([result.added,result.updated,result.removed,result.total],[1,1,0,3])
  const updated = result.data.datasets[0]
  assert.deepEqual(updated.features.map(x=>x.id),['o1','o2','17'])
  assert.deepEqual(updated.features[0].properties,{...one.properties,name:'更新名称'})
  assert.equal(updated.features[2].properties.region,'三阳镇')
  assert.equal(updated.features[2].properties.name,'公园入口')
  assert.equal(updated.source,source)
  assert.equal(result.data.datasets[1],other)
  assert.equal(draft.datasets[0].features[0].properties.name,'旧场馆')
})
test('追加和替换预览独立计数，非法或跨集冲突的批次不会产生部分修改',() => {
  const append = plan(collection(row(undefined,{name:'无编号新要素'})),'append')
  assert.deepEqual([append.added,append.updated,append.removed,append.total],[1,0,0,3])
  assert.match(append.data.datasets[0].features[2].id,/^venues-/)
  const replace = plan(collection(row('o1'),row('new')),'replace')
  assert.deepEqual([replace.added,replace.updated,replace.removed,replace.total],[1,1,1,2])
  assert.throws(()=>plan(collection(row('o1')),'append'),/已有 ID/)
  assert.throws(()=>plan(collection(row('new'),row('global-key')),'merge'),/重复要素 ID/)
  assert.throws(()=>plan(collection(row('new'),row('new')),'replace'),/文件内存在重复/)
  assert.throws(()=>plan(collection(row(undefined)),'merge'),/缺少要素 ID/)
  assert.throws(()=>plan(collection({...row('bad'),geometry:{type:'Point',coordinates:[300,900]}}),'replace'),/WGS84/)
  assert.throws(()=>plan({...collection(row('new')),crs:{type:'name',properties:{name:'EPSG:3857'}}},'append'),/WGS84/)
  assert.equal(draft.datasets[0].features.length,2)
})
test('无坐标企业以待定位状态保存，其他缺少几何的图层保持校验',() => {
  const input = collection({...row('enterprise',{kind:'business'}),geometry:null})
  const businesses = {...layer,id:'businesses',source:undefined,features:[]}
  const data = {...draft,datasets:[businesses,other]}
  const result = prepareGeoImport(data,businesses,input,'append')
  assert.deepEqual(result.data.datasets[0].features[0].geometry,{type:'GeometryCollection',geometries:[]})
  assert.throws(()=>plan(collection({...row('missing'),geometry:null}),'append'),/WGS84/)
})
test('要素表单按样本推断控件，新建记录不带入样本值，未修改的字段和类型原样保留',() => {
  const sample = {name:'甲',region:'京山市',kind:'venue',open:false,count:17,ownership:'国有',openingHours:'',facilityId:'001',
    sourceAttributes:{name:'甲'},sourceServiceId:'cim-01',registeredAt:'旧值',openDate:null,'开放日期':'2026-06-01'}
  const dataset = {...layer,features:[row('f',sample)]}
  const controls = localFields(dataset,sample)
  const lookup = Object.fromEntries(controls.map(f=>[f.key,[f.label,f.type]]))
  assert.deepEqual(lookup.open,['对外开放','boolean'])
  assert.deepEqual(lookup.count,['场地总数','number'])
  assert.deepEqual(lookup['开放日期'],['开放日期','date'])
  assert.deepEqual(lookup.facilityId,['场馆编号','text'])
  assert.deepEqual(extraProperties(controls,sample),{sourceAttributes:{name:'甲'},sourceServiceId:'cim-01',registeredAt:'旧值',openDate:null})
  const {name,region,kind,...expected} = sample
  const extras = extraProperties(controls,sample)
  assert.deepEqual(applyLocalProperties(controls,sample,{},extras),expected)
  assert.deepEqual(applyLocalProperties(controls,{}, {},{}),{})
  assert.deepEqual(applyLocalProperties(controls,sample,{count:'0',open:'true'},extras),{...expected,count:0,open:true})
  assert.deepEqual(applyLocalProperties(controls,{}, {count:'0',open:'false'},{}),{count:0,open:false})
  assert.throws(()=>applyLocalProperties(controls,sample,{count:'1'},{...extras,count:8}),/已有业务字段/)
  assert.throws(()=>applyLocalProperties(controls,sample,{}, {name:'另一个名称'}),/基础字段/)
})

test('从真实逐片台账删除一片，只更新该片和所属场馆的汇总，保留服务绑定',()=>{
  const ledger=JSON.parse(readFileSync(new URL('../server/resource-sources/court-ledger.json',import.meta.url),'utf8'))
  const bindings=[{slot:courtMapSlot,scope:'all',serviceId:courtServiceId}]
  const data=withCourtViews({mode:'live',rules:{},datasets:[other],mapBindings:bindings},ledger)
  const find=(doc,id)=>doc.datasets.find(d=>d.id===id)
  const allVenues=find(data,'venues').features
  const venue=allVenues.find(v=>v.properties.count===35)
  const row=ledger.features.find(f=>f.properties['所属场馆']===venue.properties.name)
  const next=removeLocalFeature(data,courtLedgerId,row.id)
  assert.doesNotThrow(()=>checkDatasetRemovals(data,next,undefined))
  assert.equal(next.mapBindings,bindings)
  assert.equal(find(next,'extra'),other)
  assert.equal(ledger.features.length,185)
  assert.equal(find(next,courtLedgerId).features.length,184)
  assert.deepEqual(find(next,courtLedgerId).features,ledger.features.filter(f=>f.id!==row.id))
  for (const id of ['courts','court_footprints']) {
    assert.deepEqual(find(next,id).features,find(data,id).features.filter(f=>f.properties.ledgerId!==row.id))
    assert.throws(()=>removeLocalFeature(data,id,find(data,id).features[0].id),/源数据集/)
    assert.throws(()=>withLocalDataset(data,{...find(data,id),features:[]}),/展示图层/)
  }
  const venues=find(next,'venues').features
  assert.equal(venues.length,75)
  assert.equal(venues.find(v=>v.id===venue.id).properties.count,34)
  assert.deepEqual(venues.filter(v=>v.id!==venue.id),allVenues.filter(v=>v.id!==venue.id))
  assert.throws(()=>removeLocalFeature(next,courtLedgerId,row.id),/不存在/)
  const singleton=allVenues.find(v=>v.properties.count===1)
  const singleCourt=ledger.features.find(f=>f.properties['所属场馆']===singleton.properties.name)
  const withoutVenue=removeLocalFeature(data,courtLedgerId,singleCourt.id)
  assert.deepEqual(find(withoutVenue,'venues').features,allVenues.filter(v=>v.id!==singleton.id))
  assert.equal(find(withoutVenue,courtLedgerId).features.length,184)
})

test('删掉数据集最后一条记录仍保留空数据集及其元信息',()=>{
  const next=removeLocalFeature(draft,other.id,other.features[0].id)
  assert.equal(next.datasets.length,draft.datasets.length)
  assert.equal(next.datasets[0],layer)
  assert.deepEqual(next.datasets[1],{...other,features:[]})
  assert.doesNotThrow(()=>checkDatasetRemovals(draft,next))
})
