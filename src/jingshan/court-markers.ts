import { inPolygon } from './analytics.ts'
import { districtCenter, type createFacilityBoundaryIndex } from './facility-boundaries.ts'
import { featureCenter, type CityFeature, type Coordinate } from './types.ts'

type CourtBounds = [west: number, south: number, east: number, north: number]
export type CourtGroup = {
  name: string; position: Coordinate; count: number; subjects?: number
  bounds?: CourtBounds; featureId?: string; townId?: string; villageId?: string
  fixedCenter?: boolean
}
export type ProjectedGroup = CourtGroup & { id: string; x: number; y: number }
export type CourtMarker = ProjectedGroup & {
  kind: 'district' | 'facility' | 'cluster'
  detail: string
  label?: 'above' | 'below' | 'right' | 'left'
  diameter: number
  members: number
  leader?: { x: number; y: number; length: number; angle: number }
}
export type BadgeBounds = { x: number; y: number; width: number; height: number }

function includeBounds(a: CourtBounds, b: CourtBounds): CourtBounds {
  return [Math.min(a[0],b[0]), Math.min(a[1],b[1]), Math.max(a[2],b[2]), Math.max(a[3],b[3])]
}

function mergeCourtGroup(groups: Map<string,CourtGroup>, id: string, entry: CourtGroup) {
  const group = groups.get(id)
  if (!group) {
    groups.set(id,entry)
    return
  }
  const count = group.count + entry.count
  group.position = [(group.position[0] * group.count + entry.position[0] * entry.count) / count,
    (group.position[1] * group.count + entry.position[1] * entry.count) / count]
  group.count = count
  if (group.bounds && entry.bounds) group.bounds = includeBounds(group.bounds,entry.bounds)
  delete group.featureId
}

type BoundaryIndex = ReturnType<typeof createFacilityBoundaryIndex>
type CourtAreas = {center: Coordinate; town?: CityFeature; village?: CityFeature}
const courtAreasByIndex = new WeakMap<BoundaryIndex,WeakMap<CityFeature,CourtAreas>>()

export function locateCourtAreas(feature: CityFeature, index: BoundaryIndex): CourtAreas | null {
  let cache = courtAreasByIndex.get(index)
  if (!cache) {
    cache = new WeakMap()
    courtAreasByIndex.set(index,cache)
  }
  const known = cache.get(feature)
  if (known) return known
  const center = featureCenter(feature)
  if (!center) return null
  const areas = {center,...index.locate(center)}
  cache.set(feature,areas)
  return areas
}

const boundaryExtents = new WeakMap<CityFeature,{bounds?:CourtBounds; center?:Coordinate}>()
export function boundaryExtent(area: CityFeature) {
  const known = boundaryExtents.get(area)
  if (known) return known
  const geometry = area.geometry
  const parts = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
  for (const rings of parts) {
    for (const [x,y] of rings[0] ?? []) {
      west = Math.min(west,x)
      south = Math.min(south,y)
      east = Math.max(east,x)
      north = Math.max(north,y)
    }
  }
  const bounds: CourtBounds | undefined = Number.isFinite(west) ? [west,south,east,north] : undefined
  const center = featureCenter(area)
  const extent = {bounds,center:center && parts.some(rings=>inPolygon(center,rings)) ? center : undefined}
  boundaryExtents.set(area,extent)
  return extent
}

function addDistrict(groups: Map<string,CourtGroup>, id: string, area: CityFeature | undefined,
  entry: CourtGroup, centerDistricts:boolean) {
  const group = groups.get(id)
  if (group) {
    group.count += entry.count
    if (!area && group.bounds && entry.bounds) group.bounds = includeBounds(group.bounds,entry.bounds)
    return
  }
  if (area) {
    const extent = boundaryExtent(area)
    const center = centerDistricts ? districtCenter(area) : undefined
    if (center) entry.position = center
    else if (extent.center) entry.position = extent.center
    if (extent.bounds) entry.bounds = extent.bounds
  }
  groups.set(id,entry)
}

