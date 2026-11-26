<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, provide, ref, shallowRef, watch } from 'vue'
import DashboardPanel, { type Entry, type Metric, type Section } from './DashboardPanel.vue'
import OverviewReferenceRails from './OverviewReferenceRails.vue'
import { courtFootprintDetails } from './overview-court-inventory.ts'
import { estimatedPeople, groupCoverageGrids, measureCourtCoverage, populationAroundPoint, populationViews, preparePopulationGrid, type PopulationView } from './overview-court-coverage.ts'
import { boundaryExtent, locateCourtAreas } from './court-markers.ts'
import { createFacilityBoundaryIndex, districtCenter } from './facility-boundaries.ts'
import { venueOwnershipGroup } from './venue-ownership.ts'
import OverviewAnalysisRail from './OverviewAnalysisRail.vue'
import PopulationGridLegend from './PopulationGridLegend.vue'
import FacilityLocationPin from './FacilityLocationPin.vue'
import { populationGridId, legacyPopulationGridId, populationBands } from './population-grid.ts'
import { populationRaster, populationDemandRows, populationRecordCount, rasterCellById, type RasterSelection } from './population-raster'
import { populationDisplayGrid, populationMapFeature } from './population-display-grid'
import { rasterCourtCoverage, rasterGroups, rasterRadiusPopulation, viewBits, blockVisible } from './population-raster-coverage'
import IndustryPanorama from './IndustryPanorama.vue'
import SceneAssistant from './SceneAssistant.vue'
import { provideSceneAssistant } from './scene-assistant-context'
import { readPublishedMap, readDeferredPopulation } from './published-courts'
import { activeCourtSourceId, boundCourtSource, courtMapSlot, ledgerDetails } from './court-ledger'
import MapLayerDirectory from './MapLayerDirectory.vue'
import { eventCatalogMapKey, mapDirectoryKey } from './map-layer-directory'
import { readServiceAttributes } from './map-service-attributes'
import { isCimBasemap, isFeatureService, type CimService } from './cim-types'
import { acceptsMapService, resolveMapBindings } from './map-bindings'
import type { CimPick, CimMapStatus } from './cim-map'
import { groups, pages, pageFromLocation, panoramaRegisterLayers, sceneAllowsLayer, type V3Page } from './v3-navigation.ts'
import { postEventReview, v3Panels, type V3PanelContext, type V3PanelPage } from './v3-panels.ts'
import { calendar, circle, coverage, distanceM, eventAssistance, industry, inPolygon, normalizeRules, siteSelection, surveyedCourtsInRange, talent, tourism } from './analytics.ts'
import { api, downloadFile, jsonRequest } from './api.ts'
import { roadControlPosition, roadControlStyles } from './road-controls.ts'
import type { FusionMapView } from './fusion-itinerary'
import { withLocalTourismSites } from './tourism-register'
import { venueCapacity, walkingVenueDirectory, type VenuePriorityArea } from './venue-capacity.ts'
import { facilityKinds, facilitySiteKey, supportLayerIds } from './venue-support.ts'
import { acceptsPendingLocation } from './validate.ts'
import { useServicePage } from './service-pagination'
import ServicePager from './ServicePager.vue'
import { useOpeningSchedules } from './use-opening-schedules'
import { openingGapAreas, openingPopulation } from './opening-population'
import { diagnoseGaps, type Period } from './service-gaps'
import { chinaClock } from './opening-schedule'
import { dashboardPalette } from './dashboard-palette.ts'
import { controlLayers, controlService, controlServiceId, eligibleReserve, groupReserveParcels, matchesReserve, reserveColor, reserveDrillView, reserveLayerId, reserveMapFeature, reserveScaleAt, screenedParcel, surveyReferenceLayerId } from './investment-planning'
import { isCityWhiteModel, sceneLegend, sceneSymbol, type SceneMap } from './scene-map'
import { alignSampleTennisCenter, venueModelForFocus, venueModelTile, type VenueModelFocus } from './service-model-location'
import { chainMapFeature, commerceChainTopics, type Enterprise } from './industry-panorama'
import { ledgerTemplate } from './industry-ledgers.ts'
import { featureCenter, type CityFeature, type Dataset, type Coordinate, type MapAction, type MapCamera, type MapCommand, type PublishedData, type Result, type Scene } from './types.ts'

const CityMap = defineAsyncComponent(() => import('./CityMap.vue'))
const FusionDashboard = defineAsyncComponent(() => import('./FusionDashboard.vue'))
const V3Operations = defineAsyncComponent(() => import('./V3Operations.vue'))
const loadIndustryServices = () => import('./IndustryServices.vue')
const IndustryServices = defineAsyncComponent(loadIndustryServices)
const SpatialAttributeTable=defineAsyncComponent(()=>import('./SpatialAttributeTable.vue'))
const IndustryInvestment = defineAsyncComponent(() => import('./IndustryInvestment.vue'))
const EventPreassessment = defineAsyncComponent(() => import('./EventPreassessment.vue'))
const EventLiveCoordination = defineAsyncComponent(() => import('./EventLiveCoordination.vue'))
const EventPostReview = defineAsyncComponent(() => import('./EventPostReview.vue'))
const eventPreassessmentRef = ref<{ overview: () => void }>()
const initialQuery = new URLSearchParams(location.search)
const initialPage = pageFromLocation(initialQuery.get('scene'))
const publicView = initialQuery.get('app') === 'jingwangtong'
const requestedTheme = initialQuery.get('theme')
function readCockpitTheme() {
  if (requestedTheme === 'classic' || requestedTheme === 'light') return requestedTheme
  try { return localStorage.getItem('jingshan-cockpit-theme') === 'classic' ? 'classic' : 'light' }
  catch { return 'light' }
}
const cockpitTheme = ref(readCockpitTheme())
const { launcherVisible: assistantVisible, setLauncherVisible: setAssistantVisible } = provideSceneAssistant()
const isLight = computed(() => cockpitTheme.value === 'light')
function toggleCockpitTheme() {
  cockpitTheme.value = isLight.value ? 'classic' : 'light'
  try { localStorage.setItem('jingshan-cockpit-theme', cockpitTheme.value) } catch { /* Storage may be disabled. */ }
  const url = new URL(location.href)
  if (url.searchParams.has('theme')) {
    url.searchParams.set('theme',cockpitTheme.value)
    history.replaceState(null,'',url)
  }
}
const scene = ref<Scene>(initialPage === 'site' ? 'venues' : initialPage)
const page = computed<V3Page>(() => scene.value === 'venues' && venueTab.value === 'site' ? 'site' : scene.value === 'talent' ? 'overview' : scene.value)
const isOverview = computed(() => page.value === 'overview')
const eventPage = computed(() => group.value.id === 'events' ? page.value : undefined)
const investmentScene=computed(()=>page.value==='investment' || page.value==='site')
const fusionScene = computed(() => page.value === 'consumption' || page.value === 'merchants')
const fusionMap = shallowRef<FusionMapView>()
const fusionPick = ref('')
const thematicScene = computed(() => page.value === 'venues' || page.value === 'investment' || page.value === 'site')
const sceneMap = shallowRef<SceneMap>()
const siteLayers=computed(()=>investmentScene.value && (sceneMap.value?.investmentPane==='reserve' || sceneMap.value?.investmentPane==='records'))
const populationOverview = computed(() => page.value === 'venues' && sceneMap.value?.populationOverview === true)
const openingMap = computed(() => page.value === 'venues' && sceneMap.value?.populationMode === 'opening')
const openingGapMap = computed(() => openingMap.value && sceneMap.value?.servicePane!=='tasks')
const sharedPopulationMap = computed(() => populationOverview.value || openingMap.value || sceneMap.value?.populationMode === 'investment')
const populationView = ref<PopulationView>('all')
const populationRadiusM = ref(1000)
const venueDetailOnMap = computed(() => page.value==='venues' && sceneMap.value?.venueDetail===true)
const venueMapContext = computed(() => venueDetailOnMap.value || populationOverview.value)
const serviceResourceDetail = computed(() => venueDetailOnMap.value || (page.value==='venues' && sceneMap.value?.facilityView==='detail'))
const keepServiceCamera = ref(false)
const countyMapView = computed(() => isOverview.value || page.value === 'industry' || (fusionScene.value && !fusionMap.value?.regional) ||
  (thematicScene.value && (sceneMap.value?.focus ?? 'county') === 'county'))
const sceneFeatures = computed(() => sceneMap.value?.features ?? [])
const thematicLegend = computed(() => sceneLegend(sceneFeatures.value))
const hiddenSceneSymbols = ref<string[]>([])
const visibleSceneFeatures = computed(() => sceneFeatures.value.filter(f =>
  !hiddenSceneSymbols.value.includes(sceneSymbol(f)?.label ?? '') &&
  (!investmentScene.value || f.properties.kind!=='investment-reserve' || (siteLayers.value && layerEnabled(reserveLayerId))) &&
  (serviceResourceDetail.value || !serviceReplaces('dataset:' + String(f.properties.datasetId ?? '')))))
function toggleSceneSymbol(label: string) {
  hiddenSceneSymbols.value = hiddenSceneSymbols.value.includes(label)
    ? hiddenSceneSymbols.value.filter(value => value !== label) : [...hiddenSceneSymbols.value, label]
}
const localModelOverrides = ref<Record<string, boolean>>({})
const modelPlanView = ref(false)
const focusedVenueModel = computed(() => venueModelForFocus(sceneMap.value?.venueModelFocus,scopedCimCatalog.value))
const mapModelsOn = computed(() => thematicScene.value && !!focusedVenueModel.value && !modelPlanView.value)
const industryDiagnosis = ref(false)
const group = computed(() => groups.find(item => (item.pages as readonly V3Page[]).includes(page.value)) ?? groups[0])
const industryPanel = computed(() => group.value.id !== 'industry' ? undefined
  : page.value === 'industry' ? IndustryPanorama
    : page.value === 'venues' ? IndustryServices : IndustryInvestment)
const sceneTabs = computed(() => group.value.pages.filter(step => step !== 'site'))
const activeSceneTab = computed(() => page.value === 'site' ? 'investment' : page.value)
const meta = computed(() => pages[page.value])
type OperationsPanel = 'merchants'|'routes'|'coupons'|'app'|'investment'|'atlas'|'review'|'eventCompare'|'travel'|'urge'
const operations = shallowRef<{ panel:OperationsPanel; id?:string; tab?:string }>()
const resourceFilter = ref<'all'|'courts'|'subjects'|'projects'|'support'>('all')
const panoramaPoints = shallowRef(new Map<string,CityFeature>())
const panoramaTarget = shallowRef<Enterprise>()
const period = ref<'month'|'quarter'|'year'|'event'>('month')
const wallDate = new Date()
const data = shallowRef<PublishedData>()
const investmentNeedsGrid=ref(false)
const readScenePublication=()=>readPublishedMap(investmentScene.value || fusionScene.value || !!eventPage.value)
const results = shallowRef<Result[]>([])
const resultLayer = ref(false)
const replayResultId = ref<number>()
const resultModal = ref(false)
const busy = ref(false)
const loading = ref(true)
const loadError = ref('')
const cimServices = shallowRef<CimService[]>([])
const cimCatalogReady = ref(publicView)
const cimError = ref('')
const cimOverrides = ref<Record<string, boolean>>({})
const eventServiceOverrides = ref<Record<string, boolean>>({})
const eventVenueFocus=shallowRef<VenueModelFocus>()
const eventResultsVisible = ref(false)
const eventDirectoryCommand = shallowRef<MapCommand | null>(null)
const cimStates = ref<Record<string, CimMapStatus>>({})
const cimFeature = shallowRef<CimPick>()
const mapBindings = computed(() => resolveMapBindings(data.value?.data.mapBindings,page.value))
const boundServices = computed(() => {
  const result = new Map<string,CimService>()
  for (const [slot,id] of mapBindings.value) {
    const service = cimServices.value.find(row => row.id === id)
    if (service && acceptsMapService(slot,service)) result.set(slot,service)
  }
  return result
})
const overriddenSources = computed(() => {
  const suppressed = new Set<string>()
  for (const item of data.value?.data.mapBindings ?? []) {
    if (item.scope === 'all' && item.serviceId && mapBindings.value.get(item.slot) !== item.serviceId) suppressed.add(item.serviceId)
  }
  for (const dataset of data.value?.data.datasets ?? []) {
    const slot = 'dataset:' + dataset.id
    if (dataset.source && mapBindings.value.has(slot) && mapBindings.value.get(slot) !== dataset.source.serviceId) {
      suppressed.add(dataset.source.serviceId)
    }
  }
  return suppressed
})
const scopedCimCatalog = computed(() => {
  const base = boundServices.value.get('basemap')
  const model = boundServices.value.get('model')
  const excluded = new Set<string>()
  const shared = new Set<string>()
  if (eventPage.value) {
    return cimServices.value.filter(item => item.enabled && !controlService(item.id) &&
      (!item.hostedDatasetId || sceneAllowsLayer(page.value,item.hostedDatasetId) && !data.value?.deferredPopulation?.includes(item.hostedDatasetId)))
      .map(item => item.id === base?.id ? {...item,mapRole:'basemap' as const} : item)
  }
  if ((investmentScene.value || sharedPopulationMap.value) && densityDataset.value) {
    // The active grid supplies both population totals and the filtered map surface.
    const binding = mapBindings.value.get('dataset:' + densityLayerId.value)
    const source = densityDataset.value.source?.serviceId
    if (binding) excluded.add(binding)
    if (source) excluded.add(source)
    excluded.add('hosted-'+densityDataset.value.id)
  }
  if (isOverview.value) {
    for (const [slot, serviceId] of mapBindings.value) {
      if (!serviceId) continue
      const allowed = !slot.startsWith('dataset:') || sceneAllowsLayer(page.value, slot.slice(8))
      const ids = allowed ? shared : excluded
      ids.add(serviceId)
    }
    for (const dataset of data.value?.data.datasets ?? []) {
      if (!dataset.source) continue
      const ids = sceneAllowsLayer(page.value, dataset.id) ? shared : excluded
      ids.add(dataset.source.serviceId)
    }
  }
  return cimServices.value.filter(item => (siteLayers.value || (!controlService(item.id) && (!investmentScene.value || item.id!=='hosted-'+reserveLayerId))) && (!excluded.has(item.id) || shared.has(item.id)) &&
    (!thematicScene.value || !isCityWhiteModel(item) || item.id === model?.id))
    .map(item => item.id === base?.id ? {...item,mapRole:'basemap' as const} : item)
})
const managedCourtService=computed(()=>{
  const id=mapBindings.value.get(courtMapSlot)
  return data.value && id==='hosted-'+activeCourtSourceId(data.value.data) ? id : undefined
})
const eventVenueModel=computed(()=>venueModelForFocus(eventVenueFocus.value,scopedCimCatalog.value))
const visibleCim = computed(() => {
  const baseId = boundServices.value.get('basemap')?.id
  const modelId = boundServices.value.get('model')?.id
  const mappedOverlays = new Map<string,boolean>()
  for (const [slot,service] of boundServices.value) {
    if (slot === 'model' || slot === 'basemap') continue
    const layer = slot.startsWith('dataset:') ? slot.slice(8) : slot
    mappedOverlays.set(service.id, Boolean(mappedOverlays.get(service.id)) || layerEnabled(layer))
  }
  if (eventPage.value) {
    const services=scopedCimCatalog.value
    const basemaps=services.filter(isCimBasemap)
    const preferred=basemaps.find(item=>item.id===baseId) ?? basemaps.find(item=>item.defaultVisible) ?? basemaps[0]
    const enabled = eventServiceOverrides.value
    return services.filter(item => isCimBasemap(item) ? (enabled[item.id] ?? item===preferred)
      : enabled[item.id] ?? mappedOverlays.get(item.id) ?? (item.id===eventVenueModel.value?.id))
  }
  const selected = scopedCimCatalog.value.filter(item => {
    if (!item.enabled || item.id===managedCourtService.value || (investmentScene.value && item.id==='hosted-'+reserveLayerId)) return false
    if(controlService(item.id))return siteLayers.value && (cimOverrides.value[item.id] ?? true)
    if(thematicScene.value && item.kind==='3dtiles' && sceneMap.value?.venueModelFocus){
      return item.id===focusedVenueModel.value?.id ? mapModelsOn.value : localModelOverrides.value[item.id]===true
    }
    if (serviceResourceDetail.value && !isCimBasemap(item) && !['cim-05','cim-06','cim-07'].includes(item.id)) {
      return false
    }
    if (isCimBasemap(item) && mapBindings.value.has('basemap')) {
      return cimOverrides.value[item.id] ?? (item.id === baseId)
    }
    if (item.kind === '3dtiles' && mapBindings.value.has('model')) {
      return cimOverrides.value[item.id] ?? (item.id === modelId && !modelPlanView.value)
    }
    if (mappedOverlays.has(item.id)) return mappedOverlays.get(item.id)
    if (overriddenSources.value.has(item.id)) return cimOverrides.value[item.id] ?? false
    return cimOverrides.value[item.id] ?? item.defaultVisible
  })
  const base = selected.find(item => item.id === baseId) ?? selected.find(item => item.id === 'jingmen-2026-05m') ?? selected.find(isCimBasemap)
  return selected.filter(item => !isCimBasemap(item) || item === base)
})
function serviceReplaces(slot:string) {
  const service = boundServices.value.get(slot)
  if (!service || (!eventPage.value && slot===courtMapSlot && managedCourtService.value) || (investmentScene.value && slot==='dataset:'+reserveLayerId && service.id==='hosted-'+reserveLayerId)) return false
  const layer = slot.startsWith('dataset:') ? slot.slice(8) : slot
  return !layerEnabled(layer) || (visibleCimIds.value.includes(service.id) && cimStates.value[service.id]?.state === 'ready')
}
const visibleCimIds = computed(() => [...visibleCim.value.map(item => item.id),...(!eventPage.value && managedCourtService.value && layerEnabled('court_footprints') ? [managedCourtService.value] : []),...(siteLayers.value && layerEnabled(reserveLayerId) ? ['hosted-'+reserveLayerId] : [])])
const modelNotice = computed(() => {
  if (!mapModelsOn.value) return ''
  const state = cimStates.value[focusedVenueModel.value!.id]
  if (state?.state==='error') return '场馆模型加载失败，可在地图图层中重试'
  return state?.hasTileContent ? '' : '正在加载场馆三维模型…'
})
const renderedCimSources = computed(() => new Set(visibleCim.value
  .filter(item => cimStates.value[item.id]?.state === 'ready').map(item => item.id)))
let catalogRequest = 0
async function refreshCim() {
  const request = ++catalogRequest
  try {
    const { services } = await api<{services: CimService[]}>('/cim/services')
    if (request !== catalogRequest) return
    const previous = new Map(cimServices.value.map(item => [item.id, item]))
    cimOverrides.value = Object.fromEntries(Object.entries(cimOverrides.value).filter(([id]) =>
      services.some(item => item.id === id && item.defaultVisible === previous.get(id)?.defaultVisible)))
    cimServices.value = services
    cimError.value = ''
  } catch (error) {
    if (request === catalogRequest) cimError.value = error instanceof Error ? error.message : '图层目录读取失败'
  } finally {
    if (request === catalogRequest) cimCatalogReady.value = true
  }
}
function toggleCim(id: string) {
  if(!eventPage.value && id===managedCourtService.value){void toggleLayer('court_footprints');return}
  if(investmentScene.value && id==='hosted-'+reserveLayerId){void toggleLayer(reserveLayerId);return}
  const enabled = !visibleCimIds.value.includes(id)
  const overrides=eventPage.value ? eventServiceOverrides.value : cimOverrides.value
  if(investmentScene.value && controlService(id)){
    cimOverrides.value[id]=enabled
    return
  }
  if (enabled && scopedCimCatalog.value.some(item => item.id === id && isCimBasemap(item))) {
    for (const item of scopedCimCatalog.value.filter(isCimBasemap)) overrides[item.id] = item.id === id
  }
  for (const [slot,service] of boundServices.value) {
    if (service.id === id && slot !== 'basemap' && slot !== 'model') {
      layerState.value[slot.startsWith('dataset:') ? slot.slice(8) : slot] = enabled
    }
  }
  if(thematicScene.value && sceneMap.value?.venueModelFocus && cimServices.value.some(s=>s.id===id && s.kind==='3dtiles')){
    if(id===focusedVenueModel.value?.id)modelPlanView.value=!enabled
    else localModelOverrides.value[id]=enabled
  } else overrides[id] = enabled
  if (enabled) {
    setDirectoryCommand({ action:'focus-layer', layerId:id, serial:++serial })
  } else if (command.value?.action === 'focus-layer' && command.value.layerId === id) {
    setDirectoryCommand({ action:'cancel-layer-focus', layerId:id, serial:++serial })
  }
  if (cimFeature.value?.serviceId === id) cimFeature.value = undefined
}
function onCimPick(feature: CimPick) {
  if(attributeSource.value?.service?.id===feature.serviceId && feature.featureId && attributeDataset.value){
    const id=feature.featureId, rows=attributeDataset.value.features
    const row=rows.find(f=>f.id===id)??rows.find(f=>f.id===id.replace(/_\d+$/,''))
    if(row){attributePick.value={id:row.id,serial:(attributePick.value?.serial??0)+1};return}
  }
  if (mapModelsOn.value && focusedVenueModel.value?.id===feature.serviceId) {
    const venue = sceneMap.value?.features.find(f => f.properties.mapRole === 'venue' && f.properties.selected===true)
    if (venue) { selectMapFeature(venue.id); return }
  }
  selectedId.value = null
  cimFeature.value = feature
  detailOpen.value = true
  mapPopup.value = null
}
function announceDataChange(key: 'catalog' | 'publication' | 'results') {
  try { localStorage.setItem('jingshan-' + key + '-changed', String(Date.now())) } catch { /* Storage is optional. */ }
}
async function refreshResults() {
  results.value = await api<Result[]>(investmentScene.value ? '/results?investmentPoints=1' : '/results')
}
async function refreshEventResults(openLedger=false) {
  try {
    await refreshResults()
    if (openLedger) resultModal.value=true
  } catch { showToast('成果台账读取失败，请刷新后重试') }
}
function onSharedChange(event: StorageEvent) {
  if (event.key === 'jingshan-catalog-changed') void refreshCim()
  if (event.key === 'jingshan-publication-changed') {
    void readScenePublication().then(updatePublishedView).catch(() => showToast('数据更新读取失败，请刷新页面重试'))
  }
  if (event.key === 'jingshan-results-changed') {
    void refreshEventResults()
  }
}
const leftPanelOpen = ref(true)
const sharedRightOpen = ref(true)
const serviceRightOpen = ref(window.matchMedia('(min-width: 961px)').matches)
const investmentRightOpen = ref(window.matchMedia('(min-width: 961px)').matches)
const serviceMapPick = shallowRef<{feature:CityFeature}>()
const highlightedServiceVenue = ref<string>()
const rightPanelOpen = computed({
  get: () => page.value === 'venues' ? serviceRightOpen.value : thematicScene.value ? investmentRightOpen.value : sharedRightOpen.value,
  set: (value:boolean) => {
    if (page.value === 'venues') serviceRightOpen.value = value
    else if (thematicScene.value) investmentRightOpen.value = value
    else sharedRightOpen.value = value
  },
})
const mapOnly = computed(() => !leftPanelOpen.value && !rightPanelOpen.value)
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | undefined
const region = ref('京山市')
const community = ref('')
const regionOpen = ref(false)
const regionQuery = ref('')
const communityLimit = ref(30)
watch([regionQuery, region], () => { communityLimit.value = 30 })
const homeRegionControl = ref<HTMLElement>()
const homeRegionTrigger = ref<HTMLButtonElement>()
const mapPopup = ref<'layers'|'legend'|'tools'|null>(null)
watch(mapPopup, popup=>{ if(popup==='layers'&&!publicView) void refreshCim() })
const homeSearchOpen = ref(false)
const homeSearch = ref('')
const homeSearchBox = ref<HTMLInputElement>()
const homeMenuOpen = ref(false)
const homeSearchMatches = computed(() => {
  const query = homeSearch.value.trim().toLocaleLowerCase('zh-CN')
  const courtLayers = isOverview.value ? ['court_footprints','venues'] : layerEnabled('court_footprints') ? ['court_footprints','venues'] : ['venues']
  const existing = [...courtLayers,'businesses','training','merchants','parking','schools','medical','tourism','cim_squares','cim_parks']
  const collections = ['court_footprints','charging','commerce_hotels','commerce_food','emergency_shelters',
    ...(page.value === 'industry' ? panoramaRegisterLayers : [])]
  const ids = query ? [...new Set([...collections,...existing])] : existing
  return ids.flatMap(id => {
    const source = id === 'court_footprints' ? scopedFootprints.value : rawLayer(id)
    const rows = id === 'court_footprints' ? source
      : isPanoramaRegister(id) ? panoramaLayerPoints(source)
      : source.map(f => page.value === 'industry' ? chainMapFeature(f,id) : f).filter(f => inRegion(f) && inCommunity(f))
    return rows.filter(({properties:p}) => !query || [p.name,p.region,p.facilityName,p.originalName,p.registrationCode,p['运营单位'],p['权属'],...(isPanoramaRegister(id) ? [p.enterpriseName,p.address] : [])]
      .some(value => String(value ?? '').toLocaleLowerCase('zh-CN').includes(query)))
      .slice(0,query ? 12 : 3).map(feature => ({id,feature}))
  }).slice(0,16)
})
const catalogMode = ref<'scene'|'category'|'department'>('scene')
const layerIdentity = ref('')
const imagery = ref(true)
const fullScreen = ref(false)
const camera = ref<MapCamera>({longitude:113.12,latitude:31.02,height:108000,tilted:false})
const command = shallowRef<MapCommand | null>(null)
let serial = 0
const selectedId = ref<string|null>(null)
const detailOpen = ref(false)
const selectedFeature = computed(() => {
  const id = selectedId.value
  if (!id) return
  if (id.startsWith('density:')) return nativeDisplay.value
    ? populationMapFeature(nativeDisplay.value,id.slice(8)) : densityCells.value.find(feature=>feature.id===id.slice(8))
  return mapFeatures.value.find(feature => feature.id === id)
    ?? (isActiveEvent.value ? eventAnalysis.value.roadControls.find(feature => feature.id === id) : undefined)
    ?? datasets.value.find(layer => layer.features.some(feature => feature.id === id))?.features.find(feature => feature.id === id)
})
const date = ref(new Date())
const formatTime = new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Shanghai', dateStyle:'short', timeStyle:'medium' })
let clockTimer: ReturnType<typeof setInterval> | undefined
let tourTimer: ReturnType<typeof setInterval> | undefined
const touring = ref(false)
const month = ref<number|null>(null)
const monthOpen = ref(false)

