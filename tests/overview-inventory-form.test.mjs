import assert from 'node:assert/strict'
import test from 'node:test'
import { createOverviewCourtStats, withVillageCourtField } from '../src/jingshan/overview-inventory-form.ts'
import { overviewCourtStatistics } from '../src/jingshan/estimated-court-inventory.ts'
import { checkDataset } from '../src/jingshan/validate.ts'
import { tableCollection } from '../src/jingshan/platform-form-table.ts'
import { prepareGeoImport } from '../src/jingshan/platform-local-data.ts'

function historicForm() {
  const dataset=createOverviewCourtStats()
  dataset.features=['新市街道','永兴街道','温泉街道'].map((region,i)=>({
    id:'archived-'+i,type:'Feature',geometry:{type:'GeometryCollection',geometries:[]},
    properties:{name:region,region,kind:'form_record',venues:1,courts:3,stateCourts:3,schoolCourts:0,
      officeCourts:0,privateCourts:0,fullOpenCourts:3,timedOpenCourts:0,closedCourts:0,nationalSites:0,estimated:false},
  }))
  return dataset
}
test('旧汇总表不再预填任何估算场馆或场地',()=>{
  assert.deepEqual(createOverviewCourtStats().features,[])
  assert.equal(overviewCourtStatistics('京山市').courts,undefined)
})

test('场地家底表校验乡镇唯一、整数片数和非空间记录',()=>{
  for(const modify of [
    data=>{data.features[1].properties.region=data.features[0].properties.region},
    data=>{data.features[0].properties.courts=-1},
    data=>{data.features[0].geometry={type:'Point',coordinates:[113.1,31.1]}},
    data=>{data.formSchema.fields=data.formSchema.fields.filter(f=>f.key!=='courts')},
  ]){
    const data=historicForm()
    modify(data)
    assert.throws(()=>checkDataset(data))
  }
})

test('旧版表单补充村镇选填列，支持按 ID 导入，不改原版本和未填记录',()=>{
  const original=historicForm()
  original.formSchema.fields=original.formSchema.fields.filter(field=>field.key!=='villageCourts')
  for(const row of original.features) delete row.properties.villageCourts
  checkDataset(original)
  const dataset=withVillageCourtField(original)
  assert.equal(withVillageCourtField(dataset),dataset)
  assert.equal(dataset.features,original.features)
  assert.equal(original.formSchema.fields.some(field=>field.key==='villageCourts'),false)
  const key=dataset.formSchema.fields.findIndex(field=>field.key==='privateCourts')+1
  assert.deepEqual(dataset.formSchema.fields[key],{key:'villageCourts',type:'number',label:'村镇（片）'})
  const [first,second,third]=dataset.features
  const table=tableCollection(dataset,[
    ['记录ID','国有（片）','村镇（片）'],
    [first.id,first.properties.stateCourts-2,2],
    [second.id,second.properties.stateCourts,0],
  ])
  const draft={mode:'demo',rules:{},datasets:[original]}
  const revised=prepareGeoImport(draft,dataset,table,'merge').data.datasets[0]
  checkDataset(revised)
  assert.deepEqual(revised.features.slice(0,3).map(row=>row.properties.villageCourts),[2,0,undefined])
  assert.equal(third.properties.villageCourts,undefined)
  assert.equal(first.properties.villageCourts,undefined)
})

test('填报村镇后，五类权属应与场地总片数一致',()=>{
  for(const value of [-1,0.5,'1',1]){
    const dataset=historicForm()
    dataset.features[0].properties.villageCourts=value
    assert.throws(()=>checkDataset(dataset))
  }
})

