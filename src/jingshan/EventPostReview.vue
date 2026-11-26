<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { api, downloadFile, jsonRequest } from './api.ts'
import { eventReviewDocument } from './event-platform-data.ts'
import type { DataDocument, MapCommand } from './types.ts'
import type { CimService } from './cim-types.ts'
import { buildEventReview, defaultReviewId, directionStats, flowGroups, metricText, resolveReviewMapVenue, reviewFormatVersion, reviewMapFeatures, reviewNumber, reviewReportHtml, reviewReportSections, reviewSupportSites, reviewTime,
  type ArchivedReview, type ReviewCatalog, type ReviewState, type ReviewSupportSite } from './event-post-review.ts'
import EventMapToolbar from './EventMapToolbar.vue'
import { useEventMapDisplay } from './map-layer-directory'
import EventMapLegend, { type EventLegendRow } from './EventMapLegend.vue'
import SceneAssistant from './SceneAssistant.vue'
import EventStatistic from './EventStatistic.vue'
import EventReviewTrend from './EventReviewTrend.vue'
import EventCompactPanels from './EventCompactPanels.vue'
import PortalIcon from './PortalIcon.vue'
import './event-post-review.css'

const CityMap = defineAsyncComponent(() => import('./CityMap.vue'))
const props = defineProps<{ document?: DataDocument; version?: number; region: string; light: boolean; cimLayers: CimService[] }>()
const chosen = defineModel<string>('selectedId', { default: '' })
const leftOpen = defineModel<boolean>('leftOpen', { default: true })
const rightOpen = defineModel<boolean>('rightOpen', { default: true })
const compactPane=ref<'map'|'left'|'right'>('map')
watch(compactPane,pane=>{
  if(pane==='left')leftOpen.value=true
  if(pane==='right')rightOpen.value=true
})
const catalog = shallowRef<ReviewCatalog>({ targets: [], archives: [] })
const saved = shallowRef<ReviewState>({ report: null, reused: [] })
const reviewDocument = computed(() => props.document && eventReviewDocument(props.document))
const completedEvents = computed(() => reviewDocument.value?.datasets.find(d => d.id === 'events')?.features.filter(e => e.properties.status === '已办结') ?? [])
const options = computed(() => {
  const archived = new Map(catalog.value.archives.map(e => [e.id,e]))
  const current = completedEvents.value.filter(e => props.region === '京山市' || e.properties.region === props.region)
    .map(e => archived.get(e.id) ?? { id: e.id, name: e.properties.name, start: String(e.properties.date ?? '') })
  const published = new Set(completedEvents.value.map(e => e.id))
  const archives = catalog.value.archives.filter(e => !published.has(e.id) && (props.region === '京山市' || e.region === props.region))
  return [...current, ...archives].sort((a,b) => b.start.localeCompare(a.start))
})
const eventId = computed(() => options.value.find(e => chosen.value === e.id)?.id ||
  (reviewDocument.value && defaultReviewId(reviewDocument.value, options.value.map(e => e.id))) || options.value[0]?.id || '')
const current = computed(() => reviewDocument.value ? buildEventReview(reviewDocument.value, eventId.value) : null)
const report = computed(() => saved.value.report?.review.id === eventId.value ? saved.value.report : null)
const archived = computed(() => !!report.value?.archivedAt)
const review = computed(() => archived.value ? report.value!.review : current.value ?? report.value?.review)
const pending = ref(false), busy = ref(false), error = ref(''), catalogError = ref(''), message = ref('')
const selectedIssues = ref<string[]>([]), target = ref(''), group = ref<typeof flowGroups[number]['id'] | ''>(''), pointId = ref('')
const dialog = ref<HTMLDialogElement>(), modal = ref<'report'|'archive'|'trend'|'asset'|null>(null), assetIndex = ref(0)
const assets = ['results', 'folder', 'accounts', 'activity']
const icons = ['court', 'audience', 'travel', 'lodging', 'industry', 'trophy']
const funnelIcons = ['eye', 'pin', 'services', 'opening', 'accounts']
const flows = computed(() => directionStats(review.value?.points ?? []))
const selectedPoint = computed(() => review.value?.points.find(p => p.id === pointId.value))
const groupPoints = computed(() => review.value?.points.filter(p => p.group === group.value) ?? [])
const showSupport = ref(true)
const supportKind = ref<ReviewSupportSite['kind'] | ''>('')
const spatial = computed(() => reviewDocument.value?.datasets ?? [])
const mapReview = computed(() => {
  const record = review.value
  if (!record || record.supportSites !== undefined) return record
  return resolveReviewMapVenue(record, spatial.value)
})
const supportSites = computed(() => review.value?.supportSites ??
  (mapReview.value ? reviewSupportSites(spatial.value, mapReview.value) : []))
