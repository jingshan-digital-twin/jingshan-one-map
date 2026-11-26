import assert from 'node:assert/strict'
import test from 'node:test'
import { checkDocument } from '../src/jingshan/validate.ts'
import { checkFormSchema, checkPlatformRecord, isPlatformFormDataset, platformFormTemplates } from '../src/jingshan/platform-forms.ts'
import { checkChangedFormRecords } from '../server/platform-form-check.ts'
import { prepareGeoImport } from '../src/jingshan/platform-local-data.ts'

const geom = {type:'GeometryCollection',geometries:[]}
const point = {type:'Point',coordinates:[113.1,31.02]}
function row(id,properties={},geometry=geom) {
  return {type:'Feature',id,geometry,properties:{name:id,region:'京山市',kind:'form_record',...properties}}
}
function layer(id,features=[],extra={}) {
  return {id,name:id,category:'业务表单',department:'文旅局',description:'',features,...extra}
}
const doc = (...datasets) => ({mode:'live',rules:{},datasets})
const fields = [
  {key:'total',label:'总数',type:'number',required:true},
  {key:'approved',label:'已核实',type:'boolean',required:true},
  {key:'day',label:'填报日期',type:'date'},
  {key:'state',label:'状态',type:'select',options:['待复核','已复核']},
]

test('动态字段定义和无空间位置记录通过共享文档校验，必填可记录零或否',()=>{
  const d=layer('form_daily',[row('r1',{total:0,approved:false,day:'2024-02-29',state:'待复核'})],{formSchema:{fields}})
  assert.doesNotThrow(()=>checkDocument(doc(d)))
  assert.ok(isPlatformFormDataset(d))
  assert.equal(platformFormTemplates.length,5)
  assert.throws(()=>checkDocument(doc(layer('venues',[row('missing_location')]))),/几何/)
  for(const invalid of [{total:null},{approved:'false'},{day:'2025-02-29'},{state:'不存在'}])
    assert.throws(()=>checkDocument(doc({...d,features:[row('r1',{total:0,approved:false,...invalid})]})))
  for(const key of ['name','constructor','__proto__','sourceServiceId','a b'])
    assert.throws(()=>checkFormSchema({fields:[{key,label:'非法字段',type:'text'}]}))
  assert.throws(()=>checkFormSchema({fields:[...fields,fields[0]]}),/重复/)
})

test('保留带值字段，阻止直接删除定义或改类型；允许停用已清理的字段',()=>{
  const d=layer('form_daily',[row('r1',{total:0,approved:false})],{formSchema:{fields}})
  const before=doc(d), after=structuredClone(before)
  after.datasets[0].formSchema.fields=fields.slice(1)
  assert.throws(()=>checkChangedFormRecords(after,before),/仍有填报值/)
  delete after.datasets[0].features[0].properties.total
  assert.doesNotThrow(()=>checkChangedFormRecords(after,before))
})

test('草稿保存校验新增场馆月报的真实关联、指标范围和按月唯一键',()=>{
  const venues=layer('venues',[row('v1',{kind:'venue'},point)])
  const f=row('op1',{kind:'venue_operation',venueId:'v1',month:'2025-09',utilization:0},point)
  const before=doc(venues), d=layer('venue_operations',[f]), after=doc(venues,d)
  assert.doesNotThrow(()=>checkChangedFormRecords(after,before))
  for(const invalid of [{venueId:'missing'},{month:'2025-00'},{utilization:-1},{utilization:101},{utilization:null}])
    assert.throws(()=>checkPlatformRecord(d,row('bad',{...f.properties,...invalid}),after.datasets))
  assert.throws(()=>checkChangedFormRecords(doc(venues,{...d,features:[f,{...f,id:'op2'}]}),after),/已存在/)
  assert.doesNotThrow(()=>checkChangedFormRecords(doc(venues,{...d,features:[{...f,properties:{...f.properties,usedHours:45}}]}),after))
})

