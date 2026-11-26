<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { venueOwnershipGroup } from './venue-ownership.ts'
import { MapImageMaterialProperty, populationMaterial, SolidReliefMaterialProperty, type ReliefTexture } from './map-image-material'
import { configureMapCameraControls } from './map-camera-controls'
import { eventLabelLayout } from './event-map-labels'
import { roadControlPaint } from './road-controls.ts'
import { pickRaster } from './population-raster'
import { rasterAttributeCanvas, rasterSurface } from './population-raster-surface'
import { populationMapFeature, type PopulationDisplayGrid } from './population-display-grid'
import { populationSurface, type PopulationRange } from './population-surface.ts'
import {
  BoundingSphere, Cartesian2, Cartesian3, Cartographic, ClassificationType, Color, ColorGeometryInstanceAttribute, CornerType,
  CorridorGeometry, CustomDataSource, Ellipsoid, EllipsoidGeodesic, Entity, GeometryInstance, GridImageryProvider,
  GroundPolylineGeometry, GroundPolylinePrimitive, GroundPrimitive, ImageryLayer, LabelStyle, Material, MaterialAppearance,
  Math as CesiumMath, Matrix4, PerInstanceColorAppearance, PerspectiveFrustum, PolygonHierarchy, PolylineColorAppearance,
  PolylineDashMaterialProperty, PolylineGlowMaterialProperty, PolylineOutlineMaterialProperty, Primitive, Rectangle, RectangleGeometry,
  SceneTransforms, ScreenSpaceEventHandler, ScreenSpaceEventType,
  SingleTileImageryProvider, Transforms, VerticalOrigin, Viewer,
} from 'cesium'
import type { EntityCollection } from 'cesium'
import type { FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { featureAreaM2, inPolygon, overlaps as polygonsOverlap } from './analytics.ts'
import { featureCenter, type CityFeature, type Coordinate, type DataDocument, type MapCamera, type MapCommand, type MapFitLimits } from './types.ts'
import { badgeBounds, indexCourtFeatures, layoutCourtMarkers, overlaps, type CourtGroup, type CourtMarker } from './court-markers.ts'
import { courtDrillFrame } from './court-drill-frame.ts'
import { dashboardPalette } from './dashboard-palette.ts'
import { planningRoofTexture } from './planning-relief.ts'
import { reliefSurface, splitReliefCoverage } from './relief-surface.ts'
import { layoutPromotionFlow, layoutVisitorFlows, visitorFlow, type FlowMarker, type PromotionFlow, type VisitorFlow } from './visitor-flows.ts'
import { cimMapImageUrl, createCimMap, focusTargetFromFeatures, type CimFocusTarget, type CimMapStatus, type CimPick, type MapBounds } from './cim-map.ts'
import { isCimBasemap, type CimService } from './cim-types.ts'
import { isLocalSceneModel } from './scene-map.ts'
import { addSceneFeature, availableParcelBatch, gridCell, populationGrid, sceneMapRole } from './scene-map-features.ts'
import { createLiveRoadLayer } from './event-live-road-layer.ts'
import {layoutServiceCaptions, serviceCaptionResolution, type ServiceCaption, type ServicePoint} from './service-point-markers.ts'
import {facilityClusterScale, FACILITY_TOWN_RESOLUTION, FACILITY_VILLAGE_RESOLUTION, SERVICE_RANGE_LABEL_WIDTH, SERVICE_RANGE_CENTER_LABEL_WIDTH, layoutFacilityMarkers, layoutServiceRangeMarkers, type FacilityAnchor, type FacilityMarker} from './facility-clusters.ts'
import {createFacilityBoundaryIndex, districtCenter} from './facility-boundaries.ts'
import FacilityLocationPin from './FacilityLocationPin.vue'
import {supportCategories,type SupportKind} from './venue-support.ts'

type ZoomLevel = 'district' | 'facility' | 'court'
type RoadTier = 'arterial' | 'local' | 'access'
type RoadPath = { positions: Cartesian3[]; bounds: Rectangle; tier: RoadTier; width: number }

const props = withDefaults(defineProps<{
  features: CityFeature[]
  densityCells?: CityFeature[]
  densityRaster?: PopulationDisplayGrid
  attributePixels?: string[]
  attributeServiceId?: string
  densityRange?: PopulationRange
  region: string
  selectedId: string | null
  command: MapCommand | null
  imagery: boolean
  overview?: boolean
  clusterCourtFootprints?: boolean
  centerDistrictClusters?: boolean
  businessScene?: boolean
  eventScene?: boolean
  panorama?: boolean
  highlightedServiceVenue?: string
  showTownBoundaries?: boolean
  showSubjectCounts?: boolean
  selectCourtFacility?: boolean
  lightTheme?: boolean
  serviceLabelsLight: boolean
  preserveCamera?: boolean
  venueDetail?: boolean
  countyRelief?: boolean
  investmentRelief?: boolean
  isolateRegion?: boolean
  showScale?: boolean
  administration?: CityFeature[]
  communityBoundaries?: CityFeature[]
  publishedBoundaryIndex?: ReturnType<typeof createFacilityBoundaryIndex>
  courtScope?: 'town' | 'village'
  imageryConfig?: DataDocument['imagery']
  roadNetwork?: CityFeature[]
  roadControls?: CityFeature[]
  promotionView?: boolean
  fusionScene?: boolean
  promotionFlow?: PromotionFlow | null
  cimLayers?: CimService[]
  cimCatalogReady?: boolean
}>(), { promotionView: undefined, countyRelief: true, showScale: true, cimCatalogReady: true })
const emit = defineEmits<{
  select: [id: string]
  position: [position: Coordinate]
  camera: [position:MapCamera]
  measurement: [meters: number]
  'cim-status': [status: CimMapStatus]
  'cim-pick': [feature: CimPick]
}>()

const element = ref<HTMLDivElement>()
const root = ref<HTMLDivElement>()
const credits = ref<HTMLDivElement>()
const error = ref('')
const hint = ref('')
const zoomLevel = ref<ZoomLevel>('district')
const externalImagery = ref(false)
const localBoundaries = ref<CityFeature[]>([])
type ReserveAnchor = {id:string; level:'town'|'village'; name:string; count:number; world:Cartesian3}
let reserveAnchors:ReserveAnchor[]=[]
let reserveFrame=''
const reserveMarkers=shallowRef<(ReserveAnchor & {x:number; y:number})[]>([])
const courtCount = ref(0)
const courtMarkers = shallowRef<CourtMarker[]>([])
const surveyedCourts = computed(() => props.overview || props.clusterCourtFootprints ||
  props.features.some(feature => feature.properties.kind === 'court-footprint'))
const serviceCaptions = shallowRef<ServiceCaption[]>([])
const rangeCaption = shallowRef<{text:string; x:number; y:number}>()
const rangeCaptionSize = {width:104, height:24}
let rangeBoundaryLabel: {text:string; anchors:Cartesian3[]} | undefined
const facilityMarkers = shallowRef<FacilityMarker[]>([])
const openFacilityGroup = ref('')
const activeFacilityGroup = computed(() => facilityMarkers.value.find(group => group.key === openFacilityGroup.value))
const serviceRangeActive = computed(() => props.features.some(f=>f.properties.markerStyle==='service-range-pin'))
const venueDetailActive = computed(() => props.features.some(f=>f.properties.mapRole==='venue' && f.properties.selected===true))
const flowMarkers = shallowRef<FlowMarker[]>([])
const outboundFlow = shallowRef<ReturnType<typeof layoutPromotionFlow>>(null)
const regionalView = computed(() => props.promotionView ?? Boolean(props.promotionFlow))
const fusionRegion = computed(() => !!props.fusionScene && regionalView.value)
type HubeiCities = FeatureCollection<Polygon | MultiPolygon,{adcode:number;name:string;center:Coordinate}>
const hubeiCities = shallowRef<HubeiCities>()
watch(fusionRegion,async (enabled,_,cleanup)=>{
  if (!enabled || hubeiCities.value) return
  const controller=new AbortController()
  cleanup(()=>controller.abort())
  try {
    const response=await fetch('/imagery/hubei-boundaries.json',{signal:controller.signal})
    if (response.ok) hubeiCities.value=await response.json() as HubeiCities
  } catch { /* The regional satellite layer loads independently of the outlines. */ }
},{immediate:true})
const thematicMap = computed(() => props.businessScene || props.features.some(feature => sceneMapRole(feature)))
const cimGroundOverlay = ref(false)
const cimBasemap = shallowRef<CimService>()
const requestedBasemap = computed(() => props.cimLayers?.find(isCimBasemap))
const failedBasemap = ref<string>()
const reliefImageSize = 1536
const cimRoof = shallowRef<{ image: HTMLImageElement; bounds: MapBounds }>()
let cimCountyOutline = false
let cimTownOutlines = false
const planningRoof=shallowRef<ReliefTexture>()
const planningRoofFailed=ref(false)
const reliefTextureReady = computed(() => Boolean(cimRoof.value) || (props.investmentRelief && props.imagery) || useReferenceImagery.value ||
  (props.cimCatalogReady && !requestedBasemap.value && !props.imagery))
const countyReliefRequested = computed(() => props.lightTheme && props.countyRelief && !regionalView.value && !cimGroundOverlay.value && !planningRoofFailed.value)
const usesCountyOverviewView = computed(() => props.overview || props.panorama || (props.businessScene && props.countyRelief && !props.venueDetail))
const retainVenueView = computed(() => props.venueDetail || (props.preserveCamera && props.countyRelief))
const townOverviewScale = ref(false)
const closeupTown = ref<string>()
const countyReliefEnabled = computed(() => reliefTextureReady.value && countyReliefRequested.value)
const regionalImageryVisible = ref(false)
const picking = ref(false)
let viewer: Viewer | undefined
const eventLabels=props.eventScene ? eventLabelLayout() : undefined
let cimMap: ReturnType<typeof createCimMap> | undefined
let input: ScreenSpaceEventHandler | undefined
let resize: ResizeObserver | undefined
let mapFeatures: CustomDataSource | undefined
let populationLayer: Primitive | undefined
let parcelLayer:ReturnType<typeof availableParcelBatch>|undefined
const batchedParcels=new Map<string,CityFeature['geometry']>()
let parcelSurface=0
type DensitySurface = NonNullable<Awaited<ReturnType<typeof populationSurface>>>
const densityBase=shallowRef<DensitySurface>()
const densityTexture=computed(()=>{
  const base=densityBase.value,ids=props.attributePixels,grid=props.densityRaster?.selection.grid
  return base && ids?.length && grid?{...base,canvas:rasterAttributeCanvas(base.canvas,base.bounds,grid,ids)}:base
})
const densityCache = new WeakMap<object, DensitySurface>()
watch([()=>props.densityCells,()=>props.densityRange,()=>props.densityRaster],async ([cells,range,raster],previous,onCleanup)=>{
  const key=raster ?? cells
  const cached=key && !range ? densityCache.get(key) : undefined
  const prior=previous?.[2]?.selection
  const updatingPlan=raster?.selection.planned && prior?.planned && raster.selection.mask===prior.mask && raster.selection.grid===prior.grid
  if(cached || !updatingPlan)densityBase.value=cached
  if ((!raster && !cells?.length) || cached) return
  const controller=new AbortController()
  onCleanup(()=>controller.abort())
  const surface=raster ? await rasterSurface(raster,controller.signal) : await populationSurface(cells!,range,controller.signal)
  if (controller.signal.aborted)return
  if (surface && !range && key)densityCache.set(key,surface)
  densityBase.value=surface
},{immediate:true})

let displayedDensity: DensitySurface | undefined
let densityHeight = -1
let densityRectangle: Primitive | undefined
let densityMaterial: Material | undefined
let densityNeedsFrame = false

function clearDensitySurface() {
  if (densityRectangle) viewer?.scene.primitives.remove(densityRectangle)
  densityRectangle = undefined
  densityMaterial?.destroy()
  densityMaterial = undefined
  densityNeedsFrame = false
  displayedDensity = undefined
}

function syncDensitySurface() {
  if (!viewer) return
  const surface = densityTexture.value
  const height = mapSurfaceHeight() + 5
  if (surface === displayedDensity && height === densityHeight) return
  clearDensitySurface()
  densityHeight = height
  if (surface) {
    densityMaterial = populationMaterial(surface.canvas)
    const appearance = new MaterialAppearance({ material: densityMaterial, flat: true, translucent: true })
    densityRectangle = viewer.scene.primitives.add(new Primitive({
      geometryInstances: new GeometryInstance({ geometry: new RectangleGeometry({
        rectangle: Rectangle.fromDegrees(...surface.bounds), height, granularity: CesiumMath.toRadians(0.035),
        vertexFormat: appearance.vertexFormat,
      }) }),
      appearance, asynchronous: false, allowPicking: false,
    }))
    displayedDensity = surface
    densityNeedsFrame = true
  }
  viewer.scene.requestRender()
}
let courtPolygons: CustomDataSource | undefined
let admin: CustomDataSource | undefined
let facilityOutlines: CustomDataSource | undefined
let outlineKey = ''
let drillTown: string | undefined
let drillVillage: string | undefined
let townExitResolution = FACILITY_TOWN_RESOLUTION
let villageExitResolution = FACILITY_VILLAGE_RESOLUTION
let previousFacilityScale: FacilityMarker['scale'] | undefined
let detailPinResolution = 0
let measure: CustomDataSource | undefined
let roadControlLayer: CustomDataSource | undefined
let liveRoadLayer: ReturnType<typeof createLiveRoadLayer> | undefined
let liveRoadFeatures: CityFeature[] = []
let roadLines: Partial<Record<RoadTier, GroundPolylinePrimitive>> = {}
let roadSurfaces: GroundPrimitive | undefined
let roadPaths: RoadPath[] = []
let renderedRoadSurfaces = ''
let basemap: ImageryLayer[] = []
let backgroundGrid: ImageryLayer | undefined
let regionalImagery: ImageryLayer | undefined
let regionalLoad: AbortController | undefined
let localLoad: AbortController | undefined
let removeMoveListener: (() => void) | undefined
let removeMarkerRenderListener: (() => void) | undefined
let tool: 'pick' | 'measure' | null = null
let measureStart: Coordinate | undefined
let tilted = false
let appliedRegion: string | undefined
let elevatedCounty = false
let renderedCourtKey = ''
let courts: ReturnType<typeof indexCourtFeatures>['courts'] = []
let villages = new Map<string, CourtGroup>()
let courtTown: {id:string; exit:number} | undefined
let courtVillage: {id:string; exit:number} | undefined
let courtDrillFlight: object | undefined
let courtOutlineIds: string[] = []
let serviceOutlineIds: (string | undefined)[] = []
const courtCaptions = shallowRef<ServiceCaption[]>([])
let districts = new Map<string, CourtGroup>()
let facilities = new Map<string, CourtGroup>()
let markerFrame = ''
let serviceAnchors:{point:ServicePoint;world:Cartesian3;maxDistance?:number}[]=[]
let facilityAnchors: { point: FacilityAnchor; world: Cartesian3 }[] = []
const facilityAreas = new Map<string,CityFeature>()
let serviceFrame=''
let flowFrame = ''
let outboundFrame = ''
let fittingPromotion = false
let layerFocus: { id?: string; flying: boolean } | undefined
const investmentFlightActive=()=>props.investmentRelief && layerFocus?.flying
let visitorFlows: VisitorFlow[] = []
let lastCourtUpdate = 0
let mapWindow = { left: 0, top: 0, width: 0, height: 0, toolbar: 0, canvasWidth: 0, canvasHeight: 0 }
const chromeInsets = shallowRef<Record<string, string>>({})
let lastMapCenter: Cartographic | undefined

const home: Coordinate = [113.10, 31.079]
const reliefHome: Coordinate = [113.10, 31.036]
const homeHeight = 143_000
const regionZoomLimit = 270_000
const promotionZoomLimit = 1_100_000
const districtThreshold = 40_000
const courtThreshold = 4_500
const imageBounds: [number, number, number, number] = [112.65, 30.55, 113.66, 31.62]
const cityImageBounds: [number, number, number, number] = [113.06, 30.974, 113.205, 31.077]
const regionalImageBounds: [number, number, number, number] = [109.2, 28.3, 118, 34.3]
const darkMapBackground = Color.fromCssColorString('#0d1d48')
const lightMapBackground = Color.fromCssColorString('#527f99')
const mapBackground = computed(() => props.lightTheme ? lightMapBackground : darkMapBackground)
const maskedRoof = computed<ReliefTexture | undefined>(() => {
  if (!cimRoof.value) return
  const { image, bounds } = cimRoof.value
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) return cimRoof.value
  // Transparent WMS pixels should show the mask at roof height in tilted views.
  context.fillStyle = mapBackground.value.toCssColorString()
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0)
  return { image: canvas, bounds }
})
const normalOrientation = { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 }
const overviewIncline = CesiumMath.toRadians(37)
const countyReliefEnterHeight = 44_000
const countyReliefExitHeight = 30_000
const countyRimHeight = 3_050
const countyRimColor = Color.fromCssColorString('#b6e5fb')
const countyCapImage = '/jingshan/eox2016.jpg'
const hitTargets = new Map<string, { featureId?: string; position?: Coordinate; height?: number; scenePriority?: number }>()
const controlTargets = new Map<string, string>()
const mapColors: Record<string, string> = {
  'court-footprint': dashboardPalette.cyan,
  court: '#ffc84f', school: '#40d998', hotel: '#ffd05c', scenic: '#59e5ba', parking: '#54abff',
  charging: '#52cba5', shelter: '#ffae00', food: '#ffbd72',
  hospital: '#ff6f72', blind: '#ff735b', service: '#46d1ff', parcel: '#38e4a7', restriction: '#ff9c59',
  population: '#57a5ee', enterprise: '#46bdfa', project: '#ffc34f', training: '#d599ff',
  road: '#4cceff', route: '#45e2aa', flow: '#46d9ff', visitor: '#4ed8ff', event: '#ffb153',
}
const roadStyles = {
  arterial: { color: Color.fromCssColorString('#c7def4').withAlpha(.88), pixels: 2.3, meters: 14, far: 300_000 },
  local: { color: Color.fromCssColorString('#9dbcd3').withAlpha(.68), pixels: 1.45, meters: 7, far: 170_000 },
  access: { color: Color.fromCssColorString('#85a8c2').withAlpha(.52), pixels: 1.1, meters: 4, far: 24_000 },
} as const
const surfaceHeight = 3_600