const selectedSite = computed(() => showSupport.value ? supportSites.value.find(s => s.id === pointId.value || s.observedPointId === pointId.value) : undefined)
const nearestByKind = computed(() => {
  const nearest = new Map<ReviewSupportSite['kind'], ReviewSupportSite>()
  for (const site of supportSites.value) if (!nearest.has(site.kind)) nearest.set(site.kind, site)
  return [...nearest.values()]
})
const features = computed(() => {
  if (!mapReview.value) return []
  const sites = showSupport.value ? supportSites.value.filter(s => !supportKind.value || s.kind === supportKind.value) : []
  const drawn = reviewMapFeatures(mapReview.value, group.value, sites)
  if (!supportKind.value) return drawn
  const ids = new Set(sites.flatMap(s => s.observedPointId ? [s.id, s.observedPointId] : [s.id]))
  return drawn.filter(f => f.id === 'review-venue' || ids.has(f.id) || ids.has(f.id.replace(/-flow$/, '')))
})
const mapLegend = computed<EventLegendRow[]>(() => {
  if (!mapReview.value?.position) return []
  return [
    {id:'review-venue',label:'赛事场馆',color:'#63edff',select:()=>pick('review-venue')},
    ...flows.value.filter(g=>mapReview.value?.points.some(p=>p.group===g.id && p.visits>0 && p.position)).map(g=>({
      id:g.id,group:'客流去向',label:g.label,color:g.color,shape:'line' as const,active:group.value===g.id,select:()=>selectGroup(g.id),
    })),
    ...(showSupport.value ? nearestByKind.value.map(s=>({
      id:s.kind,group:'场馆配套',label:s.label,color:s.color,pinKind:s.kind,active:supportKind.value===s.kind,select:()=>selectSupport(s.kind),
    })) : []),
  ]
})
const admin = computed(() => props.document?.datasets.find(d => d.id === 'administration')?.features)
const canReuse = computed(() => Boolean(selectedIssues.value.length || review.value?.assets[0]?.rows.length))
const candidates = computed(() => canReuse.value ? catalog.value.targets.filter(e => e.start > (review.value?.end ?? '') &&
  e.id !== eventId.value && !saved.value.reused.some(used => used.id === e.id)) : [])
const command = shallowRef<MapCommand | null>(null)
let serial = 0
const venueFocus=computed(()=>mapReview.value?.position ? {name:mapReview.value.venue,position:mapReview.value.position} : undefined)
function fit() {
  const display = features.value
  command.value = display.length > 1 ? { action: 'fit-features', features: display, venueFocus:venueFocus.value, serial: ++serial }
    : venueFocus.value ? { action: 'focus', position: venueFocus.value.position, venueFocus:venueFocus.value, height: 3200, serial: ++serial } : { action: 'home', serial: ++serial }
}
const requestedFocus = ref<string | null>('')
const extentKey = computed(() => [mapReview.value?.id, venueFocus.value?.name, venueFocus.value?.position.join(','),
  ...supportSites.value.map(s => s.id+':'+s.position.join(',')), ...(mapReview.value?.points ?? []).map(p=>p.position?.join(','))].join('|'))
