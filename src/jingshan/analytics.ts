import type { Geometry, Position } from 'geojson'
import { populationDataset } from './population-grid.ts'
import { hasEnterpriseDirectory } from './chain-taxonomy.ts'
import { buildChainCatalog, buildPanoramaCatalog, chain, commerceChainTopics, scopeEnterprises } from './industry-panorama.ts'
import { planRoadControls } from './road-controls.ts'
import { dashboardPalette } from './dashboard-palette.ts'
import { venueOwnershipGroup } from './venue-ownership.ts'
import { isCourtLedgerId } from './court-ledger.ts'
import { featureCenter } from './types.ts'
import type { CityFeature, Coordinate, Dataset } from './types.ts'

export const defaultRules = {
  walkM: 1200,
  cycleM: 3000,
  driveM: 6500,
  courtAreaM2: 670,
  carShare: 0.58,
  carOccupancy: 2.4,
  lodgingShare: 0.75,
  medicalPointPeople: 1600,
  ambulancePeople: 5000,
  peoplePerCourt: 4000,
  hotelRadiusM: 3000,
  parkingRadiusM: 2000,
}
export type Rules = typeof defaultRules
type RuleOverrides = Partial<Rules>

export function normalizeRules(overrides?: RuleOverrides): Rules {
  const rules = { ...defaultRules }
  for (const key of Object.keys(rules) as (keyof Rules)[]) {
    const value = overrides?.[key]
    const proportion = key === 'carShare' || key === 'lodgingShare'
    if (typeof value === 'number' && Number.isFinite(value) && (proportion ? value >= 0 : value > 0)) {
      rules[key] = proportion ? Math.min(1, value) : value
    }
  }
  return rules
}

const radiusOfEarth = 6_371_008.8
const radians = Math.PI / 180
const positionOf = featureCenter
export { positionOf }

export function distanceM(a: Coordinate, b: Coordinate) {
  const latitude = (b[1] - a[1]) * radians
  const longitude = (b[0] - a[0]) * radians
  const chord = Math.sin(latitude / 2) ** 2 +
    Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(longitude / 2) ** 2
  return 2 * radiusOfEarth * Math.asin(Math.min(1, Math.sqrt(chord)))
}

function offset(origin: Coordinate, eastM: number, northM: number): Coordinate {
  return [
    origin[0] + eastM / (radiusOfEarth * Math.cos(origin[1] * radians) * radians),
    origin[1] + northM / (radiusOfEarth * radians),
  ]
}

