<script setup lang="ts">
import { computed } from 'vue'
import { eventPlanDatasetId, publishedCompetitions, upcomingCompetitions } from './event-platform-data.ts'
import type { CityFeature, Dataset } from './types.ts'
import type { V3Page } from './v3-navigation.ts'

type RecordProperties = CityFeature['properties']

const props = defineProps<{
  datasets: Dataset[]
  today: string
  demo?: boolean
  coverageRate?: number
  expandedCoverageRate?: number
  parkingRate?: number
}>()
const emit = defineEmits<{
  navigate: [page: V3Page]
  selectEvent: [planId: string]
}>()

const datasets = computed(() => new Map(props.datasets.map(dataset => [dataset.id, dataset.features])))
const properties = (id: string) => datasets.value.get(id)?.map(feature => feature.properties)
const numerical = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
const valueOrSample = (actual: number | undefined, sample: number) => actual ?? (props.demo ? sample : undefined)
const display = (value?: number) => value === undefined ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const percent = (value?: number) => value === undefined ? '—' : display(value) + '%'
const inTenThousands = (value?: number) => value === undefined ? undefined : Math.round(value / 100) / 100
const ratio = (numerator?: number, denominator?: number) =>
  numerator !== undefined && denominator ? Math.round(numerator * 1000 / denominator) / 10 : undefined
function sum(rows: RecordProperties[] | undefined, key: string) {
  const values = rows?.map(row => numerical(row[key])).filter(value => value !== undefined)
  return values?.length ? values.reduce((total, value) => total + value, 0) : undefined
}

const supportRates = computed(() => {
  const hotspots = properties('investment_hotspots')
  const rate = (key: string) => ratio(sum(hotspots, key + 'Supply'), sum(hotspots, key + 'Demand'))
  return [
    { label: '住宿', value: valueOrSample(rate('lodging'), 92) },
    { label: '餐饮', value: valueOrSample(rate('dining'), 100) },
    { label: '停车', value: valueOrSample(props.parkingRate ?? rate('parking'), 78), warning: true },
  ]
})
const investmentStages = computed(() => {
  const needs = properties('investment_needs')
  return [
    { label: '已推送', matcher: /已推送|已接收|已对接|已签约|已落地/, sample: 12, color: 'cyan' },
    { label: '已对接', matcher: /已对接|已签约|已落地/, sample: 7, color: 'blue' },
    { label: '已签约', matcher: /已签约|已落地/, sample: 4, color: 'purple' },
    { label: '已落地', matcher: /已落地/, sample: 2, color: 'green' },
  ].map(stage => ({
    ...stage,
    count: valueOrSample(needs?.filter(item => stage.matcher.test(String(item.status ?? ''))).length, stage.sample),
  }))
})

const currentYear = computed(() => props.today.slice(0,4))
const hasPublishedCalendar = computed(() => datasets.value.has(eventPlanDatasetId))
const competitions = computed(() => publishedCompetitions(props.datasets))
const annualCompetitions = computed(() => competitions.value.filter(event => event.year === Number(currentYear.value)))
const upcoming = computed(() => upcomingCompetitions(competitions.value,props.today).slice(0,2).map(event => ({
  id:event.id, name:event.name, schedule:event.dateText,
  date:event.startDate?.startsWith(currentYear.value+'-') ? event.startDate.slice(5).replace('-','/') : event.startDate ?? event.dateText,
})))
const cancelled = new Set(['已取消', '取消'])
const validDate = /^\d{4}-\d{2}-\d{2}$/
const dateOf = (row: RecordProperties) => String(row.date ?? '')
const eventFeatures = computed(() => datasets.value.get('events')?.filter(({ properties: row }) =>
  !cancelled.has(String(row.status)) && validDate.test(dateOf(row))))