const displayAdministration = computed(() => {
  const features = props.administration?.some(isCountyBoundary) ? props.administration : localBoundaries.value
  if (features.some(item => item.properties.sourceServiceId === 'cim-05')) return features
  let mainland: CityFeature | undefined
  let largestArea = 0
  for (const feature of features.filter(isCountyBoundary)) {
    for (const coordinates of polygons(feature)) {
      const component: CityFeature = { ...feature, geometry: { type: 'Polygon', coordinates } }
      const area = featureAreaM2(component, home)
      if (area > largestArea) {
        mainland = component
        largestArea = area
      }
    }
  }
  if (!mainland || mainland.geometry.type !== 'Polygon') return features
  const outline = mainland.geometry.coordinates
  const visible = [mainland]
  for (const feature of features) {
    if (isCountyBoundary(feature)) continue
    const parts = polygons(feature)
    const retained = parts.filter(part => polygonsOverlap(part, outline))
    if (retained.length === parts.length) visible.push(feature)
    else if (retained.length) visible.push({ ...feature, geometry: { type: 'MultiPolygon', coordinates: retained } })
  }
  return visible
})

const facilityBoundaryIndex = computed(() => props.publishedBoundaryIndex ?? createFacilityBoundaryIndex(displayAdministration.value, props.communityBoundaries ?? []))
const countyParts = computed(() => displayAdministration.value.filter(isCountyBoundary).flatMap(polygons))
const countyBounds = computed<MapBounds | undefined>(() => {
  const points = countyParts.value.flatMap(rings => rings[0] ?? [])
  if (!points.length) return
  return points.reduce<MapBounds>(([west, south, east, north], [x, y]) =>
    [Math.min(west, x), Math.min(south, y), Math.max(east, x), Math.max(north, y)],
    [Infinity, Infinity, -Infinity, -Infinity])
})
const selectedTown = computed(() => {
  if (!props.isolateRegion || regionalView.value) return null
  const parts = displayAdministration.value
    .filter(item => item.properties.kind === 'town-boundary' && item.properties.name === props.region)
    .flatMap(polygons)
  if (!parts.length) return null
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const [outline] of parts) {
    for (const [longitude, latitude] of outline) {
      west = Math.min(west, longitude)
      south = Math.min(south, latitude)
      east = Math.max(east, longitude)
      north = Math.max(north, latitude)
    }
  }
  const bounds: [number, number, number, number] = [west, south, east, north]
  const center: Coordinate = [(west + east) / 2, (south + north) / 2]
  const spanX = (east - west) * 111_195 * Math.cos(CesiumMath.toRadians(center[1]))
  const spanY = (north - south) * 111_195
  const wallHeight = Math.max(220, Math.min(1_350, Math.max(spanX, spanY) * .041))
  const roofEllipsoid = ellipsoidAtHeight(wallHeight)
  return { name: props.region, parts, bounds, center, spanX, spanY, wallHeight, roofEllipsoid }
})
const useReferenceImagery = computed(() => Boolean(countyBounds.value && props.imagery &&
  (props.fusionScene || (props.cimCatalogReady && (!requestedBasemap.value || failedBasemap.value === requestedBasemap.value.id)))))
const investmentReference=computed(()=>props.investmentRelief && props.imagery && !cimRoof.value)
const planningUrls=computed(()=>props.investmentRelief ? (props.cimLayers??[]).flatMap(s=>s.reliefUrl?[s.reliefUrl]:[]).join('\n') : '')
watch([planningUrls,()=>selectedTown.value?.name??'京山市'],async([paths,region],_,cleanup)=>{
  planningRoof.value=undefined
  planningRoofFailed.value=false
  if(!paths)return
  const controller=new AbortController()
  cleanup(()=>controller.abort())
  try{const surface=await planningRoofTexture(paths.split('\n'),region,controller.signal);if(!controller.signal.aborted)planningRoof.value=surface}
  catch{if(!controller.signal.aborted)planningRoofFailed.value=true}
},{immediate:true})
const referenceTownFaces = computed(() => {
  const town = selectedTown.value
  if (!town || !(useReferenceImagery.value || investmentReference.value) || cimRoof.value) return
  const published = externalImagery.value && props.imageryConfig
  const detail = published ? {image:published.url,bounds:published.bounds} : {image:'/jingshan/eox2016-city.jpg',bounds:cityImageBounds}
  return town.parts.map(rings => splitReliefCoverage(rings,detail.bounds).map(face => ({
    rings:face.rings, texture:face.detail ? detail : {image:countyCapImage,bounds:imageBounds},
  })))
})
const isolatedTown = computed(() => !reliefTextureReady.value || cimGroundOverlay.value || planningRoofFailed.value ||
  ((props.overview || props.investmentRelief) && closeupTown.value === props.region && !!closeupTown.value) ||
  (retainVenueView.value && !townOverviewScale.value) || (thematicMap.value && !props.countyRelief) ? null : selectedTown.value)

// The raised overview sits above Cesium's imagery tiles. Sample the same live
// basemap over the selected area for its roof; local detail views use ground tiles.
watch([cimBasemap, selectedTown, countyBounds, () => props.countyRelief, regionalView, cimGroundOverlay],
async ([service, town, county, overview, regional, overlay], _, cleanup) => {
  cimRoof.value = undefined
  if (!service || service.kind !== 'wms' || !county || !overview || regional || overlay) return
  const bounds = town?.bounds ?? county
  const [west,south,east,north] = bounds
  const aspect = (east - west) * Math.cos((north + south) * Math.PI / 360) / (north - south)
  const width = Math.max(1, Math.round(reliefImageSize * Math.min(1, aspect)))
  const height = Math.max(1, Math.round(reliefImageSize * Math.min(1, 1 / aspect)))
  const controller = new AbortController()
  cleanup(() => controller.abort())
  try {
    const response = await fetch(cimMapImageUrl(service, bounds, width, height), {signal: controller.signal})
    if (!response.ok) return
    const url = URL.createObjectURL(await response.blob())
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      if (!controller.signal.aborted) cimRoof.value = {image, bounds}
    } finally { URL.revokeObjectURL(url) }
  } catch { /* The same service's ground tiles remain visible if its relief image cannot be decoded. */ }
}, {flush: 'sync'})
let appliedTown: typeof isolatedTown.value = null
let appliedCloseup: string | undefined

function ellipsoidAtHeight(height: number) {
  const { x, y, z } = Ellipsoid.WGS84.radii
  return new Ellipsoid(x + height, y + height, z + height)
}

function mapSurfaceHeight() {
  return isolatedTown.value?.wallHeight ?? (elevatedCounty ? countyRimHeight : 0)
}

function isCountyBoundary(feature: CityFeature) {
  const { kind, adcode, name } = feature.properties
  return kind === 'city-boundary' || adcode === 420882 || name === '京山市'
}

function pathsOf(feature: CityFeature): Position[][] {
  const { geometry } = feature
  if (geometry.type === 'LineString') return [geometry.coordinates]
  if (geometry.type === 'MultiLineString') return geometry.coordinates
  return []
}

function roadTier(highway: unknown): RoadTier {
  const name = String(highway ?? '')
  if (/^(motorway|trunk|primary|secondary)(?:_link)?$/.test(name)) return 'arterial'
  if (/^(service|track|living_street|path|footway|cycleway)$/.test(name)) return 'access'
  return 'local'
}

function polygons(feature: CityFeature): Position[][][] {
  const { geometry } = feature
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates
  return []
}

function positions(coordinates: Position[], height: number) {
  return coordinates.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, height))
}

function hierarchy(rings: Position[][], height: number) {
  return new PolygonHierarchy(positions(rings[0], height), rings.slice(1).map(ring => new PolygonHierarchy(positions(ring, height))))
}

function label(text: string, color = Color.WHITE, fontSize = props.overview || props.eventScene ? 16 : 13) {
  const content = text?.trim()
  if (!content) return undefined
  const light = props.lightTheme
  return {
    text: content, font: 'bold ' + fontSize + 'px Microsoft YaHei UI',
    fillColor: light ? Color.fromCssColorString('#10335b') : color,
    outlineColor: Color.fromCssColorString(light ? '#f7fbff' : '#071935'), outlineWidth: light ? 2 : 3,
    style: LabelStyle.FILL_AND_OUTLINE, showBackground: true,
    backgroundColor: Color.fromCssColorString(light ? '#f5faff' : '#102756').withAlpha(light ? .95 : .88),
    backgroundPadding: new Cartesian2(5, 3),
    pixelOffset: new Cartesian2(0, -13), verticalOrigin: VerticalOrigin.BOTTOM, disableDepthTestDistance: Infinity,
  }
}

function addLine(collection: EntityCollection, id: string, path: Position[], color: Color, width: number, height: number) {
  collection.add({ id, polyline: { positions: positions(path, height), material: color, width } })
}

function syncRoadNetwork(height: number) {
  if (!viewer) return
  for (const [tier, layer] of Object.entries(roadLines)) {
    layer.show = !isolatedTown.value && height <= roadStyles[tier as RoadTier].far
  }
  const layers = viewer.scene.groundPrimitives
  if (isolatedTown.value || height > surfaceHeight) {
    if (roadSurfaces) roadSurfaces.show = false
    return
  }
  const extent = viewer.camera.computeViewRectangle()
  if (!extent || !roadPaths.length) return
  const padding = CesiumMath.toRadians(.002)
  const visible: number[] = []
  roadPaths.forEach(({ bounds }, index) => {
    if (bounds.west <= extent.east + padding && bounds.east >= extent.west - padding &&
        bounds.south <= extent.north + padding && bounds.north >= extent.south - padding) visible.push(index)
  })
  const key = visible.join(',')
  if (key === renderedRoadSurfaces) {
    if (roadSurfaces) roadSurfaces.show = true
    return
  }
  renderedRoadSurfaces = key
  if (roadSurfaces) layers.remove(roadSurfaces)
  roadSurfaces = undefined
  if (!visible.length) return
  roadSurfaces = layers.add(new GroundPrimitive({
    geometryInstances: visible.map(index => {
      const road = roadPaths[index]
      return new GeometryInstance({
        geometry: new CorridorGeometry({
          positions: road.positions, width: road.width, cornerType: CornerType.BEVELED,
          vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
        }),
        attributes: { color: ColorGeometryInstanceAttribute.fromColor(roadStyles[road.tier].color) },
      })
    }),
    appearance: new PerInstanceColorAppearance({ flat: true }),
    classificationType: ClassificationType.TERRAIN,
    allowPicking: false,
  }))
  liveRoadLayer?.bringToFront()
}

function rebuildRoadNetwork() {
  if (!viewer) return
  const { groundPrimitives } = viewer.scene
  for (const layer of Object.values(roadLines)) groundPrimitives.remove(layer)
  if (roadSurfaces) groundPrimitives.remove(roadSurfaces)
  roadLines = {}
  roadSurfaces = undefined
  renderedRoadSurfaces = ''
  roadPaths = []
  const batches: Record<RoadTier, GeometryInstance[]> = { arterial: [], local: [], access: [] }
  for (const feature of props.roadNetwork ?? []) {
    const tier = roadTier(feature.properties.highway)
    const style = roadStyles[tier]
    const width = Number(feature.properties.widthM)
    for (const path of pathsOf(feature)) {
      if (path.length < 2) continue
      const points = positions(path, 0)
      roadPaths.push({
        positions: points, bounds: Rectangle.fromCartesianArray(points), tier,
        width: Number.isFinite(width) && width > 0 ? Math.min(80, width) : style.meters,
      })
      batches[tier].push(new GeometryInstance({
        geometry: new GroundPolylineGeometry({ positions: points, width: style.pixels }),
        attributes: { color: ColorGeometryInstanceAttribute.fromColor(style.color) },
      }))
    }
  }
  for (const tier of ['access', 'local', 'arterial'] as const) {
    if (!batches[tier].length) continue
    roadLines[tier] = groundPrimitives.add(new GroundPolylinePrimitive({
      geometryInstances: batches[tier], appearance: new PolylineColorAppearance(),
      classificationType: ClassificationType.TERRAIN, allowPicking: false,
    }))
  }
  syncRoadNetwork(viewer.camera.positionCartographic.height)
  liveRoadLayer?.bringToFront()
  viewer.scene.requestRender()
}

function addRoadControl(collection: EntityCollection, feature: CityFeature, track: (id: string) => void) {
  const selected = feature.id === props.selectedId
  const paint = roadControlPaint(feature.properties,selected)
  const color = Color.fromCssColorString(paint.color)
  if(feature.geometry.type==='Polygon'||feature.geometry.type==='MultiPolygon'){
    const road={...feature,properties:{...feature.properties,...paint,mapRole:'parcel',showLabel:false}}
    addSceneFeature(collection,road,'parcel',selected,mapSurfaceHeight()+15,!!props.lightTheme,track)
    if(selected&&Array.isArray(feature.properties.center)){
      const [lon,lat]=feature.properties.center as Coordinate
      const id='road-control:'+feature.id+':name'
      collection.add({id,position:Cartesian3.fromDegrees(lon,lat,mapSurfaceHeight()+33),label:label(feature.properties.name,color)})
      track(id)
    }
    return
  }
  pathsOf(feature).forEach((path, index) => {
    if (path.length < 2) return
    const id = 'road-control:' + feature.id + ':' + index
    const center = path[Math.floor(path.length / 2)]
    const base = mapSurfaceHeight()
    const line = positions(path, base + 24)
    collection.add({ id, position: Cartesian3.fromDegrees(center[0], center[1], base + 29), polyline: {
      positions: line, width: selected ? 8 : props.eventScene ? 6 : 5,
      material: paint.dashed ? new PolylineDashMaterialProperty({color,dashLength:18}) : new PolylineOutlineMaterialProperty({
        color, outlineWidth: selected ? 2.5 : 1.35,
        outlineColor: Color.fromCssColorString(selected ? '#fff2a2' : '#301828'),
      }),
    }, label: selected && index === 0 ? label(feature.properties.name, color) : undefined })
    track(id)
  })
}

function rebuildRoadControls() {
  eventLabels?.invalidate()
  if (!viewer || !roadControlLayer) return
  const { entities } = roadControlLayer
  controlTargets.clear()
  entities.removeAll()
  entities.suspendEvents()
  try {
    for (const feature of props.roadControls ?? []) addRoadControl(entities, feature, id => controlTargets.set(id, feature.id))
  } finally {
    entities.resumeEvents()
  }
  viewer.scene.requestRender()
}

function featureColor(feature: CityFeature, selected: boolean) {
  if (selected) return Color.fromCssColorString('#fff2a2')
  if ((feature.properties.kind === 'court' || feature.properties.kind === 'venue') && !feature.properties.color) {
    const group=venueOwnershipGroup(feature.properties.ownership)
    if(group)return Color.fromCssColorString(group.color)
  }
  return (feature.properties.color && Color.fromCssColorString(feature.properties.color))
    || Color.fromCssColorString(mapColors[feature.properties.kind] ?? '#64ceff')
}

function putCourtLines(collection: EntityCollection, key: string, featureId: string, ring: Position[], color: Color, height: number) {
  // Standard court markings fit the ordered quadrilateral supplied by the court dataset.
  if (ring.length !== 5) return
  let [a, b, c, d] = ring
  const edge = (u: Position, v: Position) => Math.hypot((u[0] - v[0]) * Math.cos(u[1] * Math.PI / 180), u[1] - v[1])
  if (edge(a, b) > edge(b, c)) [a, b, c, d] = [b, c, d, a]
  const at = (x: number, y: number): Position => {
    const interpolate = (i: number) => (a[i] * (1 - x) + b[i] * x) * (1 - y) + (d[i] * (1 - x) + c[i] * x) * y
    return [interpolate(0), interpolate(1)]
  }
  const paths = [
    [at(.15, 0), at(.15, 1)], [at(.85, 0), at(.85, 1)], [at(0, .5), at(1, .5)],
    [at(.15, .23), at(.85, .23)], [at(.15, .77), at(.85, .77)], [at(.5, .23), at(.5, .77)],
  ]
  paths.forEach((path, index) => {
    const id = key + ':line:' + index
    addLine(collection, id, path, color, 1.25, height)
    hitTargets.set(id, { featureId })
  })
}

function addFeature(collection: EntityCollection, feature: CityFeature) {
  if (feature.properties.kind === 'road-control' && (pathsOf(feature).length || polygons(feature).length)) {
    addRoadControl(collection, feature, id => hitTargets.set(id, { featureId: feature.id }))
    return
  }
  const selected = feature.id === props.selectedId
  const color = featureColor(feature, selected)
  const base = mapSurfaceHeight()
  const center = featureCenter(feature)
  const court = feature.properties.kind === 'court'
  const footprint = feature.properties.kind === 'court-footprint'
  const business = ['merchant','business'].includes(feature.properties.kind) ||
    (props.panorama && ['hotel','food'].includes(feature.properties.kind))
  const promoted = Number(feature.properties.redemptions) >= 100
  const outline = court ? Color.WHITE.withAlpha(.9) : color.withAlpha(.82)
  const prefix = 'f:' + feature.id
  const polygonTarget = { featureId: feature.id, scenePriority: footprint ? 2 : undefined }
  if (feature.geometry.type === 'Point' || feature.geometry.type === 'MultiPoint') {
    const points = feature.geometry.type === 'Point' ? [feature.geometry.coordinates] : feature.geometry.coordinates
    points.forEach((coordinate, index) => {
      const id = prefix + ':point:' + index
      collection.add({ id, position: Cartesian3.fromDegrees(coordinate[0], coordinate[1], base + 20),
        point: { pixelSize: selected ? 15 : business && !promoted ? 5 : 10, color, outlineColor: Color.WHITE.withAlpha(.9), outlineWidth: business && !promoted ? .65 : 1.5, disableDepthTestDistance: Infinity },
        label: index === 0 && (selected || promoted || (!business && feature.properties.kind !== 'population')) ? label(feature.properties.name, color) : undefined,
      })
      hitTargets.set(id, { featureId: feature.id })
    })
  }
  const paths = pathsOf(feature)
  if (paths.length) {
    const flow = /flow|visitor|origin|route.package/.test(feature.properties.kind)
    const strength = Number(feature.properties.share ?? 0) || Number(feature.properties.visitorCount ?? 0) / 40
    paths.forEach((path, index) => {
      const id = prefix + ':route:' + index
      collection.add({ id, position: center ? Cartesian3.fromDegrees(...center, base + 45) : undefined,
        polyline: { positions: positions(path, base + 38), width: selected ? 6 : flow ? Math.min(7,2.6 + strength / 10) : 3,
          material: flow
            ? new PolylineGlowMaterialProperty({ color, glowPower: .25 }) : new PolylineDashMaterialProperty({ color, dashLength: 16 }),
        }, label: selected ? label(feature.properties.name, color) : undefined,
      })
      hitTargets.set(id, { featureId: feature.id })
    })
  }
  polygons(feature).forEach((rings, index) => {
    if (!rings[0]?.length) return
    const id = prefix + ':shape:' + index
    const altitude = footprint ? courtFootprintHeight() : base + (court ? 8 : 10)
    const fill = court ? color.withAlpha(.88) : color.withAlpha(selected ? .48 : footprint ? .44 : feature.properties.kind === 'population' ? .17 : .22)
    collection.add({ id, position: center ? Cartesian3.fromDegrees(...center, base + 22) : undefined,
      polygon: { hierarchy: hierarchy(rings, altitude), height: altitude, material: fill },
      label: selected && index === 0 && center && !footprint ? label(feature.properties.name, color) : undefined,
    })
    hitTargets.set(id, polygonTarget)
    rings.forEach((ring, ringIndex) => {
      const outlineId = id + ':outline:' + ringIndex
      addLine(collection, outlineId, ring, outline, court ? 1.4 : selected ? 3 : 1.75, altitude + .65)
      hitTargets.set(outlineId, polygonTarget)
    })
    if (court) putCourtLines(collection, id, feature.id, rings[0], Color.WHITE.withAlpha(.92), altitude + .8)
  })
}