let fittedExtent = ''
function selectReview(id: string) {
  chosen.value = id
  requestedFocus.value = id
}
watch(eventId, id => { requestedFocus.value = id; fittedExtent = '' })
watch([requestedFocus, () => mapReview.value?.id, pending, extentKey], ([requested, loaded, waiting, extent]) => {
  if (requested === null || !loaded || (requested && requested !== loaded) || waiting || extent === fittedExtent) return
  fittedExtent = extent
  fit()
}, { immediate: true, flush: 'post' })
function selectGroup(next: typeof group.value) {
  requestedFocus.value = null
  group.value = group.value === next ? '' : next
  supportKind.value = ''
  pointId.value = ''
  fit()
}
function selectSupport(kind: ReviewSupportSite['kind'], toggle = true) {
  requestedFocus.value = null
  showSupport.value = true
  group.value = ''
  pointId.value = ''
  supportKind.value = toggle && supportKind.value === kind ? '' : kind
  compactPane.value = 'map'
  const first = supportKind.value && nearestByKind.value.find(site => site.kind === supportKind.value)
  if (first) pointId.value = displayedSiteId(first)
  fit()
}
function resetMapSelection() {
  pointId.value = ''
  group.value = ''
  supportKind.value = ''
}
function issueKind(id: string) {
  const kind = id === 'parkingGap' ? 'parking' : id === 'bedGap' ? 'hotels' : undefined
  return nearestByKind.value.find(s => s.kind === kind)
}
function pick(id: string) {
  if (!features.value.some(f=>f.id === id)) return
  requestedFocus.value = null
  pointId.value=id.replace(/-flow$/,'')
  if(id==='review-venue' && venueFocus.value)command.value={action:'focus',position:venueFocus.value.position,
    venueFocus:venueFocus.value,height:1550,view:'area',serial:++serial}
  compactPane.value='map'
}
function locateDestination(id:string) {
  requestedFocus.value = null
  const feature=features.value.find(f=>f.id===id)
  if(!feature)return
  pointId.value=id
  compactPane.value='map'
  command.value={action:'fit-features',features:[feature],venueFocus:id==='review-venue'?venueFocus.value:undefined,serial:++serial}
}
function displayedSiteId(site: ReviewSupportSite) {
  const observed = site.observedPointId
  return observed && features.value.some(f=>f.id === observed) ? observed : site.id
}
const ready = computed(() => !!review.value && !busy.value && !pending.value && !error.value)
const draftChanged = computed(() => !report.value || report.value.version !== props.version || report.value.review.formatVersion !== reviewFormatVersion ||
  JSON.stringify(report.value.selectedIssues) !== JSON.stringify(selectedIssues.value))
const status = computed(() => pending.value ? '读取中' : error.value && !report.value ? '待核对' : archived.value ? '已归档' : report.value ? '已生成' : '待复盘')
const reportSections = computed(() => report.value ? reviewReportSections(report.value,saved.value.reused) : [])
async function loadCatalog() {
  try { catalog.value = await api<ReviewCatalog>('/event-reviews'); catalogError.value = '' }
  catch (e) { catalogError.value = (e as Error).message }
}
const retry = ref(0)
watch([eventId, retry, () => props.version], async ([id],_old,onCleanup) => {
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  saved.value = { report: null, reused: [] }; selectedIssues.value = []
  resetMapSelection(); showSupport.value = true; message.value = ''; error.value = ''; dialog.value?.close()
  pending.value = !!id
  if (!id) return
  try {
    const state = await api<ReviewState>('/event-reviews/' + encodeURIComponent(id), {signal: controller.signal})
    if (!controller.signal.aborted) {
      saved.value = state
      selectedIssues.value = state.report?.selectedIssues ?? current.value?.issues.map(i => i.id) ?? []
    }
  } catch (e) { if (!controller.signal.aborted) error.value = (e as Error).message }
  finally { if (!controller.signal.aborted) pending.value = false }
}, { immediate: true })
onMounted(loadCatalog)
watch(() => props.version, loadCatalog)