const events = computed(() => eventFeatures.value?.map(feature => feature.properties))
const annualEvents = computed(() => events.value?.filter(row => dateOf(row).startsWith(currentYear.value + '-')))
const finished = computed(() => annualEvents.value?.filter(row => row.status === '已办结'))
const attendees = computed(() => sum(finished.value, 'attendance'))
const visitors = computed(() => sum(finished.value, 'visitors'))
const eventMetrics = computed(() => [
  { label: '年度办赛', value: display(hasPublishedCalendar.value ? annualCompetitions.value.length : undefined), unit: '场', icon: 'trophy' },
  { label: '参赛观赛', value: display(valueOrSample(inTenThousands(attendees.value), 18.6)), unit: '万人次', icon: 'users' },
  { label: '外地占比', value: percent(valueOrSample(ratio(visitors.value, attendees.value), 42.8)), unit: '', icon: 'bar' },
])
const levelColors: Record<string,string> = { 国际:'yellow', 全国:'purple', 省级:'blue', 群众:'cyan' }
const levelCounts = computed(() => {
  const counts = new Map(Object.keys(levelColors).map(label => [label,0]))
  for (const event of annualCompetitions.value) {
    const base = event.level.split(/[（(]/,1)[0]?.trim()
    const label = base && base !== '无' ? base : '未注明'
    counts.set(label,(counts.get(label) ?? 0)+1)
  }
  return [...counts].map(([label,count]) => ({label,count,color:levelColors[label] ?? 'muted'}))
})
const latestSpend = computed(() => {
  const rows = finished.value?.filter(row => numerical(row.spend) !== undefined)
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a))).slice(0, 5).reverse()
  if (rows?.length) return rows.map(row => ({ label: row.name, value: numerical(row.spend)! }))
  return props.demo ? [328, 556, 286, 618, 412].map((value, index) => ({ label: '赛事 ' + (index + 1), value })) : []
})
const peakSpend = computed(() => Math.max(0, ...latestSpend.value.map(row => row.value)))
const annualSpend = computed(() => valueOrSample(sum(finished.value, 'spend'), 2200))
const lodgingNights = computed(() => valueOrSample(sum(finished.value, 'nights'), 15370))

const averageStay = computed(() => {
  const observations = finished.value?.flatMap(row => {
    const weight = numerical(row.visitors)
    const days = numerical(row.stayDays)
    return weight && days !== undefined ? [{ weight, days }] : []
  }) ?? []
  const visitorsWithStay = observations.reduce((total, row) => total + row.weight, 0)
  if (!visitorsWithStay) return undefined
  return Math.round(observations.reduce((total, row) => total + row.weight * row.days, 0) * 10 / visitorsWithStay) / 10
})
const fusionMetrics = computed(() => [
  { label: '外地来客', value: display(valueOrSample(inTenThousands(visitors.value), 7.96)), unit: '万人次', icon: 'users' },
  { label: '平均停留', value: display(valueOrSample(averageStay.value, 2.4)), unit: '天', icon: 'clock' },
  { label: '赛后游览转化率', value: percent(valueOrSample(ratio(sum(finished.value, 'scenicVisitors'), attendees.value), 36.8)), unit: '', icon: 'trend' },
])
const originCities = computed(() => {
  const rows = properties('origins')
  const origins = new Map<string, number>()
  const completedIds = new Set(datasets.value.get('events')?.filter(feature =>
    feature.properties.status === '已办结' && dateOf(feature.properties).startsWith(currentYear.value + '-')).map(feature => feature.id))
  let total = 0
  for (const row of rows ?? []) {
    if (typeof row.eventId === 'string' && !completedIds.has(row.eventId)) continue
    const city = typeof row.from === 'string' ? row.from.trim() : ''
    const people = numerical(row.people)
    if (!city || people === undefined) continue
    total += people
    if (!['其他', '省内', '省外', '境外', '外省', '本地'].includes(city)) origins.set(city, (origins.get(city) ?? 0) + people)
  }
  if (total) return [...origins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, people]) => ({ name, share: Math.round(people * 100 / total) }))
  return props.demo ? [
    { name: '武汉', share: 25 }, { name: '荆门', share: 17 }, { name: '孝感', share: 13 },
    { name: '随州', share: 9 }, { name: '襄阳', share: 7 },
  ] : []
})
function annualOrders(route: RecordProperties) {
  const months = route.ordersByMonth
  if (months && typeof months === 'object' && !Array.isArray(months)) {
    const values = Object.entries(months).filter(([month]) => month.startsWith(currentYear.value + '-'))
      .map(([, count]) => numerical(count)).filter(value => value !== undefined)
    return values.length ? values.reduce((total, value) => total + value, 0) : undefined
  }
  return numerical(route.orders)
}
const topRoutes = computed(() => {
  const routes = properties('route_packages')?.filter(route => route.status === '已上架').flatMap(route => {
    const orders = annualOrders(route)
    return orders === undefined ? [] : [{ name: route.name, orders }]
  }).sort((a, b) => b.orders - a.orders).slice(0, 3)
  if (routes?.length) return routes
  return props.demo ? [
    { name: '城区网球 · 京山温泉', orders: 1286 },
    { name: '网球体验 · 绿林山水', orders: 968 },
    { name: '赛后游荆门', orders: 742 },
  ] : []
})
const iconPaths: Record<string, string> = {
  layers: 'M12 2.5 2 8l10 5.5L22 8 12 2.5ZM2 12l10 5.5L22 12M2 16l10 5.5L22 16',
  trophy: 'M7 4h10v6a5 5 0 0 1-10 0Zm0 2H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4m-5 3v5m-4 0h8',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M15 4.1a4 4 0 0 1 0 7.8m-2-3.9a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  bar: 'M3 21h18M5 17v-6m5 6V7m5 10V3m5 14V9',
  economy: 'M19 6c0 1.65-3.13 3-7 3S5 7.65 5 6s3.13-3 7-3 7 1.35 7 3ZM5 6v6c0 1.65 3.13 3 7 3s7-1.35 7-3V6M5 12v6c0 1.65 3.13 3 7 3s7-1.35 7-3v-6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
  trend: 'M3 21h18M5 17v-3m5 3v-6m5 6v-4m5 4V7M4 10l6-5 5 2 5-4m-4 0h4v4',
}
</script>

