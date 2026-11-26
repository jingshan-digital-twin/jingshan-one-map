import type { Feature, Geometry } from 'geojson'
import type { VenueModelFocus } from './service-model-location.ts'
import type { MapBinding } from './map-bindings.ts'

export type Coordinate = [number, number]
export type LocationReview = {
  checkedOn: string
  note: string
  queries?: string[]
  poi?: {
    uid: string
    name: string
    address: string
    crs: 'BD09MC'
    coordinates: Coordinate
  }
  /** WGS84 reference for finding a registered address when its operating site is unconfirmed. */
  chainLocation?: {
    coordinates: Coordinate
    label: string
    precision: string
    reference: NonNullable<LocationReview['poi']>
  }
  supportingUrl?: string
}

export function baiduPlaceUrl(uid?: string): string | undefined {
  if (uid && /^[a-f0-9]{24}$/i.test(uid))
    return 'https://api.map.baidu.com/place/detail?uid=' + uid + '&output=html&src=webapp.jingshan.tennis'
}
export type Scene = 'overview' | 'venues' | 'events' | 'tourism' | 'industry' | 'talent' |
  'investment' | 'liveEvent' | 'consumption' | 'merchants'
export type CityFeature = Feature<Geometry, {
  name: string
  region: string
  kind: string
  color?: string
  count?: number
  locationReview?: LocationReview
  [key: string]: unknown
}> & { id: string }

export type MapCamera = {longitude:number; latitude:number; height:number; tilted:boolean; bounds?:[number,number,number,number]}
export type MapAction = 'home' | 'in' | 'out' | 'tilt' | 'pick' | 'focus' | 'measure' | 'clear' | 'fit-promotion'
export type MapFitLimits = { minHeight?:number; maxHeight?:number; anchor?:Coordinate }
export type MapCommand = { serial: number; venueFocus?: VenueModelFocus } & (
  | { action: MapAction; position?: Coordinate; height?: number; view?: 'area' | 'model'; immediate?: boolean; locationName?: string }
  | { action: 'focus-layer'; layerId: string }
  | ({ action: 'fit-features'; features: CityFeature[]; layerId?: string; view?: 'model' | 'plan' | 'context' } & MapFitLimits)
  | { action: 'cancel-layer-focus'; layerId?: string }
)

export type Dataset = {
  id: string
  name: string
  department: string
  category: string
  description: string
  derivedFrom?: string
  formSchema?: { fields: FormField[] }
  source?: {serviceId: string; serviceName: string; syncedAt: string; count: number}
  features: CityFeature[]
}

export type FormField = {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'boolean' | 'multiselect'
  required?: boolean
  options?: string[]
  unique?: boolean
  hint?: string
  defaultValue?: string | number | boolean | string[]
}

export type DataDocument = {
  portalCatalog?: import('./portal-catalog.ts').PortalCatalog
  datasets: Dataset[]
  serviceRemovals?: {id:string; revision:number}[]
  mapBindings?: MapBinding[]
  rules: Record<string, number>
  mode: 'demo' | 'live'
  imagery?: { url: string; credit: string; bounds: [number, number, number, number] }
}

export type PublishedData = { data: DataDocument; version: number; publishedAt: string; deferredPopulation?: string[]; deferredReserves?:string[] }
export type DataWorkspace = PublishedData & { draft: DataDocument; revision: number; updatedAt: string }
export type Result = {
  id: number
  scene: Scene
  title: string
  department: string
  summary: string
  status: 'pending' | 'received' | 'completed'
  createdAt: string
  version: number
  features: CityFeature[]
}

export function featureCenter(feature: CityFeature): Coordinate | null {
  const geometry = feature.geometry
  const center = feature.properties.center
  if (feature.properties.kind === 'population-grid' && Array.isArray(center) && center.length === 2 && center.every(Number.isFinite)) {
    return [center[0], center[1]]
  }
  if (geometry.type === 'Point') return [geometry.coordinates[0], geometry.coordinates[1]]
  const ring = geometry.type === 'LineString' ? geometry.coordinates
    : geometry.type === 'Polygon' ? geometry.coordinates[0]?.slice(0, -1)
    : geometry.type === 'MultiPolygon' ? geometry.coordinates[0]?.[0]?.slice(0, -1) : undefined
  if (!ring?.length) return null
  return [ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
    ring.reduce((sum, point) => sum + point[1], 0) / ring.length]
}
