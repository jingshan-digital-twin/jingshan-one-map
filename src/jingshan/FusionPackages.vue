<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { downloadCsv } from './api.ts'
import { fusionPromotion, fusionTiers, type FusionRoute, type FusionTier } from './fusion-promotion.ts'
import type { Dataset } from './types.ts'
import { tourismProviders } from './tourism-providers.ts'
import type { ConsumptionPeriod } from './v3-panels.ts'

const props=defineProps<{datasets:Dataset[];date:string}>()
const emit=defineEmits<{manage:[id?:string];preview:[route:FusionRoute|null]}>()
const periods = [{id:'month',name:'本月'},{id:'quarter',name:'本季'},{id:'year',name:'本年'},{id:'event',name:'按赛事'}] as const
const period=ref<ConsumptionPeriod>('month'), tier=ref<FusionTier>('local'), routeId=ref(''), eventId=ref('')
const events=computed(()=>props.datasets.find(d=>d.id==='events')?.features??[])
const event=computed(()=>events.value.find(row=>row.id===eventId.value)??events.value[0])
const promotion=computed(()=>fusionPromotion({datasets:props.datasets,now:new Date(props.date+'T12:00:00+08:00'),period:period.value,event:event.value}))
const current=computed(()=>promotion.value.tiers.find(t=>t.id===tier.value)!)
const agencies=computed(()=>tourismProviders(props.datasets,'旅行社'))
const agencyNames=computed(()=>new Map(agencies.value.map(agency=>[agency.id,agency.properties.name])))
const operator=(item:FusionRoute)=>agencyNames.value.get(String(item.feature.properties.agencyId??''))
const route=computed(()=>current.value.routes.find(r=>r.id===routeId.value)??current.value.top??current.value.routes[0])
const previewing=ref(false)
function preview() {
  if(!route.value) return
  previewing.value=true
  emit('preview',route.value)
}
function onToggle(e:Event) {
  if((e.target as HTMLDetailsElement).open || !previewing.value) return
  previewing.value=false; emit('preview',null)
}
watch([period,tier,routeId,eventId],()=>{if(previewing.value) emit('preview',route.value??null)})
function exportRoutes() {
  const rows=[
    ['统计期间','范围','推广线路','起点','终点','上架情况','订单数','价格','游览天数','行程','商家','承接旅行社'],
    ...current.value.routes.map(item=>[promotion.value.periodLabel,current.value.label,item.name,item.from,item.to,item.status,item.orders,
      item.price,item.days,item.itinerary.join(' → '),item.merchants.map(m=>m.properties.name).join('、'),operator(item)??'']),
  ]
  downloadCsv('京山-'+current.value.label+'推广线路-'+props.date+'.csv',rows)
}
</script>
<template>
  <details class="fusion-packages" @toggle="onToggle">
    <summary>推广线路与订单</summary>
    <div class="fusion-package-content">
      <div class="fusion-filter" aria-label="线路统计时段"><button v-for="p in periods" :key="p.id" :aria-pressed="period===p.id" @click="period=p.id">{{ p.name }}</button></div>
      <select v-if="period==='event'" aria-label="统计赛事" :value="event?.id" @change="eventId=($event.target as HTMLSelectElement).value">
        <option v-for="e in events" :key="e.id" :value="e.id">{{ e.properties.name }}</option>
      </select>
      <div class="fusion-filter" aria-label="推广线路区域"><button v-for="t in fusionTiers" :key="t.id" :aria-pressed="tier===t.id" @click="tier=t.id">{{ t.label }}</button></div>
      <p class="fusion-muted">{{ promotion.periodLabel }} · {{ current.routes.length }} 条线路 · {{ current.orders?.toLocaleString('zh-CN')??'—' }} 单</p>
      <select v-if="current.routes.length" :value="route?.id" aria-label="推广线路" @change="routeId=($event.target as HTMLSelectElement).value">
        <option v-for="r in current.routes" :key="r.id" :value="r.id">{{ r.name }}</option>
      </select>
      <article v-if="route" class="fusion-ticket">
        <div><strong>{{ route.name }}</strong><span class="fusion-badge">{{ route.status }}</span></div>
        <p>{{ route.from }} → {{ route.to }}</p>
        <p>{{ [route.days!=null?route.days+' 天':'',route.price!=null?'¥'+route.price:'',route.orders!=null?route.orders+' 单':''].filter(Boolean).join(' · ') }}</p>
        <ol v-if="route.itinerary.length"><li v-for="step in route.itinerary" :key="step">{{ step }}</li></ol>
        <p v-if="route.merchants.length">合作商家 · {{ route.merchants.map(item=>item.properties.name).join('、') }}</p>
        <p v-if="operator(route)">承接旅行社 · {{ operator(route) }}</p>
        <button v-if="route.source&&route.destination" class="fusion-link" @click="preview">查看线路方向 ›</button>
      </article>
      <div class="fusion-filter"><button @click="$emit('manage',route?.id)">线路管理</button><button :disabled="!current.routes.length" @click="exportRoutes">导出线路</button></div>
      <details v-if="agencies.length" class="agency-list">
        <summary>旅行社名录 · {{ agencies.length }} 家</summary>
        <ul><li v-for="agency in agencies" :key="agency.id"><strong>{{ agency.properties.name }}</strong><span>{{ agency.properties.address }}</span></li></ul>
      </details>
    </div>
  </details>
</template>
<style scoped>
.agency-list summary { cursor: pointer; color: var(--v14-icon); }
.agency-list ul { display: grid; gap: 6px; list-style: none; padding: 0; }
.agency-list li { display: grid; padding: 4px 0; border-bottom: 1px solid var(--industry-table-line); }
.agency-list li span { color: var(--v14-muted); }
</style>
