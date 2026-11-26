import assert from 'node:assert/strict'
import test from 'node:test'
import { Cartesian3, Cartographic, Math as CesiumMath, PolygonGeometry, VertexFormat } from '@cesium/core'
import { reliefSurface } from '../src/jingshan/relief-surface.ts'

const bounds = [113.0, 30.95, 113.25, 31.11]
const outline = [[113.02,30.97],[113.16,30.98],[113.22,31.05],[113.06,31.08],[113.02,30.97]]
const hole = [[113.08,31.00],[113.13,31.01],[113.10,31.04],[113.08,31.00]]

test('三维区划顶面在两种环向及带洞时，Cesium 的实际顶点都采样对应经纬度', () => {
  const [west,south,east,north] = bounds
  for (const outer of [outline,outline.toReversed()]) {
    for (const inner of [hole,hole.toReversed()]) {
      const rings = [outer,inner]
      const original = structuredClone(rings)
      const {hierarchy,textureCoordinates} = reliefSurface(rings,500,bounds)
      const geometry = PolygonGeometry.createGeometry(new PolygonGeometry({
        polygonHierarchy: hierarchy, textureCoordinates, height: 500, vertexFormat: VertexFormat.POSITION_AND_ST,
      }))
      assert.ok(geometry?.indices.length)
      const xyz = geometry.attributes.position.values
      const uv = geometry.attributes.st.values
      const vertices = new Set()
      for (let i=0; i<xyz.length/3; i++) {
        const point = Cartographic.fromCartesian(Cartesian3.fromArray(xyz,i*3))
        const lon = CesiumMath.toDegrees(point.longitude)
        const lat = CesiumMath.toDegrees(point.latitude)
        vertices.add(lon.toFixed(5) + ',' + lat.toFixed(5))
        assert.ok(Math.abs(uv[i*2] - (lon-west)/(east-west)) < 0.0001)
        assert.ok(Math.abs(uv[i*2+1] - (lat-south)/(north-south)) < 0.0001)
      }
      for (const [x,y] of original.flat()) assert.ok(vertices.has(x.toFixed(5) + ',' + y.toFixed(5)))
      assert.deepEqual(rings,original)
    }
  }
})
