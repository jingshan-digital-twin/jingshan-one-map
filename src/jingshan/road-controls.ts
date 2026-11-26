import type { Position } from 'geojson'
import type { CityFeature, Coordinate } from './types.ts'

export const roadControlStyles = {
  closed: { action: '封闭建议', zone: '核心区', color: '#ff4c55' },
  restricted: { action: '限行建议', zone: '缓冲区', color: '#ffba4b' },
  diversion: { action: '疏导建议', zone: '分流区', color: '#3ee08f' },
} as const

type ControlStatus = keyof typeof roadControlStyles

export function roadControlPaint(p:CityFeature['properties'], selected:boolean) {
  const action=String(p.controlStatus ?? p.action ?? p.status ?? '')
  const status:ControlStatus=/diversion|疏导|绕行/.test(action) ? 'diversion'
    : /restricted|限行/.test(action) ? 'restricted' : 'closed'
  const {color}=roadControlStyles[status]
  return {color, fillColor:color, fillOpacity:selected ? .78 : .55, strokeColor:color,
    dashed:p.assessmentLineStyle ? p.assessmentLineStyle==='dashed' : status==='restricted'}
}

type Plan = {
  center: Coordinate
  coreM: number
  bufferM: number
  region: string
  eventId: string
  venueId: string
  useEventPlan: boolean
  roads: CityFeature[]
  published: CityFeature[]
}
type RoadSection = { paths: Coordinate[][]; lengthM: number }

const metersPerDegree = 111_195
const roadClasses: Record<string, string> = {
  motorway: '高速公路', trunk: '快速路', primary: '主干路', secondary: '次干路', tertiary: '支路',
  residential: '居住区道路', minor: '地方道路', service: '场馆及附属道路', unclassified: '地方道路',
}
const directions = ['东','东北','北','西北','西','西南','南','东南']

function linePaths(feature: CityFeature): Position[][] {
  if (feature.geometry.type === 'LineString') return [feature.geometry.coordinates]
  return feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : []
}

function controlStatus(feature: CityFeature): ControlStatus | undefined {
  const status = feature.properties.controlStatus
  return typeof status === 'string' && Object.hasOwn(roadControlStyles, status) ? status as ControlStatus : undefined
}

function distance(a: Position, b: Position, longitudeScale: number) {
  return Math.hypot((a[0] - b[0]) * longitudeScale, (a[1] - b[1]) * metersPerDegree)
}

function roots(a: Coordinate, b: Coordinate, radius: number): number[] {
  if (radius <= 0) return []
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const squared = dx * dx + dy * dy
  if (!squared) return []
  const midpoint = -(a[0] * dx + a[1] * dy) / squared
  const perpendicular = (a[0] * dy - a[1] * dx) ** 2 / squared
  if (perpendicular >= radius * radius) return []
  const half = Math.sqrt((radius * radius - perpendicular) / squared)
  return [midpoint - half, midpoint + half].filter(value => value > 0 && value < 1)
}

function interpolate(a: Position, b: Position, portion: number): Coordinate {
  return [a[0] + (b[0] - a[0]) * portion, a[1] + (b[1] - a[1]) * portion]
}

function clipRoad(path: Position[], plan: Plan, longitudeScale: number) {
  const sections: Record<'closed'|'restricted', RoadSection> = {
    closed: { paths: [], lengthM: 0 }, restricted: { paths: [], lengthM: 0 },
  }
  const local = (point: Position): Coordinate => [
    (point[0] - plan.center[0]) * longitudeScale, (point[1] - plan.center[1]) * metersPerDegree,
  ]
  let previous: keyof typeof sections | undefined
  for (let index = 1; index < path.length; index++) {
    const start = path[index - 1], end = path[index]
    const a = local(start), b = local(end)
    const radius = plan.bufferM
    if (Math.min(a[0], b[0]) > radius || Math.max(a[0], b[0]) < -radius ||
        Math.min(a[1], b[1]) > radius || Math.max(a[1], b[1]) < -radius) {
      previous = undefined
      continue
    }
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (!length) continue
    const intervals = [0, ...roots(a, b, plan.coreM), ...roots(a, b, radius), 1].sort((left, right) => left - right)
    for (let step = 1; step < intervals.length; step++) {
      const from = intervals[step - 1], to = intervals[step]
      const mid = Math.hypot(...interpolate(a, b, (from + to) / 2))
      const status = mid < plan.coreM ? 'closed' : mid < radius ? 'restricted' : undefined
      if (status) {
        const section = sections[status]
        const last = interpolate(start, end, to)
        if (status === previous) section.paths.at(-1)!.push(last)
        else section.paths.push([interpolate(start, end, from), last])
        section.lengthM += length * (to - from)
      }
      previous = status
    }
  }
  return sections
}

