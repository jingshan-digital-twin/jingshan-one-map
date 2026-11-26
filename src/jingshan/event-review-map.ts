import { distanceM } from './analytics.ts'
import { eventVenueNames } from './event-plan-data.ts'
import type { EventReview } from './event-post-review.ts'
import { serviceSymbols } from './service-point-markers.ts'
import { facilityDirectory, nearbyFacilitySites, serviceDetailRadiusKm, serviceDistance, supportCategories, supportLayerIds } from './venue-support.ts'
import { featureCenter, type Coordinate, type Dataset } from './types.ts'

const kinds = ['parking','hotels','medical','food','tourism','springs'] as const
export type ReviewSupportSite = {
  id: string; name: string; kind: typeof kinds[number]; label: string; color: string; position: Coordinate
  distanceLabel: string; capacityLabel: string; address: string; observedPointId?: string
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const valid = (p: Coordinate | null): p is Coordinate => !!p && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90

function venueKey(name: string) {
  const normalized = name.normalize('NFKC').replace(/\s/g, '').replace(/^京山市?/, '')
  return ['网球中心','国际网球中心','国际网球赛事中心'].includes(normalized) ? '国际网球中心' : normalized
}

export function resolveReviewMapVenue(review: EventReview, datasets: Dataset[]): EventReview {
  const name = text(review.venue).split(/[、；;\n]/u)[0]
  if (!name || /^(?:无|待定|待确认|待核实|未定|未确定|未登记|[-—]+)$/.test(name)) return { ...review, position: null }
  const sites = (datasets.find(d => d.id === 'venues')?.features ?? []).filter(f => f.properties.sample !== true)
  const exact = sites.find(f => f.properties.name === name)
  const names = new Set(eventVenueNames(name).map(venueKey))
  const matches = exact ? [exact] : sites.filter(f => eventVenueNames(f.properties.name).some(alias => names.has(venueKey(alias))))
  const venue = matches.length === 1 ? matches[0] : undefined
  const position = venue?.geometry ? featureCenter(venue) : null
  if (venue && valid(position)) return { ...review, venue: venue.properties.name, position }
  // Sample coordinates predate the survey. Wait for the published venue instead of flying to that old point.
  return { ...review, position: !review.sample && !matches.length && valid(review.position) ? review.position : null }
}

export function reviewSupportSites(datasets: Dataset[], review: EventReview): ReviewSupportSite[] {
  if (!valid(review.position)) return []
  const layers = datasets.filter(d => supportLayerIds.includes(d.id))
  const directory = facilityDirectory(layers).filter(({ feature }) => {
    const p = feature.properties
    return p.sample !== true && p.simulation !== true && p.simulated !== true && p.status !== '暂停'
      && !['地址参照','村级参考','待定位','待核实'].includes(text(p.locationPrecision))
  })
  return kinds.flatMap(kind => {
    const sites = nearbyFacilitySites(review.position, directory.filter(site => site.kind === kind), serviceDetailRadiusKm * 1000)
    return sites.slice(0, 2).map(({ feature, layer, meters }) => {
      const p = feature.properties, position = featureCenter(feature)!
      const observed = review.points.find(point => point.visits > 0 && point.position && distanceM(point.position, position) < 30
        && ((point.datasetId === layer && point.sourceId === feature.id) || point.name === p.name))
      const measure = kind === 'parking' ? ['spaces','车位','个'] : kind === 'hotels' ? ['beds','床位','张']
        : kind === 'food' ? ['seats','餐位','个'] : undefined
      const capacity = measure ? p[measure[0]] : null
      return {
        id: 'review-support:' + layer + ':' + feature.id, name: p.name, kind, position,
        label: supportCategories[kind], color: serviceSymbols[kind].color, distanceLabel: serviceDistance(meters),
        capacityLabel: measure && typeof capacity === 'number' && Number.isFinite(capacity) && capacity >= 0
          ? '登记' + measure[1] + ' ' + capacity.toLocaleString('zh-CN') + ' ' + measure[2] : '',
        address: text(p.address) || text(p.registerAddress), observedPointId: observed?.id,
      }
    })
  })
}
