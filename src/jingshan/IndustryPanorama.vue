<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import IndustryModule from './IndustryModule.vue'
import IndustryRail from './IndustryRail.vue'
import IndustryChainDiagram from './IndustryChainDiagram.vue'
import IndustryRecruitmentMap from './IndustryRecruitmentMap.vue'
import { panoramaWeakTopics } from './industry-chain-health'
import { buildScaleOutput, formatIndustryOutput } from './industry-output'
import {
  buildPanoramaCatalog, chain, enterpriseBusiness, enterpriseChainLabel, field, scopeEnterprises,
  type CatalogEnterprise, type ChainStage, type ChainTopic, type Enterprise,
} from './industry-panorama'
import type { CityFeature, Dataset, Result } from './types'

const IndustryPanoramaDrawer = defineAsyncComponent(() => import('./IndustryPanoramaDrawer.vue'))

const props = defineProps<{
  datasets: Dataset[]
  mode: 'demo' | 'live'
  region: string
  leftOpen: boolean
  rightOpen: boolean
  diagnosing: boolean
  selectedFeature?: CityFeature | null
  mapPick?: {feature: CityFeature}
  rules: Record<string, number>
  results: Result[]
}>()
const emit = defineEmits<{
  locate: [feature: CityFeature, datasetId: string]
  open: [side: 'left' | 'right']
  close: [side: 'left' | 'right']
  'map-enterprises': [points: Enterprise[]]
  'clear-highlight': []
  'diagnosis-change': [open: boolean]
}>()

const stage = ref<ChainStage | null>(null)
const topic = ref<ChainTopic | null>(null)
const collapsed = ref<ChainStage[]>([])
const query = ref('')
const township = ref('')
const currentPage = ref(1)
const pageSize = 10
const enterpriseOpen = ref(false)
const drawer = computed(() => enterpriseOpen.value ? 'enterprise' : props.diagnosing ? 'diagnosis' : null)
const diagnosisTrigger = ref<HTMLButtonElement>()
const directoryResults = ref<HTMLElement | null>(null)
const enterpriseKey = ref('')
const catalog = computed(() => buildPanoramaCatalog(props.datasets, props.region))
const weakTopics = computed(() => panoramaWeakTopics(props.datasets, props.region))
const directory = computed(() => chain.map(item => {
  const entries = scopeEnterprises(catalog.value, item.id)
  return {
    ...item, count: entries.length,
    nodes: item.topics.map(name => ({
      name, count: scopeEnterprises(entries, item.id, name).length, weak: weakTopics.value.has(name),
    })),
  }
}))
const rows = computed(() => scopeEnterprises(catalog.value, stage.value, topic.value))
const selectedYear = ref<number>()
const output = computed(() => buildScaleOutput(props.datasets, props.region, props.mode, selectedYear.value))
const annualAmount = computed(() => output.value.amount(stage.value, topic.value))
const broaderOutput = computed(() => stage.value && topic.value ? output.value.broaderScope(stage.value, topic.value) : null)
const townships = computed(() => [...new Set(rows.value.flatMap(row => row.records.map(record => record.feature.properties.region)).filter(Boolean))]
  .sort((first, second) => first.localeCompare(second, 'zh-CN')))
const townshipCatalog = computed(() => township.value && township.value !== '京山市' && township.value !== props.region
  ? buildPanoramaCatalog(props.datasets, township.value) : catalog.value)