function rebuildFeatures() {
  eventLabels?.invalidate()
  cimMap?.setSurfaceHeight(mapSurfaceHeight())
  if (!viewer || !mapFeatures || !courtPolygons) return
  syncDensitySurface()
  const collection = mapFeatures.entities
  if (props.eventScene || liveRoadLayer) {
    const roads = props.eventScene ? props.features.filter(feature => feature.properties.kind === 'event-live-road') : []
    if (roads.length !== liveRoadFeatures.length || roads.some((road,i) => road !== liveRoadFeatures[i])) {
      liveRoadLayer?.destroy()
      liveRoadLayer = roads.length ? createLiveRoadLayer(viewer.scene,roads) : undefined
      liveRoadFeatures = roads
    }
  }
  const index = indexCourtFeatures(serviceRangeActive.value && !props.venueDetail ? [] : props.features, surveyedCourts.value,
    surveyedCourts.value ? facilityBoundaryIndex.value : undefined,props.centerDistrictClusters)
  districts = index.districts
  facilities = index.facilities
  villages = index.villages
  if (!index.count || serviceRangeActive.value || (courtTown && !index.courts.some(court=>(court.townId ?? '')===courtTown?.id))) resetCourtDrill()
  else if (courtVillage && !index.courts.some(matchesCourtScope)) courtVillage = undefined
  const subjects = new Map<string,Set<string>>()
  hitTargets.clear()
  reserveAnchors=[]
  reserveFrame=''
  markerFrame = ''
  serviceFrame = ''
  serviceAnchors = []
  rangeBoundaryLabel = undefined
  rangeCaption.value = undefined
  facilityAnchors = []
  facilityAreas.clear()
  outlineKey = ''
  openFacilityGroup.value = ''
  courts = index.courts
  for (const {town,village} of courts) {
    if (town) facilityAreas.set(town.id,town)
    if (village) facilityAreas.set(village.id,village)
  }
  renderedCourtKey = ''
  flowFrame = ''
  visitorFlows = []
  courtCount.value = index.count
  courtPolygons.entities.removeAll()
  collection.removeAll()
  collection.suspendEvents()
  try {
    const crowded = props.features.filter(item => item.geometry.type === 'Point' && sceneMapRole(item)).length > 18
    const parcels=props.features.filter(f=>f.properties.kind==='available-parcel' && sceneMapRole(f)==='candidate')
    const batchParcels=parcels.length>36
    const surface=mapSurfaceHeight()
    if(parcelLayer && (!batchParcels || surface!==parcelSurface || parcels.length!==batchedParcels.size ||
        parcels.some(f=>batchedParcels.get(f.id)!==f.geometry))){
      viewer.scene.primitives.remove(parcelLayer)
      parcelLayer=undefined
      batchedParcels.clear()
    }
    if(batchParcels){
      if(!parcelLayer){
        parcelLayer=availableParcelBatch(parcels,surface)
        viewer.scene.primitives.add(parcelLayer)
        for(const f of parcels)batchedParcels.set(f.id,f.geometry)
        parcelSurface=surface
      }
      for(const f of parcels)hitTargets.set(f.id,{featureId:f.id,scenePriority:2})
    }
    if (props.selectedId?.startsWith('density:')) {
      const selected=props.densityRaster ? populationMapFeature(props.densityRaster,props.selectedId.slice(8))
        : props.densityCells?.find(f=>'density:'+f.id===props.selectedId)
      if (selected) polygons(selected).forEach((rings, i) =>
        addLine(collection, 'density-outline:' + i, rings[0], Color.fromCssColorString('#e9fcff'), 2, mapSurfaceHeight() + 12))
    }
    if (populationLayer) viewer.scene.primitives.remove(populationLayer)
    populationLayer = undefined
    const grid = props.features.filter(gridCell)
    const batchGrid = grid.length > 24
    if (batchGrid) {
      populationLayer = populationGrid(grid, mapSurfaceHeight(), props.selectedId,
        (id, featureId) => hitTargets.set(id, {featureId, scenePriority: 1}))
      if (populationLayer) viewer.scene.primitives.add(populationLayer)
    }
    for (const feature of props.features) {
      if (props.eventScene && feature.properties.kind === 'event-live-road') continue
      if (batchGrid && gridCell(feature)) continue
      const role = sceneMapRole(feature)
      if (role) {
        const target = typeof feature.properties.pickFeatureId === 'string' ? feature.properties.pickFeatureId : feature.id
        const p=feature.properties
        if(batchParcels && p.kind==='available-parcel' && role==='candidate' && !p.selected && !p.recommended && !p.focused)continue
        if(role==='reserveGroup' && feature.geometry.type==='Point'){
          const [lon,lat]=feature.geometry.coordinates
          reserveAnchors.push({id:target,name:p.name,level:p.groupLevel==='village'?'village':'town',count:p.count??0,
            world:Cartesian3.fromDegrees(lon,lat,mapSurfaceHeight()+11)})
          continue
        }
        if (p.clusterFacilities && feature.geometry.type === 'Point') {
          const [lon,lat] = feature.geometry.coordinates
          const kind = role==='venue' ? 'venue' : p.supportKind as SupportKind
          const {town,village} = facilityBoundaryIndex.value.locate([lon,lat])
          if (town) facilityAreas.set(town.id,town)
          if (village) facilityAreas.set(village.id,village)
          facilityAnchors.push({ point:{id:target, name:p.name, townId:town?.id, villageId:village?.id,
            region:town?.properties.name ?? '镇街待核实', village:village?.properties.name,
            category:kind==='venue' ? '场馆' : supportCategories[kind] ?? String(p.legendLabel),
            selected:p.selected===true, serviceRangeCenter:p.serviceRangeCenter===true, kind, color:p.color, position:[lon,lat]},
            world:Cartesian3.fromDegrees(lon,lat,mapSurfaceHeight()+11) })
          continue
        }
        if ((role==='venue'||role==='support') && p.labelOnZoom && feature.geometry.type==='Point') {
          const [lon,lat]=feature.geometry.coordinates
          serviceAnchors.push({world:Cartesian3.fromDegrees(lon,lat,mapSurfaceHeight()+11),
            maxDistance:p.limitLabelAtDistance===true && typeof p.labelMaxDistance==='number' ? p.labelMaxDistance : undefined,
            point:{id:target,name:p.name,selected:p.selected===true || target === props.selectedId}})
        }
        let displayFeature = feature
        if (serviceRangeActive.value && role==='range' && p.kind==='service-range' && p.showLabel && feature.geometry.type==='Polygon') {
          const ring = feature.geometry.coordinates[0]
          if (ring?.length > 1) {
            // Sample the actual circumference so the label follows even a tilted view.
            const anchors = [1,0,7,2,6,3,5,4].map(octant => {
              const [lon,lat] = ring[Math.round((ring.length-1)*octant/8)]
              return Cartesian3.fromDegrees(lon,lat,mapSurfaceHeight()+6)
            })
            rangeBoundaryLabel = {text:p.name,anchors}
            displayFeature = {...feature, properties:{...p,showLabel:false}}
          }
        }
        const serviceLabel = role==='venue' || role==='support' || p.kind==='service-range'
        addSceneFeature(collection, displayFeature, role, target === props.selectedId, mapSurfaceHeight(), serviceLabel ? props.serviceLabelsLight : !!props.lightTheme,
          (id, scenePriority) => hitTargets.set(id, { featureId: target, scenePriority }), crowded, props.eventScene)
        continue
      }
      if (regionalView.value && feature.properties.kind === 'route_package') continue
      const flow = visitorFlow(feature)
      if (flow) {
        visitorFlows.push(flow)
        continue
      }
      const kind = feature.properties.kind
      if (kind === 'court' || kind === 'court-footprint') continue
      if (props.showSubjectCounts && (kind === 'business' || feature.properties.panoramaEntityKey)) {
        const town = feature.properties.region
        const keys = subjects.get(town) ?? new Set<string>()
        keys.add(String(feature.properties.panoramaEntityKey || feature.id))
        subjects.set(town,keys)
      }
      addFeature(collection,feature)
    }

    if (props.showSubjectCounts && !surveyedCourts.value) districts.forEach((group,id) => { group.subjects = subjects.get(id)?.size ?? 0 })
  } finally {
    collection.resumeEvents()
  }
  syncCourtPolygons()
  viewer.scene.requestRender()
}

function facilityMapInsets(width: number, height: number) {
  return {topInset:Math.min(110,height*.17), bottomInset:Math.min(104,height*.16), rightInset:Math.min(48,width*.08)}
}

function updateReserveMarkers() {
  if(!viewer || !reserveAnchors.length){
    if(reserveMarkers.value.length)reserveMarkers.value=[]
    return
  }
  const {camera,scene}=viewer
  const {left,top,width,height}=mapWindow
  const frame=[camera.positionWC,camera.directionWC,camera.upWC,left,top,width,height].join('|')
  if(frame===reserveFrame)return
  reserveFrame=frame
  reserveMarkers.value=reserveAnchors.flatMap(anchor=>{
    const pixel=SceneTransforms.worldToWindowCoordinates(scene,anchor.world)
    if(!pixel)return []
    const x=pixel.x-left, y=pixel.y-top
    return x>=16 && x<=width-16 && y>=16 && y<=height-16 ? [{...anchor,x,y}] : []
  })
}

function updateServiceCaptions() {
  if (!viewer || !mapWindow.width) return
  const {camera,scene,canvas}=viewer
  const frustum=camera.frustum
  if (!facilityAnchors.length) {
    if (facilityMarkers.value.length) facilityMarkers.value = []
    resetFacilityDrill()
    updateFacilityOutlines([])
  }
  if (!(serviceAnchors.length || facilityAnchors.length) || !(frustum instanceof PerspectiveFrustum) || !frustum.fovy) {
    if(serviceCaptions.value.length)serviceCaptions.value=[]
    rangeCaption.value = undefined
    return
  }
  const {left,top,width,height}=mapWindow
  const frame=[camera.positionWC,camera.directionWC,camera.upWC,frustum.fovy,canvas.clientHeight,left,top,width,height,mapSurfaceHeight(),props.highlightedServiceVenue].join('|')
  if(frame===serviceFrame)return
  serviceFrame=frame
  const focal=canvas.clientHeight/(2*Math.tan(frustum.fovy/2))
  const offset=new Cartesian3()
  if (facilityAnchors.length) {
    const resolution = (camera.positionCartographic.height - mapSurfaceHeight()) / focal
    // The navigation, search, legend and toolbar occupy the edges of the central map.
    const {topInset,bottomInset,rightInset} = facilityMapInsets(width,height)
    const clearWidth = width - rightInset
    const clearHeight = height - topInset - bottomInset
    const selected = serviceRangeActive.value
    if (selected && camera.positionCartographic.height < 16000) detailPinResolution = resolution*1.05
    else if (!selected && resolution > detailPinResolution) detailPinResolution = 0
    // Frame the full boundary even when a large rural area exceeds the default scale.
    let effectiveResolution = resolution
    if (drillTown !== undefined && resolution <= townExitResolution)
      effectiveResolution = Math.min(resolution,FACILITY_TOWN_RESOLUTION)
    if (selected || resolution <= detailPinResolution || (drillVillage !== undefined && resolution <= villageExitResolution)) effectiveResolution = 0
    const scale = facilityClusterScale(effectiveResolution)
    if (!selected) {
      if (scale === 'town' && previousFacilityScale !== 'town') resetFacilityDrill()
      else if (scale === 'village' && previousFacilityScale === 'detail') {
        drillVillage = undefined
        villageExitResolution = FACILITY_VILLAGE_RESOLUTION
      }
      previousFacilityScale = scale
    } else {
      const focus = facilityAnchors.find(anchor=>anchor.point.selected)?.point
      if (drillTown !== undefined && (focus?.townId ?? '') !== drillTown) drillTown = undefined
      if (drillVillage !== undefined && (focus?.villageId ?? '') !== drillVillage) drillVillage = undefined
    }
    const project = (world:Cartesian3) => Cartesian3.dot(Cartesian3.subtract(world,camera.positionWC,offset),camera.directionWC) > 0
      ? SceneTransforms.worldToWindowCoordinates(scene,world) : undefined
    const placed = facilityAnchors.flatMap(({point,world}) => {
      if (!selected && scale !== 'town' && drillTown !== undefined && (point.townId ?? '') !== drillTown) return []
      if (!selected && scale === 'detail' && drillVillage !== undefined && (point.villageId ?? '') !== drillVillage) return []
      // A district is projected once at its own anchor. Its members still count outside the camera's view.
      const districtId = scale === 'town' ? point.townId : point.villageId
      const needsPixel = selected || scale === 'detail' || !districtId
      const pixel = needsPixel ? project(world) : undefined
      if (!pixel && (selected || scale === 'detail')) return []
      return [{...point,x:pixel ? pixel.x-left : NaN,y:pixel ? pixel.y-top-topInset : NaN,
        highlighted:!point.serviceRangeCenter && point.kind==='venue' && point.id===props.highlightedServiceVenue}]
    })
    const districtAnchor = (level: 'town' | 'village', point: FacilityAnchor) => {
      const area = facilityAreas.get((level === 'town' ? point.townId : point.villageId) ?? '')
      if (!area) return
      const position = districtCenter(area)
      if (!position) return null
      const pixel = project(Cartesian3.fromDegrees(...position,mapSurfaceHeight()+16))
      return pixel ? {x:pixel.x-left,y:pixel.y-top-topInset,position} : null
    }
    const markers = selected ? layoutServiceRangeMarkers(placed,clearWidth,clearHeight)
      : layoutFacilityMarkers(placed,clearWidth,clearHeight,effectiveResolution,districtAnchor)
    facilityMarkers.value = markers.map(m => ({...m,y:m.y+topInset}))
    if (rangeBoundaryLabel) {
      const occupied = markers.flatMap(m => m.label && m.labelBounds ? [badgeBounds(m),m.labelBounds] : [badgeBounds(m)])
      rangeCaption.value = undefined
      for (const world of rangeBoundaryLabel.anchors) {
        if (Cartesian3.dot(Cartesian3.subtract(world,camera.positionWC,offset),camera.directionWC) <= 0) continue
        const pixel = SceneTransforms.worldToWindowCoordinates(scene,world)
        if (!pixel) continue
        const x = Math.round(pixel.x-left-rangeCaptionSize.width/2)
        const y = Math.round(pixel.y-top-topInset-rangeCaptionSize.height/2)
        const bounds = {x:x-4,y:y-4,width:rangeCaptionSize.width+8,height:rangeCaptionSize.height+8}
        if (bounds.x < 0 || bounds.y < 0 || bounds.x+bounds.width > clearWidth || bounds.y+bounds.height > clearHeight) continue
        if (occupied.some(other=>overlaps(other,bounds))) continue
        rangeCaption.value = {text:rangeBoundaryLabel.text,x,y:y+topInset}
        break
      }
    }
    const areas = scale === 'village' ? facilityMarkers.value.map(m=>m.symbol.villageId) : []
    if (scale !== 'town') areas.push(drillTown)
    if (scale === 'detail') areas.push(drillVillage)
    updateFacilityOutlines(selected ? [] : areas)
  }
  const projected=serviceAnchors.flatMap(({point,world,maxDistance})=>{
    if(maxDistance!==undefined && Cartesian3.distance(world,camera.positionWC)>maxDistance)return []
    const depth=Cartesian3.dot(Cartesian3.subtract(world,camera.positionWC,offset),camera.directionWC)
    if(depth<=0)return []
    const metersPerPixel=depth/focal
    if(maxDistance===undefined && !point.selected && metersPerPixel>serviceCaptionResolution)return []
    const pixel=SceneTransforms.worldToWindowCoordinates(scene,world)
    return pixel?[{...point,x:Math.round(pixel.x-left),y:Math.round(pixel.y-top),metersPerPixel,withinLabelRange:maxDistance!==undefined}]:[]
  })
  if(projected.length || serviceCaptions.value.length)
    serviceCaptions.value=layoutServiceCaptions(projected,width,height,props.highlightedServiceVenue)
}

function resetFacilityDrill() {
  drillTown = undefined
  drillVillage = undefined
  previousFacilityScale = undefined
  detailPinResolution = 0
  townExitResolution = FACILITY_TOWN_RESOLUTION
  villageExitResolution = FACILITY_VILLAGE_RESOLUTION
}

function updateFacilityOutlines(ids: (string | undefined)[]) {
  serviceOutlineIds = ids
  renderDistrictOutlines()
}

