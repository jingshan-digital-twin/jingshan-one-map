<script setup lang="ts">
import { computed, ref } from 'vue'
import { buildPanoramaCatalog, chain, scopeEnterprises } from './industry-panorama.ts'
import { aboveScaleOrThresholdCount } from './industry-enterprise-capacity.ts'
import { buildScaleOutput } from './industry-output.ts'
import OverviewPanelIcon from './OverviewPanelIcon.vue'
import { dashboardPalette } from './dashboard-palette.ts'
import { activeCourtSource, ledgerStatistics } from './court-ledger.ts'
import { venueOwnershipGroups } from './venue-ownership.ts'
import type { CityFeature, Dataset } from './types.ts'

type Metric = {
  label: string
  value: number | undefined
  unit: string
  icon?: string
  note?: string
  title?: string
}

const props = defineProps<{
  datasets: Dataset[]
  courtFeatures?: CityFeature[]
  region: string
  demo?: boolean
}>()

const industryTabs = ['总览', ...chain.map(stage => stage.id)]
const industryTab = ref(0)
const venueTabs = ['按权属', '按开放程度']
const venueTab = ref(0)

const data = computed(() => new Map(props.datasets.map(dataset =>
  [dataset.id, dataset.features.map(f => f.properties)] as const)))
const demo = (value: number | undefined, example: number) => value ?? (props.demo ? example : undefined)
const text = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
const count = (id: string) => data.value.get(id)?.length

function countBy(id: string, key: string, values: readonly unknown[]) {
  const records = data.value.get(id)
  if (!records || (records.length && !records.some(item => item[key] != null))) return undefined
  return records.filter(item => values.includes(item[key])).length
}

function total(id: string, key: string) {
  return sum(data.value.get(id), key)
}
function sourceNote(id: string, key: string, label: string, example: number) {
  const actual = props.datasets.find(item => item.id === id)?.source
  if (actual && (!count(id) || data.value.get(id)?.some(item => typeof item[key] !== 'number'))) return label + '待补录'
  return label + ' ' + text(actual ? total(id, key) : demo(total(id, key), example))
}

function sum(records: CityFeature['properties'][] | undefined, key: string) {
  const values = (records ?? []).map(item => item[key]).filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  )
  return values.length ? values.reduce((result, value) => result + value, 0) : undefined
}

const tierColors = [dashboardPalette.cyan, dashboardPalette.blue, dashboardPalette.purple]
const catalog = computed(() => props.datasets.length ? buildPanoramaCatalog(props.datasets, props.region) : undefined)
const tierMetrics = computed(() => chain.map((stage, index) => {
  const rows = catalog.value && scopeEnterprises(catalog.value, stage.id)
  return { ...stage, label: stage.id, value: rows?.length, color: tierColors[index],
    topics: stage.topics.map(label => ({ label, value: rows && scopeEnterprises(rows, stage.id, label).length })),
    multiTopic: rows?.filter(row => row.memberships.some(item => item.stage === stage.id && item.topics.length > 1)).length,
  }
}))
const activeStage = computed(() => tierMetrics.value[industryTab.value - 1])
const annualOutput = computed(() => buildScaleOutput(props.datasets, props.region, props.demo ? 'demo' : 'live'))
const stageOutputWan = computed(() => {
  const stage = activeStage.value
  const amount = stage && annualOutput.value.amount(stage.id)
  return amount == null ? null : (amount * 10_000).toLocaleString('zh-CN', { maximumFractionDigits: 4 })
})
const aboveScaleCount = computed(() => catalog.value && aboveScaleOrThresholdCount(props.datasets,catalog.value,props.region))

const overviewMetrics = computed<Metric[]>(() => [
  { label: '产业链主体', value: catalog.value?.length, unit: '家', icon: 'state' },
  { label: '规上限上企业', value: aboveScaleCount.value, unit: '家', icon: 'chart' },
])

