import type { Position } from 'geojson'
import { inPolygon } from './analytics.ts'
import { noPopulationData, populationBand } from './population-grid.ts'
import type { CityFeature, Coordinate } from './types.ts'

type Bounds = [number, number, number, number]
export type PopulationRange = { center: Coordinate; meters: number }

// One transparent texture keeps thousands of population cells on the same surface as the imagery.
// Retain the native polygons for selection, including holes and split township boundary cells.
type PopulationCell = { feature: CityFeature; parts: Position[][][]; box: Bounds }
const yieldToMap = () => new Promise<void>(resolve => setTimeout(resolve, 0))

export async function populationSurface(features: CityFeature[], range: PopulationRange | undefined, signal: AbortSignal) {
  let deadline = performance.now() + 6
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity]
  const cells: PopulationCell[] = []
  for (const feature of features) {
    if (performance.now() >= deadline) {
      await yieldToMap()
      if (signal.aborted) return
      deadline = performance.now() + 6
    }
    const g = feature.geometry
    const parts = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    if (!parts.length) continue
    const box: Bounds = [Infinity, Infinity, -Infinity, -Infinity]
    for (const rings of parts) for (const [x, y] of rings[0]) {
      box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y)
      box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y)
    }
    bounds[0] = Math.min(bounds[0], box[0]); bounds[1] = Math.min(bounds[1], box[1])
    bounds[2] = Math.max(bounds[2], box[2]); bounds[3] = Math.max(bounds[3], box[3])
    cells.push({ feature, parts, box })
  }
  if (!cells.length) return
  const [west, south, east, north] = bounds
  const spanX = east - west, spanY = north - south
  if (spanX <= 0 || spanY <= 0) return
  const canvas = document.createElement('canvas')
  // About 16 texels across one native 30″ pixel, independent of screen resolution.
  canvas.width = Math.max(2, Math.min(2048, Math.ceil(spanX * 1920)))
  canvas.height = Math.max(2, Math.min(2048, Math.ceil(spanY * 1920)))
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const sx = canvas.width / spanX, sy = canvas.height / spanY
  const dx = range ? range.meters / (111320 * Math.cos(range.center[1] * Math.PI / 180)) : 0
  const dy = range ? range.meters / 110900 : 0
  if (range) {
    ctx.beginPath()
    ctx.ellipse((range.center[0] - west) * sx, (north - range.center[1]) * sy, dx * sx, dy * sy, 0, 0, 2 * Math.PI)
    ctx.clip()
  }
  for (const { feature, parts } of cells) {
    if (performance.now() >= deadline) {
      await yieldToMap()
      if (signal.aborted) return
      deadline = performance.now() + 6
    }
    const band = populationBand(feature.properties.densityPerKm2)
    ctx.fillStyle = band.color
    for (const rings of parts) {
      ctx.beginPath()
      for (const ring of rings) {
        ring.forEach(([x, y], i) => {
          if (i === 0) ctx.moveTo((x - west) * sx, (north - y) * sy)
          else ctx.lineTo((x - west) * sx, (north - y) * sy)
        })
        ctx.closePath()
      }
      ctx.globalAlpha = band === noPopulationData ? 0.16 : 0.78
      ctx.fill('evenodd')
      ctx.globalAlpha = band === noPopulationData ? 0.09 : 0.20
      ctx.strokeStyle = '#f2f6f8'
      ctx.lineWidth = 0.65
      ctx.stroke()
    }
  }
  function pick(position: Position) {
    const [x, y] = position
    if (range && ((x - range.center[0]) / dx) ** 2 + ((y - range.center[1]) / dy) ** 2 > 1) return
    return cells.find(({ box, parts }) => x >= box[0] && y >= box[1] && x <= box[2] && y <= box[3] &&
      parts.some(rings => inPolygon(position, rings)))?.feature.id
  }
  return { canvas, bounds, pick }
}
