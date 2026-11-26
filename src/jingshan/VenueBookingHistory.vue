<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { analyzeVenueBookings, type VenueBookingAnalysis } from './venue-booking-analysis'
import type { BookingSnapshot } from './venue-reservation-data'
import type { CityFeature } from './types'
import type { OpeningSchedule } from './opening-schedule'
import { shortCourtName } from './booking-timetable'
import VenueBookingTimetable from './VenueBookingTimetable.vue'

const props = defineProps<{
  history:BookingSnapshot; venueId:string; summary:VenueBookingAnalysis; initialCourt:string
  courtFeatures:CityFeature[]; openingPlans:OpeningSchedule[]
}>()
const view=defineModel<'history'|'snapshot'|'regions'>('view',{required:true})
const frequency=ref<'all'|'month'|'day'>('all')
const month=ref(props.summary.endDate.slice(0,7)),date=ref(props.summary.endDate)
const courtId=ref(props.initialCourt)
const tableDate=ref(props.history.through)
const breakdown=ref<'heat'|'courts'|'days'>('heat')
const dayPage=ref(1)
const allDates=computed(()=>[...props.history.dates].reverse())
const numberSort=new Intl.Collator('zh-CN',{numeric:true})
const courtDirectory=computed(()=>[...props.summary.courts].sort((a,b)=>numberSort.compare(a.name,b.name)))
const venueName=computed(()=>props.history.courts.find(c=>c.venueId===props.venueId)?.venueName ?? '')
const courtLabel=(name:string)=>shortCourtName(name,venueName.value)
const analysis=computed(()=>{
  if(frequency.value==='all' && !courtId.value)return props.summary
  return analyzeVenueBookings(props.history,props.venueId,{
    month:frequency.value==='month'?month.value:undefined, date:frequency.value==='day'?date.value:undefined, courtId:courtId.value || undefined,
  })
})
const days=computed(()=>[...(analysis.value?.days ?? [])].reverse())
const pages=computed(()=>Math.max(1,Math.ceil(days.value.length/7)))
const visibleDays=computed(()=>days.value.slice((dayPage.value-1)*7,dayPage.value*7))
const courtsByNumber=computed(()=>[...(analysis.value?.courts ?? [])].sort((a,b)=>numberSort.compare(a.name,b.name)))
const heatSelection=ref<{hour:number;weekday:string}|null>(null)
const heatRows=computed(()=>props.history.hours.map(hour=>({
  hour,
  cells:(analysis.value?.weekdays ?? []).map(day=>({
    weekday:day.label,
    record:day.hourly.find(row=>row.hour===hour),
  })),
})))
const heatRecord=computed(()=>{
  const row=heatRows.value.find(r=>r.hour===heatSelection.value?.hour)
  return row?.cells.find(c=>c.weekday===heatSelection.value?.weekday)
})
watch([month,date,frequency,courtId],()=>{dayPage.value=1;heatSelection.value=null})
const decimal=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:1})
const hours=(value:number)=>decimal.format(value)
const pct=(value:number|null|undefined)=>value==null?'—':decimal.format(value)+'%'
const heatPct=(value:number|null|undefined)=>value==null?'—':Math.round(value)+'%'
function openDay(value:string) {tableDate.value=value;view.value='snapshot'}
function changeView(next:'history'|'snapshot'|'regions') {if(next==='snapshot')tableDate.value=frequency.value==='day'?date.value:props.history.through;view.value=next}
</script>
<template>
  <div class="venue-booking-history">
    <div class="industry-tabs booking-views" role="group" aria-label="场馆占用视图">
      <button type="button" :aria-pressed="view==='history'" @click="changeView('history')">占用热力</button>
      <button type="button" :aria-pressed="view==='snapshot'" @click="changeView('snapshot')">开放时间表</button>
      <button v-if="$slots.regions" type="button" :aria-pressed="view==='regions'" @click="changeView('regions')">订场客源</button>
    </div>
    <template v-if="view==='regions'"><slot name="regions"/></template>
    <template v-else-if="view==='snapshot'">
      <VenueBookingTimetable :history="history" :venue-id="venueId" :summary="summary" :initial-court="courtId" :initial-date="tableDate" :court-features="courtFeatures" :opening-plans="openingPlans"/>
    </template>
    <template v-else>
      <div class="industry-filters booking-filters">
        <label>统计范围<select v-model="frequency" aria-label="占用统计范围"><option value="all">全部历史</option><option value="month">按月</option><option value="day">按日</option></select></label>
        <label>场地<select v-model="courtId" aria-label="占用统计场地"><option value="">全部场地</option><option v-for="c in courtDirectory" :key="c.id" :value="c.id">{{ courtLabel(c.name) }}</option></select></label>
        <label v-if="frequency==='month'" class="booking-date">月份<select v-model="month" aria-label="占用统计月份"><option v-for="m in summary.months" :key="m">{{ m }}</option></select></label>
        <label v-else-if="frequency==='day'" class="booking-date">日期<select v-model="date" aria-label="占用统计日期"><option v-for="d in allDates" :key="d">{{ d }}</option></select></label>
      </div>
      <template v-if="analysis">
        <section class="booking-summary" aria-label="综合占用率">
          <div><h4>综合占用率</h4><strong>{{ pct(analysis.totals.rate) }}</strong></div>
          <p>{{ analysis.startDate }}<template v-if="analysis.startDate!==analysis.endDate"> 至 {{ analysis.endDate }}</template> · {{ analysis.courtCount }} 片
          <br>占用 {{ hours(analysis.totals.occupied) }} / {{ hours(analysis.totals.capacity) }} 场地小时</p>
        </section>
        <div class="booking-breakdown" role="group" aria-label="占用分析明细">
          <button v-for="item in ([['heat','分时热力'],['courts','分场地'],['days','逐日记录']] as const)" :key="item[0]" type="button" :aria-pressed="breakdown===item[0]" @click="breakdown=item[0]">{{ item[1] }}</button>
        </div>
        <template v-if="breakdown==='heat'">
          <section class="booking-heat" aria-label="场地使用热力">
            <h4 class="service-section-title">场地使用热力（占用率）</h4>
            <div class="heat-scroll">
              <table aria-label="星期与小时占用率热力表">
                <thead><tr><th scope="col">时段</th><th v-for="d in analysis.weekdays" :key="d.label" scope="col">{{ d.label }}</th></tr></thead>
                <tbody><tr v-for="row in heatRows" :key="row.hour">
                  <th scope="row">{{ String(row.hour).padStart(2,'0') }}–{{ String(row.hour+1).padStart(2,'0') }}</th>
                  <td v-for="cell in row.cells" :key="cell.weekday">
                    <button v-if="cell.record?.rate!=null" type="button" class="heat-cell"
                      :aria-label="cell.weekday+' '+cell.record.label+' 占用率 '+pct(cell.record.rate)"
                      :aria-pressed="heatSelection?.hour===row.hour && heatSelection?.weekday===cell.weekday"
                      :style="{'--heat-value':cell.record.rate+'%'}" :class="{'deep':cell.record.rate>=80}"
                      @click="heatSelection={hour:row.hour,weekday:cell.weekday}">{{ heatPct(cell.record.rate) }}</button>
                    <span v-else title="该星期时段无统计">—</span>
                  </td>
                </tr></tbody>
              </table>
            </div>
            <div class="heat-legend">占用率 <span>低</span><i aria-hidden="true"></i><span>高</span></div>
            <p v-if="heatRecord?.record" class="heat-inspect" aria-live="polite">{{ heatRecord.weekday }} {{ heatRecord.record.label }} · 占用 {{ hours(heatRecord.record.occupied) }} / {{ hours(heatRecord.record.capacity) }} 场地小时（{{ pct(heatRecord.record.rate) }}）</p>
          </section>
          <section v-if="analysis.insights.length" class="industry-card booking-insights" aria-label="高峰紧张度">
            <h4 class="service-section-title">高峰紧张度</h4><ul><li v-for="line in analysis.insights" :key="line">{{ line }}</li></ul>
          </section>
          <details v-if="analysis.monthly.length>1" class="industry-card booking-details">
            <summary>各月占用率</summary>
            <div class="booking-table"><table class="industry-table"><thead><tr><th scope="col">月份</th><th scope="col">占用时长</th><th scope="col">占用率</th></tr></thead>
              <tbody><tr v-for="m in analysis.monthly" :key="m.month"><th scope="row">{{ m.month }}</th><td>{{ hours(m.occupied) }} 小时</td><td>{{ pct(m.rate) }}</td></tr></tbody>
            </table></div>
          </details>
        </template>
        <div v-else-if="breakdown==='courts'" class="booking-table">
          <table class="industry-table"><thead><tr><th>场地</th><th>占用时长</th><th>占用率</th></tr></thead>
            <tbody><tr v-for="r in courtsByNumber" :key="r.id"><td>{{ courtLabel(r.name) }}</td><td>{{ hours(r.occupied) }} 小时</td><td>{{ pct(r.rate) }}</td></tr></tbody>
          </table>
        </div>
        <section v-else aria-label="每日占用记录">
          <div class="booking-table"><table class="industry-table"><thead><tr><th>日期</th><th>占用时长</th><th>占用率</th></tr></thead>
            <tbody><tr v-for="r in visibleDays" :key="r.date"><td><button type="button" class="industry-row-action" :title="'查看 '+r.date+' 时间表'" @click="openDay(r.date)">{{ r.date }}</button></td><td>{{ hours(r.occupied) }} 小时</td><td>{{ pct(r.rate) }}</td></tr></tbody>
          </table></div>
          <div v-if="pages>1" class="booking-pager"><button type="button" class="industry-button" :disabled="dayPage===1" @click="dayPage--">上一页</button><span>{{ dayPage }} / {{ pages }}</span><button type="button" class="industry-button" :disabled="dayPage>=pages" @click="dayPage++">下一页</button></div>
        </section>
      </template>
      <p v-else>所选范围暂无占用统计。</p>
    </template>
    <details v-if="view!=='regions'" class="industry-card booking-details">
      <summary>占用统计口径</summary>
      <p>数据来自京网有约，覆盖 {{ history.from }} 至 {{ history.through }}。每片每天按 08:00–12:00、13:00–22:00 共 13 小时统计。同场地同一分钟的占用记录合并一次。</p>
    </details>
  </div>