const recentBusinesses = computed(() => {
  const rows = catalog.value
  if (!rows) return undefined
  const dated = rows.map(({feature: {properties: record}}) => Date.parse(String(record.registeredAt ?? record.established ?? '')))
  if (!dated.every(Number.isFinite)) return undefined
  const now = new Date()
  const cutoff = new Date(now)
  cutoff.setFullYear(now.getFullYear() - 1)
  return dated.filter(date => date >= cutoff.getTime() && date <= now.getTime()).length
})

const upstreamMetrics = computed<Metric[]>(() => [
  { label: '上游主体', value: tierMetrics.value[0].value, unit: '家', icon: 'state' },
  ...tierMetrics.value[0].topics.map((topic, i) => ({ ...topic, unit: '家', icon: ['industry', 'private', 'venue'][i] })),
])
const detailMax = computed(() => Math.max(1, ...(activeStage.value?.topics ?? []).map(item => item.value ?? 0)))

const inventory = computed(() => props.courtFeatures ? ledgerStatistics({features:props.courtFeatures},'京山市')
  : ledgerStatistics(activeCourtSource({datasets:props.datasets}),props.region))
const venueMetrics = computed<Metric[]>(() => [
  {label:'网球场馆',value:inventory.value.venues,unit:'处',icon:'venue'},
  {label:'网球场地',value:inventory.value.courts,unit:'片',icon:'state'},
])
const openingColors:Record<string,string>={'全天开放':dashboardPalette.green,'错时开放':dashboardPalette.blue,'不开放':dashboardPalette.purple,'待确认':dashboardPalette.yellow}
const venueGroups = computed(() => {
  if (venueTab.value === 0) {
    return venueOwnershipGroups.map(({label,color}) => ({
      label:label === '民营和社会' ? '民营或社会' : label, color, value:inventory.value.ownership(label),
    }))
  }
  return inventory.value.opening
    .filter(([label]) => label !== '未填')
    .map(([label,value]) => ({label,value,color:openingColors[label] ?? dashboardPalette.cyan}))
    .sort((a,b) => Object.keys(openingColors).indexOf(a.label) - Object.keys(openingColors).indexOf(b.label))
})
const donut = computed(() => {
  const total = venueGroups.value.reduce((sum, item) => sum + (item.value ?? 0), 0)
  if (!total) return 'var(--v14-chart-track, var(--v14-edge))'
  let end = 0
  const stops = venueGroups.value.filter(item => item.value).map(item => {
    const start = end
    end += (item.value ?? 0) / total * 100
    return item.color + ' ' + start + '% ' + end + '%'
  })
  return 'conic-gradient(' + stops.join(', ') + ')'
})
function commerceMetric(id:string,label:string,icon:string,key:string,measure:string):Metric|undefined {
  const records = data.value.get(id)
  if (!records) return
  const rows = records.filter(row => props.region === '京山市' || row.region === props.region)
  const value = sum(rows,key)
  const note = value === undefined ? measure + '待补' : measure + ' ' + text(value)
  return {label,icon,value:rows.length,unit:'条',note,title:'来源于商务局填报台账。'}
}
const supportMetrics = computed<Metric[]>(() => [
  commerceMetric('commerce_food','餐饮服务（吃）','private','seats','餐位') ??
    { label: '餐饮服务（吃）', value: demo(countBy('merchants', 'category', ['餐饮']), 486), unit: '家', icon: 'private', note: '座位 ' + text(demo(total('food', 'seats'), 18400)) },
  commerceMetric('commerce_hotels','住宿服务（住）','lodging','beds','床位') ??
    { label: '住宿服务（住）', value: demo(countBy('merchants', 'category', ['酒店民宿']), 167), unit: '家', icon: 'lodging', note: '床位 ' + text(demo(total('hotels', 'beds'), 9400)) },
  { label: '停车服务（行）', value: demo(count('parking'), 56), unit: '处', icon: 'parking', note: '泊位 ' + text(demo(total('parking', 'spaces'), 7840)) },
  { label: '景区游览（游）', value: demo(count('tourism'), 24), unit: '处', icon: 'travel', note: sourceNote('tourism', 'capacity', '日承载', 32800) },
  { label: '购物消费（购）', value: demo(countBy('merchants', 'category', ['购物']), 93), unit: '家', icon: 'private' },
  { label: '休闲娱乐（娱）', value: demo(count('entertainment'), 67), unit: '家', icon: 'club' },
  { label: props.datasets.some(item => item.id === 'schools' && item.source) ? '学校（学）' : '校园网球（学）', value: demo(count('schools'), 64), unit: '所', icon: 'school', note: sourceNote('schools', 'coaches', '网球教练', 138) },
  { label: '网球培训（训）', value: demo(count('training'), 28), unit: '处', icon: 'training', note: '陪练 ' + text(demo(total('training', 'sparringPartners'), 86)) },
])

