<script setup lang="ts">
import { computed, ref } from 'vue'
import VenueBookingOrigins from './VenueBookingOrigins.vue'
import VenueBookingOverview from './VenueBookingOverview.vue'
import { dashboardPalette } from './dashboard-palette'
import type { BookingSnapshot } from './venue-reservation-data'
import { summarizeVenueReservations } from './venue-reservation-summary'

const props = defineProps<{ history: BookingSnapshot; venueIds: string[] }>()
const emit = defineEmits<{ select: [venueId: string] }>()
const showRegions = ref(false)
const summary = computed(() => summarizeVenueReservations(props.history, props.venueIds))
const percent = (rate: number | null) => rate === null ? '—' : rate.toFixed(1) + '%'
const hours = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const marketColors = [dashboardPalette.blue, dashboardPalette.sky, dashboardPalette.yellow]
const markets = computed(() => summary.value.originShares.map((item, i) => ({
  ...item, color: marketColors[i],
})))
const marketFill = computed(() => {
  let start = 0
  const stops = markets.value.filter(item => item.rate > 0).map(item => {
    const stop = item.color + ' ' + start + '% ' + (start + item.rate) + '%'
    start += item.rate
    return stop
  })
  return stops.length ? 'conic-gradient(' + stops.join(', ') + ')' : 'var(--v14-chart-track)'
})
const headlineRates = computed(() => [
  { name: '整体预订率', metric: summary.value.overall },
  { name: '当日预订率', metric: summary.value.today },
])
</script>

<template>
  <div class="reservation-charts">
    <section class="industry-card reservation-chart" aria-label="可预约场地预订统计">
      <div class="reservation-heading">
        <h3 class="service-section-title">可预约场地预订率</h3>
        <VenueBookingOverview :summary="summary" @select="emit('select', $event)" />
      </div>
      <template v-if="summary.courtCount">
        <p class="chart-note">{{ summary.venues.length }} 处场馆 · {{ summary.courtCount }} 片可预约场地</p>
        <dl class="headline-rates">
          <div v-for="row in headlineRates" :key="row.name"
            :title="'已占用 ' + hours.format(row.metric.occupied) + ' / ' + hours.format(row.metric.capacity) + ' 场地小时'">
            <dt>{{ row.name }}</dt>
            <dd>{{ percent(row.metric.rate) }}
              <i class="rate-track" aria-hidden="true"><i :style="{ width: (row.metric.rate ?? 0) + '%' }"></i></i>
            </dd>
          </div>
        </dl>
        <div class="period-heading"><h4>分时占用率</h4><span>统计日 {{ summary.through }}</span></div>
        <dl class="period-rates">
          <div v-for="period in summary.periods" :key="period.startHour" :title="period.name + '，' + period.startHour + ' 时至 ' + period.endHour + ' 时'">
            <dt>{{ period.name }}</dt>
            <dd><i class="rate-track" aria-hidden="true"><i :style="{ width: (period.rate ?? 0) + '%' }"></i></i><b>{{ percent(period.rate) }}</b></dd>
          </div>
        </dl>
      </template>
      <p v-else class="chart-note">当前区域暂无场地预订记录。</p>
    </section>

    <section v-if="summary.courtCount" class="industry-card reservation-chart" aria-label="订场客源分布">
      <h3 class="service-section-title">订场客源分布</h3>
      <template v-if="summary.origins?.locatedMembers && history.origins">
        <div class="origin-distribution">
          <div class="market-ring" :style="{ '--market-fill': marketFill }" aria-hidden="true"></div>
          <ul class="market-key" aria-label="已识别订场客源地区占比">
            <li v-for="item in markets" :key="item.label">
              <i aria-hidden="true" :style="{ background: item.color }"></i>
              <span>{{ item.label }}</span><b>{{ percent(item.rate) }}</b>
            </li>
          </ul>
        </div>
        <details class="chart-disclosure" @toggle="showRegions = ($event.currentTarget as HTMLDetailsElement).open">
          <summary>查看地区明细</summary>
          <VenueBookingOrigins v-if="showRegions" :counts="summary.origins" :source="history.origins" scope="当前范围" ranking-only />
        </details>
      </template>
      <p v-else class="chart-note">暂无订场客源数据。</p>
    </section>
  </div>
</template>

<style scoped>
.reservation-charts {
  display:grid; gap:8px; min-width:0; color:var(--v14-ink);
  font:400 16px/1.4 var(--v14-font); font-variant-numeric:tabular-nums;
  container:reservation-charts / inline-size;
}
.v14-services .reservation-chart { min-width:0; padding:10px; gap:7px; }
.reservation-chart :is(h3,h4,dl,dd,p,ul) { margin:0; }
.reservation-heading,.period-heading { display:flex; align-items:baseline; justify-content:space-between; flex-wrap:wrap; gap:2px 6px; }
.reservation-chart h3 { font:700 18px/24px var(--v14-font); }
.reservation-chart h4 { font:600 16px/24px var(--v14-font); }
.chart-note,.period-heading span { color:var(--v14-muted); }
.headline-rates { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.headline-rates > div { min-width:0; display:grid; }
.headline-rates dd { color:var(--v14-metric); font:400 30px/34px "Cockpit Bebas",var(--v14-font); }
.rate-track { position:relative; display:block; height:5px; overflow:hidden; border-radius:2px; background:var(--v14-chart-track); }
.rate-track > i { display:block; height:100%; background:var(--v14-metric); border-radius:inherit; }
.headline-rates .rate-track > i { background:linear-gradient(90deg,#2371f7,var(--v14-metric)); }
.period-heading { padding-top:7px; border-top:1px solid var(--v14-edge); }
.period-rates { display:grid; gap:3px; }
.period-rates > div { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:8px; }
.period-rates dd { min-width:0; display:grid; align-items:center; grid-template-columns:minmax(0,1fr) 4em; gap:6px; text-align:end; }
.period-rates b,.market-key b { color:var(--v14-ink); font-weight:600; }
.chart-disclosure { min-width:0; border-top:1px solid var(--v14-edge); }
.chart-disclosure > summary { width:fit-content; padding:4px 0 0; color:var(--v14-metric); cursor:pointer; font-weight:600; }
.chart-disclosure[open] > :not(summary) { margin-top:6px; }
.origin-distribution { display:grid; grid-template-columns:minmax(65px,30%) minmax(0,1fr); align-items:center; gap:10px; }
.market-ring { width:min(100%,86px); justify-self:center; aspect-ratio:1; border-radius:50%; background:var(--market-fill); mask:radial-gradient(transparent 49%,#000 51%); }
.market-key { display:grid; gap:1px; padding:0; list-style:none; }
.market-key li { display:grid; grid-template-columns:9px minmax(0,1fr) auto; align-items:center; gap:6px; min-width:0; }
.market-key li > i { width:9px; height:9px; border-radius:2px; }
.market-key b { white-space:nowrap; }
@container reservation-charts (max-width:270px) {
  .origin-distribution { grid-template-columns:54px minmax(0,1fr); gap:6px; }
  .market-key li { gap:3px; }
  .headline-rates { gap:8px; }
}
</style>
