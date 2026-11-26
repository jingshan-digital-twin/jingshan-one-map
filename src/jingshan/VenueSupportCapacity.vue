<script setup lang="ts">
import {computed,ref} from 'vue'
import NearbyFacilityList from './NearbyFacilityList.vue'
import VenueSupportMetrics from './VenueSupportMetrics.vue'
import {capacityUnit, uniqueFacilitySites, type Facility, type SupportKind, type SupportMetric} from './venue-support'

const props=defineProps<{venueId:string; guests?:number; metrics:SupportMetric[]; facilities:(Facility & {meters:number})[]; radius:number}>()
const emit=defineEmits<{provider:[item:Facility]}>()
const category=ref<SupportKind|''>('')
const siteCount=computed(()=>uniqueFacilitySites(props.facilities).length)
const shortages=computed(()=>props.metrics.filter(row=>row.verdict==='不足'))
const adequate=computed(()=>props.metrics.filter(row=>row.verdict==='适宜'))
const likelyAdequate=computed(()=>props.metrics.filter(row=>row.verdict==='余量待核实' && row.sustainable!==undefined && row.sustainable>=row.target))
const available=computed(()=>props.metrics.filter(row=>row.sustainable!==undefined && row.sustainable>0))
</script>

<template>
  <section class="industry-card venue-suitability" aria-label="配套适宜性">
    <header><h3 class="service-section-title">配套适宜性</h3><span>{{ radius }} 公里内 · {{ siteCount }} 处设施</span></header>
    <template v-if="guests">
      <p v-if="shortages.length" class="venue-shortage"><span v-for="r in shortages" :key="r.id">{{ r.label }}至少缺 {{ r.deficit?.toLocaleString('zh-CN') }} {{ capacityUnit(r) }}</span></p>
      <p v-if="adequate.length">{{ adequate.map(r=>r.label).join('、') }}可满足场馆需求。</p>
      <p v-if="likelyAdequate.length">{{ likelyAdequate.map(r=>r.label).join('、') }}预计可满足需求。</p>
      <p v-if="!shortages.length && !adequate.length && !likelyAdequate.length">现有余量记录不足，暂无法判断。</p>
    </template>
    <p v-else>场馆接待人数未提供，暂无法判断。</p>
    <div v-if="available.length" class="venue-supply-levels" aria-label="适宜供给">
      <span v-for="r in available" :key="r.id">适宜{{ r.label }} {{ r.availableCount===undefined?'约 ':'' }}{{ r.sustainable?.toLocaleString('zh-CN') }} {{ capacityUnit(r) }}</span>
    </div>
  </section>
  <VenueSupportMetrics :rows="metrics" interactive :category="category" @select="kind=>category=category===kind?'':kind"/>
  <NearbyFacilityList v-model:category="category" :places="facilities" :center-id="venueId" :radius="radius"
    :metrics="metrics" @select="emit('provider',$event)"/>
</template>

<style scoped>
.v14-services .venue-suitability {gap:6px;padding:8px 12px}
.venue-suitability header {display:flex;align-items:center;justify-content:space-between;gap:8px}
.venue-suitability header :is(h3,span) {margin:0;white-space:nowrap}
.venue-suitability header span {color:var(--v14-muted);font:400 16px/24px var(--v14-font)}
.venue-suitability p {margin:0}
.venue-shortage,.venue-supply-levels {display:flex;flex-wrap:wrap;gap:4px 12px}
.venue-shortage span,.venue-supply-levels span {white-space:nowrap}
.venue-shortage span {border-inline-start:3px solid #ffae00;padding-inline-start:6px;font-weight:700}
.venue-supply-levels {color:var(--v14-muted);font:400 16px/24px var(--v14-font)}
</style>