const filtered = computed(() => {
  const needle = query.value.trim().normalize('NFKC').toLocaleLowerCase('zh-CN')
  const matches = (term: string) => term.normalize('NFKC').toLocaleLowerCase('zh-CN').includes(needle)
  const inTown = (entry: Enterprise) => !township.value || entry.feature.properties.region === township.value
  return scopeEnterprises(townshipCatalog.value, stage.value, topic.value).flatMap(row => {
    if (!township.value && !needle) return [row]
    const values = row.feature.properties
    const records = row.records.filter(inTown)
    if (!records.length) return []
    const subjectMatch = !needle || [values.name, enterpriseBusiness(row, ''), field(values, ['formerNames','formerName'], ''),
      field(values, ['creditCode','unifiedSocialCreditCode'], '')].some(matches)
    const matchingRecords = subjectMatch ? records : records.filter(({ feature: { properties } }) =>
      [properties.name, ...['venueName','address','classification','providerType','siteNames','locationName'].map(key => field(properties,[key],''))].some(matches))
    if (!matchingRecords.length) return []
    const points = row.points.filter(point => inTown(point) && (subjectMatch || matchingRecords.some(record =>
      record.datasetId === point.datasetId && record.feature.id === point.feature.id)))
    return [{ ...row, records, points }]
  })
})
const selected = computed(() => (props.diagnosing ? rows.value : filtered.value).find(row => row.key === enterpriseKey.value) ?? null)
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const visibleRows = computed(() => filtered.value.slice((currentPage.value - 1) * pageSize, currentPage.value * pageSize))

function townLabel(region: string) {
  return !region || region === '京山市' ? '镇街待核实' : region
}

function setScope(nextStage: ChainStage | null, nextTopic: ChainTopic | null = null) {
  if (stage.value !== nextStage || topic.value !== nextTopic) {
    stage.value = nextStage
    topic.value = nextTopic
    emit('clear-highlight')
  }
  query.value = ''
  township.value = ''
  currentPage.value = 1
  enterpriseKey.value = ''
}
function choose(nextStage: ChainStage | null, nextTopic: ChainTopic | null = null) {
  setScope(nextStage, nextTopic)
  enterpriseOpen.value = false
  emit('open', 'right')
}
async function chooseInDiagnosis(nextStage: ChainStage | null, nextTopic: ChainTopic | null = null) {
  choose(nextStage, nextTopic)
  if (window.matchMedia('(max-width: 960px) and (pointer: coarse)').matches) {
    await nextTick()
    document.querySelector('.inline-diagnosis')?.scrollIntoView({ block: 'start' })
  }
}
function openDiagnosis() {
  enterpriseOpen.value = false
  emit('diagnosis-change', true)
  emit('open', 'right')
}
async function returnToMap() {
  enterpriseOpen.value = false
  emit('diagnosis-change', false)
  emit('open', 'right')
  await nextTick()
  diagnosisTrigger.value?.focus({ preventScroll: true })
  if (window.matchMedia('(max-width: 960px) and (pointer: coarse)').matches)
    document.querySelector('.jt-map')?.scrollIntoView({ block: 'start' })
}
function closeDrawer() {
  if (enterpriseOpen.value) enterpriseOpen.value = false
  else void returnToMap()
}
async function chooseFromDirectory(nextStage: ChainStage | null, nextTopic: ChainTopic | null = null) {
  if (nextStage === null) collapsed.value = []
  if (props.diagnosing) return chooseInDiagnosis(nextStage, nextTopic)
  choose(nextStage, nextTopic)
  await nextTick()
  const results = directoryResults.value
  const rail = results?.closest<HTMLElement>('.panorama-right')
  if (!results || !rail) return
  const first = results.querySelector('tbody tr, .industry-empty')
  // Keep as much of the diagram as fits above the first matching company.
  rail.scrollTop = nextStage && first
    ? Math.max(0, rail.scrollTop + first.getBoundingClientRect().bottom - rail.getBoundingClientRect().bottom + 12)
    : 0
  if (window.matchMedia('(max-width: 960px)').matches) {
    rail.scrollIntoView({ block: 'start' })
  }
}
async function changePage(page: number) {
  currentPage.value = page
  await nextTick()
  const results = directoryResults.value
  const rail = results?.closest<HTMLElement>('.panorama-right')
  if (!rail || !results) return
  rail.scrollTop += results.getBoundingClientRect().top - rail.getBoundingClientRect().top - 12
  results.focus({ preventScroll: true })
}
function toggleStage(id: ChainStage) {
  collapsed.value = collapsed.value.includes(id) ? collapsed.value.filter(item => item !== id) : [...collapsed.value, id]
}
function viewEnterprise(row: CatalogEnterprise) {
  enterpriseKey.value = row.key
  const point = row.points[0]
  if (!props.diagnosing) {
    if (point) emit('locate', point.feature, point.datasetId)
    else emit('clear-highlight')
  }
  enterpriseOpen.value = true
  emit('open', 'right')
}
function locate(row: Enterprise) {
  enterpriseOpen.value = false
  if (props.diagnosing) emit('diagnosis-change', false)
  emit('locate', row.feature, row.datasetId)
}
watch(filtered, entries => emit('map-enterprises', entries.flatMap(entry => entry.points)), { immediate: true })
watch([query, township], () => { currentPage.value = 1 })
watch(pages, count => { currentPage.value = Math.min(currentPage.value, count) })
watch(townships, options => { if (!options.includes(township.value)) township.value = '' })
watch([() => props.region, () => props.mode], () => { selectedYear.value = undefined }, { flush: 'sync' })
watch(() => output.value.years, years => {
  if (selectedYear.value !== undefined && !years.includes(selectedYear.value)) selectedYear.value = undefined
})
watch(() => props.region, () => { currentPage.value = 1; enterpriseOpen.value = false; enterpriseKey.value = '' })
watch(() => props.rightOpen, open => { if (!open) enterpriseOpen.value = false })
watch(() => props.selectedFeature?.id, id => {
  if (!id) return
  const match = rows.value.find(row => row.points.some(point => point.feature.id === id))
  if (match) enterpriseKey.value = match.key
})
watch(() => props.mapPick, pick => {
  if (!pick || props.diagnosing) return
  const row = filtered.value.find(entry => entry.points.some(point => point.feature.id === pick.feature.id))
  if (!row) return
  enterpriseKey.value = row.key
  enterpriseOpen.value = true
  emit('open', 'right')
})
watch(selected, row => { if (!row) enterpriseOpen.value = false })
</script>

