<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import {api} from './api'
import { providersAtVenue, tourismProviders } from './tourism-providers'
import {openingTaskLink,type OpeningTask,type OpeningTaskLink,type OpeningTaskRow} from './venue-opening'
import {facilityDetailMap,supportOverviewMap,taskPins,venueDetailMap,venuePin} from './service-scene-map'
import type {CoverageGridSummary, PopulationView} from './overview-court-coverage'
import type {SceneMap} from './scene-map'
import {venueModelTile} from './service-model-location'
import { createFacilityBoundaryIndex } from './facility-boundaries'
import { chainMapFeature } from './industry-panorama'
import ServiceResourceOverview from './ServiceResourceOverview.vue'
import OverviewPanelIcon from './OverviewPanelIcon.vue'
import { serviceIcons } from './service-icons'
import OpeningWorkbench from './OpeningWorkbench.vue'
import VenueSupportCapacity from './VenueSupportCapacity.vue'
import VenueSupportMetrics from './VenueSupportMetrics.vue'
import VenueReservationCharts from './VenueReservationCharts.vue'
import VenueBookingHistory from './VenueBookingHistory.vue'
import VenueBookingOrigins from './VenueBookingOrigins.vue'
import { originShare } from './venue-booking-origin'
import { analyzeVenueBookings } from './venue-booking-analysis'
import type { BookingSnapshot } from './venue-reservation-data'
import NearbyFacilityList from './NearbyFacilityList.vue'
import ServiceSceneTabs from './ServiceSceneTabs.vue'
import {facilityDirectory, isFacilityAttraction, facilityDirectoryRows, facilityResource, facilitySiteKey, nearbyFacilitySites, nearbyProviders, reverseVenues, supportAssessment, serviceDetailRadiusKm, serviceDistance, supportCategories, supportFilterOrder, supportLayerIds, resources, type Facility,type SupportKind} from './venue-support'
import type {OpeningSchedule} from './opening-schedule'
import { featureCenter, type CityFeature, type Dataset, type Result } from './types.ts'
import type { VenueFacilityCapacity } from './venue-capacity.ts'
import { numberedVenueCourts, venueFieldCounts } from './court-ledger'
import { venueOwnershipGroup, venueOwnershipGroups, type VenueOwnership } from './venue-ownership.ts'
import IndustryRail from './IndustryRail.vue'
import IndustryModule from './IndustryModule.vue'
import VenueOpeningCoordination from './VenueOpeningCoordination.vue'
import VenueOpeningTaskList from './VenueOpeningTaskList.vue'
import type { GapArea, OpeningPopulation } from './opening-population'
import ServicePager from './ServicePager.vue'
import { useServicePage } from './service-pagination'
import { useSceneAssistant } from './scene-assistant-context'

