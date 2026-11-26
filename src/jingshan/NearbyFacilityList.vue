<script setup lang="ts">
import {computed,watch} from 'vue'
import {amount,capacityUnit,facilityResource,facilitySiteKey,serviceDistance,supportCategories,supportFilterOrder,uniqueFacilitySites,type Facility,type SupportKind,type SupportMetric} from './venue-support'
import {serviceSymbols} from './service-point-markers'
import {useServicePage} from './service-pagination'
import ServicePager from './ServicePager.vue'

const props=defineProps<{places:(Facility & {meters:number})[]; centerId:string; radius:number; metrics?:SupportMetric[]; attractionsOnly?:boolean}>()
const emit=defineEmits<{select:[item:Facility]}>()
const category=defineModel<SupportKind|''>('category',{default:''})
const kinds=computed(()=>supportFilterOrder.filter(kind=>props.metrics?.some(row=>row.kind===kind)||props.places.some(item=>item.kind===kind)))
watch(kinds,items=>{if(category.value&&!items.includes(category.value))category.value=''})
const rows=computed(()=>{
  if (!category.value) return uniqueFacilitySites(props.places)
  const metric=props.metrics?.find(row=>row.kind===category.value)
  return uniqueFacilitySites(metric ? metric.providers : props.places.filter(item=>item.kind===category.value))
})
const pager=useServicePage(rows,[category,()=>props.centerId,()=>props.radius])
function descriptor(p:Facility) {
  const data=p.feature.properties
  const resource=facilityResource(p)
  if (resource) {
    const total=amount(data[resource.registered])
    if (total!==undefined) return resource.label+' '+total.toLocaleString('zh-CN')+' '+capacityUnit(resource)
  }

  if(p.kind==='medical' && data.emergency===true)return '提供急诊'
  const count=p.kind==='coaches'?amount(data.coaches):p.kind==='partners'?amount(data.sparringPartners):undefined
  return count===undefined?supportCategories[p.kind]:supportCategories[p.kind]+' '+count+' 人'
}
</script>
<template>
  <section class="industry-card svc-nearby-sites">
    <header><h4 class="service-section-title">{{ attractionsOnly?'周边景区与温泉':'周边设施' }}</h4><select v-if="!attractionsOnly || kinds.length>1" v-model="category" aria-label="周边设施名录类别">
      <option value="">全部类别</option><option v-for="k in kinds" :key="k" :value="k">{{ supportCategories[k] }}</option>
    </select></header>
    <table v-if="pager.total" class="industry-table" :class="{'with-capacity':metrics}"><thead><tr><th scope="col">设施名称</th><th scope="col">{{ metrics?'服务能力':'服务' }}</th><th scope="col">距离</th></tr></thead>
      <tbody><tr v-for="p in pager.rows" :key="facilitySiteKey(p)"><td><button type="button" class="industry-row-action" :title="p.feature.properties.name" @click="emit('select',p)">{{ p.feature.properties.name }}</button></td>
        <td :title="descriptor(p)"><template v-if="metrics">{{ descriptor(p) }}</template><template v-else><i :style="{color:serviceSymbols[p.kind].color}">{{ serviceSymbols[p.kind].glyph }}</i>{{ supportCategories[p.kind] }}</template></td><td>{{ serviceDistance(p.meters) }}</td></tr></tbody></table>
    <p v-else>{{ radius }} 公里内暂无{{ category?supportCategories[category]:(attractionsOnly?'景区或温泉':'配套设施') }}</p>
    <ServicePager v-if="pager.pageCount>1 || pager.total>6" :pagination="pager" label="周边设施分页" unit="处" compact/>
  </section>
</template>
<style scoped>
.v14-services .svc-nearby-sites{container:nearby-sites / inline-size;min-width:0;gap:8px;padding:8px 12px}
.svc-nearby-sites header{display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:center;gap:8px}
.svc-nearby-sites h4{margin:0;white-space:nowrap;font:700 18px/26px var(--v14-font)}
.svc-nearby-sites header select{justify-self:end;width:auto;max-width:100%;min-width:0}
.svc-nearby-sites p{margin:0}
.svc-nearby-sites table{width:100%;table-layout:fixed}
.svc-nearby-sites th:nth-child(2){width:92px}
.svc-nearby-sites .with-capacity th:nth-child(2){width:132px}
.svc-nearby-sites th:last-child{width:76px}
.svc-nearby-sites :is(td,th):last-child{text-align:end}
.svc-nearby-sites td,.svc-nearby-sites button{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.svc-nearby-sites td button{display:block;max-width:100%}
.svc-nearby-sites td i{display:inline-grid;place-items:center;margin-right:4px;width:22px;height:22px;border:1px solid currentColor;border-radius:6px;background:#102746;font:700 16px/1 var(--v14-font)}
@container (max-width:360px) {
  .v14-services .svc-nearby-sites{padding:8px}
  .svc-nearby-sites .with-capacity th:nth-child(2){width:120px}
  .svc-nearby-sites th:last-child{width:64px}
  .v14-services .svc-nearby-sites :is(td,th){padding-inline:4px}
}
@container nearby-sites (max-width:320px) {
  .svc-nearby-sites .with-capacity thead {position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden}
  .svc-nearby-sites .with-capacity,.svc-nearby-sites .with-capacity tbody {display:block}
  .svc-nearby-sites .with-capacity tr {display:grid;grid-template-columns:minmax(0,1fr) max-content;gap:0 8px;padding:4px 8px;border-bottom:1px solid var(--industry-table-line)}
  .svc-nearby-sites .with-capacity tbody tr:last-child {border-bottom:0}
  .v14-services .svc-nearby-sites .with-capacity td {height:auto;min-width:0;padding:0;border:0;line-height:24px}
  .svc-nearby-sites .with-capacity td:first-child {grid-column:1/-1;font-weight:700}
}
</style>