function renderDistrictOutlines() {
  const layer = facilityOutlines
  if (!layer) return
  const unique = [...new Set([...serviceOutlineIds, ...courtOutlineIds].filter((id): id is string => Boolean(id)))].sort()
  const ground = mapSurfaceHeight()
  const key = JSON.stringify([unique, ground, props.lightTheme, drillVillage, drillTown, courtTown?.id, courtVillage?.id])
  if (outlineKey === key) return
  outlineKey = key
  const collection = layer.entities
  collection.suspendEvents()
  try {
    collection.removeAll()
    const color = Color.fromCssColorString(props.lightTheme ? '#216fa3' : '#76d7f2')
    for (const id of unique) {
      const feature = facilityAreas.get(id)
      if (!feature) continue
      const active = id === drillVillage || id === drillTown || id === courtTown?.id || id === courtVillage?.id
      polygons(feature).forEach((rings,i)=>rings.forEach((path,j)=>
        addLine(collection,'facility-area:'+id+':'+i+':'+j,path,color.withAlpha(active ? .9 : .65),active ? 2.5 : 1.5,ground+7)))
    }
  } finally {
    collection.resumeEvents()
  }
  viewer?.scene.requestRender()
}

function openFacilityMarker(item: FacilityMarker, event: MouseEvent) {
  if (!viewer || picking.value) return
  if (props.venueDetail && item.symbol.serviceRangeCenter && event.detail > 0) {
    const canvas = viewer.canvas, bounds = canvas.getBoundingClientRect()
    const pixel = new Cartesian2((event.clientX-bounds.left)*canvas.clientWidth/bounds.width,
      (event.clientY-bounds.top)*canvas.clientHeight/bounds.height)
    const court = pickSurveyedCourt(pixel)
    if (court) { emit('select',court); return }
  }
  if (item.pin && item.members.length === 1) {
    emit('select',item.members[0].id)
    return
  }
  const ground = mapSurfaceHeight()
  if (item.scale !== 'detail') {
    drillTown = item.symbol.townId ?? ''
    drillVillage = item.scale === 'village' ? item.symbol.villageId ?? '' : undefined
    openFacilityGroup.value = ''
    const area = facilityAreas.get(drillVillage ?? drillTown)
    const coords = area ? polygons(area).flatMap(rings=>rings[0]) : item.members.map(p=>p.position)
    const [west,south,east,north] = coords.reduce<MapBounds>((b,[x,y]) =>
      [Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)], [Infinity,Infinity,-Infinity,-Infinity])
    const center: Coordinate = [(west+east)/2,(south+north)/2]
    const fit = Math.max((east-west)*111195*Math.cos(CesiumMath.toRadians(center[1])) / Math.max(1,mapWindow.width*.72),
      (north-south)*111195 / Math.max(1,mapWindow.height*.62))
    const town = item.scale === 'town'
    const frustum = viewer.camera.frustum
    const focal = frustum instanceof PerspectiveFrustum && frustum.fovy
      ? viewer.canvas.clientHeight/(2*Math.tan(frustum.fovy/2)) : 700
    const currentResolution = (viewer.camera.positionCartographic.height-ground)/focal
    const resolution = Math.min(currentResolution*.82,Math.max(town ? FACILITY_VILLAGE_RESOLUTION*1.4 : .35,fit))
    if (town) townExitResolution = Math.max(FACILITY_TOWN_RESOLUTION,resolution*1.12)
    else villageExitResolution = Math.max(FACILITY_VILLAGE_RESOLUTION,resolution*1.12)
    const targetHeight = focal*resolution
    const targetGround = isolatedTown.value?.wallHeight ?? (shouldShowCountyRelief(targetHeight) ? countyRimHeight : 0)
    const childArea = town && item.symbol.villageId ? facilityAreas.get(item.symbol.villageId) : undefined
    const nextAnchor = childArea ? districtCenter(childArea) : undefined
    goTo(fit <= resolution ? center : nextAnchor ?? item.symbol.position,targetGround + targetHeight,false,0)
    return
  }
  const aboveGround = viewer.camera.positionCartographic.height - ground
  const sameLocation = item.members.every(p => p.position[0] === item.target[0] && p.position[1] === item.target[1])
  if (item.scale === 'detail' && (serviceRangeActive.value || aboveGround <= 1100 || sameLocation)) {
    openFacilityGroup.value = openFacilityGroup.value === item.key ? '' : item.key
    return
  }
  openFacilityGroup.value = ''
  const altitude = aboveGround * .27
  goTo(item.target,ground + Math.max(380,altitude))
}

function updateFlowMarkers() {
  if (!viewer || !mapWindow.width) return
  const { scene } = viewer
  const {left,top,width,height,toolbar} = mapWindow
  const project = (position: Coordinate) => {
    const pixel = SceneTransforms.worldToWindowCoordinates(scene, Cartesian3.fromDegrees(...position, mapSurfaceHeight() + 44))
    return pixel && {x:Math.round(pixel.x - left),y:Math.round(pixel.y - top)}
  }
  const route = props.promotionFlow
  const from = route && project(route.from), to = route && project(route.to)
  const via = route?.via && project(route.via.position)
  const promotionFrame = route && from && to ? JSON.stringify([route.id,from,to,via,width,height,toolbar]) : ''
  if (promotionFrame !== outboundFrame) {
    outboundFrame = promotionFrame
    outboundFlow.value = route && from && to
      ? layoutPromotionFlow(from,to,width,height,toolbar,[route.fromLabel,route.toLabel],via,!!route.fromKind) : null
  }
  if (!visitorFlows.length) {
    if (flowMarkers.value.length) flowMarkers.value = []
    return
  }
  const projected = visitorFlows.flatMap(flow => {
    const to = project(flow.destination)
    return to ? [{...flow, from:project(flow.source), to}] : []
  })
  const frame = JSON.stringify([left,top,width,height,toolbar,projected])
  if (frame === flowFrame) return
  flowFrame = frame
  flowMarkers.value = layoutVisitorFlows(projected,width,height,toolbar)
}

function resetCourtDrill() {
  courtTown = undefined
  courtVillage = undefined
  courtDrillFlight = undefined
  courtOutlineIds = []
  markerFrame = ''
}

function matchesCourtScope(court: {townId?:string; villageId?:string}) {
  return (!courtTown || (court.townId ?? '') === courtTown.id) &&
    (!courtVillage || (court.villageId ?? '') === courtVillage.id)
}

function updateSurveyedCourts(map: Viewer, focal: number) {
  const {camera,scene} = map
  const resolution = Math.max(0,camera.positionCartographic.height-mapSurfaceHeight())/focal
  if (!courtDrillFlight) {
    if (courtVillage && resolution > courtVillage.exit) courtVillage = undefined
    if (courtTown && resolution > courtTown.exit) courtTown = undefined
  }
  const scale = props.courtScope === 'village' || courtVillage ? 'detail'
    : facilityClusterScale(courtTown || props.courtScope === 'town' ? Math.min(resolution,FACILITY_TOWN_RESOLUTION) : resolution)
  const level = scale === 'town' ? 'district' : scale === 'village' ? 'facility' : 'court'
  const {left,top,width,height} = mapWindow
  const {topInset,bottomInset,rightInset} = facilityMapInsets(width,height)
  const w = width-rightInset, h = height-topInset-bottomInset
  const frame = [scale,courtTown?.id,courtVillage?.id,camera.positionWC,camera.directionWC,camera.upWC,
    focal,left,top,w,h,mapSurfaceHeight()].join('|')
  if (frame === markerFrame) return
  markerFrame = frame
  zoomLevel.value = level
  courtCount.value = courtTown || courtVillage ? courts.filter(matchesCourtScope).length : courts.length
  const offset = new Cartesian3()
  const project = (position: Coordinate) => {
    const world = Cartesian3.fromDegrees(...position,mapSurfaceHeight()+16)
    if (props.centerDistrictClusters && Cartesian3.dot(Cartesian3.subtract(world,camera.positionWC,offset),camera.directionWC)<=0) return
    const pixel = SceneTransforms.worldToWindowCoordinates(scene,world)
    return pixel && {x:pixel.x-left,y:pixel.y-top-topInset}
  }
  const visible = (p: {x:number;y:number}) => p.x>=12 && p.y>=12 && p.x<=w-12 && p.y<=h-24
  courtOutlineIds = [courtTown?.id,courtVillage?.id].filter((id):id is string=>!!id)
  if (scale === 'detail') {
    courtMarkers.value = []
    const points = courts.filter(matchesCourtScope).flatMap(({feature,center}) => {
      const pixel = project(center)
      return pixel && visible(pixel) ? [{id:feature.id,name:feature.properties.name,selected:feature.id===props.selectedId,...pixel,metersPerPixel:0}] : []
    })
    courtCaptions.value = layoutServiceCaptions(points,w,h).map(item => ({...item,y:item.y+topInset}))
  } else {
    courtCaptions.value = []
    const townLevel = scale === 'town'
    const projected = [...(townLevel ? districts : villages)].flatMap(([id,group]) => {
      if (!townLevel && courtTown && (group.townId ?? '')!==courtTown.id) return []
      let pixel = project(group.position)
      if ((!pixel || !visible(pixel)) && !group.fixedCenter) {
        pixel = undefined
        for (const court of courts) {
          if (court.townId!==group.townId || (!townLevel && court.villageId!==group.villageId)) continue
          const candidate = project(court.center)
          if (candidate && visible(candidate)) { pixel = candidate; break }
        }
      }
      return pixel ? [{...group,id:scale+':'+id,...pixel}] : []
    })
    courtMarkers.value = layoutCourtMarkers(projected,scale,w,h,true).map(marker=>({...marker,y:marker.y+topInset}))
    if (!townLevel) {
      for (const marker of courtMarkers.value) if (marker.villageId) courtOutlineIds.push(marker.villageId)
    }
  }
  renderDistrictOutlines()
  syncCourtPolygons()
}

function updateCourtMarkers() {
  if (!viewer) return
  const { camera, scene } = viewer
  const frustum = camera.frustum
  if (surveyedCourts.value && courts.length && !serviceRangeActive.value && frustum instanceof PerspectiveFrustum && frustum.fovy) {
    updateSurveyedCourts(viewer,viewer.canvas.clientHeight/(2*Math.tan(frustum.fovy/2)))
    return
  }
  if (courtCaptions.value.length) courtCaptions.value = []
  const height = camera.positionCartographic.height - (surveyedCourts.value ? mapSurfaceHeight() : 0)
  const current = zoomLevel.value
  const level: ZoomLevel = height > districtThreshold * (current === 'district' ? .9 : 1.1) ? 'district'
    : height > courtThreshold * (current === 'court' ? 1.1 : .9) ? 'facility' : 'court'
  if (level !== current) {
    zoomLevel.value = level
    syncCourtPolygons()
    scene.requestRender()
  }
  if (level === 'court' || props.venueDetail) {
    if (courtMarkers.value.length) courtMarkers.value = []
    markerFrame = ''
    const now = performance.now()
    if (now - lastCourtUpdate >= 120) {
      lastCourtUpdate = now
      syncCourtPolygons()
    }
    return
  }
  const district = level === 'district'
  const {left,top,width,height:screenHeight} = mapWindow
  const projected = [...(district ? districts : facilities)].flatMap(([id, group]) => {
    const screen = SceneTransforms.worldToWindowCoordinates(scene, Cartesian3.fromDegrees(...group.position, mapSurfaceHeight() + 44))
    return screen ? [{ ...group, id:(district ? 'district:' : 'facility:') + id, x:Math.round(screen.x - left), y:Math.round(screen.y - top) }] : []
  })
  const frame = JSON.stringify([level,width,screenHeight,projected.map(({id,x,y}) => [id,x,y])])
  if (frame === markerFrame) return
  markerFrame = frame
  courtMarkers.value = layoutCourtMarkers(projected,district,width,screenHeight,surveyedCourts.value)
}

function drillSurveyedCourtArea(map: Viewer, item: CourtMarker) {
  const frustum = map.camera.frustum
  if (!(frustum instanceof PerspectiveFrustum) || !frustum.fovy) return
  const town = zoomLevel.value === 'district'
  const targets = town ? [...villages.values()].filter(village=>village.townId===item.townId)
    : courts.filter(court=>court.townId===item.townId && court.villageId===item.villageId)
      .map(court=>({position:court.center,count:1,outline:polygons(court.feature).flatMap(rings=>rings[0])}))
  const {width,height} = mapWindow
  const {topInset,bottomInset,rightInset} = facilityMapInsets(width,height)
  const focal = map.canvas.clientHeight/(2*Math.tan(frustum.fovy/2))
  const angles = currentCameraAngles(map)
  const currentResolution = Math.max(0,map.camera.positionCartographic.height-mapSurfaceHeight())/focal
  const frame = courtDrillFrame(targets,town ? 'town' : 'village',(width-rightInset)*.86,(height-topInset-bottomInset)*.84,
    currentResolution,angles.heading,angles.incline)
  if (!frame) return
  const {center,resolution} = frame
  cancelLayerFocus()
  if (town) {
    courtTown = {id:item.townId ?? '',exit:Math.max(FACILITY_TOWN_RESOLUTION,resolution*1.18)}
    courtVillage = undefined
  } else {
    courtVillage = {id:item.villageId ?? '',exit:Math.max(FACILITY_VILLAGE_RESOLUTION,resolution*1.18)}
    courtTown ??= {id:item.townId ?? '',exit:Math.max(FACILITY_TOWN_RESOLUTION,resolution*1.45)}
  }
  const flight = {flying:true}
  courtDrillFlight = layerFocus = flight
  markerFrame = ''
  const finish = () => {
    if (courtDrillFlight===flight) courtDrillFlight = undefined
    if (layerFocus===flight) layerFocus = undefined
  }
  const sphere = new BoundingSphere(Cartesian3.fromDegrees(...center),0)
  if (!flyToLayer({sphere,model:false},finish,focal*resolution,angles)) {
    finish()
    goTo(center,mapSurfaceHeight()+focal*resolution)
  }
}

function zoomToCourtMarker(item: CourtMarker) {
  const height = viewer?.camera.positionCartographic.height
  if (!viewer || height === undefined) return
  if (surveyedCourts.value && item.bounds) {
    drillSurveyedCourtArea(viewer,item)
    return
  }
  const target = item.kind === 'district' ? 13_000 : item.kind === 'cluster' ? Math.max(5_400, height * .42) : 900
  goTo(item.position, item.kind === 'cluster' && height <= target * 1.12 ? 3_200 : target)
  if (props.selectCourtFacility && item.kind === 'facility') emit('select', item.id)
}

function prepareMapWheel(event: WheelEvent) {
  if (!viewer) return
  cancelLayerFocus()
  // Cesium reads the wheel delta and the last canvas pointer position separately.
  // A label can intercept every move since the pointer last crossed the map.
  const pointer = {
    bubbles:true, clientX:event.clientX, clientY:event.clientY, buttons:event.buttons,
    ctrlKey:event.ctrlKey, shiftKey:event.shiftKey, altKey:event.altKey, metaKey:event.metaKey,
  }
  // Cesium registers only one of these listeners, depending on the browser.
  if (typeof PointerEvent === 'function') {
    viewer.canvas.dispatchEvent(new PointerEvent('pointermove',{...pointer,pointerType:'mouse',isPrimary:true}))
  }
  viewer.canvas.dispatchEvent(new MouseEvent('mousemove',pointer))
}

function startMarkerOrbit(event: MouseEvent | PointerEvent) {
  if (!viewer) return
  // Deliver the press to Cesium so its usual pointer capture or document listeners take over the drag.
  const down = event.type === 'pointerdown' ? new PointerEvent('pointerdown', event) : new MouseEvent('mousedown', event)
  viewer.canvas.dispatchEvent(down)
}

function wheelOnCourtMarker(event: WheelEvent) {
  if (!viewer) return
  event.preventDefault()
  viewer.canvas.dispatchEvent(new WheelEvent('wheel', {
    bubbles:true, cancelable:true, clientX:event.clientX, clientY:event.clientY,
    deltaX:event.deltaX, deltaY:event.deltaY, deltaZ:event.deltaZ, deltaMode:event.deltaMode,
    ctrlKey:event.ctrlKey, shiftKey:event.shiftKey, altKey:event.altKey, metaKey:event.metaKey,
  }))
}

function syncCourtPolygons() {
  if (!viewer || !courtPolygons) return
  courtPolygons.show = !!props.venueDetail || zoomLevel.value === 'court'
  if (!courtPolygons.show) return
  const extent = viewer.camera.computeViewRectangle()
  const scoped = surveyedCourts.value && !props.venueDetail ? courts.filter(matchesCourtScope) : courts
  const visible = extent ? scoped.filter(({ center }) => {
    const [longitude, latitude] = center.map(CesiumMath.toRadians)
    const margin = CesiumMath.toRadians(.002)
    return longitude >= extent.west - margin && longitude <= extent.east + margin &&
      latitude >= extent.south - margin && latitude <= extent.north + margin
  }) : scoped
  const key = JSON.stringify([props.selectedId, visible.map(item => item.feature.id)])
  if (key === renderedCourtKey) return
  renderedCourtKey = key
  const collection = courtPolygons.entities
  for (const item of collection.values) hitTargets.delete(item.id)
  collection.removeAll()
  collection.suspendEvents()
  try {
    for (const { feature } of visible) addFeature(collection, feature)
  } finally {
    collection.resumeEvents()
  }
  viewer.scene.requestRender()
}

function courtFootprintHeight() {
  return mapSurfaceHeight() + (populationLayer ? 25 : 11)
}

function pickSurveyedCourt(pixel: Cartesian2) {
  if (!viewer || !surveyedCourts.value || !courtPolygons?.show || (!props.venueDetail && zoomLevel.value !== 'court')) return
  // A translucent grid can mask the court in Cesium's pick buffer. Check its actual survey ring.
  const ellipsoid = ellipsoidAtHeight(courtFootprintHeight())
  const world = viewer.camera.pickEllipsoid(pixel, ellipsoid)
  if (!world) return
  const location = Cartographic.fromCartesian(world, ellipsoid)
  const at = [CesiumMath.toDegrees(location.longitude), CesiumMath.toDegrees(location.latitude)]
  const collection = courtPolygons.entities
  return courts.find(({feature}) => collection.getById('f:' + feature.id + ':shape:0') &&
    polygons(feature).some(rings => inPolygon(at, rings)))?.feature.id
}