const venueTab = ref<'coverage'|'site'>(initialPage === 'site' ? 'site' : 'coverage')
const coverageMode = ref<'walk'|'cycle'|'drive'>('walk')
const schools = ref(false)
const offices = ref(false)
const courtCount = ref(3)
const blindId = ref<string>()
const gapFilter = ref<'dense'|'all'|'outside'|'capacity'>('dense')
const gapLimit = ref(12)
const scenarioPeoplePerCourt = ref<number>()
const facilitySearch = ref('')
const facilityLimit = ref(12)
const facilityId = ref<string>()
const parcelId = ref('')
const proposal = shallowRef<Coordinate>()
const pickTool = ref<'site'|'circle'|null>(null)
const circleStart = shallowRef<Coordinate>()
const circleResult = shallowRef<{center:Coordinate;radius:number;count:number;area:CityFeature}>()
const measured = ref<number|null>(null)
const eventId = ref(initialPage === 'events' || initialPage === 'liveEvent' ? initialQuery.get('eventId') ?? '' : '')
const attendance = ref<number>()
const eventVenue = ref<string>()
const liveDate = ref('')
const eventTopics = {
  traffic:['roadNetwork','trafficPlan','parking','charging'], medical:['medicalPlan','emergency'],
  lodging:['hotelPlan','commerce_hotels'], food:['food','commerce_food'], security:['security'], shelters:['emergency_shelters'],
}
const eventMap = ref<keyof typeof eventTopics|'all'>('all')
const roadFilter = ref<'all'|'closed'|'restricted'>('all')
const roadListLimit = ref(12)
const eventCountyView = ref(false)
const tourismId = ref(initialPage === 'tourism' ? initialQuery.get('eventId') ?? '' : '')
const tourismMode = ref<'single'|'annual'>('single')
const industryFilter = ref('')
const schoolId = ref('')
const schoolProfile = ref(false)
const layerState = ref<Record<string,boolean>>({})
const layerColors: Record<string,string> = {
  [populationGridId]:populationBands[2].color,
  [legacyPopulationGridId]:populationBands[2].color,
  court_footprints:dashboardPalette.cyan,
  roadNetwork:'#9bcbe6',
  capacityGaps:dashboardPalette.red,
  courts:'#ffd055',population:'#bca1ff',venues:'#5cbaff',events:'#ff8075',hotels:'#ffd457',parking:'#56baff',
  medical:'#ff747b',tourism:'#46e5b1',schools:'#57eaa2',training:'#cc96fe',businesses:'#5fc4ff',projects:'#ffc263',
  promotion:'#38e1b6',
  charging:'#52cba5',commerce_hotels:'#ffd457',commerce_food:'#ffbd72',emergency_shelters:'#ffae00',
  parcels:'#44d98d',constraints:'#f2bc5a',transport:'#4bd0ec',communities:'#b2a8ff',food:'#ffbd72',
  security:'#71b4ff',emergency:'#ff7572',portals:'#6cddfd',routes:'#ffb21e',origins:'#34d3ff',learners:'#7ccaff',
  service:'#45d6fd',blind:'#ff6b5e',additional:'#48e8a0',trafficPlan:'#ff785f',medicalPlan:'#ff8ca0',hotelPlan:'#ffd457',priority:'#ff715e',
  merchants:'#ffc961',route_packages:'#49e39f',eventHeat:'#ff876b',consumeHeat:'#ff9959',redeemHeat:'#ff9959',
  farmland:dashboardPalette.yellow,ecology:dashboardPalette.green,development:dashboardPalette.purple,
  sitePassed:dashboardPalette.green,siteRejected:dashboardPalette.red,
  rehab:'#f683bd',equipment:'#8fa8ff',supplyGaps:'#ff7265',hotelPartners:'#ffd457',foodPartners:'#ff9a54',scenicPartners:'#40dd97',shoppingPartners:'#53c5f4',
}
const specialLayers: Record<string,string> = {
  service:'服务圈',blind:'服务不足片区',additional:'错时开放新增服务范围',trafficPlan:'交通管控区与路段',
  roadNetwork:'京山全市道路网',
  capacityGaps:'覆盖不足网格',
  medicalPlan:'医疗布点与路线',hotelPlan:'住宿匹配',priority:'青少年优先建设区',townBoundaries:'乡镇界线',
  farmland:'永久基本农田',ecology:'生态保护红线',development:'城镇开发边界',sitePassed:'初筛通过地块',siteRejected:'初筛未通过地块',
  eventHeat:'赛事热区',consumeHeat:'消费热力',redeemHeat:'核销热力',rehab:'运动康复',equipment:'器材服务',supplyGaps:'配套短板片区',
  hotelPartners:'酒店民宿',foodPartners:'餐饮',scenicPartners:'景区温泉',shoppingPartners:'购物',
  promotion:'网球场馆与文旅线路',
}
const {datasets:publishedSchedules,warning:scheduleWarning,plans:servicePlans} = useOpeningSchedules(computed(()=>data.value))
const siteGeometry=shallowRef<Map<string,CityFeature[]>>(new Map())
const siteLoadState=ref(''), siteLoadAttempt=ref(0)
watch([siteLayers,()=>data.value?.version,siteLoadAttempt],async([active],_,onCleanup)=>{
  const snapshot=data.value
  siteGeometry.value=new Map()
  siteLoadState.value=''
  if(!active || !snapshot?.deferredReserves?.length)return
  const controller=new AbortController()
  onCleanup(()=>controller.abort())
  siteLoadState.value='正在加载储备地块…'
  try{
    const sources=await Promise.all(snapshot.deferredReserves.map(async(id):Promise<[string,CityFeature[]]>=>{
      const response=await fetch('/api/jingshan/layers/'+encodeURIComponent(id)+'/features.geojson',{signal:controller.signal})
      if(!response.ok || response.headers.get('X-Publication-Version')!==String(snapshot.version))throw Error('储备地块版本已更新或暂不可用，请重新加载。')
      return [id,(await response.json()).features]
    }))
    if(!controller.signal.aborted){siteGeometry.value=new Map(sources);siteLoadState.value=''}
  }catch(e){if(!controller.signal.aborted)siteLoadState.value=e instanceof Error?e.message:'地块加载失败'}
},{immediate:true})
const datasets=computed(()=>{
  const rows=isOverview.value ? publishedSchedules.value : withLocalTourismSites(publishedSchedules.value)
  if(!thematicScene.value)return rows
  if(investmentScene.value && !siteLayers.value){
    const pointsOnly=rows.map(d=>(d.id===reserveLayerId || d.id===surveyReferenceLayerId) && d.features.length ? {...d,features:[]} : d)
    return alignSampleTennisCenter(pointsOnly)
  }
  return alignSampleTennisCenter(siteLayers.value && siteGeometry.value.size
    ? rows.map(d=>siteGeometry.value.has(d.id)?{...d,features:siteGeometry.value.get(d.id)!}:d) : rows)
})
const planningData = computed(() => alignSampleTennisCenter(data.value?.data.datasets ?? []))
const dataModeLabel = computed(() => data.value?.data.mode === 'live' ? '业务数据'
  : datasets.value.some(item => item.source) ? '实接与演示数据' : '演示数据')
const rawLayer = (id:string) => datasets.value.find(item => item.id === id)?.features ?? []
const densityDataset = computed(() => datasets.value.find(item=>item.id===populationGridId) ?? datasets.value.find(item=>item.id===legacyPopulationGridId))
const densityLayerId = computed(() => densityDataset.value?.id ?? populationGridId)
const nativePopulation = computed(()=>populationRaster(densityDataset.value))
const nativeCoverage = computed(()=>nativePopulation.value && rasterCourtCoverage(nativePopulation.value,rawLayer('court_footprints'),populationRadiusM.value))
const densityVisible = computed(() => (!investmentScene.value || (sceneMap.value?.populationMode==='investment' && !!sceneMap.value.populationSelection)) && !serviceResourceDetail.value && Boolean(densityDataset.value) && layerEnabled(densityLayerId.value) &&
  (!openingGapMap.value || !!sceneMap.value?.populationSelection) && (sharedPopulationMap.value || !serviceReplaces('dataset:' + densityLayerId.value)))
const populationGrid = computed(() => preparePopulationGrid(nativePopulation.value ? [] : densityDataset.value?.features ?? []))
const courtCoverage = computed(() => measureCourtCoverage(populationGrid.value, rawLayer('court_footprints'), populationRadiusM.value))
const venuePopulation = computed(() => venueDetailOnMap.value && sceneMap.value?.anchor
  ? (nativePopulation.value ? rasterRadiusPopulation(nativePopulation.value,sceneMap.value.anchor,populationRadiusM.value).people
      : populationAroundPoint(populationGrid.value, sceneMap.value.anchor, populationRadiusM.value)) : undefined)
const referenceRoads = shallowRef<CityFeature[]>([])
const roadLoad = ref<'idle'|'loading'|'ready'|'error'>('idle')
const publishedRoadLayer = computed(() => datasets.value.find(item => item.id === 'road_network'))
const roads = computed(() => publishedRoadLayer.value?.features ?? referenceRoads.value)
const visibleRoads = computed(() => layerEnabled('roadNetwork') && !serviceReplaces('roadNetwork') ? roads.value : [])
let roadRequest: Promise<void> | undefined
watch(() => layerEnabled('roadNetwork'), enabled => { if (enabled) void loadReferenceRoads() })
function loadReferenceRoads() {
  if (roadLoad.value === 'loading') return roadRequest
  if (roadLoad.value === 'ready' || publishedRoadLayer.value) return
  roadLoad.value = 'loading'
  roadRequest = readReferenceRoads()
  return roadRequest
}
async function readReferenceRoads() {
  try {
    const response = await fetch('/jingshan/roads.json')
    if (!response.ok) throw new Error('道路网读取失败')
    const collection = await response.json() as { type:string; features:CityFeature[] }
    if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error('道路网格式无效')
    referenceRoads.value = collection.features
    roadLoad.value = 'ready'
  } catch {
    roadLoad.value = 'error'
  }
}
const communities = computed(() => rawLayer('communities'))
const administrative = computed(() => rawLayer('administration'))
const publishedBoundaryIndex = computed(() => administrative.value.some(f => f.properties.kind === 'town-boundary' && !f.properties.sample)
  ? createFacilityBoundaryIndex(administrative.value, communities.value) : undefined)
const courtFilterBoundaries = computed(() => publishedBoundaryIndex.value ?? createFacilityBoundaryIndex([], communities.value))
const regions = computed(() => [...new Set([
  ...administrative.value.filter(item => item.properties.kind === 'town-boundary').map(item => item.properties.name),
  ...rawLayer('court_footprints').map(item => item.properties.region),
])].filter(item => item !== '京山市').sort((a,b) => a.localeCompare(b,'zh-CN')))
const currentCommunity = computed(() => communities.value.find(item => item.id === community.value))
const currentArea = computed(() => currentCommunity.value?.properties.name ?? region.value)
const filteredCommunities = computed(() => communities.value
  .filter(item => (region.value === '京山市' || item.properties.region === region.value) &&
    (!regionQuery.value || [item.properties.name,item.properties.region,item.properties.code].some(value => String(value ?? '').includes(regionQuery.value)))))
const filteredRegions = computed(() => regions.value.filter(item => !regionQuery.value || item.includes(regionQuery.value)))
const inRegion = (feature: CityFeature) => region.value === '京山市' || feature.properties.region === region.value
const inCommunity = (feature: CityFeature) => {
  if (!currentCommunity.value) return true
  const center = feature.properties.kind==='available-parcel' && feature.geometry.type!=='Point' ? districtCenter(feature) : featureCenter(feature)
  const boundary = currentCommunity.value.geometry
  if (center && currentCommunity.value.properties.sourceServiceId === 'cim-07') {
    if (feature.id === currentCommunity.value.id) return true
    if (boundary.type === 'Polygon') return inPolygon(center, boundary.coordinates)
    if (boundary.type === 'MultiPolygon') return boundary.coordinates.some(polygon => inPolygon(center, polygon))
  }
  const location = featureCenter(currentCommunity.value)
  return Boolean(location && center && (feature.properties.community === currentArea.value || distanceM(center,location) <= 1300))
}
const scopeData = computed(() => currentCommunity.value ? datasets.value.map(item => ({
  ...item, features: ['courts','constraints','administration','transport'].includes(item.id) ? item.features : populationDemandRows(item).filter(feature => inCommunity(page.value === 'industry' ? chainMapFeature(feature,item.id) : feature)),
})) : datasets.value)
const scopedCourts = computed(() => isOverview.value ? scopedFootprints.value
  : rawLayer('courts').filter(item => inRegion(item) && inCommunity(item)))
const serviceDetailRange = computed(() => {
  const map = sceneMap.value
  if (page.value === 'venues' && map?.anchor && map.fitFeature?.properties.kind === 'service-range') {
    return {center:map.anchor, meters:Number(map.fitFeature.properties.radiusKm) * 1000}
  }
})
const courtScope = computed(() => {
  if (currentCommunity.value) return 'village'
  const town = sceneMap.value?.courtFootprints?.region
  if (region.value !== '京山市' || (town && town !== '京山市')) return 'town'
})
const scopedFootprints = computed(() => {
  const view = sceneMap.value
  const scope = view?.courtFootprints
  const surveyed = rawLayer('court_footprints')
  if (venueDetailOnMap.value) return scope?.facilityId ? surveyedCourtsInRange(surveyed, view?.fitFeature, scope.facilityId) : []
  const townFilters = [region.value, scope?.region].filter(town => town && town !== '京山市')
  const village = currentCommunity.value
  return surveyed.filter(feature => {
    if (scope?.radiusM && view?.anchor) {
      const center = featureCenter(feature)
      return center && distanceM(view.anchor,center) <= scope.radiusM
    }
    if (!townFilters.length && !village) return true
    const area = locateCourtAreas(feature, courtFilterBoundaries.value)
    const townName = publishedBoundaryIndex.value ? area?.town?.properties.name : area?.village?.properties.region || feature.properties.region
    return townFilters.every(town => town === townName) && (!village || village.id === area?.village?.id)
  })
})
const globalPopulationScope = computed(()=>{
  const village=currentCommunity.value
  const towns=[region.value].filter(t=>t && t!=='京山市')
  if(!village)return {towns}
  const g=village.geometry
  if(village.properties.sourceServiceId==='cim-07' && (g.type==='Polygon' || g.type==='MultiPolygon')){
    const parts=g.type==='Polygon' ? [g.coordinates] : g.coordinates
    const xs=parts.flatMap(p=>p[0].map(pt=>pt[0])), ys=parts.flatMap(p=>p[0].map(pt=>pt[1]))
    const w=Math.min(...xs),e=Math.max(...xs),s=Math.min(...ys),n=Math.max(...ys)
    return {towns,contains:(x:number,y:number)=>x>=w && x<=e && y>=s && y<=n && parts.some(p=>inPolygon([x,y],p))}
  }
  const center=featureCenter(village)
  return {towns,contains:(x:number,y:number)=>!!center && Math.abs(y-center[1])<.012 && distanceM([x,y],center)<=1300}
})
const nativeScope = computed(()=>{
  const town=sceneMap.value?.populationRegion
  return town && populationOverview.value ? {...globalPopulationScope.value,towns:[...globalPopulationScope.value.towns,town]} : globalPopulationScope.value
})
const venueGroups = computed(()=>nativePopulation.value && rasterGroups(nativePopulation.value,nativeScope.value,nativeCoverage.value))
const investmentGapSelection=computed<RasterSelection|undefined>(()=>{
  const grid=nativePopulation.value, coverage=nativeCoverage.value
  if(!grid || !coverage?.byCourt.size)return
  const {mask}=rasterGroups(grid,globalPopulationScope.value,coverage)
  return {grid,mask,bit:viewBits.denseUncovered}
})
const getInvestmentGapSelection=()=>investmentGapSelection.value
const businessReserves=computed(()=>rawLayer(reserveLayerId).filter(eligibleReserve))
const scopedReserves=computed(()=>businessReserves.value.filter(f=>inRegion(f) && inCommunity(f)))
const visibleReserves=computed(()=>scopedReserves.value.filter(f=>matchesReserve(f,sceneMap.value?.reserveFilter)))
const reserveScale=computed(()=>investmentScene.value
  ? reserveScaleAt(camera.value.height,community.value?'community':region.value==='京山市'?'city':'town') : 'parcel')
const reserveGroups=computed(()=>groupReserveParcels(visibleReserves.value,administrative.value,publishedBoundaryIndex.value))
const onScreenReserves=computed<CityFeature[]>((previous)=>{
  const bounds=camera.value.bounds
  if(!bounds)return visibleReserves.value
  const [west,south,east,north]=bounds
  const rows=visibleReserves.value.filter(f=>{
    const box=boundaryExtent(f).bounds
    return !box || (box[0]<=east && box[2]>=west && box[1]<=north && box[3]>=south)
  })
  return previous && rows.length===previous.length && rows.every((f,i)=>f===previous[i]) ? previous : rows
})
const reserveLegend=computed(()=>siteLayers.value && layerEnabled(reserveLayerId) && visibleReserves.value.length ? [{label:'项目拟储备地块',color:reserveColor}] : [])
const visibleControls=computed(()=>siteLayers.value ? controlLayers.filter(c=>visibleCimIds.value.includes(controlServiceId(c.key))) : [])
const venueSelection = computed<RasterSelection|undefined>(()=>nativePopulation.value && venueGroups.value
  ? {grid:nativePopulation.value,mask:venueGroups.value.mask,bit:viewBits[populationView.value]} : undefined)
const venueDisplay = computed(()=>venueSelection.value && populationDisplayGrid(venueSelection.value,undefined,nativeCoverage.value?.counts))
const scopedPopulationGroups = computed(()=>nativePopulation.value && rasterGroups(nativePopulation.value,globalPopulationScope.value))
const nativeSelection = computed<RasterSelection|undefined>(()=>{
  if(!densityVisible.value || !nativePopulation.value)return
  if(populationOverview.value)return venueSelection.value
  if(openingGapMap.value || investmentScene.value)return sceneMap.value?.populationSelection
  if(scopedPopulationGroups.value)return {grid:nativePopulation.value,mask:scopedPopulationGroups.value.mask,bit:viewBits.all}
})
const nativeDisplay = computed(() => nativeSelection.value && (populationOverview.value ? venueDisplay.value
  : populationDisplayGrid(nativeSelection.value,serviceDetailRange.value)))
const vectorSummary = computed(() => {
  if (!populationOverview.value || nativePopulation.value) return
  const town = sceneMap.value?.populationRegion
  return groupCoverageGrids(courtCoverage.value, feature =>
    (!town || feature.properties.region === town) && inRegion(feature) && inCommunity(feature))
})
const coverageSummary = computed(()=>populationOverview.value ? venueGroups.value ?? vectorSummary.value : undefined)
const populationLegend = computed(() => {
  if(openingGapMap.value)return {view:'高密度缺口',minimum:nativePopulation.value?.highDensityThreshold??undefined,showPlanned:sceneMap.value?.servicePane==='plan'}
  if(investmentScene.value)return {view:'全开放后高密度缺口',minimum:nativePopulation.value?.highDensityThreshold??undefined}
  if(openingMap.value)return {view:'人口网格'}
  const group = coverageSummary.value?.groups[populationView.value]
  if (!group) return {}
  return {view:populationViews.find(view => view.id === populationView.value)?.layer,missing:group.grids>group.known}
})
const densityCells = computed(() => {
  if (!densityVisible.value || nativePopulation.value) return []
  if (vectorSummary.value) return vectorSummary.value.groups[populationView.value].features
  const features = densityDataset.value!.features
  const range = serviceDetailRange.value
  if (!range && region.value === '京山市' && !community.value) return features
  return features.filter(f => {
    if (!inRegion(f) || !inCommunity(f)) return false
    if (!range) return true
    const center = featureCenter(f)
    // Keep boundary cells too. The texture and its hit test are clipped to the exact service radius.
    return center && distanceM(center, range.center) <= range.meters + 1300
  })
})
watch([densityCells,nativeDisplay], ([cells,display]) => {
  const id = selectedId.value
  if (id?.startsWith('density:') && !(display ? populationMapFeature(display,id.slice(8)) : cells.some(cell => cell.id===id.slice(8)))) {
    selectedId.value = null
    detailOpen.value = false
  }
})
const footprintsVisible = computed(() => (!serviceResourceDetail.value || venueDetailOnMap.value) &&
  layerEnabled('court_footprints') && !serviceReplaces('dataset:court_footprints') &&
  !(group.value.id === 'events' && eventCountyView.value) && scopedFootprints.value.length > 0)
const rules = computed(() => normalizeRules(data.value?.data.rules))
const serviceRules = computed(() => ({
  ...rules.value, peoplePerCourt:scenarioPeoplePerCourt.value ?? rules.value.peoplePerCourt,
}))
const analysisRegion = computed(() => region.value === '京山市' ? undefined : region.value)
const baseCoverage = computed(() => coverage(scopeData.value,{region:analysisRegion.value},rules.value))
const diagnosisPeriod=ref<Period>('weekdayEvening')
const diagnosisDate=computed(()=>chinaClock(date.value.getTime()).date)
const serviceVenueDirectory=computed(()=>walkingVenueDirectory(datasets.value,rules.value))
const serviceOpeningModel=computed(()=>nativePopulation.value && openingPopulation(nativePopulation.value,rawLayer('courts'),globalPopulationScope.value,populationRadiusM.value))
const serviceGapAreas=computed(()=>serviceOpeningModel.value ? openingGapAreas(serviceOpeningModel.value,administrative.value) : [])
// Keep these data-dependent results across panel remounts and evaluate only the values a panel reads.
const serviceResources={
  get venues(){return serviceVenueDirectory.value},
  get opening(){return serviceOpeningModel.value},
  get gaps(){return serviceGapAreas.value},
}
const diagnosisCapacity=computed(()=>venueCapacity(datasets.value,{mode:'walk'},rules.value))
const diagnosticGaps=computed(()=>diagnoseGaps(diagnosisCapacity.value,datasets.value,diagnosisPeriod.value,diagnosisDate.value,false)
  .filter(gap=>inRegion(gap.cell.feature)&&inCommunity(gap.cell.feature)))
const selectedPopulationGap = computed(() => page.value === 'venues' && !populationOverview.value && !openingMap.value && selectedId.value?.startsWith('density:')
  ? diagnosticGaps.value.find(gap => gap.source.id === selectedId.value?.slice(8)) : undefined)
const serviceCapacity = computed(() => venueCapacity(datasets.value,{
  mode:coverageMode.value, schools:schools.value, offices:offices.value, region:analysisRegion.value,
  populationFilter:inCommunity, facilityFilter:inCommunity,
},serviceRules.value))
const coverageResult = computed(() => serviceCapacity.value.coverage)
const focusFacility = computed(() => serviceCapacity.value.facilities.find(item => item.id === facilityId.value))
const facilityRows = computed(() => serviceCapacity.value.facilities.filter(item => !facilitySearch.value ||
  (item.name + item.region).includes(facilitySearch.value)))
const priorityAreas = computed(() => serviceCapacity.value.priorityAreas.filter(item =>
  gapFilter.value === 'all' || (gapFilter.value === 'dense' && item.highDensity) ||
  (gapFilter.value === 'outside' && item.outsidePopulation > 0) ||
  (gapFilter.value === 'capacity' && item.capacityShortfall)))
const selectedGap = computed(() => serviceCapacity.value.priorityAreas.find(item => item.id === blindId.value))
const gapMapFeatures = computed(() => venueTab.value === 'site'
  ? (selectedGap.value ? [selectedGap.value.feature] : [])
  : priorityAreas.value.map(item => item.feature))
const siteResult = computed(() => siteSelection(selectedGap.value ? datasets.value : scopeData.value,coverageResult.value,{
  courtCount:courtCount.value,position:proposal.value,region:selectedGap.value ? undefined : analysisRegion.value,blindId:blindId.value,
  target:selectedGap.value,capacityCells:serviceCapacity.value.capacityCells,
},serviceRules.value))
const parcel = computed(() => parcelId.value === 'site:proposed' ? siteResult.value.proposed :
  siteResult.value.candidates.find(item => item.id === parcelId.value) ??
  (selectedGap.value ? siteResult.value.candidates.find(item => item.compliant) : undefined))
const events = computed(() => calendar(datasets.value).filter(item => inRegion(item) && inCommunity(item)))
const eventData = computed(() => datasets.value.map(item => item.id === 'events' ? {...item,features:events.value} : item))
const completedEvents = computed(() => events.value.filter(item => item.properties.status === '已办结'))
const futureEvent = computed(() => events.value.find(item => item.properties.status !== '已办结') ?? events.value.at(-1))
const event = computed(() => events.value.find(item => item.id === eventId.value) ?? futureEvent.value)
const eventAnalysis = computed(() => eventAssistance(eventData.value,event.value?.id,attendance.value,rules.value,eventVenue.value,
  group.value.id === 'events' ? roads.value : []))
const visibleRoadControls = computed(() => isActiveEvent.value && !eventCountyView.value && layerEnabled('trafficPlan') &&
  (eventMap.value === 'all' || eventMap.value === 'traffic') ? eventAnalysis.value.roadControls : [])
const roadCounts = computed(() => ({
  closed: eventAnalysis.value.roadControls.filter(item => item.properties.controlStatus === 'closed').length,
  restricted: eventAnalysis.value.roadControls.filter(item => item.properties.controlStatus === 'restricted').length,
}))
const listedRoads = computed(() => eventAnalysis.value.roadControls.filter(item =>
  roadFilter.value === 'all' || item.properties.controlStatus === roadFilter.value))
const tourismEvent = computed(() => completedEvents.value.find(item => item.id === tourismId.value) ??
  completedEvents.value.find(item => item.id === 'event-20261012-open') ?? completedEvents.value.at(-1))