function number(feature: CityFeature | undefined, key: string, fallback = 0) {
  const value = feature?.properties[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function label(feature: CityFeature | undefined, key: string, fallback = '') {
  const value = feature?.properties[key]
  return typeof value === 'string' ? value : fallback
}

function yes(feature: CityFeature, key: string) {
  return feature.properties[key] === true
}

function rate(part: number, whole: number) {
  return whole ? Math.round(1000 * part / whole) / 10 : 0
}

function layer(datasets: Dataset[], id: string, region?: string) {
  return (datasets.find(item => item.id === id)?.features ?? []).filter(feature =>
    !region || region === '京山市' || feature.properties.region === region || feature.properties.community === region)
}

function sum(features: CityFeature[], key: string, fallback = 0) {
  return features.reduce((total, feature) => total + Math.max(0, number(feature, key, fallback)), 0)
}

function mapped(feature: CityFeature, kind: string, properties: Partial<CityFeature['properties']> = {}): CityFeature {
  const id = kind === feature.properties.kind ? feature.id : kind + ':' + feature.id
  return { ...feature, id, properties: { ...feature.properties, kind, ...properties, sourceId: feature.id } }
}

function generated(id: string, name: string, kind: string, region: string, geometry: Geometry, color: string): CityFeature {
  return { type: 'Feature', id, geometry, properties: { name, kind, region, color } }
}

export function circle(id: string, name: string, kind: string, region: string, center: Coordinate, radiusM: number, color: string) {
  const ring: Coordinate[] = []
  for (let index = 0; index < 36; index++) {
    const angle = index * 2 * Math.PI / 36
    ring.push(offset(center, radiusM * Math.cos(angle), radiusM * Math.sin(angle)))
  }
  ring.push(ring[0])
  return generated(id, name, kind, region, { type: 'Polygon', coordinates: [ring] }, color)
}

type Located = { feature: CityFeature; position: Coordinate }
function locate(features: CityFeature[]): Located[] {
  return features.flatMap(feature => {
    const position = positionOf(feature)
    return position ? [{ feature, position }] : []
  })
}

type CourtGroup = { id: string; position: Coordinate; name: string; region: string; count: number }
function courtGroups(features: CityFeature[], individual=false): CourtGroup[] {
  const groups = new Map<string, CourtGroup>()
  for (const { feature, position } of locate(features)) {
    const id = individual ? feature.id : label(feature, 'facilityId', feature.id)
    const count = number(feature, 'count', 1)
    const group = groups.get(id)
    if (group) {
      const nextCount = group.count + count
      if (nextCount > 0) {
        group.position = [
          (group.position[0] * group.count + position[0] * count) / nextCount,
          (group.position[1] * group.count + position[1] * count) / nextCount,
        ]
      }
      group.count = nextCount
    } else {
      groups.set(id, {
        id,
        position,
        count,
        name: label(feature, 'facilityName', feature.properties.name),
        region: feature.properties.region,
      })
    }
  }
  return [...groups.values()]
}

export type CoverageOptions = { mode?: 'walk' | 'cycle' | 'drive'; schools?: boolean; offices?: boolean; region?: string;
  individualCourts?:boolean; contains?:(x:number,y:number)=>boolean }
export type BlindArea = {
  id: string
  name: string
  region: string
  population: number
  reachableCourts: number
  gap: number
  feature: CityFeature
}

export function courtAvailable(court: CityFeature, options: CoverageOptions) {
  if (yes(court, 'open')) return true
  const status = label(court, 'status')
  const kind = venueOwnershipGroup(court.properties.ownership)?.label
  if (court.properties.ledgerId) return court.properties['建设状态']==='已建' && court.properties['是否可协调']==='是' &&
    ((Boolean(options.schools) && kind==='学校') || (Boolean(options.offices) && kind==='机关单位'))
  return (!status || status === '内部使用' || status === '错时开放') &&
    ((Boolean(options.schools) && kind === '学校') || (Boolean(options.offices) && kind === '机关单位'))
}

export function coverage(datasets: Dataset[], options: CoverageOptions = {}, overrides?: RuleOverrides) {
  const rules = normalizeRules(overrides)
  const radiusM = options.mode === 'cycle' ? rules.cycleM : options.mode === 'drive' ? rules.driveM : rules.walkM
  const courts = layer(datasets, 'courts')
  const regionalCourts = layer(datasets, 'courts', options.region)
  const active = courtGroups(courts.filter(court => courtAvailable(court, options)),options.individualCourts)
  const baseline = courtGroups(courts.filter(court => yes(court, 'open')),options.individualCourts)
  const baselineIds = new Set(baseline.map(group => group.id))
  const populationSource = populationDataset(datasets)
  const populationRows = (populationSource?.features ?? []).filter(f => f.properties.population != null &&
    (!options.region || options.region==='京山市' || f.properties.region===options.region || f.properties.community===options.region))
  const populations = locate(populationRows).filter(cell=>!options.contains || options.contains(...cell.position)).map(cell => {
    const reachableCourts = active.reduce((count, group) =>
      count + (distanceM(cell.position, group.position) <= radiusM ? group.count : 0), 0)
    return {
      ...cell,
      population: number(cell.feature, 'population'),
      reachableCourts,
      covered: reachableCourts > 0,
      baselineCovered: baseline.some(group => distanceM(cell.position, group.position) <= radiusM),
    }
  })
  const totalPopulation = populations.reduce((total, cell) => total + cell.population, 0)
  const coveredPopulation = populations.reduce((total, cell) => total + (cell.covered ? cell.population : 0), 0)
  const baselinePopulation = populations.reduce((total, cell) => total + (cell.baselineCovered ? cell.population : 0), 0)
  const blindAreas: BlindArea[] = populations
    .filter(cell => !cell.covered && cell.population > 0)
    .map(cell => {
      const gap = Math.ceil(cell.population / rules.peoplePerCourt)
      const feature = mapped(cell.feature, 'coverage-blind', {
        color: '#ff6b5e', gap, population: cell.population, reachableCourts: cell.reachableCourts,
      })
      return { id: feature.id, name: cell.feature.properties.name, region: cell.feature.properties.region,
        population: cell.population, reachableCourts: cell.reachableCourts, gap, feature }
    })
    .sort((a, b) => b.gap - a.gap || b.population - a.population)

  const regions = new Map<string, { name: string; population: number; coveredPopulation: number; courts: number }>()
  for (const cell of populations) {
    const name = cell.feature.properties.region
    const row = regions.get(name) ?? { name, population: 0, coveredPopulation: 0, courts: 0 }
    row.population += cell.population
    if (cell.covered) row.coveredPopulation += cell.population
    regions.set(name, row)
  }
  for (const court of regionalCourts) {
    const name = court.properties.region
    const row = regions.get(name) ?? { name, population: 0, coveredPopulation: 0, courts: 0 }
    row.courts += number(court, 'count', 1)
    regions.set(name, row)
  }
  const sortedPopulation = populations.map(cell => cell.population).sort((a, b) => a - b)
  const median = sortedPopulation[Math.floor(sortedPopulation.length / 2)] ?? 0
  const diagnosis = new Map([['人多场少', 0], ['人多场多', 0], ['人少场少', 0], ['人少场多', 0]])
  const grids = populations.map(cell => {
    const abundant = cell.reachableCourts >= Math.max(1, Math.ceil(cell.population / rules.peoplePerCourt))
    const dense = cell.population >= median
    const name = (dense ? '人多' : '人少') + (abundant ? '场多' : '场少')
    diagnosis.set(name, (diagnosis.get(name) ?? 0) + 1)
    const color = abundant ? (dense ? '#f6ab49' : '#47bded') : (dense ? '#ff6b5e' : '#d0a6ec')
    return mapped(cell.feature, 'coverage-grid', { color, diagnosis: name, reachableCourts: cell.reachableCourts })
  })
  const regionalGroups = new Set(regionalCourts.map(court => label(court, 'facilityId', court.id)))
  const serviceCircles = active.filter(group => regionalGroups.has(group.id)).map(group => {
    const baselineOpen = baselineIds.has(group.id)
    return circle('coverage:' + group.id, group.name + '服务圈',
      baselineOpen ? 'coverage-service' : 'coverage-additional', group.region, group.position, radiusM,
      baselineOpen ? '#31c9ee' : '#3ee08f')
  })
  const schoolSuggestions = locate(layer(datasets, 'schools', options.region)).filter(({ feature }) => number(feature, 'courts') > 0)
    .map(({ feature, position }) => ({
      feature,
      newPopulation: populations.reduce((total, cell) => total +
        (!cell.baselineCovered && distanceM(cell.position, position) <= radiusM ? cell.population : 0), 0),
    })).filter(row => row.newPopulation > 0).sort((a, b) => b.newPopulation - a.newPopulation)
  return {
    radiusM,
    totalPopulation,
    coveredPopulation,
    coveredRate: rate(coveredPopulation, totalPopulation),
    baselineRate: rate(baselinePopulation, totalPopulation),
    newPopulation: coveredPopulation - baselinePopulation,
    totalCourts: sum(regionalCourts, 'count', 1),
    openCourts: sum(regionalCourts.filter(court => yes(court, 'open')), 'count', 1),
    blindAreas,
    regions: [...regions.values()].map(row => ({
      ...row, coveredRate: rate(row.coveredPopulation, row.population),
      perTenThousand: row.population ? Math.round(row.courts * 100000 / row.population) / 10 : 0,
    })).sort((a, b) => b.perTenThousand - a.perTenThousand),
    diagnosis: [...diagnosis].map(([name, count]) => ({ name, count })),
    schoolSuggestions,
    overlays: [...grids, ...serviceCircles, ...blindAreas.map(area => area.feature)],
    cells: populations,
  }
}

type Rings = Position[][]

function polygons(geometry: Geometry): Rings[] {
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates
  return []
}

function cross(a: Position, b: Position, p: Position) {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
}

function onSegment(a: Position, b: Position, p: Position) {
  const tolerance = 1e-12
  return Math.abs(cross(a, b, p)) <= tolerance &&
    p[0] >= Math.min(a[0], b[0]) - tolerance && p[0] <= Math.max(a[0], b[0]) + tolerance &&
    p[1] >= Math.min(a[1], b[1]) - tolerance && p[1] <= Math.max(a[1], b[1]) + tolerance
}

function inRing(point: Position, ring: Position[]) {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[previous]
    const b = ring[index]
    if (onSegment(a, b, point)) return true
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < a[0] + (point[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) inside = !inside
  }
  return inside
}

export function inPolygon(point: Position, [outer, ...holes]: Rings) {
  return Boolean(outer && inRing(point, outer) && !holes.some(hole => inRing(point, hole)))
}

function properlyCross(a: Position, b: Position, c: Position, d: Position) {
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
}

function ringsCross(a: Position[], b: Position[], touches: boolean) {
  return a.some((start, index) => {
    const end = a[(index + 1) % a.length]
    if (start[0] === end[0] && start[1] === end[1]) return false
    return b.some((otherStart, otherIndex) => {
      const otherEnd = b[(otherIndex + 1) % b.length]
      return properlyCross(start, end, otherStart, otherEnd) || (touches &&
        (onSegment(start, end, otherStart) || onSegment(start, end, otherEnd) ||
          onSegment(otherStart, otherEnd, start) || onSegment(otherStart, otherEnd, end)))
    })
  })
}

export function overlaps(a: Rings, b: Rings) {
  return Boolean(a[0]?.some(point => inPolygon(point, b)) ||
    b[0]?.some(point => inPolygon(point, a)) ||
    a.some(ring => b.some(other => ringsCross(ring, other, true))))
}

/** Keep original surveyed boundaries, including courts crossed by the service-circle edge. */
export function surveyedCourtsInRange(features: CityFeature[], range?: CityFeature, facilityId?: string): CityFeature[] {
  const area = range?.geometry ? polygons(range.geometry) : []
  if (!area.length) return []
  return features.filter(feature => feature.properties.kind === 'court-footprint' &&
    (facilityId === undefined || feature.properties.facilityId === facilityId) && feature.geometry &&
    polygons(feature.geometry).some(court => area.some(boundary => overlaps(court, boundary))))
}

function contains(container: Rings, part: Rings) {
  const [outer, ...holes] = container
  const outline = part[0]
  return Boolean(outer && outline?.every(point => inPolygon(point, container)) &&
    !ringsCross(outer, outline, false) &&
    !holes.some(hole => ringsCross(hole, outline, true) || inPolygon(hole[0], part)))
}

function areaOf(shape: Rings[], origin: Coordinate) {
  const mx = radiusOfEarth * radians * Math.cos(origin[1] * radians)
  const my = radiusOfEarth * radians
  const ringArea = (ring: Position[]) => Math.abs(ring.reduce((area, point, index) => {
    const next = ring[(index + 1) % ring.length]
    return area + (point[0] - origin[0]) * (next[1] - origin[1]) - (next[0] - origin[0]) * (point[1] - origin[1])
  }, 0) * mx * my / 2)
  return Math.round(shape.reduce((total, [outer, ...holes]) =>
    total + ringArea(outer) - holes.reduce((holeTotal, hole) => holeTotal + ringArea(hole), 0), 0))
}

export function featureAreaM2(feature: CityFeature, position: Coordinate) {
  return areaOf(polygons(feature.geometry), position)
}

export type SiteOptions = {
  courtCount?: number
  position?: Coordinate
  region?: string
  blindId?: string
  target?: BlindArea & { underservedPopulation?: number }
  capacityCells?: {position: Coordinate; underservedPopulation: number}[]
}
export function siteSelection(datasets: Dataset[], result: ReturnType<typeof coverage>, options: SiteOptions = {}, overrides?: RuleOverrides) {
  const rules = normalizeRules(overrides)
  const plannedCourts = Math.max(1, Math.round(options.courtCount ?? 2))
  const minimumArea = plannedCourts * rules.courtAreaM2
  const constraints = layer(datasets, 'constraints')
  const farmland = constraints.filter(feature => label(feature, 'constraint') === '永久基本农田')
  const ecology = constraints.filter(feature => label(feature, 'constraint') === '生态保护红线')
  const boundaries = constraints.filter(feature => label(feature, 'constraint') === '城镇开发边界')
  const target = options.target ?? result.blindAreas.find(area => area.id === options.blindId)
  const targetPosition = target ? positionOf(target.feature) : null
  const schools = locate(layer(datasets, 'schools'))

  function evaluate(feature: CityFeature) {
    const shape = polygons(feature.geometry)
    const position = positionOf(feature)
    if (!position || !shape.length) return null
    const area = number(feature, 'area', areaOf(shape, position))
    const targetDistance = targetPosition ? distanceM(position, targetPosition) : null
    const outsideTarget = Boolean(options.target && (targetDistance === null || targetDistance > result.radiusM))
    const hasOverlap = (items: CityFeature[]) => items.some(item =>
      polygons(item.geometry).some(other => shape.some(polygon => overlaps(polygon, other))))
    const onFarmland = hasOverlap(farmland)
    const onEcology = hasOverlap(ecology)
    const withinBoundary = boundaries.length > 0 && shape.every(polygon => boundaries.some(item =>
      polygons(item.geometry).some(container => contains(container, polygon))))
    const newPopulation = result.cells.reduce((total, cell) => total +
      (!cell.covered && distanceM(cell.position, position) <= result.radiusM ? cell.population : 0), 0)
    const nearbySchools = schools.filter(school => distanceM(position, school.position) <= 1000).length
    const ownership = label(feature, 'ownership', '待核实')
    const use = label(feature, 'use', '待核实')
    const roadAccess = yes(feature, 'roadAccess')
    const compliant = !outsideTarget && !onFarmland && !onEcology && withinBoundary && area >= minimumArea
    const capacityRelief = options.capacityCells === undefined ? undefined : compliant
      ? Math.min(plannedCourts * rules.peoplePerCourt, options.capacityCells.reduce((sum, cell) =>
        sum + (distanceM(cell.position, position) <= result.radiusM ? cell.underservedPopulation : 0), 0))
      : 0
    const targetRelief = options.target && capacityRelief !== undefined
      ? Math.min(capacityRelief, options.target.underservedPopulation ?? options.target.population) : undefined
    const reason = [
      outsideTarget && '超出目标短缺网格的服务半径',
      onFarmland && '占用永久基本农田',
      onEcology && '占用生态保护红线',
      !withinBoundary && (boundaries.length ? '位于开发边界外' : '待核实开发边界'),
      area < minimumArea && '面积不足',
    ].filter(Boolean).join('、')
    const suitability = Math.min(48, (capacityRelief ?? newPopulation) / rules.peoplePerCourt * 12)
      + Math.min(18, 10 * area / minimumArea)
      + (/国有|储备/.test(ownership) ? 12 : 4)
      + (roadAccess ? 10 : 0) + Math.min(6, nearbySchools * 3)
      + (targetDistance === null ? 6 : Math.max(0, 6 * (1 - targetDistance / result.radiusM)))
    const score = compliant ? Math.round(Math.min(100, suitability)) : 0
    const kind = compliant ? 'site-recommended' : 'site-rejected'
    return {
      id: feature.id, name: feature.properties.name, area, courts: Math.floor(area / rules.courtAreaM2),
      score, compliant, farmland: onFarmland, ecology: onEcology, withinBoundary, newPopulation,
      nearbySchools, ownership, use, roadAccess, reason, targetDistance, capacityRelief, targetRelief,
      feature: mapped(feature, kind, { color: compliant ? dashboardPalette.green : dashboardPalette.red, score, newPopulation, capacityRelief, targetRelief, reason }),
    }
  }

  const candidates = layer(datasets, 'parcels', options.region).flatMap(feature => {
    const position = options.target ? positionOf(feature) : null
    if (options.target && (!targetPosition || !position || distanceM(position, targetPosition) > result.radiusM)) return []
    const candidate = evaluate(feature)
    return candidate ? [candidate] : []
  }).sort((a, b) => Number(b.compliant) - Number(a.compliant) || b.score - a.score || b.newPopulation - a.newPopulation)
  let proposed: ReturnType<typeof evaluate> = null
  if (options.position) {
    const side = Math.sqrt(minimumArea) / 2
    const points = [[-side, -side], [side, -side], [side, side], [-side, side], [-side, -side]]
    const center = options.position
    const geometry = { type: 'Polygon' as const, coordinates: [points.map(([x, y]) => offset(center, x, y))] }
    const base = generated('site:proposed', '拟建场地', 'site-proposed', options.region ?? '京山市', geometry, '#ffd04a')
    proposed = evaluate({ ...base, properties: { ...base.properties, area: minimumArea } })
  }
  return { minimumArea, candidates, proposed, overlays: [...candidates.map(item => item.feature), ...(proposed ? [proposed.feature] : [])] }
}

export function calendar(datasets: Dataset[]) {
  return layer(datasets, 'events').sort((a, b) => label(a, 'date').localeCompare(label(b, 'date')))
}

const levelRules: Record<string, { coreM: number; bufferM: number; attendance: number; visitorShare: number }> = {
  国际: { coreM: 300, bufferM: 1000, attendance: 4800, visitorShare: 0.8 },
  全国: { coreM: 200, bufferM: 500, attendance: 2200, visitorShare: 0.7 },
  省级: { coreM: 120, bufferM: 300, attendance: 1000, visitorShare: 0.5 },
  群众: { coreM: 0, bufferM: 0, attendance: 320, visitorShare: 0.2 },
}

function nearby(datasets: Dataset[], id: string, position: Coordinate, capacityKey: string) {
  return locate(layer(datasets, id)).map(({ feature, position: place }) => ({
    feature, distanceM: Math.round(distanceM(position, place)),
    capacity: number(feature, capacityKey, capacityKey === 'available' ? number(feature, 'beds') : 0),
  })).sort((a, b) => a.distanceM - b.distanceM)
}

export function eventAssistance(datasets: Dataset[], eventId?: string, size?: number, overrides?: RuleOverrides, venueId?: string, roadNetwork?: CityFeature[]) {
  const rules = normalizeRules(overrides)
  const events = calendar(datasets)
  const event = events.find(item => item.id === eventId) ?? events.find(item => label(item, 'status') !== '已办结') ?? events.at(-1)
  const level = label(event, 'level', '群众').replace('赛事', '')
  const defaults = levelRules[level] ?? levelRules.群众
  const prior = events.filter(item => item.id !== event?.id && label(item, 'status') === '已办结' && label(item, 'level') === level)
  const historicAttendance = prior.length ? Math.round(sum(prior, 'attendance') / prior.length) : defaults.attendance
  const baseSize = number(event, 'attendance', historicAttendance)
  const attendance = event ? Math.max(0, Math.round(typeof size === 'number' && Number.isFinite(size) ? size : baseSize)) : 0
  const historicVisitors = sum(prior, 'attendance') ? sum(prior, 'visitors') / sum(prior, 'attendance') : defaults.visitorShare
  const visitorShare = baseSize > 0 ? Math.max(0, Math.min(1, number(event, 'visitors', baseSize * historicVisitors) / baseSize)) : 0
  const visitors = Math.round(attendance * visitorShare)
  const venue = layer(datasets, 'venues').find(item => item.id === (venueId ?? label(event, 'venueId')))
  const position = (venue && positionOf(venue)) ?? (event ? positionOf(event) : null)
  const region = venue?.properties.region ?? event?.properties.region ?? '京山市'
  const ratio = attendance ? Math.max(0.45, Math.sqrt(attendance / Math.max(1, baseSize))) : 0
  const coreM = Math.round(defaults.coreM * ratio / 10) * 10
  const bufferM = Math.round(defaults.bufferM * ratio / 10) * 10
  const diversionM = Math.round(bufferM * 1.55 / 10) * 10
  const lodgingDemand = Math.ceil(visitors * rules.lodgingShare)
  const parkingDemand = Math.ceil(attendance * rules.carShare / rules.carOccupancy)
  const medicalPoints = Math.ceil(attendance / rules.medicalPointPeople)
  const ambulances = Math.ceil(attendance / rules.ambulancePeople)
  const restriction = attendance >= 5000 ? '需核实市级公安机关安全许可' :
    attendance >= 1000 ? '需核实县级公安机关安全许可' : '按活动规模核实场馆与属地要求'
  const hotels = position ? nearby(datasets, 'hotels', position, 'available') : []
  const parking = position ? nearby(datasets, 'parking', position, 'spaces').filter(item => item.distanceM <= rules.parkingRadiusM) : []
  const hospitals = position ? nearby(datasets, 'medical', position, 'minutes')
    .filter(({feature}) => !feature.properties.sourceServiceId || feature.properties.emergency === true).slice(0, 5) : []
  const food = position ? nearby(datasets, 'food', position, 'capacity').filter(item => item.distanceM <= rules.hotelRadiusM) : []
  const lodgingSupply = hotels.filter(item => item.distanceM <= rules.hotelRadiusM).reduce((total, item) => total + item.capacity, 0)
  const overflowLodgingSupply = hotels.filter(item => item.distanceM > rules.hotelRadiusM).reduce((total, item) => total + item.capacity, 0)
  const parkingSupply = parking.reduce((total, item) => total + item.capacity, 0)
  let hotelRooms = lodgingDemand
  const matchHotels = hotels.filter(item => {
    if (hotelRooms <= 0 || item.capacity <= 0) return false
    hotelRooms -= item.capacity
    return true
  })
  const hotelIds = new Set(matchHotels.map(item => item.feature.id))
  const hospital = hospitals[0]
  const hospitalMinutes = hospital ? number(hospital.feature, 'minutes', Math.max(1, Math.ceil(hospital.distanceM / 420))) : null
  const overlays: CityFeature[] = []
  const roadControls = position && event ? planRoadControls({
    center: position, coreM, bufferM, region, eventId: event.id, venueId: venue?.id ?? label(event, 'venueId'),
    useEventPlan: !venueId || venueId === label(event, 'venueId'),
    roads: roadNetwork ?? layer(datasets, 'road_network'), published: layer(datasets, 'event_road_controls'),
  }) : []
  if (position && event) {
    for (const zone of [
      { radius: diversionM, color: '#3ee08f', kind: 'event-diversion', name: '分流区' },
      { radius: bufferM, color: '#ffb547', kind: 'event-buffer', name: '缓冲区' },
      { radius: coreM, color: '#ff6b5e', kind: 'event-core', name: '核心区' },
    ]) {
      if (zone.radius) overlays.push(circle(event.id + ':' + zone.kind, zone.name + ' ' + zone.radius + '米',
        zone.kind, region, position, zone.radius, zone.color))
    }
    for (let index = 0; index < Math.min(medicalPoints, 20); index++) {
      const angle = index * Math.PI * 2 / Math.min(medicalPoints, 20)
      const place = offset(position, (coreM || 80) * Math.cos(angle), (coreM || 80) * Math.sin(angle))
      overlays.push(generated(event.id + ':medical:' + index, '临时医疗点 ' + (index + 1), 'medical-point', region,
        { type: 'Point', coordinates: place }, '#ff6b5e'))
    }
    const destination = hospital ? positionOf(hospital.feature) : null
    if (destination) overlays.push(generated(event.id + ':hospital-route', '急救联系方向', 'hospital-route', region,
      { type: 'LineString', coordinates: [position, destination] }, '#ff6b5e'))
    const shuttle = parking.filter(item => item.distanceM > coreM).sort((a, b) => b.capacity - a.capacity)[0]
    const shuttlePoint = shuttle ? positionOf(shuttle.feature) : null
    if (shuttlePoint) overlays.push(generated(event.id + ':shuttle', '接驳建议 · ' + shuttle.feature.properties.name, 'shuttle', region,
      { type: 'LineString', coordinates: [shuttlePoint, position] }, '#3ee08f'))
    overlays.push(...roadControls, ...hotels.map(item => mapped(item.feature, 'event-hotel', {
      color: hotelIds.has(item.feature.id) ? '#ffd04a' : '#819db7', matched: hotelIds.has(item.feature.id),
    })))
  }
  return {
    event, venue, position, attendance, visitors, visitorRate: rate(visitors, attendance),
    lodgingDemand, lodgingSupply, lodgingGap: Math.max(0, lodgingDemand - lodgingSupply),
    overflowLodgingSupply, parkingDemand, parkingSupply, parkingGap: Math.max(0, parkingDemand - parkingSupply),
    medicalPoints, ambulances, hospitalMinutes, coreM, bufferM, diversionM, restriction,
    hotels, parking, hospitals, food, roadControls, matchHotels, overlays,
  }
}

function eventMetrics(event: CityFeature | undefined) {
  return {
    attendance: number(event, 'attendance'),
    visitors: number(event, 'visitors'),
    stayDays: number(event, 'stayDays', number(event, 'days')),
    overnightGuests: number(event, 'overnightGuests'),
    nights: number(event, 'nights'),
    spend: number(event, 'spend'),
    scenicVisitors: number(event, 'scenicVisitors'),
    secondarySpendVisitors: number(event, 'secondarySpendVisitors'),
  }
}

export function tourism(datasets: Dataset[], eventId?: string) {
  const events = calendar(datasets)
  const completed = events.filter(event => label(event, 'status') === '已办结')
  const event = completed.find(item => item.id === eventId) ?? completed.at(-1)
  const metrics = eventMetrics(event)
  const occupancy = Array.isArray(event?.properties.occupancy) ?
    event.properties.occupancy.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)) : []
  const origins = event ? layer(datasets, 'origins').filter(item => label(item, 'eventId') === event.id)
    .sort((a, b) => number(b, 'share') - number(a, 'share')) : []
  const routes = layer(datasets, 'routes').filter(item => !label(item, 'eventId') || label(item, 'eventId') === event?.id)
  const attractions = layer(datasets, 'tourism')
  const ranking = [...completed].sort((a, b) => number(b, 'spend') - number(a, 'spend'))
  const annual = eventMetrics(undefined)
  for (const completedEvent of completed) {
    const row = eventMetrics(completedEvent)
    for (const key of Object.keys(annual) as (keyof typeof annual)[]) annual[key] += key === 'stayDays' ? row.stayDays * row.attendance : row[key]
  }
  annual.stayDays = annual.attendance ? Math.round(10 * annual.stayDays / annual.attendance) / 10 : 0
  return {
    event, ...metrics, visitorRate: rate(metrics.visitors, metrics.attendance),
    conversion: rate(metrics.scenicVisitors, metrics.attendance), occupancy, origins, routes, attractions, ranking,
    annual: { ...annual, visitorRate: rate(annual.visitors, annual.attendance), conversion: rate(annual.scenicVisitors, annual.attendance) },
    overlays: [...origins, ...routes],
  }
}

