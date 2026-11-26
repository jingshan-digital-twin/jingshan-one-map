import type { Geometry, Position } from 'geojson'
import { populationRaster } from './population-raster.ts'
import type { Dataset } from './types.ts'

export function publishedLayerUrl(id: string) {
  return '/api/jingshan/layers/' + encodeURIComponent(id) + '/features.geojson'
}

export function inspectDataset(dataset: Dataset) {
  const raster=populationRaster(dataset)
  if(raster)return {extent:raster.bounds,unlocated:0,duplicateIds:0,missingNames:0,
    fields:[['name','文本'],['kind','文本'],['region','文本'],['center','数组'],['population','数值'],['densityPerKm2','数值']].map(([key,type])=>({key,type,filled:raster.count}))}
  const extent: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
  const fields = new Map<string, { key: string; types: Set<string>; filled: number }>()
  const seen = new Set<string>()
  let unlocated = 0, duplicateIds = 0, missingNames = 0
  function point([x, y]: Position) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    extent[0] = Math.min(extent[0], x)
    extent[1] = Math.min(extent[1], y)
    extent[2] = Math.max(extent[2], x)
    extent[3] = Math.max(extent[3], y)
  }
  function inspect(g: Geometry) {
    switch (g.type) {
      case 'Point': point(g.coordinates); break
      case 'MultiPoint': case 'LineString': g.coordinates.forEach(point); break
      case 'Polygon': case 'MultiLineString': g.coordinates.forEach(line => line.forEach(point)); break
      case 'MultiPolygon': g.coordinates.forEach(poly => poly.forEach(line => line.forEach(point))); break
      case 'GeometryCollection': g.geometries.forEach(inspect); break
    }
  }
  for (const row of dataset.features) {
    if (seen.has(row.id)) duplicateIds++
    seen.add(row.id)
    if (!row.properties.name?.trim()) missingNames++
    if (row.geometry.type === 'GeometryCollection' && !row.geometry.geometries.length) unlocated++
    else inspect(row.geometry)
    for (const [key, value] of Object.entries(row.properties)) {
      const field = fields.get(key) ?? {key, types: new Set<string>(), filled: 0}
      if (value !== null && value !== undefined && value !== '') {
        const type = typeof value
        field.types.add(Array.isArray(value) ? '数组' : type === 'string' ? '文本' : type === 'number' ? '数字' : type === 'boolean' ? '布尔' : '对象')
        field.filled++
      }
      fields.set(key, field)
    }
  }
  return {extent: Number.isFinite(extent[0]) ? extent : undefined, unlocated, duplicateIds, missingNames,
    fields: Array.from(fields.values(), f => ({key: f.key, type: [...f.types].join(' / ') || '空值', filled: f.filled}))}
}