const tourismAnalysis = computed(() => tourism(eventData.value,tourismEvent.value?.id))
const tourismTotals = computed(() => tourismMode.value === 'annual' ? tourismAnalysis.value.annual : tourismAnalysis.value)
const industryAnalysis = computed(() => industry(scopeData.value,analysisRegion.value,isOverview.value || page.value === 'industry'))
const talentAnalysis = computed(() => talent(scopeData.value,analysisRegion.value,rules.value))
const school = computed(() => talentAnalysis.value.schools.find(item => item.id === schoolId.value) ?? talentAnalysis.value.schools[0])
const counts = computed(() => ({
  courts:scopedCourts.value.length,
  open:scopedCourts.value.filter(item => item.properties.open === true).length,
  population:baseCoverage.value.totalPopulation,
}))
function groupBy<T>(items:T[],key:(item:T) => string) {
  const groups = new Map<string,T[]>()
  for (const item of items) {
    const label = key(item)
    const group = groups.get(label)
    if (group) group.push(item)
    else groups.set(label,[item])
  }
  return [...groups]
}
const departments = computed(() => groupBy(datasets.value,item => item.department)
  .map(([name, items]) => ({name,count:items.length})).sort((a,b) => b.count - a.count))
const isActiveEvent = computed(() => scene.value === 'events' || scene.value === 'liveEvent')
const shelterTopic = computed(() => isActiveEvent.value && eventMap.value === 'shelters')
const localShelters = computed(() => rawLayer('emergency_shelters').filter(row => inRegion(row) && inCommunity(row)))
const shelterPage = useServicePage(localShelters,[region,community])
const savedSceneResults = computed(() => results.value.filter(item => item.scene === scene.value ||
  (scene.value === 'liveEvent' && item.scene === 'events')))
const activeResource = computed(() => datasets.value.flatMap(layer => layer.features).find(feature => feature.id === selectedId.value))
const v3Context = computed<V3PanelContext>(() => ({
  datasets: scene.value === 'consumption' ? datasets.value : scopeData.value,
  region: scene.value === 'consumption' ? undefined : analysisRegion.value, now:wallDate,
  event: scene.value === 'tourism' || (scene.value === 'consumption' && period.value === 'event')
    ? tourismEvent.value : event.value,
  resource:activeResource.value,
  resourceFilter:resourceFilter.value, period:period.value, liveDate:liveDate.value || undefined, results:results.value,
  rules:rules.value, schoolsOpen:schools.value, officesOpen:offices.value,
  focus:(feature) => focus(feature,scene.value !== 'industry'), openEvent:selectCalendarEvent, openResult:() => {resultModal.value = true},
  openFusion:() => setScene('consumption'),
  onBusinessAction:(action) => {
    if (action === 'tasks') resultModal.value = true
    else if (action === 'remind') openOperations('urge',event.value?.id)
    else if (action === 'manage-merchants') openOperations('merchants')
    else if (action === 'manage-routes') openOperations('routes')
    else if (action === 'manage-offers') openOperations('coupons')
  },
}))
const promotionFlow = computed(() => page.value === 'consumption' && layerEnabled('promotion') ? fusionMap.value?.flow ?? undefined : undefined)
const fusionLegend = computed(() => page.value === 'consumption' && layerEnabled('promotion') ? fusionMap.value?.legend ?? [] : [])
const modulePages: Partial<Record<Scene,V3PanelPage>> = {
  overview:'overview', industry:'industry-map', investment:'investment', liveEvent:'event-live',
  consumption:'fusion-consumption', merchants:'fusion-merchants',
}
const v3Panel = computed(() => {
  const view = modulePages[scene.value]
  return view ? v3Panels(view,v3Context.value) : undefined
})
const isFacilityPage = computed(() => scene.value === 'industry' && resourceFilter.value === 'courts')
const homeCoverageRate = computed(() => {
  if (!isOverview.value || !baseCoverage.value.totalPopulation || !rawLayer('courts').length) return undefined
  return baseCoverage.value.coveredRate
})
const homeExpandedCoverageRate = computed(() => homeCoverageRate.value === undefined ? undefined
  : coverage(scopeData.value,{region:analysisRegion.value,schools:true,offices:true},rules.value).coveredRate)
const homeParkingRate = computed(() => {
  if (!isOverview.value || !futureEvent.value || !rawLayer('parking').length) return undefined
  const { parkingSupply, parkingDemand } = nextEventStats.value
  return parkingDemand ? Math.min(100, Math.round(parkingSupply / parkingDemand * 100)) : undefined
})
const currentLayers = computed(() => {
  const ids = densityDataset.value && !isOverview.value
    ? [densityLayerId.value,...meta.value.layers.filter(id => id !== 'population')] : meta.value.layers
  return ids.map(id => ({id,label:datasetName(id),color:layerColors[id] ?? '#52b5ff',enabled:layerEnabled(id)}))
})
// The event pages draw their own operational overlays. The shared directory adds only
// the published spatial resources the user chooses, independently of that event view.
const eventSpatialDatasets = computed(() => {
  if (!eventPage.value) return []
  const unavailable = new Set(['administration','event_road_controls','population',populationGridId,legacyPopulationGridId,
    ...(data.value?.deferredReserves ?? []),...(data.value?.deferredPopulation ?? [])])
  return datasets.value.filter(d => !unavailable.has(d.id) && sceneAllowsLayer(page.value,d.id) &&
    !ledgerTemplate(d.id) && !d.formSchema).map(d => ({...d,features:d.features.filter(f => f.geometry && f.geometry.type!=='GeometryCollection')}))
    .filter(d => d.features.length)
})
function isPanoramaRegister(id:string) {
  return page.value === 'industry' && panoramaRegisterLayers.includes(id)
}
function spatialDataset(item:Dataset) {
  return isPanoramaRegister(item.id) || (!ledgerTemplate(item.id) && !item.formSchema)
}
function panoramaLayerPoints(features:CityFeature[]) {
  return features.flatMap(({id}) => {
    const point = panoramaPoints.value.get(id)
    return point && inRegion(point) && inCommunity(point) ? [point] : []
  })
}
const availableLayers = computed(() => {
  if (eventPage.value) return eventSpatialDatasets.value.map(d=>({
    id:d.id,name:d.name,category:d.category,department:d.department,description:d.description,count:d.features.length,
  }))
  const entries = datasets.value.filter(item => (!investmentScene.value || item.id!==reserveLayerId || siteLayers.value) && sceneAllowsLayer(page.value, item.id) && !(item.id === 'population' && densityDataset.value) && spatialDataset(item) && !['administration','road_network','event_road_controls'].includes(item.id)).map(item => ({
    id:item.id,name:item.name,department:item.department,category:item.category,
    description:acceptsPendingLocation(item.id) ? item.description + ' 已定位 ' +
      item.features.filter(row => featureCenter(row)).length + ' 处，共登记 ' + item.features.length + ' 条。' : item.description,
    count:isPanoramaRegister(item.id) ? panoramaLayerPoints(item.features).length : populationRecordCount(item),
  }))
  for (const id of Object.keys(specialLayers)) entries.push({
    id,name:specialLayers[id],department:id === 'roadNetwork' ? (publishedRoadLayer.value?.department ?? 'OpenStreetMap') : '系统分析',
    category:id === 'roadNetwork' ? '基础地理' : '分析成果',
    description:id === 'roadNetwork' ? '全市分级道路网。可在数据中台发布 road_network 数据集更新。'
      : '基于已发布数据及当前参数计算，切换对应场景可更新。',count:analysisLayer(id).length,
  })
  return entries
})
const layerGroups = computed(() => groupBy(availableLayers.value,item =>
  item[catalogMode.value === 'department' ? 'department' : 'category']))
const currentIdentity = computed(() => availableLayers.value.find(item => item.id === layerIdentity.value))
const mapLayerFeatures = computed(() => {
  const layers: { id:string; features:CityFeature[] }[] = []
  const add = (id:string, features:CityFeature[]) => {
    if (serviceReplaces('dataset:' + id)) return
    const located = features.filter(f => f.geometry?.type !== 'GeometryCollection')
    const visible = id === 'commerce_hotels' && page.value !== 'industry' ? [...new Map(located.map(feature =>
      [facilitySiteKey({layer:id,feature}),feature])).values()] : located
    layers.push({id,features:visible})
  }
  if (eventPage.value) {
    for (const layer of eventSpatialDatasets.value) {
      if (!layerEnabled(layer.id)) continue
      add(layer.id,layer.features.filter(f=>!renderedCimSources.value.has(String(f.properties.sourceServiceId))).map(f=>({
        ...f,id:'catalog:'+layer.id+':'+f.id,properties:{...f.properties,kind:'event-catalog-feature',
          mapRole:f.geometry.type.endsWith('Point')?'support':f.geometry.type.endsWith('LineString')?'link':'parcel',
          color:f.properties.color??layerColors[layer.id],interactive:true,showLabel:false},
      })))
    }
    return layers
  }
  if (group.value.id === 'events' && eventCountyView.value) return layers
  for (const item of datasets.value) {
    if (item.id === densityDataset.value?.id || (item.id === 'population' && densityDataset.value)) continue
    if (!spatialDataset(item) || ['administration','road_network','event_road_controls'].includes(item.id) || !layerEnabled(item.id) ||
        (item.id === 'origins' && scene.value !== 'tourism')) continue
    if (scene.value === 'industry' && resourceFilter.value !== 'all') {
      const categories = {courts:['courts','venues','court_footprints'],subjects:['businesses','training',...panoramaRegisterLayers],projects:['projects'],support:['merchants',...Object.keys(commerceChainTopics),'hotels','food','tourism']}
      if (!categories[resourceFilter.value].includes(item.id)) continue
    }
    if(item.id===reserveLayerId){
      const scale=reserveScale.value
      if(scale!=='parcel'){
        const groups=reserveGroups.value
        const rows=scale==='town'?groups.towns:groups.villages
        const ungrouped=scale==='town'?groups.withoutTown:groups.withoutVillage
        add(item.id,[...Array.from(rows.values(),g=>g.marker),...ungrouped.map(f=>reserveMapFeature(f))])
      } else {
        const selected=new Set(sceneFeatures.value.filter(f=>f.properties.kind==='investment-reserve').map(f=>f.id))
        add(item.id,onScreenReserves.value.filter(f=>!selected.has(f.id)).map(f=>reserveMapFeature(f)))
      }
      continue
    }
    if (item.id === 'court_footprints') {
      add(item.id,scopedFootprints.value)
      continue
    }
    if (page.value === 'industry' && (item.id === 'businesses' || item.id === 'merchants' || commerceChainTopics[item.id] || isPanoramaRegister(item.id))) {
      add(item.id,panoramaLayerPoints(item.features))
      continue
    }
    if (scene.value === 'venues' && item.id === 'population') {
      add(item.id,coverageResult.value.overlays.filter(item => item.properties.kind === 'coverage-grid'))
      continue
    }
    if (scene.value === 'venues' && venueTab.value === 'site' && item.id === 'parcels') {
      add(item.id,item.features.filter(feature => inRegion(feature) && inCommunity(feature)))
      continue
    }
    if (scene.value === 'tourism' && ['origins','routes','events'].includes(item.id)) {
      const chosen = item.id === 'origins' ? tourismAnalysis.value.origins : item.id === 'routes' ? tourismAnalysis.value.routes : tourismEvent.value ? [tourismEvent.value] : []
      add(item.id,chosen)
      continue
    }
    if (scene.value === 'talent' && item.id === 'schools') {
      add(item.id,talentAnalysis.value.overlays.filter(item => item.properties.kind === 'school'))
      continue
    }
    if (isActiveEvent.value && eventMap.value !== 'all' &&
        Object.values(eventTopics).some(ids => ids.includes(item.id)) && !eventTopics[eventMap.value].includes(item.id)) continue
    if (scene.value === 'consumption' && ['route_packages','routes'].includes(item.id)) continue
    add(item.id,item.features.filter(feature => !renderedCimSources.value.has(String(feature.properties.sourceServiceId)) && inRegion(feature) && inCommunity(feature) &&
      (item.id !== 'businesses' || !industryFilter.value || feature.properties.segment === industryFilter.value)))
  }
  for (const id of Object.keys(specialLayers)) {
    if (id === 'townBoundaries' || id === 'roadNetwork' || !layerEnabled(id)) continue
    if (isActiveEvent.value && eventMap.value !== 'all' &&
        ((id === 'trafficPlan' && eventMap.value !== 'traffic') || (id === 'medicalPlan' && eventMap.value !== 'medical') ||
          (id === 'hotelPlan' && eventMap.value !== 'lodging'))) continue
    add(id,analysisLayer(id))
  }
  return layers
})
const visibleResultFeatures = computed(() => {
  if (eventPage.value) return !eventResultsVisible.value ? [] : results.value
    .filter(r=>r.status==='completed' && ['events','liveEvent','tourism'].includes(r.scene))
    .flatMap(r=>r.features.filter(f=>f.geometry && f.geometry.type!=='GeometryCollection').map(f=>({...f,id:'returned:'+r.id+':'+f.id})))
  if (!resultLayer.value || investmentScene.value || (group.value.id === 'events' && eventCountyView.value)) return []
  return results.value
    .filter(item => item.status === 'completed' && (item.id === replayResultId.value ||
      (item.scene !== 'tourism' && (item.scene === scene.value ||
        (isActiveEvent.value && ['events','liveEvent'].includes(item.scene))))))
    .flatMap(item => item.features.filter(feature => (feature.properties.kind !== 'origin' ||
      (scene.value === 'tourism' && layerEnabled('origins'))) &&
      (scene.value !== 'consumption' || !['route_package','route'].includes(feature.properties.kind))))
})
const visiblePanoramaTarget = computed(() => {
  const target = panoramaTarget.value
  if (page.value === 'industry' && target && target.feature.id === selectedId.value && layerEnabled(target.datasetId) && !serviceReplaces('dataset:' + target.datasetId)) return target.feature
})
const attributeLayerId=ref(''), attributeIds=shallowRef<string[]>([]), attributePick=ref<{id:string;serial:number}>()
type AttributeSource={id:string;name:string;dataset?:Dataset;service?:CimService}
const attributeSources=computed(()=>{
  const items:AttributeSource[]=[], represented=new Set<string>()
  const local=new Map(datasets.value.map(d=>[d.id,d]))
  for(const layer of availableLayers.value){
    if(investmentScene.value && layer.id===densityLayerId.value && !investmentNeedsGrid.value)continue
    const id=layer.id==='townBoundaries'?'administration':layer.id==='roadNetwork'?'road_network':layer.id
    const bound=boundServices.value.get('dataset:'+id)??boundServices.value.get(layer.id)
    const service=bound && isFeatureService(bound.kind)?bound:undefined
    let dataset=service?service.hostedDatasetId?local.get(service.hostedDatasetId):undefined:local.get(id)
    if(service && dataset && !dataset.features.length && !data.value?.deferredPopulation?.includes(dataset.id))dataset=undefined
    if(!dataset && !service)continue
    if(service)represented.add(service.id)
    items.push({id:layer.id,name:layer.name+(bound&&!service?'（源数据）':''),dataset,service})
  }
  for(const service of visibleCim.value){
    if(!isFeatureService(service.kind) || represented.has(service.id) || service.hostedDatasetId && items.some(e=>e.dataset?.id===service.hostedDatasetId))continue
    items.push({id:'service:'+service.id,name:service.name,service})
  }
  return items
})
const attributeSource=computed(()=>attributeLayerId.value?attributeSources.value.find(item=>item.id===attributeLayerId.value):undefined)
const attributeRemote=shallowRef<Dataset>(), attributeError=ref(''), attributeRetry=ref(0)
const attributeDataset=computed(()=>attributeSource.value?.dataset??attributeRemote.value)
watch([()=>attributeSource.value?.service,()=>!!attributeSource.value?.dataset,()=>data.value?.version,attributeRetry],async ([service,local],_,onCleanup)=>{
  attributeRemote.value=undefined;attributeError.value=''
  if(!service || local)return
  const controller=new AbortController();onCleanup(()=>controller.abort())
  try{
    const table=await readServiceAttributes(service,controller.signal)
    if(!controller.signal.aborted)attributeRemote.value=table
  }catch(e){if(!controller.signal.aborted)attributeError.value=e instanceof Error?e.message:'读取属性失败'}
})
const attributeRaster=computed(()=>populationRaster(attributeDataset.value))
const attributeRasterView=computed(()=>attributeRaster.value && populationDisplayGrid({grid:attributeRaster.value,bit:1}))
const attributeFocus=shallowRef<CityFeature>()
function closeAttributeTable(){attributeLayerId.value='';attributeIds.value=[];attributeFocus.value=undefined;attributePick.value=undefined}
function openAttributeTable(id:string){closeAttributeTable();attributeLayerId.value=id;mapPopup.value=null}
watch(page,closeAttributeTable)
function locateAttribute(f:CityFeature){
  attributeFocus.value=f
  setDirectoryCommand({action:'fit-features',features:[f],layerId:'attributes:'+attributeLayerId.value,maxHeight:8000,minHeight:350,serial:++serial})
}
const attributeSelection=computed<CityFeature[]>(()=>{
  const d=attributeDataset.value
  if(!d)return []
  const keys=new Set(attributeRaster.value?[]:attributeIds.value)
  const chosen=keys.size?d.features.filter(f=>keys.has(f.id)):[]
  if(attributeFocus.value&&!chosen.some(f=>f.id===attributeFocus.value!.id))chosen.push(attributeFocus.value)
  return chosen.map(f=>({...f,id:'attribute:'+f.id,properties:{...f.properties,mapRole:'candidate',selected:true,color:'#ffc54a',showLabel:false,legendLabel:'属性表所选'}}))
})
const mapFeatures = computed(() => {
  if (serviceResourceDetail.value) return [...visibleSceneFeatures.value,...(footprintsVisible.value?scopedFootprints.value:[]),...attributeSelection.value]
  if (group.value.id === 'events' && eventCountyView.value) return attributeSelection.value
  const features = mapLayerFeatures.value.flatMap(layer => layer.features)
  if (scene.value === 'venues' && venueTab.value === 'site' && siteResult.value.proposed) features.push(siteResult.value.proposed.feature)
  if (isActiveEvent.value && layerEnabled('eventAnchor') && event.value) features.push(event.value)
  features.push(...visibleResultFeatures.value,...attributeSelection.value)
  if (circleResult.value) features.push(circleResult.value.area)
  if (visiblePanoramaTarget.value) features.push(visiblePanoramaTarget.value)
  if (thematicScene.value && sceneMap.value) features.push(...visibleSceneFeatures.value)
  return [...new Map(features.map(item => [item.id,item])).values()]
})

function analysisLayer(id:string) {
  if (id === 'promotion') return page.value === 'consumption' ? fusionMap.value?.features ?? [] : []
  const byKind = (features: CityFeature[], kinds:string[]) => features.filter(item => kinds.includes(item.properties.kind))
  const scoped = (id:string) => rawLayer(id).filter(item => inRegion(item) && inCommunity(item))
  if (id === 'townBoundaries') return administrative.value.filter(item => item.properties.kind === 'town-boundary')
  if (id === 'roadNetwork') return roads.value
  if (id === 'capacityGaps' && page.value==='venues') return diagnosticGaps.value.map(g=>g.feature)
  if (id === 'capacityGaps') return isOverview.value
    ? serviceCapacity.value.priorityAreas.map(item => item.feature)
    : gapMapFeatures.value
  const constraints:Record<string,string> = {farmland:'永久基本农田',ecology:'生态保护红线',development:'城镇开发边界'}
  const constraint = constraints[id]
  if (constraint) return scoped('constraints').filter(item => item.properties.constraint === constraint)
  if (id === 'sitePassed' || id === 'siteRejected') return scene.value === 'investment'
    ? v3Panel.value?.extraMapFeatures?.filter(item => item.properties.kind === 'investment-parcel') ?? []
    : page.value === 'site' && !selectedGap.value
      ? siteResult.value.candidates.filter(item => item.id === parcelId.value && item.compliant === (id === 'sitePassed')).map(item => item.feature)
      : siteResult.value.candidates.filter(item => item.compliant === (id === 'sitePassed')).map(item => item.feature)
  const partners:Record<string,string> = {hotelPartners:'酒店民宿',foodPartners:'餐饮',scenicPartners:'景区温泉',shoppingPartners:'购物'}
  const partner = partners[id]
  if (partner) return scoped('merchants').filter(item => item.properties.category === partner).map(item => ({
    ...item,properties:{...item.properties,color:item.properties.status === '已入驻' ? layerColors[id] : '#657d9c'},
  }))
  if (id === 'eventHeat') return v3Panel.value?.extraMapFeatures?.filter(item => /heat|hotspot/i.test(item.properties.kind)) ?? []
  if (id === 'supplyGaps') return v3Panel.value?.extraMapFeatures?.filter(item => /gap|short|need/i.test(item.properties.kind)) ?? []
  if (id === 'rehab' || id === 'equipment') return scoped('businesses').filter(item =>
    id === 'rehab' ? item.properties.subtype === '运动康复' : /器材|维修/.test(String(item.properties.subtype)))
  if (id === 'consumeHeat' || id === 'redeemHeat') {
    if (scene.value === 'consumption' && id === 'consumeHeat') return v3Panel.value?.extraMapFeatures ?? []
    const sources = scoped('merchants').filter(item => item.properties.status === '已入驻' && Number(item.properties.redemptions) > 0)
      .sort((a,b) => Number(b.properties.redemptions) - Number(a.properties.redemptions)).slice(0,id === 'redeemHeat' ? 20 : 9)
    return sources.flatMap(item => {
      const center = featureCenter(item)
      if (!center) return []
      const value = Number(item.properties.redemptions)
      const radius = (id === 'redeemHeat' ? 100 : 380) + Math.sqrt(value) * (id === 'redeemHeat' ? 9 : 21)
      const ring = Array.from({length:33},(_,index) => {
        const radians = Math.PI * 2 * (index % 32) / 32
        return [center[0] + radius * Math.cos(radians) / 95200, center[1] + radius * Math.sin(radians) / 111320]
      })
      const feature:CityFeature = {type:'Feature',id:id + ':' + item.id,geometry:{type:'Polygon',coordinates:[ring]},
        properties:{...item.properties,name:item.properties.name + ' · ' + value + '次核销',kind:'consumption-heat',color:'#ff8d43'}}
      return [feature]
    })
  }
  if (id === 'service') {
    if (scene.value === 'industry') {
      const facility = focusFacility.value
      return facility ? [circle('facility-area:' + facility.id,facility.name + '周边范围','coverage-service',
        facility.region,facility.position,serviceCapacity.value.radiusM,facility.openCourts ? '#31c9ee' : '#9caec6')] : []
    }
    return byKind(coverageResult.value.overlays,['coverage-service'])
  }
  if (id === 'blind') return byKind(coverageResult.value.overlays,['coverage-blind'])
  if (id === 'additional') return byKind(coverageResult.value.overlays,['coverage-additional'])
  if (id === 'priority') return talentAnalysis.value.priorityZones
  if (id === 'trafficPlan') return byKind(eventAnalysis.value.overlays,['event-core','event-buffer','event-diversion','shuttle'])
  if (id === 'medicalPlan') return byKind(eventAnalysis.value.overlays,['medical-point','hospital-route'])
  if (id === 'hotelPlan') return byKind(eventAnalysis.value.overlays,['event-hotel'])
  return []
}
function datasetName(id:string) { return datasets.value.find(item => item.id === id)?.name ?? specialLayers[id] ?? id }
function selectTourismEvent(id:string) {
  tourismId.value = id
  replayResultId.value = undefined
  selectedId.value = null
  detailOpen.value = false
}
function layerEnabled(id:string) {
  if (!sceneAllowsLayer(page.value, id)) return false
  if (page.value === 'consumption') return layerState.value[id] ?? meta.value.activeLayers.includes(id)
  if (eventPage.value) return layerState.value[id] ?? (id==='townBoundaries')
  if (openingMap.value && ['court_footprints','courts','venues','capacityGaps'].includes(id)) return layerState.value[id] ?? false
  if (page.value === 'venues' && sceneMap.value?.facilityView === 'directory' && id === 'court_footprints')
    return layerState.value[id] ?? false
  if(investmentScene.value && id==='court_footprints')return layerState.value[id] ?? !!sceneMap.value?.courtFootprints
  if(investmentScene.value && id===reserveLayerId)return siteLayers.value && (layerState.value[id] ?? true)
  if(investmentScene.value && id===densityLayerId.value && sceneMap.value?.populationMode!=='investment')return false
  if (id === densityLayerId.value && sharedPopulationMap.value) return layerState.value[id] ?? (sceneMap.value?.servicePane!=='tasks')
  if (boundServices.value.has(id) || boundServices.value.has('dataset:' + id)) return layerState.value[id] ?? true
  if (id === densityLayerId.value) return layerState.value[id] ?? (page.value === 'venues' && sceneMap.value?.populationOverview === true)
  if (id === 'court_footprints' && thematicScene.value && sceneMap.value) return layerState.value[id] ?? Boolean(sceneMap.value.courtFootprints)
  // The services panel supplies its own layers on mount. Its legacy gap layer creates a polygon per cell.
  const usePageDefaults = !thematicScene.value || (!sceneMap.value && page.value !== 'venues')
  const fallback = id === 'townBoundaries' || (meta.value.activeLayers.includes(id) && usePageDefaults)
  return layerState.value[id] ?? fallback
}
function selectPopulationView(view: PopulationView) {
  populationView.value = view
  if (!layerEnabled(densityLayerId.value)) delete layerState.value[densityLayerId.value]
}
function checkedLayerFeatures(id:string):CityFeature[] {
  if(investmentScene.value && id===reserveLayerId)return visibleReserves.value
  if (id === 'court_footprints' && venueDetailOnMap.value) return scopedFootprints.value
  if (id === densityLayerId.value) {
    const selected=nativeSelection.value
    if(selected && densityDataset.value)return densityDataset.value.features.filter((_,i)=>blockVisible(selected.grid.blocks[i],selected))
    return densityCells.value
  }
  if (id === 'roadNetwork') return visibleRoads.value
  if (id === 'townBoundaries') {
    const towns = analysisLayer(id)
    return countyMapView.value && !community.value && region.value !== '京山市'
      ? towns.filter(town => town.properties.name === region.value) : towns
  }
  const features = mapLayerFeatures.value.filter(layer => layer.id === id).flatMap(layer => layer.features)
  if (id === 'trafficPlan') features.push(...visibleRoadControls.value)
  if (panoramaTarget.value?.datasetId === id && visiblePanoramaTarget.value) features.push(visiblePanoramaTarget.value)
  return features
}
function updateCheckedLayerFocus(layerId:string, enabled:boolean, features:CityFeature[]) {
  if (!enabled) {
    if (command.value?.action === 'fit-features' && command.value.layerId === layerId) {
      setDirectoryCommand({action:'cancel-layer-focus',serial:++serial,layerId})
    }
    return
  }
  setDirectoryCommand(features.length ? {action:'fit-features',serial:++serial,layerId,features}
    : {action:'cancel-layer-focus',serial:++serial,...(eventPage.value?{layerId}:{})})
}
function setDirectoryCommand(next: MapCommand) {
  command.value=next
  if(eventPage.value)eventDirectoryCommand.value=next
}
provide(mapDirectoryKey,{
  get mode(){return catalogMode.value},set mode(value){catalogMode.value=value},
  get identity(){return layerIdentity.value},set identity(value){layerIdentity.value=value},
  get groups(){return layerGroups.value},get currentIdentity(){return currentIdentity.value},
  get sources(){return attributeSources.value},get services(){return scopedCimCatalog.value},
  get visible(){return visibleCimIds.value},get states(){return cimStates.value},get error(){return cimError.value},
  get imagery(){return imagery.value},get boundaries(){return administrative.value.length},
  get results(){return eventPage.value ? eventResultsVisible.value : resultLayer.value},
  get overview(){return isOverview.value},get version(){return data.value?.version},
  enabled:layerEnabled,toggle:toggleLayer,toggleService:toggleCim,refresh:refreshCim,
  toggleImagery:toggleReferenceImagery,toggleResults:toggleResultLayer,openTable:openAttributeTable,
})
const eventDirectoryFeatures = computed(()=>
  [...mapLayerFeatures.value.flatMap(layer=>layer.features),...visibleResultFeatures.value,...attributeSelection.value])