function toggleIssue(id: string) {
  if (archived.value || !ready.value) return
  const picks = new Set(selectedIssues.value)
  if (picks.has(id)) picks.delete(id); else picks.add(id)
  selectedIssues.value = review.value!.issues.filter(i => picks.has(i.id)).map(i => i.id)
}
async function openModal(kind: NonNullable<typeof modal.value>, index = 0) {
  modal.value = kind; assetIndex.value = index
  if (kind === 'archive') { target.value = ''; if (catalogError.value) await loadCatalog() }
  await nextTick()
  if (dialog.value && !dialog.value.open) dialog.value.showModal()
}
async function ensureReport(id: string): Promise<ArchivedReview> {
  if (report.value && (archived.value || !draftChanged.value)) return report.value
  const state = await api<ReviewState>('/event-reviews/' + encodeURIComponent(id) + '/report',
    jsonRequest('PUT', { version: props.version, revision: report.value?.revision ?? 0, selectedIssues: selectedIssues.value }))
  if (eventId.value !== id) throw new Error('已切换赛事')
  saved.value = state
  return state.report!
}
async function act(kind: 'generate'|'export'|'archive') {
  if (!ready.value) return
  const id = eventId.value
  busy.value = true; message.value = ''
  try {
    const snapshot = await ensureReport(id)
    if (eventId.value !== id) return
    if (kind === 'generate') await openModal('report')
    if (kind === 'export') {
      downloadFile(snapshot.review.name + '－赛后复盘报告.html', reviewReportHtml(snapshot, saved.value.reused), 'text/html;charset=utf-8')
      message.value = '已导出完整复盘报告'
    }
    if (kind === 'archive') {
      const destination = candidates.value.find(t => t.id === target.value)
      const state = await api<ReviewState>('/event-reviews/' + encodeURIComponent(id) + '/archive',
        jsonRequest('POST', { revision: snapshot.revision, targetId: target.value || null }))
      if (eventId.value !== id) return
      saved.value = state
      dialog.value?.close()
      message.value = destination ? '已将保障模板和选中的改进事项复用至' + destination.name : '复盘报告已归档'
      await loadCatalog()
    }
  } catch (e) { if (eventId.value === id) { error.value = (e as Error).message; dialog.value?.close() } }
  finally { busy.value = false }
}
const dateLabel = (date: string) => date ? date.replace(/-/g, '.') : '赛期待登记'
const {catalog:mapCatalog,displayFeatures,displayCommand}=useEventMapDisplay(()=>features.value,command,()=>++serial)
</script>