<template>
  <aside class="v14-overview-rail right-panel analysis-rail" aria-label="网旅分析">
    <section class="v14-overview-module">
      <header class="v14-overview-heading"><h2>产业分析</h2></header>
      <div class="v14-overview-content analysis-content industry-content">
        <button type="button" class="analysis-surface coverage-tile" title="对比当前开放场地与学校、机关场地错时开放情景下的服务人口覆盖率" @click="emit('navigate', 'venues')">
          <svg class="analysis-icon coverage-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="iconPaths.layers" /></svg>
          <span><b>场地服务覆盖率</b><strong>{{ percent(coverageRate) }}</strong></span>
          <span><b>错时开放后</b><strong class="success-value">{{ percent(expandedCoverageRate) }}</strong></span>
        </button>
        <div class="analysis-surface supply-rates">
          <div v-for="item in supportRates" :key="item.label" class="supply-rate" :class="{ 'rate-warning': item.warning }">
            <span>{{ item.label }}</span>
            <span class="analysis-track" aria-hidden="true">
              <i :style="{ width: Math.min(100, item.value ?? 0) + '%' }"></i>
            </span>
            <strong>{{ percent(item.value) }}</strong>
          </div>
        </div>
        <button type="button" class="analysis-surface investment-progress" @click="emit('navigate', 'investment')">
          <b>招商进展</b>
          <span class="analysis-key">
            <span v-for="item in investmentStages" :key="item.label">
              <i :class="'swatch-' + item.color" aria-hidden="true"></i>{{ item.label }} <strong>{{ display(item.count) }}</strong>
            </span>
          </span>
        </button>
      </div>
    </section>

    <section class="v14-overview-module">
      <header class="v14-overview-heading"><h2>赛事引流</h2></header>
      <div class="v14-overview-content analysis-content event-content">
        <div class="analysis-metrics">
          <button v-for="metric in eventMetrics" :key="metric.label" type="button" class="analysis-surface metric-tile"
            @click="emit('navigate', 'events')">
            <svg class="analysis-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="iconPaths[metric.icon]" /></svg>
            <span><b>{{ metric.label }}</b><span class="metric-value"><strong>{{ metric.value }}</strong><small v-if="metric.unit">{{ metric.unit }}</small></span></span>
          </button>
        </div>
        <div class="analysis-surface event-levels">
          <div class="analysis-track level-track" aria-hidden="true">
            <i v-for="item in levelCounts" :key="item.label" :class="'swatch-' + item.color"
              :style="{ flexGrow: item.count }"></i>
          </div>
          <div class="analysis-key">
            <span v-for="item in levelCounts" :key="item.label">
              <i :class="'swatch-' + item.color" aria-hidden="true"></i>{{ item.label }} <span class="level-count"><strong>{{ display(hasPublishedCalendar ? item.count : undefined) }}</strong>场</span>
            </span>
          </div>
        </div>
        <div class="analysis-surface recent-block">
          <h3>即将开展</h3>
          <div v-if="upcoming.length" class="recent-events">
            <button v-for="item in upcoming" :key="item.id" type="button" class="analysis-row event-row"
              :aria-label="item.schedule + ' ' + item.name" @click="emit('selectEvent',item.id)">
              <strong :title="item.schedule">{{ item.date }}</strong><span class="analysis-name" :title="item.name">{{ item.name }}</span>
              <small class="status-label">待开赛</small>
            </button>
          </div>
          <p v-else class="missing-list">暂无待开赛赛事</p>
        </div>
        <div class="analysis-surface event-spend">
          <h3>近 5 场赛事带动消费</h3>
          <ul v-if="latestSpend.length" class="spend-columns" aria-label="消费额，万元">
            <li v-for="item in latestSpend" :key="item.label" :class="{ 'spend-peak': peakSpend > 0 && item.value === peakSpend }"
              :title="item.label + ' ' + display(item.value) + ' 万元'">
              <strong>{{ display(item.value) }}</strong>
              <i :style="{ height: (peakSpend ? item.value * 100 / peakSpend : 0) + '%' }" aria-hidden="true"></i>
            </li>
          </ul>
          <p v-else class="missing-list">暂无数据</p>
        </div>
        <div class="analysis-surface analysis-row event-total">
          <svg class="analysis-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="iconPaths.economy" /></svg>
          <span class="event-total-copy">
            <span>累计消费 <strong>{{ display(annualSpend) }}</strong> 万元</span>
            <span class="event-total-separator" aria-hidden="true">·</span>
            <span>住宿 <strong>{{ display(lodgingNights) }}</strong> 间夜</span>
          </span>
        </div>
      </div>
    </section>

    <section class="v14-overview-module">
      <header class="v14-overview-heading"><h2>融合发展</h2></header>
      <div class="v14-overview-content analysis-content fusion-content">
        <div class="analysis-metrics">
          <button v-for="metric in fusionMetrics" :key="metric.label" type="button" class="analysis-surface metric-tile"
            @click="emit('navigate', 'consumption')">
            <svg class="analysis-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="iconPaths[metric.icon]" /></svg>
            <span><b>{{ metric.label }}</b><span class="metric-value"><strong>{{ metric.value }}</strong><small v-if="metric.unit">{{ metric.unit }}</small></span></span>
          </button>
        </div>
        <div class="analysis-surface origin-block">
          <h3>客源城市</h3>
          <div v-if="originCities.length" class="origin-cities">
            <div v-for="item in originCities" :key="item.name" class="origin-city">
              <span class="origin-city-caption">
                <span class="analysis-name" :title="item.name">{{ item.name }}</span><strong>{{ item.share }}%</strong>
              </span>
              <span class="analysis-track" aria-hidden="true"><i :style="{ width: item.share + '%' }"></i></span>
            </div>
          </div>
          <p v-else class="missing-list">暂无数据</p>
        </div>
        <div class="analysis-surface popular-routes">
          <h3>热门网旅线路</h3>
          <button v-for="(item, index) in topRoutes" :key="item.name" type="button" class="analysis-row route-row"
            @click="emit('navigate', 'consumption')">
            <span class="route-index">{{ index + 1 }}</span><span class="analysis-name" :title="item.name">{{ item.name }}</span>
            <strong>{{ display(item.orders) }} 单</strong>
          </button>
          <p v-if="!topRoutes.length" class="missing-list">暂无数据</p>
        </div>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.analysis-rail {
  /* The reference rail has 412px of content inside its scrolling frame. */
  --v14-rail-unit: clamp(.5px, calc(100cqi / 412), 1px);
  min-inline-size: min-content;
  --analysis-cyan: #20b0f3;
  --analysis-blue: #2371f7;
  --analysis-green: #11ca14;
  --analysis-yellow: #ffae00;
  --analysis-orange: #ff7b00;
  --analysis-purple: #a535fa;
  --analysis-bar: linear-gradient(90deg, var(--analysis-cyan), var(--analysis-blue));
  --analysis-icon-size: calc(28 * var(--v14-rail-unit));
}

