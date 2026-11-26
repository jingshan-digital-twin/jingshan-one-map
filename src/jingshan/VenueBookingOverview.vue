<script setup lang="ts">
import { ref } from 'vue'
import type { summarizeVenueReservations } from './venue-reservation-summary'

defineProps<{ summary:ReturnType<typeof summarizeVenueReservations> }>()
const emit = defineEmits<{ select:[venueId:string] }>()
const dialog = ref<HTMLDialogElement>()
const opened = ref(false)
const hours = new Intl.NumberFormat('zh-CN', {maximumFractionDigits:2})
const asPercent = (value:number|null) => value === null ? '—' : value.toFixed(1) + '%'
function open() {
  opened.value = true
  dialog.value?.showModal()
}
function select(id:string) {
  dialog.value?.close()
  emit('select', id)
}
</script>

<template>
  <button v-if="summary.venues.length" type="button" class="booking-overview-trigger" aria-haspopup="dialog" @click="open">各馆明细<span aria-hidden="true"> ›</span></button>
  <dialog ref="dialog" class="booking-overview" aria-labelledby="booking-overview-title" @close="opened = false">
    <template v-if="opened">
      <header>
        <div>
          <h2 id="booking-overview-title">各馆分时占用率</h2>
          <p>统计日 <time :datetime="summary.through">{{ summary.through }}</time> · {{ summary.venues.length }} 处场馆 · {{ summary.courtCount }} 片场地</p>
        </div>
        <button type="button" class="booking-close" autofocus aria-label="关闭各馆分时占用率" @click="dialog?.close()">×</button>
      </header>
      <div class="booking-overview-content">
        <dl class="booking-topline">
          <div><dt>当日占用率</dt><dd>{{ asPercent(summary.today.rate) }}</dd></div>
          <div><dt>已占用时长</dt><dd>{{ hours.format(summary.today.occupied) }} <small>场地小时</small></dd></div>
          <div><dt>统计总时长</dt><dd>{{ hours.format(summary.today.capacity) }} <small>场地小时</small></dd></div>
        </dl>
        <table aria-label="各场馆最新记录日的全天和分时段占用率">
          <thead>
            <tr>
              <th scope="col">场馆</th><th scope="col">全天占用率</th>
              <th v-for="p in summary.periods" :key="p.startHour" scope="col">{{ p.name }}<small>{{ p.startHour }}–{{ p.endHour }} 时</small></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in summary.venues" :key="row.id">
              <th scope="row">
                <button type="button" :aria-label="'查看' + row.name + '的场地时间表'" @click="select(row.id)">{{ row.name }} <span aria-hidden="true">›</span></button>
                <small>{{ row.courtCount }} 片场地</small>
              </th>
              <td><strong>{{ asPercent(row.today.rate) }}</strong></td>
              <td v-for="band in row.periods" :key="band.startHour" :data-period="band.name">
                {{ asPercent(band.rate) }}<i aria-hidden="true"><b :style="{width:(band.rate ?? 0) + '%'}"></b></i>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="booking-note">占用率按已占用时长除以统计总时长计算，同一片场地的重叠记录只计一次。点击场馆名称可查看逐片场地的当日时间表。</p>
      </div>
    </template>
  </dialog>
</template>

<style scoped>
.booking-overview-trigger { padding:2px 0; border:0; color:var(--v14-metric); background:transparent; cursor:pointer; white-space:nowrap; font:600 16px/24px var(--v14-font) }
.booking-overview-trigger:hover { text-decoration:underline; text-underline-offset:3px }
@container reservation-charts (max-width:270px) {
  .booking-overview-trigger span { display:none; }
}
.booking-overview {
  box-sizing:border-box; width:min(860px,calc(100vw - 24px)); max-height:calc(100dvh - 32px); padding:0;
  overflow:auto; overscroll-behavior:contain; border:1px solid var(--v14-list-line); border-radius:5px;
  color:var(--v14-ink); background:color-mix(in srgb,var(--service-page-fill) 65%,#0a1731);
  font:400 16px/1.5 var(--v14-font); font-variant-numeric:tabular-nums; box-shadow:0 16px 64px #091a3459;
}
.cockpit-light .booking-overview { background:#f2f8ff }
.booking-overview::backdrop { background:rgb(5 20 39 / .63) }
.booking-overview header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:18px 24px; background:var(--v14-tab); border-bottom:1px solid var(--v14-edge) }
.booking-overview h2, .booking-overview p, .booking-overview dl, .booking-overview dd { margin:0 }
.booking-overview h2 { color:var(--v14-heading-color); font-size:22px; line-height:1.4 }
.booking-overview header p, .booking-note, .booking-overview th small { color:var(--v14-muted) }
.booking-overview header p { margin-top:4px }
.booking-close { width:36px; height:36px; flex-shrink:0; padding:0; color:var(--v14-ink); border:1px solid var(--v14-list-line); background:var(--v14-tab); border-radius:3px; font-size:25px; line-height:1; cursor:pointer }
.booking-overview-content { padding:20px 24px; display:grid; gap:20px }
.booking-topline { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px }
.booking-topline > div { min-width:0; padding:10px 14px; border-inline-start:3px solid var(--v14-icon); background:var(--v14-list) }
.booking-topline dd { color:var(--v14-metric); font-size:24px; font-weight:700 }
.booking-overview small { font:400 16px/1.4 var(--v14-font) }
.booking-overview table { width:100%; border-collapse:collapse; text-align:start }
.booking-overview :is(th,td) { padding:10px; text-align:start; border-bottom:1px solid var(--v14-edge) }
.booking-overview thead { background:var(--v14-tab) }
.booking-overview th small { display:block }
.booking-overview tbody th { width:28% }
.booking-overview tbody button { padding:0; color:var(--v14-ink); font:700 16px/1.5 var(--v14-font); border:0; background:none; cursor:pointer; text-align:start }
.booking-overview tbody button:hover { text-decoration:underline }
.booking-overview tbody button span, .booking-overview td strong { color:var(--v14-metric) }
.booking-overview td i { display:block; height:4px; margin-top:5px; background:var(--v14-chart-track) }
.booking-overview td b { display:block; height:100%; background:var(--v14-metric) }
@media(max-width:650px) {
  .booking-overview header,.booking-overview-content { padding:14px }
  .booking-topline { display:flex; flex-wrap:wrap }
  .booking-topline > div { flex:1 1 100px; padding:6px 8px }
  .booking-overview :is(table,tbody) { display:block }
  .booking-overview thead { position:absolute; width:1px; height:1px; clip-path:inset(50%); overflow:hidden }
  .booking-overview tbody tr { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); padding:8px 0; border-bottom:1px solid var(--v14-edge) }
  .booking-overview tbody th { width:auto; grid-column:span 2 }
  .booking-overview :is(th,td) { padding:4px; border:0 }
  .booking-overview td strong::before { content:'全天 '; color:var(--v14-muted); font-weight:400 }
  .booking-overview td[data-period]::before { content:attr(data-period); display:block; color:var(--v14-muted) }
}
</style>