function moveTab(event: KeyboardEvent, tabs: string[], current: number, select: (index: number) => void) {
  const indexes: Record<string, number> = {
    ArrowLeft: (current + tabs.length - 1) % tabs.length,
    ArrowRight: (current + 1) % tabs.length,
    Home: 0,
    End: tabs.length - 1,
  }
  const next = indexes[event.key]
  if (next === undefined) return
  event.preventDefault()
  select(next)
  const tab = event.currentTarget as HTMLElement
  tab.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
}
</script>

<template>
  <aside class="v14-overview-rail v14-inventory-rail left-panel" aria-label="京山网旅资源家底">
    <section class="v14-overview-module"
      :class="{ 'v14-industry-overview': industryTab === 0, 'v14-industry-primary': industryTab === 1 }">
      <header class="v14-overview-heading"><h2>产业家底</h2></header>
      <div class="v14-overview-content v14-inventory-body">
        <div class="v14-inventory-tabs" role="tablist" aria-label="产业分类">
          <button v-for="(label, index) in industryTabs" :id="'v14-industry-tab-' + index" :key="label"
            type="button" role="tab" aria-controls="v14-industry-content" :aria-selected="industryTab === index"
            :tabindex="industryTab === index ? 0 : -1" @click="industryTab = index"
            @keydown="moveTab($event, industryTabs, index, value => { industryTab = value })">{{ label }}</button>
        </div>
        <div id="v14-industry-content" class="v14-inventory-content" :class="'v14-tier-' + industryTab"
          role="tabpanel" :aria-labelledby="'v14-industry-tab-' + industryTab">
          <template v-if="industryTab === 0">
            <div class="v14-inventory-grid v14-industry-kpis">
              <div v-for="metric in overviewMetrics" :key="metric.label" class="v14-inventory-tile">
                <b class="v14-inventory-card-label">{{ metric.label }}</b>
                <svg v-if="metric.icon === 'chart'" class="v14-inventory-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="4" y="4" width="16" height="16" rx="1" /><path d="M8 16v-3m4 3V9m4 7v-5" />
                </svg>
                <OverviewPanelIcon v-else-if="metric.icon" :name="metric.icon" />
                <span class="v14-inventory-tile-copy">
                  <span><strong>{{ text(metric.value) }}</strong><small>{{ metric.unit }}</small></span>
                </span>
              </div>
            </div>
            <div class="v14-inventory-tile v14-tier-strip">
              <ul class="v14-tier-legend" aria-label="产业链上中下游主体数">
                <li v-for="item in tierMetrics" :key="item.label"><span>{{ item.label }}</span> <span><strong>{{ text(item.value) }}</strong><small>家</small></span></li>
              </ul>
              <div class="v14-tier-track" aria-hidden="true">
                <i v-for="item in tierMetrics.filter(item => item.value)" :key="item.label" :style="{ flexGrow: item.value, background: item.color }"></i>
              </div>
            </div>
            <div class="v14-inventory-tile v14-industry-note">
              <svg class="v14-inventory-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="1" /><path d="M8 16v-3m4 3V9m4 7v-5" />
              </svg>
              <span>近一年新增 <strong>{{ text(recentBusinesses) }}</strong><small>家</small></span>
            </div>
          </template>
          <div v-else-if="industryTab === 1" class="v14-inventory-grid v14-primary-kpis">
            <div v-for="metric in upstreamMetrics" :key="metric.label" class="v14-inventory-tile">
              <b class="v14-inventory-card-label">{{ metric.label }}</b>
              <OverviewPanelIcon v-if="metric.icon" :name="metric.icon" />
              <span class="v14-inventory-tile-copy">
                <span><strong>{{ text(metric.value) }}</strong><small>{{ metric.unit }}</small></span>
                <small v-if="metric.note" class="v14-inventory-note">{{ metric.note }}</small>
              </span>
            </div>
          </div>
          <template v-else-if="activeStage">
            <div class="v14-inventory-tile v14-industry-note v14-stage-summary">
              <OverviewPanelIcon name="state" />
              <div class="v14-stage-figures">
                <span>共计 <strong>{{ text(activeStage.value) }}</strong><small>家</small>，</span>
                <span :title="stageOutputWan !== null ? annualOutput.year + ' 年' + (annualOutput.basis === 'estimate' ? '估算产值' : '产值') : undefined">年产值
                  <template v-if="stageOutputWan !== null"><strong>{{ stageOutputWan }}</strong><small>万元</small></template>
                  <small v-else>待补录</small>
                </span>
              </div>
            </div>
            <ul class="v14-inventory-tile v14-tier-breakdown" :aria-label="industryTabs[industryTab] + '主体分类'">
              <li v-for="item in activeStage.topics" :key="item.label">
                <span>{{ item.label }}</span>
                <span class="v14-detail-track" aria-hidden="true"><i :style="{ width: (item.value ?? 0) / detailMax * 100 + '%' }"></i></span>
                <span><strong>{{ text(item.value) }}</strong><small>家</small></span>
              </li>
            </ul>
            <div class="v14-inventory-tile v14-industry-note">
              <span class="v14-inventory-native-icon" aria-hidden="true"></span>
              <span>多环节主体 <strong>{{ text(activeStage.multiTopic) }}</strong><small>家</small></span>
            </div>
          </template>
        </div>
      </div>
    </section>
    <section class="v14-overview-module">
      <header class="v14-overview-heading"><h2>场地家底</h2></header>
      <div class="v14-overview-content v14-inventory-body">
        <div class="v14-inventory-grid v14-venue-kpis">
          <div v-for="metric in venueMetrics" :key="metric.label" class="v14-inventory-tile">
            <OverviewPanelIcon v-if="metric.icon" :name="metric.icon" />
            <span class="v14-inventory-tile-copy"><b>{{ metric.label }}</b>
              <span><strong>{{ text(metric.value) }}</strong><small>{{ metric.unit }}</small></span>
            </span>
          </div>
        </div>
        <div class="v14-inventory-tabs" role="tablist" aria-label="场地统计口径">
          <button v-for="(label, index) in venueTabs" :id="'v14-venue-tab-' + index" :key="label"
            type="button" role="tab" aria-controls="v14-venue-content" :aria-selected="venueTab === index"
            :tabindex="venueTab === index ? 0 : -1" @click="venueTab = index"
            @keydown="moveTab($event, venueTabs, index, value => { venueTab = value })">{{ label }}</button>
        </div>
        <div id="v14-venue-content" class="v14-inventory-tile v14-venue-distribution" role="tabpanel" :aria-labelledby="'v14-venue-tab-' + venueTab">
          <div class="v14-venue-donut" :style="{ '--v14-donut': donut }" :aria-label="'网球场地合计 ' + text(inventory.courts) + ' 片'" role="img">
            <strong aria-hidden="true">{{ text(inventory.courts) }}</strong>
          </div>
          <ul class="v14-venue-legend">
            <li v-for="item in venueGroups" :key="item.label">
              <i :style="{ background: item.color }" aria-hidden="true"></i><b>{{ item.label }}</b>
              <span><strong>{{ text(item.value) }}</strong><small v-if="item.value !== undefined">片</small></span>
            </li>
          </ul>
        </div>
        <div class="v14-inventory-tile v14-industry-note">
          <OverviewPanelIcon name="venue" />
          <span class="v14-event-courts"><small v-if="region !== '京山市'">全市</small><span><strong>29</strong> 片可承办国际级赛事</span><span><strong>50</strong> 片可承办国家级赛事</span></span>
        </div>
      </div>
    </section>
    <section class="v14-overview-module">
      <header class="v14-overview-heading"><h2>配套家底</h2></header>
      <div class="v14-overview-content v14-inventory-grid v14-support-kpis">
        <div v-for="metric in supportMetrics" :key="metric.label" class="v14-inventory-tile" :title="metric.title">
          <span class="v14-support-caption">
            <OverviewPanelIcon v-if="metric.icon" :name="metric.icon" />
            <b>{{ metric.label }}</b>
          </span>
          <span class="v14-support-value">
            <span><strong>{{ text(metric.value) }}</strong><small>{{ metric.unit }}</small></span>
            <small v-if="metric.note" class="v14-inventory-note">· {{ metric.note }}</small>
          </span>
        </div>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.v14-inventory-rail { min-inline-size: min-content; font-size: 16px; white-space: nowrap; }