.analysis-content {
  display: grid;
  min-inline-size: min-content;
  min-height: 0;
  gap: calc(8 * var(--v14-rail-unit));
  color: var(--v14-ink);
  font-size: var(--v14-min-text);
  line-height: 1.35;
  white-space: nowrap;
}
.industry-content {
  grid-template-rows:
    minmax(calc(72 * var(--v14-rail-unit)), 1.3fr)
    minmax(calc(82 * var(--v14-rail-unit)), 1.5fr)
    minmax(calc(56 * var(--v14-rail-unit)), 1fr);
}
.event-content {
  grid-template-rows:
    minmax(min-content, 1.4fr)
    minmax(min-content, .85fr)
    minmax(min-content, 2fr)
    minmax(calc(88 * var(--v14-rail-unit)), 1.7fr)
    minmax(min-content, .7fr);
}
.fusion-content {
  grid-template-rows:
    minmax(min-content, 1fr)
    minmax(min-content, 1.05fr)
    minmax(calc(150 * var(--v14-rail-unit)), 2.1fr);
}

.analysis-surface {
  min-height: 0;
  min-inline-size: min-content;
  color: inherit;
  border: 1px solid var(--v14-edge);
  background: var(--v14-list);
}
.analysis-rail > .v14-overview-module { min-inline-size: min-content; }
button.analysis-surface, .analysis-row {
  text-align: left;
}
button.analysis-surface:is(:hover, :focus-visible), button.analysis-row:is(:hover, :focus-visible) {
  border-color: var(--v14-metric);
  background: var(--v14-tab);
}
.analysis-content strong { color: var(--v14-metric); font-variant-numeric: tabular-nums; }
.analysis-content h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}
.analysis-icon {
  width: var(--analysis-icon-size);
  height: var(--analysis-icon-size);
  flex: none;
  color: var(--v14-icon);
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.coverage-tile {
  display: grid;
  grid-template-columns: auto repeat(2, minmax(max-content, 1fr));
  align-items: center;
  padding: calc(8 * var(--v14-rail-unit)) calc(12 * var(--v14-rail-unit));
  gap: calc(10 * var(--v14-rail-unit));
}
.coverage-tile .coverage-icon { --analysis-icon-size: calc(36 * var(--v14-rail-unit)); }
.coverage-tile > span { min-width: 0; }
.coverage-tile > span:last-child { padding-left: calc(10 * var(--v14-rail-unit)); border-left: 1px solid var(--v14-edge); text-align: center; }
.coverage-tile b, .coverage-tile strong { display: block; }
.coverage-tile b { font-size: 18px; }
.coverage-tile strong {
  font: 400 24px/1.3 'Cockpit Bebas', 'Microsoft YaHei', sans-serif;
}
.coverage-tile .success-value { color: var(--analysis-green); }

.supply-rates {
  display: grid;
  grid-template-rows: repeat(3, minmax(0, 1fr));
  gap: calc(4 * var(--v14-rail-unit));
  padding: calc(7 * var(--v14-rail-unit)) calc(12 * var(--v14-rail-unit));
}
.supply-rate {
  display: grid;
  grid-template-columns: max(2em, calc(44 * var(--v14-rail-unit))) minmax(0, 1fr) max-content;
  align-items: center;
  gap: calc(10 * var(--v14-rail-unit));
}
.supply-rate > strong { text-align: right; }
.analysis-track { display: block; height: calc(10 * var(--v14-rail-unit)); overflow: hidden; border-radius: calc(5 * var(--v14-rail-unit)); background: color-mix(in srgb, var(--v14-metric) 21%, transparent); }
.analysis-track > i { display: block; height: 100%; border-radius: inherit; background: var(--analysis-bar); }
.rate-warning .analysis-track > i { background: linear-gradient(90deg, var(--analysis-yellow), var(--analysis-orange)); }
.rate-warning strong { color: var(--analysis-orange); }

.analysis-row { display: flex; align-items: center; gap: calc(8 * var(--v14-rail-unit)); padding: 0 calc(10 * var(--v14-rail-unit)); }
.investment-progress {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: calc(4 * var(--v14-rail-unit));
  padding: calc(6 * var(--v14-rail-unit)) calc(10 * var(--v14-rail-unit));
}
.analysis-key {
  display: grid;
  grid-template-columns: repeat(4, minmax(max-content, 1fr));
  align-items: center;
  gap: calc(6 * var(--v14-rail-unit));
  font-size: var(--v14-min-text);
}
.analysis-key > span { min-width: 0; }
.level-count { white-space: nowrap; }
.analysis-key i {
  display: inline-block;
  width: calc(10 * var(--v14-rail-unit));
  height: calc(10 * var(--v14-rail-unit));
  margin-right: calc(4 * var(--v14-rail-unit));
}
.analysis-key i.swatch-cyan, .level-track i.swatch-cyan { background: var(--analysis-cyan); }
.analysis-key i.swatch-blue, .level-track i.swatch-blue { background: var(--analysis-blue); }
.analysis-key i.swatch-green { background: var(--analysis-green); }
.analysis-key i.swatch-yellow, .level-track i.swatch-yellow { background: var(--analysis-yellow); }
.analysis-key i.swatch-purple, .level-track i.swatch-purple { background: var(--analysis-purple); }
.analysis-key i.swatch-muted, .level-track i.swatch-muted { background: var(--v14-muted); }

.analysis-metrics { display: grid; grid-template-columns: repeat(3, minmax(max-content, 1fr)); gap: calc(8 * var(--v14-rail-unit)); }
.fusion-content .analysis-metrics { grid-template-columns: repeat(2, minmax(max-content, 1fr)) minmax(max-content, 1.1fr); }
.metric-tile {
  display: grid;
  align-content: center;
  justify-items: start;
  gap: calc(4 * var(--v14-rail-unit));
  padding: calc(7 * var(--v14-rail-unit)) calc(6 * var(--v14-rail-unit));
}
.metric-tile > span { min-width: 0; max-width: 100%; }
.metric-tile b { display: block; font-size: var(--v14-min-text); }
.metric-tile .analysis-icon { --analysis-icon-size: calc(22 * var(--v14-rail-unit)); }
.metric-value {
  display: flex;
  align-items: baseline;
  column-gap: calc(4 * var(--v14-rail-unit));
  margin-top: calc(3 * var(--v14-rail-unit));
}
.metric-value strong {
  font: 400 24px/1.12 'Cockpit Bebas', 'Microsoft YaHei', sans-serif;
  white-space: nowrap;
}
.metric-value small { font-size: var(--v14-min-text); }

.event-levels {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: calc(6 * var(--v14-rail-unit));
  padding: calc(6 * var(--v14-rail-unit)) calc(10 * var(--v14-rail-unit));
}
.event-levels .analysis-key {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
}
.analysis-track.level-track { display: flex; gap: 1px; height: calc(8 * var(--v14-rail-unit)); }
.level-track > i { border-radius: 0; }
.recent-block, .event-spend, .origin-block, .popular-routes {
  display: grid;
  gap: calc(6 * var(--v14-rail-unit));
  padding: calc(7 * var(--v14-rail-unit)) calc(10 * var(--v14-rail-unit));
}
.recent-block { grid-template-rows: auto auto; align-content:start; }
.recent-events {
  display:grid;
  grid-auto-rows:max-content;
  gap:calc(4 * var(--v14-rail-unit));
}
.event-row, .route-row {
  background: color-mix(in srgb, var(--v14-list-line, var(--v14-edge)) 25%, transparent);
  border: 1px solid var(--v14-edge);
  min-inline-size: min-content;
  min-height: 0;
  color: inherit;
  font-size: var(--v14-min-text);
  padding: 0 calc(6 * var(--v14-rail-unit));
}
.event-row > strong, .route-index {
  flex: none;
  min-width: calc(43 * var(--v14-rail-unit));
  border-right: 1px solid var(--v14-edge);
  white-space: nowrap;
}
.event-row .analysis-name, .route-row .analysis-name { flex: 1; }
.analysis-name { min-inline-size: max-content; }
.event-row .analysis-name { min-inline-size:0; white-space:normal; overflow-wrap:anywhere; }
.route-row > strong { white-space: nowrap; }
.status-label {
  flex: none;
  padding: 0 calc(4 * var(--v14-rail-unit));
  color: var(--v14-ink);
  background: color-mix(in srgb, var(--analysis-green) 17%, transparent);
  border: 1px solid color-mix(in srgb, var(--analysis-green) 50%, transparent);
  border-radius: calc(2 * var(--v14-rail-unit));
  font-size: var(--v14-min-text);
}
.event-spend { grid-template-rows: auto minmax(0, 1fr); }
.spend-columns { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); align-items: end; gap: calc(16 * var(--v14-rail-unit)); padding: 0 calc(10 * var(--v14-rail-unit)); margin: 0; list-style: none; }
.spend-columns li { display: grid; grid-template-rows: auto minmax(0, 1fr); justify-items: center; align-items: end; height: 100%; }
.spend-columns strong { font-size: var(--v14-min-text); }
.spend-columns i { width: 74%; min-height: 1px; border-radius: calc(3 * var(--v14-rail-unit)) calc(3 * var(--v14-rail-unit)) 0 0; background: linear-gradient(var(--analysis-cyan), var(--analysis-blue)); }
.spend-peak strong { color: var(--analysis-orange); }
.spend-peak i { background: linear-gradient(var(--analysis-yellow), var(--analysis-orange)); }
.event-total { justify-content: center; gap: calc(8 * var(--v14-rail-unit)); min-height: calc(36 * var(--v14-rail-unit)); font-size: var(--v14-min-text); }
.event-total-copy { display: flex; flex-wrap: wrap; gap: calc(4 * var(--v14-rail-unit)); }
.event-total .analysis-icon { --analysis-icon-size: calc(20 * var(--v14-rail-unit)); }
.missing-list { margin: 0; align-self: center; color: var(--v14-muted); }