type VenueTab = 'file'|'courts'|'use'|'support'
const props = defineProps<{
  datasets:Dataset[]; rules:Record<string,number>; mode:'demo'|'live'; region:string; communityId:string
  leftOpen:boolean; rightOpen:boolean; cameraHeight:number; selectedFeature?:CityFeature|null; results:Result[]
  mapPick?: {feature: CityFeature} | null
  planningData:Dataset[]; plans:OpeningSchedule[]; version:number; today:string
  serviceResources:{venues:VenueFacilityCapacity[]; opening?:OpeningPopulation; gaps:GapArea[]}; scheduleWarning:string
  coverageSummary?:CoverageGridSummary; populationView:PopulationView; populationRadiusM:number
  populationVisible:boolean; populationArea:string; venuePopulation?:number
}>()
const emit = defineEmits<{
  'scene-map':[view:SceneMap,keepCamera?:boolean]
  'highlight-venue':[id:string|undefined]
  locate:[feature:CityFeature,datasetId?:string]
  close:[side:'left'|'right']
  open:[side:'left'|'right']
  'select-court':[courtId:string]
  'set-layer':[id:string,enabled:boolean]
  'population-view':[view:PopulationView]
  'population-radius':[meters:number]
}>()
const details = [['file','基本信息'],['courts','逐片台账'],['support','周边配套'],['use','利用率']] as const
const pane = ref<'venues'|'plan'|'gaps'|'facilities'|'tasks'>('venues')
const areaId=ref(''), selectedCourts=ref<string[]>([])
const openingScene=shallowRef<SceneMap>()
watch(pane,()=>{
  areaId.value=''
  openingScene.value=undefined
},{flush:'sync'})
function navigate(tab:typeof pane.value|'opening'){
  const next=tab==='opening'?'gaps':tab
  if(next==='tasks' && pane.value!=='tasks'){taskLink.value=undefined;taskDetail.value=null}
  if(next==='venues')venueId.value=''
  if(next==='facilities'){
    if(pane.value!=='facilities') directorySource.value='all'
    supportKind.value='';focusedFacility.value=undefined;facilityQuery.value='';facilityList.go(1)
  }
  pane.value=next
  emit('open','left')
  if(window.matchMedia('(max-width: 876px)').matches)emit('close','right')
  else emit('open','right')
}
const taskLink = ref<OpeningTaskLink>()
const taskDetail=shallowRef<OpeningTask|null>(null)
const taskRefresh = ref(0)
const taskRows=shallowRef<OpeningTaskRow[]>([])
const venueTab = ref<VenueTab>('file')
const bookingHistory = shallowRef<BookingSnapshot|null>(null)
const bookingFailed = ref(false)
const bookingRetry = ref(0)
const bookingStartView = ref<'history'|'snapshot'|'regions'>('history')
const bookingCourt = ref('')
const bookingVisit = ref(0)
let loadedBookingVersion:number|undefined
watch([()=>pane.value==='venues',()=>props.version,bookingRetry],async ([showVenues,version],_,onCleanup)=>{
  if(!showVenues || !version || (bookingHistory.value && loadedBookingVersion===version)) return
  const controller=new AbortController()
  onCleanup(()=>controller.abort())
  bookingHistory.value=null
  bookingFailed.value=false
  try {
    const snapshot=await api<BookingSnapshot>('/venue-reservations',{signal:controller.signal})
    if(controller.signal.aborted)return
    bookingHistory.value=snapshot
    loadedBookingVersion=version
  } catch {
    if(!controller.signal.aborted)bookingFailed.value=true
  }
},{immediate:true})
const query = ref('')
const facilityQuery = ref('')
const town = ref('')
const ownership = ref<VenueOwnership|''>('')
const directoryGroup=ref<'venues'|'unassigned'>('venues')
const opening = ref('')
const supportKind = ref<SupportKind|''>('')
const venueId = ref('')
const courtId = ref('')
const venueHeading = ref<HTMLElement>()
function resetVenueScroll() {
  nextTick(() => venueHeading.value?.closest('.industry-module-body')?.scrollTo({top:0}))
}
function openCourt(court: CityFeature, fromMap = false) {
  courtId.value = court.id
  venueTab.value = 'courts'
  if (fromMap) resetVenueScroll()
  else emit('select-court',court.id)
}
const bookingDate = ref('')
const detailRadiusM = serviceDetailRadiusKm*1000
const assistant = useSceneAssistant()
const missing = '未报送'
const fmt = new Intl.NumberFormat('zh-CN')
const number = (value:unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
const text = (value:unknown) => typeof value === 'string' && value.trim() ? value : undefined
const display = (value:number|undefined,unit = '') => value === undefined ? missing : fmt.format(value) + unit
const percent = (part:number|undefined,total:number|undefined) =>
  part === undefined || total === undefined || total <= 0 ? missing : Math.round(part / total * 100) + '%'
const features = (id:string) => props.datasets.find(dataset => dataset.id === id)?.features ?? []
const matches = (name:string,search:string) => name.toLocaleLowerCase('zh-CN').includes(search.trim().toLocaleLowerCase('zh-CN'))
const inRegion = (feature:CityFeature) => props.region === '京山市' || feature.properties.region === props.region
const venues = computed(() => {
  const available = props.serviceResources.venues.filter(item => inRegion(item.feature))
    .map(item=>({...item,ownershipGroup:venueOwnershipGroup(item.feature.properties.ownership)}))
  return available
})
const isUnassigned=(item:VenueFacilityCapacity)=>Boolean(item.feature.properties.ledgerId && !item.feature.properties.facilityName)
const unassignedCount=computed(()=>venues.value.filter(isUnassigned).length)
const namedCount=computed(()=>venues.value.length-unassignedCount.value)
const registeredCourtCount=computed(()=>venues.value.reduce((n,item)=>n+(isUnassigned(item)?0:item.totalCourts),0))
const towns = computed(() => [...new Set(venues.value.map(item => item.region))])
const boundaries = computed(() => createFacilityBoundaryIndex(features('administration'), features('communities')))
const bookingVenueIds = computed(() => venues.value
  .filter(item => !town.value || item.region === town.value)
  .filter(item => !props.communityId || boundaries.value.locate(item.position).village?.id === props.communityId)
  .map(item => item.id))
const taskVenue = computed(() => {
  const link = taskLink.value
  return link && (venues.value.find(item => item.id === link.venueId) ?? {id:link.venueId, name:link.venueName})
})
function openTask(link:OpeningTaskLink) {
  if(taskLink.value?.taskId!==link.taskId)taskDetail.value=null
  taskLink.value = link
  emit('open','right')
  pane.value='tasks'
}
function showTaskDetail(task:OpeningTask|null){
  taskDetail.value=task
  if(task && task.id!==taskLink.value?.taskId)taskLink.value=openingTaskLink(task)
}
watch([() => props.region, () => props.communityId, () => props.mode], () => {
  taskLink.value=undefined;taskDetail.value=null;taskRows.value=[];venueId.value='';focusedFacility.value=undefined
  selectedCourts.value=[];areaId.value='';openingScene.value=undefined
})
const timedVenues = computed(() => new Set(features('courts').flatMap(item =>
  item.properties.status === '错时开放' ? text(item.properties.facilityId) ?? [] : [])))
function venueOpen(item:VenueFacilityCapacity) {
  if (item.openCourts && item.openCourts < item.totalCourts) return '部分开放'
  if (item.openCourts) return '开放'
  if (item.feature.properties['建设状态']==='在建') return '在建'
  if(isUnassigned(item) || !item.feature.properties.status || item.feature.properties.status==='待确认') return '待核实'
  return item.feature.properties.status === '错时开放' || timedVenues.value.has(item.id) ? '错时' : '暂未开放'
}
const filteredVenues = computed(() => venues.value.filter(item => (directoryGroup.value==='unassigned')===isUnassigned(item) && matches(item.name,query.value) &&
  (!town.value || item.region === town.value) && (!opening.value || venueOpen(item) === opening.value) &&
  (!ownership.value || item.ownershipGroup?.label===ownership.value)))
const venueList = useServicePage(filteredVenues, [query, town, ownership, directoryGroup, opening, () => props.region], 10)
const filteredCourtCount = computed(() => filteredVenues.value.reduce((n,item)=>n+item.totalCourts,0))
const venue = computed(() => {
  if (!venueId.value) return
  // A facility's service circle may cross the active district boundary.
  const item = props.serviceResources.venues.find(row => row.id === venueId.value)
  return item && {...item,ownershipGroup:venueOwnershipGroup(item.feature.properties.ownership)}
})
const venueInstitutions = computed(() => providersAtVenue(tourismProviders(props.datasets), venue.value?.name ?? ''))
watch(filteredVenues, rows => {
  if (venue.value && inRegion(venue.value.feature) && !rows.some(item => item.id === venueId.value)) venueId.value = ''
})
const operations = computed(() => {
  const records = new Map<string,CityFeature>()
  const date = (item:CityFeature) => text(item.properties.updatedAt) ?? text(item.properties.month) ?? ''
  for (const item of features('venue_operations')) {
    const id = text(item.properties.venueId)
    if (!id) continue
    const previous = records.get(id)
    if (!previous || date(item) >= date(previous)) records.set(id,item)
  }
  return records
})
const operation = computed(() => venue.value ? operations.value.get(venue.value.id)?.properties : undefined)
const venueBooking = computed(() => bookingHistory.value && venue.value ? analyzeVenueBookings(bookingHistory.value,venue.value.id) : undefined)
const venueOrigins = computed(() => bookingHistory.value?.origins?.venues.find(item => item.venueId === venue.value?.id))
const bookingPercent = (rate:number|null) => rate===null ? '—' : rate.toFixed(1)+'%'
const operationPeriod = computed(() => text(operation.value?.month) ?? '近30日')
const operationPeak = computed(() => text(operation.value?.peakSummary) ?? '暂无峰值时段记录')
function bookingRate(id:string) {
  const record = operations.value.get(id)?.properties
  return percent(number(record?.bookedHours),number(record?.availableHours))
}
function usedHours(id:string) {
  const record = operations.value.get(id)?.properties
  return number(record?.usedHours) ?? number(record?.actualHours)
}
function usageRate(id:string) {
  return percent(usedHours(id),number(operations.value.get(id)?.properties.availableHours))
}
function selectVenueOwnership(label:VenueOwnership) {
  venueId.value = ''
  ownership.value = ownership.value === label ? '' : label
}
function selectVenue(item:VenueFacilityCapacity) {
  directoryGroup.value=isUnassigned(item)?'unassigned':'venues'
  if (pane.value!=='venues' || venueId.value!==item.id) {
    venueTab.value='file'
    resetVenueScroll()
  }
  pane.value='venues'
  if (!matches(item.name,query.value)) query.value=''
  if (town.value && town.value!==item.region) town.value=''
  if (ownership.value && ownership.value!==venueOwnershipGroup(item.feature.properties.ownership)?.label) ownership.value=''
  if (opening.value && opening.value!==venueOpen(item)) opening.value=''
  venueId.value = item.id
  venueList.reveal(filteredVenues.value.findIndex(row=>row.id===item.id))
  emit('open','right')
}

function openVenueBooking(item:VenueFacilityCapacity, view:'history'|'snapshot'|'regions'='history', court='') {
  selectVenue(item)
  bookingVisit.value++
  bookingCourt.value=court
  bookingStartView.value=view
  venueTab.value='use'
  resetVenueScroll()
}
function openBookingSnapshot(id:string) {
  const item=venues.value.find(v=>v.id===id)
  if(item)openVenueBooking(item,'snapshot')
}

type SourceScope='reported'|'sample'|'all'
const directorySource=ref<SourceScope>('all')
const capacitySource=computed<SourceScope>(()=>
  props.mode==='live'||props.datasets.some(d=>d.id==='commerce_hotels'||d.id==='commerce_food')?'reported':'all')
const scopeLabels:Record<SourceScope,string>={all:'全部来源',reported:'实采与接入数据',sample:'演示数据'}
const matchesSource=(feature:CityFeature,source:SourceScope)=>source==='all'||(feature.properties.sample===true)===(source==='sample')
const supportLayers=computed(()=>props.datasets.filter(d=>supportLayerIds.includes(d.id)))
const allProviders=computed(()=>facilityDirectory(supportLayers.value))
const supportData=computed(()=>supportLayers.value.flatMap(d=>{
  if(capacitySource.value==='all')return [d]
  const filtered=d.features.filter(f=>matchesSource(f,capacitySource.value))
  return filtered.length?[{...d,features:filtered}]:[]
}))
const facilityAreas = computed(() => {
  const index = boundaries.value
  const areas = new Map<CityFeature, ReturnType<typeof index.locate> & { hasPoint:boolean }>()
  for (const item of allProviders.value) {
    if (areas.has(item.feature)) continue
    const mapped = chainMapFeature(item.feature,item.layer)
    const point = mapped.geometry && featureCenter(mapped)
    areas.set(item.feature, point ? { ...index.locate(point),hasPoint:true } : { hasPoint:false })
  }
  return areas
})
function facilityInArea(item: Facility) {
  if (!props.communityId && props.region === '京山市') return true
  const area = facilityAreas.value.get(item.feature)
  if (props.communityId) return area?.village?.id === props.communityId
  return area?.town?.properties.name === props.region
}
const supports=computed(()=>allProviders.value.filter(item=>facilityInArea(item)&&matchesSource(item.feature,directorySource.value)))
const filteredSupports=computed(()=>pane.value==='facilities'
  ? facilityDirectoryRows(supports.value.filter(item=>matches(item.feature.properties.name,facilityQuery.value)),supportKind.value) : [])
const facilityList=useServicePage(filteredSupports,[facilityQuery,supportKind,directorySource,()=>props.region,()=>props.communityId],10)
const focusedFacility=ref<Facility>()
watch([directorySource,()=>props.communityId],()=>{focusedFacility.value=undefined},{flush:'sync'})
const facility=computed(()=>{
  const selected=focusedFacility.value
  if(!selected || !matches(selected.feature.properties.name,facilityQuery.value))return
  return allProviders.value.find(item=>item.kind===selected.kind && item.feature.id===selected.feature.id)
})
const selectedFacilityArea = computed(() => facility.value && facilityAreas.value.get(facility.value.feature))
const unresolvedFacilityArea = computed(() => selectedFacilityArea.value?.hasPoint ? '区划未匹配' : '设施待定位')
const resourceOverview = computed(() => (pane.value === 'venues' && !venue.value) ||
  (pane.value === 'facilities' && !facility.value))
function setCategory(kind:SupportKind){
  supportKind.value=supportKind.value===kind?'':kind
  focusedFacility.value=undefined
  facilityList.go(1)
}
function focusFacility(item:Facility){
  if(pane.value!=='facilities'||!matchesSource(item.feature,directorySource.value)) directorySource.value='all'
  if(pane.value!=='facilities'||supportKind.value!==item.kind) supportKind.value=''
  pane.value='facilities'
  if(!matches(item.feature.properties.name,facilityQuery.value))facilityQuery.value=''
  focusedFacility.value=item
  facilityList.reveal(filteredSupports.value.findIndex(row=>facilitySiteKey(row)===facilitySiteKey(item)))
}
function selectFacility(item:Facility){
  if(pane.value!=='facilities')emit('open','left')
  focusFacility(item)
  emit('open','right')
}
let closingResourceDetail=false
function clearResourceDetail(){
  if (pane.value==='venues' && venueId.value) {
    closingResourceDetail=true
    venueId.value=''
  } else if (pane.value==='facilities' && focusedFacility.value) {
    closingResourceDetail=true
    focusedFacility.value=undefined
    markedVenueId.value=''
  }
}
function closeResourceDetail(){
  clearResourceDetail()
  emit('open','left')
  if(window.matchMedia('(max-width: 876px)').matches)emit('close','right')
}
watch(()=>props.rightOpen,open=>{
  if(!open)clearResourceDetail()
})
watch(()=>props.cameraHeight,(height,previous)=>{
  // Once the user leaves the 1 km detail view, restore the complete filtered directory.
  if(pane.value==='facilities' && facility.value && previous<16000 && height>=16000)closeResourceDetail()
})
const profileFields:Record<SupportKind,[string,string,string][]> = {
  hotels:[['type','住宿类型',''],['rooms','客房数','间'],['price','平均房价',' 元']], food:[['cuisine','菜系',''],['grade','等级','']],
  parking:[['accessible','无障碍车位','个']],
  charging:[['stationCode','站点编号',''],['chargeType','充电类型',''],['siteType','建设场所',''],['assetOwner','资产单位',''],
    ['gunPowerKw','单枪功率',' kW'],['totalPowerKw','总功率',' kW'],['completedOn','建成日期','']],
  springs:[['type','温泉类型','']],
  medical:[['facilityType','机构类型',''],['level','机构等级',''],['emergency','急诊服务','']], coaches:[['level','培训层级',''],['trainees','学员','人']],
  partners:[['level','服务水平','']], tourism:[['facilityType','景区类型','']], shopping:[['category','经营类型','']]
}
const currentResource=computed(()=>facility.value&&facilityResource(facility.value))
const tariffRows=computed(()=>features('form_jingyuan_tariffs')
  .filter(f=>facility.value?.feature.properties.tariffGroup&&f.properties.tariffGroup===facility.value.feature.properties.tariffGroup)
  .sort((a,b)=>a.properties.name.localeCompare(b.properties.name)))
const tariffPage=useServicePage(tariffRows,[()=>facility.value?.feature.id])
const tariffPrice=(value:unknown)=>typeof value==='number'?value.toFixed(4):'—'
const sameSiteStations=computed(()=>{
  const current=facility.value
  if(current?.layer!=='charging'||current.feature.geometry.type!=='Point')return []
  const [lon,lat]=current.feature.geometry.coordinates
  return supports.value.filter(item=>item.layer==='charging'&&item.feature.id!==current.feature.id&&
    item.feature.geometry.type==='Point'&&item.feature.geometry.coordinates[0]===lon&&item.feature.geometry.coordinates[1]===lat)
})
const providerMetrics=computed(()=>{
  const item=facility.value
  if(!item)return []
  const p=item.feature.properties
  const metrics:{label:string;value:string}[]=resources.flatMap(resource=>{
    const capacity=number(p[resource.registered])
    const unit=resource.id==='beds'?'张':resource.id==='seats'?'个':resource.unit
    return capacity===undefined?[]:[{label:resource.label,value:display(capacity,unit)}]
  })
  const extra = {charging:['gunCount','充电枪','把'],
    coaches:['coaches','教练','人'],partners:['sparringPartners','陪练','人']} as const
  if(item.kind==='charging'||item.kind==='coaches'||item.kind==='partners'){
    const [field,label,unit]=extra[item.kind]
    const value=number(p[field])
    if(value!==undefined)metrics.unshift({label,value:display(value,unit)})
  }
  const available=currentResource.value
  if(available && number(p[available.available])!==undefined){
    metrics.push({label:'可用'+available.label,value:display(number(p[available.available]),available.unit)})
  }
  return metrics
})
const profile=computed(()=>{
  const item=facility.value
  if(!item)return []
  return profileFields[item.kind].flatMap(([key,label,unit])=>{
    const value=item.feature.properties[key]
    if(typeof value==='string'&&value.trim()||typeof value==='number')return [{label,value:String(value)+unit}]
    return typeof value==='boolean'?[{label,value:value?'提供':'不提供'}]:[]
  })
})
const supportedVenues=computed(()=>facility.value?reverseVenues(facility.value,props.serviceResources.venues.filter(item=>!isUnassigned(item)),detailRadiusM).filter(row=>row.meters<=detailRadiusM):[])
const nearbyFacilityRows=computed(()=>{
  const f=facility.value
  if (!f) return []
  const attractions=allProviders.value.filter(p=>isFacilityAttraction(p) && matchesSource(p.feature,directorySource.value))
  return nearbyFacilitySites(featureCenter(f.feature),attractions,detailRadiusM,facilitySiteKey(f))
})
const servedList=useServicePage(supportedVenues,[()=>facility.value?.feature.id,()=>facility.value?.kind])
const markedVenueId=ref('')
watch([()=>facility.value?.feature.id,()=>facility.value?.kind],()=>{markedVenueId.value=''}, {flush:'sync'})
const visibleVenueId=computed(()=>servedList.rows.find(row=>row.venue.id===markedVenueId.value)?.venue.id??servedList.rows[0]?.venue.id)
watch(()=>pane.value==='facilities' && facility.value ? visibleVenueId.value : undefined,
  id=>emit('highlight-venue',id),{immediate:true})
function returnToDirectory(){
  if(pane.value==='venues'){
    if(venue.value){query.value='';town.value='';opening.value=''}
    ownership.value=''
    navigate('venues')
  }
  else navigate('facilities')
}

const courts = computed(() => venue.value ? features('courts').filter(item => item.properties.facilityId === venue.value?.id) : [])
const courtChoices = computed(() => numberedVenueCourts(courts.value))
const chosenCourt = computed(() => courts.value.find(item => item.id === courtId.value) ?? courtChoices.value[0]?.court)
const venueForms = computed(() => venueFieldCounts(courts.value,'场地形式'))
const venueSchedules = computed(() => venueFieldCounts(courts.value,'开放时段'))
const venueCoordination = computed(() => venueFieldCounts(courts.value,'是否可协调'))
function showLedgerValue(value:string) { return value.split('|').map(item => item.trim()).join('、') }
const courtFieldOrder = ['所属场馆','权属','镇街或片区','场地形式','地面类型','建设状态','开放方式','开放条件','开放时段','是否可协调','可协调日期类型','可协调时段','协调限制','管理单位','运营单位'] as const
const courtFieldLabels:Partial<Record<typeof courtFieldOrder[number],string>> = {'镇街或片区':'镇街片区','可协调日期类型':'协调日期','可协调时段':'协调时段'}
const courtFields = computed(() => {
  const p = chosenCourt.value?.properties
  if (!p) return []
  const rows = courtFieldOrder.map(key => {
    const value = text(p[key]) || '未填'
    return {key,label:courtFieldLabels[key] ?? key,value,wide:key==='所属场馆' || value.length>10}
  })
  return p.ledgerId && !p['名称'] ? [{key:'名称',label:'台账名称',value:'未填',wide:false},...rows] : rows
})
const courtSlots = computed(() => features('court_slots').filter(item => item.properties.courtId === chosenCourt.value?.id))
const dates = computed(() => {
  const values = [...new Set(courtSlots.value.flatMap(item => text(item.properties.date) ?? []))].sort().reverse()
  return values
})
const activeDate = computed(() => dates.value.includes(bookingDate.value) ? bookingDate.value : dates.value[0])
const slots = computed(() => {
  const records = courtSlots.value.filter(item => item.properties.date === activeDate.value).flatMap(item => {
    const time = text(item.properties.time)
    return time ? [{time,status:text(item.properties.status) ?? missing}] : []
  }).sort((a,b) => a.time.localeCompare(b.time))
  return records
})
const slotList = useServicePage(slots, [() => chosenCourt.value?.id, activeDate])
function courtStatus(item:CityFeature) {
  const status = text(item.properties.status)
  if (status === '维护' || status === '已预订') return status
  if (item.properties.scheduledOpening) return '按排期开放'
  return status ?? (item.properties.open ? '开放' : '未填')
}
function courtTone(item:CityFeature) {
  const status = courtStatus(item)
  return status === '维护' ? 'muted' : status === '已预订' ? 'amber' : item.properties.open ? 'green' : 'muted'
}
const weekdays = ['周一','周二','周三','周四','周五','周六','周日']
const heatRows = ['上午','下午','晚间']
const heat = computed(() => {
  const source = operation.value?.usageHeatmap
  if (Array.isArray(source) && source.length === 3 && source.every(row => Array.isArray(row) && row.length === 7))
    return (source as unknown[][]).map(row => row.map(number))
  return undefined
})

const trends=computed(()=>{
  const series=(weekend:boolean)=>heat.value?.map(row=>{
    const days=row.slice(weekend?5:0,weekend?7:5).filter((n):n is number=>n!==undefined)
    return days.length?Math.round(days.reduce((a,b)=>a+b,0)/days.length):undefined
  })
  return [{label:'工作日',color:'#48c9d5',values:series(false)},{label:'周末',color:'#519bf9',values:series(true)}]
})
assistant.register(computed(() => {
  const item = venue.value
  if (!props.rightOpen || pane.value !== 'venues' || !item) return null
  const history=venueBooking.value
  if(history) return {
    key:'venue-booking:'+item.id,
    title:item.name+' · 场地占用分析',
    prompts:['哪个时段占用最多？','最近一日场地占用情况如何？',...(venueOrigins.value ? ['订场客源来自哪些地区？'] : [])],
    answer(question:string) {
      if (/地区|归属地|客源|哪里|哪儿/.test(question) && venueOrigins.value) {
        const people=venueOrigins.value
        const areas=[...people.regions].sort((a,b)=>b.members-a.members).slice(0,3)
        if (!areas.length) return '本馆暂无可展示的客源地区分布。'
        return '按已识别的手机号归属地统计，本馆客源占比靠前的地区有'+areas.map(r=>(r.city===r.province?r.city:r.province+r.city)+'（'+originShare(r.members,people.locatedMembers)+'）').join('、')+'。可在“订场客源”查看完整分布。'
      }
      if(/最新|最近|当日|今日|今天/.test(question))
        return history.latest.date+' 的网站记录中，综合占用率为 '+bookingPercent(history.latest.totals.rate)+'。在逐场时间表里可查看各片场地的小时记录和台账开放时段。'
      if(/时段|高峰|紧张|运营|改善|建议/.test(question))return history.insights.join(' ')
      return history.startDate+' 至 '+history.endDate+'，网站登记的 '+history.courtCount+' 片场地综合占用率为 '+bookingPercent(history.totals.rate)+'，占用 '+fmt.format(history.totals.occupied)+' 场地小时。同一片场地的重叠时长只计一次。'
    },
  }
  return {
    key: 'venue:' + item.id,
    title: item.name + ' · 运营台账',
    prompts: ['场馆的预订率和使用率是多少？', '高峰时段有多紧张？'],
    answer(question: string) {
      const record = operation.value
      const period = operationPeriod.value + (record?.sample === true ? '演示台账' : '运营台账')
      if (/高峰|紧张|满约/.test(question)) {
        return period + ' · ' + operationPeak.value + '。'
      }
      if (/预订|使用|运营|利用|余量/.test(question)) {
        return period + '显示，预订率为' + bookingRate(item.id) + '，实际使用率为' + usageRate(item.id) + '。周边可用量可在场馆的配套台账中查看。'
      }
      return '可查询当前场馆的预订率、使用率或峰值记录。'
    },
  }
}))
watch(() => props.region,() => { town.value = '' })
watch(() => venue.value?.id,() => { courtId.value = '' }, {flush:'sync'})
watch(() => chosenCourt.value?.id,() => bookingDate.value = '')
function revealFeature(feature: CityFeature | null | undefined, fromMap = false) {
  if (!feature) return
  if(fromMap&&feature.properties.kind==='service-task'){
    const task=taskRows.value.find(t=>t.id===feature.properties.taskId)??(taskDetail.value?.id===feature.properties.taskId?taskDetail.value:null)
    if(task)openTask({venueId:task.venueId,venueName:task.venueName,taskId:task.id})
    return
  }
  if(fromMap&&['service-range','service-link','service-coverage'].includes(feature.properties.kind))return
  if(fromMap && pane.value==='facilities' && facility.value && feature.properties.mapRole==='venue' && feature.properties.markerStyle==='service-range-pin'){
    const row=supportedVenues.value.find(row=>row.venue.id===feature.id)
    if(row)selectVenue(row.venue)
    return
  }
  if(pane.value==='plan'||pane.value==='gaps'||pane.value==='tasks')return
  const target = text(feature.properties.facilityId) ?? feature.id
  const selected = venue.value?.id===target ? venue.value : venues.value.find(item => item.id === target)
  if (feature.properties.mapRole!=='support' && selected && (fromMap || pane.value === 'venues')) {
    const center = feature.properties.mapRole === 'venue'
    const activeCenter = center && venueId.value === selected.id
    selectVenue(selected)
    const court = center ? (activeCenter && courts.value.length === 1 ? courts.value[0] : undefined)
      : courts.value.find(item => item.id === feature.id)
    if (court) {
      openCourt(court,true)
      if (activeCenter) emit('select-court',court.id)
    }
    return
  }
  const item = allProviders.value.find(item => item.feature.id === feature.id && item.kind===(feature.properties.supportKind??supportKind.value))??allProviders.value.find(item=>item.feature.id===feature.id)
  if (item && (fromMap || pane.value === 'facilities')) {
    focusFacility(item)
    if(fromMap)emit('open','right')
  }
}

watch(() => props.mapPick,pick => revealFeature(pick?.feature, true))
const capacityProviders=computed(()=>allProviders.value.filter(item=>matchesSource(item.feature,capacitySource.value)))
const venueProviders=computed(()=>venue.value?nearbyProviders(venue.value,capacityProviders.value,detailRadiusM):[])
const venueGuests=computed(()=>number(venue.value?.feature.properties.capacity))
const supportMetrics=computed(()=>supportAssessment(
  venueProviders.value, supportData.value,
  {guests:venueGuests.value??0, overnight:20, dining:80, driving:40, perCar:2, charging:10, reserve:10},
))
const sceneMap=computed<SceneMap>(()=>{
  if(pane.value==='venues'){
    if(venue.value){
      const item=venue.value
      const hasModel=Boolean(venueModelTile(item))
      return venueDetailMap(item,venueProviders.value,serviceDetailRadiusKm,hasModel)
    }
    const ledgerFilter = Boolean(directoryGroup.value==='unassigned' || ownership.value || opening.value || query.value.trim())
    const venueMatches = ledgerFilter ? filteredVenues.value.map(v=>venuePin(v,false,'ownership')) : []
    return {focus:'county',populationOverview:true,populationRegion:town.value,
      courtFootprints:ledgerFilter ? undefined : {region:town.value}, features:venueMatches}
  }
  if(pane.value==='facilities'){
    if(facility.value)return facilityDetailMap(facility.value,supportedVenues.value,serviceDetailRadiusKm,nearbyFacilityRows.value)
    return supportOverviewMap(filteredSupports.value)
  }
  if(pane.value==='plan'||pane.value==='gaps')return openingScene.value?.servicePane===pane.value ? openingScene.value : {focus:'county',populationMode:'opening',features:[]}
  if(pane.value==='tasks'){
    const features=taskPins(taskRows.value,venues.value,taskLink.value?.taskId)
    const detail=taskDetail.value
    if(detail&&detail.id===taskLink.value?.taskId){
      const sites=detail.history[0]?.proposal?.venues??[{id:detail.venueId,name:detail.venueName}]
      for(const site of sites){
        if(features.some(f=>f.properties.taskId===detail.id&&f.properties.venueId===site.id))continue
        const row={...detail,venueId:site.id,venueName:site.name,requirement:detail.history[0]?.note??''}
        for(const pin of taskPins([row],venues.value,detail.id))features.push({...pin,id:pin.id+':'+site.id})
      }
    }
    const selected=features.find(f=>f.properties.selected)
    const anchor=selected&&featureCenter(selected)
    return {populationMode:'opening',
      features:features.map(f=>({...f,properties:{...f.properties,labelMaxDistance:7500,limitLabelAtDistance:true}})),
      ...(anchor?{focus:'area' as const,anchor,height:7000}:{focus:'county' as const})}
  }
  return {focus:'county',features:[]}
})
watch(sceneMap,view=>{
  emit('scene-map',{...view,servicePane:pane.value},closingResourceDetail && resourceOverview.value)
  closingResourceDetail=false
},{immediate:true})
</script>

<template>
  <Teleport defer to="#service-map-navigation"><ServiceSceneTabs :active="pane==='venues'?'venues':pane==='facilities'?'facilities':'opening'" @select="navigate($event)"/></Teleport>
  <OpeningWorkbench v-if="pane==='plan'||pane==='gaps'" :pane="pane" :data="planningData" :plans="plans" :model="serviceResources.opening" :areas="serviceResources.gaps"
    :region="region" :scope-name="populationArea" :mode="mode" :version="version" :task-refresh="taskRefresh" :today="today" :left-open="leftOpen" :right-open="rightOpen" :warning="scheduleWarning"
    v-model:area-id="areaId" v-model:chosen="selectedCourts" :map-pick="mapPick"
    @navigate="navigate" @task="openTask" @scene="openingScene=$event" @close="emit('close',$event)" @open="emit('open',$event)" @created="taskRefresh++"/>
  <template v-else>
  <IndustryRail side="left" :open="leftOpen" aria-label="服务能力台账">
    <IndustryModule :title="pane==='venues'?'场馆资源':pane==='facilities'?'配套资源':pane==='tasks'?'交办台账':'服务缺口片区'" class="service-venue-panel" fill>
      <template v-if="pane==='venues' && (venue || ownership) || pane==='facilities'" #heading-actions>
        <button class="industry-button svc-back" type="button" @click="returnToDirectory">查看全部分类</button>
      </template>
      <p v-if="scheduleWarning" role="alert">{{ scheduleWarning }}</p>
      <div v-if="pane==='tasks'" class="industry-tabs" aria-label="开放协调导航">
        <button type="button" @click="navigate('gaps')">缺口片区</button><button type="button" @click="navigate('plan')">协调方案</button><button aria-pressed="true">交办台账</button>
      </div>
      <template v-if="pane === 'venues'">
        <label class="service-search-box"><input v-model="query" type="search" aria-label="搜索场馆" placeholder="搜索场馆名称"></label>
        <div class="industry-filters venue-filters">
          <select v-model="directoryGroup" aria-label="场馆归属" @change="venueId='';ownership=''"><option value="venues">已登记场馆（{{namedCount}} 处 · {{registeredCourtCount}} 片场地）</option><option value="unassigned">所属场馆未填（{{unassignedCount}} 片场地）</option></select>
          <select v-model="town" aria-label="所属乡镇"><option value="">乡镇</option><option v-for="item in towns" :key="item">{{ item }}</option></select>
          <select v-model="opening" aria-label="开放状态"><option value="">开放状态</option><option>开放</option><option>部分开放</option><option>错时</option><option>暂未开放</option><option>在建</option><option>待核实</option></select>
        </div>
        <div v-if="directoryGroup==='venues'" class="industry-tabs venue-categories" role="group" aria-label="场馆类别">
          <button v-for="group in venueOwnershipGroups" :key="group.label" type="button" :aria-pressed="ownership===group.label" @click="selectVenueOwnership(group.label)">
            {{ group.shortLabel }}
          </button>
        </div>
        <div class="svc-venue-directory" role="group" aria-label="场馆列表">
          <button v-for="item in venueList.rows" :key="item.id" type="button" class="svc-venue-row"
            :aria-current="venue?.id===item.id" :title="item.name" @click="selectVenue(item)">
            <strong class="svc-venue-name">{{ item.name }}</strong>
            <span class="svc-venue-meta">
              <span v-if="item.ownershipGroup" class="svc-tag" data-type="ownership" :style="{'--tag-color':item.ownershipGroup.color}">{{ item.ownershipGroup.shortLabel }}</span>
              <span><i class="service-state-dot" :class="{open:item.openCourts>0}" aria-hidden="true"></i>{{ venueOpen(item) }}</span>
              <span class="svc-venue-count">{{ display(item.totalCourts,' 片') }}</span>
            </span>
          </button>
          <p v-if="!venueList.total">未找到匹配的场馆</p>
        </div>
      </template>
      <VenueOpeningTaskList v-else-if="pane === 'tasks'" :mode="mode" :region="region" :refresh-key="taskRefresh"
        :selected-id="taskLink?.taskId" @rows="taskRows=$event" @select="openTask" />
      <template v-else>
        <div class="industry-filters"><label>数据来源<select v-model="directorySource" aria-label="配套数据来源"><option v-for="(label,key) in scopeLabels" :key="key" :value="key">{{ label }}</option></select></label></div>
        <div class="industry-tabs support-categories" role="group" aria-label="配套设施类别">
          <button v-for="id in supportFilterOrder" :key="id" type="button" :aria-pressed="supportKind===id" @click="setCategory(id)">{{ supportCategories[id] }}</button>
        </div>
        <label class="service-search-box"><input v-model="facilityQuery" type="search" aria-label="搜索设施" placeholder="搜索设施"></label>
        <div class="svc-provider-list" role="group" aria-label="配套单位">
          <button v-for="item in facilityList.rows" :key="item.kind+':'+item.feature.id" type="button" class="svc-directory-row" :aria-current="!!facility && facilitySiteKey(facility)===facilitySiteKey(item)" :title="item.feature.properties.name" @click="selectFacility(item)">
            <OverviewPanelIcon :name="serviceIcons[item.kind]"/><span class="svc-provider-name">{{ item.feature.properties.name }}</span>
            <span v-if="!supportKind" class="svc-tag" :data-type="item.kind">{{ supportCategories[item.kind] }}</span><i aria-hidden="true"></i>
          </button>
          <p v-if="!facilityList.total">未找到匹配的设施</p>
        </div>
      </template>
      <template #actions>
        <ServicePager v-if="pane === 'venues'" class="venue-directory-pager" :pagination="venueList" label="场馆分页" compact>
          <template #total><span v-if="directoryGroup==='venues'">{{venueList.total}} 处场馆 · </span>{{filteredCourtCount}} 片场地</template>
        </ServicePager>
        <ServicePager v-else-if="pane === 'facilities'" :pagination="facilityList" label="配套设施分页" unit="处" compact />
        <button v-else-if="pane==='tasks'" class="industry-button primary" type="button" @click="navigate('plan')">新建协调方案</button>
      </template>
    </IndustryModule>
  </IndustryRail>

  <IndustryRail side="right" :open="rightOpen" :class="{ 'industry-detail-rail': !resourceOverview }" aria-label="服务能力详情">
    <IndustryModule v-if="resourceOverview" :title="pane==='venues'?'覆盖态势总览':'配套资源总览'" fill>
      <ServiceResourceOverview :section="pane==='venues'?'venues':'facilities'" :region="populationArea" :coverage="coverageSummary"
        :population-view="populationView" :population-visible="populationVisible" :radius-m="populationRadiusM"
        @population-view="emit('population-view',$event)" @population-radius="emit('population-radius',$event)"
        :supports="pane==='facilities'?supports:[]" :selected-kind="supportKind" @category="setCategory">
        <template #booking-statistics>
          <VenueReservationCharts v-if="bookingHistory" :history="bookingHistory" :venue-ids="bookingVenueIds" @select="openBookingSnapshot"/>
          <p v-else-if="bookingFailed" role="status">场地预订统计加载失败。<button type="button" class="industry-button" @click="bookingRetry++">重新加载</button></p>
          <p v-else role="status">正在读取场地预订统计…</p>
        </template>
      </ServiceResourceOverview>
    </IndustryModule>
    <IndustryModule v-else-if="pane === 'venues'" :title="venue && isUnassigned(venue) ? '场地详情' : '场馆详情'" fill>
      <template #heading-actions>
        <button class="industry-button svc-detail-close" type="button" aria-label="关闭场馆详情" title="关闭场馆详情" @click="closeResourceDetail"><span aria-hidden="true">×</span></button>
      </template>
      <template v-if="venue">
        <div ref="venueHeading" class="service-identity service-line">
          <h3>{{ venue.name }}</h3><span class="industry-status" :data-tone="venue.openCourts ? 'green' : 'amber'">{{ venueOpen(venue) }}</span>
        </div>
        <div class="industry-tabs service-detail-tabs" aria-label="场馆详情分类">
          <button v-for="[id,label] in details" :key="id" type="button" :aria-pressed="venueTab === id" @click="venueTab = id; bookingStartView='history'; bookingCourt=''">{{ id==='use' && venueBooking ? '占用率' : label }}</button>
        </div>
        <template v-if="venueTab === 'file'">
        <dl class="service-file-metrics">
          <div><dt>场地总数</dt><dd><b>{{ fmt.format(venue.totalCourts) }}</b> 片</dd></div>
          <div><dt>已开放场地</dt><dd><b>{{ fmt.format(venue.openCourts) }}</b> 片</dd></div>
          <div v-if="venueBooking"><dt>综合占用率</dt><dd><b>{{ bookingPercent(venueBooking.totals.rate) }}</b></dd></div>
          <div v-else><dt>实际使用率</dt><dd><b>{{ usageRate(venue.id) }}</b></dd></div>
        </dl>
        <dl class="industry-kv venue-profile-grid">
          <div><dt>所属镇街</dt><dd>{{ venue.region }}</dd></div>
          <div><dt>权属</dt><dd>{{ venue.ownershipGroup?.shortLabel ?? '待核实' }}</dd></div>
          <div v-if="isUnassigned(venue)"><dt>所属场馆</dt><dd>未填</dd></div>
          <div class="venue-wide"><dt>覆盖人口</dt><dd>{{ venuePopulation === undefined ? '无数据' : display(venuePopulation,' 人（估算）') }} · {{ populationRadiusM/1000 }} 公里</dd></div>
          <div v-if="text(venue.feature.properties.address)" class="venue-wide"><dt>地址</dt><dd>{{ venue.feature.properties.address }}</dd></div>
          <div class="venue-wide"><dt>场地构成</dt><dd class="venue-breakdown"><span v-for="[label,n] in venueForms" :key="label">{{ label }} <b>{{ n }}</b> 片</span><template v-if="!venueForms.length">未填</template></dd></div>
          <div class="venue-wide"><dt>开放时段</dt><dd class="venue-schedules">
            <span v-if="text(venue.feature.properties.currentScheduleHours)">当前排期 · {{ showLedgerValue(String(venue.feature.properties.currentScheduleHours)) }}</span>
            <button v-if="venueBooking" type="button" class="industry-row-action" @click="openVenueBooking(venue,'snapshot')">查看逐场时间表 ›</button>
            <component :is="venueBooking ? 'details' : 'div'">
              <summary v-if="venueBooking">台账开放时段</summary>
              <span v-for="[hours,n] in venueSchedules" :key="hours" class="venue-schedule-row">
                <small v-if="venueSchedules.length > 1">{{ n }} 片</small>
                <span class="venue-time-slots"><span v-for="(slot,index) in hours.split('|')" :key="index">{{ slot.trim() }}</span></span>
              </span>
              <span v-if="!venueSchedules.length">{{ showLedgerValue(text(venue.feature.properties.openingHours) || '未填') }}</span>
            </component>
          </dd></div>
          <div class="venue-wide"><dt>是否可协调</dt><dd class="venue-breakdown"><span v-for="[label,n] in venueCoordination" :key="label">{{ label }} <b>{{ n }}</b> 片</span><template v-if="!venueCoordination.length">未填</template></dd></div>
          <div v-for="key in ['管理单位','运营单位','建设状态','开放方式','开放条件']" :key="key" :class="{'venue-wide':['管理单位','运营单位','开放条件'].includes(key)}"><dt>{{key}}</dt><dd>{{ text(venue.feature.properties[key]) || (key==='运营单位' && text(venue.feature.properties.operator)) || '未填' }}</dd></div>
          <div v-for="provider in venueInstitutions" :key="provider.id" class="venue-wide"><dt>{{ provider.properties.providerType }}</dt><dd>{{ provider.properties.name }} · {{ provider.properties.venueRelation }}</dd></div>
        </dl>
        <div class="svc-preview-title"><h3 class="service-section-title">逐片台账</h3><button v-if="courtChoices.length" type="button" class="industry-row-action" @click="venueTab='courts';resetVenueScroll()">查看全部 {{ courtChoices.length }} 片 ›</button><span v-else>暂无记录</span></div>
        <template v-if="venueBooking">
          <div class="svc-preview-title"><h3 class="service-section-title">分时段占用率</h3><button type="button" class="industry-row-action" @click="openVenueBooking(venue)">查看占用热力 ›</button></div>
          <dl class="service-file-metrics">
            <div v-for="period in venueBooking.periods" :key="period.label"><dt>{{ period.label }}</dt><dd><b>{{ bookingPercent(period.rate) }}</b></dd></div>
          </dl>
          <p>网站登记 {{ venueBooking.courtCount }} 片 · {{ venueBooking.startDate }} 至 {{ venueBooking.endDate }}</p>
          <div v-if="venueOrigins" class="svc-preview-title"><h3 class="service-section-title">订场客源</h3><button type="button" class="industry-row-action" @click="openVenueBooking(venue,'regions')">查看地区分布 ›</button></div>
        </template>
        <template v-else>
        <div class="svc-preview-title"><h3 class="service-section-title">分时段使用率</h3><button class="industry-row-action" @click="venueTab='use'">利用率分析 ›</button></div>
        <section v-if="heat" class="industry-card service-trend">
          <div class="service-trend-key"><span v-for="s in trends" :key="s.label"><i :style="{background:s.color}"></i>{{ s.label }}</span></div>
          <svg viewBox="0 0 300 80" preserveAspectRatio="none" role="img" aria-label="上午、下午、晚间的工作日与周末平均使用率">
            <path v-for="y in [10,40,70]" :key="y" :d="'M8 '+y+' H292'" fill="none" stroke="var(--v14-chart-track)"/>
            <g v-for="s in trends" :key="s.label" :stroke="s.color" fill="none">
              <template v-for="(v,j) in s.values" :key="j">
                <line v-if="v!==undefined && j && s.values?.[j-1]!==undefined" :x1="12+(j-1)*138" :x2="12+j*138" :y1="74-s.values[j-1]!*0.66" :y2="74-v*0.66" stroke-width="3" vector-effect="non-scaling-stroke"/>
                <circle v-if="v!==undefined" :cx="12+j*138" :cy="74-v*0.66" r="3" :fill="s.color"><title>{{ s.label }} · {{ heatRows[j] }} {{ v }}%</title></circle>
              </template>
            </g>
          </svg>
          <div class="service-trend-x"><span v-for="label in heatRows" :key="label">{{ label }}</span></div>
          <p>{{ operationPeak }}</p>
        </section><p v-else>暂无分时段使用记录</p>
        </template>
        <div class="svc-preview-title"><h3 class="service-section-title">周边配套</h3><button class="industry-row-action" @click="venueTab='support'">查看设施 ›</button></div>
        <VenueSupportMetrics :rows="supportMetrics"/>
        </template>
        <template v-else-if="venueTab === 'courts'">
          <section v-if="courtChoices.length" class="industry-card venue-court-selector" aria-label="场地选择">
            <div class="service-line"><h4>选择场地</h4><span>共 {{ courtChoices.length }} 片</span></div>
            <div class="service-court-tiles">
              <button v-for="{court,number} in courtChoices" :key="court.id" type="button" class="industry-button service-court-tile" :data-tone="courtTone(court)"
                :aria-pressed="chosenCourt?.id === court.id" :title="court.properties.name" @click="openCourt(court)">
                <span class="service-court-mark" aria-hidden="true"></span><span>{{ number }}号场</span>
              </button>
            </div>
          </section>
          <p v-else>当前场馆暂无逐片档案</p>
          <section v-if="chosenCourt" class="industry-card venue-court-record" aria-label="所选场地信息">
            <h4>{{ chosenCourt.properties.name }}</h4>
            <dl class="industry-kv venue-profile-grid">
              <div v-for="field in courtFields" :key="field.key" :class="{'venue-wide':field.wide}">
                <dt :title="field.key">{{ field.label }}</dt><dd>{{ showLedgerValue(field.value) }}</dd>
              </div>
            </dl>
          </section>
          <section v-if="chosenCourt" class="industry-card">
            <div class="service-line">
              <h4>时段记录</h4>
              <select v-if="dates.length" :value="activeDate" aria-label="时段日期" @change="bookingDate = ($event.target as HTMLSelectElement).value">
                <option v-for="date in dates" :key="date">{{ date }}</option>
              </select>
            </div>
            <div v-if="slots.length" class="industry-stat-grid">
              <div v-for="slot in slotList.rows" :key="slot.time" class="industry-stat"><strong>{{ slot.time }}</strong><span>{{ slot.status }}</span></div>
            </div>
            <button v-if="venueBooking?.courts.some(c=>c.id===chosenCourt?.id)" type="button" class="industry-row-action" @click="openVenueBooking(venue,'snapshot',chosenCourt.id)">查看本场时间表 ›</button>
            <p v-else-if="!slots.length">当前场地暂无时段记录</p>
            <ServicePager v-if="slotList.total" :pagination="slotList" label="时段记录分页" />
          </section>
        </template>
        <template v-else-if="venueTab === 'use'">
          <VenueBookingHistory v-if="bookingHistory && venueBooking" :key="venue.id+':'+bookingVisit" :history="bookingHistory" :summary="venueBooking" :venue-id="venue.id" :initial-court="bookingCourt" :court-features="courts" :opening-plans="plans" v-model:view="bookingStartView">
            <template v-if="venueOrigins && bookingHistory.origins" #regions>
              <VenueBookingOrigins :counts="venueOrigins" :source="bookingHistory.origins" :scope="venue.name"/>
            </template>
          </VenueBookingHistory>
          <template v-else>
            <h3>{{ operationPeriod }}运营统计</h3>
            <dl class="industry-kv">
              <div><dt>预订率</dt><dd>{{ bookingRate(venue.id) }} · {{ display(number(operation?.bookedHours)) }} / {{ display(number(operation?.availableHours),'小时') }}</dd></div>
              <div><dt>实际使用率</dt><dd>{{ usageRate(venue.id) }} · {{ display(usedHours(venue.id)) }} / {{ display(number(operation?.availableHours),'小时') }}</dd></div>
            </dl>
            <h3>场地使用热力（使用率）</h3>
            <div v-if="heat" class="service-table-scroll">
              <table class="industry-table service-heat">
                <thead><tr><th>时段</th><th v-for="day in weekdays" :key="day">{{ day }}</th></tr></thead>
                <tbody><tr v-for="(row,index) in heat" :key="heatRows[index]">
                  <th scope="row">{{ heatRows[index] }}</th>
                  <td v-for="(value,day) in row" :key="weekdays[day]" :style="{background:value === undefined ? undefined : 'rgb(38 134 231 / ' + Math.min(.74,value * value / 13500) + ')'}">
                    {{ display(value,'%') }}
                  </td>
                </tr></tbody>
              </table>
            </div>
            <p v-else>暂无按星期与时段统计的使用记录</p>
            <p v-if="heat" class="service-heat-legend">使用率：低 <i aria-hidden="true"></i> 高</p>
            <section class="industry-card"><h4>高峰紧张度</h4>
              <p>{{ operationPeak }}</p>
            </section>
          </template>
        </template>
        <template v-else>
          <VenueSupportCapacity :key="venue.id" :venue-id="venue.id" :guests="venueGuests" :metrics="supportMetrics"
            :facilities="venueProviders" :radius="serviceDetailRadiusKm" @provider="selectFacility"/>
        </template>
      </template>
      <p v-else class="industry-card">当前范围暂无场馆档案</p>
      <template v-if="venue && venueTab === 'use'" #actions>
        <button type="button" class="industry-button primary" @click="venueTab='support'">查看周边配套</button>
        <button type="button" class="industry-button" aria-haspopup="dialog" aria-controls="scene-assistant-panel" @click="assistant.openFrom($event)">解读运营数据</button>
      </template>
    </IndustryModule>
    <IndustryModule v-else-if="pane === 'tasks'" title="交办单详情" fill>
      <button class="industry-button svc-mobile-return" type="button" @click="emit('close','right')">返回交办台账</button>
      <template v-if="taskVenue && taskLink">
        <div class="service-identity"><h3>{{ taskLink.venueName }}</h3></div>
        <VenueOpeningCoordination :key="taskLink.taskId" :venue="taskVenue" :mode="mode" :task-id="taskLink.taskId" @detail="showTaskDetail" @changed="taskRefresh++" />
      </template>
      <p v-else>选择左栏的协调任务可查看办理进度。</p>
    </IndustryModule>
    <template v-else>
      <IndustryModule title="配套详情">
        <template #heading-actions>
          <button class="industry-button svc-detail-close" type="button" aria-label="关闭配套详情" title="关闭配套详情" @click="closeResourceDetail"><span aria-hidden="true">×</span></button>
        </template>
        <template v-if="facility">
          <div class="svc-provider-heading">
            <OverviewPanelIcon :name="serviceIcons[facility.kind]"/>
            <div><h3 :title="facility.feature.properties.name">{{ facility.feature.properties.name }}</h3>
              <div class="svc-tag-line"><span class="svc-tag" :data-type="facility.kind">{{ supportCategories[facility.kind] }}</span><span v-if="facility.feature.properties.sample===true" class="svc-tag">演示</span></div></div>
          </div>
          <dl v-if="providerMetrics.length" class="service-file-metrics svc-provider-metrics" aria-label="服务能力">
            <div v-for="metric in providerMetrics" :key="metric.label"><dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd></div>
          </dl>
          <dl class="industry-kv svc-provider-fields">
            <div><dt>所属镇街</dt><dd>{{ selectedFacilityArea?.town?.properties.name ?? unresolvedFacilityArea }}</dd></div>
            <div><dt>所属村社区</dt><dd>{{ selectedFacilityArea?.village?.properties.name ?? unresolvedFacilityArea }}</dd></div>
            <div v-if="facility.feature.properties.address"><dt>地址</dt><dd :title="String(facility.feature.properties.address)">{{ facility.feature.properties.address }}</dd></div>
            <div v-for="item in sameSiteStations" :key="item.feature.id"><dt>同址充电站</dt><dd><button class="industry-row-action"
              type="button" :title="item.feature.properties.name" @click="selectFacility(item)">{{ item.feature.properties.name }} ›</button></dd></div>
            <div v-if="facility.feature.properties.servicePhone||facility.feature.properties.phone"><dt>服务电话</dt><dd :title="String(facility.feature.properties.servicePhone||facility.feature.properties.phone)">{{ facility.feature.properties.servicePhone||facility.feature.properties.phone }}</dd></div>
            <div v-for="field in profile" :key="field.label"><dt>{{ field.label }}</dt><dd :title="field.value">{{ field.value }}</dd></div>
            <div v-if="facility.feature.properties.commissionedOn"><dt>投运日期</dt><dd>{{ facility.feature.properties.commissionedOn }}</dd></div>
          </dl>
          <details v-if="facility.feature.properties.recordSource || facility.feature.properties.locationReview || facility.feature.properties.reviewNote" :key="facility.feature.id" class="svc-provider-evidence">
            <summary>位置与来源</summary>
            <dl class="industry-kv svc-provider-fields">
              <div v-if="facility.feature.properties.recordSource"><dt>填报来源</dt><dd>{{ facility.feature.properties.recordSource }}</dd></div>
              <div><dt>空间位置</dt><dd>{{ featureCenter(facility.feature) ? (facility.feature.properties.locationSource || '已定位') : (facility.feature.properties.locationReview?.chainLocation?.precision || '待定位') }}</dd></div>
              <div v-if="facility.feature.properties.locationReview"><dt>地图核对</dt><dd>{{ facility.feature.properties.locationReview.note }}</dd></div>
              <div v-if="facility.feature.properties.locationReview?.chainLocation"><dt>定位地址</dt><dd>{{ facility.feature.properties.locationReview.chainLocation.label }}</dd></div>
              <div v-if="facility.feature.properties.reviewNote"><dt>核对备注</dt><dd>{{ facility.feature.properties.reviewNote }}</dd></div>
            </dl>
          </details>
          <template v-if="tariffRows.length">
            <h3 class="service-section-title">分时电价（元/kWh）</h3>
            <table class="industry-table svc-tariff-table"><thead><tr><th>时段</th><th>电费</th><th>服务费</th><th>合计</th></tr></thead>
              <tbody><tr v-for="row in tariffPage.rows" :key="row.id"><td>{{ row.properties.name }} · {{ row.properties.band }}</td>
                <td>{{ tariffPrice(row.properties.energyPrice) }}</td><td>{{ tariffPrice(row.properties.serviceFee) }}</td><td>{{ tariffPrice(row.properties.totalPrice) }}</td></tr></tbody></table>
            <ServicePager v-if="tariffPage.pageCount>1" :pagination="tariffPage" label="电价时段分页" unit="段"/>
          </template>
        </template>
        <p v-else class="industry-card">当前范围暂无设施档案</p>
      </IndustryModule>
      <IndustryModule title="可服务场馆" fill>
        <p v-if="facility && featureCenter(facility.feature)" class="svc-tag">服务半径 {{ serviceDetailRadiusKm }} 公里</p>
        <table v-if="supportedVenues.length" class="industry-table svc-served-table">
          <thead><tr><th>场馆名称</th><th>距离</th><th>场地片数</th></tr></thead>
          <tbody><tr v-for="item in servedList.rows" :key="item.venue.id" :class="{selected:visibleVenueId===item.venue.id}"
            @pointerenter="markedVenueId=item.venue.id" @focusin="markedVenueId=item.venue.id">
            <td><div class="svc-name-cell"><OverviewPanelIcon name="venue"/><div><button type="button" class="industry-row-action" :title="item.venue.name" :aria-current="visibleVenueId===item.venue.id" @click="selectVenue(item.venue)">{{ item.venue.name }}</button><span v-if="item.bound" class="svc-tag">已登记服务</span></div></div></td>
            <td>{{ serviceDistance(item.meters) }}</td><td>{{ item.venue.totalCourts }} 片</td>
          </tr></tbody>
        </table>
        <p v-else-if="facility?.feature.properties.locationReview?.chainLocation && !featureCenter(facility.feature)" class="industry-card">经营场所待核实</p>
        <p v-else class="industry-card">{{ facility && !featureCenter(facility.feature) ? '设施待定位' : '服务半径内暂无场馆' }}</p>
        <NearbyFacilityList v-if="facility && featureCenter(facility.feature)" attractions-only :key="facility.feature.id" :places="nearbyFacilityRows" :center-id="facility.feature.id" :radius="serviceDetailRadiusKm" @select="selectFacility"/>
        <template v-if="servedList.total" #actions><ServicePager :pagination="servedList" label="可服务场馆分页" unit="处" /></template>
      </IndustryModule>
    </template>
  </IndustryRail>
  </template>
</template>

<style scoped>
.v14-services .svc-detail-close { flex:none; width:32px; min-width:32px; min-height:30px; padding:0; font-size:22px; line-height:24px; }
.service-line { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.service-line h3 { margin: 0; }
.venue-schedules > .industry-row-action { justify-self:start; width:fit-content; color:var(--v14-metric); background:var(--v14-tab); border:1px solid var(--v14-edge); padding:2px 8px; font:inherit; cursor:pointer; }
.venue-schedules summary { color:var(--v14-muted); cursor:pointer; }
.service-detail-tabs { display:grid; }
.venue-court-selector .service-line { margin-bottom: 6px; }
.venue-court-selector .service-line > span { color: var(--v14-muted); }
.service-court-tiles { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,5.5rem),1fr)); gap:4px; }
.v14-services .industry-rail .service-court-tile { display:flex; align-items:center; justify-content:center; gap:6px; min-width:0; padding:5px 7px; font-size:16px; line-height:1.25; white-space:nowrap; }
.service-court-tile[data-tone="green"] { border-color: var(--green); }
.service-court-tile[data-tone="amber"] { border-color: var(--gold); }
.v14-services .industry-rail .service-court-tile[aria-pressed="true"] { background: var(--v14-tab-active); color: #fff; }
.service-court-mark { width: 26px; height: 12px; border: 1px solid currentColor;
  background: linear-gradient(90deg,transparent 48%,currentColor 49% 51%,transparent 52%),
    linear-gradient(transparent 23%,currentColor 24% 26%,transparent 27% 73%,currentColor 74% 76%,transparent 77%); }
.service-table-scroll { max-width: 100%; overflow-x: auto; }
.service-table-scroll .service-heat { min-width: 380px; }
.service-heat :is(th,td) { padding-inline: 4px; }
.service-heat-legend { display: flex; align-items: center; gap: 8px; }
.service-heat-legend i { flex: 1; height: 12px; border-radius: 2px; background: linear-gradient(90deg,var(--v14-edge),var(--blue)); }
.service-gap { color: var(--red); }
</style>