function addRaisedBoundary(collection: EntityCollection, id: string, rings: Position[][], parts: Position[][][], wallHeight: number,
  faces: {rings:Position[][]; texture?:ReliefTexture}[]) {
  const solid=props.investmentRelief
  if(!solid){
    const shadowScale=wallHeight/countyRimHeight
    const shadow=rings.map(path=>path.map(([x,y])=>[x+.004*shadowScale,y-.006*shadowScale]))
    collection.add({id:id+':shadow',polygon:{hierarchy:hierarchy(shadow,3),height:3,material:Color.fromCssColorString('#254d62').withAlpha(.26)}})
  }
  const planning=solid ? planningRoof.value : undefined
  faces.forEach(({rings:face,texture},index)=>collection.add({id:id+':top:'+index,polygon:{
    ...reliefSurface(face,wallHeight,texture?.bounds ?? planning?.bounds),height:wallHeight,
    material:solid ? new SolidReliefMaterialProperty(texture,planning)
      : texture ? new MapImageMaterialProperty({image:texture.image,color:Color.fromCssColorString('#e5f2f5')}) : Color.fromCssColorString('#94bbd1'),
  }}))
  const [outline, ...holes] = rings
  collection.add({ id: id + ':side:0', wall: {
    positions: positions(outline, wallHeight), material: countyRimColor,
  } })
  addLine(collection, id + ':rim:0', outline, Color.fromCssColorString('#e8fcff'), 2, wallHeight + 4)
  holes.forEach((hole, index) => {
    // Leave any mapped islands inside the hole available to their own textured roofs.
    const islands = parts.filter(part => part !== rings && inPolygon(part[0][0], [hole]))
    collection.add({ id: id + ':hole:' + index, polygon: {
      hierarchy: hierarchy([hole, ...islands.map(part => part[0])], wallHeight),
      height: wallHeight, material: mapBackground.value,
    } })
  })
}

function boundsContain(outer: [number, number, number, number], inner: [number, number, number, number]) {
  return outer.every((coordinate, index) => index < 2 ? coordinate <= inner[index] : coordinate >= inner[index])
}

function addAreaMask(collection: EntityCollection, parts: Position[][][], raised: boolean, town: boolean) {
  if (!parts.length) return
  const [west, south, east, north] = regionalImageBounds
  const outer: Position[] = [[west,south], [east,south], [east,north], [west,north], [west,south]]
  collection.add({ id: town ? 'town-mask' : 'county-mask', polygon: {
    hierarchy: new PolygonHierarchy(positions(outer, 0), raised ? [] : parts.map(rings => hierarchy(rings, 0))),
    material: mapBackground.value,
    classificationType: ClassificationType.TERRAIN,
  } })
}

function rebuildAdmin() {
  eventLabels?.invalidate()
  if (!viewer || !admin) return
  const boundaries = displayAdministration.value
  const collection = admin.entities
  const countyPolygons = countyParts.value
  const light = props.lightTheme
  const raised = elevatedCounty
  const color = Color.fromCssColorString(light ? '#177fe1' : '#66ddff')
  const interiorColor = raised ? Color.fromCssColorString('#bed8e2') : color
  const publishedImagery = useReferenceImagery.value && externalImagery.value ? props.imageryConfig : undefined
  const countyTexture = maskedRoof.value ?? ((useReferenceImagery.value || investmentReference.value)
    ? publishedImagery && countyBounds.value && boundsContain(publishedImagery.bounds, countyBounds.value)
      ? {image: publishedImagery.url, bounds: publishedImagery.bounds} : {image: countyCapImage, bounds: imageBounds}
    : undefined)
  // Emit removals before inserting replacements with the same Cesium IDs.
  collection.removeAll()
  collection.suspendEvents()
  try {
    if (fusionRegion.value) {
      const edge=Color.fromCssColorString('#d2e6e9').withAlpha(.72)
      for (const {properties,geometry} of hubeiCities.value?.features ?? []) {
        const parts=geometry.type==='Polygon' ? [geometry.coordinates] : geometry.coordinates
        parts.forEach(([outline],i)=>addLine(collection,'hubei:'+properties.adcode+':'+i,outline,edge,1.5,35))
        collection.add({id:'hubei:city:'+properties.adcode, position:Cartesian3.fromDegrees(...properties.center,55),
          label:{text:properties.name,font:'600 16px "Microsoft YaHei",sans-serif',style:LabelStyle.FILL_AND_OUTLINE,
            fillColor:Color.WHITE,outlineColor:Color.fromCssColorString('#223948'),outlineWidth:3,
            disableDepthTestDistance:Infinity,pixelOffset:new Cartesian2(0,18)}})
      }
    }
    const town = isolatedTown.value
    if (town) {
      addAreaMask(collection, town.parts, true, true)
      town.parts.forEach((rings, index) => addRaisedBoundary(collection, 'town-volume:' + index, rings, town.parts, town.wallHeight,
        referenceTownFaces.value?.[index] ?? [{rings,texture:countyTexture}]))
      viewer.scene.requestRender()
      return
    }
    const selection = selectedTown.value
    for (const feature of boundaries) {
      if (props.overview && selection && feature.properties.name !== selection.name) continue
      const county = isCountyBoundary(feature)
      if (fusionRegion.value && !county) continue
      const useCimCountyOutline=cimCountyOutline && !((props.investmentRelief || props.fusionScene) && raised)
      const focus = props.region === feature.properties.region && !county
      if (!county && !focus && props.showTownBoundaries === false) continue
      if (county && useCimCountyOutline || !county && cimTownOutlines && feature.properties.kind === 'town-boundary') continue
      polygons(feature).forEach((rings, index) => {
        if (county && raised) {
          addRaisedBoundary(collection, 'admin-volume:' + feature.id + ':' + index, rings, countyPolygons, countyRimHeight, [{rings,texture:countyTexture}])
          return
        }
        rings.forEach((ring, ringIndex) => {
          const id = 'admin:' + feature.id + ':' + index + ':' + ringIndex
          collection.add({ id, polyline: { positions: positions(ring, raised ? countyRimHeight + 12 : 4),
            width: county ? (light ? 4.8 : 6) : focus ? 3 : 1.65,
            material: county
              ? light ? Color.WHITE.withAlpha(.8) : new PolylineGlowMaterialProperty({ color, glowPower: .24 })
              : feature.properties.kind === 'town-demo-zone'
                ? new PolylineDashMaterialProperty({ color: interiorColor.withAlpha(.64), dashLength: 12 }) : interiorColor.withAlpha(.75),
          } })
          if (county) addLine(collection, id + ':core', ring, color, light ? 2.65 : 2, 5)
        })
      })
    }
    if (!fusionRegion.value) addAreaMask(collection, selection?.parts ?? countyPolygons, raised, Boolean(selection))
  } finally {
    collection.resumeEvents()
  }
  viewer.scene.requestRender()
}

function shouldShowCountyRelief(height: number) {
  // Separate thresholds keep small zoom changes from repeatedly switching the county surface.
  return !isolatedTown.value && !((props.overview || props.investmentRelief) && selectedTown.value) && countyReliefEnabled.value &&
    height >= (elevatedCounty ? countyReliefExitHeight : countyReliefEnterHeight)
}

function updateCountyElevation() {
  if (!viewer) return
  const height=viewer.camera.positionCartographic.height
  const shouldElevate = shouldShowCountyRelief(height)
  if (shouldElevate === elevatedCounty)return
  elevatedCounty = shouldElevate
  rebuildAdmin()
  rebuildFeatures()
  rebuildRoadControls()
}

function centerOnScreen(map: Viewer) {
  const {left,top,width,height} = mapWindow
  const ellipsoid = isolatedTown.value?.roofEllipsoid
  const picked = map.camera.pickEllipsoid(new Cartesian2(left + width / 2, top + height / 2), ellipsoid)
  return picked ? Cartographic.fromCartesian(picked, ellipsoid) : map.camera.positionCartographic
}

function updateTownDetailSurface(map: Viewer) {
  const town = selectedTown.value
  const {camera,canvas} = map
  const frustum = camera.frustum
  if (!(props.overview || props.investmentRelief) || !town || appliedRegion !== props.region || !canvas.clientHeight ||
      !(frustum instanceof PerspectiveFrustum) || !frustum.fovy) return
  const previousHeight = isolatedTown.value?.wallHeight ?? 0
  const metersPerPixel = (camera.positionCartographic.height - previousHeight) * 2 * Math.tan(frustum.fovy / 2) / canvas.clientHeight
  // Beyond the native roof image scale, use the imagery provider's tiled ground surface.
  const roofResolution = Math.max(town.spanX,town.spanY) / reliefImageSize
  const wasClose = closeupTown.value === town.name
  const close = metersPerPixel < roofResolution * (wasClose ? 1.45 : 1)
  if (close === wasClose) return
  const pivot = centerOnScreen(map)
  closeupTown.value = close ? town.name : undefined
  const nextHeight = isolatedTown.value?.wallHeight ?? 0
  if (nextHeight === previousHeight) return
  // Translate the camera with the change in surface elevation so the ground point stays under the same pixel.
  const before = Cartesian3.fromRadians(pivot.longitude,pivot.latitude,previousHeight)
  const after = Cartesian3.fromRadians(pivot.longitude,pivot.latitude,nextHeight)
  const shift = Cartesian3.subtract(after,before,new Cartesian3())
  camera.setView({destination:Cartesian3.add(camera.positionWC,shift,new Cartesian3()),
    orientation:{direction:Cartesian3.clone(camera.directionWC),up:Cartesian3.clone(camera.upWC)}})
}

function reportCamera() {
  if (!viewer) return
  updateTownDetailSurface(viewer)
  const center = centerOnScreen(viewer)
  lastMapCenter = Cartographic.clone(center)
  const { camera } = viewer
  const height = camera.positionCartographic.height
  townOverviewScale.value = height >= (townOverviewScale.value ? countyReliefExitHeight : countyReliefEnterHeight)
  if (retainVenueView.value) tilted = camera.pitch > normalOrientation.pitch + CesiumMath.toRadians(2)
  const wasElevated = elevatedCounty
  updateCountyElevation()
  const longitude = CesiumMath.toDegrees(center.longitude)
  const latitude = CesiumMath.toDegrees(center.latitude)
  if (!retainVenueView.value && !investmentFlightActive() && !wasElevated && elevatedCounty && !tilted && camera.pitch < normalOrientation.pitch + CesiumMath.toRadians(5)) {
    goTo([longitude,latitude],height,true)
    return
  }
  updateCourtMarkers()
  updateFlowMarkers()
  updateBasemapVisibility()
  syncCourtPolygons()
  syncRoadNetwork(height)
  const extent=props.investmentRelief && camera.computeViewRectangle()
  const bounds:MapBounds|undefined=extent ? [extent.west,extent.south,extent.east,extent.north].map(CesiumMath.toDegrees) as MapBounds : undefined
  emit('camera', { longitude, latitude, height, tilted, bounds })
  viewer.scene.requestRender()
}

function goTo(position: Coordinate, height: number, immediate = false,
  incline = isolatedTown.value || shouldShowCountyRelief(height) ? overviewIncline : 0, explicitTilt = false) {
  if (!viewer) return
  const elevation = isolatedTown.value?.wallHeight ?? 0
  height = Math.max(height, elevation + 75)
  tilted = explicitTilt
  viewer.camera.lookAtTransform(Matrix4.IDENTITY)
  const {left,top,width,height:visibleHeight} = mapWindow
  const {clientWidth,clientHeight} = viewer.canvas
  const frustum = viewer.camera.frustum
  const metersPerPixel = frustum instanceof PerspectiveFrustum && frustum.fovy !== undefined && clientHeight
    ? (height - elevation) * 2 * Math.tan(frustum.fovy / 2) / clientHeight : 0
  const latitudeScale = 111_195
  const longitudeScale = latitudeScale * Math.max(.01,Math.cos(CesiumMath.toRadians(position[1])))
  const longitude = position[0] + (clientWidth / 2 - left - width / 2) * metersPerPixel / longitudeScale
  const latitude = position[1] + ((top + visibleHeight / 2 - clientHeight / 2) * metersPerPixel -
    (height - elevation) * Math.tan(incline)) / latitudeScale
  const orientation = { ...normalOrientation, pitch: normalOrientation.pitch + incline }
  const view = { destination: Cartesian3.fromDegrees(longitude, latitude, height), orientation }
  if (immediate) {
    viewer.camera.cancelFlight()
    viewer.camera.setView(view)
    reportCamera()
  } else viewer.camera.flyTo({ ...view, duration: .7, complete: reportCamera })
}

function goHome(immediate = false) {
  const town = selectedTown.value
  if (viewer && town && mapWindow.width) {
    const { width, height, canvasHeight } = mapWindow
    const frustum = viewer.camera.frustum
    const metersPerPixelAtUnitHeight = frustum instanceof PerspectiveFrustum && frustum.fovy
      ? 2 * Math.tan(frustum.fovy / 2) / Math.max(canvasHeight, 1) : 1 / 700
    const incline = isolatedTown.value ? overviewIncline : 0
    const wallHeight = isolatedTown.value?.wallHeight ?? 0
    const sinIncline = Math.sin(incline)
    const cosIncline = Math.cos(incline)
    const apparentHeight = town.spanY * cosIncline + 2 * wallHeight * sinIncline
    const nearEdgeDistance = Math.max(town.spanX / (width * .82), apparentHeight / (height * .75)) / metersPerPixelAtUnitHeight
    const centerHeight = (nearEdgeDistance + town.spanY * sinIncline / 2) * cosIncline
    goTo(town.center, wallHeight + Math.max(2_600, centerHeight), immediate, incline)
    return
  }
  const {width,height} = mapWindow
  const aspect = height ? width / height : 1.65
  const relief = countyReliefEnabled.value
  const defaultHeight = relief ? 157_000 : homeHeight
  const cityHeight = Math.max(defaultHeight, defaultHeight * aspect / 1.65, width < 460 ? 158_000 : 0)
  if (!props.region || /^(全市|京山市|全部)$/.test(props.region)) {
    if (usesCountyOverviewView.value) {
      // Use the dashboard viewport for scale. The rails position the map center
      // in goTo, but opening a different rail must not change county-wide zoom.
      const viewport = document.documentElement
      const aspect = viewport.clientWidth / Math.max(1, viewport.clientHeight)
      const overviewHeight = Math.max(homeHeight, homeHeight * aspect / 2.4, viewport.clientWidth < 1050 ? 158_000 : 0)
      goTo(home, overviewHeight, immediate, countyReliefRequested.value ? overviewIncline : 0)
      return
    }
    goTo(relief ? reliefHome : home, cityHeight, immediate)
    return
  }
  const feature = displayAdministration.value.find(item => item.properties.region === props.region)
    ?? props.features.find(item => item.properties.region === props.region)
  const configured = feature?.properties.center
  const center = Array.isArray(configured) && configured.length === 2 && configured.every(Number.isFinite)
    ? configured as Coordinate : feature && featureCenter(feature)
  goTo(center ?? home, center ? 12_000 : cityHeight, immediate)
}

function fitPromotion(immediate = false) {
  if (!viewer || !props.promotionFlow || !mapWindow.width) return
  fittingPromotion = true
  const { from, to, via } = props.promotionFlow
  const points = via ? [from, via.position, to] : [from, to]
  const west = Math.min(...points.map(p => p[0])), east = Math.max(...points.map(p => p[0]))
  const south = Math.min(...points.map(p => p[1])), north = Math.max(...points.map(p => p[1]))
  const center: Coordinate = [(west + east) / 2, (south + north) / 2]
  const { width, height, toolbar, canvasHeight } = mapWindow
  const usableWidth = Math.max(width * .44, width - toolbar - Math.min(150, width * .27))
  const usableHeight = Math.max(height * .58, height - 145)
  const frustum = viewer.camera.frustum
  const radiansPerPixel = frustum instanceof PerspectiveFrustum && frustum.fovy
    ? 2 * Math.tan(frustum.fovy / 2) / Math.max(canvasHeight, 1) : 1 / 700
  const latitudeMeters = 111_195
  const longitudeMeters = latitudeMeters * Math.cos(CesiumMath.toRadians(center[1]))
  const longestSpan = Math.max((east - west) * longitudeMeters / usableWidth, (north - south) * latitudeMeters / usableHeight)
  const viewHeight = Math.max(2_600, longestSpan / radiansPerPixel)
  const toolbarOffset = Math.min(toolbar, width * .2) * .43
  center[0] += toolbarOffset * viewHeight * radiansPerPixel / Math.max(1, longitudeMeters)
  goTo(center,viewHeight,immediate)
}

function resizeMap(keepCamera = false) {
  if (!viewer || !root.value) return
  const canvas = viewer.canvas
  const overlay = root.value.parentElement?.querySelector('.map-scene')
  const bounds = canvas.getBoundingClientRect()
  const frame = overlay?.querySelector('.event-map-frame') ?? overlay
  const area = frame?.getBoundingClientRect() ?? bounds
  const left = Math.max(0,area.left - bounds.left)
  const top = Math.max(0,area.top - bounds.top)
  const width = Math.min(area.width,bounds.width - left)
  const height = Math.min(area.height,bounds.height - top)
  if (width <= 0 || height <= 0) return
  const oldAspect = mapWindow.width / Math.max(1,mapWindow.height)
  const previousCenter = mapWindow.width && mapWindow.canvasWidth === canvas.clientWidth &&
    mapWindow.canvasHeight === canvas.clientHeight ? centerOnScreen(viewer) : lastMapCenter
  mapWindow = { left,top,width,height,toolbar:overlay?.querySelector('.map-toolbar')?.clientWidth ?? 0,
    canvasWidth:canvas.clientWidth,canvasHeight:canvas.clientHeight }
  chromeInsets.value = {left:left + 'px',top:top + 'px',width:width + 'px',height:height + 'px'}
  viewer.resize()
  if (!keepCamera && !investmentFlightActive() && !props.preserveCamera && !props.venueDetail && !courtTown && !courtVillage && !closeupTown.value &&
      !facilityAnchors.length && previousCenter && Math.abs(oldAspect - width / height) > .1 && !tilted) {
    const longitude = CesiumMath.toDegrees(previousCenter.longitude)
    const latitude = CesiumMath.toDegrees(previousCenter.latitude)
    const cameraHeight = viewer.camera.positionCartographic.height
    if (isolatedTown.value) goHome(true)
    else if (fittingPromotion && props.promotionFlow) fitPromotion(true)
    else if ((!props.region || props.region === '京山市') && cameraHeight >= homeHeight &&
        Math.abs(longitude - home[0]) < .04 && Math.abs(latitude - home[1]) < .04) goHome(true)
    else {
      const incline = elevatedCounty ? viewer.camera.pitch - normalOrientation.pitch : undefined
      goTo([longitude,latitude],cameraHeight,true,incline)
    }
  }
  viewer.scene.requestRender()
}

