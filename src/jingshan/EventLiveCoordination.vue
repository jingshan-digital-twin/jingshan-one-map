<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { api, jsonRequest } from './api.ts'
import type { CityFeature, Dataset, DataDocument, MapCommand } from './types.ts'
import type { CimService } from './cim-types.ts'
import type { LiveEventMonitor, LiveMonitorPoint, LiveTrafficStatus } from './event-live-types.ts'
import { liveRoadStyles, loadVenueRoadMap, type VenueRoadMap } from './event-live-roads.ts'
import EventMapToolbar from './EventMapToolbar.vue'
import { nearbyEventVenue, useEventMapDisplay } from './map-layer-directory'
import EventMapLegend, { type EventLegendRow } from './EventMapLegend.vue'
import SceneAssistant from './SceneAssistant.vue'
import EventStatistic from './EventStatistic.vue'
import LiveMonitorPopup from './LiveMonitorPopup.vue'
import EventCompactPanels from './EventCompactPanels.vue'
import './event-live.css'

const CityMap = defineAsyncComponent(() => import('./CityMap.vue'))
const props = defineProps<{
  datasets: Dataset[]
  light: boolean
  imagery?: DataDocument['imagery']
  cimLayers: CimService[]
  version?: number
  initialId?: string
}>()
const dialog = ref<HTMLDialogElement>(),
  rightScroll = ref<HTMLElement>()
const events = ref<LiveEventMonitor[]>([]),
  selectedId = ref(''),
  pointId = ref<string | null>(null),
  incidentId = ref('')
const loading = ref(true),
  busy = ref(false),
  error = ref(''),
  message = ref('')
const leftOpen = defineModel<boolean>('leftOpen', { default: true })
const rightOpen = defineModel<boolean>('rightOpen', { default: true })
const compactPane = ref<'map'|'left'|'right'>('map')
watch(compactPane, pane => {
  if (pane === 'left') leftOpen.value = true
  if (pane === 'right') rightOpen.value = true
})
const pointList = ref(false),
  layer = ref('all'),
  trafficVisible = ref(true)
const command = ref<MapCommand | null>(null),
  incidentFilter = ref('all')
const modal = ref<'progress' | 'records' | 'consult' | 'notice' | null>(null),
  note = ref(''),
  modalError = ref('')
const openedRecord = shallowRef<{id:string;incidentId?:string;revision:number;publicationVersion?:number}>()
let serial = 0,
  loadSequence = 0,
  messageTimer: ReturnType<typeof setTimeout> | undefined
