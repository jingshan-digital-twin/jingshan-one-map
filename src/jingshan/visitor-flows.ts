import type { CityFeature, Coordinate } from './types.ts'

export type VisitorFlow = {
  id: string
  name: string
  share: number | null
  people: number | null
  source: Coordinate
  destination: Coordinate
}

export function visitorFlow(feature: CityFeature): VisitorFlow | null {
  if (feature.properties.kind !== 'origin' || feature.geometry.type !== 'LineString') return null
  const { coordinates } = feature.geometry
  const first = coordinates[0], last = coordinates.at(-1)
  if (!first || !last || coordinates.length < 2) return null
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
  const from = feature.properties.from
  return {
    id:feature.id,
    name:typeof from === 'string' && from.trim() ? from.trim() : feature.properties.name.split(' · ')[0]?.trim() || '未命名来源',
    share:number(feature.properties.share),
    people:number(feature.properties.people),
    source:[first[0], first[1]],
    destination:[last[0], last[1]],
  }
}

type Point = { x: number; y: number }
type ProjectedFlow = VisitorFlow & { from: Point | undefined; to: Point }
export type FlowMarker = VisitorFlow & { x: number; y: number; d: string; width: number }

export type PromotionFlow = {
  id: string
  from: Coordinate
  to: Coordinate
  fromLabel: string
  toLabel: string
  color: string
  qualifier: string
  fromKind?: string
  toKind?: string
  via?: { position: Coordinate; label: string }
}

type EndpointMarker = { point: Point; label: Point; width: number }

function curveSegment(from: Point, to: Point) {
  const dx = to.x - from.x, dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 1) return ''
  const bend = Math.min(42, length * .17)
  const curve = { x: dy / length * bend, y: -dx / length * bend }
  const controls = [
    { x: from.x + dx * .28 + curve.x, y: from.y + dy * .28 + curve.y },
    { x: from.x + dx * .7 + curve.x, y: from.y + dy * .7 + curve.y },
  ]
  return `C ${controls[0].x} ${controls[0].y} ${controls[1].x} ${controls[1].y} ${to.x} ${to.y}`
}

export function layoutPromotionFlow(from: Point, to: Point, width: number, height: number, rightInset: number,
  labels: [string, string], via?: Point, fusionLabels = false) {
  if (Math.hypot(to.x - from.x, to.y - from.y) < 7 && !via) return null
  const segments = via ? [curveSegment(from, via), curveSegment(via, to)] : [curveSegment(from, to)]
  const d = [`M ${from.x} ${from.y}`, ...segments].join(' ')
  const right = Math.max(width * .52, width - rightInset - 8)
  const place = (point: Point, text: string, above: boolean): EndpointMarker | undefined => {
    if (point.x < 3 || point.x > width - 3 || point.y < 3 || point.y > height - 3) return
    const textWidth = Array.from(text).length * (fusionLabels ? 16.5 : 13.5)
    const labelWidth = Math.min(fusionLabels ? 272 : 218, Math.max(112, textWidth + 24), right - 18)
    const x = Math.max(8 + labelWidth / 2, Math.min(right - labelWidth / 2, point.x))
    const rows = Math.ceil(textWidth / Math.max(1, labelWidth - 20))
    const halfHeight = fusionLabels ? (34 + rows * 20) / 2 : 21
    const idealY = above ? point.y - halfHeight - 15 : point.y + halfHeight + 15
    const y = Math.max(halfHeight + 8, Math.min(height - halfHeight - 18, idealY))
    return { point, label: { x, y }, width: labelWidth }
  }
  const sourceAbove = from.y < to.y
  const endpoints = [place(from, labels[0], sourceAbove), place(to, labels[1], !sourceAbove)]
  return { d, from, to, endpoints }
}

export function layoutVisitorFlows(flows: ProjectedFlow[], width: number, height: number, rightInset: number): FlowMarker[] {
  const left = 12, right = width - rightInset - 10, top = width < 560 ? 91 : 63, bottom = height - 47
  if (right - left < 140 || bottom - top < 84) return []
  const clamp = (value:number, minimum:number, maximum:number) => Math.min(maximum, Math.max(minimum, value))
  const sides: [Array<ProjectedFlow & { y: number }>, Array<ProjectedFlow & { y: number }>] = [[], []]
  for (const flow of flows) {
    const {to, from, source, destination} = flow
    if (to.x < left || to.x > width - 12 || to.y < 12 || to.y > bottom) continue
    const dx = from ? from.x - to.x : source[0] - destination[0]
    const dy = from ? from.y - to.y : destination[1] - source[1]
    const side = dx < 0 ? 0 : 1
    const rail = side === 0 ? left + 4 : right - 4
    const scale = Math.abs(dx) > .01 ? Math.abs((rail - to.x) / dx) : 1
    const projectedY = Math.abs(dx) < Math.abs(dy) * .15 ? (dy < 0 ? top : bottom) : to.y + scale * dy
    sides[side].push({...flow, y:clamp(projectedY,top,bottom)})
  }
  return sides.flatMap((items, side) => {
    const gap = 36
    const capacity = Math.floor((bottom - top) / gap) + 1
    const visible = items.sort((a,b) => (b.share ?? 0) - (a.share ?? 0) || a.id.localeCompare(b.id)).slice(0,capacity)
      .sort((a,b) => a.y - b.y || a.id.localeCompare(b.id))
    let previous = top - gap
    return visible.map((item,index): FlowMarker => {
      const y = clamp(item.y, previous + gap, bottom - (visible.length - index - 1) * gap)
      previous = y
      const labelWidth = clamp(Array.from(item.name).length * 13 + (item.share === null ? 26 : 52), 68, width < 560 ? 90 : 155)
      const x = side === 0 ? left : right - labelWidth
      const startX = side === 0 ? x + labelWidth : x
      const spread = item.to.x - startX
      const bend = Math.min(34, Math.max(-34,(item.to.y - y) * .23))
      const lateral = (side === 0 ? -1 : 1) * Math.max(0, 22 - Math.abs(spread))
      const d = `M ${startX} ${y} C ${startX + spread * .38 + lateral} ${y + bend} ${item.to.x - spread * .28 + lateral} ${item.to.y - bend} ${item.to.x} ${item.to.y}`
      return {...item,x,y,d,width:labelWidth}
    })
  })
}