const stages = [
  { name: '上游', subtypes: ['场地建设', '器材制造', '研发测试', '器材零售维修'] },
  { name: '中游', subtypes: ['俱乐部', '培训机构', '场馆运营', '赛事运营'] },
  { name: '下游', subtypes: ['住宿餐饮', '文旅', '传媒', '运动康复'] },
]

export function industry(datasets: Dataset[], region?: string, panorama = false) {
  const directory = hasEnterpriseDirectory(datasets) || datasets.some(dataset => commerceChainTopics[dataset.id])
  const catalogRegion = region || '京山市'
  const catalog = panorama ? buildPanoramaCatalog(datasets, catalogRegion)
    : directory ? buildChainCatalog(datasets, catalogRegion) : undefined
  const businesses = catalog?.map(row => row.feature) ?? layer(datasets, 'businesses', region)
  const projects = layer(datasets, 'projects', region)
  const total = catalog?.length ?? sum(businesses, 'count', 1)
  const breakdown = catalog ? chain.map(stage => {
    const members = scopeEnterprises(catalog, stage.id)
    return { name:stage.id, count:members.length, percentage:rate(members.length,total),
      subtypes:stage.topics.map(name => ({name, count:scopeEnterprises(members, stage.id, name).length})) }
  }) : stages.map(stage => {
    const members = businesses.filter(item => label(item, 'segment') === stage.name)
    const count = sum(members, 'count', 1)
    const keys = [...new Set([...stage.subtypes, ...members.map(item => label(item, 'subtype', '其他'))])]
    return {
      name: stage.name, count, percentage: rate(count, total),
      subtypes: keys.map(name => ({ name, count: sum(members.filter(item => label(item, 'subtype', '其他') === name), 'count', 1) })),
    }
  })
  const gaps = catalog ? [] : breakdown.flatMap(stage => stage.subtypes.filter(item => item.count <= 3)
    .map(item => ({ ...item, stage: stage.name }))).sort((a, b) => a.count - b.count)
  const countStatus = (status: string) => projects.filter(item => label(item, 'status') === status).length
  const projectStatuses = { active: countStatus('在建'), planned: countStatus('规划'), negotiating: countStatus('在谈') }
  return {
    total, businesses, projects,
    clubs: catalog ? scopeEnterprises(catalog, '中游', '俱乐部运营').length : sum(businesses.filter(item => label(item, 'subtype') === '俱乐部'), 'count', 1),
    training: catalog ? scopeEnterprises(catalog, '中游', '培训陪练').length : sum(businesses.filter(item => label(item, 'subtype') === '培训机构'), 'count', 1),
    stages: breakdown, gaps, projectStatuses,
    overlays: [...businesses, ...projects],
  }
}

