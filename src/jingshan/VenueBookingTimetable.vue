<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BookingSnapshot } from './venue-reservation-data'
import { analyzeVenueBookings, type VenueBookingAnalysis } from './venue-booking-analysis'
import type { CityFeature } from './types'
import type { OpeningSchedule } from './opening-schedule'
import { minuteTime, openingForDate, shortCourtName, slotDisplay, timetableSlot, type SlotState } from './booking-timetable'

const props = defineProps<{
  history:BookingSnapshot; venueId:string; summary:VenueBookingAnalysis; initialCourt:string; initialDate:string
  courtFeatures:CityFeature[]; openingPlans:OpeningSchedule[]
}>()
const date = ref(props.history.dates.includes(props.initialDate) ? props.initialDate : props.history.through)
const selectedCourt = ref(props.initialCourt)
const band = ref(1)
const page = ref(1)
const selection = ref<{court:string; hour:number}|null>(null)
const bands = [{name:'凌晨',from:0,until:6},{name:'上午',from:6,until:12},{name:'下午',from:12,until:18},{name:'晚间',from:18,until:24}]
const group = computed(() => bands[band.value])
const hours = computed(() => Array.from({length:group.value.until-group.value.from}, (_,i) => group.value.from+i))
const rowsPerPage = 8
const numberSort = new Intl.Collator('zh-CN',{numeric:true})
const displayName = (name:string) => shortCourtName(name, props.history.courts.find(c=>c.venueId===props.venueId)?.venueName ?? '')
const courtDirectory = computed(() => [...props.summary.courts].sort((a,b)=>numberSort.compare(a.name,b.name)))
const latest = computed(() => date.value === props.history.through ? props.summary.latest
  : analyzeVenueBookings(props.history,props.venueId,{date:date.value}))
const courts = computed(() => {
  const visible = selectedCourt.value ? courtDirectory.value.filter(c=>c.id===selectedCourt.value) : courtDirectory.value
  const source = new Map(latest.value?.courts.map(c=>[c.id,c]))
  const inventory = new Map(props.courtFeatures.map(c=>[c.id,c]))
  return visible.map(c => {
    const opening = openingForDate(inventory.get(c.id),date.value,props.openingPlans)
    const hourly = new Map(source.get(c.id)?.hourly.map(h=>[h.hour,h]))
    return {id:c.id, name:displayName(c.name), slots:hours.value.map(h=>timetableSlot(h,hourly.get(h),opening))}
  })
})
const pageCount = computed(() => Math.max(1,Math.ceil(courts.value.length/rowsPerPage)))
const visibleRows = computed(() => courts.value.slice((page.value-1)*rowsPerPage,page.value*rowsPerPage))
const legend = computed(() => {
  const states = new Set(courts.value.flatMap(c=>c.slots.map(s=>s.state)))
  return (Object.keys(slotDisplay) as SlotState[]).filter(s=>states.has(s))
})
const selected = computed(() => {
  const row = visibleRows.value.find(r=>r.id===selection.value?.court)
  const slot = row?.slots.find(s=>s.hour===selection.value?.hour)
  return row && slot ? {row,slot} : undefined
})
watch([date,band,selectedCourt],()=>{page.value=1;selection.value=null})
watch(page,()=>{selection.value=null})
const cellRange=(hour:number)=>minuteTime(hour*60)+'–'+minuteTime((hour+1)*60)
const occupiedText=(minutes:number|null)=>minutes===null?'无该小时统计':minutes+' 分钟'
function changeDate(event:Event) {
  const input=event.target as HTMLInputElement
  if(props.history.dates.includes(input.value))date.value=input.value
  else input.value=date.value
}
</script>
<template>
  <section class="schedule" aria-label="逐片场地开放时间表">
    <div class="schedule-fields">
      <label>排期日期<input type="date" :value="date" :min="history.from" :max="history.through" aria-label="排期日期" @change="changeDate"></label>
      <label>场地<select v-model="selectedCourt" aria-label="排期场地"><option value="">全部场地</option><option v-for="c in courtDirectory" :key="c.id" :value="c.id">{{ displayName(c.name) }}</option></select></label>
    </div>
    <div class="schedule-title"><h4 class="service-section-title">开放与占用时间表</h4><span>{{ date }} · {{ courts.length }} 片</span></div>
    <div class="schedule-periods" role="group" aria-label="排期时段"><button v-for="(b,i) in bands" :key="b.from" type="button" :aria-pressed="i===band" @click="band=i">{{ b.name }}</button></div>
    <div class="schedule-grid-scroll">
      <table class="schedule-grid" aria-label="逐片逐时开放与占用状态">
        <thead><tr><th scope="col">场地</th><th v-for="h in hours" :key="h" scope="col" :title="cellRange(h)">{{ h }}时</th></tr></thead>
        <tbody><tr v-for="row in visibleRows" :key="row.id"><th scope="row">{{ row.name }}</th>
          <td v-for="s in row.slots" :key="s.hour">
            <button type="button" :class="'slot-'+s.state" :aria-label="row.name+' '+cellRange(s.hour)+' '+slotDisplay[s.state].label" :title="row.name+' '+cellRange(s.hour)+' '+slotDisplay[s.state].label" :aria-pressed="selected?.row.id===row.id && selected.slot.hour===s.hour" @click="selection={court:row.id,hour:s.hour}">{{ slotDisplay[s.state].mark }}</button>
          </td>
        </tr></tbody>
      </table>
    </div>
    <div v-if="pageCount>1" class="schedule-pager" aria-label="时间表翻页">
      <button type="button" class="industry-button" aria-label="上一组场地" :disabled="page<=1" @click="page--">‹</button>
      <span>{{ (page-1)*rowsPerPage+1 }}–{{ Math.min(page*rowsPerPage,courts.length) }} / {{ courts.length }} 片</span>
      <button type="button" class="industry-button" aria-label="下一组场地" :disabled="page>=pageCount" @click="page++">›</button>
    </div>
    <div class="schedule-legend" aria-label="时间表图例"><span v-for="state in legend" :key="state"><i :class="'slot-'+state"></i>{{ slotDisplay[state].label }}</span></div>
    <div v-if="selected" class="industry-card schedule-detail" aria-live="polite">
      <h4>{{ selected.row.name }} · {{ cellRange(selected.slot.hour) }}</h4>
      <dl><div><dt>开放安排</dt><dd>{{ selected.slot.openingText }}</dd></div><div><dt>占用记录</dt><dd>{{ occupiedText(selected.slot.occupiedMinutes) }}</dd></div></dl>
    </div>
    <p class="schedule-note">开放安排取自现行场地台账和当日适用的协调排期。占用记录覆盖 08:00–12:00、13:00–22:00，其余时段仅显示开放安排。</p>
  </section>