export function indexCourtFeatures(features: CityFeature[], footprints: boolean, boundaryIndex?: BoundaryIndex, centerDistricts = false) {
  const courts: (CourtAreas & {feature:CityFeature; townId?:string; villageId?:string})[] = []
  const villages = new Map<string,CourtGroup>()
  const districts = new Map<string,CourtGroup>()
  const facilities = new Map<string,CourtGroup>()
  let count = 0
  for (const feature of features) {
    const p = feature.properties
    if (p.kind !== (footprints ? 'court-footprint' : 'court') ||
        (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon')) continue
    const areas = boundaryIndex && locateCourtAreas(feature,boundaryIndex)
    const center = areas?.center ?? featureCenter(feature)
    if (!center) continue
    const quantity = !footprints && typeof p.count === 'number' && Number.isFinite(p.count) && p.count > 0
      ? Math.max(1,Math.round(p.count)) : 1
    const region = p.region?.trim() || '京山市'
    let facility = feature.id
    let name = p.name?.trim() || (footprints ? '网球场地' : '网球场馆')
    if (!footprints) {
      const facilityName = typeof p.facilityName === 'string' ? p.facilityName.trim() : ''
      facility = p.facilityId ? String(p.facilityId) : facilityName ? region + ':' + facilityName : feature.id
      name = facilityName || name
    }
    const extent: CourtBounds = [center[0],center[1],center[0],center[1]]
    const source = footprints ? {bounds:extent,featureId:feature.id} : {}
    const town = areas?.town
    const village = areas?.village
    if (boundaryIndex) {
      const townKey = town?.id ?? 'unknown-town'
      const common = {position:center,count:quantity,bounds:extent,townId:town?.id,fixedCenter:centerDistricts}
      addDistrict(districts,townKey,town,{...common,name:town?.properties.name ?? '镇街待核实'},centerDistricts)
      addDistrict(villages,village?.id ?? 'unknown-village:' + townKey,village,
        {...common,name:village?.properties.name ?? '村社待核实',villageId:village?.id},centerDistricts)
    } else {
      mergeCourtGroup(districts,region,{name:region,position:center,count:quantity,...source})
    }
    mergeCourtGroup(facilities,facility,{name,position:center,count:quantity,...source})
    courts.push({feature,center,town,village,townId:town?.id,villageId:village?.id})
    count += quantity
  }
  return {courts,districts,villages,facilities,count}
}

export const overlaps = (a: BadgeBounds, b: BadgeBounds) => a.x < b.x + b.width && b.x < a.x + a.width &&
  a.y < b.y + b.height && b.y < a.y + a.height

function groupNearby(groups: ProjectedGroup[], radius: number): ProjectedGroup[][] {
  const remaining = new Set(groups)
  return groups.flatMap(anchor => {
    if (!remaining.delete(anchor)) return []
    const neighbors = [anchor]
    for (const candidate of remaining) {
      if (Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y) <= radius) {
        remaining.delete(candidate)
        neighbors.push(candidate)
      }
    }
    return [neighbors]
  })
}

function marker(members: ProjectedGroup[], district: boolean, largeLabels: boolean): CourtMarker {
  const first = members[0]
  const multiple = members.length > 1
  const count = members.reduce((total, item) => total + item.count, 0)
  const mean = (value: (group: ProjectedGroup) => number) =>
    members.reduce((total, group) => total + group.count * value(group), 0) / count
  const bounds = first.bounds && members.reduce((extent, item) =>
    item.bounds ? includeBounds(extent,item.bounds) : extent,first.bounds)
  const name = multiple ? (bounds ? '邻近网球场地' : members.length + ' 处场馆') : first.name
  const detail = district && first.subjects !== undefined ? name + ' · 主体 ' + first.subjects : name
  const diameter = countBadgeDiameter(count,multiple,largeLabels)
  return {
    id: multiple ? 'cluster:' + first.id : first.id,
    name, detail, count, members: members.length, label: undefined,
    kind: district ? 'district' : multiple ? 'cluster' : 'facility',
    x: bounds && !first.fixedCenter ? Math.round(mean(item => item.x)) : first.x,
    y: bounds && !first.fixedCenter ? Math.round(mean(item => item.y)) : first.y,
    bounds, featureId: multiple ? undefined : first.featureId,
    fixedCenter:first.fixedCenter, position: multiple ? [mean(item => item.position[0]), mean(item => item.position[1])] : first.position,
    diameter,
  }
}

export function countBadgeDiameter(count:number, multiple:boolean, largeLabels:boolean) {
  const digits = String(count).length
  const size = Math.min(35, Math.max(digits * 8 + 10, (multiple ? 25 : 19) + Math.sqrt(count)))
  return largeLabels ? Math.max(26,digits*10+8,size) : size
}

type PositionedBadge = Pick<CourtMarker,'x'|'y'|'diameter'|'detail'|'label'|'leader'|'fixedCenter'>

export function badgeBounds({x,y,diameter}: Pick<PositionedBadge,'x'|'y'|'diameter'>): BadgeBounds {
  return {x:x - diameter / 2 - 2, y:y - diameter / 2 - 2, width:diameter + 4, height:diameter + 4}
}

export function separateDistrictBadges(markers: PositionedBadge[], width: number, height: number, administrative = false) {
  const occupied = markers.filter(item=>item.fixedCenter).map(badgeBounds)
  const directions = [[1,0], [-1,0], [0,1], [0,-1], [.707,-.707], [.707,.707], [-.707,.707], [-.707,-.707]]
  const distances = administrative ? [8,16,24] : [16,28,40,52]
  const offsets = distances.flatMap(distance => directions.map(([x,y]) => [x*distance,y*distance]))
  const overlapArea = (rect: BadgeBounds) => occupied.reduce((area,other) => area +
    Math.max(0,Math.min(rect.x+rect.width,other.x+other.width)-Math.max(rect.x,other.x)) *
    Math.max(0,Math.min(rect.y+rect.height,other.y+other.height)-Math.max(rect.y,other.y)),0)
  for (const item of markers) {
    if (item.fixedCenter) continue
    const origin = badgeBounds(item)
    let best = overlapArea(origin)
    let dx = 0, dy = 0
    for (const [x,y] of offsets) {
      if (!best) break
      const shifted = {...origin,x:origin.x+x,y:origin.y+y}
      if (shifted.x<4 || shifted.y<4 || shifted.x+shifted.width>width-4 || shifted.y+shifted.height>height-24) continue
      const area = overlapArea(shifted)
      if (area < best && (administrative || !area)) {
        best = area
        dx = x
        dy = y
      }
    }
    if (!administrative && (dx || dy)) item.leader = {x:item.x,y:item.y,length:Math.hypot(dx,dy),angle:Math.atan2(dy,dx)}
    item.x += dx
    item.y += dy
    occupied.push(badgeBounds(item))
  }
}

export function layoutCourtMarkers(groups: ProjectedGroup[], level: boolean | 'town' | 'village', width: number, height: number, largeLabels = false): CourtMarker[] {
  const district = Boolean(level)
  const ordered = groups.filter(({x,y,fixedCenter}) => fixedCenter
    ? x>=0 && x<=width && y>=0 && y<=height : x>=12 && x<=width-12 && y>=12 && y<=height-24)
    .sort((a,b) => b.count - a.count || a.id.localeCompare(b.id))
  const markers = (district ? ordered.map(group => [group]) : groupNearby(ordered, width < 460 ? 46 : 40))
    .map(members => ({...marker(members,district,largeLabels),townId:members[0].townId,villageId:members[0].villageId}))
  if (district && markers.some(item=>!item.fixedCenter)) separateDistrictBadges(markers,width,height,typeof level === 'string')
  placeBadgeLabels(markers,width,height,largeLabels)
  return markers
}

export function badgeLabelOptions({x,y,diameter,detail}: PositionedBadge, width: number, height: number, large: boolean, maxLabelWidth = 164, extraWidth = 0) {
  const size = large ? 16 : 12
  const labelHeight = size + 10
  const labelWidth = Math.min(maxLabelWidth, Array.from(detail).reduce((sum, char) =>
    sum + (char.charCodeAt(0) < 128 ? Math.ceil(size * .55) : size + 1), 12 + extraWidth))
  const gap = diameter / 2 + 4
  const positions = [
    ['above', x-labelWidth/2, y-gap-labelHeight],
    ['below', x-labelWidth/2, y+gap],
    ['right', x+gap, y-labelHeight/2],
    ['left', x-gap-labelWidth, y-labelHeight/2],
  ] as const
  return positions.flatMap(([label,left,top]) =>
    left >= 4 && top >= 4 && left+labelWidth <= width-4 && top+labelHeight <= height-24
      ? [{label,bounds:{x:left,y:top,width:labelWidth,height:labelHeight}}] : [])
}

export function placeBadgeLabels(markers: PositionedBadge[], width: number, height: number, largeLabels: boolean) {
  const occupied = markers.map(badgeBounds)
  for (const marker of markers) {
    if (!marker.detail) continue
    const choice = badgeLabelOptions(marker,width,height,largeLabels).find(option =>
      !occupied.some(other => overlaps(option.bounds,other)))
    if (choice) {
      marker.label = choice.label
      occupied.push(choice.bounds)
    }
  }
}
