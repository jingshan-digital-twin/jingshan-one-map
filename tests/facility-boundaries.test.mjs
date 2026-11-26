import test from 'node:test'
import assert from 'node:assert/strict'
import { createFacilityBoundaryIndex, districtCenter } from '../src/jingshan/facility-boundaries.ts'
import { inPolygon } from '../src/jingshan/analytics.ts'

const rect = (x, y, width, height) => [
  [x,y], [x+width,y], [x+width,y+height], [x,y+height], [x,y],
]
const shape = (id, kind, rings, props={}) => ({
  type:'Feature', id, geometry:{type:'Polygon', coordinates:rings},
  properties:{name:id, region:'', kind, ...props},
})

test('区划锚点优先使用面内发布中心，缺省时按面积计算并避开空洞和飞地间隙',()=>{
  const outline=[[0,0],[2,0],[3,0],[4,0],[10,0],[10,8],[0,8],[0,0]]
  assert.deepEqual(districtCenter(shape('town','town-boundary',[outline],{center:[3,4]})),[3,4])
  assert.deepEqual(districtCenter(shape('v','community',[outline],{center:[16,20]})),[5,4])
  const hole=rect(1,1,2,2)
  for(const ring of [hole,[...hole].reverse()]) {
    const p=districtCenter(shape('v','community',[outline,ring]))
    assert.ok(Math.abs(p[0]-(80*5-4*2)/76)<1e-9 && Math.abs(p[1]-(80*4-4*2)/76)<1e-9)
  }
  const donut=shape('hole','community',[rect(0,0,10,10),rect(2,2,6,6)],{center:[5,5]})
  assert.ok(inPolygon(districtCenter(donut),donut.geometry.coordinates))
  const big=[rect(0,0,4,4)], small=[rect(30,0,2,2)]
  for(const parts of [[small,big],[big,small]]){
    const unit={...donut,geometry:{type:'MultiPolygon',coordinates:parts}}
    assert.deepEqual(districtCenter(unit),[2,2])
  }
})

test('按行政面的外环、内环和每个飞地归属，排除模拟统计单元和市界', () => {
  const town=shape('town', 'town-boundary', [rect(0,0,12,12)], {adcode:'42'})
  const city=shape('city', 'city-boundary', [rect(-20,-20,100,100)])
  const village=shape('village', 'community', [], {regionCode:'42'})
  village.geometry={type:'MultiPolygon', coordinates:[
    [rect(0,0,4,4), rect(1,1,1,1)], [rect(7,7,2,2)],
  ]}
  const sample=shape('sample', 'community', [rect(0,0,12,12)], {sample:true})
  const index=createFacilityBoundaryIndex([city,town], [village,sample])
  for(const point of [[0.5,1],[8,8]]){
    const {town:parent, village:child}=index.locate(point)
    assert.equal(parent,town)
    assert.equal(child,village)
  }
  assert.equal(index.locate([1.5,1.5]).village,undefined)
  assert.equal(index.locate([1.5,1.5]).town,town)
  assert.equal(index.locate([13,1]).town,undefined)
})

test('落在共边时按村的行政关系选定唯一父级，不跨镇拼接', () => {
  const left=shape('a','town-boundary',[rect(0,0,2,2)],{adcode:'1'})
  const right=shape('b','town-boundary',[rect(2,0,2,2)],{adcode:'2'})
  const village=shape('v','community',[rect(1.9,0,1,2)],{regionCode:'2'})
  for(const order of [[left,right],[right,left]]){
    const index=createFacilityBoundaryIndex(order,[village])
    assert.deepEqual(index.locate([2,1]),{town:right,village})
    assert.equal(index.locate([1.95,1]).village,undefined)
  }
})