</template>
<style scoped>
.schedule { display:grid; gap:8px; min-width:0; --slot-open:#256357; --slot-part-open:#356477; --slot-full:#225fb0; --slot-part:#87580e; --slot-closed:#404d62; --slot-unknown:#4b506d; }
.schedule :is(h4,p,dl,dd) { margin:0 }
.schedule-fields { display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:6px }
.schedule-fields label { display:grid; gap:3px; min-width:0; color:var(--v14-muted) }
.schedule-fields :is(select,input) { width:100%; min-width:0; font:inherit; }
.schedule-title,.schedule-legend,.schedule-pager { display:flex; align-items:center; flex-wrap:wrap; gap:6px 12px }
.schedule-title { justify-content:space-between }
.schedule-title span,.schedule-note,.schedule-detail dt { color:var(--v14-muted) }
.schedule-periods { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); border-bottom:1px solid var(--v14-list-line) }
.schedule-periods button { min-height:34px; background:var(--v14-list); border:0; color:var(--v14-ink); font:inherit;cursor:pointer }
.schedule-periods button[aria-pressed=true] { background:var(--v14-tab); color:var(--v14-metric);font-weight:700;box-shadow:inset 0 -2px var(--v14-metric) }
.schedule-grid-scroll { min-width:0; overflow-x:auto }
.schedule-grid { width:100%; min-width:310px; table-layout:fixed; border-collapse:separate; border-spacing:2px; font:inherit; text-align:center }
.schedule-grid :is(td,th) { padding:0; min-width:0; border:0 }
.schedule-grid thead th { padding-block:4px; background:var(--v14-tab); color:var(--v14-ink) }
.schedule-grid th:first-child { width:4.1em }
.schedule-grid tbody th { font-weight:500; overflow-wrap:anywhere }
.schedule-grid td button { width:100%; min-height:32px; color:#fff; border:1px solid rgb(255 255 255 / .28); border-radius:3px; font:inherit;cursor:pointer }
.schedule-grid td button[aria-pressed=true] { outline:2px solid var(--v14-heading-color); outline-offset:-2px }
.slot-open { background:var(--slot-open) } .slot-partOpen { background:repeating-linear-gradient(135deg,var(--slot-open) 0 4px,var(--slot-part-open) 4px 8px) }
.slot-occupied { background:var(--slot-full) } .slot-partOccupied { background:var(--slot-part) }
.slot-closed { background:var(--slot-closed) } .slot-noOccupancy,.slot-unknown { background:var(--slot-unknown) }
.schedule-legend span { display:inline-flex; align-items:center; gap:5px }
.schedule-legend i { width:12px; height:12px; border:1px solid var(--v14-edge); border-radius:2px }
.schedule-pager { justify-content:flex-end }
.schedule-pager button { min-height:30px; padding:0 12px }
.schedule-detail { gap:6px }
.schedule-detail dl { display:grid; gap:4px }
.schedule-detail dl>div { display:grid; grid-template-columns:5em minmax(0,1fr); gap:6px }
</style>