function changeRegion() {
  if (!viewer) return
  const town = isolatedTown.value
  const isolationChanged = town !== appliedTown
  const regionChanged = props.region !== appliedRegion
  const scaleChanged = closeupTown.value !== appliedCloseup
  appliedCloseup = closeupTown.value
  if (!isolationChanged && !regionChanged) return
  if (isolationChanged) {
    const returningToCity = appliedTown && !town && props.region === '京山市' && countyReliefEnabled.value
    appliedTown = town
    elevatedCounty = Boolean(returningToCity)
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = town ? town.wallHeight + 75 : 50
    rebuildFeatures()
    rebuildRoadControls()
    syncRoadNetwork(viewer.camera.positionCartographic.height)
    updateRegionalImagery()
  }
  appliedRegion = props.region
  if (regionChanged || !scaleChanged) resetTool()
  rebuildAdmin()
  if (regionChanged || (!scaleChanged && !retainVenueView.value)) resetMapView()
}

function showSelected() {
  rebuildRoadControls()
  if (!props.selectedId || !viewer) return
  const feature = props.features.find(item => item.id === props.selectedId)
  if (feature && (feature.properties.kind === 'origin' || sceneMapRole(feature))) return
  if (props.venueDetail && feature?.properties.kind === 'court-footprint') return
  if (feature?.properties.kind === 'court-footprint' && (courtTown || courtVillage)) {
    const selectedCourt = courts.find(court=>court.feature.id===feature.id)
    if (selectedCourt && !matchesCourtScope(selectedCourt)) resetCourtDrill()
  }
  const center = feature && featureCenter(feature)
  if (feature && center) {
    const currentHeight = viewer.camera.positionCartographic.height
    const height = feature.properties.kind === 'court-footprint' ? (isolatedTown.value?.wallHeight ?? 0) + 680
      : feature.properties.kind === 'court' ? 750 : 11_000
    goTo(center, Math.min(currentHeight, height))
  }
}

function resetTool() {
  tool = null
  picking.value = false
  measureStart = undefined
  hint.value = ''
  measure?.entities.removeAll()
  viewer?.scene.requestRender()
}

function cancelLayerFocus(id?: string) {
  if (!layerFocus || (id !== undefined && id !== layerFocus.id)) return
  const { flying } = layerFocus
  layerFocus = undefined
  if (flying) viewer?.camera.cancelFlight()
}

function layerViewport(map: Viewer) {
  const { left, top, width, height, toolbar } = mapWindow
  const insets = serviceRangeActive.value ? facilityMapInsets(width,height) : undefined
  let right = left + width - Math.max(Math.min(toolbar + 12, width * .15),insets?.rightInset ?? 0)
  let upper = top + (insets?.topInset ?? Math.min(55,height*.1))
  const bottom = top + height - (insets?.bottomInset ?? Math.min(32,height*.08))
  const menu = root.value?.parentElement?.querySelector('.popover-layers')?.getBoundingClientRect()
  if (menu) {
    const canvas = map.canvas.getBoundingClientRect()
    const beside = Math.min(right, menu.left - canvas.left - 12)
    const below = Math.max(upper, menu.bottom - canvas.top + 12)
    // Use whichever free rectangle can show the larger model while the catalogue is open.
    if (Math.min(beside - left, bottom - upper) >= Math.min(right - left, bottom - below)) {
      if (beside - left > 40) right = beside
    } else if (bottom - below > 40) upper = below
  }
  return { x:(left + right) / 2, y:(upper + bottom) / 2, span:Math.min(right - left, bottom - upper) }
}

type CameraAngles = {heading:number; incline:number}

function currentCameraAngles(map: Viewer): CameraAngles {
  return { heading:map.camera.heading, incline:map.camera.pitch + CesiumMath.PI_OVER_TWO }
}

function flyToLayer({ sphere, model }: CimFocusTarget, onEnd: () => void, cameraHeight?: number, angles?: CameraAngles, limits?:MapFitLimits & {immediate?:boolean}) {
  const map = viewer
  if (!map || !(map.camera.frustum instanceof PerspectiveFrustum) || !map.camera.frustum.fovy) return false
  // The details rail can expand in the same render as the selection. Measure it
  // before targeting the feature so the subsequent resize does not reframe the flight.
  resizeMap(true)
  const { clientWidth, clientHeight } = map.canvas
  const { x, y, span } = layerViewport(map)
  if (span <= 0 || !clientWidth || !clientHeight) return false
  const focalLength = clientHeight / (2 * Math.tan(map.camera.frustum.fovy / 2))
  const dx = (x - clientWidth / 2) / focalLength
  const dy = (clientHeight / 2 - y) / focalLength
  const halfAngle = Math.atan(.4 * span / focalLength)
  // Keep the target ray above the horizon when the useful map window is off-centre.
  const incline = CesiumMath.clamp(angles?.incline ?? (model ? CesiumMath.toRadians(38) : 0),0,Math.atan2(1,Math.max(.05,dy+.05)))
  const heading = angles?.heading ?? 0
  const east = Math.sin(heading), north = Math.cos(heading)
  const sin = Math.sin(incline), cos = Math.cos(incline)
  const fitDepth = cameraHeight === undefined
    ? Math.max(model ? 100 : 400, sphere.radius * Math.hypot(1, dx, dy) / Math.sin(halfAngle))
    : Math.max(75, cameraHeight) / Math.max(.1, cos - dy * sin)
  const vertical=Math.max(.1,cos-dy*sin)
  const maxDepth=(limits?.maxHeight??Infinity)/vertical
  const depth=CesiumMath.clamp(fitDepth,(limits?.minHeight??0)/vertical,maxDepth)
  const center=fitDepth>maxDepth && limits?.anchor
    ? Cartographic.fromDegrees(...limits.anchor) : Cartographic.fromCartesian(sphere.center)
  if (!center || !Number.isFinite(depth)) return false
  const townHeight = retainVenueView.value && depth < countyReliefExitHeight ? 0 : isolatedTown.value?.wallHeight
  if (!model) center.height = Math.max(center.height, townHeight ?? (shouldShowCountyRelief(depth) ? countyRimHeight : 0))
  const frame = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromRadians(center.longitude, center.latitude, center.height))
  // Offset the eye along the chosen screen ray so the target lands between the panels.
  const side = -dx * depth, forward = -(sin + dy * cos) * depth
  const eye = new Cartesian3(side*north + forward*east, -side*east + forward*north, (cos - dy * sin)*depth)
  const destination = Matrix4.multiplyByPoint(frame, eye, new Cartesian3())
  const direction = Matrix4.multiplyByPointAsVector(frame, new Cartesian3(east*sin, north*sin, -cos), new Cartesian3())
  const up = Matrix4.multiplyByPointAsVector(frame, new Cartesian3(east*cos, north*cos, sin), new Cartesian3())
  fittingPromotion = false
  tilted = incline > CesiumMath.toRadians(2)
  map.camera.flyTo({ destination, orientation:{ direction, up },
    duration:limits?.immediate || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.2,
    complete:() => { onEnd(); reportCamera() }, cancel:onEnd })
  map.scene.requestRender()
  return true
}

async function focusLayer(command: Extract<MapCommand, { action:'focus-layer' | 'fit-features' }>) {
  const request = { id:command.layerId, flying:false }
  layerFocus = request
  const target = command.action === 'focus-layer'
    ? await cimMap?.getFocusTarget(command.layerId)
    : focusTargetFromFeatures(command.features)
  // Let a newly added ground layer remove the raised county/town before starting its flight.
  await nextTick()
  if (layerFocus !== request) return
  const finish = () => { if (layerFocus === request) layerFocus = undefined }
  if (!target) { finish(); return }
  request.flying = true
  const view=command.action==='fit-features' && command.view==='model' ? {...target,model:true} : target
  let angles: CameraAngles | undefined
  if (command.action==='fit-features' && (props.venueDetail || command.view==='context') && viewer) {
    angles = currentCameraAngles(viewer)
    if (command.view==='model') angles.incline = CesiumMath.toRadians(38)
    if (command.view==='plan') angles.incline = 0
  }
  if (!flyToLayer(view, finish, undefined, angles, command.action==='fit-features'?command:undefined)) finish()
}

function resetMapView() {
  closeupTown.value = undefined
  resetFacilityDrill()
  resetCourtDrill()
  // Read the current panel layout before placing the county in the visible map area.
  const immediate = usesCountyOverviewView.value && props.region === '京山市'
  if (immediate) resizeMap(true)
  goHome(immediate)
}

// Zoom or tilt about the same visible ground point, including when the side panels are open.
function setVenueCamera(map: Viewer, height: number, angles: CameraAngles) {
  const {x,y} = layerViewport(map)
  const hit = map.camera.pickEllipsoid(new Cartesian2(x,y),ellipsoidAtHeight(mapSurfaceHeight()))
  if (!hit) return false
  const target = Cartographic.fromCartesian(hit)
  const sphere = new BoundingSphere(Cartesian3.fromRadians(target.longitude,target.latitude),0)
  const flight = {flying:true}
  layerFocus = flight
  const finish = () => { if (layerFocus===flight) layerFocus = undefined }
  if (flyToLayer({sphere,model:false},finish,height,angles)) return true
  finish()
  return false
}

function runCommand(command: MapCommand) {
  if (!viewer) return
  if (props.eventScene && ['home','focus','focus-layer','fit-features'].includes(command.action)) {
    viewer.entities.removeById('address-search-location')
    if (command.action==='focus' && command.position && command.locationName) {
      viewer.entities.add({ id:'address-search-location', position:Cartesian3.fromDegrees(...command.position,8),
        billboard:{image:'/jingshan/ui/location-ring.svg',width:26,height:30,verticalOrigin:VerticalOrigin.BOTTOM,disableDepthTestDistance:Infinity},
        label:{...label(command.locationName),pixelOffset:new Cartesian2(0,-33)},
      })
    }
  }
  if (command.action === 'cancel-layer-focus') { cancelLayerFocus(command.layerId); return }
  cancelLayerFocus()
  if (command.action === 'focus-layer' || command.action === 'fit-features') {
    void focusLayer(command)
    return
  }
  if (command.action !== 'fit-promotion' && ['home','focus','in','out','tilt'].includes(command.action)) fittingPromotion = false
  const { camera, scene } = viewer
  const center = centerOnScreen(viewer)
  const location: Coordinate = [CesiumMath.toDegrees(center.longitude), CesiumMath.toDegrees(center.latitude)]
  const height = camera.positionCartographic.height
  if (command.action === 'home') {
    resetTool()
    resetMapView()
  } else if (command.action === 'in' || command.action === 'out') {
    const limit = regionalView.value ? promotionZoomLimit : 250_000
    const nextHeight = Math.min(limit, Math.max(75, height * (command.action === 'in' ? .5 : 1.9)))
    if (!retainVenueView.value || !setVenueCamera(viewer,nextHeight,currentCameraAngles(viewer)))
      goTo(location, nextHeight, false, tilted ? CesiumMath.toRadians(42) : undefined, tilted)
  } else if (command.action === 'focus' && command.position) {
    const elevation = isolatedTown.value?.wallHeight ?? 0
    const height = command.height ?? 3_500
    const target = new BoundingSphere(Cartesian3.fromDegrees(...command.position, elevation), 0)
    const request = {flying:true}
    layerFocus = request
    const finish = () => { if (layerFocus === request) layerFocus = undefined }
    if (!command.view || !flyToLayer({sphere: target, model: command.view === 'model'}, finish, height, undefined, command)) {
      finish()
      goTo(command.position, height, command.immediate, command.view === 'model' ? CesiumMath.toRadians(38) : undefined, command.view === 'model')
    }
  } else if (command.action === 'fit-promotion') {
    resetTool()
    fitPromotion()
  } else if (command.action === 'tilt') {
    const angles = currentCameraAngles(viewer)
    angles.incline = angles.incline > CesiumMath.toRadians(2) ? 0 : CesiumMath.toRadians(42)
    if (!retainVenueView.value || !setVenueCamera(viewer,height,angles))
      goTo(location, height, true, tilted ? undefined : CesiumMath.toRadians(42), !tilted)
  } else if (command.action === 'pick' || command.action === 'measure') {
    resetTool()
    tool = command.action
    picking.value = true
    hint.value = tool === 'pick' ? '请在地图上选择位置' : '请在地图上选择测量起点'
  } else if (command.action === 'clear') resetTool()
  scene.requestRender()
}

function mapClick(pixel: Cartesian2) {
  if (!viewer) return
  const { camera, scene } = viewer
  if (tool) {
    const ellipsoid = isolatedTown.value?.roofEllipsoid
    const point = camera.pickEllipsoid(pixel, ellipsoid)
    if (!point) return
    const { longitude, latitude } = Cartographic.fromCartesian(point, ellipsoid)
    const position: Coordinate = [CesiumMath.toDegrees(longitude), CesiumMath.toDegrees(latitude)]
    if (tool === 'pick') {
      resetTool()
      emit('position', position)
    } else if (measure) {
      const markerHeight = mapSurfaceHeight() + 30
      measure.entities.add({ position: Cartesian3.fromDegrees(...position, markerHeight),
        point: { color: Color.fromCssColorString('#ffdc64'), pixelSize: 9, disableDepthTestDistance: Infinity },
      })
      if (!measureStart) {
        measureStart = position
        hint.value = '请选择测量终点'
      } else {
        const distance = new EllipsoidGeodesic(Cartographic.fromDegrees(...measureStart), Cartographic.fromDegrees(...position)).surfaceDistance
        addLine(measure.entities, 'measurement-line', [measureStart, position], Color.fromCssColorString('#ffdc64'), 3, markerHeight)
        tool = null
        picking.value = false
        measureStart = undefined
        hint.value = distance >= 1000 ? `直线距离 ${(distance / 1000).toFixed(2)} 公里` : `直线距离 ${distance.toFixed(0)} 米`
        emit('measurement', distance)
      }
    }
    scene.requestRender()
    return
  }
  if(props.attributePixels && props.densityRaster){
    const ellipsoid=ellipsoidAtHeight(mapSurfaceHeight()+5)
    const pos=camera.pickEllipsoid(pixel,ellipsoid)
    if(pos){
      const ll=Cartographic.fromCartesian(pos,ellipsoid)
      const id=pickRaster(props.densityRaster.selection,CesiumMath.toDegrees(ll.longitude),CesiumMath.toDegrees(ll.latitude))
      if(id){emit('select','attribute:'+id);return}
    }
  }
  const hits = scene.drillPick(pixel, 12)
  if(props.attributeServiceId){
    for(const hit of hits){const detail=cimMap?.pick(hit);if(detail?.serviceId===props.attributeServiceId){emit('cim-pick',detail);return}}
  }
  // A table row and its marker/footprint select the same record, including over a picked 3D tile.
  const sceneTarget = hits.flatMap(hit => {
    const id = hit.id instanceof Entity ? hit.id.id : hit.id
    const target = typeof id === 'string' && hitTargets.get(id)
    return target && target.scenePriority ? [target] : []
  }).sort((a, b) => b.scenePriority! - a.scenePriority!)[0]
  if ((sceneTarget?.scenePriority ?? 0) < 2 || (props.venueDetail && sceneTarget?.scenePriority === 2)) {
    const court = pickSurveyedCourt(pixel)
    if (court) {
      emit('select', court)
      return
    }
  }
  if (sceneTarget?.featureId) {
    emit('select', sceneTarget.featureId)
    return
  }
  // The underlying city mesh and service-radius fills are context, not detail records.
  for (const hit of thematicMap.value ? [] : hits) {
    const cimFeature = cimMap?.pick(hit)
    if (cimFeature) {
      emit('cim-pick', cimFeature)
      return
    }
    if (!(hit.id instanceof Entity)) continue
    const road = controlTargets.get(hit.id.id)
    if (road) {
      emit('select', road)
      return
    }
    const target = hitTargets.get(hit.id.id)
    if (target?.position) {
      goTo(target.position, target.height ?? 3_500)
      return
    }
    if (target?.featureId) {
      emit('select', target.featureId)
      return
    }
  }
  if (displayedDensity) {
    const ellipsoid = ellipsoidAtHeight(densityHeight)
    const point = camera.pickEllipsoid(pixel, ellipsoid)
    if (!point) return
    const pos = Cartographic.fromCartesian(point, ellipsoid)
    const cell = displayedDensity.pick([CesiumMath.toDegrees(pos.longitude), CesiumMath.toDegrees(pos.latitude)])
    if (cell) emit('select', 'density:' + cell)
  }
}

async function addReferenceImage(map: Viewer, url: string, bounds: MapBounds, signal: AbortSignal, index?: number, clip:MapBounds|undefined=countyBounds.value) {
  const response = await fetch(url, {signal})
  if (!response.ok) throw new Error('参考影像读取失败')
  const objectUrl = URL.createObjectURL(await response.blob())
  try {
    const provider = await SingleTileImageryProvider.fromUrl(objectUrl, {rectangle: Rectangle.fromDegrees(...bounds)})
    if (map.isDestroyed() || signal.aborted) return
    if (!clip) return
    const layer = new ImageryLayer(provider, {rectangle: Rectangle.fromDegrees(...clip)})
    map.imageryLayers.add(layer, index)
    styleImagery(layer)
    return layer
  } finally { URL.revokeObjectURL(objectUrl) }
}

function styleImagery(layer: ImageryLayer, regional = false) {
  const light = props.lightTheme
  layer.brightness = light ? 1.02 : regional ? .91 : .85
  layer.saturation = light ? .76 : regional ? .63 : .82
  layer.contrast = light ? 1.03 : regional ? 1 : 1.08
  layer.gamma = light ? 1.1 : 1
}

function updateMapTheme() {
  if (!viewer) return
  viewer.scene.backgroundColor = mapBackground.value
  viewer.scene.globe.baseColor = mapBackground.value
  if (backgroundGrid) backgroundGrid.alpha = props.lightTheme ? 0 : 1
  for (const layer of basemap) styleImagery(layer)
  if (regionalImagery) styleImagery(regionalImagery,true)
}

function updateBasemapVisibility() {
  const height = viewer?.camera.positionCartographic.height ?? 0
  // The regional image is seamless at the scale of cross-city routes.
  const showLocal = !isolatedTown.value && useReferenceImagery.value && (!regionalImageryVisible.value || height < 95_000)
  for (const layer of basemap) layer.show = showLocal
}