test('原有历史明细只在编辑时校验，新增产值仍遵循现有台账口径',()=>{
  const old=layer('industry_output',[row('legacy',{year:'未详'})])
  const fresh=row('out',{year:2025,outputWanYuan:0,outputBasis:'reported',chainStage:'下游'})
  assert.doesNotThrow(()=>checkChangedFormRecords(doc({...old,features:[...old.features,fresh]}),doc(old)))
  assert.throws(()=>checkChangedFormRecords(doc({...old,features:[{...old.features[0],properties:{...old.features[0].properties,name:'改动'}}]}),doc(old)),/年度/)
})

test('本表 GeoJSON 预检不更改草稿，更新与替换保留旧字段、来源与空间位置',()=>{
  const source={serviceId:'local-file',serviceName:'历史采集',syncedAt:'2025-03-01',count:2}
  const one={...row('one',{total:0,approved:false,sourceServiceId:'history',evidence:{page:1}},point),externalKey:'abc'}
  const d=layer('form_daily',[one,row('two',{total:1,approved:false})],{formSchema:{fields},source})
  const draft=doc(d), raw={type:'FeatureCollection',formDatasetId:d.id,features:[
    {type:'Feature',id:'one',properties:{total:8}}, {type:'Feature',id:'new',geometry:null,properties:{total:2,approved:false}}]}
  const merge=prepareGeoImport(draft,d,raw,'merge'), replace=prepareGeoImport(draft,d,raw,'replace')
  assert.deepEqual([merge.total,merge.updated,merge.added,merge.removed],[3,1,1,0])
  assert.deepEqual([replace.total,replace.updated,replace.added,replace.removed],[2,1,1,1])
  for(const plan of [merge,replace]){
    const result=plan.data.datasets[0], f=result.features.find(f=>f.id==='one')
    assert.equal(f.properties.total,8);assert.equal(f.properties.approved,false);assert.deepEqual(f.properties.evidence,{page:1})
    assert.equal(f.properties.sourceServiceId,'history');assert.equal(f.externalKey,'abc');assert.deepEqual(f.geometry,point)
    assert.deepEqual(result.source,source);assert.deepEqual(result.formSchema,{fields})
  }
  assert.equal(draft.datasets[0].features[0].properties.total,0)
  assert.throws(()=>prepareGeoImport(draft,d,raw,'append'),/已有 ID/)
  assert.throws(()=>prepareGeoImport(draft,d,{...raw,formDatasetId:'other'},'merge'),/另一张/)
  assert.throws(()=>prepareGeoImport(doc(d,layer('venues',[row('new',{},point)])),d,raw,'merge'),/重复要素 ID/)
  assert.throws(()=>prepareGeoImport(draft,d,{...raw,features:[{type:'Feature',id:'one',properties:{total:'无'}}]},'merge'),/数值/)
  assert.equal(prepareGeoImport(draft,d,{...raw,features:[]},'replace').removed,2)
})

test('导入场馆月报可由关联场馆定位，统计唯一键与无效关联在预检被拦截',()=>{
  const venue=layer('venues',[row('venue1',{kind:'venue'},point)]),d=layer('venue_operations'),draft=doc(venue,d)
  const feature={type:'Feature',id:'r1',geometry:null,properties:{venueId:'venue1',month:'2025-01',usedHours:12}}
  const raw={type:'FeatureCollection',features:[feature]}
  const plan=prepareGeoImport(draft,d,raw,'append')
  assert.deepEqual(plan.first[0].geometry,point)
  assert.equal(plan.first[0].properties.kind,'venue_operation')
  assert.throws(()=>prepareGeoImport(draft,d,{...raw,features:[feature,{...feature,id:'r2'}]},'append'),/相同统计对象/)
  assert.throws(()=>prepareGeoImport(draft,d,{...raw,features:[{...feature,properties:{...feature.properties,venueId:'unknown'}}]},'append'),/关联编号/)
})