<template>
  <IndustryRail class="panorama-left" side="left" :open="leftOpen">
    <IndustryModule class="panorama-module catalog-module" title="产业链目录">
      <template #heading-actions>
        <button v-if="stage" class="industry-button" type="button" @click="chooseFromDirectory(null)">查看全链条</button>
      </template>
      <ul class="catalog-tree" :class="{ 'all-collapsed': collapsed.length === directory.length }" aria-label="产业链环节">
        <li v-for="item in directory" :key="item.id" :style="{ flexGrow: collapsed.includes(item.id) ? 0 : item.nodes.length }">
          <div class="catalog-stage" :class="{ active: stage === item.id && !topic }">
            <button type="button" class="catalog-chevron" :aria-expanded="!collapsed.includes(item.id)"
              :aria-controls="'catalog-' + item.id" :aria-label="(collapsed.includes(item.id) ? '展开' : '折叠') + item.id"
              @click="toggleStage(item.id)"><span aria-hidden="true"></span></button>
            <button type="button" class="catalog-node" :aria-pressed="stage === item.id && !topic" @click="chooseFromDirectory(item.id)">
              <span class="catalog-stage-label"><strong>{{ item.id }}</strong><span>{{ item.title }}</span></span>
              <span class="catalog-count">{{ item.count }} 家</span>
            </button>
          </div>
          <ul v-show="!collapsed.includes(item.id)" :id="'catalog-' + item.id" class="catalog-children">
            <li v-for="node in item.nodes" :key="node.name">
              <button type="button" class="catalog-node" :aria-pressed="stage === item.id && topic === node.name"
                @click="chooseFromDirectory(item.id, node.name)">
                <span>{{ node.name }}</span>
                <span class="catalog-node-meta">
                  <span v-if="node.weak" class="industry-status catalog-risk">弱链</span>
                  <span class="catalog-count">{{ node.count }} 家</span>
                </span>
              </button>
            </li>
          </ul>
        </li>
      </ul>
    </IndustryModule>
  </IndustryRail>
  <IndustryRecruitmentMap v-if="diagnosing" id="panorama-chain-map" :weak-topics="weakTopics" :stage="stage" :topic="topic"
    @select="chooseInDiagnosis" @return-map="returnToMap" />
  <IndustryRail v-if="!diagnosing" class="panorama-right" side="right" :open="rightOpen">
    <IndustryModule class="panorama-module catalog-summary" title="产业链图谱">
        <section class="industry-stat catalog-output" aria-label="年度产值">
          <div class="catalog-output-header">
            <h3>{{ topic || stage || '全产业链' }}产值</h3>
            <div v-if="annualAmount !== null" class="catalog-amount"><strong>{{ formatIndustryOutput(annualAmount) }}</strong> 亿元</div>
            <b v-else class="industry-empty">{{ broaderOutput ? '待拆分' : '待统计' }}</b>
          </div>
          <div class="catalog-output-meta">
            <span class="catalog-period">
              <select v-if="output.years.length > 1" aria-label="产值统计年度" :value="output.year" @change="selectedYear = Number(($event.target as HTMLSelectElement).value)">
                <option v-for="year in output.years" :key="year" :value="year">{{ year }}年度</option>
              </select>
              <span v-else-if="output.year !== null">{{ output.year }}年度</span>
              <span v-if="output.basis === 'estimate' && annualAmount !== null">估算</span>
            </span>
            <button ref="diagnosisTrigger" class="industry-button catalog-diagnose" type="button" @click="openDiagnosis">产业链诊断</button>
          </div>
          <p v-if="broaderOutput" class="catalog-aggregate-note">{{ broaderOutput }}合并报送</p>
        </section>
      <IndustryChainDiagram :directory="directory" :stage="stage" :topic="topic" @select="choose" />
    </IndustryModule>
    <IndustryModule class="panorama-module catalog-directory" title="产业主体名录">
      <template #heading-actions>
        <span class="catalog-total" role="status"><span>{{ topic || stage || '全链' }}</span><b>{{ query.trim() || township ? '筛得 ' + filtered.length : rows.length }} 家</b></span>
      </template>
      <div class="industry-filters catalog-filters">
        <input v-model="query" type="search" placeholder="名称、经营点或业务" aria-label="搜索主体名称、经营点、地址、业务或信用代码" />
        <select v-model="township" aria-label="筛选镇街">
          <option value="">全部镇街</option><option v-for="town in townships" :key="town">{{ townLabel(town) }}</option>
        </select>
      </div>
      <div ref="directoryResults" class="catalog-results" role="region" aria-label="产业主体名录结果" tabindex="-1">
        <table v-if="visibleRows.length" class="industry-table catalog-table" aria-label="产业主体名录">
          <thead><tr><th scope="col">主体名称</th><th scope="col">产业链环节</th></tr></thead>
          <tbody><tr v-for="row in visibleRows" :key="row.key" :class="{ selected: enterpriseKey === row.key }">
            <td><button class="industry-row-action" type="button" aria-haspopup="dialog" @click="viewEnterprise(row)">{{ row.feature.properties.name }}</button></td>
            <td>{{ enterpriseChainLabel(row) }}<span v-if="row.aboveThreshold" class="industry-status catalog-threshold">限上企业</span><span v-if="row.feature.properties.aboveScale === true" class="industry-status catalog-threshold">规上企业</span></td>
          </tr></tbody>
        </table>
        <p v-else class="industry-empty">{{ rows.length ? '没有符合条件的主体' : (topic || stage || region) + '暂无收录主体' }}</p>
        <nav v-if="pages > 1" class="catalog-pager" aria-label="产业主体名录分页">
          <button type="button" class="industry-button" :disabled="currentPage === 1" @click="changePage(currentPage - 1)">上一页</button>
          <span>{{ currentPage }} / {{ pages }}</span>
          <button type="button" class="industry-button" :disabled="currentPage === pages" @click="changePage(currentPage + 1)">下一页</button>
        </nav>
      </div>
    </IndustryModule>
  </IndustryRail>
  <IndustryPanoramaDrawer v-if="drawer && rightOpen" :view="drawer" :stage="stage" :topic="topic"
    :rows="rows" :selected="selected" :datasets="datasets" :mode="mode" :region="region"
    :output="output" @scope="setScope" @enterprise="viewEnterprise" @diagnosis="openDiagnosis" @close="closeDrawer" @locate="locate" />