function clearEventOverlays() {
  eventVenueFocus.value=undefined
  const towns=layerEnabled('townBoundaries')
  const keep=new Set(scopedCimCatalog.value.filter(s=>isCimBasemap(s) ||
    (s.kind==='3dtiles' && eventServiceOverrides.value[s.id]===false)).map(s=>s.id))
  eventServiceOverrides.value=Object.fromEntries(Object.entries(eventServiceOverrides.value).filter(([id])=>keep.has(id)))
  eventResultsVisible.value=false
  eventDirectoryCommand.value=null
  layerState.value={townBoundaries:towns}
  cimFeature.value=undefined
  closeAttributeTable()
}
provide(eventCatalogMapKey,{
  get features(){return eventDirectoryFeatures.value},get command(){return eventDirectoryCommand.value},
  get imagery(){return imagery.value},get towns(){return layerEnabled('townBoundaries') && !serviceReplaces('townBoundaries')},
  get table(){return attributeLayerId.value},get attributeServiceId(){return attributeSource.value?.service?.id},
  setVenueFocus(focus){
    eventVenueFocus.value=focus
    const model=eventVenueModel.value
    // A direct link can set the camera before the service catalogue finishes loading.
    return model ? visibleCimIds.value.includes(model.id) : !cimCatalogReady.value && !!venueModelTile(focus)
  },
  clearOverlays:clearEventOverlays,
  status(state){cimStates.value[state.id]=state},pickService:onCimPick,pickRow:pickAttributeRow,
})
watch(eventPage,()=>{
  eventVenueFocus.value=undefined
  eventDirectoryCommand.value=null
  eventServiceOverrides.value={}
  eventResultsVisible.value=false
  cimStates.value={}
})
let pendingRoadFocus:number | undefined
function cancelPendingRoadFocus() { pendingRoadFocus = undefined }
async function toggleLayer(id:string) {
  const enabled = !layerEnabled(id)
  if (id === densityLayerId.value && populationOverview.value) {
    if (enabled) delete layerState.value[id]
    else layerState.value[id] = false
    return
  }
  if (!enabled && id === densityLayerId.value && selectedId.value?.startsWith('density:')) {
    selectedId.value = null
    detailOpen.value = false
  }
  if (!enabled && id === 'court_footprints' && selectedFeature.value?.properties.kind === 'court-footprint') {
    selectedId.value = null
    detailOpen.value = false
  }
  layerState.value = { ...layerState.value, [id]:enabled }
  const bound = boundServices.value.get(id) ?? boundServices.value.get('dataset:' + id)
  if (bound && (eventPage.value || !(id==='court_footprints' && (venueDetailOnMap.value || managedCourtService.value)))) {
    if (enabled) setDirectoryCommand({action:'focus-layer',layerId:bound.id,serial:++serial})
    else if (command.value?.action === 'focus-layer' && command.value.layerId === bound.id) setDirectoryCommand({action:'cancel-layer-focus',layerId:bound.id,serial:++serial})
    return
  }
  const layerId = 'scene:' + id
  const features = enabled ? checkedLayerFeatures(id) : []
  updateCheckedLayerFocus(layerId,enabled,features)
  if (!enabled || id !== 'roadNetwork' || features.length || publishedRoadLayer.value) return
  const request = serial
  pendingRoadFocus = request
  const currentPage = page.value
  const currentRegion = region.value
  const currentCommunityId = community.value
  await loadReferenceRoads()
  if (pendingRoadFocus !== request) return
  pendingRoadFocus = undefined
  if (request === serial && currentPage === page.value && currentRegion === region.value &&
    currentCommunityId === community.value && layerEnabled(id) && visibleRoads.value.length) {
    updateCheckedLayerFocus(layerId,true,visibleRoads.value)
  }
}
function toggleResultLayer() {
  const visible=eventPage.value ? eventResultsVisible : resultLayer
  visible.value=!visible.value
  updateCheckedLayerFocus('catalog:returned-results',visible.value,visibleResultFeatures.value)
}
function toggleReferenceImagery() {
  imagery.value = !imagery.value
  if (visibleCim.value.some(item => isCimBasemap(item) && cimStates.value[item.id]?.state !== 'error')) return
  const [west,south,east,north] = data.value?.data.imagery?.bounds ?? [112.65,30.55,113.66,31.62]
  const footprint:CityFeature = {type:'Feature',id:'reference-imagery',
    geometry:{type:'Polygon',coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]},
    properties:{name:'京山参考影像',region:'京山市',kind:'imagery'}}
  updateCheckedLayerFocus('catalog:reference-imagery',imagery.value,[footprint])
}
function setLayers(ids:readonly string[], enabled = true) {
  layerState.value = { ...layerState.value, ...Object.fromEntries(ids.map(id => [id,enabled])) }
}
function viewEventArea(area:'county'|'venue') {
  eventCountyView.value = area === 'county'
  selectedId.value = null
  detailOpen.value = false
  if (area === 'county') {
    if (region.value !== '京山市') changeRegion('京山市')
    else mapAction('home')
    return
  }
  const position = page.value === 'tourism' && tourismEvent.value ? featureCenter(tourismEvent.value) : eventAnalysis.value.position
  if (position) mapAction('focus',position)
}
function viewVisitorFlows() {
  eventCountyView.value = false
  setLayers(['origins'])
  mapAction('home')
}
function selectRoad(feature:CityFeature) {
  eventCountyView.value = false
  eventMap.value = 'traffic'
  setLayers(['roadNetwork','trafficPlan'])
  focus(feature)
}
function setEventTopic(topic:typeof eventMap.value) {
  if (topic === 'shelters') {
    eventCountyView.value = false
    selectedId.value = null
    detailOpen.value = false
    const locations = localShelters.value.filter(row => featureCenter(row))
    if (locations.length) command.value = {action:'fit-features',features:locations,serial:++serial}
    else mapAction('home')
  } else if (eventCountyView.value || shelterTopic.value) viewEventArea('venue')
  eventMap.value = topic
  setLayers(topic === 'all' ? Object.values(eventTopics).flat() : eventTopics[topic])
}
function mapAction(action:MapAction,position?:Coordinate,height?:number) { command.value = {action,serial:++serial,position,height} }
function frameSceneMap(view: SceneMap) {
  keepServiceCamera.value=false
  if (view.focus === 'county') {
    const townName = view.populationRegion
    const town = townName && administrative.value.find(f => f.properties.kind === 'town-boundary' && f.properties.name === townName)
    if (currentCommunity.value) focus(currentCommunity.value,false)
    else if (town) command.value = {action:'fit-features',features:[town],serial:++serial}
    else mapAction('home')
  } else if (view.fitFeature) {
    const orientation = view.venueModelFocus ? (mapModelsOn.value ? 'model' : 'plan') : undefined
    command.value = {action:'fit-features',features:[view.fitFeature],view:orientation,serial:++serial}
  } else if (view.anchor) {
    command.value = {action:'focus', position:view.anchor, view:mapModelsOn.value ? 'model' : 'area',
      height:view.height ?? (view.focus === 'model' ? 1200 : 6000), serial:++serial}
  } else if (view.focus && view.features.length) {
    command.value = {action:'fit-features',features:view.features,serial:++serial}
  }
}
function clearMapSelection(){
  selectedId.value=null
  detailOpen.value=false
  cimFeature.value=undefined
  serviceMapPick.value=undefined
  highlightedServiceVenue.value=undefined
}
function applySceneMap(view: SceneMap, keepCamera=false) {
  if (!thematicScene.value) return
  const prior = sceneMap.value
  if(prior?.investmentPane!==view.investmentPane && investmentScene.value)clearMapSelection()
  const paneChanged=!!prior?.servicePane && prior.servicePane!==view.servicePane
  if(paneChanged){
    clearMapSelection()
    populationView.value='all'
  }
  if(prior?.populationMode==='investment' && view.populationMode!=='investment')clearMapSelection()
  if(paneChanged || prior?.populationMode!==view.populationMode)delete layerState.value[densityLayerId.value]
  const courtTownChanged = prior?.populationOverview && view.populationOverview &&
    (prior.populationRegion || '') !== (view.populationRegion || '')
  const refocus = view.focus==='area' && view.focusRevision!==undefined && view.focusRevision!==prior?.focusRevision
  const moved = !prior || courtTownChanged || refocus || view.focus !== prior.focus || view.height !== prior.height || view.fitFeature?.id !== prior.fitFeature?.id ||
    view.anchor?.[0] !== prior.anchor?.[0] || view.anchor?.[1] !== prior.anchor?.[1]
  if (view.venueModelFocus?.id !== prior?.venueModelFocus?.id || view.venueModelFocus?.name !== prior?.venueModelFocus?.name) {
    localModelOverrides.value = {}
    modelPlanView.value = false
  }
  sceneMap.value = view
  if (prior?.populationOverview!==view.populationOverview || prior?.facilityView!==view.facilityView || prior?.venueDetail!==view.venueDetail) keepServiceCamera.value=false
  if (keepCamera || (prior?.facilityView==='detail' && view.facilityView==='directory')) {
    selectedId.value=null
    serviceMapPick.value=undefined
    detailOpen.value=false
  }
  if (moved || paneChanged) hiddenSceneSymbols.value = []
  if (selectedId.value && !selectedId.value.startsWith('density:') && !mapFeatures.value.some(f => f.id === selectedId.value)) {
    selectedId.value = null
    detailOpen.value = false
  }
  if (keepCamera) {
    keepServiceCamera.value=true
    command.value={action:'cancel-layer-focus',serial:++serial}
  } else if (moved) frameSceneMap(view)
}
function switchModelView() {
  if (!focusedVenueModel.value || !sceneMap.value) return
  modelPlanView.value = !modelPlanView.value
  frameSceneMap(sceneMap.value)
}
function fitPromotion() {
  mapAction(promotionFlow.value ? 'fit-promotion' : 'home')
}
function applyFusionMap(view:FusionMapView, focus = false) {
  if (page.value !== 'consumption') return
  const previous = fusionMap.value
  fusionMap.value = view
  if (focus) layerState.value.promotion = true
  if (!layerEnabled('promotion')) return
  if (fusionPick.value && !view.features.some(f => f.id === fusionPick.value && f.properties.selected)) {
    fusionPick.value = ''
    selectedId.value = null
  }
  if (view.flow) {
    const signature = (flow:FusionMapView['flow']) => flow && JSON.stringify([flow.id,flow.from,flow.via,flow.to])
    if (focus || signature(previous?.flow ?? null) !== signature(view.flow)) fitPromotion()
  } else if (focus && view.features.length) {
    command.value = {action:'fit-features', layerId:'promotion', features:view.features, minHeight:3500, serial:++serial}
  } else if (previous?.flow) mapAction('home')
}
function setScene(target:V3Page, zoom = true, assessmentId?:string) {
  const id = target === 'site' ? 'venues' : target
  if(target==='events' && (page.value!==target || assessmentId))eventId.value=assessmentId ?? ''
  const enteringVenues = target === 'venues' && page.value !== target
  if (target === 'industry') resetCountyMap()
  if (page.value !== target) {
    industryDiagnosis.value = false
    fusionMap.value = undefined
    fusionPick.value = ''
    if (command.value?.action === 'focus-layer' || command.value?.action === 'fit-features') {
      command.value = { action:'cancel-layer-focus', serial:++serial }
    }
    clearMapSelection()
    populationView.value = 'all'
    sceneMap.value = undefined
    keepServiceCamera.value = false
    localModelOverrides.value = {}
    modelPlanView.value = false
    layerState.value = {}
    industryFilter.value = ''
    replayResultId.value = undefined
    roadFilter.value = 'all'
    eventCountyView.value = false
  }
  scene.value = id
  if (id === 'industry') {
    resourceFilter.value = 'all'
    facilityId.value = undefined
    facilitySearch.value = ''
  }
  if (id === 'venues') {
    venueTab.value = target === 'site' ? 'site' : 'coverage'
    layerState.value = {}
    if (target !== 'site') { blindId.value = undefined; parcelId.value = '' }
  }
  if (id === 'events') eventMap.value = 'traffic'
  if (id === 'liveEvent') eventMap.value = 'all'
  if (id === 'consumption') { region.value = '京山市'; community.value = '' }
  pickTool.value = null
  mapPopup.value = null
  homeSearchOpen.value = false
  homeMenuOpen.value = false
  catalogMode.value = 'scene'
  regionOpen.value = false
  regionQuery.value = ''
  monthOpen.value = false
  const url = new URL(location.href)
  if (target === 'overview') url.searchParams.delete('scene')
  else url.searchParams.set('scene',target)
  if (target !== initialQuery.get('scene')) url.searchParams.delete('eventId')
  history.replaceState(null,'',url)
  // The initial services view frames its own county, town or community when its map is ready.
  if (zoom && !enteringVenues) {
    const urban = pages[target].urban
    const location = id === 'events' || id === 'liveEvent' ? eventAnalysis.value.position : null
    if (id === 'consumption') fitPromotion()
    else if (currentCommunity.value) focus(currentCommunity.value,false)
    else if (urban && region.value === '京山市') mapAction('focus',location ?? [113.120,31.022])
    else mapAction('home')
  }
}
function changeRegion(name:string,selectedCommunity = '') {
  keepServiceCamera.value=false
  const mapFitsRegion = countyMapView.value && !selectedCommunity && (region.value !== name || Boolean(community.value))
  region.value = name
  community.value = selectedCommunity
  regionOpen.value = false
  regionQuery.value = ''
  selectedId.value = null
  detailOpen.value = false
  blindId.value = undefined
  facilityId.value = undefined
  parcelId.value = ''
  proposal.value = undefined
  if (!eventCountyView.value) {
    eventId.value = ''
    attendance.value = undefined
    eventVenue.value = undefined
    roadFilter.value = 'all'
    tourismId.value = ''
  }
  if (currentCommunity.value) focus(currentCommunity.value,false)
  else if (!mapFitsRegion) mapAction('home')
}
function closeHomeRegion(restoreFocus = false) {
  regionOpen.value = false
  regionQuery.value = ''
  if (restoreFocus) homeRegionTrigger.value?.focus()
}
function openHomeRegion() {
  regionOpen.value = true
  mapPopup.value = null
  homeSearchOpen.value = false
}
function toggleHomeRegion() {
  if (regionOpen.value) closeHomeRegion()
  else openHomeRegion()
}
function selectHomeRegion(name:string, selectedCommunity = '') {
  changeRegion(name, selectedCommunity)
  homeRegionTrigger.value?.focus()
}
function dismissHomeRegionOutside(event:PointerEvent) {
  if (!regionOpen.value || !(event.target instanceof Element)) return
  if (homeRegionControl.value?.contains(event.target) ||
      event.target.closest('.region-selector,[aria-controls="home-region-popover"],[aria-controls="region-menu"]')) return
  closeHomeRegion()
}
function escapeMapControls() {
  if (regionOpen.value) closeHomeRegion(true)
  homeSearchOpen.value = false
  mapPopup.value = null
}
function focus(feature:CityFeature,details = true) {
  cimFeature.value = undefined
  selectedId.value = feature.properties.kind === 'population-grid' ? 'density:' + feature.id : feature.id
  detailOpen.value = details
  if (feature.properties.kind === 'origin') return
  const isRoad = feature.properties.kind === 'road-control'
  const position = isRoad ? roadControlPosition(feature) : featureCenter(feature)
  let height: number | undefined
  if (['court','court-footprint'].includes(feature.properties.kind)) height = 680
  else if (feature.properties.kind==='investment-reserve') height=400
  else if (isRoad) height = 1750
  else if (page.value === 'industry' && feature.properties.panoramaEntityKey && feature.properties.locationPrecision)
    height = /参照|参考/.test(String(feature.properties.locationPrecision)) ? 2400 : 900
  else if (page.value === 'industry' && ['hotel','food'].includes(feature.properties.kind))
    height = /道路|社区/.test(String(feature.properties.locationLabel ?? '')) ? 2400 : 900
  if (position) mapAction('focus',position,height)
}
function locateIndustryFeature(feature:CityFeature,datasetId?:string) {
  panoramaTarget.value = datasetId ? { feature, datasetId } : undefined
  if (datasetId) setIndustryLayer(datasetId,true)
  focus(feature,false)
}
function setPanoramaPoints(entries: Enterprise[]) {
  const next = new Map(entries.map(({feature}) => [feature.id,feature]))
  const previousId = panoramaTarget.value?.feature.id
  if (previousId && panoramaPoints.value.has(previousId) && !next.has(previousId)) panoramaTarget.value = undefined
  panoramaPoints.value = next
}
function setIndustryLayer(id:string,enabled:boolean) {
  if (enabled && page.value === 'industry' && !['courts','venues','court_footprints'].includes(id)) resourceFilter.value = 'all'
  setLayers([id],enabled)
}
function closeIndustryRail(side:'left'|'right') {
  if (side === 'left') leftPanelOpen.value = false
  else rightPanelOpen.value = false
}
function openIndustryRail(side:'left'|'right') {
  if (side === 'left') leftPanelOpen.value = true
  else rightPanelOpen.value = true
}
function clearIndustryHighlight() {
  if (!industryDiagnosis.value && selectedId.value && region.value === '京山市') mapAction('home')
  selectedId.value = null
  detailOpen.value = false
}
function setIndustryDiagnosis(open: boolean) {
  industryDiagnosis.value = open
  if (open) {
    closeHomeRegion()
    mapPopup.value = null
    homeSearchOpen.value = false
    detailOpen.value = false
  }
}
function highlightVenueCourt(courtId:string) {
  const footprint = scopedFootprints.value.find(item => item.properties.courtId === courtId)
  selectedId.value = footprint?.id ?? null
  detailOpen.value = false
}
function zoomReserveTown(name:string){
  if(name==='京山市'){frameSceneMap({focus:'county',features:[]});return}
  const town=Array.from(reserveGroups.value.towns.values()).find(g=>g.area.properties.name===name)
  if(town)command.value={action:'fit-features',...reserveDrillView(town),serial:++serial}
  else {
    const area=administrative.value.find(f=>f.properties.kind==='town-boundary' && f.properties.name===name)
    if(area)command.value={action:'fit-features',features:[area],view:'context',maxHeight:21_000,serial:++serial}
  }
}
function pickAttributeRow(id:string) {
  if(!attributeDataset.value)return false
  const catalogPrefix='catalog:'+attributeLayerId.value+':'
  const rowId=id.startsWith(catalogPrefix)?id.slice(catalogPrefix.length):id.startsWith('attribute:')?id.slice(10):id
  if(!(attributeRaster.value?rasterCellById(attributeRaster.value,rowId):attributeDataset.value.features.some(f=>f.id===rowId)))return false
  attributePick.value={id:rowId,serial:(attributePick.value?.serial??0)+1}
  return true
}
function selectMapFeature(id:string) {
  if(pickAttributeRow(id)) return
  if (page.value === 'consumption' && fusionMap.value?.features.some(f => f.id === id)) {
    selectedId.value = id
    fusionPick.value = id
    detailOpen.value = false
    rightPanelOpen.value = true
    return
  }
  if(investmentScene.value && (id.startsWith('reserve-town:') || id.startsWith('reserve-village:'))){
    const groups=reserveGroups.value
    const target=groups.towns.get(id) ?? groups.villages.get(id)
    if(target)command.value={action:'fit-features',...reserveDrillView(target),serial:++serial}
    return
  }
  if(investmentScene.value && (id.startsWith('available:') || sceneMap.value?.reserveFilter?.ids?.has(id))){
    const feature=mapFeatures.value.find(f=>f.id===id)
    if(feature){serviceMapPick.value={feature};rightPanelOpen.value=true}
    return
  }
  cimFeature.value = undefined
  selectedId.value = id
  detailOpen.value = true
  if (id.startsWith('density:')) return
  const enterprise = panoramaPoints.value.get(id)
  if (page.value === 'industry' && enterprise) {
    serviceMapPick.value = { feature: enterprise }
    detailOpen.value = false
    rightPanelOpen.value = true
    return
  }
  const businessFeature = thematicScene.value && sceneMap.value?.features.find(f => f.id === id)
  const reservePick=investmentScene.value && !businessFeature && mapLayerFeatures.value.find(l=>l.id===reserveLayerId)?.features.find(f=>f.id===id)
  if(reservePick){
    detailOpen.value=false
    serviceMapPick.value={feature:reservePick}
    rightPanelOpen.value=true
    return
  }
  if (businessFeature) {
    detailOpen.value = false
    serviceMapPick.value = {feature:businessFeature}
    rightPanelOpen.value = true
    return
  }
  if (page.value === 'venues') {
    const area=!openingMap.value && layerEnabled('capacityGaps') && diagnosticGaps.value.find(g=>g.feature.id===id||g.source.id===id||'coverage-grid:'+g.source.id===id)
    if(area){
      serviceMapPick.value={feature:area.feature}
      rightPanelOpen.value=true
      detailOpen.value=false
      return
    }
    const boundaryCourt=rawLayer('court_footprints').find(c=>c.id===id)?.properties.courtId
    const target = boundaryCourt ? rawLayer('courts').find(c=>c.id===boundaryCourt) : id.startsWith('facility:')
      ? serviceCapacity.value.facilities.find(item => item.id === id.slice('facility:'.length))?.feature
      : datasets.value.filter(layer => ['venues','courts',...supportLayerIds].includes(layer.id))
        .map(layer => layer.features.find(item => item.id === id && (['venues','courts'].includes(layer.id)||facilityKinds(layer.id,item).length))).find(Boolean)
    if (target) {
      serviceMapPick.value = {feature:target}
      rightPanelOpen.value = true
      detailOpen.value = false
      return
    }
  }
  if (isFacilityPage.value && activeResource.value?.properties.kind === 'court') {
    const court = activeResource.value
    facilityId.value = String(court.properties.facilityId ?? court.id)
    detailOpen.value = false
    setLayers(['service'])
  }
  if (isFacilityPage.value && id.startsWith('facility:')) {
    facilityId.value = id.slice('facility:'.length)
    detailOpen.value = false
    setLayers(['service'])
  }
  if (page.value === 'venues' && priorityAreas.value.some(item => item.id === id)) {
    blindId.value = id
    detailOpen.value = false
  }
  if (scene.value === 'industry' && activeResource.value && activeResource.value.properties.kind !== 'court-footprint') detailOpen.value = false
  if (scene.value === 'talent') {
    const original = selectedFeature.value?.properties.sourceId ?? id
    if (talentAnalysis.value.schools.some(item => item.id === original)) {
      schoolId.value = String(original)
      schoolProfile.value = true
      detailOpen.value = false
    }
  }
}
function selectBlind(id:string) {
  const target = serviceCapacity.value.priorityAreas.find(item => item.id === id)
    ?? coverageResult.value.blindAreas.find(item => item.id === id)
  if (!target) return
  setScene('site',false)
  blindId.value = id
  courtCount.value = Math.min(30,Math.max(1,target.gap))
  parcelId.value = ''
  proposal.value = undefined
  viewSiteTarget()
}
function viewSiteTarget() {
  const target = selectedGap.value?.position
  const candidate = parcel.value?.feature
  const candidatePosition = candidate && featureCenter(candidate)
  detailOpen.value = false
  selectedId.value = candidate?.id ?? selectedGap.value?.id ?? null
  if (target && candidatePosition) {
    const midpoint:Coordinate = [(target[0]+candidatePosition[0])/2,(target[1]+candidatePosition[1])/2]
    mapAction('focus',midpoint,Math.max(4_500,distanceM(target,candidatePosition)*5))
  } else if (target) mapAction('focus',target,4_500)
}
function selectGap(item:VenuePriorityArea) {
  blindId.value = item.id
  setLayers(['capacityGaps'])
  focus(item.feature,false)
}
function chooseFacility(id:string) {
  const item = serviceCapacity.value.facilities.find(row => row.id === id)
  if (!item) return
  facilityId.value = id
  selectedId.value = null
  detailOpen.value = false
  setLayers(['service'])
  mapAction('focus',item.position, Math.max(3600,serviceCapacity.value.radiusM * 3.5))
}
function focusCoverageGaps() {
  gapFilter.value = 'dense'
  blindId.value = undefined
  setScene('venues')
}
function openSceneStep(step:V3Page) {
  stopTour()
  if (step === 'events' && page.value === 'events') { eventPreassessmentRef.value?.overview(); return }
  if (step === page.value && thematicScene.value && sceneMap.value) {
    frameSceneMap(sceneMap.value)
    return
  }
  if (step === 'site' && page.value === 'venues' && selectedGap.value) selectBlind(selectedGap.value.id)
  else setScene(step)
}
function preloadSceneStep(step:V3Page) {
  if (step === 'venues') void loadIndustryServices().catch(() => {})
}
function advanceScene(direction:number) {
  const index = groups.findIndex(item => item.id === group.value.id)
  const next = groups[(index + groups.length + direction) % groups.length]
  stopTour()
  setScene(next.pages[0])
}
function densityLabel(item:VenuePriorityArea) {
  return item.densityPerKm2 === null ? '人口密度待补' : fmt(item.densityPerKm2) + ' 人/km²'
}
function changeServiceCapacity(event:Event) {
  const input = event.target as HTMLInputElement
  const value = Math.round(input.valueAsNumber)
  scenarioPeoplePerCourt.value = Number.isFinite(value) ? Math.max(1,Math.min(100_000,value)) : undefined
  input.value = String(scenarioPeoplePerCourt.value ?? rules.value.peoplePerCourt)
}
function setVenueTab(value:'coverage'|'site') {
  setScene(value === 'site' ? 'site' : 'venues',false)
  selectedId.value = null
  detailOpen.value = false
}
function chooseParcel(id:string) {
  parcelId.value = id
  const candidate = siteResult.value.candidates.find(item => item.id === id)
  if (candidate) {
    setLayers([candidate.compliant ? 'sitePassed' : 'siteRejected'])
    focus(candidate.feature,false)
  }
}
function chooseEvent(feature:CityFeature, destination:'events'|'liveEvent'|'tourism') {
  if (destination !== 'tourism') {
    if(destination==='liveEvent')eventId.value=feature.id
    liveDate.value = ''
    attendance.value = undefined
    eventVenue.value = undefined
    roadFilter.value = 'all'
    eventMap.value = 'all'
  } else {
    tourismId.value = feature.id
    tourismMode.value = 'single'
  }
  setScene(destination,true,destination==='events' ? feature.id : undefined)
  monthOpen.value = false
}
function selectCalendarEvent(feature:CityFeature) {
  const status = feature.properties.status
  chooseEvent(feature,status === '已办结' ? 'tourism' : status === '进行中' ? 'liveEvent' : 'events')
}
function openOperations(panel:OperationsPanel,id?:string,tab?:string) {
  operations.value = { panel,id,tab }
}
function closePublicView() { location.assign('/') }
function selectSchool(id:string) {
  schoolId.value = id
  schoolProfile.value = true
  const item = talentAnalysis.value.schools.find(item => item.id === id)
  if (item) focus(item.feature,false)
}
function beginPick(tool:'site'|'circle') {
  pickTool.value = tool
  mapPopup.value = null
  circleStart.value = undefined
  measured.value = null
  mapAction('pick')
}
function acceptPosition(point:Coordinate) {
  if (pickTool.value === 'site') {
    proposal.value = point
    parcelId.value = 'site:proposed'
    pickTool.value = null
    setLayers(['constraints','parcels'])
  } else if (pickTool.value === 'circle') {
    if (!circleStart.value) {
      circleStart.value = point
      mapAction('pick')
      return
    }
    const center = circleStart.value
    const radius = distanceM(center,point)
    const bounds: Coordinate[] = Array.from({length:49},(_,index) => {
      const angle = Math.PI * 2 * (index % 48) / 48
      return [center[0] + radius * Math.cos(angle) / (111320 * Math.cos(center[1] * Math.PI / 180)),center[1] + radius * Math.sin(angle) / 111320]
    })
    const count = scopedFootprints.value.filter(feature => {
      const coordinate = featureCenter(feature)
      return coordinate && distanceM(center,coordinate) <= radius
    }).length
    const area:CityFeature = {type:'Feature',id:'tool:circle',geometry:{type:'Polygon',coordinates:[bounds]},
      properties:{name:'圈选统计 · ' + count + '片',kind:'coverage-service',region:region.value,color:'#35e0ff'}}
    circleResult.value = {center,radius,count,area}
    circleStart.value = undefined
    pickTool.value = null
  }
}
function resetCountyMap() {
  cancelPendingRoadFocus()
  changeRegion('京山市')
  panoramaTarget.value = undefined
  imagery.value = true
  cimOverrides.value = {}
  layerState.value = {}
  cimFeature.value = undefined
  resultLayer.value = false
  replayResultId.value = undefined
  circleStart.value = undefined
  circleResult.value = undefined
  measured.value = null
}