</template>
<style scoped>
.venue-booking-history { display:grid;gap:8px;min-width:0;font:400 16px/1.45 var(--v14-font);font-variant-numeric:tabular-nums }
.venue-booking-history :is(h4,p,dl,ul) {margin:0}
.booking-views,.booking-breakdown {display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr)}
.booking-views>button {min-width:0}
.booking-breakdown {border-bottom:1px solid var(--v14-list-line)}
.booking-breakdown button {min-height:32px;color:var(--v14-ink);font:inherit;background:var(--v14-list);border:0;cursor:pointer}
.booking-breakdown button[aria-pressed=true] {background:var(--v14-tab);font-weight:700;color:var(--v14-metric);box-shadow:inset 0 -2px var(--v14-metric)}
.booking-filters { display:grid;grid-template-columns:minmax(0,.82fr) minmax(0,1.18fr);gap:6px }
.booking-filters label {display:grid;gap:2px;min-width:0;color:var(--v14-muted)}
.booking-filters select {width:100%;min-width:0}
.booking-date {grid-column:1/-1}
.booking-summary {display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px 12px;border-inline-start:3px solid var(--v14-metric);padding:5px 10px;background:var(--v14-list)}
.booking-summary strong {color:var(--v14-metric);font:700 24px/1.2 var(--v14-font)}
.booking-summary p,.heat-legend {color:var(--v14-muted)}
.booking-heat {display:grid;gap:6px;min-width:0;--heat-low:#183556;--heat-high:#176fd2}
:global(.cockpit-light) .booking-heat {--heat-low:#edf6ff;--heat-high:#155aa8}
.heat-scroll,.booking-table {overflow-x:auto;min-width:0}
.heat-scroll table {width:100%;min-width:333px;border-spacing:1px;border-collapse:separate;table-layout:fixed;text-align:center;font:inherit}
.heat-scroll th,.heat-scroll td {padding:0;border:0}
.heat-scroll th {font-weight:600;background:var(--v14-tab);padding-block:2px}
.heat-scroll th:first-child {width:3.15em}
.heat-cell {display:block;width:100%;height:26px;padding:0;border:0;color:var(--v14-ink);font:inherit;font-size:16px;letter-spacing:-.035em;cursor:pointer;background:color-mix(in srgb,var(--heat-high) var(--heat-value),var(--heat-low))}
:global(.cockpit-light) .heat-cell {color:#010307}
:global(.cockpit-light) .heat-cell.deep {color:white}
.heat-cell[aria-pressed=true],.heat-cell:focus-visible {outline:2px solid var(--v14-heading-color);outline-offset:-2px}
.heat-legend {display:flex;align-items:center;justify-content:flex-end;gap:6px}
.heat-legend i {width:82px;height:8px;border:1px solid var(--v14-edge);background:linear-gradient(to right,var(--heat-low),var(--heat-high))}
.heat-inspect {padding:4px 8px;background:var(--v14-list)}
.booking-insights {display:grid;gap:7px}
.booking-insights ul {display:grid;gap:6px;padding-inline-start:18px}
.booking-insights li::marker {color:var(--v14-metric)}
.booking-details summary {font-weight:600;cursor:pointer}
.booking-details[open] summary {margin-bottom:6px}
.booking-table table {width:100%}
.booking-table td:first-child {white-space:normal}
.booking-pager {display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:5px}
</style>