function sectionDescription(paths: Coordinate[][], center: Coordinate, longitudeScale: number, zone: string) {
  const first = paths[0][0]
  const last = paths[0].at(-1)!
  const middle = interpolate(first, last, .5)
  const east = (middle[0] - center[0]) * longitudeScale
  const north = (middle[1] - center[1]) * metersPerDegree
  const angle = Math.atan2(north, east)
  const direction = directions[(Math.round(angle * 4 / Math.PI) + 8) % 8]
  return Math.hypot(east, north) < 35 ? '场馆近侧 · ' + zone : '场馆' + direction + '侧 · ' + zone
}

export function planRoadControls(plan: Plan): CityFeature[] {
  const longitudeScale = metersPerDegree * Math.cos(plan.center[1] * Math.PI / 180)
  const approved = plan.published.flatMap(feature => {
    const fields = feature.properties
    const status = controlStatus(feature)
    const paths = linePaths(feature)
    if (fields.eventId !== plan.eventId || !status || !paths.length ||
        (fields.venueId ? fields.venueId !== plan.venueId : !plan.useEventPlan)) return []
    const lengthM = paths.reduce((length, path) => length + path.slice(1).reduce((sum, point, index) =>
      sum + distance(path[index], point, longitudeScale), 0), 0)
    return [{ ...feature, properties: {
      ...fields, ...roadControlStyles[status], lengthM: Math.round(lengthM), kind: 'road-control', planSource: 'published',
    }}]
  })
  if (approved.length || !plan.bufferM) return approved

  const groups = new Map<string, RoadSection & { name: string; status: 'closed'|'restricted'; roadClass: string }>()
  for (const feature of plan.roads) {
    const fields = feature.properties
    const highway = String(fields.highway ?? '').replace(/_link$/, '')
    const roadClass = roadClasses[highway] ?? '道路'
    const name = String(fields.name || fields.ref || '')
    for (const path of linePaths(feature)) {
      const sections = clipRoad(path, plan, longitudeScale)
      for (const status of ['closed', 'restricted'] as const) {
        const section = sections[status]
        if (section.lengthM < 1) continue
        const key = status + ':' + (name || feature.id)
        let group = groups.get(key)
        if (!group) {
          group = { name: name || '未命名' + roadClass, status, roadClass, paths: [], lengthM: 0 }
          groups.set(key, group)
        }
        group.paths.push(...section.paths)
        group.lengthM += section.lengthM
      }
    }
  }
  return [...groups].sort(([, left], [, right]) =>
    Number(right.status === 'closed') - Number(left.status === 'closed') || right.lengthM - left.lengthM
  ).map(([key, group], index) => ({
    type: 'Feature',
    id: plan.eventId + ':road-control:' + key,
    geometry: group.paths.length === 1 ? { type: 'LineString', coordinates: group.paths[0] }
      : { type: 'MultiLineString', coordinates: group.paths },
    properties: {
      name: group.name, region: plan.region, kind: 'road-control',
      ...roadControlStyles[group.status], controlStatus: group.status, roadClass: group.roadClass,
      sectionCode: 'RD-' + String(index + 1).padStart(3,'0'),
      sectionName: sectionDescription(group.paths, plan.center, longitudeScale, roadControlStyles[group.status].zone),
      lengthM: Math.round(group.lengthM), planSource: 'simulation',
    },
  }))
}

export function roadControlPosition(feature: CityFeature): Coordinate | null {
  if(feature.geometry.type==='Polygon' || feature.geometry.type==='MultiPolygon'){
    const center=feature.properties.center
    if(Array.isArray(center)&&center.length===2&&center.every(Number.isFinite))return [center[0],center[1]]
  }
  let longest = 0
  let position: Coordinate | null = null
  for (const path of linePaths(feature)) {
    for (let index = 1; index < path.length; index++) {
      const length = distance(path[index - 1], path[index], metersPerDegree)
      if (length > longest) {
        longest = length
        position = interpolate(path[index - 1], path[index], .5)
      }
    }
  }
  return position
}
