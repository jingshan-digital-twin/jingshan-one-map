<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { bookingOriginMarkets, originShare, type BookingOriginCounts, type BookingOriginSnapshot } from './venue-booking-origin'

const props = defineProps<{
  counts:BookingOriginCounts
  source:Pick<BookingOriginSnapshot,'from'|'through'|'lookupSource'>
  scope:string
  rankingOnly?:boolean
}>()
const level = ref<'city'|'province'>('city')
const query = ref('')
const page = ref(1)
const pageSize = 8
const percent = (count:number) => originShare(count,props.counts.locatedMembers)
const markets = computed(() => bookingOriginMarkets(props.counts))
const ranked = computed(() => {
  const totals = new Map<string,number>()
  for (const r of props.counts.regions) {
    const area = level.value === 'province' || !r.city || r.province === r.city
      ? r.province : r.province + ' · ' + r.city
    totals.set(area,(totals.get(area)??0)+r.members)
  }
  return [...totals].sort(([a,x],[b,y]) => y-x || a.localeCompare(b,'zh-CN'))
})
const filtered = computed(() => ranked.value.filter(([name]) => name.includes(query.value.trim())))
const totalPages = computed(() => Math.ceil(filtered.value.length/pageSize))
const visible = computed(() => props.rankingOnly
  ? ranked.value.slice(0,10)
  : filtered.value.slice((page.value-1)*pageSize,page.value*pageSize))
watch([level,query,()=>props.counts],() => {page.value=1})
function chooseLevel(value:'city'|'province') {
  level.value=value
  query.value=''
}
</script>

<template>
  <section class="booking-origins" :aria-label="scope+'订场客源分布'">
    <div v-if="!rankingOnly" class="origin-head">
      <h4 class="service-section-title">{{ scope }} · 订场客源</h4>
      <p>场次日期 {{ source.from }} 至 {{ source.through }}，含已排定场次。</p>
    </div>
    <dl v-if="!rankingOnly" class="origin-markets">
      <div v-for="item in markets" :key="item.name"><dt>{{ item.name }}</dt>
        <dd>{{ percent(item.count) }}</dd>
      </div>
    </dl>
    <p v-if="!rankingOnly" class="origin-note">占比按已识别的手机号归属地计算，荆门含京山。</p>
    <div v-if="!rankingOnly" class="origin-controls">
      <div role="group" aria-label="客源统计地区层级">
        <button type="button" :aria-pressed="level==='city'" @click="chooseLevel('city')">按地市</button>
        <button type="button" :aria-pressed="level==='province'" @click="chooseLevel('province')">按省份</button>
      </div>
      <input v-if="ranked.length>pageSize" v-model="query" type="search" aria-label="搜索客源地区" placeholder="搜索地区">
    </div>
    <table class="origin-table" aria-label="订场客源地区排行">
      <thead><tr><th scope="col">{{ rankingOnly ? '客源地前十' : '地区' }}</th><th scope="col">占比</th></tr></thead>
      <tbody>
        <tr v-for="([name,n],index) in visible" :key="name"><th scope="row"><span v-if="rankingOnly" class="origin-rank">{{ index+1 }}</span>{{ name }}</th>
          <td>{{ percent(n) }}<i aria-hidden="true"><b :style="{width:percent(n)}"></b></i></td>
        </tr>
        <tr v-if="!visible.length"><td colspan="2">当前条件下没有地区记录</td></tr>
      </tbody>
    </table>
    <div v-if="!rankingOnly && totalPages>1" class="origin-pages">
      <button type="button" aria-label="上一页客源地区" :disabled="page===1" @click="page--">上一页</button>
      <span>{{ page }} / {{ totalPages }}</span>
      <button type="button" aria-label="下一页客源地区" :disabled="page===totalPages" @click="page++">下一页</button>
    </div>
    <details v-if="!rankingOnly" class="origin-method">
      <summary>客源统计口径</summary>
      <p>统计“正常”和“已核销”场次。同一手机号在所选范围内只计一次，全馆概览跨馆去重。归属地反映号段分配地区，不能据此判断订场人的居住地。</p>
      <p>号段来源为 {{ source.lookupSource }}，在本地匹配。</p>
    </details>
  </section>
</template>

<style scoped>
.booking-origins { display:grid; gap:10px; min-width:0; font:400 16px/1.45 var(--v14-font); font-variant-numeric:tabular-nums; color:var(--v14-ink) }
.booking-origins :is(h4,p,dl,dd) { margin:0 }
.origin-head h4 { font-size:18px }
.origin-head p,.origin-note { font-size:16px; color:var(--v14-muted) }
.origin-markets { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px }
.origin-markets > div { padding:5px 9px; background:var(--v14-list); border:1px solid var(--v14-edge) }
.origin-markets dd { font-weight:700 }
.origin-controls,.origin-pages { display:flex; flex-wrap:wrap; gap:6px; align-items:center }
.origin-controls > div { display:flex }
.booking-origins :is(input,button) { min-height:32px; min-width:0; padding:3px 9px; box-sizing:border-box; border:1px solid var(--v14-list-line); border-radius:3px; font:inherit; color:var(--v14-ink); background:var(--v14-tab) }
.origin-controls input { flex:1 1 100px; width:0 }
.booking-origins button { cursor:pointer }
.booking-origins button[aria-pressed="true"] { color:white; background:var(--v14-tab-active); box-shadow:inset 0 -2px #ffae00 }
.booking-origins button:disabled { opacity:.45; cursor:default }
.booking-origins .origin-table { width:100%; border-collapse:collapse; text-align:start }
.origin-table :is(th,td) { padding:5px 8px; border-bottom:1px solid var(--v14-edge); text-align:start }
.origin-table thead { background:var(--v14-tab) }
.origin-table tbody th { font-weight:400; overflow-wrap:anywhere }
.origin-rank { display:inline-block; min-width:2ch; margin-inline-end:.5em; color:var(--v14-metric); font-weight:600 }
.origin-table :is(th,td):not(:first-child) { text-align:end; white-space:nowrap }
.origin-table td:last-child { width:24% }
.origin-table td i { display:block; margin-top:3px; height:3px; background:var(--v14-chart-track) }
.origin-table td b { display:block; height:100%; background:var(--v14-metric) }
.origin-pages { justify-content:flex-end }
.origin-method { border-top:1px solid var(--v14-edge); padding-top:6px }
.origin-method summary { cursor:pointer; font-weight:600 }
.origin-method p { color:var(--v14-muted); margin-top:6px }
</style>