async function loadImagery() {
  const map = viewer
  if (!map) return
  localLoad?.abort()
  externalImagery.value = false
  for (const layer of basemap) map.imageryLayers.remove(layer)
  basemap = []
  if (!useReferenceImagery.value) { map.scene.requestRender(); return }
  const controller = new AbortController()
  localLoad = controller
  const load = async (url: string, bounds: [number, number, number, number]) => {
    const layer = await addReferenceImage(map, url, bounds, controller.signal)
    if (!layer) return
    basemap.push(layer)
    cimMap?.reorder()
    updateBasemapVisibility()
    map.scene.requestRender()
  }
  try {
    if (props.imageryConfig) {
      const { url, bounds } = props.imageryConfig
      try {
        await load(url, bounds)
        if (!controller.signal.aborted) {
          externalImagery.value = true
          if (elevatedCounty || isolatedTown.value) rebuildAdmin()
        }
        return
      } catch { if (controller.signal.aborted) return }
    }
    await load('/jingshan/eox2016.jpg', imageBounds)
    if (!controller.signal.aborted) await load('/jingshan/eox2016-city.jpg', cityImageBounds)
  } catch { /* County outline and vector layers remain usable without imagery. */ }
}

function updateRegionalImagery() {
  const map = viewer
  if (!map) return
  const available = useReferenceImagery.value
  if (!available) {
    regionalLoad?.abort()
    regionalLoad = undefined
    if (regionalImagery) map.imageryLayers.remove(regionalImagery)
    regionalImagery = undefined
  }
  const visible = available && !isolatedTown.value && (regionalView.value || props.lightTheme)
  if (regionalImagery) regionalImagery.show = visible
  regionalImageryVisible.value = visible && Boolean(regionalImagery)
  updateBasemapVisibility()
  if (!visible || regionalImagery || regionalLoad) {
    map.scene.requestRender()
    return
  }
  const controller = new AbortController()
  regionalLoad = controller
  void addReferenceImage(map, '/imagery/hubei.jpg', regionalImageBounds, controller.signal, 1, props.fusionScene ? regionalImageBounds : countyBounds.value).then(layer => {
    if (!layer) return
    regionalImagery = layer
    styleImagery(regionalImagery,true)
    regionalImagery.show = !isolatedTown.value && (regionalView.value || props.lightTheme)
    regionalImageryVisible.value = regionalImagery.show
    updateBasemapVisibility()
    map.scene.requestRender()
  }).catch(() => {
    // The regional flow can still use the underlying grid and projected endpoints.
  }).finally(() => { if (regionalLoad === controller) regionalLoad = undefined })
}

onMounted(async () => {
  if (!element.value) return
  try {
    backgroundGrid = new ImageryLayer(new GridImageryProvider({
      backgroundColor: darkMapBackground, color: darkMapBackground, glowColor: darkMapBackground, cells: 1,
    }))
    const map = new Viewer(element.value, {
      animation: false, baseLayer: backgroundGrid, baseLayerPicker: false, fullscreenButton: false,
      geocoder: false, homeButton: false, infoBox: false, navigationHelpButton: false,
      sceneModePicker: false, selectionIndicator: false, timeline: false, shouldAnimate: false,
      skyBox: false, skyAtmosphere: false, scene3DOnly: true, requestRenderMode: true,
      maximumRenderTimeChange: Infinity, creditContainer: credits.value,
    })
    viewer = map
    cimMap = createCimMap(map, status => {
      if (requestedBasemap.value?.id === status.id) failedBasemap.value = status.state === 'error' ? status.id : undefined
      emit('cim-status', status)
    }, (overlay, county, towns, basemap) => {
      if (cimGroundOverlay.value === overlay && cimCountyOutline === county && cimTownOutlines === towns && cimBasemap.value === basemap) return
      cimGroundOverlay.value = overlay
      cimBasemap.value = basemap
      cimCountyOutline = county
      cimTownOutlines = towns
      rebuildAdmin()
    }, service => props.venueDetail===true && isLocalSceneModel(service), service=>!!props.investmentRelief && !!service.reliefUrl)
    map.resolutionScale = Math.min(1, 1 / Math.max(1, devicePixelRatio / 1.5))
    updateMapTheme()
    map.scene.globe.showGroundAtmosphere = false
    if (map.scene.sun) map.scene.sun.show = false
    if (map.scene.moon) map.scene.moon.show = false
    map.scene.fog.enabled = false
    configureMapCameraControls(map.scene.screenSpaceCameraController)
    map.scene.screenSpaceCameraController.minimumZoomDistance = 50
    map.scene.screenSpaceCameraController.maximumZoomDistance = regionalView.value ? promotionZoomLimit : regionZoomLimit
    map.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
    const addSource = (name: string) => {
      const source = new CustomDataSource(name)
      void map.dataSources.add(source)
      return source
    }
    admin = addSource('京山行政区')
    facilityOutlines = addSource('配套资源行政区划')
    mapFeatures = addSource('业务专题')
    courtPolygons = addSource('球场面')
    courtPolygons.show = false
    roadControlLayer = addSource('道路管控')
    measure = addSource('地图测量')
    input = new ScreenSpaceEventHandler(map.canvas)
    input.setInputAction(({ position }: { position: Cartesian2 }) => mapClick(position), ScreenSpaceEventType.LEFT_CLICK)
    removeMoveListener = map.camera.moveEnd.addEventListener(reportCamera)
    if(eventLabels){
      map.scene.preUpdate.addEventListener(()=>eventLabels.update(map,
        ()=>[...(mapFeatures?.entities.values??[]),...(roadControlLayer?.entities.values??[])],
        id=>!!props.selectedId && (hitTargets.get(id)?.featureId===props.selectedId || controlTargets.get(id)===props.selectedId)))
    }
    removeMarkerRenderListener = map.scene.postRender.addEventListener(() => {
      if (densityNeedsFrame) {
        densityNeedsFrame = !densityRectangle?.ready
        map.scene.requestRender()
      }
      updateReserveMarkers()
      updateServiceCaptions()
      updateCourtMarkers()
      updateFlowMarkers()
    })
    resize = new ResizeObserver(() => resizeMap())
    resize.observe(element.value)
    const overlay = root.value?.parentElement?.querySelector('.map-scene')
    if (overlay) resize.observe(overlay.querySelector('.event-map-frame') ?? overlay)
    resizeMap()
    rebuildFeatures()
    goHome(true)
    rebuildRoadNetwork()
    rebuildRoadControls()
    if (props.administration?.some(isCountyBoundary)) rebuildAdmin()
    else {
      void fetch('/jingshan/administration.json').then(response => {
        if (!response.ok) throw new Error('行政区数据读取失败')
        return response.json() as Promise<{ features: CityFeature[] }>
      }).then(data => { localBoundaries.value = data.features; rebuildAdmin() }).catch(() => {})
    }
    void loadImagery()
    updateRegionalImagery()
    cimMap.setLayers(props.cimLayers ?? [], props.cimCatalogReady ? countyBounds.value : undefined)
    if (props.region && props.region !== '京山市') changeRegion()
    if (props.command) runCommand(props.command)
  } catch {
    error.value = 'Cesium 地图启动失败。请使用支持 WebGL 2 的浏览器。'
  }
})

watch([() => props.features, () => props.venueDetail, surveyedCourts, () => props.centerDistrictClusters, () => props.showSubjectCounts, () => props.selectedId, () => props.serviceLabelsLight, facilityBoundaryIndex], rebuildFeatures)
watch([() => props.region, () => props.courtScope, () => props.overview, () => props.businessScene], () => {
  resetCourtDrill()
  viewer?.scene.requestRender()
})
watch(densityTexture, syncDensitySurface)
watch([() => props.cimLayers, countyBounds, () => props.cimCatalogReady, () => props.venueDetail],
  ([layers, bounds, ready]) => cimMap?.setLayers(layers ?? [], ready ? bounds : undefined), { deep: true })
watch(() => props.selectedId, showSelected)
watch(() => props.highlightedServiceVenue, () => viewer?.scene.requestRender())
watch([() => props.administration, selectedTown], rebuildAdmin)
watch(hubeiCities,rebuildAdmin)
watch([cimRoof,planningRoof], () => {
  if (elevatedCounty || isolatedTown.value) rebuildAdmin()
})
watch(() => props.roadNetwork, rebuildRoadNetwork)
watch(() => props.roadControls, rebuildRoadControls)
watch(() => props.showTownBoundaries, rebuildAdmin)
watch([() => props.region, isolatedTown, closeupTown], changeRegion)
watch(() => props.command, command => { if (command) runCommand(command) }, { flush: 'post' })
watch(() => props.promotionFlow, route => {
  outboundFrame = ''
  outboundFlow.value = null
  if (!route) fittingPromotion = false
  viewer?.scene.requestRender()
})
watch(countyReliefEnabled, enabled => {
  if (!viewer) return
  const height = viewer.camera.positionCartographic.height
  if (shouldShowCountyRelief(height) === elevatedCounty) return
  if (retainVenueView.value || investmentFlightActive() || tilted || (enabled && shouldShowCountyRelief(height) &&
      Math.abs(viewer.camera.pitch - (normalOrientation.pitch + overviewIncline)) < CesiumMath.EPSILON5)) {
    updateCountyElevation()
    return
  }
  const center = centerOnScreen(viewer)
  goTo([CesiumMath.toDegrees(center.longitude),CesiumMath.toDegrees(center.latitude)],height,true)
})
watch(regionalView, enabled => {
  if (!viewer) return
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = enabled ? promotionZoomLimit : regionZoomLimit
  rebuildFeatures()
  rebuildAdmin()
  updateRegionalImagery()
})
watch([useReferenceImagery, () => props.imageryConfig], () => {
  void loadImagery()
  updateRegionalImagery()
})
watch(() => props.fusionScene, () => {
  regionalLoad?.abort()
  regionalLoad=undefined
  if (regionalImagery && viewer) viewer.imageryLayers.remove(regionalImagery)
  regionalImagery=undefined
  updateRegionalImagery()
  rebuildAdmin()
})
watch(() => props.lightTheme, () => {
  updateMapTheme()
  updateRegionalImagery()
  rebuildAdmin()
  rebuildFeatures()
  rebuildRoadControls()
})
watch(() => props.imagery, () => {
  updateRegionalImagery()
  if (elevatedCounty || isolatedTown.value) rebuildAdmin()
  viewer?.scene.requestRender()
})

onBeforeUnmount(() => {
  cancelLayerFocus()
  localLoad?.abort()
  regionalLoad?.abort()
  clearDensitySurface()
  cimMap?.destroy()
  liveRoadLayer?.destroy()
  removeMoveListener?.()
  removeMarkerRenderListener?.()
  input?.destroy()
  resize?.disconnect()
  if (viewer && !viewer.isDestroyed()) viewer.destroy()
  viewer = undefined
})
</script>

<template>
  <div ref="root" class="jt-city-map" :class="{ 'jt-city-map-light': lightTheme, 'jt-city-map-overview': overview, 'jt-event-map': eventScene }" :data-map-detail="zoomLevel"
    :data-map-isolated="isolatedTown?.name">
    <div ref="element" class="jt-map-scene" aria-label="京山市 Cesium 地图"
      @pointerdown.capture.passive="cancelLayerFocus()" @wheel.capture.passive="prepareMapWheel"></div>
    <div ref="credits" hidden></div>
    <div class="map-chrome" :class="{ 'service-labels-light': serviceLabelsLight }" :style="chromeInsets"
      @pointerdown.right="startMarkerOrbit" @mousedown.right="startMarkerOrbit" @contextmenu.prevent>
    <div v-if="reserveMarkers.length" class="reserve-markers" role="group" aria-label="拟储备地块聚合">
      <button v-for="item in reserveMarkers" :key="item.id" type="button" class="reserve-marker"
        :data-level="item.level" :style="{left:item.x+'px',top:item.y+'px'}" :disabled="picking"
        :aria-label="item.name+'，'+item.count+' 块，'+(item.level==='town'?'展开村社区':'查看地块')"
        :title="item.name+' · '+item.count+' 块'" @click.stop="emit('select',item.id)" @wheel="wheelOnCourtMarker">
        <span>{{item.count}}</span>
      </button>
    </div>
    <div v-if="facilityMarkers.length" class="court-markers surveyed facility-markers" :class="{picking}"
      :style="serviceRangeActive ? { '--map-label-max-width': SERVICE_RANGE_LABEL_WIDTH+'px', '--center-label-max-width': SERVICE_RANGE_CENTER_LABEL_WIDTH+'px' } : undefined"
      role="group" :aria-label="eventScene && !serviceRangeActive ? '赛事场馆分布' : '配套资源分布'">
      <template v-for="item in facilityMarkers" :key="item.key">

        <button type="button" :class="item.pin ? 'facility-location' : ['court-marker',item.scale==='detail'?'cluster':'district']"
          :data-scale="item.scale" :data-selected="item.symbol.selected || undefined" :data-count="item.members.length" :disabled="picking"
          :data-kind="item.mixedKinds ? 'group' : item.symbol.kind" :data-circle-center="item.symbol.serviceRangeCenter || undefined"
          :aria-expanded="serviceRangeActive && item.members.length>1 ? openFacilityGroup===item.key : undefined"
          :aria-current="item.symbol.serviceRangeCenter ? 'location' : undefined" :aria-pressed="item.symbol.kind==='venue' && !item.symbol.serviceRangeCenter ? !!item.symbol.highlighted : undefined"
          :style="{left:item.x+'px',top:item.y+'px','--marker-size':item.diameter+'px'}"
          :title="item.description" :aria-label="item.description" @click="openFacilityMarker(item,$event)" @wheel="wheelOnCourtMarker">
          <template v-if="item.pin">
            <FacilityLocationPin :kind="item.mixedKinds ? 'group' : item.symbol.kind" :color="item.mixedKinds ? undefined : item.symbol.color" :center="item.symbol.serviceRangeCenter"/>
            <span v-if="item.members.length>1" class="pin-count">{{ item.members.length }}</span>
          </template>
          <span v-else class="court-marker-count">{{ item.members.length }}</span>
          <span v-if="item.label" class="court-marker-label" :class="item.label" aria-hidden="true"><span
            v-if="item.symbol.serviceRangeCenter" class="range-center-key">中心</span>{{ item.detail }}</span>
        </button>
      </template>
      <section v-if="activeFacilityGroup" class="facility-group-list" aria-label="聚合内设施" @keydown.esc="openFacilityGroup=''">
        <header><strong>附近设施 · {{ activeFacilityGroup.members.length }} 处</strong>
          <button type="button" aria-label="关闭设施清单" @click="openFacilityGroup=''">×</button></header>
        <div><button v-for="p in activeFacilityGroup.members" :key="p.id" type="button" @click="emit('select',p.id)">
          <small>{{ p.category }}</small> {{ p.name }}</button></div>
      </section>
    </div>
    <span v-if="rangeCaption" class="service-range-caption"
      :style="{left:rangeCaption.x+'px', top:rangeCaption.y+'px', width:rangeCaptionSize.width+'px', height:rangeCaptionSize.height+'px'}">
      {{ rangeCaption.text }}
    </span>
    <div v-if="serviceCaptions.length" class="service-captions" aria-label="设施名称">
      <button v-for="item in serviceCaptions" :key="item.id" type="button" class="service-caption"
        :style="{left:item.x+'px',top:item.y+'px',width:item.width+'px'}"
        :title="item.name" :disabled="picking"
        @click="emit('select',item.id)" @wheel="wheelOnCourtMarker">
        {{ item.name }}
      </button>
    </div>
    <div v-if="flowMarkers.length" class="visitor-flows" :class="{picking}" aria-label="客源地流向">
      <svg class="visitor-flow-paths" aria-hidden="true">
        <defs>
          <marker id="visitor-flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="4" markerHeight="4" orient="auto">
            <path d="M 0 0 L 8 4 L 0 8 L 2 4 Z" fill="#72e0ff" />
          </marker>
        </defs>
        <g v-for="item in flowMarkers" :key="item.id" :class="{selected:item.id === selectedId}">
          <path :d="item.d" class="visitor-flow-halo" />
          <path :d="item.d" class="visitor-flow-line" :stroke-width="Math.min(3.5,1.35 + (item.share ?? 0) / 20)"
            marker-end="url(#visitor-flow-arrow)" />
          <path :d="item.d" pathLength="100" class="visitor-flow-pulse" />
          <circle class="visitor-flow-particle" r="2.1" fill="#ddfaff">
            <animateMotion :path="item.d" dur="3.2s" repeatCount="indefinite" />
          </circle>
        </g>
      </svg>
      <button v-for="item in flowMarkers" :key="item.id" type="button" class="visitor-flow-badge" :class="{selected:item.id === selectedId}"
        :style="{left:item.x + 'px',top:item.y + 'px',width:item.width + 'px'}" :aria-pressed="item.id === selectedId"
        :title="[item.name,item.share === null ? '' : item.share + '%',item.people === null ? '' : item.people + '人'].filter(Boolean).join(' · ')"
        :disabled="picking" @click="emit('select',item.id)" @wheel="wheelOnCourtMarker">
        <span>{{ item.name }}</span><strong v-if="item.share !== null">{{ item.share }}%</strong>
      </button>
    </div>
    <div v-if="promotionFlow && outboundFlow" :key="promotionFlow.id" class="promotion-flow" role="img"
      :class="{'fusion-flow': !!promotionFlow.fromKind}"
      :aria-label="[promotionFlow.fromLabel, promotionFlow.via?.label, promotionFlow.toLabel].filter(Boolean).join('至') + '，' + promotionFlow.qualifier"
      :style="{ '--promotion-color': promotionFlow.color }">
      <svg class="promotion-flow-graphic" aria-hidden="true">
        <defs>
          <marker id="promotion-flow-arrow" viewBox="0 0 11 8" refX="23" refY="4" markerWidth="11"
            markerHeight="8" orient="auto" markerUnits="userSpaceOnUse" overflow="visible">
            <path d="M0 0 11 4 0 8 2.6 4Z" />
          </marker>
        </defs>
        <path :d="outboundFlow.d" class="promotion-flow-halo" />
        <path :d="outboundFlow.d" class="promotion-flow-line" marker-end="url(#promotion-flow-arrow)" />
        <g v-for="delay in [0, -1.1, -2.2]" :key="delay" class="promotion-flow-traveler">
          <path class="promotion-flow-trail" d="M -26 0 H -7" />
          <path class="promotion-flow-chevron" d="M -7 -4.5 L 6 0 L -7 4.5 L -3.5 0 Z" />
          <animateMotion :path="outboundFlow.d" :begin="`${delay}s`" dur="3.3s"
            calcMode="linear" keyTimes="0;1" keyPoints="0.07;0.94" rotate="auto" repeatCount="indefinite" />
        </g>
        <g v-for="(endpoint,index) in outboundFlow.endpoints" :key="index">
          <template v-if="endpoint">
            <path :d="`M ${endpoint.point.x} ${endpoint.point.y} L ${endpoint.label.x} ${endpoint.label.y}`" class="promotion-flow-leader" />
            <circle class="promotion-flow-ring" :cx="endpoint.point.x" :cy="endpoint.point.y" :r="index === 0 ? 12 : 9" />
            <circle class="promotion-flow-node" :cx="endpoint.point.x" :cy="endpoint.point.y" :r="index === 0 ? 6 : 4.5" />
          </template>
        </g>
      </svg>
      <template v-for="(endpoint,index) in outboundFlow.endpoints" :key="index">
        <div v-if="endpoint" class="promotion-flow-label" aria-hidden="true"
          :class="{gateway:index === 0}"
          :style="{ left: endpoint.label.x + 'px', top: endpoint.label.y + 'px', width: endpoint.width + 'px' }">
          <small>{{ index === 0 ? promotionFlow.fromKind ?? '赛事引流起点' : promotionFlow.toKind ?? '推荐目的地' }}</small>
          <strong>{{ index === 0 ? promotionFlow.fromLabel : promotionFlow.toLabel }}</strong>
        </div>
      </template>
    </div>
    <div v-if="courtMarkers.length && !serviceRangeActive" class="court-markers" :class="{picking, surveyed: surveyedCourts, 'venue-detail':venueDetailActive}" aria-label="网球场地聚合">
      <template v-for="item in courtMarkers" :key="'leader:' + item.id">
        <span v-if="item.leader" class="court-marker-leader" aria-hidden="true"
          :style="{left:item.leader.x + 'px',top:item.leader.y + 'px',width:item.leader.length + 'px',transform:'rotate(' + item.leader.angle + 'rad)'}"></span>
      </template>
      <button v-for="item in courtMarkers" :key="item.id" type="button" class="court-marker"
        :class="item.kind" :data-scale="surveyedCourts ? (zoomLevel==='district' ? 'town' : 'village') : undefined" :data-count="item.count" :style="{left:item.x + 'px',top:item.y + 'px','--marker-size':item.diameter + 'px'}"
        :aria-label="item.detail + '，' + item.count + '片球场，' + (item.featureId ? '查看场地' : selectCourtFacility && item.kind === 'facility' ? '查看场馆并放大' : '点击放大')" :title="item.detail + ' · ' + item.count + '片'"
        :disabled="picking" @click="zoomToCourtMarker(item)" @wheel="wheelOnCourtMarker">
        <span class="court-marker-count">{{ item.count }}</span>
        <span v-if="item.label" class="court-marker-label" :class="item.label" aria-hidden="true">{{ item.detail }}</span>
      </button>
    </div>
    <div v-if="courtCaptions.length && !serviceRangeActive" class="service-captions" aria-label="网球场地名称">
      <button v-for="item in courtCaptions" :key="item.id" type="button" class="service-caption"
        :style="{left:item.x+'px',top:item.y+'px',width:item.width+'px'}" :disabled="picking"
        :title="item.name" @click="emit('select',item.id)" @wheel="wheelOnCourtMarker">{{ item.name }}</button>
    </div>
    <div v-if="hint || error" class="jt-map-hint" role="status">{{ error || hint }}</div>
    <div v-if="showScale && courtCount && !venueDetail" class="jt-map-scale" :aria-label="'当前球场显示级别：' + zoomLevel">
      {{ zoomLevel === 'district' ? '街镇聚合' : zoomLevel === 'facility' ? (surveyedCourts ? '村社聚合' : '场馆聚合') : '球场平面' }} · {{ courtCount }} 片
    </div>
    </div>
  </div>
