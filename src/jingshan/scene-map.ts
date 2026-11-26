import type { CityFeature, Coordinate } from './types'
import type { CimService } from './cim-types'
import { venueOwnershipGroups } from './venue-ownership.ts'
import type { ReserveFilter } from './investment-planning.ts'
import type { RasterSelection } from './population-raster.ts'
import type { VenueModelFocus } from './service-model-location.ts'

export interface SceneMap {
  features: CityFeature[]
  reserveFilter?: ReserveFilter
  investmentPane?: 'demand' | 'reserve' | 'records' | 'tasks'
  servicePane?: 'venues'|'facilities'|'gaps'|'plan'|'tasks'
  facilityView?: 'directory' | 'detail'
  venueDetail?: boolean
  populationOverview?: boolean
  populationRegion?: string
  populationMode?: 'opening'|'investment'
  populationSelection?: RasterSelection
  courtFootprints?: { region?: string; radiusM?: number; facilityId?: string }
  focus?: 'county' | 'area' | 'model'
  focusRevision?: number
  anchor?: Coordinate
  fitFeature?: CityFeature
  height?: number
  venueModelFocus?: VenueModelFocus
}

export function isLocalSceneModel(service: CimService) {
  return service.kind === '3dtiles' && service.enabled &&
    /\/local-tiles\/(tennis-southwest|tennis-northeast)\/tileset\.json(?:\?|$)/.test(service.mapUrl)
}

export function isCityWhiteModel(service: CimService) {
  return service.kind === '3dtiles' && (/\/local-tiles\/central-white\//.test(service.mapUrl) ||
    /城区.*白模|白模.*城区/.test(service.name))
}

const symbols: Record<string, [string, string]> = {
  venue: ['场馆', '#58bdff'], support: ['配套资源', '#48c9c3'], task: ['交办场馆', '#448bfa'],
  coverage: ['服务覆盖', '#589ff7'], gap: ['服务缺口', '#ff8057'], range: ['服务范围', '#54dbe1'],
  link: ['服务关联', '#63dfe8'], park: ['园区范围', '#448bfa'], parcel: ['项目地块', '#ff595e'],
  reserveGroup: ['项目拟储备地块', '#9A58FF'], candidate: ['候选地块', '#ffc442'], building: ['匹配建筑', '#5cd6fa'], demand: ['招商需求', '#ffba47'],
  project: ['在册招商项目', '#ffd15e'], opportunity: ['需求范围', '#df765e'],
}

export function sceneSymbol(feature: CityFeature) {
  const p = feature.properties
  const role = String(p.mapRole ?? '')
  const symbol = symbols[role]
  if (!symbol || p.legendLabel === false) return
  const pinKind = role==='venue' ? 'venue' : role==='support' && typeof p.supportKind==='string' ? p.supportKind : undefined
  const serviceRangeCenter = (role==='support' || role==='venue') && p.serviceRangeCenter===true
  return { role, pinKind, serviceRangeCenter, label: String(p.legendLabel || symbol[0]), color: String(p.legendColor || p.color || symbol[1]) }
}

export function sceneLegend(features: CityFeature[]) {
  const entries = new Map<string, NonNullable<ReturnType<typeof sceneSymbol>>>()
  for (const feature of features) {
    const entry = sceneSymbol(feature)
    if (entry && !entries.has(entry.label)) entries.set(entry.label, entry)
  }
  const ownership = venueOwnershipGroups.flatMap(group => {
    const entry=entries.get(group.shortLabel)
    if(entry?.role!=='venue')return []
    entries.delete(group.shortLabel)
    return [entry]
  })
  return [...entries.values(),...ownership]
}