let refreshTimer: ReturnType<typeof setInterval> | undefined
const current = computed(() => events.value.find((e) => e.id === selectedId.value))
const hasMonitor = computed(() => !!current.value && !current.value.awaitingMonitor)
const roadEndpoint = import.meta.env.VITE_EVENT_LIVE_ROADS_URL?.trim()
const roadLayer = shallowRef<VenueRoadMap>()
const selectedRoad=ref('')
const surveyRoads=computed(()=>roadLayer.value?.surfaces??[])
const roadRefresh = ref(0), roadError = ref('')
const trafficCounts = computed(() => {
  const counts: Record<LiveTrafficStatus, number> = { smooth: 0, slow: 0, congested: 0, closed: 0 }
  for (const road of roadLayer.value?.roads ?? []) {
    const status = road.properties.trafficStatus as LiveTrafficStatus
    counts[status]++
  }
  return counts
})
watch([current, roadRefresh], async ([event], [previous], onCleanup) => {
  if (event?.id !== previous?.id) {roadLayer.value=undefined;selectedRoad.value=''}
  roadError.value = ''
  if (!event) return
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  try {
    const layer = await loadVenueRoadMap(event, roadEndpoint, controller.signal)
    if (controller.signal.aborted) return
    roadLayer.value = layer
    roadError.value=layer.warnings.join('、')
  } catch (cause) {
    if (controller.signal.aborted) return
    roadLayer.value = undefined
    roadError.value = cause instanceof Error ? cause.message : '读取道路服务失败'
  }
})
const currentPoint = computed(() => current.value?.points.find((p) => p.id === pointId.value))
const incident = computed(() => current.value?.incidents.find((i) => i.id === incidentId.value))
const pointIncident = computed(() => current.value?.incidents.find((i) => i.pointId === pointId.value))
const linkedPoints = computed(
  () => current.value?.points.filter((p) => incident.value?.resourceIds.includes(p.id)) ?? [],
)
const activeCount = computed(() => current.value?.incidents.filter((i) => i.status !== 'resolved').length ?? 0)
const closedCount = computed(() => current.value?.incidents.filter((i) => i.status === 'resolved').length ?? 0)
const listedIncidents = computed(
  () =>
    current.value?.incidents.filter(
      (i) =>
        incidentFilter.value === 'all' ||
        (incidentFilter.value === 'resolved' ? i.status === 'resolved' : i.status !== 'resolved'),
    ) ?? [],
)
const statusNames: Record<string, string> = {
  pending: '待派单',
  dispatched: '待签收',
  received: '已签收',
  onsite: '处置中',
  resolved: '已办结',
}
const kindNames: Record<string, string> = {
  venue: '赛事场馆',
  parking: '停车场',
  police: '交警岗',
  medical: '医疗点',
  camera: '视频监控',
  entrance: '观众入口',
  shuttle: '接驳点',
  supplies: '物资点',
}
const symbols: Record<string, string> = {
  venue: '馆',
  parking: 'P',
  police: '警',
  medical: '医',
  camera: '监',
  entrance: '入',
  shuttle: '车',
  supplies: '物',
}
const nextActions: Record<string, string> = {
  pending: 'dispatch',
  dispatched: 'receive',
  received: 'onsite',
  onsite: 'resolve',
}
const nextLabels: Record<string, string> = {
  dispatch: '一键派单',
  receive: '登记部门签收',
  onsite: '登记到场处置',
  resolve: '确认办结',
}
const nextAction = computed(() => nextActions[incident.value?.status ?? ''] ?? '')
const nextLabel = computed(() => incident.value ? nextLabels[nextAction.value] ?? '已办结' : '更新处置进度')
const workflowSteps = [
  { action: 'dispatch', label: '一键派单' },
  { action: 'receive', label: '部门签收' },
  { action: 'onsite', label: '到场处置' },
  { action: 'resolve', label: '确认办结' },
] as const
const incidentSteps = computed(() => {
  const item = incident.value
  if (!item) return []
  return workflowSteps.map(step => ({
    ...step,
    at: item.history.find(record => record.action === step.action)?.at,
    current: step.action === nextAction.value,
  }))
})
const severityNames: Record<string, string> = { high: '高', medium: '中', info: '提示' }
const latestNotice = computed(() => current.value?.publicNotices.at(-1))
const avgResponse = computed(() => {
  const values = (current.value?.incidents ?? []).flatMap((i) => {
    const sent = i.history.find((h) => h.action === 'dispatch'),
      received = i.history.find((h) => h.action === 'receive')
    const seconds = sent && received ? (Date.parse(received.at) - Date.parse(sent.at)) / 1000 : NaN
    return Number.isFinite(seconds) && seconds >= 0 ? [seconds] : []
  })
  if (!values.length) return '—'
  const seconds = Math.round(values.reduce((a, b) => a + b, 0) / values.length)
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`
})
const metrics = computed(() =>
  current.value
    ? [
        { icon: 'audience', label: '现场人数', value: current.value.metrics.onsite, unit: '人' },
        {
          icon: 'venue',
          label: '入场率',
          value: current.value.metrics.onsite !== null && current.value.metrics.capacity && current.value.metrics.capacity > 0
            ? Math.round(current.value.metrics.onsite / current.value.metrics.capacity * 100) : null,
          unit: '%',
        },
        { icon: 'traffic', label: '现场车辆', value: current.value.metrics.vehicles, unit: '辆' },
        { icon: 'lodging', label: '酒店入住', value: current.value.metrics.hotelRooms, unit: '间' },
        { icon: 'medical', label: '医疗保障点', value: current.value.metrics.medicalPoints, unit: '个' },
        { icon: 'security', label: '现场保障人员', value: current.value.metrics.staff, unit: '人' },
      ]
    : [],
)
const resources = computed(() =>
  [
    { kind: 'police', label: '交警岗', icon: 'security' },
    { kind: 'medical', label: '医疗保障', icon: 'medical' },
    { kind: 'shuttle', label: '接驳点', icon: 'traffic' },
    { kind: 'camera', label: '视频点位', icon: 'camera' },
  ].map((r) => ({ ...r, count: current.value?.points.filter((p) => p.kind === r.kind).length ?? 0 })),
)
const visiblePoints = computed(
  () =>
    current.value?.points.filter((p) => layer.value === 'all' || p.kind === layer.value || p.kind === 'venue') ?? [],
)
const pointKindColors:Record<string,string>={medical:'#54e2ac',venue:'#ffae00',police:'#90adff',parking:'#4db3ff'}
function pointColor(p: LiveMonitorPoint) {
  if (p.status === 'offline') return '#8da1b6'
  if (p.status === 'warning') return '#ffae00'
  return pointKindColors[p.kind]??'#6dd6ff'
}
const mapLegend=computed<EventLegendRow[]>(()=>{
  const points=current.value?.points??[]
  const kinds=new Set(points.map(p=>p.kind))
  const rows:EventLegendRow[]=Object.keys(kindNames).filter(kind=>kinds.has(kind as LiveMonitorPoint['kind'])).map(kind=>({
    id:kind,label:kindNames[kind],group:'点位',glyph:symbols[kind],color:pointKindColors[kind]??'#6dd6ff',active:layer.value===kind,
    select:()=>{if(layer.value===kind)layer.value='all';else filterPoints(kind)},
  }))
  if(points.some(p=>p.status==='warning'))rows.push({id:'warning',group:'状态',label:'预警点位',color:'#ffae00'})
  if(points.some(p=>p.status==='offline'))rows.push({id:'offline',group:'状态',label:'离线点位',color:'#8da1b6'})
  if(trafficVisible.value && surveyRoads.value.length)rows.push({id:'road-survey',label:'京山道路面',group:'路况',color:'#75adc7',shape:'area',value:surveyRoads.value.length+' 段'})
  if(trafficVisible.value)for(const state of Object.keys(liveRoadStyles) as LiveTrafficStatus[]){
    const count=trafficCounts.value[state]
    if(!count)continue
    const {label,color}=liveRoadStyles[state]
    rows.push({id:state,group:'路况',label,color,shape:state==='closed'?'stripe':'line',value:count+' 段'})
  }
  return rows
})
const features = computed<CityFeature[]>(() => [
  ...(trafficVisible.value ? surveyRoads.value.map(road=>({
    ...road,properties:{...road.properties,selected:road.id===selectedRoad.value,showLabel:true,labelMaxDistance:3600,limitLabelAtDistance:road.id!==selectedRoad.value},
  })) : []),
  ...(trafficVisible.value ? (roadLayer.value?.roads ?? []) : []),
  ...visiblePoints.value.map((p) => ({
    type: 'Feature' as const,
    id: p.id,
    geometry: { type: 'Point' as const, coordinates: p.position },
    properties: {
      name: p.name,
      region: '京山市',
      kind: 'event-live-point',
      mapRole: p.kind === 'venue' ? 'venue' : 'support',
      serviceGlyph: symbols[p.kind],
      serviceNeighborhood: true,
      selected: p.id === pointId.value || (!pointId.value && p.kind === 'venue'),
      color: pointColor(p),
      interactive: true,
    },
  })),
])
const administration = computed(() => props.datasets.find((d) => d.id === 'administration')?.features ?? [])
const fmt = (v: number | null) => v === null ? '待采集' : v.toLocaleString('zh-CN')
const time = (v?: string) =>
  v ? new Date(v).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }) : '—'
function notify(text: string) {
  message.value = text
  clearTimeout(messageTimer)
  messageTimer = setTimeout(() => (message.value = ''), 5000)
}
async function load(force = false) {
  const ticket = ++loadSequence
  loading.value = true
  error.value = ''
  try {
    const result = await api<{ events: LiveEventMonitor[] }>('/event-live')
    if (ticket !== loadSequence) return
    events.value = result.events
      .filter((e) => e.status === 'ongoing')
      .map(
        (e) =>
          events.value.find(
            (previous) =>
              !force && previous.id === e.id && previous.revision === e.revision &&
              previous.publicationVersion === e.publicationVersion && previous.snapshotAt === e.snapshotAt,
          ) ?? e,
      )
    if (!events.value.some((e) => e.id === selectedId.value)) selectedId.value = events.value[0]?.id ?? ''
    if (roadEndpoint) roadRefresh.value++
  } catch (e) {
    if (ticket === loadSequence) error.value = (e as Error).message
  } finally {
    if (ticket === loadSequence) loading.value = false
  }
}
const currentVenueFocus=computed(()=>current.value?.position ? {name:current.value.venueName,position:current.value.position} : undefined)
function overview() {
  if (!current.value) return
  if (!current.value.position) {
    command.value = {serial: ++serial, action:'home'}
    return
  }
  const {position}=current.value
  command.value = { serial: ++serial, action: 'focus', position, height: 2100, view: 'area', immediate: true,
    venueFocus:currentVenueFocus.value }
}
function locate(point?: LiveMonitorPoint) {
  if (!point) return
  const venueFocus=point.kind==='venue' ? {name:current.value?.venueName || point.name,position:point.position} : nearbyEventVenue(currentVenueFocus.value,point.position)
  command.value = { serial: ++serial, action: 'focus', position: point.position, height: 1400, view: 'area', immediate: true, venueFocus }
}
function showOnMap(point?: LiveMonitorPoint) {
  if (!point) return
  compactPane.value = 'map'
  locate(point)
}
function selectPoint(id: string, focus = false) {
  if(surveyRoads.value.some(road=>road.id===id)){selectedRoad.value=id;pointId.value=null;return}
  const point = current.value?.points.find((p) => p.id === id)
  if (!point) return
  selectedRoad.value=''
  const openingRail = !rightOpen.value
  if (layer.value !== 'all' && layer.value !== point.kind) layer.value = 'all'
  pointId.value = id
  pointList.value = false
  rightOpen.value = true
  if (window.matchMedia('(max-width:1000px)').matches) compactPane.value='right'
  void nextTick(() => {
    if (pointId.value !== id) return
    if (rightScroll.value) rightScroll.value.scrollTop = 0
    if (focus || openingRail || point.kind==='venue') locate(point)
  })
}
function openLinkedPoint(point: LiveMonitorPoint) {
  selectPoint(point.id, true)
}
function locateResource(feature: CityFeature) {
  if (feature.properties.kind === 'event-live-road' || feature.properties.kind === 'event-live-road-surface') {
    selectedRoad.value=feature.id
    compactPane.value = 'map'
    pointId.value = null
    command.value = { action: 'fit-features', features: [feature], venueFocus:currentVenueFocus.value, serial: ++serial }
    return
  }
  selectPoint(feature.id, true)
}
function chooseIncident(id: string, focus = true) {
  incidentId.value = id
  if (focus) pointId.value = null
  if (!listedIncidents.value.some(i => i.id === id)) incidentFilter.value = 'all'
  const item = current.value?.incidents.find((i) => i.id === id)
  if (focus && item?.pointId) {
    const p = current.value?.points.find((p) => p.id === item.pointId)
    locate(p)
  }
}
function startPlan() {
  if (!incident.value) return
  if (incident.value.status !== 'pending') { void openModal('records'); return }
  void openModal('progress')
  note.value = `启动「${incident.value.title}」预案，交由${incident.value.department}牵头执行。`
}
function selectAlert(id: string) {
  const alert = current.value?.alerts.find((a) => a.id === id)
  const point = current.value?.points.find((p) => p.id === alert?.pointId)
  if (alert?.incidentId) chooseIncident(alert.incidentId, !point)
  if (point) openLinkedPoint(point)
  else pointId.value = null
}
function showPointIncident() {
  if (pointIncident.value) {
    chooseIncident(pointIncident.value.id, false)
    rightOpen.value = true
    pointId.value = null
    void nextTick(() => rightScroll.value?.querySelector('.el-incident-detail')?.scrollIntoView({ block: 'nearest' }))
  }
}
async function openModal(mode: NonNullable<typeof modal.value>) {
  const event=current.value
  if (!event || (mode !== 'records' && event.awaitingMonitor)) return
  openedRecord.value={id:event.id,incidentId:incident.value?.id,revision:event.revision,publicationVersion:event.publicationVersion}
  modal.value = mode
  note.value = ''
  modalError.value = ''
  if (mode === 'notice' && current.value?.demo) note.value = '赛事周边停车位紧张，请按现场指引前往临时停车区，并优先选择接驳出行。'
  await nextTick()
  dialog.value?.showModal()
}
function closeModal() {
  if (busy.value) return
  dialog.value?.close()
  modal.value = null
}
async function submit() {
  if (!current.value || busy.value) return
  const event = current.value,
    item = incident.value,
    mode = modal.value
  const opened=openedRecord.value
  if (!opened || opened.id!==event.id || opened.revision!==event.revision || opened.publicationVersion!==event.publicationVersion ||
      (mode!=='notice' && opened.incidentId!==item?.id)) {
    modalError.value='赛事监测记录已更新，请重新读取并核对。'
    return
  }
  if (mode !== 'notice' && !item) return
  if (
    (mode === 'consult' || mode === 'notice' || ['onsite', 'resolve'].includes(nextAction.value)) &&
    !note.value.trim()
  ) {
    modalError.value = '请填写本次处置内容。'
    return
  }
  busy.value = true
  modalError.value = ''
  loadSequence++
  loading.value = false
  try {
    const path =
      mode === 'notice' ? `/event-live/${encodeURIComponent(event.id)}/notices` : `/event-live/${encodeURIComponent(event.id)}/incidents/${encodeURIComponent(item!.id)}/transition`
    const body =
      mode === 'notice'
        ? { revision: event.revision, publicationVersion:event.publicationVersion, text: note.value }
        : { revision: event.revision, publicationVersion:event.publicationVersion, action: mode === 'consult' ? 'consult' : nextAction.value, note: note.value }
    const updated = await api<LiveEventMonitor>(path, jsonRequest('POST', body))
    events.value = events.value.map((e) => (e.id === updated.id ? updated : e))
    dialog.value?.close()
    modal.value = null
    notify(mode === 'notice' ? '公众提示已发布到本平台' : mode === 'consult' ? '部门会商记录已保存' : '处置进度已更新')
  } catch (e) {
    modalError.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
function filterPoints(kind: string) {
  layer.value = kind
  pointList.value = true
  pointId.value = null
  compactPane.value = 'map'
}
watch(rightOpen, (open) => {
  if (!open) pointId.value = null
})
watch(() => props.version, () => { void load(true) })
watch([()=>props.initialId,()=>events.value.find(e=>e.id===props.initialId || (props.initialId && e.planId===props.initialId))?.id],([requested,id])=>{
  if(requested && id) { selectedId.value=id; void nextTick(overview) }
},{immediate:true})
watch(selectedId, () => {
  incidentId.value = ''
  pointId.value = null
  pointList.value = false
  incidentFilter.value = 'all'
  layer.value = 'all'
  if (rightScroll.value) rightScroll.value.scrollTop = 0
})
watch(listedIncidents, visible => {
  if (incidentId.value && !visible.some(item => item.id === incidentId.value)) {
    pointId.value = null
    incidentId.value = ''
  }
})
onMounted(() => {
  void load()
  refreshTimer = setInterval(() => {
    if (!document.hidden && !busy.value && !loading.value && !modal.value) void load()
  }, 30000)
})
onUnmounted(() => {
  clearTimeout(messageTimer)
  clearInterval(refreshTimer)
  loadSequence++
})
const {catalog:mapCatalog,displayFeatures,displayCommand}=useEventMapDisplay(()=>features.value,command,()=>++serial)
</script>

<template>
  <section class="event-live" aria-label="赛中协同监测预警" :data-pane="compactPane">
    <EventCompactPanels v-model="compactPane" left-label="运行态势" right-label="协同处置"/>
    <CityMap
      class="el-map"
      :event-scene="true" :service-labels-light="light"
      :features="displayFeatures"
      region="京山市"
      :selected-id="pointId"
      :command="displayCommand"
      :imagery="mapCatalog.imagery"
      :imagery-config="imagery"
      light-theme
      county-relief :show-town-boundaries="mapCatalog.towns"
      :business-scene="true"
      :administration="administration"
      :road-network="[]"
      :attribute-service-id="mapCatalog.attributeServiceId" :cim-layers="cimLayers" @cim-status="mapCatalog.status" @cim-pick="mapCatalog.pickService"
      :cim-catalog-ready="true"
      :show-scale="false"
      @select="id=>mapCatalog.table?mapCatalog.pickRow(id):selectPoint(id)"
    />
    <div class="el-ui">
      <div class="el-layout" :class="{ 'el-left-closed': !leftOpen, 'el-right-closed': !rightOpen }">
        <aside v-show="leftOpen" class="v14-overview-rail-shell el-rail el-left" aria-label="赛事运行态势">
          <div class="event-rail-module v14-overview-module">
          <header class="v14-overview-heading el-heading">
            <h2>赛事运行态势</h2>
            <button class="el-fold" aria-label="收起运行态势" @click="leftOpen = false">‹ 收起</button>
          </header>
          <div class="el-left-scroll">
            <div class="el-event-selector">
              <label for="el-event">进行中赛事</label
              ><select id="el-event" v-model="selectedId" :disabled="busy || loading" @change="overview">
                <option v-for="e in events" :key="e.id" :value="e.id">{{ e.name }}</option>
              </select>
            </div>
            <template v-if="current">
              <section class="el-event-card">
                <div>
                  <h3>{{ current.name }}</h3>
                  <span v-if="current.day" class="el-day">比赛第 {{ current.day }} 日</span>
                </div>
                <p class="el-running"><span class="el-running-state">进行中</span><em v-if="current.demo">模拟监测</em></p>
                <p v-if="current.awaitingMonitor" class="el-empty">尚未填报赛中监测。可在后台的赛中监测总表关联本场赛事并发布。</p>
                <p class="el-times">
                  <span
                    >开赛时间 <b>{{ current.startTime || '待登记' }}</b></span
                  ><span
                    >下一高峰 <b>{{ current.nextPeak || '待研判' }}</b></span
                  >
                </p>
              </section>
              <p v-if="latestNotice" class="el-public-notice"><span>公众提示</span>{{ latestNotice.text }}</p>
              <div class="el-metric-grid">
                <EventStatistic v-for="m in metrics" :key="m.label" :label="m.label" :icon="m.icon"
                  :value="fmt(m.value)" :unit="m.unit" :missing="m.value===null" />
              </div>
              <details class="el-section el-venue-roads" open>
                <summary>场馆周边道路 <small v-if="roadLayer">{{ surveyRoads.length }} 个图斑</small></summary>
                <p v-if="roadError" role="alert">{{ roadError }} <button @click="roadRefresh++">重试</button></p>
                <p v-else-if="!roadLayer">正在读取道路面…</p>
                <p v-else-if="!current.position">场馆坐标待登记。</p>
                <p v-else-if="!surveyRoads.length">场馆 1 公里内暂无已登记道路面。</p>
                <p v-else>{{ surveyRoads[0].properties.source }} · 场馆周边 1 公里</p>
                <p v-if="roadLayer && !roadLayer.roads.length && !roadError">暂无已发布的通行实况。</p>
                <ul v-if="roadLayer?.roads.length" aria-label="已报路况">
                  <li v-for="road in roadLayer.roads" :key="road.id"><button type="button" @click="trafficVisible=true;locateResource(road)">
                    <strong>{{road.properties.name}}</strong><span>{{ liveRoadStyles[road.properties.trafficStatus as LiveTrafficStatus].label }}</span>
                  </button></li>
                </ul>
                <ul aria-label="京山道路面"><li v-for="road in surveyRoads" :key="road.id"><button type="button" :aria-pressed="selectedRoad===road.id" @click="trafficVisible=true;locateResource(road)">
                  <strong>{{ road.properties.name }}</strong><small>{{ road.properties.sectionName || road.properties.roadClass }}</small>
                </button></li></ul>
              </details>
              <section class="el-section el-alerts">
                <h3>
                  实时预警 <small>{{ current.alerts.length }} 条</small>
                </h3>
                <button
                  v-for="a in current.alerts"
                  :key="a.id"
                  class="el-alert"
                  :class="a.level"
                  @click="selectAlert(a.id)"
                >
                  <span class="el-alert-mark">!</span
                  ><span
                    ><strong>{{ a.title }}</strong
                    ><small>{{ a.detail }}</small></span
                  ><span class="el-chevron">›</span>
                </button>
              </section>
            </template>
            <p v-if="loading && !current" class="el-empty">正在加载赛事监测数据…</p>
            <p v-if="!loading && !current && !error" class="el-empty">暂无进行中的赛事</p>
            <div v-if="error" class="el-error" role="alert">
              {{ error }} <button :disabled="loading" @click="load(true)">重新加载</button>
            </div>
          </div>
          <section class="el-section el-quick">
            <h3>快捷调度</h3>
            <div>
              <button :disabled="!incident || current?.awaitingMonitor" @click="startPlan">
                {{ !incident || incident.status === 'pending' ? '启动应急预案' : '查看调度记录' }}</button
              ><button :disabled="!incident || incident.status === 'resolved' || current?.awaitingMonitor" @click="openModal('consult')">
                发起部门会商</button
              ><button :disabled="!current || current.awaitingMonitor" @click="openModal('notice')">发布公众提示</button>
            </div>
          </section>
          </div>
        </aside>

        <div id="cockpit-map-column" class="el-center map-scene">
          <div class="event-map-frame" aria-hidden="true"></div>
          <SceneAssistant page="liveEvent" area="京山市" :context-id="selectedId" :loading="loading && !current"
            :ledger-layers="[{id:'event-monitor',name:current?.demo?'演练监测点位':'赛事监测点位',features:features.filter(f=>f.properties.kind==='event-live-point')}]"
            @locate="(_,f)=>{selectPoint(f.id,true); compactPane='map'}" />
          <button v-if="!leftOpen" class="el-reopen el-reopen-left" @click="leftOpen = true">运行态势 ›</button>
          <button v-if="!rightOpen" class="el-reopen el-reopen-right" @click="rightOpen = true">‹ 协同处置</button>
          <EventMapToolbar :datasets="datasets" :features="features" :administration="administration" :scope="selectedId" dispatch-label="互动调度 · 处置记录"
            :dispatch-disabled="!incident" @dispatch="openModal('records')" @opening="pointList=false"
            @action="action=>command={action,serial:++serial}" @area="town=>command={action:'fit-features',features:[town],view:'context',serial:++serial}"
            @place="p=>command={action:'focus',position:p.position,locationName:p.name,venueFocus:{name:p.name,position:p.position},height:1800,serial:++serial}"
            @resource="locateResource" @reset="pointList=false;pointId=null;layer='all';command={action:'home',serial:++serial}">
            <template #layers>
              <label class="catalog-row"><input v-model="trafficVisible" type="checkbox"/>场馆周边道路与实况</label>
              <template v-if="trafficVisible">
                <p v-if="roadError" role="alert">{{ roadError }}</p>
                <button v-if="roadError" type="button" @click="roadRefresh++">重试路况服务</button>
                <p v-else-if="!roadLayer" role="status">正在读取场馆路况…</p>
                <p v-else>{{surveyRoads.length}} 个道路图斑 · {{roadLayer.roads.length ? roadLayer.roads.length+' 段已报路况' : '暂无已发布实况'}}</p>
              </template>
              <label v-for="kind in ['all',...Object.keys(kindNames)]" :key="kind" class="catalog-row"><input type="radio" name="event-monitor-layer" :checked="layer===kind" @change="layer=kind"/>{{kind==='all'?'全部点位':kindNames[kind]}}</label>
            </template>
            <template #location="{close}"><button type="button" :disabled="!current?.position" @click="close();overview()">当前赛事场馆</button></template>
            <template #tools><button type="button" :disabled="loading || busy" @click="load(true)">刷新监测数据</button></template>
          </EventMapToolbar>
          <section v-if="pointList && current" class="el-point-list" aria-label="监测点位列表">
            <header>
              <h3>监测点位</h3>
              <button aria-label="关闭点位列表" @click="pointList = false">×</button>
            </header>
            <div class="el-layer-options">
              <button
                v-for="kind in ['all', 'camera', 'parking', 'police', 'medical', 'entrance', 'shuttle', 'supplies']"
                :key="kind"
                :aria-pressed="layer === kind"
                @click="layer = kind"
              >
                {{ kind === 'all' ? '全部' : kindNames[kind] }}
              </button>
            </div>
            <div class="el-point-list-scroll">
              <button
                v-for="p in visiblePoints"
                :key="p.id"
                @click="openLinkedPoint(p)"
              >
                <span class="el-point-symbol" :style="{ color: pointColor(p) }">{{ symbols[p.kind] }}</span
                ><span>{{ p.name }}</span
                ><small>{{
                  p.status === 'offline'
                    ? '离线'
                    : p.status === 'warning'
                      ? '预警'
                      : p.status === 'standby'
                        ? '待启用'
                        : '在线'
                }}</small>
              </button>
            </div>
          </section>
          <EventMapLegend v-show="!pointList" :rows="mapLegend"/>
        </div>

        <aside v-show="rightOpen" class="v14-overview-rail-shell el-rail el-right" aria-label="协同处置">
          <div class="event-rail-module v14-overview-module">
          <header class="v14-overview-heading el-heading">
            <h2>协同处置</h2>
            <button class="el-fold" aria-label="收起协同处置" @click="rightOpen = false">› 收起</button>
          </header>
          <div ref="rightScroll" class="el-right-scroll">
            <LiveMonitorPopup
              v-if="currentPoint"
              :point="currentPoint"
              :light="light"
              :has-incident="Boolean(pointIncident)"
              @close="pointId = null"
              @locate="showOnMap(currentPoint)"
              @incident="showPointIncident"
            />
            <section class="el-section el-resources">
              <h3>赛事保障资源</h3>
              <div>
                <EventStatistic v-for="r in resources" :key="r.kind" interactive :label="r.label" :icon="r.icon"
                  :value="hasMonitor ? r.count : '—'" :missing="!hasMonitor" :disabled="!hasMonitor"
                  :unit="r.kind==='camera' ? '路' : '处'" @click="filterPoints(r.kind)" />
              </div>
            </section>
            <section class="el-section" aria-labelledby="el-incident-heading">
              <h3 id="el-incident-heading">赛事处置事件</h3>
              <div class="el-summary">
                <div>
                  <span>当前事件</span>
                  <p><b>{{ hasMonitor ? activeCount : '—' }}</b><template v-if="hasMonitor"> 起</template></p>
                </div>
                <div>
                  <span>已办结</span>
                  <p><b>{{ hasMonitor ? closedCount : '—' }}</b><template v-if="hasMonitor"> 起</template></p>
                </div>
                <div>
                  <span>平均响应</span>
                  <p><b>{{ avgResponse }}</b></p>
                </div>
              </div>
              <div class="el-incident-tabs">
                <button
                  v-for="f in [
                    { id: 'all', label: '全部事件' },
                    { id: 'active', label: '未办结' },
                    { id: 'resolved', label: '已办结' },
                  ]"
                  :key="f.id"
                  :aria-pressed="incidentFilter === f.id"
                  @click="incidentFilter = f.id"
                >
                  {{ f.label }}
                </button>
              </div>
              <div class="el-incident-list">
                <button
                  v-for="i in listedIncidents"
                  :key="i.id"
                  :aria-pressed="i.id === incidentId"
                  @click="chooseIncident(i.id)"
                >
                  <span><strong>{{ i.title }}</strong><small>{{ i.department }}</small></span>
                  <em :class="i.status">{{ statusNames[i.status] }}</em>
                </button>
                <p v-if="!listedIncidents.length" class="el-empty">暂无此类事件</p>
              </div>
            </section>
            <section v-if="incident" class="el-incident-detail el-section">
              <h3>事件详情</h3>
              <header class="el-incident-title">
                <h4>{{ incident.title }}</h4>
                <em :class="incident.status">{{ statusNames[incident.status] }}</em>
              </header>
              <section class="el-timeline" aria-label="事件处置流程">
                <h5>处置流程</h5>
                <ol class="el-steps">
                  <li v-for="(step, index) in incidentSteps" :key="step.action"
                    :class="{ done: step.at }" :aria-current="step.current ? 'step' : undefined">
                    <span aria-hidden="true">{{ step.at ? '✓' : index + 1 }}</span>
                    <strong>{{ step.label }}</strong>
                    <time v-if="step.at" :datetime="step.at" :title="step.at">{{ time(step.at) }}</time>
                    <small v-else>{{ step.current ? '待办理' : '未开始' }}</small>
                  </li>
                </ol>
              </section>
              <dl>
                <div>
                  <dt>事件类型</dt>
                  <dd>{{ incident.type }}</dd>
                </div>
                <div>
                  <dt>事件等级</dt>
                  <dd>{{ severityNames[incident.level] }}</dd>
                </div>
                <div>
                  <dt>发生位置</dt>
                  <dd>
                    <button class="el-link" @click="incident.pointId && selectPoint(incident.pointId, true)">
                      {{ current?.points.find((p) => p.id === incident?.pointId)?.name ?? current?.venueName }}
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>牵头部门</dt>
                  <dd>{{ incident.department }}</dd>
                </div>
                <div>
                  <dt>协同部门</dt>
                  <dd>{{ incident.collaborators.join('、') || '无' }}</dd>
                </div>
                <div>
                  <dt>处置时限</dt>
                  <dd>{{ incident.deadline }}</dd>
                </div>
              </dl>
              <p class="el-latest-action">{{ incident.history.at(-1)?.note || incident.history.at(-1)?.label }}</p>
            </section>
            <section v-if="linkedPoints.length" class="el-linked">
              <h3>本事件关联点位</h3>
              <button v-for="p in linkedPoints" :key="p.id" @click="openLinkedPoint(p)">{{ p.name }}</button>
            </section>
          </div>
          <div class="el-actions">
            <button :disabled="!incident" @click="openModal('records')">查看处置记录</button
            ><button
              class="el-primary"
              :disabled="!incident || incident.status === 'resolved' || busy"
              @click="openModal('progress')"
            >
              {{ nextLabel }}
            </button>
          </div>
          </div>
        </aside>
      </div>
      <p v-if="message" class="el-toast" role="status">{{ message }}</p>
      <dialog
        ref="dialog"
        class="el-dialog"
        @cancel.prevent="closeModal"
        @click="$event.target === dialog && closeModal()"
      >
        <template v-if="modal"
          ><header>
            <div>
              <small>赛中协同<template v-if="current?.demo"> · 模拟演练</template></small>
              <h2>
                {{
                  modal === 'records'
                    ? '事件处置记录'
                    : modal === 'consult'
                      ? '部门会商'
                      : modal === 'notice'
                        ? '发布公众提示'
                        : nextLabel
                }}
              </h2>
            </div>
            <button :disabled="busy" aria-label="关闭处置窗口" @click="closeModal">×</button>
          </header>
          <template v-if="modal === 'records'"
            ><h3>{{ incident?.title }}</h3>
            <ol class="el-records">
              <li v-for="h in incident?.history" :key="h.id">
                <b>{{ h.label }}</b
                ><time>{{ new Date(h.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }}</time>
                <p>{{ h.note }}</p>
              </li>
            </ol></template
          >
          <form v-else @submit.prevent="submit">
            <p class="el-dialog-context">{{ current?.name }}</p>
            <template v-if="modal !== 'notice'"
              ><h3>{{ incident?.title }}</h3>
              <p>牵头：{{ incident?.department }}　协同：{{ incident?.collaborators.join('、') || '无' }}</p></template
            >
            <p v-else class="el-dialog-context">提示将在本平台赛事地图中展示。</p>
            <label for="el-note">{{
              modal === 'notice' ? '公众提示内容' : modal === 'consult' ? '会商议题与意见' : '处置说明'
            }}</label
            ><textarea
              id="el-note"
              v-model="note"
              rows="4"
              maxlength="1000"
              :placeholder="modal === 'consult' ? '填写会商议题、参与部门和协调意见' : '填写本次措施与处理结果'"
              :disabled="busy"
            />
            <p v-if="modalError" class="el-error" role="alert">{{ modalError }}
              <button type="button" :disabled="busy" @click="closeModal();load(true)">重新读取监测数据</button>
            </p>
            <footer>
              <button type="button" :disabled="busy" @click="closeModal">取消</button
              ><button class="el-primary" :disabled="busy" type="submit">
                {{
                  busy
                    ? '正在保存…'
                    : modal === 'notice'
                      ? '发布到本平台'
                      : modal === 'consult'
                        ? '保存会商记录'
                        : nextLabel
                }}
              </button>
            </footer>
          </form>
        </template>
      </dialog>
    </div>
  </section>
</template>