</template>

<style scoped>
.jt-city-map, .jt-map-scene { position: absolute; inset: 0; overflow: hidden; background: #0d1d48; }
.map-chrome {
  position: absolute; overflow: hidden; pointer-events: none;
  --map-tag-fill: linear-gradient(110deg, rgb(14 60 131 / .84), rgb(26 44 87 / .76));
  --map-tag-rim: color-mix(in srgb, var(--v14-list-line) 75%, transparent);
  --map-tag-glint: rgb(155 240 255 / .25);
}
.reserve-markers { position:absolute; inset:0; pointer-events:none; }
.reserve-marker {
  position:absolute; transform:translate(-50%,-50%); display:grid; place-items:center;
  width:40px; height:40px; padding:0; background:none; border:0; border-radius:50%; pointer-events:auto;
  color:#fff; cursor:pointer; touch-action:manipulation; font:bold 15px/1 "Microsoft YaHei UI",sans-serif;
}
.reserve-marker span {
  display:grid; place-items:center; min-width:31px; height:31px; box-sizing:border-box; padding:0 3px;
  border:2px solid #e5d3ff; border-radius:50%; background:#613b9c; font-variant-numeric:tabular-nums;
}
.reserve-marker:is(:hover,:focus-visible) { z-index:1; }
.reserve-marker:is(:hover,:focus-visible) span { border-color:white; }
.reserve-marker:disabled { pointer-events:none; }
.map-chrome.service-labels-light {
  --map-tag-fill: linear-gradient(110deg, rgb(246 252 255 / .91), rgb(215 237 255 / .83));
  --map-tag-rim: rgb(54 122 199 / .70);
  --map-tag-glint: rgb(255 255 255 / .74);
}
.service-captions { position: absolute; inset: 0; pointer-events: none; }
.service-range-caption {
  position:absolute; display:grid; place-items:center; box-sizing:border-box; pointer-events:none;
  white-space:nowrap; font-size:14px; line-height:20px;
}
.facility-group-list {
  color:var(--v14-ink); border:1px solid var(--v14-list-line); border-radius:2px;
  background:linear-gradient(var(--v14-overlay),var(--v14-overlay)),var(--v14-tab);
  font-family:var(--v14-font); pointer-events:auto; box-shadow:0 1px 4px #061b3938;
}
.facility-markers { z-index:1; }
.facility-markers button:is(:hover,:focus-visible) { z-index:2; }
.facility-location[data-selected], .facility-location[aria-pressed="true"] { z-index:1; }
.facility-location[aria-pressed="true"] > svg { filter:drop-shadow(0 0 2px #9bf0ff) drop-shadow(0 1px 2px #091e40); }
.facility-location[aria-pressed="true"] :deep(.pin-outline) { stroke:#b2f3ff; stroke-width:2.5; }
.facility-location {
  position:absolute; transform:translate(-50%,-50%); width:var(--marker-size); height:var(--marker-size);
  display:grid; place-items:center; pointer-events:auto; padding:0; border:0; background:transparent; cursor:pointer;
}
.facility-location > svg { width:100%;height:100%;filter:drop-shadow(0 1px 2px #091e40a0); }
.facility-location[data-circle-center] > svg {
  overflow:visible;
  filter:drop-shadow(0 1px 2px #10284d) drop-shadow(0 0 3px rgb(155 240 255 / .55));
}
@media (prefers-reduced-motion: no-preference) {
  .facility-location[data-circle-center] :deep(.range-anchor-wave) {
    transform-box:fill-box; transform-origin:center; animation:range-center-arrival 1.6s ease-out 2;
  }
}
@keyframes range-center-arrival {
  from { transform:scale(.64); opacity:.45; }
  to { transform:scale(1); opacity:1; }
}
.facility-location:not(:disabled) .court-marker-label { pointer-events:auto; cursor:pointer; }
.facility-location:disabled { pointer-events:none; }
.facility-location:focus-visible { outline:2px solid var(--v14-icon); }
.facility-location .pin-count { position:absolute;right:-3px;top:-3px;border-radius:8px;padding:0 3px;background:#164387;color:#fff;font:600 12px/16px var(--v14-font); }
.facility-markers.surveyed .facility-location .court-marker-label,
.map-chrome .court-markers.surveyed.venue-detail .court-marker .court-marker-label,
.map-chrome .service-range-caption,
.map-chrome .service-captions button.service-caption {
  color:var(--v14-ink); background:var(--map-tag-fill);
  border:1px solid var(--map-tag-rim); border-radius:3px;
  box-shadow:inset 0 1px var(--map-tag-glint), 0 1px 3px rgb(11 32 66 / .24);
  backdrop-filter:blur(3px); font-family:var(--v14-font); font-weight:600;
}
.facility-markers.surveyed .facility-location[aria-pressed="true"] .court-marker-label {
  border-color:var(--v14-icon); box-shadow:inset 2px 0 var(--v14-icon), 0 1px 3px rgb(11 32 66 / .24);
}
.facility-markers.surveyed .facility-location[data-circle-center] .court-marker-label {
  max-width:var(--center-label-max-width); border-color:#ffbd42;
}
.range-center-key {
  display:inline-block; width:32px; margin-right:4px; vertical-align:top;
  border-radius:2px; background:linear-gradient(110deg,#ffe3a0,#ffbd42);
  color:#15345d; text-align:center; font:700 12px/18px var(--v14-font);
}
.facility-group-list small { color:var(--v14-muted); font:400 14px/22px var(--v14-font); }
.facility-group-list { position:absolute; z-index:2; top:25%; left:50%; transform:translateX(-50%); width:min(280px,calc(100% - 16px)); }
.facility-group-list header,.facility-group-list div>button { display:flex; align-items:center; gap:8px; padding:4px 10px; }
.facility-group-list header { justify-content:space-between; border-bottom:1px solid var(--v14-edge); }
.facility-group-list button { color:inherit; border:0; background:transparent; font:inherit; cursor:pointer; }
.facility-group-list div { max-height:180px; overflow:auto; }
.facility-group-list div>button { width:100%; text-align:left; }
.facility-group-list small { flex:none; }
.service-caption {
  position: absolute; transform: translate(-50%, -50%); pointer-events: auto; cursor: pointer;
  height: 28px; box-sizing: border-box; padding: 0 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border: 1px solid; border-radius: 2px;
  box-shadow: 0 1px 2px #12283e40; font: 700 18px/26px var(--v14-font,"Microsoft YaHei UI",sans-serif);
}
.service-caption:disabled { pointer-events: none; }
.service-caption:focus-visible { outline: 2px solid var(--v14-icon); }
.visitor-flows, .visitor-flow-paths { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.visitor-flow-paths path:not(defs path) { fill: none; }
.visitor-flow-halo { stroke: #40cfff; stroke-width: 7; opacity: .18; }
.visitor-flow-line { stroke: #70ddff; opacity: .78; }
.visitor-flow-pulse {
  stroke: #e2faff;
  stroke-width: 3.3;
  stroke-linecap: round;
  stroke-dasharray: 5 95;
  animation: visitor-flow 3.2s linear infinite;
}
.visitor-flow-paths .selected .visitor-flow-line { stroke: #ffe289; opacity: 1; }
.visitor-flow-paths .selected .visitor-flow-halo { stroke: #ffd45c; opacity: .32; }
@keyframes visitor-flow { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -100; } }
.visitor-flow-badge {
  position: absolute;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  min-height: 27px;
  padding: 3px 6px;
  border: 1px solid #53bde8;
  border-radius: 3px;
  background: #102b57f5;
  color: #eefaff;
  font: 700 12px/16px "Microsoft YaHei UI", sans-serif;
  pointer-events: auto;
}
.visitor-flow-badge span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.visitor-flow-badge strong { color: #8deaff; font-variant-numeric: tabular-nums; }
.visitor-flow-badge.selected, .visitor-flow-badge:hover, .visitor-flow-badge:focus-visible { border-color: #ffe289; }
.visitor-flows.picking .visitor-flow-badge { pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
  .visitor-flow-pulse, .visitor-flow-particle, .promotion-flow-traveler { display: none; }
}
.promotion-flow, .promotion-flow-graphic { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.promotion-flow { z-index: 1; }
.promotion-flow-graphic > path, .promotion-flow-leader { fill: none; }
.promotion-flow-graphic marker path, .promotion-flow-node { fill: var(--promotion-color); }
.promotion-flow-halo { stroke: var(--promotion-color); stroke-width: 15; opacity: .16; }
.promotion-flow-line { stroke: var(--promotion-color); stroke-width: 3.8; }
.promotion-flow-trail { fill: none; stroke: #ecffff; stroke-width: 2.2; stroke-linecap: round; opacity: .78; }
.promotion-flow-chevron {
  fill: #fff; stroke: #14344b; stroke-width: 1.4; stroke-linejoin: round;
  filter: drop-shadow(0 0 3px var(--promotion-color));
}
.promotion-flow-leader { stroke: var(--promotion-color); stroke-width: 1.1; opacity: .82; }
.promotion-flow-ring { fill: #071b36; fill-opacity: .88; stroke: var(--promotion-color); stroke-width: 1.8; }
.promotion-flow-node { stroke: #f7ffff; stroke-width: 1.5; }
.promotion-flow-label {
  position: absolute; display: grid; gap: 2px; transform: translate(-50%, -50%);
  box-sizing: border-box; padding: 4px 8px 5px; border: 1px solid var(--promotion-color); border-radius: 4px;
  color: #f6fbff; background: #0a2144f5; box-shadow: 0 2px 8px #05142cca;
  font: 700 13px/16px "Microsoft YaHei UI", sans-serif;
}
.promotion-flow-label small { color: var(--promotion-color); font: 600 10px/12px "Microsoft YaHei UI", sans-serif; }
.promotion-flow-label strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fusion-flow .promotion-flow-label { font-size: 16px; line-height: 20px; }
.fusion-flow .promotion-flow-label small { font-size: 16px; line-height: 20px; }
.fusion-flow .promotion-flow-label strong { white-space: normal; overflow: visible; overflow-wrap: anywhere; }
.promotion-flow-label.gateway { border-left-width: 3px; }
.court-markers { position: absolute; inset: 0; pointer-events: none; }
.court-marker-leader { position: absolute; height: 1px; background: #79d5ff9e; transform-origin: left center; }
.court-marker {
  position: absolute;
  display: grid;
  place-items: center;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  width: var(--marker-size);
  height: var(--marker-size);
  padding: 0;
  border: 1px solid #79d5ff;
  border-radius: 50%;
  color: #f3faff;
  background: #14538ce8;
  box-shadow: 0 0 0 2px #42bafa38, 0 1px 5px #07152f;
  font: 700 11px/1 "Microsoft YaHei UI", sans-serif;
  touch-action: none;
}
.court-markers.picking .court-marker { pointer-events: none; }
.court-markers.surveyed .court-marker:not(:disabled) .court-marker-label { pointer-events: auto; cursor:pointer; }
.court-marker.facility { border-color: #ffe391; background: #594414ee; box-shadow: 0 0 0 2px #ffca5435, 0 1px 5px #07152f; }
.court-marker.cluster { border-color: #ffe391; background: #9b6018ed; box-shadow: 0 0 0 2px #ffca5450, 0 1px 5px #07152f; }
.court-marker:hover, .court-marker:focus-visible { z-index: 1; border-color: #fff; box-shadow: 0 0 0 2px #d6efffa0; }
.court-marker-count { font-variant-numeric: tabular-nums; }
.court-marker-label {
  position: absolute;
  pointer-events: none;
  display: block;
  width: max-content;
  max-width: var(--map-label-max-width, 164px);
  height: 22px;
  box-sizing: border-box;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 3px 5px;
  border: 1px solid #5ba6d273;
  border-radius: 3px;
  background: #0a2249eb;
  color: #eef8ff;
  font: 600 12px/14px "Microsoft YaHei UI", sans-serif;
}
.court-marker-label.above { bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%); }
.court-marker-label.below { top: calc(100% + 4px); left: 50%; transform: translateX(-50%); }
.court-marker-label.right { left: calc(100% + 4px); top: 50%; transform: translateY(-50%); }
.court-marker-label.left { right: calc(100% + 4px); top: 50%; transform: translateY(-50%); }
.jt-map-hint, .jt-map-scale { position: absolute; color: #eaf7ff; pointer-events: none; background: #0b2457e8; border: 1px solid #4599d2; }
.jt-map-hint { top: 13%; left: 50%; transform: translateX(-50%); padding: 7px 12px; font-size: 13px; }
.jt-map-scale { left: 10px; bottom: 24px; padding: 3px 7px; font-size: 11px; }
.jt-city-map-overview .jt-map-hint, .court-markers.surveyed :is(.court-marker, .court-marker-label) { font-size: 16px; }
.jt-event-map :is(.jt-map-hint,.jt-map-scale) {font-size:16px;line-height:24px}
.court-markers.surveyed .court-marker-label { height: 26px; line-height: 18px; }
.court-markers.surveyed .court-marker.district {
  color: #f7fdff;
  border-color: #a9efff;
  background: #126797ec;
}
.court-markers.surveyed .court-marker.district .court-marker-label {
  color: #f9fcff;
  border-color: #8dceff;
  background: linear-gradient(180deg, #287f9bf5, #146281f5);
  box-shadow: inset 0 0 5px #8edcff8c, 0 0 5px #17a8db8f;
}
.jt-city-map-light, .jt-city-map-light .jt-map-scene { background: #527f99; }
.jt-city-map-light .jt-map-hint,
.jt-city-map-light .jt-map-scale,
.jt-city-map-light .visitor-flow-badge,
.jt-city-map-light .court-marker-label {
  color: #15375e;
  background: #f8fbfff5;
  border-color: #6e9fc9;
}
.jt-city-map-light .visitor-flow-badge strong { color: #176cb9; }
.jt-city-map-light .visitor-flow-badge.selected,
.jt-city-map-light .visitor-flow-badge:hover,
.jt-city-map-light .visitor-flow-badge:focus-visible { border-color: #9c6808; }
.jt-city-map-light .court-marker {
  color: #fff;
  background: #1d73c9;
  border-color: #fff;
  box-shadow: 0 0 0 2px #0e5eaf75, 0 1px 5px #123f6d55;
}
.jt-city-map-light .court-marker.facility,
.jt-city-map-light .court-marker.cluster {
  color: #412d05;
  background: #ffcb62;
  box-shadow: 0 0 0 2px #956b25a0, 0 1px 5px #6c491e55;
}
.jt-city-map-light .promotion-flow-label { color: #12355b; background: #f7fbfff5; box-shadow: 0 2px 8px #254b6b45; }
.jt-city-map-light .promotion-flow-label small { color: #20577d; }
.map-chrome .fusion-flow .promotion-flow-label {
  background: var(--map-tag-fill);
  color: var(--v14-ink);
  box-shadow: inset 0 1px var(--map-tag-glint), 0 1px 4px rgb(11 32 66 / .3);
}
.map-chrome .fusion-flow .promotion-flow-label small { color: var(--v14-ink); font-weight: 400; }
</style>
