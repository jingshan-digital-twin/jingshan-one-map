import test from 'node:test'
import assert from 'node:assert/strict'
import {spatialCsv, readSpatialFile} from '../src/jingshan/platform-spatial-import.ts'
import {inspectDataset} from '../src/jingshan/platform-resource-inspect.ts'

test('CSV uses named coordinate columns, preserves quoted names and rejects missing locations',()=>{
  const r=spatialCsv('纬度,名称,longitude,id\r\n31.1,"酒店,一期",113.2,s-1')
  assert.deepEqual(r.features[0].geometry.coordinates,[113.2,31.1])
  assert.equal(r.features[0].id,'s-1')
  assert.equal(r.features[0].properties['名称'],'酒店,一期')
  assert.throws(()=>spatialCsv('lon,lat\n,31'),/经纬度无效/)
  assert.throws(()=>spatialCsv('name,lat\nx,31'),/需要经度/)
})
test('spatial inspection measures all polygon parts, fields and missing positions',()=>{
  const layer={features:[
    {id:'a',properties:{name:'区域',count:0},geometry:{type:'MultiPolygon',coordinates:[[[[100,28],[102,28],[101,31],[100,28]]],[[[104,32],[105,32],[104,33],[104,32]]]]}},
    {id:'b',properties:{name:'没有坐标',count:null},geometry:{type:'GeometryCollection',geometries:[]}},
  ]}
  const r=inspectDataset(layer)
  assert.deepEqual(r.extent,[100,28,105,33]);assert.equal(r.unlocated,1);assert.equal(r.fields.find(f=>f.key==='count').filled,1)
})
test('spatial import rejects malformed archives before decoding',async()=>{
  await assert.rejects(readSpatialFile(new File(['bad'],'shapes.zip')),/ZIP/)
})
