import assert from 'node:assert/strict'
import test from 'node:test'
import {prepareGeoImport} from '../src/jingshan/platform-local-data.ts'
import {courtLedgerId} from '../src/jingshan/court-ledger.ts'

const corner = [113.1,31.1]
const geometry = {type:'Polygon',coordinates:[[corner,[113.101,31.1],[113.101,31.101],[113.1,31.101],corner]]}
const original = {type:'Feature', id:'survey-1', geometry,
  properties:{kind:'court-footprint',name:'原场地',region:'新市街道',registrationCode:'CODE1',sourceAttributes:{legacy:'保留'}}}
const dataset = {id:'court_footprints',name:'网球场地边界',category:'网球',department:'京山市',description:'',features:[original]}
const plan = (features, target=dataset) => prepareGeoImport({mode:'live',datasets:[target],rules:{}},target,
  {type:'FeatureCollection',courtShape:true,features}, 'merge')
const row = properties => ({type:'Feature',geometry,properties})

test('SHP 补录按相同边界或登记编码更新，保留平台 ID、位置和旧属性', () => {
  const feature = row({MC:'更新名称', '材质':'硬地'})
  feature.geometry = {...geometry,coordinates:geometry.coordinates.map(r=>r.map(p=>[...p,0]).reverse())}
  const result=plan([feature])
  assert.deepEqual([result.added,result.updated,result.removed],[0,1,0])
  const item=result.first[0]
  assert.equal(item.id,original.id)
  assert.deepEqual(item.geometry,original.geometry)
  assert.equal(item.properties.name,'更新名称')
  assert.deepEqual(item.properties.sourceAttributes,{legacy:'保留',MC:'更新名称','材质':'硬地'})
  const changed={...row({TYSBDM:'CODE1'}),geometry:{...geometry,coordinates:geometry.coordinates.map(r=>r.map(([x,y])=>[x+0.1,y]))}}
  assert.deepEqual(plan([changed]).first[0].geometry, geometry)
  assert.throws(()=>plan([{...changed,properties:{}}]),/未匹配/)
})

test('拼接奥维 DBF 分段备注，复制到邻场的登记注记不能修改该场地', () => {
  function comments(x){
    const raw='<?ovital_ct name="ovital_shp">{; "TYSBDM":"CODE1",; "MC":"新名称",; "X":'+x+',; "Y":31.1005,; "GLDW":"管理单位"; }'
    return {O_Com:raw.slice(0,38),O_Com1:raw.slice(38)}
  }
  const valid=plan([row(comments(113.1005))]).first[0].properties
  assert.equal(valid.name,'新名称')
  assert.equal(valid.operator,'管理单位')
  const neighboring=plan([row(comments(114.1))]).first[0].properties
  assert.equal(neighboring.name,original.properties.name)
  assert.equal(neighboring.operator,undefined)
})

test('两个场地共用面边界或文件重复登记时停止补录',()=>{
  assert.throws(()=>plan([row({})],{...dataset,features:[original,{...original,id:'different'}]}),/无法唯一对应/)
  assert.throws(()=>plan([row({TYSBDM:'CODE1'}),row({TYSBDM:'CODE1'})]),/重复/)
})

test('完整替换逐片台账保留同一边界的编号，清除旧属性，并用镇街边界定位',()=>{
  const prior={...original,properties:{...original.properties,'所属场馆':'原场馆','联系人':'原联系人'}}
  const ledger={...dataset,id:courtLedgerId,features:[prior]}
  const administration={...dataset,id:'administration',features:[{...original,id:'test-town',
    properties:{name:'核验镇',region:'京山市',kind:'town-boundary'}}]}
  const doc={mode:'live',rules:{},datasets:[administration,ledger]}
  const shape={type:'FeatureCollection',courtShape:true,features:[row({'名称':'','所属场馆':'','镇街或片区':'某路口','协调日期类':'周末'})]}
  const replace=(input,target=ledger)=>prepareGeoImport(doc,target,input,'replace')
  const result=replace(shape),polygon=result.first[0]
  assert.equal(result.updated,1)
  assert.equal(polygon.id,prior.id)
  assert.equal(polygon.properties.region,'核验镇')
  assert.equal(polygon.properties['名称'],'')
  assert.match(polygon.properties.name,/未命名场地/)
  assert.equal(polygon.properties['可协调日期类型'],'周末')
  assert.equal(polygon.properties['联系人'],undefined)
  assert.equal(polygon.properties.sourceAttributes,undefined)
  assert.equal(result.data.datasets.find(d=>d.id==='venues').features.length,0)
  assert.throws(()=>replace({...shape,features:[...shape.features,...shape.features]}),/边界重复/)
  assert.throws(()=>replace({...shape,features:[row({'����':'乱码'})]}),/字符编码/)
})

test('合并版 SHP 的实体名称和所属行政区进入逐片台账与派生图层', () => {
  const source = {...dataset, id:courtLedgerId, features:[original]}
  const doc = {mode:'live', rules:{}, datasets:[source]}
  const properties = {'实体名称':'京彩1号场', '所属行政区':'温泉街道', '所属场馆':'京彩', '开放方式':'全天开放', '建设状态':'已建'}
  const input = {type:'FeatureCollection', courtShape:true, features:[row(properties)]}
  const result = prepareGeoImport(doc, source, input, 'replace')
  const feature = result.first[0]
  assert.equal(feature.id, original.id)
  assert.equal(feature.properties.name, properties['实体名称'])
  assert.equal(feature.properties['名称'], properties['实体名称'])
  assert.equal(feature.properties['镇街或片区'], properties['所属行政区'])
  assert.equal(feature.properties.region, properties['所属行政区'])
  assert.equal(result.data.datasets.find(d => d.id === 'courts').features[0].properties.open, true)
  assert.equal(result.data.datasets.find(d => d.id === 'venues').features[0].properties.name, '京彩')
})
