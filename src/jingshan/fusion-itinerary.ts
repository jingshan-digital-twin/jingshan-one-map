import { distanceM } from './analytics.ts'
import { featureCenter, type Coordinate, type Dataset, type CityFeature } from './types.ts'
import { facilityKinds } from './venue-support.ts'
import { serviceSymbols } from './service-point-markers.ts'
import type { PromotionFlow } from './visitor-flows.ts'
import { fusionDestinationsId } from './fusion-destinations.ts'
import { isTourismReference, withLocalTourismSites } from './tourism-register.ts'
export { fusionReturnCities } from './fusion-origin-cities.ts'

type Scope = '京山' | '荆门' | '湖北'
type Venue = { name: string; position: Coordinate }
type Origin = { name: string; position: Coordinate | null }
export type FusionTicket = {
  id: string; name: string; merchantName: string; rule: string
  validFrom: string; validTo: string; sample: boolean; placeId: string | null
}
type Place = {
  id: string; name: string; kind: '景区' | '温泉'; scope: Scope; city: string
  position: Coordinate; sample: boolean; visitMinutes: number
  grade: string; operator: string; address: string; resourceClass: string
}
export type FusionVisit = Place & {
  distanceKm: number; estimatedMinutes: number; detourKm: number | null; offers: FusionTicket[]
}
export type FusionMapView = {
  features: CityFeature[]; flow: PromotionFlow | null; regional: boolean; legend: {label: string; color: string}[]
}

const text = (v: unknown) => typeof v === 'string' ? v.trim() : ''
const inCountyFrame = ([lon, lat]: Coordinate) => lon >= 112.65 && lon <= 113.66 && lat >= 30.55 && lat <= 31.62
const validPosition = (p: Coordinate | null): p is Coordinate =>
  !!p && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90

function placesOf(datasets: Dataset[]) {
  const places = new Map<string, Place>()
  const aliases = new Map<string, string>()
  const layers = withLocalTourismSites(datasets)
  // Keep the published facility identifier when a destination also appears in the partner register.
  for (const layer of ['tourism', 'springs', fusionDestinationsId, 'merchants']) {
    for (const f of layers.find(d => d.id === layer)?.features ?? []) {
      const p = f.properties
      if (!f.geometry || !p.name || isTourismReference(f) || /暂停|停业|下架|闭园|歇业/.test(text(p.status))) continue
      const explicit = layer === fusionDestinationsId
      const kinds = explicit ? [] : facilityKinds(layer, f)
      const kind = explicit ? p.category : kinds.includes('springs') ? '温泉' : kinds.includes('tourism') ? '景区' : null
      if (kind !== '景区' && kind !== '温泉') continue
      const registeredId = text(p.sourceId)
      const existing = registeredId ? aliases.get(registeredId) : null
      if (existing) { aliases.set(f.id, existing); continue }
      // A sample merchant can provide a sample coupon, but does not establish a physical attraction.
      if (layer === 'merchants' && (p.sample === true || p.status !== '已入驻')) continue
      const position = featureCenter(f)
      const scope = p.scope === '荆门' || p.scope === '湖北' ? p.scope : '京山'
      if (!validPosition(position) || scope === '京山' && !inCountyFrame(position)) continue
      const city = text(p.city) || (scope === '京山' ? '京山市' : scope === '荆门' ? '荆门市' : text(p.region))
      const nameKey = [scope, city, p.name.trim()].join('/')
      const same = aliases.get(nameKey)
      if (same && distanceM(places.get(same)!.position, position) < 1000) {
        aliases.set(f.id, same)
        if (registeredId) aliases.set(registeredId, same)
        continue
      }
      const visitMinutes = typeof p.visitMinutes === 'number' && p.visitMinutes > 0
        ? p.visitMinutes : kind === '温泉' ? 60 : 30
      places.set(f.id, {id: f.id, name: p.name, kind, position, city, scope, visitMinutes, sample: p.sample === true,
        grade:text(p.grade),operator:text(p.operator),address:text(p.address),resourceClass:text(p.resourceClass)})
      aliases.set(f.id, f.id)
      aliases.set(nameKey, f.id)
      if (registeredId) aliases.set(registeredId, f.id)
    }
  }
  return {places, aliases}
}

function currentTickets(datasets: Dataset[], aliases: Map<string, string>, date: string, eventId?: string) {
  const merchants = new Map(datasets.find(d => d.id === 'merchants')?.features.map(f => [f.id, f]))
  const tickets: FusionTicket[] = []
  for (const f of datasets.find(d => d.id === 'offers')?.features ?? []) {
    const p = f.properties, merchant = merchants.get(text(p.merchantId))
    if (p.status !== '已上架' || !merchant || merchant.properties.status !== '已入驻' || !date) continue
    const validFrom = text(p.validFrom), validTo = text(p.validTo)
    if (!validFrom || !validTo || date < validFrom || date > validTo || p.eventId && p.eventId !== eventId) continue
    const destinationId = text(p.destinationId)
    const placeId = destinationId ? aliases.get(destinationId) : aliases.get(text(merchant.properties.sourceId)) ?? aliases.get(merchant.id)
    if (destinationId && !placeId) continue
    tickets.push({id: f.id, name: p.name, merchantName: merchant.properties.name, rule: text(p.rule),
      validFrom, validTo, placeId: placeId ?? null, sample: p.sample === true || merchant.properties.sample === true})
  }
  return tickets.sort((a, b) => Number(a.sample) - Number(b.sample) || a.validTo.localeCompare(b.validTo) || a.name.localeCompare(b.name, 'zh-CN'))
}