export function talent(datasets: Dataset[], region?: string, overrides?: RuleOverrides) {
  const population = layer(datasets, 'population', region)
  const learners = layer(datasets, 'learners', region)
  const training = layer(datasets, 'training', region)
  const nearbyTraining = locate(layer(datasets, 'training'))
  const nearbyCourts = courtGroups(layer(datasets, 'courts').filter(feature => yes(feature, 'open')))
  const baseline = coverage(datasets, { region }, overrides)
  const schools = locate(layer(datasets, 'schools', region)).map(({ feature, position }) => ({
    id: feature.id, feature, name: feature.properties.name, region: feature.properties.region,
    students: feature.properties.students == null ? undefined : number(feature, 'students'),
    courts: feature.properties.courts == null ? undefined : number(feature, 'courts'),
    teaching: feature.properties.teaching == null ? undefined : yes(feature, 'teaching'),
    nearbyOpenCourts: nearbyCourts.reduce((total, group) =>
      total + (distanceM(group.position, position) <= 1000 ? group.count : 0), 0),
    nearbyTraining: nearbyTraining.filter(item => distanceM(item.position, position) <= 1000).length,
  }))
  const youth = sum(population, 'youth')
  const trainees = learners.length ? sum(learners, 'trainees') : sum(training, 'trainees')
  const players = learners.length ? sum(learners, 'players') : sum(training, 'players')
  const coaches = learners.length ? sum(learners, 'coaches') : sum(training, 'coaches')
  const byStudents = (a: typeof schools[number], b: typeof schools[number]) => (b.students ?? -1) - (a.students ?? -1)
  const withCourtsWithoutTeaching = schools.filter(item => (item.courts ?? 0) > 0 && item.teaching === false).sort(byStudents)
  const withoutCourts = schools.filter(item => item.courts === 0).sort(byStudents)
  const regionNames = [...new Set(population.map(item => item.properties.region))]
  const regions = regionNames.map(name => {
    const regionYouth = sum(population.filter(item => item.properties.region === name), 'youth')
    const regionTrainees = sum((learners.length ? learners : training).filter(item => item.properties.region === name), 'trainees')
    return { name, youth: regionYouth, trainees: regionTrainees, rate: rate(regionTrainees, regionYouth) }
  }).sort((a, b) => b.rate - a.rate)
  const ageGroups = [
    { name: '6–9岁', count: sum(learners, 'age6to9') },
    { name: '10–12岁', count: sum(learners, 'age10to12') },
    { name: '13–15岁', count: sum(learners, 'age13to15') },
    { name: '16–18岁', count: sum(learners, 'age16to18') },
  ].map(group => ({ ...group, percentage: rate(group.count, trainees) }))
  const priorityZones = baseline.blindAreas.filter(area => {
    const position = positionOf(area.feature)
    return position && withoutCourts.some(school => {
      const schoolPosition = positionOf(school.feature)
      return schoolPosition && distanceM(position, schoolPosition) <= baseline.radiusM
    })
  }).map(area => mapped(area.feature, 'talent-priority', { color: '#ff6b5e', blindId: area.id }))
  return {
    youth, trainees, players, coaches, rate: rate(trainees, youth),
    teachingSchools: schools.every(item => item.teaching !== undefined) ? schools.filter(item => item.teaching).length : undefined,
    campusCourts: datasets.some(d=>isCourtLedgerId(d.id)) ? layer(datasets,'courts',region).filter(c=>venueOwnershipGroup(c.properties.ownership)?.label==='学校').length
      : schools.every(item => item.courts !== undefined) ? schools.reduce((total, item) => total + (item.courts ?? 0), 0) : undefined,
    trainingCount: training.length,
    regions, ageGroups, schools, withCourtsWithoutTeaching, withoutCourts, priorityZones,
    overlays: [...priorityZones, ...schools.map(item => mapped(item.feature, 'school', {
      color: item.teaching ? '#3ee08f' : item.courts ? '#ffb547' : '#819db7',
    }))],
  }
}
