import { computed, inject, shallowRef, watch, type InjectionKey, type Ref } from 'vue'
import type { VenueModelFocus } from './service-model-location'
import type { CimMapStatus, CimPick } from './cim-map'
import type { CimService } from './cim-types'
import { distanceM } from './analytics'
import { serviceDetailRadiusKm } from './venue-support'
import type { CityFeature, Coordinate, MapCommand } from './types'

export type DirectoryMode = 'scene' | 'category' | 'department'
export interface DirectoryLayer {
  id: string
  name: string
  department: string
  category: string
  count: number
  description: string
}
export interface MapLayerDirectory {
  mode: DirectoryMode
  identity: string
  groups: [string, DirectoryLayer[]][]
  currentIdentity?: DirectoryLayer
  sources: {id:string;name:string;service?:CimService}[]
  services: CimService[]
  visible: string[]
  states: Record<string,CimMapStatus>
  error: string
  imagery: boolean
  boundaries: number
  results: boolean
  overview: boolean
  version?: number
  enabled: (id:string)=>boolean
  toggle: (id:string)=>void
  toggleService: (id:string)=>void
  refresh: ()=>void
  toggleImagery: ()=>void
  toggleResults: ()=>void
  openTable: (id:string)=>void
}

export const mapDirectoryKey: InjectionKey<MapLayerDirectory> = Symbol('map-layer-directory')
export function useMapDirectory() {
  const directory=inject(mapDirectoryKey)
  if (!directory) throw Error('地图图层目录尚未初始化')
  return directory
}

export interface EventCatalogMap {
  features: CityFeature[]
  command: MapCommand | null
  imagery: boolean
  towns: boolean
  table: string
  attributeServiceId?: string
  setVenueFocus: (focus?:VenueModelFocus)=>boolean
  clearOverlays: ()=>void
  status: (state:CimMapStatus)=>void
  pickService: (pick:CimPick)=>void
  pickRow: (id:string)=>void
}
export const eventCatalogMapKey: InjectionKey<EventCatalogMap> = Symbol('event-catalog-map')
export function useEventCatalogMap() {
  const map=inject(eventCatalogMapKey)
  if (!map) throw Error('赛事地图尚未初始化')
  return map
}

export function nearbyEventVenue(venue:VenueModelFocus | undefined, position:Coordinate) {
  if (venue && distanceM(venue.position, position) <= serviceDetailRadiusKm * 1000) return venue
}

export function useEventMapDisplay(features:()=>CityFeature[], command:Ref<MapCommand|null>, nextSerial:()=>number) {
  const catalog = useEventCatalogMap()
  const displayFeatures = computed(() => {
    const current = features()
    if (!catalog.features.length) return current
    const ids = new Set(current.map(f => f.id))
    return [...current, ...catalog.features.filter(f => !ids.has(f.id))]
  })
  watch(()=>catalog.command, next => {
    if (next) command.value = {...next, serial:nextSerial()}
  })
  const displayCommand=shallowRef<MapCommand|null>(null)
  watch(command, next=>{
    if (next && (next.action==='home' || next.action==='focus' || next.action==='fit-features' || next.action==='focus-layer')) {
      const hasModel=catalog.setVenueFocus(next.venueFocus)
      displayCommand.value=next
      if (hasModel && next.venueFocus && (next.action==='focus' || next.action==='fit-features')) {
        const geometry=next.action==='fit-features' && next.features.length===1 && next.view!=='context' ? next.features[0]?.geometry : undefined
        const center=next.action==='focus' ? next.position : geometry?.type==='Point' ? geometry.coordinates : undefined
        const venueCircle=next.action==='fit-features' && next.features.length===1 && next.features[0].properties.kind==='service-range'
        if (venueCircle || (center && distanceM([center[0],center[1]], next.venueFocus.position)<1)) displayCommand.value={...next,view:'model'}
      }
    } else displayCommand.value=next
  },{immediate:true,flush:'sync'})
  return {catalog, displayFeatures, displayCommand}
}