function returnToOverview() {
  stopTour()
  resetCountyMap()
  setScene('overview')
}

function resetMap() {
  pickTool.value = null
  detailOpen.value = false
  selectedId.value = null
  if (page.value === 'consumption') { setLayers(['promotion']); fitPromotion() }
  else if (thematicScene.value && sceneMap.value) frameSceneMap(sceneMap.value)
  else if (page.value === 'site' && selectedGap.value) viewSiteTarget()
  else if (currentCommunity.value) focus(currentCommunity.value,false)
  else mapAction('home')
}
function cancelPick() {
  pickTool.value = null
  circleStart.value = undefined
  mapAction('clear')
}
function clearMap() {
  cimOverrides.value = Object.fromEntries(cimServices.value.map(item => [item.id,false]))
  if (thematicScene.value) {
    hiddenSceneSymbols.value = sceneLegend(sceneMap.value?.features ?? []).map(entry => entry.label)
    localModelOverrides.value = {}
    if(focusedVenueModel.value)modelPlanView.value=true
  }
  cimFeature.value = undefined
  layerState.value = Object.fromEntries([...availableLayers.value.map(item => item.id),'eventAnchor'].map(id => [id,false]))
  pickTool.value = null
  circleStart.value = undefined
  circleResult.value = undefined
  proposal.value = undefined
  measured.value = null
  parcelId.value = ''
  resultLayer.value = false
  selectedId.value = null
  detailOpen.value = false
  mapPopup.value = null
  mapAction('clear')
}
function togglePopup(value:'layers'|'legend'|'tools') { mapPopup.value = mapPopup.value === value ? null : value }
function homeMapSearch() {
  homeSearchOpen.value = !homeSearchOpen.value
  mapPopup.value = null
  regionOpen.value = false
  if (homeSearchOpen.value) requestAnimationFrame(() => homeSearchBox.value?.focus())
}
function focusHomeSearchMatch(id:string, feature:CityFeature) {
  if (industryDiagnosis.value) setIndustryDiagnosis(false)
  eventCountyView.value = false
  if (page.value === 'venues' && (['venues','courts','court_footprints'].includes(id)||facilityKinds(id,feature).length)) {
    homeSearchOpen.value = false
    selectMapFeature(feature.id)
    return
  }
  if (page.value === 'industry' && (commerceChainTopics[id] || isPanoramaRegister(id))) {
    locateIndustryFeature(feature,id)
    if (isPanoramaRegister(id)) selectMapFeature(feature.id)
    homeSearchOpen.value = false
    return
  }
  if (page.value === 'industry') {
    resourceFilter.value = id === 'venues' || id === 'court_footprints' ? 'courts' : id === 'businesses' || id === 'training' ? 'subjects'
      : id === 'merchants' || commerceChainTopics[id] ? 'support' : 'all'
  }
  setLayers([id])
  focus(feature)
  homeSearchOpen.value = false
}
function clickMonth(value:number) { month.value = value; monthOpen.value = true }
function dateOf(item:CityFeature) { return String(item.properties.date ?? '') }
const monthEvents = computed(() => events.value.filter(item => Number(dateOf(item).slice(5,7)) === month.value))
function monthDot(value:number) {
  const list = events.value.filter(item => Number(dateOf(item).slice(5,7)) === value)
  const type = list.find(item => item.properties.level === '国际')?.properties.level ?? list[0]?.properties.level
  return {国际:'#ff796e',全国:'#ffb543',省级:'#4cc9ff',群众:'#43dc9d'}[String(type)] ?? '#43679b'
}
function showToast(text:string) {
  toast.value = text
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {toast.value = ''},3600)
}
watch(()=>[data.value,investmentScene.value,investmentNeedsGrid.value,eventPage.value,fusionScene.value] as const,async ([snapshot,inInvestment,needsGrid,inEvent,inFusion],_,onCleanup)=>{
  if(!snapshot?.deferredPopulation?.length || inFusion || inEvent || inInvestment && !needsGrid)return
  const controller=new AbortController()
  onCleanup(()=>controller.abort())
  try{
    const hydrated=await readDeferredPopulation(snapshot,controller.signal) ?? await readScenePublication()
    if(!controller.signal.aborted && data.value===snapshot)data.value=hydrated
  }catch(error){
    if(!controller.signal.aborted)showToast(error instanceof Error?error.message:'人口网格读取失败')
  }
})
async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [published, rows] = await Promise.all([readScenePublication(),publicView ? Promise.resolve([]) : api<Result[]>(investmentScene.value?'/results?investmentPoints=1':'/results')])
    data.value = published
    results.value = rows
    if (!publicView && !countyMapView.value && !thematicScene.value && !fusionScene.value) setScene(page.value)
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '无法读取数据'
  } finally { loading.value = false }
}
function updatePublishedView(value:PublishedData) {
  if (JSON.stringify(data.value?.data.mapBindings) !== JSON.stringify(value.data.mapBindings)) {
    cimOverrides.value = {}
    localModelOverrides.value = {}
    layerState.value = {}
    if (!publicView) void refreshCim()
  }
  data.value = value
  if (region.value !== '京山市' && !regions.value.includes(region.value)) changeRegion('京山市')
  showToast('数据已发布，大屏使用 V' + value.version)
}
function refreshPublished(value: PublishedData) {
  if(boundCourtSource(value.data)) void readScenePublication().then(updatePublishedView).catch(e=>showToast(e.message))
  else updatePublishedView(value)
  announceDataChange('publication')
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch { showToast('浏览器未允许全屏') }
}
function syncFullscreen() { fullScreen.value = Boolean(document.fullscreenElement) }
function demoTour() {
  if (touring.value) { stopTour(); return }
  touring.value = true
  let index = 0
  const steps = [() => setScene('overview'),() => setScene('industry'),() => setScene('venues'),() => {
    setScene('site'); const first = coverageResult.value.blindAreas[0]; if (first) selectBlind(first.id)
  },() => setScene('investment'),() => setScene('events'),() => setScene('liveEvent'),() => setScene('tourism'),() => setScene('consumption'),() => setScene('merchants')]
  steps[index++]()
  tourTimer = setInterval(() => {
    if (index === steps.length) stopTour()
    else steps[index++]()
  },9500)
}
function stopTour() { touring.value = false; clearInterval(tourTimer) }
function escape(event:KeyboardEvent) {
  if (event.key !== 'Escape') return
  operations.value = undefined
  resultModal.value = false
  monthOpen.value = false
  regionOpen.value = false
  mapPopup.value = null
  detailOpen.value = false
}
onMounted(() => {
  void load()
  if (!publicView) void refreshCim()
  window.addEventListener('storage', onSharedChange)
  clockTimer = setInterval(() => { date.value = new Date() },1000)
  document.addEventListener('keydown',escape)
  document.addEventListener('fullscreenchange',syncFullscreen)
})
onUnmounted(() => {
  window.removeEventListener('storage', onSharedChange)
  clearInterval(clockTimer); clearInterval(tourTimer); clearTimeout(toastTimer)
  document.removeEventListener('keydown',escape)
  document.removeEventListener('fullscreenchange',syncFullscreen)
})
watch(venueTab,() => { if (venueTab.value === 'coverage') { proposal.value = undefined; parcelId.value = '' } })
watch([gapFilter,coverageMode,schools,offices,scenarioPeoplePerCourt,region,community],() => { gapLimit.value = 12 })
watch([facilitySearch,region,community],() => { facilityLimit.value = 12 })
watch([coverageMode,schools,offices,scenarioPeoplePerCourt,gapFilter],() => {
  if (page.value === 'venues' && blindId.value && !priorityAreas.value.some(item => item.id === blindId.value)) {
    blindId.value = undefined
    selectedId.value = null
    detailOpen.value = false
  }
})
watch([roadFilter,eventId,eventVenue], () => { roadListLimit.value = 12 })
watch([leftPanelOpen,rightPanelOpen], () => {
  if (eventCountyView.value && region.value === '京山市') mapAction('home')
  if (scene.value === 'consumption' && promotionFlow.value) fitPromotion()
}, { flush:'post' })
watch([group, publishedRoadLayer], ([value, published]) => {
  if (value.id === 'events' && !published) void loadReferenceRoads()
}, { immediate:true })

const fmt = (value:unknown) => typeof value === 'number' ? value.toLocaleString('zh-CN',{maximumFractionDigits:2}) : String(value ?? '—')
const percent = (value:number) => fmt(value) + '%'
const metric = (label:string,value:unknown,unit?:string):Metric => ({label,value:fmt(value),unit})
const section = (title:string, rows:Entry[], note?:string, style?:Section['style']):Section => ({title,rows,note,style})
const itemRow = (item:CityFeature,value?:string,detail?:string):Entry => ({
  label:item.properties.name,value,detail:detail ?? item.properties.region,action:() => focus(item),button:'定位',
})
const eventText = (item?:CityFeature) => item ? [dateOf(item), item.properties.venue, item.properties.level].filter(Boolean).join(' · ') : '当前区域暂无赛事'
function daysToEvent(item:CityFeature) {
  const start = Date.parse(dateOf(item) + 'T00:00:00+08:00')
  const days = Math.ceil((start - date.value.getTime()) / 86400000)
  return Number.isFinite(days) && days >= 0 && item.properties.status !== '已办结' ? ' · 距今 ' + days + ' 天' : ''
}
const resultStatus = {pending:'待接收',received:'办理中',completed:'已回流'} as const
const leadBlind = computed(() => baseCoverage.value.blindAreas[0])
const nextEventStats = computed(() => eventAssistance(eventData.value,futureEvent.value?.id,undefined,rules.value))
const leadCandidates = computed(() => siteResult.value.candidates.filter(item => item.compliant))
const resultsRows = computed<Entry[]>(() => results.value.slice(0,5).map(item => ({
  label:item.title, value:resultStatus[item.status],tone:item.status === 'completed' ? 'green' : 'amber',
  detail:item.department + ' · V' + item.version,action:() => {resultModal.value = true},button:'办理',
})))

const leftTitle = computed(() => meta.value.left)
const rightTitle = computed(() => shelterTopic.value ? '应急避难保障' : meta.value.right)
const leftMain = computed<Metric|undefined>(() => {
  if (isFacilityPage.value) return metric('场地总数', serviceCapacity.value.facilities.reduce((total,item) => total + item.totalCourts,0),'片')
  if (v3Panel.value) return v3Panel.value.left.main
  if (scene.value === 'overview') return metric(currentArea.value === '京山市' ? '全市网球场地' : '区域网球场地',counts.value.courts,'片')
  if (page.value === 'venues') {
    const {totalPopulation,capacityServedPopulation} = serviceCapacity.value
    return totalPopulation ? metric('计入场地容量的覆盖率',100 * capacityServedPopulation / totalPopulation,'%') : undefined
  }
  if (scene.value === 'industry') return metric('网球产业相关主体',industryAnalysis.value.total,'家')
  if (scene.value === 'talent') return metric('青少年网球参与率',talentAnalysis.value.rate,'%')
})
const leftMetrics = computed<Metric[]>(() => {
  if (isFacilityPage.value) return [
    metric('网球场馆',serviceCapacity.value.facilities.filter(v=>v.feature.properties.kind==='venue').length,'处'),
    metric('可计入供给',serviceCapacity.value.openCourts,'片'),
    metric('每片规划服务',serviceCapacity.value.peoplePerCourt,'人'),
  ]
  if (v3Panel.value) return v3Panel.value.left.metrics
  const t = tourismTotals.value
  const i = industryAnalysis.value
  const u = talentAnalysis.value
  const e = eventAnalysis.value
  switch (scene.value) {
    case 'overview': return [
      metric('每万人场地数',counts.value.population ? counts.value.courts * 10000 / counts.value.population : 0,'片'),
      metric('15分钟覆盖率',baseCoverage.value.coveredRate,'%'),metric('对外开放',counts.value.open,'片'),
      metric('年度赛历',events.value.length,'场'),metric('年参赛人次',events.value.reduce((sum,item) => sum + Number(item.properties.attendance || 0),0),'人次'),
      metric('高水平赛事',events.value.filter(item => ['国际','全国'].includes(String(item.properties.level))).length,'场'),
      metric('产业链主体',i.total,'家'),metric('在建项目',i.projectStatuses.active,'个'),metric('青少年学员',u.trainees,'人'),
    ]
    case 'venues': return venueTab.value === 'site' ? [
      metric('拟建场地',courtCount.value,'片'),metric('最小用地',siteResult.value.minimumArea,'㎡'),metric('合规候选',leadCandidates.value.length,'块'),
    ] : [
      metric('容量内服务',serviceCapacity.value.capacityServedPopulation,'人'),
      metric('服务圈外',serviceCapacity.value.outsidePopulation,'人'),
      metric('圈内场地不足',serviceCapacity.value.capacityShortfallPopulation,'人'),
    ]
    case 'events': return [metric('预计人数',e.attendance,'人'),metric('外地占比',e.visitorRate,'%'),metric('住宿需求',e.lodgingDemand,'床')]
    case 'tourism': return [metric('到场人次',t.attendance,'人'),metric('外地占比',t.visitorRate,'%'),metric('平均停留',t.stayDays,'天'),
      metric('带动住宿',t.nights,'间夜'),metric('带动消费',t.spend,'万元'),metric('景区转化率',t.conversion,'%')]
    case 'industry': return [metric('产业链主体',i.total,'家'),metric('俱乐部',i.clubs,'个'),metric('培训机构',i.training,'家'),
      metric('在建项目',i.projectStatuses.active,'个'),metric('规划项目',i.projectStatuses.planned,'个'),metric('在谈项目',i.projectStatuses.negotiating,'个')]
    case 'talent': return [metric('在训学员',u.trainees,'人'),metric('分级赛选手',u.players,'人'),metric('持证教练',u.coaches,'人'),
      metric('开课学校',u.teachingSchools,'所'),metric('校园场地',u.campusCourts,'片'),metric('培训机构',u.trainingCount,'家')]
    default: return []
  }
})
const rightMetrics = computed<Metric[]>(() => {
  if (shelterTopic.value) return [metric('登记场所',localShelters.value.length,'处'),
    metric('已定位',localShelters.value.filter(row => featureCenter(row)).length,'处'),
    metric('登记容纳人数',localShelters.value.reduce((sum,row) => sum + Number(row.properties.shelterCapacity ?? 0),0),'人')]
  if (!isFacilityPage.value) return v3Panel.value?.right.metrics ?? []
  const item = focusFacility.value
  return item ? [metric('场地总数',item.totalCourts,'片'),metric('可计入供给',item.openCourts,'片'),metric('测算服务人口',item.servedPopulation,'人')] : []
})
const rightMain = computed<Metric|undefined>(() => isFacilityPage.value || shelterTopic.value ? undefined : v3Panel.value?.right.main ?? (page.value === 'site' && parcel.value ?
  metric(parcel.value.name,parcel.value.compliant ? parcel.value.score : '未通过',parcel.value.compliant ? '分' : undefined) : undefined))
