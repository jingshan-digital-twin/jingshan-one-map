import assert from 'node:assert/strict'
import test from 'node:test'
import { acceptsMapService, checkBindingServices, checkMapBindings, mapSlots, resolveMapBindings } from '../src/jingshan/map-bindings.ts'
import { prepareWfsSync } from '../src/jingshan/platform-wfs-sync.ts'

const datasets = [{id:'parks', name:'公园', category:'城市空间', features:[]}, {id:'form_a',name:'报表',formSchema:{fields:[]}}]
const wms = {id:'maps', kind:'wms', category:'矢量', enabled:true}
const models = {id:'hall', kind:'3dtiles', category:'三维模型',enabled:true}
const bindings = [
  {scope:'all',slot:'basemap',serviceId:'maps'},
  {scope:'venues',slot:'basemap',serviceId:null},
  {scope:'venues',slot:'model',serviceId:'hall'},
]
test('历史工作区沿用项目原有图层，场景配置可覆盖全图来源或显式恢复本地',()=>{
  checkMapBindings(undefined,datasets)
  checkMapBindings(bindings,datasets)
  checkBindingServices(bindings,[wms,models])
  assert.equal(resolveMapBindings(undefined,'events').size,0)
  assert.equal(resolveMapBindings(bindings,'events').get('basemap'),'maps')
  assert.equal(resolveMapBindings(bindings,'venues').get('basemap'),null)
  assert.equal(resolveMapBindings(bindings,'industry').has('model'),false)
  assert(!mapSlots(datasets).some(item=>item.id==='dataset:form_a'))
})
test('WFS 草稿同步按稳定编号合并，保留本地业务与同来源记录的既有编号',()=>{
  const source={kind:'wfs',id:'s01',name:'公园要素'}
  const dataset={...datasets[0],department:'京山',description:'公园名录',features:[]}
  const draft={mode:'live',rules:{},datasets:[dataset]}
  const collection={type:'FeatureCollection',features:[{type:'Feature',id:'park-1',geometry:{type:'Point',coordinates:[113,31]},properties:{mc:'体育公园',town:'新市街道'}}]}
  const fields={identifier:'',name:'mc',region:'town'}
  const first=prepareWfsSync(draft,dataset,source,collection,fields)
  assert.equal(first.added,1)
  const saved=first.data.datasets[0]
  saved.features[0].id='legacyPark'
  saved.features[0].properties.courts=5
  saved.features.push({...saved.features[0],id:'localPark',properties:{name:'园区',kind:'parks',region:'京山市'}})
  collection.features[0].properties.mc='网球体育公园'
  const second=prepareWfsSync(first.data,saved,source,collection,fields)
  assert.equal(second.updated,1);assert.equal(second.added,0);assert.equal(second.total,2)
  assert.equal(second.data.datasets[0].features[0].id,'legacyPark')
  assert.equal(second.data.datasets[0].features[0].properties.courts,5)
  assert.equal(second.data.datasets[0].features[0].properties.name,'网球体育公园')
  assert.equal(second.data.datasets[0].features[1].id,'localPark')
  assert.throws(()=>prepareWfsSync(draft,dataset,source,collection,{...fields,identifier:'missing'}),/来源编号/)
})
test('拒绝未登记、停用、协议不符的来源，拒绝有歧义的底图与业务叠加配置',()=>{
  assert.throws(()=>checkMapBindings([...bindings,bindings[0]],datasets),/一个来源/)
  assert.throws(()=>checkMapBindings([{scope:'missing',slot:'model',serviceId:'hall'}],datasets),/无效/)
  assert.throws(()=>checkMapBindings([{scope:'all',slot:'dataset:missing',serviceId:'maps'}],datasets),/无效/)
  assert.throws(()=>checkBindingServices(bindings,[wms]),/移除/)
  assert.throws(()=>checkBindingServices(bindings,[{...wms,enabled:false},models]),/未启用/)
  assert.throws(()=>checkBindingServices(bindings,[{...wms,kind:'wfs'},models]),/协议/)
  assert.throws(()=>checkBindingServices([...bindings,{scope:'overview',slot:'roadNetwork',serviceId:'maps'}],[wms,models]),/不能同时/)
  assert.equal(acceptsMapService('dataset:parks',models),false)
  assert.equal(acceptsMapService('townBoundaries',{...wms,kind:'wfs'}),true)
})