.origin-block { grid-template-rows: auto minmax(0, 1fr); }
.origin-cities { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(max-content, 1fr); gap: calc(8 * var(--v14-rail-unit)); align-items: center; }
.origin-city { min-width: 0; font-size: var(--v14-min-text); }
.origin-city-caption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  column-gap: calc(4 * var(--v14-rail-unit));
  line-height: 1.22;
}
.origin-city strong { white-space: nowrap; }
.origin-city .analysis-track { height: calc(7 * var(--v14-rail-unit)); margin-top: calc(5 * var(--v14-rail-unit)); }
.popular-routes { grid-template-rows: auto repeat(3, minmax(min-content, 1fr)); }
.route-index { min-width: calc(28 * var(--v14-rail-unit)); text-align: center; font-weight: 700; }

@container (max-width: 400px) {
  .analysis-content { grid-template-rows: none; grid-auto-rows: auto; padding-inline: 5px; }
  .analysis-key { column-gap: 2px; }
  .analysis-key > span { display: flex; align-items: baseline; gap: 1px; }
  .analysis-key i { width: 6px; height: 6px; margin-inline: 0; }
  .event-levels, .investment-progress { padding-inline: 3px; }
  .analysis-metrics { column-gap: 4px; }
  .metric-tile { padding-inline: 3px; }
  .origin-cities, .origin-city-caption { column-gap: 3px; }
  .event-spend { min-height: calc(113 * var(--v14-rail-unit)); }
  .event-total-separator { display: none; }
}
@container (max-width: 380px) {
  .event-row { flex-wrap: wrap; gap: 2px; }
  .event-row .analysis-name { order: 1; flex: 1 0 100%; }
  .event-row .status-label { margin-inline-start: auto; }
}

</style>
