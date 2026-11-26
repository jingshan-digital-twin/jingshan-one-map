import type { FeatureCollection, Position } from 'geojson'
import { topology } from 'topojson-server'
import { feature } from 'topojson-client'
import { presimplify, simplify, sphericalTriangleArea } from 'topojson-simplify'
import type { Objects, Topology } from 'topojson-specification'
import polygonClipping, { type MultiPolygon } from 'polygon-clipping'

function signedArea(ring: Position[]) {
  const [x, y] = ring[0]
  let sum = 0
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i]
    sum += (a[0] - x) * (b[1] - y) - (b[0] - x) * (a[1] - y)
  }
  return sum / 2
}

// Shared arcs are simplified once for every adjacent polygon. The effective
// triangle area is measured on the sphere; the default cutoff is 25 square metres.
export function simplifyCimAreas(collection: FeatureCollection, toleranceMeters = 5): FeatureCollection {
  if (!collection.features.length) return collection
  const polygons = collection.features.map(item => {
    if (item.geometry?.type === 'Polygon') return [item.geometry.coordinates]
    if (item.geometry?.type === 'MultiPolygon') return item.geometry.coordinates
    throw new Error('区划源包含非面要素')
  })
  const input: FeatureCollection = {type: 'FeatureCollection', features: collection.features.map(item => ({...item, properties: item.properties ?? {}}))}
  // geojson and topojson disagree in their declarations about nullable properties.
  const shared = topology({areas: input}, 1e7) as Topology<Objects<{}>>
  const weighted = presimplify(shared, sphericalTriangleArea)
  const areas = weighted.objects.areas
  if (areas.type !== 'GeometryCollection') throw new Error('区划源未返回面集合')
  const threshold = (toleranceMeters / 6371008.8) ** 2
  let display = feature(simplify(weighted, threshold), areas)
  let restore = false
  for (const [i, item] of display.features.entries()) {
    const g = item.geometry, arcGeometry = areas.geometries[i]
    const parts = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    const arcs = arcGeometry.type === 'Polygon' ? [arcGeometry.arcs] : arcGeometry.type === 'MultiPolygon' ? arcGeometry.arcs : []
    for (const [j, part] of parts.entries()) {
      for (const [k, ring] of part.entries()) {
        const originalArea = signedArea(polygons[i][j][k])
        const simplifiedArea = signedArea(ring)
        if (originalArea !== 0 && Math.abs((simplifiedArea - originalArea) / originalArea) < .005) continue
        // Keep small islands and holes, including their portion of a neighbour's border.
        for (const index of arcs[j][k]) for (const point of weighted.arcs[index < 0 ? ~index : index]) point[2] = Infinity
        restore = true
      }
    }
  }
  if (restore) display = feature(simplify(weighted, threshold), areas)
  for (const item of display.features) {
    const g = item.geometry
    const parts = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    for (const part of parts) for (const ring of part) {
      for (const p of ring) {
        p[0] = +p[0].toFixed(7)
        p[1] = +p[1].toFixed(7)
      }
    }
    // Resolve self-touching source rings and crossings between simplified
    // segments into explicit outer rings and holes for triangulation.
    const normalized = polygonClipping.union(parts as MultiPolygon)
    if (!normalized.length) throw new Error('区划面规范化后为空')
    item.geometry = g.type === 'Polygon' && normalized.length === 1
      ? {type: 'Polygon', coordinates: normalized[0]} : {type: 'MultiPolygon', coordinates: normalized}
  }
  return display
}