</template>

<style scoped>
.catalog-tree, .catalog-children { list-style: none; padding: 0; }
.panorama-left .catalog-module { flex: 1 0 auto; }
.catalog-module :deep(.industry-module-body) { display: flex; flex: 1 0 auto; flex-direction: column; padding: 8px; }
.panorama-module :deep(.v14-overview-heading) { min-height: 46px; }
.catalog-module :deep(.v14-overview-heading:has(> button)) { flex-wrap: nowrap; }
.catalog-module :deep(.v14-overview-heading > button) { flex: none; white-space: nowrap; }
@container (max-width: 284px) {
  .catalog-module :deep(.v14-overview-heading) { flex-wrap: nowrap; gap: 4px; padding-inline: 6px; }
  .catalog-module :deep(.v14-overview-heading::before) { width: 18px; height: 18px; }
  .catalog-module :deep(.v14-overview-heading h2) { font-size: 20px; white-space: nowrap; }
  .catalog-module :deep(.v14-overview-heading > .industry-button) { padding-inline: 4px; white-space: nowrap; }
}
.catalog-tree { flex: 1 0 auto; display: flex; flex-direction: column; gap: clamp(6px, 1dvh, 16px); }
.catalog-tree > li { display: flex; flex-direction: column; flex-shrink: 0; background: var(--industry-row-fill); border: 1px solid var(--industry-table-line); }
.catalog-tree.all-collapsed { display: grid; grid-template-rows: repeat(3, 1fr); }
.catalog-tree.all-collapsed .catalog-stage { flex: 1; }
.catalog-stage { display: flex; align-items: stretch; background: var(--v14-tab); }
.catalog-stage.active, .catalog-children button[aria-pressed="true"] { background: var(--v14-tab-active); color: white; }
.catalog-chevron, .catalog-node { border: 0; background: transparent; color: inherit; }
.catalog-chevron { width: 36px; flex: none; display: grid; place-items: center; }
.catalog-chevron span { width: 8px; height: 8px; border: solid currentColor; border-width: 0 2px 2px 0; transform: rotate(-45deg); }
.catalog-chevron[aria-expanded="true"] span { transform: rotate(45deg); }
.catalog-node { flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 40px; width: 100%; text-align: left; padding: 8px 12px; line-height: 24px; }
.catalog-stage .catalog-node { min-height: clamp(40px, 4.6dvh, 62px); padding-inline-start: 0; font-weight: 700; }
.catalog-stage-label { display: flex; align-items: center; flex-wrap: wrap; gap: 1px 8px; }
.catalog-stage-label strong { padding-inline-end: 8px; border-inline-end: 1px solid var(--v14-list-line); font-size: 18px; }
.catalog-count { color: var(--v14-metric); font-variant-numeric: tabular-nums; white-space: nowrap; }
.catalog-node-meta { display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; flex-shrink: 0; }
.catalog-children .catalog-risk { padding: 0 4px; border: 1px dashed currentColor; color: var(--panorama-weak); white-space: nowrap; font: 700 16px/20px var(--v14-font); }
.catalog-node[aria-pressed="true"] .catalog-risk { background: var(--panorama-map-field); }
.catalog-stage.active .catalog-count, .catalog-node[aria-pressed="true"] .catalog-count { color: inherit; }
.catalog-children { display: grid; flex: 1; grid-auto-rows: 1fr; margin: 4px 0 4px 18px; border-inline-start: 1px solid var(--v14-chart-track); }
.catalog-children li { position: relative; }
.catalog-children li::before { position: absolute; inset: 50% auto auto 0; width: 8px; border-top: 1px solid var(--v14-muted); content: ""; pointer-events: none; }
.catalog-children .catalog-node { height: 100%; min-height: 36px; padding: 5px 12px 5px 18px; }
.catalog-node:not([aria-pressed="true"]):hover, .catalog-stage:not(.active) .catalog-chevron:hover { background: var(--industry-selected); color: var(--v14-ink); }
@container (max-width: 300px) {
  .catalog-chevron { width: 25px; }
  .catalog-stage .catalog-node { column-gap: 4px; padding-inline-end: 6px; }
  .catalog-stage-label { column-gap: 4px; }
  .catalog-stage-label strong { font-size: 16px; padding-inline-end: 4px; }
}
.panorama-right { gap: 12px; }
.catalog-summary :deep(.industry-module-body), .catalog-directory :deep(.industry-module-body) {
  gap: 12px; padding: 8px;
}
.catalog-directory :deep(.industry-module-body) { gap: 8px; }
.catalog-results .industry-empty { margin: 0; padding: 10px; background: var(--industry-row-fill); }
.catalog-output-header, .catalog-output-meta, .catalog-period {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px;
}
.catalog-output { padding: 8px 12px; gap: 4px; }
.catalog-aggregate-note { margin: 0; color: var(--v14-muted); }
.catalog-period { justify-content: flex-start; gap: 2px 8px; color: var(--v14-muted); }
.catalog-period select { width: auto; min-height: 32px; padding: 1px 4px; }
.catalog-amount { white-space: nowrap; }
.catalog-amount strong { font-size: 28px; line-height: 1.1; }
.catalog-output .catalog-diagnose { min-height: 32px; padding: 2px 8px; margin-inline-start: auto; white-space: nowrap; }
.catalog-total { display: inline-flex; flex-wrap: wrap; align-items: baseline; justify-content: flex-end; gap: 0 6px; margin-inline-start: auto; color: var(--v14-ink); }
.catalog-total b { color: var(--v14-icon); white-space: nowrap; }
.catalog-directory :deep(.v14-overview-heading) { flex-wrap: wrap; }
.catalog-directory :deep(.v14-overview-heading h2) { white-space: nowrap; }
.catalog-filters { grid-template-columns: minmax(0, 1.65fr) minmax(100px, 1fr); }
.catalog-table th:first-child { width: 55%; }
.catalog-table :is(th,td) { height: 44px; padding-block: 8px; }
.catalog-threshold { display: block; width: fit-content; white-space: nowrap; margin-block-start: 3px; }
.catalog-table .industry-row-action { color: var(--v14-ink); }
.catalog-table .industry-row-action:hover { text-decoration: underline; }
.catalog-pager { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px; padding-block-start: 8px; }
@container (max-width: 284px) {
  .catalog-directory :deep(.v14-overview-heading) { flex-wrap: nowrap; gap: 4px; padding: 4px 6px; }
  .catalog-directory :deep(.v14-overview-heading::before) { width: 18px; height: 18px; }
  .catalog-directory :deep(.v14-overview-heading h2) { font-size: 20px; }
  .catalog-total { flex-direction: column; align-items: flex-end; flex-wrap: nowrap; line-height: 19px; }
  .catalog-output { padding-inline: 8px; }
  .catalog-output-header, .catalog-output-meta, .catalog-period { column-gap: 4px; }
  .catalog-output-header h3 { font-size: 16px; }
  .catalog-amount strong { font-size: 22px; }
}
@media (max-width: 960px) {
  .panorama-right { max-block-size: min(72dvh, 720px); overscroll-behavior-y: auto; }
}
</style>