const leftSections = computed<Section[]>(() => {
  if (isFacilityPage.value) return [{
    ...section('场馆清单',facilityRows.value.slice(0,facilityLimit.value).map(item => ({
      label:item.name,value:item.totalCourts + ' 片',
      detail:item.region + ' · 可用 ' + item.openCourts + ' 片 · 测算服务 ' + fmt(item.servedPopulation) + ' 人',
      selected:item.id === facilityId.value,action:() => chooseFacility(item.id),button:'定位',
    })),facilityRows.value.length + ' 处','card'),
    empty:'当前范围没有匹配的网球场馆。',
  }]
  if (v3Panel.value && scene.value !== 'overview') return v3Panel.value.left.sections
  const c = coverageResult.value, e = eventAnalysis.value, t = tourismAnalysis.value, i = industryAnalysis.value, u = talentAnalysis.value
  switch (scene.value) {
    case 'overview': return [section('系统发现',[
      ...(leadBlind.value ? [{
        label:leadBlind.value.name + '服务覆盖不足',tone:'red' as const,value:'缺口 ' + leadBlind.value.gap + '片',
        detail:'常住 ' + fmt(leadBlind.value.population) + ' 人 · 未覆盖人口网格',
        action:() => {
          gapFilter.value = 'all'
          setScene('venues',false)
          const gap = serviceCapacity.value.priorityAreas.find(item => item.id === leadBlind.value?.id)
          if (gap) selectGap(gap)
        },button:'覆盖缺口',
      }] : []),
      ...(futureEvent.value ? [{
        label:nextEventStats.value.lodgingGap ? '下一场赛事床位不足' : '下一场赛事住宿可匹配',
        tone:nextEventStats.value.lodgingGap ? 'amber' as const : 'green' as const,
        value:nextEventStats.value.lodgingGap ? '缺 ' + fmt(nextEventStats.value.lodgingGap) + '床' : '可满足',
        detail:futureEvent.value.properties.name,action:() => chooseEvent(futureEvent.value!,'events'),button:'赛事引流',
      }] : []),
      ...(tourismEvent.value ? [{label:'赛后景区转化率 ' + percent(t.conversion),tone:'cyan' as const,
        detail:'外地客平均停留 ' + fmt(t.stayDays) + ' 天，可结合线路与票根优惠延长停留',
        action:() => setScene('consumption'),button:'融合发展'}] : []),
    ],'自动研判 · 点击直达','card')]
    case 'venues':
      if (venueTab.value === 'site') return [
        {...section('目标缺口',selectedGap.value ? [{
          label:selectedGap.value.name,value:'建议补 ' + selectedGap.value.gap + ' 片',
          detail:fmt(selectedGap.value.underservedPopulation) + ' 人待服务 · ' + densityLabel(selectedGap.value),
        }] : [],'来自覆盖缺口','card'),empty:'请从「覆盖缺口」选一个目标网格，或在地图上落点试算。'},
        section('筛选条件',[
          {label:'最低用地面积',value:fmt(siteResult.value.minimumArea) + ' ㎡',detail:'场地片数 × 单片用地指标'},
          {label:'初筛条件',detail:'面积、永久基本农田、生态保护红线、城镇开发边界。规划用途与权属需现场核实。'},
        ]),
        {...section('候选地块',(selectedGap.value ? siteResult.value.candidates : []).slice(0,10).map(item => ({
          label:item.name,detail:fmt(item.area) + '㎡ · 距目标 ' + fmt(Math.round(item.targetDistance ?? 0)) + ' 米 · ' +
            (item.reason || '预计缓解 ' + fmt(item.capacityRelief ?? item.newPopulation) + ' 人'),
          value:item.compliant ? item.score + '分' : '未通过',tone:item.compliant ? 'green' : 'red',
          action:() => chooseParcel(item.id),button:'查看',selected:parcel.value?.id === item.id,
        })), selectedGap.value ? '仅筛目标 ' + fmt(serviceCapacity.value.radiusM) + ' 米内' : undefined,'card'),
        empty:selectedGap.value ? '该网格服务范围内暂无已登记地块。可核查附近用地后补录，或在图上落点试算。' : '选择目标网格后查看邻近候选。'},
        section('用地审查',results.value.filter(item => item.scene === 'venues' && item.title.includes('用地审查')).slice(0,3).map(item => ({
          label:item.title,value:resultStatus[item.status],detail:item.department + ' · ' + item.createdAt.slice(0,10),
          action:() => {resultModal.value = true},button:'办理',
        })), '本地审查记录'),
      ]
      return [
        section('测算口径',[
          {label:'近似服务半径',value:fmt(serviceCapacity.value.radiusM) + ' 米'},
          {label:'每片规划服务人口',value:fmt(serviceCapacity.value.peoplePerCourt) + ' 人'},
          {label:'人口密集阈值',value:serviceCapacity.value.highDensityThreshold === null ? '未提供网格面积' :
            fmt(serviceCapacity.value.highDensityThreshold) + ' 人/km²',detail:'按京山市有人口且有面积的网格，取人口密度第 75 百分位。'},
        ],undefined,'card'),
        section('缺口类型',[
          {label:'服务圈外',detail:'在当前近似服务半径内找不到可用网球场。'},
          {label:'圈内场地不足',detail:'能到达场馆，但可用场地按规划标准测算后仍无法满足所有居民。'},
        ],undefined,'card'),
      ]
    case 'events': return [
      section('同类赛事参考',events.value.filter(item => item.id !== event.value?.id && item.properties.status === '已办结' &&
        item.properties.level === event.value?.properties.level).slice(-4).reverse().map(item => ({
        label:item.properties.name,value:fmt(item.properties.attendance) + '人 · ' + fmt(item.properties.days) + '天',
      })),'历史赛历'),
      section('赛前节点',[
        {label:'T−30',value:'方案生成',detail:'梳理部门保障资源及酒店床位'},
        {label:'T−15',value:'任务确认',detail:'核对接驳、医疗、交通和秩序'},
        {label:'T−7',value:'交通公告',detail:'完成演练及应急预案'},
        {label:'T−1',value:'现场检查',detail:'核对临时停车和各点位'},
        {label:'赛后',value:'效益评估',detail:'进入赛后复盘，复核流量和消费'},
      ]),
    ]
    case 'tourism': return [
      section('客源地排名',t.origins.map(item => ({
        label:String(item.properties.from ?? item.properties.name), value:fmt(item.properties.share) + '%',
        bar:Number(item.properties.share ?? 0) * 2.2,action:() => { viewVisitorFlows(); focus(item) },button:'查看',
      })), '报名聚合数据','bar'),
      postEventReview(v3Context.value),
    ]
    case 'industry': return [
      section('重点项目进度',i.projects.map(item => ({
        ...itemRow(item,fmt(item.properties.progress) + '%',String(item.properties.status ?? '')),bar:Number(item.properties.progress ?? 0),
      })),'项目台账','bar'),
      section('项目用地核查',i.projects.filter(item => item.properties.parcelId).slice(0,5).map(item => ({
        label:item.properties.name,value:String(item.properties.status ?? ''),
        action:() => {
          setScene('venues');setVenueTab('site')
          chooseParcel(String(item.properties.parcelId))
        },button:'查看地块',
      })),'复用选址规则','card'),
    ]
    case 'talent': return [
      section('学区参与率排名',u.regions.slice(0,10).map(item => ({
        label:item.name,value:percent(item.rate),bar:item.rate * 6,
        action:() => changeRegion(item.name),button:'下钻',
      })),'学员数 ÷ 青少年人口','bar'),
      section('年龄段分布',u.ageGroups.map(item => ({label:item.name,value:fmt(item.count) + '人',bar:item.percentage})),'聚合学员数据','bar'),
      section('培养建议',[
        {label:u.ageGroups[2].count < u.ageGroups[1].count ? '初中阶段学员减少' : '完善青少年培养梯队',
          detail:'将校园场地、社区供给和培训资源一并研判',tone:'amber',action:() => {schoolProfile.value = false},button:'空白识别'},
      ],undefined,'card'),
    ]
    default: return []
  }
})
const rightSections = computed<Section[]>(() => {
  if (shelterTopic.value) return [section('避难场所与储备物资',shelterPage.rows.map(row => ({
    label:row.properties.name,value:fmt(row.properties.shelterCapacity) + ' 人',
    detail:[row.properties.address,featureCenter(row) ? '已定位' : '待定位',row.properties.materialDetails].filter(Boolean).join(' · '),
    action:() => focus(row),button:'详情',selected:selectedId.value === row.id,
  })),currentArea.value,'card')]
  if (isFacilityPage.value) {
    const item = focusFacility.value
    return [{
      ...section(item?.name ?? '查看场馆',item ? [
          {label:'范围内居民',value:fmt(item.reachablePopulation) + ' 人',detail:'距场馆 ' + fmt(serviceCapacity.value.radiusM) + ' 米以内。与相邻场馆可能重叠。'},
        {label:'规划服务上限',value:fmt(item.capacity) + ' 人',detail:item.openCourts + ' 片可用场地 × 每片 ' + fmt(serviceCapacity.value.peoplePerCourt) + ' 人。'},
        {label:'测算服务人口',value:fmt(item.servedPopulation) + ' 人',detail:'在各场馆可用容量内分配居民，同一居民计入一家场馆。'},
      ] : [],undefined,'card'),
      empty:'在左侧清单选择场馆，地图将定位并显示该场馆的近似服务圈。',
    }]
  }
  if (v3Panel.value) return v3Panel.value.right.sections
  const c = coverageResult.value, e = eventAnalysis.value, t = tourismAnalysis.value, i = industryAnalysis.value, u = talentAnalysis.value
  const p = parcel.value
  switch (scene.value) {
    case 'overview': return [
      section('数据接入情况',departments.value.slice(0,7).map(item => ({
        label:item.name,value:item.count + '个图层',tone:'cyan',action:() => {catalogMode.value = 'department'; mapPopup.value = 'layers'},button:'图层',
      })),'按部门查看'),
      section('下一场赛事',futureEvent.value ? [{
        label:futureEvent.value.properties.name,detail:eventText(futureEvent.value) + daysToEvent(futureEvent.value),
        value:nextEventStats.value.lodgingGap ? '床位缺口 ' + fmt(nextEventStats.value.lodgingGap) : '住宿可匹配',tone:'amber',
        action:() => chooseEvent(futureEvent.value!,'events'),button:'进入推演',
      }] : [],'来自年度赛历','card'),
      section('成果回流市级“一张图”',resultsRows.value,'本地协同台账'),
    ]
    case 'venues':
      if (venueTab.value === 'site') return p ? [
        section('规划约束',[
          {label:'永久基本农田',value:p.farmland ? '占用' : '未占用',tone:p.farmland ? 'red' : 'green'},
          {label:'生态保护红线',value:p.ecology ? '占用' : '未占用',tone:p.ecology ? 'red' : 'green'},
          {label:'城镇开发边界',value:p.withinBoundary ? '界内' : '界外或待核实',tone:p.withinBoundary ? 'green' : 'red'},
        ],'规划约束叠加'),
        section('地块条件',[
          {label:'地块面积 / 可布置',value:fmt(p.area) + '㎡ / ' + p.courts + '片'},
          {label:'规划用途',value:p.use},{label:'权属',value:p.ownership},
          {label:'临近道路',value:p.roadAccess ? '是' : '否'},
        ]),
        section('服务增量',[
          ...(p.targetRelief === undefined ? [] : [{label:'目标网格预计缓解',value:fmt(p.targetRelief) + ' 人'}]),
          {label:'预计缓解服务缺口',value:fmt(p.capacityRelief ?? p.newPopulation) + ' 人',tone:'green',
            detail:'同时考虑周边待服务人口和拟建场地的规划容量。'},
          ...(p.targetDistance === null ? [] : [{label:'距目标网格中心',value:fmt(Math.round(p.targetDistance)) + ' 米'}]),
          {label:'附近学校',value:p.nearbySchools + '所'},
          ...(p.reason ? [{label:'核查结论',value:p.reason,tone:'red' as const}] : []),
        ],'按当前统计范围估算'),
      ] : [section('地块体检',[],'请选择候选地块或在地图落点')]
      return [
        {...section('覆盖不足网格',priorityAreas.value.slice(0,gapLimit.value).map(item => ({
          label:item.name,value:'建议补 ' + item.gap + ' 片',tone:item.capacityShortfall ? 'amber' as const : 'red' as const,
          detail:(item.capacityShortfall ? '圈内场地不足' : '服务圈外') + ' · ' + fmt(item.underservedPopulation) + ' 人待服务 · ' + densityLabel(item),
          selected:selectedGap.value?.id === item.id,action:() => selectGap(item),button:'定位',
        })),priorityAreas.value.length + ' 个 · 优先人口密集区','card'),
        empty:!serviceCapacity.value.totalPopulation ? '当前范围缺少可用于测算的人口网格。' : '当前筛选下没有覆盖不足的网格。'},
      ]
    case 'events': return [
      section('交通管控研判',[
        {label:'核心区',value:fmt(e.coreM) + ' 米 · 红色封闭段',tone:'red'},
        {label:'缓冲区',value:fmt(e.bufferM) + ' 米 · 橙色限行段',tone:'amber'},
        {label:'分流区',value:fmt(e.diversionM) + ' 米 · 接驳与分流参考',tone:'green'},
      ], e.roadControls.some(item => item.properties.planSource === 'published') ? '已发布方案' : '模拟测算 · 待交警复核'),
      {
        ...section('管控路段清单',listedRoads.value.slice(0,roadListLimit.value).map(item => {
          const { action, zone, sectionName, sectionCode, lengthM, roadClass, startAt, endAt } = item.properties
          return {label:[sectionCode,item.properties.name].filter(Boolean).join(' · '),value:fmt(action),tone:item.properties.controlStatus === 'closed' ? 'red'
            : item.properties.controlStatus === 'restricted' ? 'amber' : 'green',
            detail:[sectionName || zone,roadClass,fmt(lengthM) + ' 米',startAt && endAt ? String(startAt) + ' 至 ' + endAt : ''].filter(Boolean).join(' · '),
            selected:selectedId.value === item.id,action:() => selectRoad(item),button:'定位'}
        }),roadCounts.value.closed + ' 条建议封闭 · ' + roadCounts.value.restricted + ' 条建议限行','card'),
        empty:!event.value ? '请选择赛事与场馆' : roadLoad.value === 'loading' ? '正在读取京山道路网'
          : roadLoad.value === 'error' && !publishedRoadLayer.value ? '道路网暂未载入，可在地图上重试'
          : e.roadControls.length ? '当前筛选暂无路段' : e.bufferM ? '当前范围暂无可匹配的道路段' : '当前规模无需生成管控范围',
      },
      section('停车、医疗与住宿',[
        {label:'停车需求 / 供给 / 缺口',value:[e.parkingDemand,e.parkingSupply,e.parkingGap].map(fmt).join(' / '),tone:e.parkingGap ? 'red' : 'green'},
        {label:'医疗点 / 救护车',value:e.medicalPoints + '处 / ' + e.ambulances + '辆'},
        {label:'最近医院预计到达',value:e.hospitalMinutes == null ? '待核实' : fmt(e.hospitalMinutes) + '分钟'},
        {label:'住宿床位 / 缺口',value:fmt(e.lodgingSupply) + ' / ' + fmt(e.lodgingGap),tone:e.lodgingGap ? 'red' : 'green'},
        {label:'餐饮巡查点',value:e.food.length + '处'},
        {label:'许可提示',detail:e.restriction,tone:'amber'},
      ],'演示参数 · 需人工复核'),
      section('酒店对接清单',e.matchHotels.slice(0,8).map(item => itemRow(item.feature,fmt(item.capacity) + '床',fmt(item.distanceM) + '米')),'由近及远'),
      section('安全保障',[
        {label:'安保方案',value:String(event.value?.properties.securityPlan ?? '待核实')},
        {label:'大型活动安全许可',value:String(event.value?.properties.permitStatus ?? '待核实')},
      ],'赛事记录与测算'),
      section('部门任务清单',savedSceneResults.value.slice(0,7).map(item => ({
        label:item.department,value:resultStatus[item.status],detail:item.title,
        action:() => {resultModal.value = true},button:'办理',
      })),'本地协同台账'),
    ]
    case 'tourism': {
      const total = tourismTotals.value
      return [
        section('转化漏斗',[
          {label:'到场人次',value:fmt(total.attendance),bar:100},
          {label:'住宿人数',value:fmt(total.overnightGuests),bar:total.attendance ? total.overnightGuests / total.attendance * 100 : 0},
          {label:'游览景区',value:fmt(total.scenicVisitors),bar:total.conversion},
          {label:'二次消费',value:fmt(total.secondarySpendVisitors),bar:total.attendance ? total.secondarySpendVisitors / total.attendance * 100 : 0},
        ],'到场 → 住宿 → 游览 → 消费','funnel'),
        section('系统洞察',[
          {label:total.conversion < 30 ? '赛事客流向景区转化偏低' : '景区承接赛事客流表现良好',
            detail:'当前转化率 ' + percent(total.conversion) + '，可结合赛事地与推荐路线优化接驳。',tone:'cyan',
            action:() => {period.value = 'event'; setScene('consumption')},button:'融合发展'},
        ],'自动生成','card'),
        section('年度赛事效益排名',t.ranking.slice(0,8).map((item,index) => ({
          label:(index+1) + ' · ' + item.properties.name, value:fmt(item.properties.spend) + '万元',
          action:() => chooseEvent(item,'tourism'),button:'单场',
        })),'按带动消费排序'),
      ]
    }
    case 'industry': return [
      ...i.stages.map((item,index) => section(item.name + ' · ' + ['装备器材和场地建设','赛事培训和场馆运营','配套服务'][index],
        item.subtypes.map(group => ({label:group.name,value:group.count + '家',tone:group.count <= 3 ? 'amber' : 'cyan'})),
        item.count + '家（' + percent(item.percentage) + '）')),
      section('系统研判',i.gaps.slice(0,5).map(item => ({
        label:item.name,value:item.count + '家',tone:'amber',detail:item.stage + ' · 可纳入产业补链清单',
      })),'薄弱环节','card'),
    ]
    case 'talent': return schoolProfile.value && school.value ? [
      section('学校画像 · ' + school.value.name,[
        {label:'在校学生 / 校内场地',value:fmt(school.value.students) + '人 / ' + (school.value.courts === undefined ? '待补录' : school.value.courts + '片')},
        {label:'开展网球教学',value:school.value.teaching === undefined ? '待补录' : school.value.teaching ? '已开课' : '未开课',tone:school.value.teaching ? 'green' : 'amber'},
        {label:'周边 1 公里开放场地',value:school.value.nearbyOpenCourts + '片'},
        {label:'周边 1 公里培训机构',value:school.value.nearbyTraining + '家'},
      ]),
      section('周边学校',u.schools.slice(0,10).map(item => ({label:item.name,value:item.region,action:() => selectSchool(item.id),button:'画像'}))),
    ] : [
      section('有场地未开课',u.withCourtsWithoutTeaching.slice(0,7).map(item => ({
        label:item.name,detail:'学生 ' + fmt(item.students) + '人 · 场地 ' + item.courts + '片',
        value:'建议开课',tone:'amber',action:() => selectSchool(item.id),button:'画像',
      })),u.withCourtsWithoutTeaching.length + '所','card'),
      section('有学生无场地',u.withoutCourts.slice(0,7).map(item => ({
        label:item.name,detail:'学生 ' + fmt(item.students) + '人 · ' + item.region,
        value:'无场地',tone:'red',action:() => selectSchool(item.id),button:'画像',
      })),u.withoutCourts.length + '所','card'),
      section('叠加研判',u.priorityZones.slice(0,6).map(item => ({
        label:item.properties.name,detail:'同时位于服务盲区与无场地学校周边',value:'优先建设',tone:'red',
        action:() => selectBlind(String(item.properties.blindId ?? '')),button:'转场地选址',
      })),'场地布局联动','card'),
    ]
    default: return []
  }
})
const selectedProperties = computed(() => {
  const feature = selectedFeature.value
  if (!feature) return []
  if (feature.properties.registerSource && feature.properties.resourceClass) {
    const p=feature.properties
    return [['类型',p.resourceClass],['等级',p.grade],['地址',p.address],['运营主体',p.operator],['定位类型',p.locationPrecision]]
      .filter((row):row is [string,string]=>typeof row[1]==='string' && row[1].length>0)
  }
  if (feature.properties.kind === 'population-grid') {
    const {population, densityPerKm2} = feature.properties
    const {sourceCells, coveredPopulation, minCourts, maxCourts} = feature.properties
    const rows = [nativePopulation.value ? ['数据来源','建筑归集实有人口 · 100 米'] : ['估算年份','2025 年']]
    if (typeof sourceCells === 'number') rows.push(['显示网格','约 500 米'],['参与汇总',fmt(sourceCells)+' 个 100 米网格'])
    const planned=feature.properties.plannedPopulation
    const populationLabel=openingGapMap.value?'开放前高密度缺口人口':sourceCells && populationOverview.value && populationView.value!=='all'?'筛选范围内人口':'格内人口'
    rows.push([populationLabel, typeof population === 'number' ? fmt(population) + ' 人' : '无数据'],
      ['人口密度', typeof densityPerKm2 === 'number' ? fmt(densityPerKm2) + ' 人/km²' : '无数据'])
    if(typeof planned==='number' && typeof population==='number')rows.push(['方案新增覆盖',fmt(planned)+' 人'],['剩余高密度缺口',fmt(population-planned)+' 人'])
    if (typeof coveredPopulation === 'number') {
      const radius = populationRadiusM.value / 1000 + ' 公里'
      rows.push([radius+'已覆盖人口',fmt(coveredPopulation)+' 人'],
        ['覆盖单个原始网格的球场',(minCourts === maxCourts ? fmt(minCourts) : fmt(minCourts)+'–'+fmt(maxCourts))+' 片'])
    } else if (populationOverview.value) {
      const pixel=nativePopulation.value && rasterCellById(nativePopulation.value,feature.id)
      const count=pixel ? nativeCoverage.value?.counts[pixel.block.offset+pixel.index] : courtCoverage.value.courtCounts.get(feature.id)
      rows.push([populationRadiusM.value / 1000 + ' 公里内实测球场', count === undefined ? '待核实' : count ? count + ' 片 · 已覆盖' : '0 片 · 未覆盖'])
    }
    return rows
  }
  if (feature.properties.kind === 'court-footprint') {
    const rows = courtFootprintDetails(feature)
    if (venueMapContext.value) {
      const tally = (nativeCoverage.value ?? courtCoverage.value).byCourt.get(feature.id)
      const people = tally && estimatedPeople(tally, !!nativePopulation.value || populationGrid.value.hasPopulation)
      rows.unshift([populationRadiusM.value / 1000 + ' 公里覆盖人口', people === undefined ? '无数据' : fmt(people) + ' 人（估算）'])
    }
    return rows
  }
  if(feature.properties.ledgerId) return ledgerDetails(feature)
  const isVenue=feature.properties.kind==='venue'||feature.properties.kind==='court'
  const fieldsForDisplay=isVenue ? {...feature.properties,ownership:venueOwnershipGroup(feature.properties.ownership)?.shortLabel ?? feature.properties.ownership} : feature.properties
  if (feature.properties.recordSource) {
    const fields = ['address','type','rooms','beds','price','shelterCapacity','materialQuantity','materialDetails',
      'chargeType','gunCount','gunPowerKw','totalPowerKw','commissionedOn','locationSource','recordSource']
    if(isVenue)fields.unshift('ownership')
    const properties:Record<string,unknown> = {...fieldsForDisplay, locationSource:featureCenter(feature) ? feature.properties.locationSource || '已定位' : '待定位'}
    return fields.flatMap(key => properties[key] == null ? [] : [[key,properties[key]] as const])
  }
  return Object.entries(fieldsForDisplay).filter(([key,value]) =>
    !['name','kind','color','sourceId','id','region','controlStatus','eventId','venueId','planSource'].includes(key) &&
    ['string','number','boolean'].includes(typeof value)).slice(0,10)
})
const selectedRoadEndpoints = computed(() => {
  const geometry = selectedFeature.value?.geometry
  const coordinates = geometry?.type === 'LineString' ? geometry.coordinates
    : geometry?.type === 'MultiLineString' && geometry.coordinates.length === 1 ? geometry.coordinates[0] : undefined
  if (!coordinates?.length) return undefined
  return [coordinates[0],coordinates.at(-1)!].map(point => point.slice(0,2).map(value => value.toFixed(5)).join(', '))
})
const propertyNames:Record<string,string> = {
  boundaryAreaM2:'边界面积（㎡）',registrationCode:'统一识别码',operator:'管理单位',updatedAt:'数据更新时间',sourceRow:'原始记录号',originalName:'原图名称',
  address:'地址',type:'类别',rooms:'客房数',price:'平均房价（元）',shelterCapacity:'可容纳人数',materialQuantity:'物资登记数量',materialDetails:'储备物资',
  chargeType:'充电类型',gunCount:'充电枪数',gunPowerKw:'单枪功率（kW）',totalPowerKw:'总功率（kW）',commissionedOn:'投运日期',locationSource:'空间位置',recordSource:'填报来源',
  facilityName:'场馆',courtCode:'场地编号',courtNumber:'片号',courtNo:'片号',ownership:'权属',open:'对外开放',surface:'面层',lighting:'灯光',
  count:'数量',status:'状态',area:'面积（㎡）',population:'人口',youth:'青少年',beds:'床位',available:'可用床位',
  spaces:'车位',progress:'进度',attendance:'预计人数',use:'规划用途',teaching:'开课',students:'学生人数',
  action:'建议措施',zone:'管控范围',roadClass:'道路等级',lengthM:'区内长度（米）',sectionName:'路段范围',sectionCode:'路段编号',startAt:'开始时间',endAt:'结束时间',
  from:'客源地',to:'流向场馆',share:'客源占比（%）',people:'估算人数',
}
const occupancy = computed(() => tourismAnalysis.value.occupancy.slice(0,5))
const occupancyPath = computed(() => occupancy.value.map((value,index) =>
  [18 + index * (264 / Math.max(1,occupancy.value.length-1)),90 - value * .76].join(',')).join(' '))
const trend = computed(() => v3Panel.value?.trend)
const trendPath = computed(() => {
  const values = trend.value?.values ?? []
  const max = Math.max(1,...values)
  return values.map((value,index) => [18 + index * (264 / Math.max(1,values.length-1)),75 - value / max * 61].join(',')).join(' ')
})
const eventSnapshots = computed(() => rawLayer('event_live').filter(item => item.properties.eventId === event.value?.id)
  .map(item => String(item.properties.date ?? '')).filter(Boolean).sort())
const maxAttendance = computed(() => Math.max(8000, Number(event.value?.properties.attendance ?? 0) * 2))
const selectedReportTitle = computed(() => meta.value.report)
const reportName = computed(() => currentArea.value + ' · ' + selectedReportTitle.value)
function reportText() {
  const sections = [...leftSections.value,...rightSections.value]
  const tables = sections
    .filter(group => group.title !== '管控路段清单')
    .map(group => ['## ' + group.title,...group.rows.map(item => '- ' + [item.label,item.value,item.detail].filter(value => value !== undefined).join(' · '))].join('\n'))
  if (page.value === 'events' && eventAnalysis.value.roadControls.length) {
    const rows = eventAnalysis.value.roadControls.map(({properties:p}) =>
      '- ' + [p.sectionCode,p.name,p.action,p.sectionName,p.lengthM + ' 米',p.startAt && p.endAt ? p.startAt + ' 至 ' + p.endAt : ''].filter(Boolean).join(' · '))
    tables.unshift('## 管控路段清单\n' + rows.join('\n'))
  }
  return ['# ' + reportName.value,
    '数据版本 V' + data.value?.version + ' · ' + dataModeLabel.value,
    ...leftMetrics.value.map(item => '- ' + item.label + ' ' + item.value + (item.unit ?? '')),
    ...tables,'',scene.value === 'venues' || scene.value === 'events' ? '覆盖及到达时间为近似估算，需结合实际路网、现场条件与部门复核。' : '按本系统当前发布数据和分析参数生成。',
  ].join('\n\n')
}
function exportReport() { downloadFile(reportName.value + '.md',reportText(),'text/markdown;charset=utf-8');showToast('报告已导出') }
function exportList() {
  const cell = (value:unknown) => {
    const string = String(value ?? '')
    return '"' + (/^[=+\-@]/.test(string) ? "'" : '') + string.replaceAll('"','""') + '"'
  }
  if (page.value === 'venues') {
    const rows = priorityAreas.value.map(item => [
      item.name,item.region,item.capacityShortfall ? '圈内场地不足' : '服务圈外',
      item.population,item.densityPerKm2,item.underservedPopulation,item.gap,
    ].map(cell).join(','))
    downloadFile(currentArea.value + '-网球服务覆盖缺口.csv',
      '\uFEFF网格,街镇,缺口类型,常住人口,人口密度（人每平方公里）,待服务人口,建议补建片数\r\n' + rows.join('\r\n'),'text/csv;charset=utf-8')
    showToast('已导出当前筛选的覆盖缺口')
    return
  }
  const rows = rightSections.value.flatMap(group => group.rows.map(item => [group.title,item.label,item.value,item.detail].map(cell).join(',')))
  downloadFile(currentArea.value + '-' + meta.value.label + '-清单.csv','\uFEFF分类,名称,值,说明\r\n' + rows.join('\r\n'),'text/csv;charset=utf-8')
  showToast('清单已导出')
}
function exportResources() {
  const allowed = resourceFilter.value === 'all' ? ['courts','venues','court_footprints','businesses','projects','merchants','training',...Object.keys(commerceChainTopics)]
    : {courts:['courts','venues','court_footprints'],subjects:['businesses','training'],projects:['projects'],support:['merchants',...Object.keys(commerceChainTopics)]}[resourceFilter.value]
  const features = allowed.flatMap(id => rawLayer(id)).filter(item => inRegion(item) && inCommunity(item))
  downloadFile(currentArea.value + '-产业资源.geojson',JSON.stringify({type:'FeatureCollection',features},null,2),'application/geo+json')
  showToast('已导出 ' + features.length + ' 项资源')
}
function resultFeatures() {
  if(investmentScene.value)return (sceneMap.value?.features??[]).filter(f=>f.properties.mapRole==='candidate' && f.properties.selected===true && f.properties.inBusinessArea===true && screenedParcel(f))
  if (scene.value === 'venues') return priorityAreas.value.map(item => item.feature)
  if (isActiveEvent.value) return eventAnalysis.value.overlays
  if (scene.value === 'tourism') return tourismAnalysis.value.overlays
  if (scene.value === 'talent') return talentAnalysis.value.priorityZones
  if (scene.value === 'industry') return industryAnalysis.value.projects
  if (page.value === 'consumption') return fusionMap.value?.features ?? []
  if (scene.value === 'merchants') return rawLayer('merchants').filter(item => item.properties.status === '已入驻')
  return []
}
async function sendResult(department = meta.value.department, purpose = selectedReportTitle.value) {
  if (!data.value || busy.value) return
  busy.value = true
  try {
    const item = {
      scene:scene.value,title:currentArea.value + ' · ' + purpose,department,summary:reportText().slice(0,9000),
      version:data.value.version,features:resultFeatures(),
    }
    let entries:Result[]
    if (scene.value === 'events') {
      const tasks = [
        ['公安交警','交通管制',['event-core','event-buffer','road-control']],
        ['交通运输局','临停与接驳',['event-diversion','shuttle']],
        ['卫健局','医疗保障',['medical-point','hospital-route']],
        ['文旅局','住宿对接',['event-hotel']],
        ['市场监管局','餐饮巡查',[]],
        ['应急管理局','应急协调',['event-core','medical-point']],
        ['属地街镇','现场秩序',['event-core','event-buffer']],
      ] as const
      entries = await api('/results/batch',jsonRequest('POST',{version:data.value.version,items:tasks.map(([office,title,kinds]) => ({
        ...item, title:[currentArea.value,event.value?.properties.name,title].filter(Boolean).join(' · ').slice(0,150),department:office,
        features:item.features.filter(feature => kinds.some(kind => kind === feature.properties.kind)).slice(0,300),
      }))}))
    } else entries = [await api('/results',jsonRequest('POST',{...item,features:item.features.slice(0,300)}))]
    results.value = [...entries.reverse(),...results.value]
    resultModal.value = true
    showToast(scene.value === 'events' ? '已生成 ' + entries.length + ' 项本地保障任务' : '成果已进入本地协同台账 · ' + department)
  } catch (error) { showToast(error instanceof Error ? error.message : '保存成果失败') }
  finally { busy.value = false }
}
function filterResources(value:typeof resourceFilter.value) {
  resourceFilter.value = value
  selectedId.value = null
  detailOpen.value = false
  facilityId.value = undefined
  layerState.value = {}
  if (value === 'support') setLayers(['merchants',...Object.keys(commerceChainTopics),'hotels','food','tourism'])
  if (value === 'subjects') setLayers(['businesses','training'])
  if (value === 'courts') setLayers(['court_footprints','service'])
  if (value === 'all') setLayers(['court_footprints','businesses','projects','merchants',...Object.keys(commerceChainTopics)])
  if (value === 'projects') setLayers(['projects'])
}
async function updateResult(item:Result) {
  if (item.status === 'completed' || busy.value) return
  busy.value = true
  try {
    const updated = await advanceResult(item)
    if (updated.status === 'completed') resultLayer.value = true
    showToast('成果状态：' + resultStatus[updated.status])
  } catch (error) { showToast(error instanceof Error ? error.message : '状态更新失败') }
  finally { busy.value = false }
}
async function advanceResult(item:Result) {
  const updated = await api<Result>('/results/' + item.id,jsonRequest('PATCH',{status:item.status === 'pending' ? 'received' : 'completed'}))
  results.value = results.value.map(row => row.id === updated.id ? updated : row)
  return updated
}
async function submitIndustryResult(payload:{title:string; department:string; summary:string; features:CityFeature[]}) {
  if (!data.value) throw new Error('请先载入已发布数据')
  const saved = await api<Result>('/results',jsonRequest('POST',{
    ...payload,scene:'investment',version:data.value.version,features:payload.features.slice(0,300),
  }))
  results.value = [saved,...results.value]
  return saved
}
function showResult(item:Result) {
  if (!item.features.length) {showToast('该成果无空间要素');return}
  if (item.scene !== 'talent') {
    setScene(item.scene)
    if (item.scene === 'tourism') {
      const origin = item.features.find(feature => feature.properties.kind === 'origin')
      const id = origin?.properties.eventId
      if (typeof id === 'string') selectTourismEvent(id)
      setLayers(['origins','routes'])
    }
  }
  replayResultId.value = item.id
  resultLayer.value = true
  resultModal.value = false
  focus(item.features[0])
}
</script>

