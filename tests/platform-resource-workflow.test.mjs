import test from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync,strFromU8 } from 'fflate'
import shp from 'shpjs'
import { inCatalogDomain,parseCatalogSearch,catalogSearchKey } from '../src/jingshan/catalog-domain.ts'
import { planBulkRemoval } from '../src/jingshan/resource-removal.ts'
import { publishSourceDocument } from '../server/publish-spatial-source.ts'
import { readSpatialFile } from '../src/jingshan/platform-spatial-import.ts'
import { exportShapefile } from '../server/spatial-shapefile.ts'

const row=(id,x)=>({id,type:'Feature',geometry:{type:'Point',coordinates:[x,31]},properties:{name:'京山'+id,region:'钱场镇',kind:'fixture','中文长字段名称':['保留','资料'],area:123.25}})
const layer=(id)=>({id,name:id,category:'测试',department:'管理',description:'',features:[row(id+'1',113.1),row(id+'2',113.12)]})
function base(){return {mode:'live',rules:{walkM:1000,cycleM:3000,driveM:5000,peoplePerCourt:4000,courtAreaM2:500},datasets:[layer('sourcea'),layer('sourceb')]}}
test('全局、专题和收藏搜索保持数据与服务范围互斥，旧搜索链接仍可进入',()=>{
  assert.deepEqual(parseCatalogSearch(catalogSearchKey('services',' 场馆|甲 ')),{domain:'services',query:'场馆|甲'})
  assert.deepEqual(parseCatalogSearch('场馆'),{domain:'spatial',query:'场馆'})
  assert.equal(inCatalogDomain('services','spatial'),false)
  assert.equal(inCatalogDomain('views','spatial'),true)
  assert.equal(inCatalogDomain('local','services'),false)
})
test('批量下线清理服务绑定，保留源要素；删除多份数据集不会影响其他源',()=>{
  const d=base();d.mapBindings=[{scope:'all',slot:'dataset:sourcea',serviceId:'hosted-sourcea'}]
  const down=planBulkRemoval(d,[{kind:'service',service:{id:'hosted-sourcea',revision:3}}])
  assert.deepEqual(down.next.datasets,d.datasets);assert.equal(down.bindings,1)
  const next=planBulkRemoval(d,[{kind:'dataset',id:'sourcea'},{kind:'dataset',id:'sourcea'}])
  assert.deepEqual(next.sources,['sourcea']);assert.deepEqual(next.next.datasets,[d.datasets[1]])
})
test('只发布选中的源，其他数据及图层绑定的草稿不会随之上线',()=>{
  const p=base(), d=structuredClone(p)
  d.datasets[0].features.pop();d.datasets[1].name='其他未发布编辑';d.mapBindings=[{scope:'all',slot:'dataset:sourceb',serviceId:null}]
  const {data}=publishSourceDocument(p,d,'sourcea')
  assert.equal(data.datasets.find(x=>x.id==='sourcea').features.length,1)
  assert.equal(data.datasets.find(x=>x.id==='sourceb').name,'sourceb');assert.deepEqual(data.mapBindings,p.mapBindings)
  assert.equal(p.datasets[0].features.length,2)
  assert.throws(()=>publishSourceDocument(p,{...d,serviceRemovals:[{id:'hosted-sourcea',revision:1}]},'sourcea'),/下线/)
})
test('SHP ZIP 可独立读回点线面，UTF-8 中文与原始字段、编号一一对应',async()=>{
  const d=layer('parcels')
  d.features.push({...row('线',113),geometry:{type:'LineString',coordinates:[[113,31],[113.01,31.02]]}},
    {...row('面',113),geometry:{type:'Polygon',coordinates:[[[113,31],[113.01,31],[113.01,31.01],[113,31]]]}})
  d.features[0].geometry.coordinates.push(121.5)
  d.features[0].properties.sourceAttributes={'中文补充列':'原始值'}
  const packed=await exportShapefile(d)
  const restored=await readSpatialFile(new File([packed],'矢量.zip'))
  assert.deepEqual(restored.features.map(r=>r.id),d.features.map(r=>r.id))
  assert.deepEqual(restored.features[0],d.features[0])
  const files=unzipSync(packed)
  assert.equal(JSON.parse(strFromU8(files['geometry-z.geojson'])).features[0].geometry.coordinates[2],121.5)
  assert.ok(JSON.parse(strFromU8(files['fields.json'])).fields.some(f=>f.original && f.key==='中文补充列'))
  for(const name of ['Point','LineString','Polygon']){
    for(const ext of ['shp','shx','dbf','prj','cpg'])assert.ok(files[name+'.'+ext],name+'.'+ext)
    const read=await shp({shp:files[name+'.shp'],dbf:files[name+'.dbf'],prj:strFromU8(files[name+'.prj']),cpg:'UTF-8'})
    assert.equal(read.features.length,name==='Point'?2:1)
    assert.equal(read.features[0].geometry.type,name)
    assert.ok(read.features[0].properties.SOURCE_ID)
    assert.ok(Object.values(read.features[0].properties).some(v=>typeof v==='string' && v.includes('京山')))
  }
  assert.deepEqual(JSON.parse(strFromU8(files['attributes.json']))[0].properties,d.features[0].properties)
})
