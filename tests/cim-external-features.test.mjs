import test,{after,before} from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {externalFeatureUrl} from '../server/cim-external-features.ts'
import {inspectService,fetchCimFeatures,sourceRecords} from '../server/cim-upstream.ts'
import {checkBindingServices} from '../src/jingshan/map-bindings.ts'

const ids=Array.from({length:12},(_,i)=>i+1)
const requests=[]
const previous=process.env.CIM_FEATURE_ORIGINS
let origin
function feature(id) {
  return {type:'Feature',id,properties:{OBJECTID:id,name:'设施 '+id},geometry:{type:'Point',coordinates:[113+id/1000,31]}}
}
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,origin)
  requests.push(u)
  res.setHeader('content-type','application/json')
  const reply=value=>res.end(JSON.stringify(value))
  if (u.pathname==='/venues.geojson') return reply({type:'FeatureCollection',features:ids.map(feature)})
  if (u.pathname==='/invalid.geojson') return reply({type:'FeatureCollection',features:[{...feature(1),geometry:{type:'Point',coordinates:[300000,10000]}}]})
  if (u.pathname==='/redirect') {res.writeHead(302,{location:'/venues.geojson'});res.end();return}
  if (!u.pathname.endsWith('/query')) return reply({type:'Feature Layer',capabilities:'Query',supportedQueryFormats:'JSON, geoJSON',objectIdField:'OBJECTID',maxRecordCount:4})
  if (u.searchParams.get('returnIdsOnly')==='true') return reply({objectIdFieldName:'OBJECTID',objectIds:[...ids].reverse()})
  if (u.searchParams.get('f')!=='geojson' || u.searchParams.get('outSR')!=='4326') {res.writeHead(400);res.end();return}
  const batch=u.searchParams.get('objectIds').split(',').map(Number)
  if (u.pathname.includes('incomplete')) batch.pop()
  reply({type:'FeatureCollection',features:batch.map(feature).reverse()})
})
before(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  origin='http://127.0.0.1:'+server.address().port
  process.env.CIM_FEATURE_ORIGINS=origin
})
after(async()=>{
  if (previous===undefined) delete process.env.CIM_FEATURE_ORIGINS
  else process.env.CIM_FEATURE_ORIGINS=previous
  await new Promise(resolve=>server.close(resolve))
})
function source(kind,path) {return {kind,url:origin+path,id:kind,category:'空间图层',enabled:true}}
test('GeoJSON 服务可检测、读取、查看属性第二页并绑定图层',async()=>{
  const s=source('geojson','/venues.geojson')
  assert.match(await inspectService(s),/12 条/)
  assert.equal((await fetchCimFeatures(s)).features[0].properties.name,'设施 1')
  assert.deepEqual((await sourceRecords(s,2)).features.map(f=>f.id),['11','12'])
  assert.doesNotThrow(()=>checkBindingServices([{scope:'all',slot:'dataset:poi',serviceId:s.id}],[s]))
  await assert.rejects(fetchCimFeatures(source('geojson','/invalid.geojson')),/经纬度/)
})
test('FeatureServer 向指定子图层请求 GeoJSON，按对象编号完整拼接并查询指定页',async()=>{
  const s=source('arcgis','/rest/services/parks/FeatureServer/0')
  assert.match(await inspectService(s),/12 条/)
  const start=requests.length
  assert.deepEqual((await fetchCimFeatures(s)).features.map(f=>f.id),ids)
  const batches=requests.slice(start).flatMap(u=>u.searchParams.has('objectIds')?[u.searchParams.get('objectIds')]:[])
  assert.deepEqual(batches,['1,2,3,4','5,6,7,8','9,10,11,12'])
  const page=await sourceRecords(s,2)
  assert.equal(page.total,12);assert.equal(page.hasNext,false)
  assert.deepEqual(page.features.map(f=>f.properties.OBJECTID),[11,12])
  assert.doesNotThrow(()=>checkBindingServices([{scope:'venues',slot:'dataset:poi',serviceId:s.id}],[s]))
  await assert.rejects(fetchCimFeatures(source('arcgis','/incomplete/FeatureServer/1')),/未完整/)
})
test('固定来源、单个子图层地址、禁止重定向和底图协议限制',async()=>{
  assert.throws(()=>externalFeatureUrl({kind:'geojson',url:'https://untrusted.example/data.geojson'}),/未获许可/)
  assert.throws(()=>externalFeatureUrl(source('arcgis','/FeatureServer')),/数字图层/)
  assert.throws(()=>externalFeatureUrl(source('arcgis','/FeatureServer/2?where=1')),/数字图层/)
  await assert.rejects(fetchCimFeatures(source('geojson','/redirect')),/302/)
  for (const kind of ['arcgis','geojson']) assert.throws(()=>checkBindingServices([{scope:'all',slot:'basemap',serviceId:kind}],[source(kind,'/test')]),/协议不兼容/)
})