<template>
  <main v-if="publicView" class="jt-screen public-preview">
    <V3Operations v-if="data" panel="app" :published="data" @close="closePublicView" />
    <div v-else class="load-notice" role="status">{{ loadError || '正在载入京网通…' }} <button v-if="loadError" type="button" @click="load">重试</button></div>
  </main>
  <main v-else class="jt-screen" :class="{ 'cockpit-light':isLight, 'v14-events':page === 'events', 'v14-live-events':page === 'liveEvent', 'v14-review':page === 'tourism', 'v14-overview':isOverview, 'v14-panorama':page === 'industry', 'v14-services':page === 'venues', 'v14-fusion':fusionScene, 'v14-investment':page === 'investment' || page === 'site' }"
    @pointerdown.capture="dismissHomeRegionOutside">
    <header class="jt-header" @keydown.esc="homeMenuOpen = false">
      <div class="header-left">
        <button class="header-return" type="button" @click="returnToOverview">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
            <path d="m2 9 8-7 8 7M4 8v9h12V8M8 17v-5h4v5"/>
          </svg>
          首页
        </button>
        <time :datetime="date.toISOString()">
          <svg v-if="isLight" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" aria-hidden="true">
            <circle cx="10" cy="10" r="8"/><path d="M10 5.5v5h4"/>
          </svg>
          <span v-else aria-hidden="true">◷</span>
          {{ formatTime.format(date) }}
        </time>
      </div>
      <h1 class="jt-title">数智京山网旅产业一张图</h1>
      <div class="header-right">
        <button class="theme-switch" type="button" :aria-label="isLight ? '切换深色版' : '切换浅色版'"
          :title="isLight ? '切换深色版' : '切换浅色版'" @click="toggleCockpitTheme">
          <svg v-if="isLight" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M20.5 14.2A8.7 8.7 0 0 1 9.8 3.5a8.7 8.7 0 1 0 10.7 10.7Z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/>
          </svg>
        </button>
        <div class="home-user-control">
          <button class="home-user-trigger" type="button" :aria-expanded="homeMenuOpen" aria-controls="overview-user-menu" @click="homeMenuOpen = !homeMenuOpen">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="5.2" r="3.15"/><path d="M3.6 17v-2a6.4 6.4 0 0 1 12.8 0v2z"/></svg>
            {{ dataModeLabel }}
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 8 5 5 5-5" stroke="currentColor" stroke-width="1.8"/></svg>
          </button>
          <div v-if="homeMenuOpen" id="overview-user-menu" class="home-user-menu">
            <a href="/?app=jingwangtong" target="_blank" rel="noopener" @click="homeMenuOpen = false">京网通</a>
            <a href="/admin/" target="_blank" rel="noopener" @click="homeMenuOpen = false">时空大数据管理平台</a>
            <button type="button" :aria-pressed="assistantVisible" @click="setAssistantVisible(!assistantVisible); homeMenuOpen = false">{{ assistantVisible ? '隐藏智能助手' : '显示智能助手' }}</button>
            <button type="button" @click="toggleFullscreen(); homeMenuOpen = false">{{ fullScreen ? '退出全屏' : '全屏' }}</button>
            <button type="button" :aria-pressed="mapOnly" @click="leftPanelOpen = rightPanelOpen = mapOnly; homeMenuOpen = false">{{ mapOnly ? '恢复双栏' : industryDiagnosis ? '铺满图谱' : '铺满地图' }}</button>
          </div>
        </div>
      </div>
    </header>

    <div v-if="loadError" class="load-notice" role="alert">
      无法载入已发布数据 · {{ loadError }} <button type="button" @click="load">重试</button>
    </div>

    <EventPreassessment v-if="eventPage === 'events'" ref="eventPreassessmentRef" :initial-id="eventId" :datasets="datasets" :version="data?.version"
      :light="isLight" :imagery="data?.data.imagery" :cim-layers="visibleCim" :loading="loading"
      :task-states="results.filter(r=>r.scene==='events').map(r=>r.id+':'+r.status).join(',')" @navigate="setScene"
      @tasks="refreshEventResults(true)" @dispatched="refreshEventResults()" @withdraw-tasks="ids => results=results.filter(task=>!ids.includes(task.id))"/>
    <EventLiveCoordination v-else-if="eventPage === 'liveEvent'" :initial-id="eventId" :datasets="datasets" :version="data?.version"
      v-model:left-open="leftPanelOpen" v-model:right-open="rightPanelOpen" :light="isLight" :imagery="data?.data.imagery" :cim-layers="visibleCim"/>
    <EventPostReview v-else-if="eventPage === 'tourism'" v-model:selected-id="tourismId" v-model:left-open="leftPanelOpen" v-model:right-open="rightPanelOpen"
      :document="data?.data" :version="data?.version" :region="region" :light="isLight" :cim-layers="visibleCim"/>
    <div v-else class="jt-body" :class="{ 'overview-rail-layout': isOverview || industryPanel || fusionScene, 'left-collapsed': !leftPanelOpen, 'right-collapsed': !rightPanelOpen, 'map-only': mapOnly, 'chain-analysis-view': industryDiagnosis }">
      <CityMap class="live-map" :inert="industryDiagnosis" :aria-hidden="industryDiagnosis || undefined" :overview="isOverview" :cluster-court-footprints="layerEnabled('court_footprints')" :features="mapFeatures" :region="region" :selected-id="selectedId" :command="command" :imagery="imagery" :show-town-boundaries="layerEnabled('townBoundaries') && !serviceReplaces('townBoundaries')" :show-subject-counts="page === 'industry' && !isFacilityPage"
        :isolate-region="(countyMapView || thematicScene) && !community"
        :panorama="page === 'industry'" :business-scene="thematicScene || fusionScene" :center-district-clusters="page === 'venues'"
        :density-cells="densityCells" :density-raster="attributeRasterView ?? nativeDisplay" :attribute-pixels="attributeRaster?attributeIds:undefined" :attribute-service-id="attributeSource?.service?.id" :density-range="attributeRaster?undefined:serviceDetailRange"
        :highlighted-service-venue="highlightedServiceVenue"
        :select-court-facility="isFacilityPage || page === 'venues'"
        :light-theme="isLight || countyMapView || thematicScene || fusionScene" :service-labels-light="isLight"
        :venue-detail="venueDetailOnMap" :preserve-camera="keepServiceCamera" :investment-relief="investmentScene" :county-relief="investmentScene || venueMapContext || (countyMapView && !keepServiceCamera)"
        :show-scale="!isOverview"
        :road-network="visibleRoads" :road-controls="visibleRoadControls"
        :administration="administrative" :community-boundaries="communities" :published-boundary-index="publishedBoundaryIndex" :court-scope="courtScope"
        :imagery-config="data?.data.imagery" :promotion-flow="promotionFlow" :fusion-scene="fusionScene"
        :cim-layers="visibleCim" :cim-catalog-ready="cimCatalogReady && !loading" @cim-status="cimStates[$event.id] = $event" @cim-pick="onCimPick"
        :promotion-view="page === 'consumption' && Boolean(fusionMap?.regional)"
        @camera="camera = $event" @select="selectMapFeature"
        @pointerdown.capture.passive="cancelPendingRoadFocus" @wheel.capture.passive="cancelPendingRoadFocus"
        @position="acceptPosition" @measurement="measured = $event" />
      <button v-if="!leftPanelOpen || (!thematicScene && industryPanel !== IndustryPanorama)" class="panel-toggle toggle-left" :class="{'industry-panel-toggle':industryPanel || fusionScene}" type="button" :aria-expanded="leftPanelOpen" aria-controls="dashboard-left"
        :aria-label="leftPanelOpen ? '收起左侧面板' : '展开左侧面板'" @click="leftPanelOpen = !leftPanelOpen">
        <span aria-hidden="true">{{ leftPanelOpen ? '‹' : '›' }}</span>{{ leftPanelOpen ? '收起' : '左栏' }}
      </button>
      <component v-if="industryPanel" :is="industryPanel" :key="page" :datasets="datasets" :rules="rules"
        :mode="data?.data.mode ?? 'live'" :region="region" :left-open="leftPanelOpen" :right-open="rightPanelOpen"
        :selected-feature="selectedFeature" :results="results"
        v-bind="industryPanel === IndustryInvestment ? {
          scopedReserves:siteLayers?scopedReserves:[], version:data?.version, siteLoadState, candidateInScope:inCommunity, reserveAreaName:currentArea, initialTab: page === 'site' ? 'site' : undefined, submitResult: submitIndustryResult, advanceResult, mapPick:serviceMapPick,getGapSelection:getInvestmentGapSelection,populationRadiusM,
        } : industryPanel === IndustryServices ? { cameraHeight:camera.height,communityId:community,planningData,version:data?.version??0,plans:servicePlans,today:diagnosisDate,mapPick:serviceMapPick, serviceResources, scheduleWarning,
          coverageSummary, populationView, populationRadiusM, populationVisible:densityVisible, populationArea:currentCommunity?.properties.name || sceneMap?.populationRegion || region, venuePopulation } : { diagnosing: industryDiagnosis, mapPick: serviceMapPick }"
        v-on="industryPanel === IndustryPanorama ? {'clear-highlight': clearIndustryHighlight, 'map-enterprises': setPanoramaPoints, 'diagnosis-change': setIndustryDiagnosis}
          : industryPanel === IndustryServices ? {'scene-map':applySceneMap,'select-court':highlightVenueCourt,'highlight-venue': (id:string|undefined)=>highlightedServiceVenue=id,
            'population-view':selectPopulationView,'population-radius':(meters:number)=>populationRadiusM=meters} : {'scene-map':applySceneMap,'investment-record':(row:Result)=>{results=[row,...results.filter(r=>r.id!==row.id)];announceDataChange('results')},'retry-site':()=>{if(siteLoadState)void load();siteLoadAttempt++},'reserve-zoom':zoomReserveTown,'reserve-enable':()=>layerState[reserveLayerId]=true,'venue-population':(needed:boolean)=>investmentNeedsGrid=needed}"
        @locate="locateIndustryFeature" @close="closeIndustryRail" @open="openIndustryRail" />
      <FusionDashboard v-else-if="page === 'consumption'" :datasets="datasets" :today="diagnosisDate" :mode="data?.data.mode ?? 'live'"
        :left-open="leftPanelOpen" :right-open="rightPanelOpen" :map-pick="fusionPick" @map-view="applyFusionMap" @open-right="openIndustryRail('right')" @operations="openOperations" />
      <div v-else-if="isOverview" v-show="leftPanelOpen" id="dashboard-left" class="v14-overview-rail-shell left-panel"
        role="region" aria-label="左侧家底面板" tabindex="0">
        <OverviewReferenceRails :datasets="datasets" :region="region" :court-features="data ? scopedFootprints : undefined"
          :demo="data?.data.mode === 'demo'" />
      </div>
      <DashboardPanel v-else :variant="page === 'merchants' ? 'industry' : undefined" v-show="leftPanelOpen" id="dashboard-left" side="left" :title="leftTitle" :main="leftMain" :metrics="leftMetrics" :sections="leftSections">
        <template #before>
          <div v-if="scene === 'industry'" class="segments" role="group" aria-label="产业资源类型">
            <button v-for="[value,label] in [['courts','场馆'],['subjects','主体'],['projects','项目'],['support','配套'],['all','全部']] as const"
              :key="value" type="button" :class="{on:resourceFilter === value}" :aria-pressed="resourceFilter === value" @click="filterResources(value)">{{ label }}</button>
          </div>
          <input v-if="isFacilityPage" v-model.trim="facilitySearch" class="facility-search" type="search" placeholder="搜索场馆或街镇" aria-label="搜索场馆或街镇" />
          <template v-if="scene === 'venues' && venueTab === 'coverage'">
            <div class="segments travel-segments">
              <button v-for="[key,label] in [['walk','步行15分钟'],['cycle','骑行15分钟'],['drive','驾车10分钟']] as const"
                :key="key" type="button" :class="{on:coverageMode === key}" @click="coverageMode = key">{{ label }}</button>
            </div>
            <div class="control-card amber-card">
              <h3>错时开放模拟</h3>
              <label class="toggle-line"><input v-model="schools" type="checkbox" role="switch" /><span class="switch-ui"></span>学校场地错时开放</label>
              <label class="toggle-line"><input v-model="offices" type="checkbox" role="switch" /><span class="switch-ui"></span>机关单位场地开放</label>
            </div>
            <div class="control-card service-setting">
              <label class="inline-field">每片场地规划服务人数
                <input type="number" min="1" max="100000" step="1" :value="serviceCapacity.peoplePerCourt" @change="changeServiceCapacity" />
              </label>
              <button v-if="scenarioPeoplePerCourt !== undefined" type="button" class="mini" @click="scenarioPeoplePerCourt = undefined">恢复已发布参数</button>
            </div>
          </template>
          <div v-if="scene === 'venues' && venueTab === 'site'" class="control-card amber-card">
            <label class="inline-field">拟建场地片数 <input v-model.number="courtCount" type="number" min="1" max="30" step="1"
              @change="courtCount = Math.min(30,Math.max(1,Math.round(Number(courtCount) || 1)))" /></label>
            <button type="button" class="primary" @click="beginPick('site')">{{ pickTool === 'site' ? '等待图上落点' : '图上落子 · 实时核查' }}</button>
          </div>
          <div v-if="isActiveEvent" class="control-card event-card">
            <label class="sr-only" for="event-pick">选择赛事</label>
            <select id="event-pick" :value="event?.id ?? ''" @change="chooseEvent(events.find(item => item.id === ($event.target as HTMLSelectElement).value)!, scene === 'liveEvent' ? 'liveEvent' : 'events')">
              <option v-if="!events.length" value="">暂无赛事</option>
              <option v-for="item in events" :key="item.id" :value="item.id">{{ item.properties.name }}</option>
            </select>
            <p>{{ eventText(event) }}{{ event && scene === 'events' ? daysToEvent(event) : '' }}</p>
            <label v-if="scene === 'liveEvent' && eventSnapshots.length" class="inline-field">赛中日期
              <select v-model="liveDate">
                <option value="">代表性快照</option>
                <option v-for="item in eventSnapshots" :key="item" :value="item">{{ item }}</option>
              </select>
            </label>
          </div>
          <template v-if="scene === 'tourism'">
            <div class="segments"><button type="button" :class="{on:tourismMode === 'single'}" @click="tourismMode = 'single'">单场赛事</button>
              <button type="button" :class="{on:tourismMode === 'annual'}" @click="tourismMode = 'annual'">年度汇总</button></div>
            <div v-if="tourismMode === 'single'" class="control-card event-card">
              <label class="sr-only" for="tour-pick">选择已办赛事</label>
              <select id="tour-pick" :value="tourismEvent?.id ?? ''" @change="selectTourismEvent(($event.target as HTMLSelectElement).value)">
                <option v-if="!completedEvents.length" value="">暂无已办赛事</option>
                <option v-for="item in completedEvents" :key="item.id" :value="item.id">{{ item.properties.name }}</option>
              </select><p>{{ eventText(tourismEvent) }}</p>
            </div>
          </template>
          <div v-if="group.id === 'events'" class="control-card">
            <h3>赛事地图</h3>
            <div class="event-map-modes">
              <div class="event-area-buttons" aria-label="路网查看范围">
                <button v-if="page === 'tourism'" type="button" @click="viewVisitorFlows">客源流向</button>
                <button type="button" :aria-pressed="eventCountyView" :class="{on:eventCountyView}" @click="setLayers(['roadNetwork']); viewEventArea('county')">全市路网</button>
                <button type="button" :disabled="page === 'tourism' ? !tourismEvent : !event" @click="viewEventArea('venue')">场馆周边</button>
              </div>
              <div v-if="isActiveEvent" class="event-topic-buttons" aria-label="赛事保障专题">
                <button v-for="[id,label] in [['traffic','交通管控'],['medical','医疗'],['lodging','住宿'],['food','食安'],['security','安保'],['shelters','避难物资'],['all','综合']] as const"
                  :key="id" type="button" :disabled="loading" :class="{on:eventMap === id}" :aria-pressed="eventMap === id" @click="setEventTopic(id)">{{ label }}</button>
              </div>
              <button v-if="roadLoad === 'error' && !publishedRoadLayer" type="button" @click="loadReferenceRoads">重试道路网</button>
            </div>
          </div>
          <div v-if="group.id === 'events'" class="control-card">
            <h3>赛事赛历</h3>
            <div class="segments calendar-months" aria-label="赛事月份">
              <button v-for="value in 12" :key="value" type="button" :class="{on:monthOpen && month === value}"
                :aria-pressed="monthOpen && month === value" @click="clickMonth(value)">
                <i :style="{background:monthDot(value)}" aria-hidden="true"></i>{{ value }}月
              </button>
            </div>
            <div v-if="monthOpen" class="calendar-events">
              <header><strong>{{ month }} 月赛事</strong><button class="mini" type="button" aria-label="关闭赛事赛历" @click="monthOpen = false">×</button></header>
              <p v-if="!monthEvents.length">该月暂无赛事</p>
              <button v-for="item in monthEvents" :key="item.id" type="button" class="mini" @click="selectCalendarEvent(item)">
                {{ dateOf(item).slice(5) }} · {{ item.properties.name }} <span>{{ item.properties.status }}</span>
              </button>
            </div>
          </div>
        </template>
        <template #section-after="{ section: currentSection }">
          <button v-if="isFacilityPage && currentSection.title === '场馆清单' && facilityRows.length > facilityLimit"
            class="mini workflow-more" type="button" @click="facilityLimit += 12">显示更多场馆（{{ facilityLimit }}/{{ facilityRows.length }}）</button>
        </template>
        <template #middle>
          <div v-if="scene === 'events' && event" class="control-card amber-card">
            <label class="slider-label" for="event-size"><strong>规模滑杆</strong><span>{{ fmt(eventAnalysis.attendance) }} 人</span></label>
            <input id="event-size" type="range" min="0" :max="maxAttendance" step="10" :value="eventAnalysis.attendance"
              @input="attendance = Number(($event.target as HTMLInputElement).value)" />
            <div class="slider-ends"><span>0 人</span><span>{{ fmt(maxAttendance) }} 人</span></div>
            <label class="inline-field venue-select">场馆比选
              <select :value="eventVenue ?? event.properties.venueId ?? ''" @change="eventVenue = ($event.target as HTMLSelectElement).value; if (eventAnalysis.position) mapAction('focus',eventAnalysis.position)">
                <option value="">赛历默认场馆</option><option v-for="item in rawLayer('venues').filter(inRegion)" :key="item.id" :value="item.id">{{ item.properties.name }}</option>
              </select>
            </label>
          </div>
        </template>
        <template v-if="['site','events','merchants'].includes(page)" #actions>
          <template v-if="page === 'site'">
            <button type="button" @click="resultModal = true">历史记录</button>
            <button type="button" @click="proposal = undefined; parcelId = ''; showToast('已重新计算候选地块')">重新筛选</button>
            <button type="button" class="primary" :disabled="!parcel || !data" @click="openOperations('review',parcel?.id)">提交用地审查</button>
          </template>
          <template v-else-if="page === 'events'">
            <button type="button" @click="openOperations('eventCompare',event?.id)">场馆比选</button>
            <button type="button" @click="attendance = undefined">恢复赛历人数</button>
          </template>
          <template v-else>
            <button type="button" @click="openOperations('merchants')">商家清单</button>
            <button type="button" class="primary" @click="openOperations('merchants',undefined,'待审核')">审核入驻申请</button>
          </template>
        </template>
      </DashboardPanel>

      <section class="jt-map" :aria-label="industryDiagnosis ? '图谱工具' : '京山 Cesium 地图与场景'" @keydown.esc="escapeMapControls">
        <div id="cockpit-map-column" class="map-scene">
          <template v-if="!industryDiagnosis">
          <div v-if="page === 'venues'" id="service-map-navigation"></div>
          <div class="map-top-controls">
            <div v-if="countyMapView || fusionScene" ref="homeRegionControl" class="home-region-picker">
              <div class="home-region-bar">
                <button ref="homeRegionTrigger" type="button" class="home-region-trigger"
                  :aria-expanded="regionOpen" aria-controls="home-region-popover" aria-haspopup="dialog"
                  @click="toggleHomeRegion">
                  {{ isOverview ? region : currentArea }}
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
                </button>
                <label class="home-region-keyword">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15 15 4 4" /></svg>
                  <input v-model.trim="regionQuery" type="search" placeholder="请输入关键字" :aria-label="isOverview ? '搜索镇或街道' : '搜索乡镇、街道或社区'"
                    @focus="openHomeRegion" @input="openHomeRegion" />
                </label>
              </div>
              <section v-if="regionOpen" id="home-region-popover" class="home-region-popover" role="dialog" aria-labelledby="home-region-title">
                <header class="home-region-popover-header">
                  <h3 id="home-region-title">区划选择</h3>
                  <button type="button" aria-label="关闭区划选择" @click="closeHomeRegion(true)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                  </button>
                </header>
                <p class="home-region-breadcrumb">
                  <span>荆门市</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                  <span>京山市</span>
                </p>
                <div class="home-region-options" role="group" aria-label="京山市区划">
                  <button v-if="!regionQuery || '京山市全市'.includes(regionQuery)" type="button"
                    :aria-pressed="region === '京山市' && !community" @click="selectHomeRegion('京山市')">全市</button>
                  <button v-for="item in filteredRegions" :key="item" type="button"
                    :aria-pressed="region === item && (isOverview || !community)" @click="selectHomeRegion(item)">{{ item }}</button>
                  <p v-if="regionQuery && !filteredRegions.length && (isOverview || !filteredCommunities.length) && !'京山市全市'.includes(regionQuery)" class="home-region-empty">未找到匹配区划</p>
                </div>
                <details v-if="!isOverview && filteredCommunities.length" class="home-region-communities" :open="!!regionQuery">
                  <summary>村与社区（{{ filteredCommunities.length }}）</summary>
                  <div class="home-region-options">
                    <button v-for="item in filteredCommunities.slice(0,communityLimit)" :key="item.id" type="button"
                      :aria-pressed="community === item.id" @click="selectHomeRegion(item.properties.region,item.id)">{{ item.properties.name }}{{ region === '京山市' ? ' · ' + item.properties.region : '' }}</button>
                    <button v-if="filteredCommunities.length > communityLimit" type="button" @click="communityLimit += 30">显示更多</button>
                  </div>
                </details>
              </section>
            </div>
            <div v-else class="region-selector">
              <button ref="homeRegionTrigger" class="region-trigger" type="button" :aria-expanded="regionOpen" aria-controls="region-menu" :title="currentArea"
                @click="toggleHomeRegion">
                <span aria-hidden="true">▣</span><span class="region-name">{{ currentArea }}</span><span aria-hidden="true">▾</span>
              </button>
              <div v-show="regionOpen" id="region-menu" class="region-menu">
                <input v-model.trim="regionQuery" placeholder="搜索乡镇、街道、社区" aria-label="搜索行政区" />
                <button type="button" @click="changeRegion('京山市')">京山市 · 全市</button>
                <p>乡镇（街道）</p>
                <button v-for="item in filteredRegions" :key="item" type="button" :class="{on:region === item}" @click="changeRegion(item)">{{ item }}</button>
                <p>村与社区（{{ filteredCommunities.length }}）</p>
                <button v-for="item in filteredCommunities.slice(0,communityLimit)" :key="item.id" type="button"
                  @click="changeRegion(item.properties.region,item.id)">{{ item.properties.name }}{{ region === '京山市' ? ' · ' + item.properties.region : '' }}</button>
                <button v-if="filteredCommunities.length > communityLimit" type="button" @click="communityLimit += 30">显示更多</button>
              </div>
            </div>

          </div>
          <section v-if="!thematicScene && !fusionScene && !eventCountyView && (v3Panel?.statusCard || (page === 'events' && event && ['all','traffic','lodging'].includes(eventMap)))" class="v3-map-status">
            <template v-if="v3Panel?.statusCard">
              <h3>{{ v3Panel.statusCard.title }}</h3>
              <p v-for="row in v3Panel.statusCard.rows" :key="row.label">{{ row.label }} <strong>{{ row.value }}</strong></p>
            </template>
            <template v-else-if="eventMap === 'lodging'">
              <h3>住宿接待测算</h3>
              <p>住宿需求 <strong>{{ fmt(eventAnalysis.lodgingDemand) }} 床</strong></p>
              <p>3 公里内床位 <strong>{{ fmt(eventAnalysis.lodgingSupply) }} 床</strong></p>
              <p>床位缺口 <strong :class="eventAnalysis.lodgingGap ? 'red' : 'green'">{{ fmt(eventAnalysis.lodgingGap) }} 床</strong></p>
            </template>
            <template v-else>
              <h3>交通管控 · {{ eventAnalysis.roadControls.some(item => item.properties.planSource === 'published') ? '已发布方案' : '模拟建议' }}</h3>
              <p><span><i class="control-swatch closed"></i>建议封闭</span><strong class="red">{{ roadCounts.closed }} 条</strong></p>
              <p><span><i class="control-swatch restricted"></i>建议限行</span><strong>{{ roadCounts.restricted }} 条</strong></p>
              <p>点击路段查看范围</p>
            </template>
          </section>

          <nav class="map-toolbar home-toolbar" aria-label="地图操作">
            <button type="button" aria-label="地图图层" data-tooltip="地图图层" :class="{on:mapPopup === 'layers'}" :aria-expanded="mapPopup === 'layers'" @click="togglePopup('layers'); homeSearchOpen = false; closeHomeRegion()"></button>
            <button type="button" class="home-tool-locate" aria-label="定位标点" data-tooltip="定位标点" :aria-controls="countyMapView || fusionScene ? 'home-region-popover' : 'region-menu'"
              :class="{on:regionOpen}" :aria-expanded="regionOpen" @click="toggleHomeRegion">
              <img src="/jingshan/ui/location-ring.svg" alt="" />
            </button>
            <button type="button" aria-label="数据查询" data-tooltip="数据查询" :class="{on:homeSearchOpen}" :aria-expanded="homeSearchOpen" @click="homeMapSearch"></button>
            <button type="button" aria-label="地图工具" data-tooltip="地图工具" :class="{on:mapPopup === 'tools' || mapPopup === 'legend'}" :aria-expanded="mapPopup === 'tools' || mapPopup === 'legend'" @click="togglePopup('tools'); homeSearchOpen = false; closeHomeRegion()"></button>
            <button type="button" aria-label="互动调度" data-tooltip="互动调度" @click="resultModal = true"></button>
            <button type="button" class="home-tool-reset" aria-label="复位" data-tooltip="复位"
              @click="resetMap(); mapPopup = null; homeSearchOpen = false; closeHomeRegion()">
              <span class="home-tool-reset-icon" aria-hidden="true"></span>
            </button>
            <button v-if="focusedVenueModel" type="button" class="model-view-switch" :aria-pressed="mapModelsOn"
              :aria-label="mapModelsOn ? '切换到俯视平面' : '查看三维模型'" :data-tooltip="mapModelsOn ? '切换到俯视平面' : '查看三维模型'"
              @click="switchModelView">{{ mapModelsOn ? '2D' : '3D' }}</button>
            <button v-else-if="venueDetailOnMap" type="button" class="model-view-switch" :aria-pressed="camera.tilted"
              :aria-label="camera.tilted ? '切换到俯视平面' : '切换到三维视角'" :data-tooltip="camera.tilted ? '切换到俯视平面' : '切换到三维视角'"
              @click="mapAction('tilt')">{{ camera.tilted ? '2D' : '3D' }}</button>
          </nav>
          <section v-if="homeSearchOpen" class="map-popover home-map-popover" aria-label="数据查询">
            <header class="popover-header"><h3>数据查询</h3><button type="button" aria-label="关闭" @click="homeSearchOpen = false">×</button></header>
            <div class="home-popup-content">
              <input ref="homeSearchBox" v-model="homeSearch" type="search" placeholder="搜索场馆、企业、配套" aria-label="搜索地图资源" />
              <button v-for="{id,feature} in homeSearchMatches" :key="id + ':' + feature.id" type="button"
                @click="focusHomeSearchMatch(id,feature)">{{ feature.properties.name }}<small>{{ feature.properties.region }}</small></button>
              <p v-if="!homeSearchMatches.length">未找到匹配资源。</p>
            </div>
          </section>
          <section v-if="mapPopup" class="map-popover" :class="'popover-' + mapPopup" :aria-label="mapPopup === 'layers' ? '图层目录' : mapPopup === 'legend' ? '地图图例' : '地图工具'">
            <header class="popover-header">
              <h3>{{ mapPopup === 'layers' ? '图层目录' : mapPopup === 'legend' ? '地图图例' : '地图工具' }}</h3>
              <small v-if="mapPopup === 'layers'">{{ availableLayers.length + scopedCimCatalog.length + thematicLegend.length + 2 }} 个图层</small>
              <button type="button" aria-label="关闭地图菜单" @click="mapPopup = null">×</button>
            </header>
            <template v-if="mapPopup === 'layers'">
              <MapLayerDirectory>
                <template #business>
                <details v-if="populationOverview && densityDataset" open>
                  <summary>球场人口覆盖</summary>
                  <label v-for="view in populationViews" :key="view.id" class="catalog-row">
                    <input type="radio" name="population-map-view" :checked="densityVisible && populationView === view.id"
                      :disabled="!coverageSummary?.groups.all.grids || (view.id !== 'all' && !coverageSummary.hasCourts)"
                      @change="selectPopulationView(view.id)" />{{ view.layer }}
                  </label>
                </details>
                <details v-if="thematicScene && thematicLegend.length" open>
                  <summary>当前业务图层</summary>
                  <label v-for="entry in thematicLegend" :key="entry.label" class="catalog-row">
                    <input type="checkbox" :checked="!hiddenSceneSymbols.includes(entry.label)"
                      @change="toggleSceneSymbol(entry.label)" />
                    {{ entry.label }}
                  </label>
                </details>
                </template>
                <template #scene>
                <details open><summary>当前场景图层</summary>
                  <label v-for="item in currentLayers" :key="item.id" class="catalog-row scene-layer-toggle">
                    <input :checked="item.enabled" type="checkbox" @change="toggleLayer(item.id)" />
                    <i class="layer-dot" :style="{'--layer-color':item.color}" aria-hidden="true"></i>{{ item.label }}
                  </label>
                </details>
                </template>
              </MapLayerDirectory>
            </template>
            <div v-else-if="mapPopup === 'legend'" class="map-legend">
              <PopulationGridLegend v-if="densityVisible" v-bind="populationLegend" />
              <p v-for="entry in thematicLegend" :key="entry.label">
                <FacilityLocationPin v-if="serviceResourceDetail && entry.pinKind" class="legend-location-pin" :kind="entry.pinKind" :color="entry.color" :center="entry.serviceRangeCenter"/>
                <i v-else :style="{background:entry.color}"></i>{{ entry.label }}
              </p>
              <template v-for="item in currentLayers.filter(layer => layer.id !== densityLayerId && (!thematicScene || layer.enabled))" :key="item.id">
                <template v-if="item.id === 'capacityGaps'">
                  <p><i :style="{background:dashboardPalette.red}"></i>服务圈外</p>
                  <p><i :style="{background:dashboardPalette.orange}"></i>圈内场地不足</p>
                  <small v-if="page === 'venues'">服务范围采用直线距离估算。</small>
                </template>
                <p v-else><i :style="{background:item.color}"></i>{{ item.label }}</p>
              </template>
              <p v-if="page === 'tourism'"><i style="background:#70ddff"></i>客源方向示意 · 光点流向赛事场馆</p>
              <p v-for="entry in fusionLegend" :key="entry.label"><i :style="{background:entry.color}"></i>{{ entry.label }}</p>
              <template v-if="isActiveEvent">
                <p v-for="style in roadControlStyles" :key="style.action"><i :style="{background:style.color}"></i>{{ style.zone }} · {{ style.action }}</p>
              </template>
              <p><i style="background:#35e0ff"></i>京山市与乡镇边界</p>
              <small>县域按乡镇汇总，放大到场馆后显示独立场地面。</small>
            </div>
            <div v-else class="map-tool-list">
              <button type="button" @click="togglePopup('legend')">图例</button>
              <button type="button" :aria-pressed="imagery" @click="imagery = !imagery">卫星影像</button>
              <button type="button" :aria-pressed="camera.tilted" @click="mapAction('tilt')">3D 视角</button>
              <button type="button" @click="clearMap">清除图层</button>
              <button type="button" @click="mapAction('in')">＋ 放大地图</button>
              <button type="button" @click="mapAction('out')">− 缩小地图</button>
              <button class="measure-tool" type="button" @click="pickTool = null; mapPopup = null; mapAction('measure')"><img src="/jingshan/ui/measure.svg" alt="" />量测直线距离</button>
              <button type="button" @click="beginPick('circle')">圈选场地统计</button>
              <button type="button" @click="demoTour(); mapPopup = null">{{ touring ? '停止自动演示' : '启动自动演示' }}</button>
            </div>
          </section>

          <div v-if="pickTool || circleResult || measured !== null" class="map-instruction">
            <strong v-if="pickTool">{{ pickTool === 'site' ? '点击地图放置拟建场地' : circleStart ? '点击圆周，完成统计' : '点击地图设置圆心' }}</strong>
            <strong v-else-if="circleResult">圈选 {{ circleResult.count }} 片场地 · 半径 {{ fmt(circleResult.radius) }} 米</strong>
            <strong v-else>直线距离 {{ fmt(measured) }} 米</strong>
            <button v-if="pickTool" type="button" class="mini" @click="cancelPick">取消</button>
          </div>

          <section v-if="cimFeature && detailOpen" class="map-detail" aria-label="CIM 要素详情">
            <header class="popover-header"><h3>{{ cimFeature.name }}</h3><button type="button" aria-label="关闭地图详情" @click="detailOpen = false; cimFeature = undefined">×</button></header>
            <p>{{ cimFeature.serviceName }}</p>
            <dl><template v-for="(value,key) in cimFeature.properties" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></template></dl>
          </section>
          <section v-else-if="selectedFeature && detailOpen" class="map-detail">
            <header class="popover-header"><h3>{{ selectedFeature.properties.name }}</h3><button type="button" aria-label="关闭地图详情" @click="detailOpen = false; selectedId = null">×</button></header>
            <p v-if="selectedFeature.properties.kind === 'origin'">客源方向示意</p>
            <p v-else>{{ selectedFeature.properties.region }}<template v-if="selectedFeature.properties.kind === 'road-control'">
              · {{ selectedFeature.properties.planSource === 'published' ? '已发布方案' : '模拟建议' }}
            </template></p>
            <dl><template v-for="[key,value] in selectedProperties" :key="key">
              <dt>{{ propertyNames[key] || key }}</dt><dd>{{ typeof value === 'boolean' ? value ? '是' : '否' : fmt(value) }}</dd>
            </template></dl>
            <template v-if="selectedFeature.properties.kind === 'road-control' && selectedRoadEndpoints">
              <p>地图端点 A {{ selectedRoadEndpoints[0] }}</p>
              <p>地图端点 B {{ selectedRoadEndpoints[1] }}</p>
            </template>
            <button v-if="selectedFeature.properties.kind !== 'origin' && featureCenter(selectedFeature)" type="button" class="mini" @click="focus(selectedFeature)">定位此要素 ›</button>
            <button v-if="selectedPopulationGap" type="button" class="mini" @click="selectMapFeature(selectedPopulationGap.feature.id)">查看服务缺口 ›</button>
          </section>

          </template>
          <p v-if="modelNotice && !mapPopup && !homeSearchOpen" class="business-model-notice" role="status">{{ modelNotice }}</p>
          <aside v-if="!isOverview && (thematicLegend.length || fusionLegend.length || densityVisible || footprintsVisible || visibleControls.length || reserveLegend.length) && !mapPopup" class="business-map-legend" :class="{'with-population':densityVisible,'planning-legend':investmentScene}" aria-label="业务地图图例">
            <PopulationGridLegend v-if="densityVisible" v-bind="populationLegend" />
            <span v-for="entry in fusionLegend" :key="entry.label"><i :style="{'--symbol':entry.color}" aria-hidden="true"></i>{{ entry.label }}</span>
            <span v-for="control in visibleControls" :key="control.key"><i :data-planning-pattern="control.pattern" :style="{'--symbol':control.color,'--casing':control.halo}" aria-hidden="true"></i>{{ control.name }}</span>
            <span v-for="item in reserveLegend.filter(i=>!thematicLegend.some(e=>e.label===i.label))" :key="item.label"><i :data-role="reserveScale==='parcel'?'candidate':'reserveGroup'" :style="{'--symbol':item.color}" aria-hidden="true"></i>{{ item.label }}{{reserveScale==='town'?' · 镇街数量':reserveScale==='village'?' · 村社数量':''}}</span>
            <template v-if="!densityVisible || openingMap || investmentScene">
              <span v-for="entry in thematicLegend.filter(item => !hiddenSceneSymbols.includes(item.label))" :key="entry.label">
                <FacilityLocationPin v-if="serviceResourceDetail && entry.pinKind" class="legend-location-pin" :kind="entry.pinKind" :color="entry.color" :center="entry.serviceRangeCenter"/>
                <i v-else :data-role="entry.role" :style="{'--symbol':entry.color}" aria-hidden="true"></i>{{ entry.label }}
              </span>
              <span v-if="footprintsVisible"><i :style="{'--symbol':layerColors.court_footprints}" aria-hidden="true"></i>{{ venueDetailOnMap ? '本场馆场地' : '网球场地' }}</span>
            </template>
          </aside>
          <SceneAssistant :show-trigger="!industryDiagnosis && assistantVisible && !regionOpen && !mapPopup && !homeSearchOpen && !pickTool && !detailOpen && !operations && !resultModal"
            :key="page" :page="page" :area="currentArea" :datasets="datasets"
            :in-scope="feature => inRegion(feature) && inCommunity(feature)" @locate="focusHomeSearchMatch" />
          <div v-if="loading" class="map-loading" role="status">正在载入京山业务数据…</div>
        </div>

        <aside v-if="isOverview && !mapOnly && mapPopup !== 'legend'" class="home-legend" aria-label="图例">
          <template v-if="region === '京山市'">
            <span><i class="home-legend-city"></i>市域边界</span>
            <span><i class="home-legend-town"></i>乡镇边界</span>
          </template>
          <span v-else><i class="home-legend-town"></i>{{ region }}边界</span>
          <span v-if="footprintsVisible"><i class="home-legend-footprint" :style="{'--symbol':layerColors.court_footprints}" aria-hidden="true"></i>网球场地</span>
        </aside>
        <div v-if="isOverview" class="scene-dock">
          <nav class="scene-nav" aria-label="重点场景">
            <button class="scene-arrow scene-arrow-prev" type="button" aria-label="上一个重点场景" @click="advanceScene(-1)">
              <img src="/jingshan/ui/light-dock-prev.png" alt="" />
            </button>
            <button v-for="(item, index) in groups" :key="item.id"
              :class="{on:group.id === item.id, 'scene-item-raised':index === 1 || index === 2}"
              :aria-current="group.id === item.id ? 'page' : undefined"
              class="scene-item" type="button" @click="openSceneStep(item.pages[0])">{{ item.label }}</button>
            <button class="scene-arrow scene-arrow-next" type="button" aria-label="下一个重点场景" @click="advanceScene(1)">
              <img src="/jingshan/ui/light-dock-next.png" alt="" />
            </button>
          </nav>
          <p class="scene-footer-title" aria-hidden="true">重点场景</p>
        </div>
      </section>

      <button v-if="!rightPanelOpen || !industryPanel || industryPanel === IndustryPanorama"
        class="panel-toggle toggle-right" :class="{'industry-panel-toggle':industryPanel || fusionScene}" type="button" :aria-expanded="rightPanelOpen" aria-controls="dashboard-right"
        :aria-label="rightPanelOpen ? '收起右侧面板' : '展开右侧面板'" @click="rightPanelOpen = !rightPanelOpen">
        <span aria-hidden="true">{{ rightPanelOpen ? '›' : '‹' }}</span>{{ rightPanelOpen ? '收起' : '右栏' }}
      </button>
      <div v-if="isOverview" v-show="rightPanelOpen" id="dashboard-right" class="v14-overview-rail-shell right-panel"
        role="region" aria-label="右侧分析面板" tabindex="0">
        <OverviewAnalysisRail :datasets="datasets" :today="diagnosisDate" :coverage-rate="homeCoverageRate"
          :expanded-coverage-rate="homeExpandedCoverageRate" :parking-rate="homeParkingRate"
          :demo="data?.data.mode === 'demo'" @navigate="openSceneStep" @select-event="id => setScene('events',true,id)" />
      </div>
      <DashboardPanel v-else-if="!industryPanel && page !== 'consumption'" :variant="page === 'merchants' ? 'industry' : undefined" v-show="rightPanelOpen" id="dashboard-right" side="right" :title="rightTitle" :main="rightMain" :metrics="rightMetrics" :sections="rightSections">
        <template #before>
          <template v-if="page === 'venues'">
            <div class="segments gap-filters" role="group" aria-label="覆盖不足筛选">
              <button v-for="[key,label] in [['dense','人口密集'],['all','全部缺口'],['outside','服务圈外'],['capacity','圈内不足']] as const"
                :key="key" type="button" :class="{on:gapFilter === key}" :aria-pressed="gapFilter === key" @click="gapFilter = key">{{ label }}</button>
            </div>
            <div v-if="selectedGap" class="control-card gap-selection">
              <strong>{{ selectedGap.name }}</strong>
              <p>{{ fmt(selectedGap.population) }} 人常住 · {{ densityLabel(selectedGap) }} · 周边可用 {{ selectedGap.reachableCourts }} 片</p>
              <button type="button" class="primary" @click="selectBlind(selectedGap.id)">为此网格选址</button>
            </div>
          </template>
          <section v-if="scene === 'tourism' && occupancy.length && tourismMode === 'single'" class="panel-section occupancy">
            <h3><span>赛事前后入住率</span><small>旅馆聚合数据</small></h3>
            <svg viewBox="0 0 300 96" aria-label="赛事前后入住率折线图" role="img">
              <path d="M18 15 H282 M18 49 H282 M18 83 H282" fill="none" stroke="#27548a" stroke-width="1" />
              <rect x="119" y="13" width="62" height="70" fill="#ffb21e" opacity=".13" stroke="#ffb21e" stroke-dasharray="3 3" />
              <polyline :points="occupancyPath" fill="none" stroke="#35e0ff" stroke-width="2.5" stroke-linejoin="round" />
              <text x="22" y="94">赛前</text><text x="140" y="94">赛期</text><text x="260" y="94">赛后</text>
            </svg>
          </section>
        </template>
        <template #section-tools="{ section: currentSection }">
          <div v-if="currentSection.title === '管控路段清单' && eventAnalysis.roadControls.length" class="event-map-modes road-list-tools">
            <button v-for="[id,label] in [['all','全部路段'],['closed','封闭建议'],['restricted','限行建议']] as const"
              :key="id" type="button" :class="{on:roadFilter === id}" :aria-pressed="roadFilter === id" @click="roadFilter = id">{{ label }}</button>
            <button type="button" @click="exportReport">导出研判</button>
          </div>
        </template>
        <template #section-after="{ section: currentSection }">
          <ServicePager v-if="shelterPage.pageCount > 1 && currentSection.title === '避难场所与储备物资'" :pagination="shelterPage" label="避难场所分页" unit="处"/>
          <button v-if="page === 'venues' && currentSection.title === '覆盖不足网格' && priorityAreas.length > gapLimit"
            type="button" class="mini workflow-more" @click="gapLimit += 12">显示更多缺口（{{ gapLimit }}/{{ priorityAreas.length }}）</button>
          <div v-if="currentSection.title === '管控路段清单' && listedRoads.length > roadListLimit" class="event-map-modes road-list-tools">
            <button type="button" @click="roadListLimit += 12">显示更多路段（{{ roadListLimit }}/{{ listedRoads.length }}）</button>
          </div>
        </template>
        <template v-if="trend" #after>
          <section class="panel-section occupancy">
            <h3><span>{{ trend.title }}</span><small>{{ trend.unit }}</small></h3>
            <svg viewBox="0 0 300 96" :aria-label="trend.title" role="img">
              <path d="M18 15 H282 M18 45 H282 M18 76 H282" fill="none" stroke="#27548a" />
              <polyline :points="trendPath" fill="none" stroke="#35e0ff" stroke-width="2.5" stroke-linejoin="round" />
              <text v-for="(label,index) in trend.labels" :key="label" :x="18 + index * (264 / Math.max(1,trend.labels.length-1))"
                y="93" text-anchor="middle">{{ label }}</text>
            </svg>
          </section>
        </template>
        <template #actions>
          <template v-if="scene === 'overview'">
            <button type="button" @click="demoTour">{{ touring ? '停止演示' : '自动演示' }}</button>
            <button type="button" class="primary" @click="resultModal = true">协同台账</button>
          </template>
          <template v-else-if="page === 'merchants'">
            <button type="button" :disabled="!data" @click="openOperations('routes',undefined,'new')">新增线路</button>
            <button type="button" :disabled="!data" @click="openOperations('coupons')">优惠活动管理</button>
            <button type="button" class="primary" :disabled="!data" @click="exportReport">生成月报</button>
          </template>
          <template v-else-if="page === 'events'">
            <button type="button" :disabled="!event" @click="openOperations('travel',event?.id)">发布出行提示</button>
            <button type="button" class="primary" :disabled="busy || !event" @click="sendResult()">生成保障方案</button>
          </template>
          <template v-else-if="page === 'liveEvent'">
            <button type="button" :disabled="!event" @click="openOperations('urge',event?.id)">催办</button>
            <button type="button" class="primary" :disabled="!data" @click="exportReport">生成当日保障日报</button>
          </template>
          <template v-else-if="isFacilityPage">
            <button type="button" @click="exportResources">导出场地</button>
            <button type="button" class="primary" @click="focusCoverageGaps">下一步 · 找覆盖缺口</button>
          </template>
          <template v-else-if="page === 'venues'">
            <button type="button" @click="exportList">导出缺口</button>
            <button type="button" class="primary" :disabled="!selectedGap && !priorityAreas.length"
              @click="selectBlind((selectedGap ?? priorityAreas[0]).id)">{{ selectedGap ? '下一步 · 为所选网格选址' : '下一步 · 为首个缺口选址' }}</button>
          </template>
          <template v-else-if="page === 'site'">
            <button type="button" @click="setScene('venues')">返回覆盖缺口</button>
            <button type="button" :disabled="!parcel" @click="exportReport">导出选址建议</button>
            <button type="button" class="primary" :disabled="!parcel?.compliant || busy" @click="sendResult('发改局','项目库纳入建议')">纳入项目库</button>
          </template>
          <template v-else>
            <button v-if="page === 'industry'" type="button" @click="exportResources">导出资源清单</button>
            <button v-if="page === 'investment'" type="button" @click="exportList">导出清单</button>
            <button type="button" class="primary" :disabled="!data" @click="exportReport">生成{{ selectedReportTitle }}</button>
            <button v-if="page !== 'industry'" type="button" :disabled="busy || !data" @click="sendResult()">
              推送{{ meta.department.replace('京山市','') }}
            </button>
          </template>
        </template>
      </DashboardPanel>
    </div>

    <footer v-if="!industryDiagnosis" class="jt-footer" :class="{ 'scene-footer': !isOverview }">
      <nav v-if="!isOverview" class="scene-subnav" :class="{'industry-scene-subnav':industryPanel || fusionScene || group.id === 'events'}" :aria-label="group.label + '子功能'">
        <button v-for="step in sceneTabs" :key="step" type="button"
          :aria-current="activeSceneTab === step ? 'page' : undefined" @pointerenter="preloadSceneStep(step)"
          @focus="preloadSceneStep(step)" @click="openSceneStep(step)">
          {{ pages[step].label }}
        </button>
      </nav>
      <p class="scene-footer-title">{{ isOverview ? '重点场景' : group.label }}</p>
      <p v-if="!isLight || !isOverview" class="map-caption">经度 {{ camera.longitude.toFixed(4) }}° · 纬度 {{ camera.latitude.toFixed(4) }}° · {{ camera.height < 1000 ? Math.round(camera.height) + ' m' : (camera.height/1000).toFixed(1) + ' km' }}</p>
    </footer>

    <V3Operations v-if="operations && data" :key="[operations.panel,operations.id,operations.tab].join(':')"
      :panel="operations.panel" :published="data" :initial-id="operations.id" :initial-tab="operations.tab"
      @close="operations = undefined" @published="refreshPublished"
      @locate="operations = undefined; focus($event)" @results="results = [...$event,...results]" />
    <div v-if="resultModal" class="modal-scrim" @click.self="resultModal = false">
      <section class="modal-box result-modal" role="dialog" aria-modal="true" aria-label="成果协同台账">
        <header class="modal-title"><div><p>成果回流</p><h2>协同台账</h2></div><button type="button" aria-label="关闭协同台账" @click="resultModal = false">×</button></header>
        <div class="data-scroll">
          <p class="message">在本地记录发送对象、办理状态和空间成果。接收后可标记完成并在大屏回看。</p>
          <div v-for="item in results" :key="item.id" class="result-card">
            <div><strong>{{ item.title }}</strong><p>{{ item.department }} · V{{ item.version }} · {{ new Date(item.createdAt).toLocaleString('zh-CN') }}</p></div>
            <span class="flag" :class="item.status === 'completed' ? 'green' : 'amber'">{{ resultStatus[item.status] }}</span>
            <div class="modal-actions">
              <button v-if="item.status !== 'completed'" type="button" :disabled="busy" @click="updateResult(item)">{{ item.status === 'pending' ? '接收任务' : '完成回流' }}</button>
              <button v-if="item.status === 'completed' && item.features.length" type="button" @click="showResult(item)">地图回看</button>
              <button type="button" @click="downloadFile(item.title + '.md',item.summary,'text/markdown;charset=utf-8')">下载报告</button>
              <button v-if="item.features.length" type="button" @click="downloadFile(item.title + '.geojson',JSON.stringify({type:'FeatureCollection',features:item.features},null,2),'application/geo+json')">导出空间成果</button>
            </div>
          </div>
          <p v-if="!results.length" class="empty">暂无成果。在分析场景点击「提交协同」或「生成保障任务」。</p>
        </div>
      </section>
    </div>
    <Teleport v-if="attributeLayerId && !isOverview" defer to="#cockpit-map-column">
      <div class="cockpit-attribute-panel"><SpatialAttributeTable v-if="attributeDataset" :key="attributeLayerId" :dataset="attributeDataset" :picked="attributePick" @selection="attributeIds=$event" @locate="locateAttribute" @close="closeAttributeTable"/><div v-else class="attribute-loading" role="status">{{attributeError || '正在读取服务属性…'}}<button v-if="attributeError" @click="attributeRetry++">重试</button><button aria-label="关闭属性表" @click="closeAttributeTable">×</button></div></div>
    </Teleport>
    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
  </main>
</template>

<style src="./panorama-map.css"></style>
<style src="./business-map.css"></style>

<style scoped>
.cockpit-attribute-panel{position:absolute;z-index:24;bottom:84px;inset-inline:1%;max-height:50vh;overflow:auto;pointer-events:auto}.attribute-loading{background:#173756;color:white;padding:12px;display:flex;align-items:center;gap:12px}.attribute-loading button:last-child{margin-left:auto}
</style>