<template>
  <section class="er-review" aria-label="赛后复盘" :data-pane="compactPane">
    <EventCompactPanels v-model="compactPane" left-label="赛事复盘" right-label="复盘评估"/>
    <CityMap class="er-map" :event-scene="true" :service-labels-light="light" region="京山市" :features="displayFeatures" :selected-id="pointId || null" :command="displayCommand"
      :imagery="mapCatalog.imagery" :imagery-config="document?.imagery" light-theme county-relief :show-town-boundaries="mapCatalog.towns" business-scene
      :administration="admin" :attribute-service-id="mapCatalog.attributeServiceId" :cim-layers="cimLayers" @cim-status="mapCatalog.status" @cim-pick="mapCatalog.pickService" :show-scale="false" @select="id=>mapCatalog.table?mapCatalog.pickRow(id):pick(id)"
      @pointerdown.capture.passive="requestedFocus=null" @wheel.capture.passive="requestedFocus=null"/>
    <div class="er-grid" :class="{'er-no-left':!leftOpen,'er-no-right':!rightOpen}">
      <aside v-show="leftOpen" class="v14-overview-rail-shell er-rail er-left" aria-label="赛事复盘">
        <div class="event-rail-module v14-overview-module">
        <header class="v14-overview-heading er-heading"><h2>赛事复盘</h2><button type="button" aria-label="收起赛事复盘" @click="leftOpen=false">‹ 收起</button></header>
        <div class="er-scroll">
          <section class="er-event-card">
            <label for="er-event">已办赛事 <span v-if="review?.sample" class="er-sample">演示数据</span></label>
            <select id="er-event" aria-label="选择复盘赛事" :value="eventId" :disabled="busy || !options.length" @change="selectReview(($event.target as HTMLSelectElement).value)">
              <option v-if="!options.length" value="">{{ document ? '暂无已办赛事' : '正在读取赛事…' }}</option>
              <option v-for="e in options" :key="e.id" :value="e.id">{{ e.name }}</option>
            </select>
            <template v-if="review">
              <p class="er-dates"><time :datetime="review.start">{{ dateLabel(review.start) }}</time><template v-if="review.end!==review.start"> — <time :datetime="review.end">{{ dateLabel(review.end) }}</time></template></p>
              <div class="er-event-status"><span class="er-status" :class="{archived}">{{ status }}</span><span>保障完成率 <b>{{ review.completion===null?'待采集':review.completion+'%' }}</b></span></div>
            </template>
          </section>
          <template v-if="review">
            <section class="er-block"><h3>核心指标</h3><div class="er-metrics">
              <EventStatistic v-for="(m,i) in review.metrics" :key="m.label" :label="m.label" :icon="icons[i]"
                :value="reviewNumber(m.value)" :unit="m.unit" :missing="m.value===null" />
            </div></section>
            <section class="er-block"><h3>赛事引流转化</h3><ol class="er-funnel">
              <li v-for="(m,i) in review.funnel" :key="m.label"><PortalIcon :name="funnelIcons[i]"/><span>{{ m.label }}</span><b>{{ metricText(m) }}</b></li>
            </ol></section>
            <section class="er-block"><h3>重点结论</h3><ul v-if="review.conclusions.length" class="er-conclusions"><li v-for="s in review.conclusions" :key="s">{{ s }}</li></ul><p v-else class="er-empty">尚无可核验的复盘结论</p></section>
          </template>
        </div>
        <footer class="er-actions"><button class="er-primary" :disabled="!ready" @click="act('generate')"><PortalIcon name="results"/>{{ archived || (report && !draftChanged) ? '查看复盘报告' : '生成复盘报告' }}</button></footer>
        </div>
      </aside>

      <div id="cockpit-map-column" class="er-center map-scene">
        <SceneAssistant page="tourism" area="京山市" :context-id="eventId" :loading="!document || (pending && !review)"
          :ledger-layers="[{id:'review-map',name:review?.sample?'演练复盘点位':'赛事复盘点位',features:features.filter(f=>f.geometry.type==='Point')}]"
          @locate="(_,feature)=>locateDestination(feature.id)" />
        <div class="event-map-frame" aria-hidden="true"></div>
        <button v-if="!leftOpen" class="er-reopen left" @click="leftOpen=true">赛事复盘 ›</button>
        <button v-if="!rightOpen" class="er-reopen right" @click="rightOpen=true">‹ 复盘评估</button>
        <EventMapToolbar :datasets="document?.datasets??[]" :features="features" :administration="admin" :scope="eventId" :dispatch-label="archived || (report && !draftChanged) ? '查看复盘报告' : '生成复盘报告'" :dispatch-disabled="!ready"
          @dispatch="act('generate')" @action="action=>{requestedFocus=null;command={action,serial:++serial}}"
          @area="town=>{requestedFocus=null;command={action:'fit-features',features:[town],view:'context',serial:++serial}}"
          @place="p=>{requestedFocus=null;command={action:'focus',position:p.position,locationName:p.name,venueFocus:{name:p.name,position:p.position},height:1800,serial:++serial}}"
          @resource="f=>{pick(f.id);if(f.id!=='review-venue')locateDestination(f.id)}"
          @reset="requestedFocus=null;resetMapSelection();showSupport=true;command={action:'home',serial:++serial}">
          <template #layers>
            <label v-if="supportSites.length" class="catalog-row"><input v-model="showSupport" type="checkbox" @change="resetMapSelection()"/>场馆周边 1 公里配套</label>
            <label v-if="review?.points.length" class="catalog-row"><input type="radio" name="event-review-layer" :checked="!group" @change="resetMapSelection()"/>全部客流去向</label>
            <label v-for="g in flows" :key="g.id" class="catalog-row"><input type="radio" name="event-review-layer" :disabled="g.share===null" :checked="group===g.id" @change="selectGroup(g.id)"/>{{g.label}}</label>
          </template>
          <template #location="{close}"><button type="button" :disabled="!features.length" @click="close();resetMapSelection();nextTick(fit)">定位本场赛事与配套</button></template>
        </EventMapToolbar>
        <section v-if="review && pointId" class="er-map-facts er-point-detail" aria-label="地图点位详情" aria-live="polite">
          <b>{{ selectedSite?.name || selectedPoint?.name || mapReview?.venue || review.name }}</b>
          <span v-if="selectedPoint">赛后到访 {{ reviewNumber(selectedPoint.visits) }} 人次</span>
          <template v-if="selectedSite">
            <span>{{ selectedSite.label }} · 距场馆 {{ selectedSite.distanceLabel }}</span>
            <span v-if="selectedSite.capacityLabel">{{ selectedSite.capacityLabel }}</span>
            <span v-if="selectedSite.address">{{ selectedSite.address }}</span>
          </template>
          <span v-else-if="pointId==='review-venue'">赛事举办场馆</span>
          <button class="er-clear" aria-label="关闭点位详情" @click="pointId=''">×</button>
        </section>
        <EventMapLegend :rows="mapLegend"/>
      </div>

      <aside v-show="rightOpen" class="v14-overview-rail-shell er-rail er-right" aria-label="复盘评估">
        <div class="event-rail-module v14-overview-module">
        <header class="v14-overview-heading er-heading"><h2>复盘评估</h2><button type="button" aria-label="收起复盘评估" @click="rightOpen=false">收起 ›</button></header>
        <div class="er-scroll">
          <template v-if="review">
            <section class="er-evaluation" aria-label="综合保障评分">
              <div class="er-dial" :class="{'er-score-pending':review.score===null}" :style="{'--score':(review.score??0)+'%'}"><div><strong>{{ review.score??'待评' }}</strong><span class="er-score-caption"><span>综合</span><span>保障评分</span></span></div></div>
              <div class="er-ratings"><div v-for="s in review.scores" :key="s.label"><span>{{ s.label }}</span><b :class="{'er-score-pending':s.value===null}">{{ s.value??'待评' }}</b><i><b :style="{width:(s.value??0)+'%'}"></b></i></div></div>
            </section>
            <section class="er-block"><h3>问题与改进 <small v-if="review.issues.length">{{ review.issues.length }} 项</small></h3>
              <article v-for="i in review.issues" :key="i.id" class="er-issue">
                <header class="er-issue-heading"><h4>{{ i.title }}</h4>
                  <button type="button" :aria-label="i.title+' · 纳入下届方案'" :aria-pressed="selectedIssues.includes(i.id)" :disabled="archived || !ready" @click="toggleIssue(i.id)">
                    {{ archived ? (selectedIssues.includes(i.id)?'已纳入复用':'未纳入复用') : (selectedIssues.includes(i.id)?'✓ 纳入下届方案':'＋ 纳入下届方案') }}</button>
                </header>
                <p class="er-issue-evidence">{{ i.evidence }}
                  <button v-if="issueKind(i.id)" type="button" @click="selectSupport(issueKind(i.id)!.kind,false)"><PortalIcon name="pin"/>周边{{ issueKind(i.id)?.label }}</button>
                </p><p><b>改进</b>{{ i.action }}</p>
              </article><p v-if="!review.issues.length" class="er-empty">暂无已登记问题</p>
            </section>
            <section class="er-block er-direction"><h3>赛后 48 小时客流方向</h3>
              <div v-if="flows.some(g=>g.share!==null)" class="er-direction-rows">
                <button v-for="g in flows.filter(g=>g.share!==null)" :key="g.id" :aria-pressed="group===g.id"
                  @click="selectGroup(g.id)" :style="{'--flow':g.color}">
                  <i></i><span>{{ g.label }}</span><span class="er-track"><b :style="{width:g.share+'%'}"></b></span><strong>{{ g.share }}%</strong>
                </button>
              </div><p v-else class="er-empty">{{ review.points.length ? '已登记到访 0 人次' : '暂无去向记录' }}</p>
              <ul v-if="group" class="er-destinations"><li v-for="p in groupPoints" :key="p.id">
                <button v-if="p.visits && p.position && mapReview?.position" type="button" @click="locateDestination(p.id)">{{ p.name }} ›</button><span v-else>{{ p.name }}</span>
                <b>{{ reviewNumber(p.visits) }} 人次</b>
              </li></ul>
            </section>
            <EventReviewTrend :days="review.trend" @detail="openModal('trend')"/>
            <section class="er-block"><h3>成果沉淀</h3><div class="er-assets">
              <button v-for="(a,i) in review.assets" :key="a.title" @click="openModal('asset',i)"><PortalIcon :name="assets[i]"/>{{ a.title }}</button>
            </div></section>
            <p v-if="saved.reused.length" class="er-used">已复用至 {{ saved.reused.map(t=>t.name).join('、') }}</p>
          </template><p v-else class="er-empty">{{ pending || !document ? '正在读取复盘数据…' : '当前区域暂无可复盘的已办赛事' }}</p>
        </div>
        <footer class="er-actions"><p v-if="error || catalogError" role="alert">{{ error || catalogError }} <button @click="retry++;loadCatalog()">重新载入</button></p><p v-else-if="message" role="status">{{ message }}</p>
          <button class="er-gold" :disabled="!ready" @click="act('export')"><PortalIcon name="results"/>导出完整复盘报告</button>
          <button :disabled="!ready || (archived && !candidates.length)" @click="openModal('archive')">{{ archived?'复用至下届赛事':canReuse?'归档并复用至下届赛事':'归档复盘报告' }}</button>
        </footer>
        </div>
      </aside>
    </div>

    <dialog ref="dialog" class="er-dialog" aria-labelledby="er-dialog-title" @close="modal=null" @click.self="dialog?.close()">
      <template v-if="review && modal">
        <header><div><small>{{ review.name }}{{ review.sample?' · 演示数据':'' }}</small><h2 id="er-dialog-title">{{ modal==='report'?'赛后复盘报告':modal==='archive'?'归档与复用':modal==='trend'?'客流变化明细':review.assets[assetIndex].title }}</h2></div>
          <button aria-label="关闭窗口" @click="dialog?.close()">×</button></header>
        <div class="er-dialog-body">
          <template v-if="modal==='report' && report"><p class="er-report-meta">{{ report.archivedAt?'已归档':'已生成' }} · 数据版本 V{{ report.version }} · {{ reviewTime(report.generatedAt) }}</p>
            <section v-for="s in reportSections" :key="s.title"><h3>{{ s.title }}</h3><ul><li v-for="(line,i) in s.lines" :key="i">{{ line }}</li></ul></section></template>
          <template v-if="modal==='archive'"><p>{{ archived?'已归档的保障模板和改进事项可供后续赛事使用。':'归档将保存本场复盘快照。选定后续赛事后，可在其赛前研判详情中查看保障模板和改进事项。' }}</p>
            <section><h3>纳入复用的改进事项</h3><ul v-if="selectedIssues.length"><li v-for="i in review.issues.filter(i=>selectedIssues.includes(i.id))" :key="i.id">{{ i.title }} · {{ i.action }}</li></ul><p v-else>{{ canReuse?'本次仅复用保障方案模板。':'本场暂无可复用的事项。' }}</p></section>
            <label for="er-target">目标赛事</label><select id="er-target" v-model="target" :disabled="busy"><option value="">{{ archived?'请选择赛事':'仅归档，暂不复用' }}</option><option v-for="t in candidates" :key="t.id" :value="t.id">{{ t.name }} · {{ t.start }}</option></select>
            <p v-if="saved.reused.length">已复用至 {{ saved.reused.map(t=>t.name).join('、') }}</p>
          </template>
          <table v-if="modal==='trend'"><thead><tr><th>日期</th><th>赛事客流（人次）</th><th>文旅客流（人次）</th></tr></thead><tbody><tr v-for="day in review.trend" :key="day.date"><td>{{ day.date }}</td><td>{{ reviewNumber(day.event) }}</td><td>{{ reviewNumber(day.tourism) }}</td></tr></tbody></table>
          <template v-if="modal==='asset'"><ul v-if="review.assets[assetIndex].rows.length"><li v-for="(row,i) in review.assets[assetIndex].rows" :key="i">{{ row }}</li></ul><p v-else>这场赛事尚未收录此类成果。</p></template>
        </div>
        <footer><button @click="dialog?.close()">关闭</button><button v-if="modal==='report'" class="er-primary" :disabled="!ready" @click="act('export')">导出完整复盘报告</button>
          <button v-if="modal==='archive'" class="er-primary" :disabled="!ready || (archived && !target)" @click="act('archive')">{{ target?'确认复用':'确认归档' }}</button></footer>
      </template>
    </dialog>
  </section>
</template>