.v14-inventory-rail .v14-overview-module { min-inline-size: min-content; }
.v14-inventory-rail h2 { margin: 0; }
.v14-inventory-body, .v14-inventory-content {
  display: grid;
  gap: calc(10 * var(--v14-rail-unit));
  min-width: 0;
  min-height: 0;
}
.v14-inventory-body { grid-template-rows: auto minmax(0, 1fr); }
.v14-overview-module:nth-child(2) .v14-inventory-body {
  grid-template-rows: minmax(calc(74 * var(--v14-rail-unit)), auto) auto minmax(calc(118 * var(--v14-rail-unit)), 1fr) auto;
}
.v14-inventory-content.v14-tier-0 {
  grid-template-rows: minmax(calc(74 * var(--v14-rail-unit)),auto) minmax(calc(60 * var(--v14-rail-unit)),auto) auto;
  align-content: start;
}
.v14-inventory-content.v14-tier-1 { grid-template-rows: auto; }
.v14-inventory-content:is(.v14-tier-2,.v14-tier-3) { grid-template-rows: auto minmax(0, 1fr) auto; }
.v14-inventory-tabs, .v14-inventory-grid {
  display: grid;
  min-width: 0;
  min-height: 0;
}
.v14-inventory-tabs {
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: calc(8 * var(--v14-rail-unit));
}
.v14-inventory-rail .v14-inventory-tabs button[role="tab"] {
  min-width: 0;
  min-height: calc(38 * var(--v14-rail-unit));
  padding: 0 calc(6 * var(--v14-rail-unit));
  border: 1px solid var(--v14-edge);
  background: var(--v14-tab);
  color: var(--v14-ink);
  font: 700 18px/1.35 var(--v14-font, "Microsoft YaHei", sans-serif);
  white-space: nowrap;
}
.v14-inventory-rail .v14-inventory-tabs button[role="tab"]:hover:not([aria-selected="true"]) { color: var(--v14-metric); }
.v14-inventory-rail .v14-inventory-tabs button[aria-selected="true"] {
  background: var(--v14-tab-active);
  color: #f9fcff;
  box-shadow: inset 0 -2px #ffae00;
}
.v14-inventory-grid {
  grid-template-columns: repeat(2,minmax(0,1fr));
  gap: calc(12 * var(--v14-rail-unit));
}
.v14-primary-kpis {
  grid-auto-rows: minmax(calc(82 * var(--v14-rail-unit)),auto);
}
.v14-support-kpis {
  min-inline-size: min-content;
  grid-template-columns: repeat(2, minmax(max-content, 1fr));
  grid-auto-rows: minmax(calc(74 * var(--v14-rail-unit)), auto);
}
.v14-inventory-tile {
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: 0;
  gap: calc(10 * var(--v14-rail-unit));
  padding: calc(6 * var(--v14-rail-unit)) calc(10 * var(--v14-rail-unit));
  color: var(--v14-ink);
  background: var(--v14-list);
  border: 1px solid var(--v14-edge);
  font: 400 16px/1.35 var(--v14-font, "Microsoft YaHei", sans-serif);
}
.v14-inventory-tile :deep(.overview-panel-icon), .v14-inventory-icon, .v14-inventory-native-icon {
  width: calc(38 * var(--v14-rail-unit));
  height: calc(38 * var(--v14-rail-unit));
  flex: none;
  color: var(--v14-icon);
}
:is(.v14-industry-kpis,.v14-venue-kpis) .v14-inventory-tile {
  gap: calc(8 * var(--v14-rail-unit));
  padding-inline: calc(8 * var(--v14-rail-unit));
}
:is(.v14-industry-kpis,.v14-venue-kpis) :is(.v14-inventory-icon, :deep(.overview-panel-icon)) {
  width: calc(46 * var(--v14-rail-unit));
  height: calc(46 * var(--v14-rail-unit));
}
:is(.v14-industry-kpis,.v14-primary-kpis) .v14-inventory-tile {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-content: center;
  column-gap: calc(6 * var(--v14-rail-unit));
  row-gap: calc(2 * var(--v14-rail-unit));
}
:is(.v14-industry-kpis,.v14-primary-kpis) .v14-inventory-card-label { grid-column: 1 / -1; }
:is(.v14-industry-kpis,.v14-primary-kpis) .v14-inventory-tile-copy { grid-area: 2 / 1; }
:is(.v14-industry-kpis,.v14-primary-kpis) :is(.v14-inventory-icon, :deep(.overview-panel-icon)) {
  grid-area: 2 / 2;
  max-width: 100%;
  justify-self: end;
}
.v14-inventory-native-icon {
  background-color: var(--v14-icon);
  mask: url('/jingshan/ui/layers.svg') center / 100% no-repeat;
}
.v14-inventory-tile-copy {
  display: grid;
  min-width: 0;
  gap: calc(3 * var(--v14-rail-unit));
  line-height: 1.35;
}
.v14-inventory-tile-copy > span, .v14-support-value > span, .v14-tier-legend li > span { white-space: nowrap; }
.v14-inventory-tile-copy b, .v14-venue-legend b, .v14-industry-note {
  font-weight: 700;
}
.v14-inventory-tile strong {
  color: var(--v14-metric);
  font: 400 24px/1 "Cockpit Bebas", "Arial Narrow", sans-serif;
  white-space: nowrap;
}
.v14-inventory-tile small {
  font: 400 16px/1.2 var(--v14-font, "Microsoft YaHei", sans-serif);
  white-space: nowrap;
}
.v14-inventory-tile .v14-inventory-note {
  color: var(--v14-muted);
  line-height: 1.2;
}
.v14-industry-note { min-height: calc(40 * var(--v14-rail-unit)); }
.v14-event-courts { display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 12px; }
.v14-event-courts > span { white-space:nowrap; }
.v14-stage-figures { display: flex; flex-wrap: wrap; align-items: baseline; min-width: 0; }
.v14-stage-figures > span { white-space: nowrap; }
.v14-industry-note :deep(.overview-panel-icon), .v14-industry-note :is(.v14-inventory-icon,.v14-inventory-native-icon) {
  width: calc(30 * var(--v14-rail-unit));
  height: calc(30 * var(--v14-rail-unit));
}
.v14-tier-strip { display: grid; place-content: center stretch; gap: calc(8 * var(--v14-rail-unit)); }
.v14-tier-legend, .v14-tier-breakdown, .v14-venue-legend { list-style: none; margin: 0; }
.v14-tier-legend, .v14-tier-legend li {
  display: flex;
  align-items: baseline;
  column-gap: 4px;
}
.v14-tier-legend {
  justify-content: space-between;
  font-weight: 700;
  padding: 0;
}
.v14-tier-track, .v14-detail-track {
  display: flex;
  overflow: hidden;
  height: calc(10 * var(--v14-rail-unit));
  border-radius: 999px;
  background: var(--v14-chart-track, var(--v14-edge));
}
.v14-tier-track i, .v14-detail-track i { display: block; }
.v14-tier-track i + i { border-left: 1px solid #f9fcff; }
.v14-tier-breakdown {
  display: grid;
  align-content: space-evenly;
  gap: 0;
  line-height: 1;
  font-weight: 700;
}
.v14-tier-breakdown li {
  display: grid;
  grid-template-columns: max-content minmax(0,1fr) max-content;
  align-items: center;
  gap: calc(10 * var(--v14-rail-unit));
  white-space: nowrap;
}
.v14-tier-breakdown li > span:first-child { width: 6em; }
.v14-tier-breakdown li > span:last-child { text-align: right; }
.v14-detail-track i { background: linear-gradient(90deg, #20b0f3, #2371f7); border-radius: inherit; }
.v14-support-kpis .v14-inventory-tile { gap: calc(8 * var(--v14-rail-unit)); }
.v14-inventory-estimate { margin-inline-start: auto; margin-inline-end: calc(10 * var(--v14-rail-unit)); color: var(--v14-muted); font: 400 14px/1.25 var(--v14-font, "Microsoft YaHei", sans-serif); }
.v14-venue-distribution { display: grid; grid-template-columns: minmax(0,1fr) minmax(max-content,1.18fr); }
.v14-venue-donut {
  position: relative;
  display: grid;
  place-items: center;
  justify-self: center;
  width: min(calc(112 * var(--v14-rail-unit)), 90%);
  aspect-ratio: 1;
  border-radius: 50%;
}
.v14-venue-donut::before {
  position: absolute;
  content: "";
  inset: 0;
  background: var(--v14-donut);
  border-radius: 50%;
  mask: radial-gradient(transparent 51%, #000 52%);
}
.v14-venue-legend { display: grid; gap: calc(5 * var(--v14-rail-unit)); padding: 0 calc(4 * var(--v14-rail-unit)); }
.v14-venue-legend li { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: calc(10 * var(--v14-rail-unit)); line-height: 1.25; }
.v14-venue-legend i { width: calc(10 * var(--v14-rail-unit)); height: calc(10 * var(--v14-rail-unit)); }
.v14-venue-legend li > span { white-space: nowrap; }
.v14-venue-legend b { white-space: nowrap; }
.v14-support-kpis .v14-inventory-tile {
  display: grid;
  grid-template-columns: auto;
  align-content: center;
  gap: calc(4 * var(--v14-rail-unit));
}
.v14-support-caption, .v14-support-value {
  display: flex;
  align-items: center;
  gap: calc(4 * var(--v14-rail-unit));
}
.v14-support-caption :deep(.overview-panel-icon) {
  width: calc(24 * var(--v14-rail-unit));
  height: calc(24 * var(--v14-rail-unit));
}
.v14-support-value { align-items: baseline; }

@container (max-width: 400px) {
  .v14-support-kpis {
    grid-auto-rows: minmax(calc(74 * var(--v14-rail-unit)), 1fr);
  }
  .v14-support-kpis .v14-inventory-tile { padding-inline: calc(6 * var(--v14-rail-unit)); }
}
@container (max-width: 360px) {
  .v14-stage-summary :deep(.overview-panel-icon) { display: none; }
  .v14-support-kpis { padding-inline: 2px; column-gap: 4px; }
  .v14-support-kpis .v14-inventory-tile { padding-inline: 2px; }
  .v14-support-value, .v14-support-caption { column-gap: 2px; }
}
@container (max-width: 275px) {
  .v14-inventory-tabs { gap: 4px; }
  .v14-inventory-rail .v14-inventory-tabs button[role="tab"] { padding-inline: 0; }
  .v14-tier-strip { padding-inline: calc(6 * var(--v14-rail-unit)); }
  .v14-industry-note {
    gap: calc(6 * var(--v14-rail-unit));
    padding-inline: calc(8 * var(--v14-rail-unit));
  }
  .v14-venue-distribution { grid-template-columns: minmax(44px,.75fr) minmax(0,1.8fr); }
  .v14-venue-legend li { grid-template-columns: auto minmax(0,1fr) max-content; gap: 4px; }
}

@media (max-width: 960px) {
  .v14-overview-module:first-child:not(.v14-industry-overview,.v14-industry-primary) .v14-inventory-body {
    min-height: calc(300 * var(--v14-rail-unit));
  }
}
</style>