export function fusionTicketDestinations(datasets: Dataset[]) {
  return [...placesOf(datasets).places.values()].sort((a, b) =>
    a.city.localeCompare(b.city, 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN'))
}

function corridorStop(from: Coordinate, to: Coordinate, stop: Coordinate, direct: number, firstLeg: number) {
  if (direct < 2) return null
  const scale = Math.cos((from[1] + to[1]) / 2 * Math.PI / 180)
  const x = (to[0] - from[0]) * scale, y = to[1] - from[1]
  const u = (stop[0] - from[0]) * scale, v = stop[1] - from[1]
  const progress = (u * x + v * y) / (x * x + y * y)
  const crossTrack = Math.abs(u * y - v * x) / Math.hypot(x, y) * 111.195
  if (progress <= 0 || progress > 1.18 || crossTrack > Math.min(36, Math.max(8, direct * .29))) return null
  const extra = Math.max(0, firstLeg + distanceM(stop, to) / 1000 - direct)
  return extra <= Math.max(12, Math.min(40, direct * .26)) ? extra : null
}

export function fusionItineraries(datasets: Dataset[], venue: Venue | null, origin: Origin | null, date: string, minutes: number, eventId?: string) {
  const {places, aliases} = placesOf(datasets)
  const offers = currentTickets(datasets, aliases, date, eventId)
  const between: FusionVisit[] = [], returnStops: FusionVisit[] = []
  if (!venue || !validPosition(venue.position)) return {between, returnStops, offers}
  const to = origin && validPosition(origin.position) ? origin.position : null
  const direct = to ? distanceM(venue.position, to) / 1000 : 0
  for (const place of places.values()) {
    const distanceKm = distanceM(venue.position, place.position) / 1000
    // Planning allowance: local round trip with a 1.35 road factor and 35 km/h, plus the short visit.
    const estimatedMinutes = Math.ceil((2 * distanceKm * 1.35 / 35 * 60 + place.visitMinutes) / 5) * 5
    const visit: FusionVisit = {...place, distanceKm, estimatedMinutes, detourKm: null, offers: offers.filter(o => o.placeId === place.id)}
    if (place.scope === '京山' && estimatedMinutes <= minutes) between.push(visit)
    if (!to || place.scope === '京山' && distanceKm < Math.max(3, direct * .12)) continue
    const detourKm = corridorStop(venue.position, to, place.position, direct, distanceKm)
    if (detourKm !== null) returnStops.push({...visit, detourKm})
  }
  between.sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name, 'zh-CN'))
  returnStops.sort((a, b) => a.detourKm! - b.detourKm! || a.distanceKm - b.distanceKm)
  return {between, returnStops, offers}
}

const markerColors = {venue: serviceSymbols.venue.color, origin: '#66d8ff', scenic: serviceSymbols.tourism.color, springs: serviceSymbols.springs.color}
function pin(id: string, place: Venue, kind: keyof typeof markerColors, selected = false, showLabel = false): CityFeature {
  const glyph = {venue: '馆', origin: '源', scenic: '游', springs: '泉'}[kind]
  return {id, type: 'Feature', geometry: {type: 'Point', coordinates: place.position},
    properties: {name: place.name, kind: 'fusion-stop', region: '', mapRole: kind === 'venue' ? 'venue' : 'support',
      serviceGlyph: glyph, color: markerColors[kind], selected, showLabel, pickFeatureId: id}}
}

export function fusionTripMap(mode: 'between' | 'return' | 'origin', venue: Venue | null, origin: Origin | null,
  visits: FusionVisit[], selectedId?: string | null): FusionMapView {
  const features: CityFeature[] = [], legend: FusionMapView['legend'] = []
  let flow: PromotionFlow | null = null
  if (!venue || !validPosition(venue.position)) return {features, flow, legend, regional: false}
  const city = origin && validPosition(origin.position) ? {name: origin.name, position: origin.position} : null
  const chosen = visits.find(v => v.id === selectedId)
  const regional = mode !== 'between' && !!city && !inCountyFrame(city.position)
  const visible = mode === 'between' || mode === 'return' && city ? visits : []
  for (const v of visible) features.push(pin(v.id, v, v.kind === '温泉' ? 'springs' : 'scenic', v.id === selectedId, mode === 'return' && v.id === selectedId))
  features.push(pin('fusion:venue', venue, 'venue'))
  legend.push({label: '赛事场馆', color: markerColors.venue})
  if (visible.some(v => v.kind === '景区')) legend.push({label: '景区', color: markerColors.scenic})
  if (visible.some(v => v.kind === '温泉')) legend.push({label: '温泉', color: markerColors.springs})
  const link = (from: Venue, to: Venue, fromKind: string, toKind: string, color: string, qualifier: string): PromotionFlow => ({
    id: ['fusion', mode, from.name, to.name, chosen?.id ?? ''].join(':'), from: from.position, to: to.position,
    fromLabel: from.name, toLabel: to.name, fromKind, toKind, color, qualifier,
  })
  if (mode === 'between' && chosen) {
    flow = link(venue, chosen, '赛事场馆', '赛间游览', markerColors[chosen.kind === '温泉' ? 'springs' : 'scenic'], '赛间游览方向')
  } else if (mode !== 'between' && city) {
    features.push(pin('fusion:origin', city, 'origin'))
    if (mode === 'origin') flow = link(city, venue, '来源地', '赛事场馆', markerColors.origin, '来京山方向')
    else {
      flow = link(venue, city, '赛事场馆', '返程目的地', '#ffcd78', '返程顺游方向')
      if (chosen) flow.via = {position: chosen.position, label: chosen.name}
    }
    legend.push({label: mode === 'origin' ? '来源地' : '返程目的地', color: markerColors.origin})
  }
  return {features, flow, legend, regional}
}

