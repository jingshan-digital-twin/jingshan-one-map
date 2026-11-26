<script setup lang="ts">
import {computed,useId} from 'vue'
import ServiceResourceMetric from './ServiceResourceMetric.vue'
import {coverageRadii, estimatedPeople, populationViews, type CoverageGridSummary, type PopulationView} from './overview-court-coverage'
import {supportCategories,supportSummary,type Facility,type SupportKind} from './venue-support'
import {dashboardPalette} from './dashboard-palette'
import {serviceSymbols} from './service-point-markers'
const props=defineProps<{section:'venues'|'facilities';region:string;coverage?:CoverageGridSummary;populationView:PopulationView;populationVisible:boolean;
  radiusM:number;supports:Facility[];selectedKind:SupportKind|''}>()
const emit=defineEmits<{category:[kind:SupportKind];
  'population-view':[view:PopulationView];'population-radius':[meters:number]}>()
const ratio=computed(()=>{
  const c=props.coverage
  return c?.hasCourts && c.groups.all.people ? 100*c.groups.covered.people/c.groups.all.people : undefined
})
const metrics=computed(()=>populationViews.map(view=>{
  const c=props.coverage
  const available=!!c?.groups.all.grids && (view.id==='all' || c.hasCourts)
  const group=c?.groups[view.id]
  const people=c && available && group ? estimatedPeople(group,c.groups.all.known>0) : undefined
  return {...view,available,people,grids:group?.grids??0}
}))
function changeRadius(event: Event) {
  emit('population-radius',Number((event.target as HTMLSelectElement).value))
}
const gaugeId=useId()
const categories=computed(()=>supportSummary(props.supports,true))
const sites=computed(()=>categories.value.reduce((sum,row)=>sum+row.count,0))
const types=computed(()=>{
  let end=0
  return categories.value.map(({kind,count})=>{
    const start=end
    const share=sites.value ? count/sites.value*100 : 0
    end+=share
    const color=serviceSymbols[kind].color
    return {kind,count,color,share:share.toLocaleString('zh-CN',{maximumFractionDigits:1})+'%',stop:color+' '+start+'% '+end+'%'}
  })
})
const ringFill=computed(()=>'conic-gradient('+types.value.filter(row=>row.count>0).map(row=>row.stop).join(',')+')')
</script>
<template>
  <template v-if="section==='venues'">
    <label class="population-radius">球场覆盖半径
      <select aria-label="球场覆盖半径" :value="radiusM" @change="changeRadius"><option v-for="r in coverageRadii" :key="r" :value="r">{{ r/1000 }} 公里</option></select>
    </label>
    <div class="population-metrics" role="group" aria-label="人口网格显示范围">
      <button v-for="m in metrics" :key="m.id" type="button" class="industry-card population-metric"
        :disabled="!m.available" :aria-pressed="populationVisible && populationView===m.id" :title="m.layer+' · '+m.grids.toLocaleString('zh-CN')+' 个原始网格'"
        @click="emit('population-view',m.id)">
        <span>{{ m.metric }}</span><span class="population-value"><b>{{ m.people===undefined?'—':m.people.toLocaleString('zh-CN') }}</b><small v-if="m.people!==undefined"> 人</small></span>
      </button>
    </div>
    <section class="industry-card svc-overview-chart">
      <h3>人口覆盖率</h3>
      <div class="svc-gauge-layout"><div class="svc-gauge">
        <svg viewBox="0 0 200 110" aria-hidden="true">
          <defs><linearGradient :id="gaugeId"><stop stop-color="#2371f7"/><stop offset="1" stop-color="#07eeff"/></linearGradient></defs>
          <path d="M12 98 A88 88 0 0 1 188 98" fill="none" stroke="var(--v14-chart-track)" stroke-width="14" stroke-linecap="round"/>
          <path v-if="ratio!==undefined" d="M12 98 A88 88 0 0 1 188 98" fill="none" :stroke="'url(#'+gaugeId+')'" stroke-width="14" stroke-linecap="round" pathLength="100" :stroke-dasharray="ratio+' 100'"/></svg>
        <strong>{{ ratio===undefined?'待核实':ratio.toFixed(1)+'%' }}</strong></div>
        <div class="svc-chart-key"><span><i :style="{background:dashboardPalette.blue}"></i>已覆盖</span><span><i style="background:var(--v14-chart-track)"></i>未覆盖</span></div>
      </div>
      <p v-if="!coverage?.groups.all.grids">{{ region }}暂无人口网格。</p>
      <p v-else-if="!coverage.hasCourts">暂无已定位的实测球场，覆盖人口待核实。</p>
    </section>
    <slot name="booking-statistics" />
  </template>
  <div v-else-if="sites" class="svc-support-overview">
    <div class="svc-resource-grid" role="group" aria-label="配套服务能力">
      <ServiceResourceMetric v-for="row in categories" :key="row.kind" :icon="'support-'+row.kind" :label="row.label"
        :value="row.value" :unit="row.unit" compact interactive :pressed="selectedKind===row.kind" @click="emit('category',row.kind)"/>
    </div>
    <section class="industry-card svc-composition">
      <h3 class="service-section-title">配套类型占比</h3>
      <div class="svc-support-ring" :style="{'--support-segments':ringFill}" role="img" :aria-label="'配套设施共'+sites+'处'">
        <span><strong>{{ sites }}</strong> 处</span>
      </div>
      <ul class="svc-support-legend" aria-label="设施类别占比">
        <li v-for="r in types" :key="r.kind">
          <i aria-hidden="true" :style="{background:r.count ? r.color : 'var(--v14-chart-track)'}"></i>
          <span>{{ supportCategories[r.kind] }}</span><b>{{ r.share }}</b>
        </li>
      </ul>
    </section>
  </div>
  <p v-else class="industry-card">当前范围暂无配套设施</p>
</template>
<style scoped>
.svc-overview-chart h3,.svc-overview-chart p{margin:0}
.svc-overview-chart p{color:var(--v14-muted);font-size:16px}
.population-radius {display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--v14-ink);font:600 16px/24px var(--v14-font)}
.population-radius select {width:auto;min-width:86px;color:var(--v14-ink);background:var(--v14-tab);border:1px solid var(--v14-edge);border-radius:2px;padding:2px 6px;font:400 16px/24px var(--v14-font)}
.population-metrics {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.v14-services .population-metric {display:grid;gap:2px;text-align:left;min-width:0;padding:5px 8px;border-radius:2px;background:var(--v14-tab);color:var(--v14-ink);font:400 16px/22px var(--v14-font);cursor:pointer}
.v14-services .population-metric[aria-pressed="true"] {border-color:var(--v14-metric);background:var(--industry-selected);box-shadow:inset 3px 0 var(--v14-metric)}
.population-metric:focus-visible,.population-radius select:focus-visible {outline:2px solid var(--v14-metric);outline-offset:1px}
.population-metric:disabled {cursor:default;opacity:.65}
.population-value {white-space:nowrap}.population-value b {color:var(--v14-metric);font:400 26px/28px "Cockpit Bebas",var(--v14-font)}.population-value small {font-size:14px}
.svc-overview-chart{display:grid;gap:12px}
.svc-gauge{width:min(220px,80%);position:relative;justify-self:center;color:var(--v14-metric)}
.svc-gauge svg{display:block;width:100%}.svc-gauge strong{position:absolute;inset:auto 0 4px;text-align:center;font:700 32px/40px var(--v14-font)}
.svc-support-overview {
  display:grid;
  gap:8px;
  min-width:0;
  container:facility-overview / inline-size;
}
.svc-resource-grid {
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:4px;
}
.v14-services .svc-composition {
  display:grid;
  grid-template-columns:minmax(0,1fr) auto;
  align-items:center;
  gap:8px;
  padding:8px;
}
.svc-composition h3 { margin:0; }
.svc-support-ring {
  position:relative;
  display:grid;
  place-items:center;
  width:72px;
  aspect-ratio:1;
}
.svc-support-ring::before {
  content:"";
  position:absolute;
  inset:0;
  border-radius:50%;
  background:var(--support-segments);
  mask:radial-gradient(transparent 52%, #000 53%);
}
.svc-support-ring span { color:var(--v14-ink); white-space:nowrap; font:400 14px/24px var(--v14-font); }
.svc-support-ring strong { color:var(--v14-metric); font:400 20px/26px 'Cockpit Bebas',var(--v14-font); }
.svc-support-legend {
  display:grid;
  grid-column:1/-1;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:0 12px;
  margin:0;
  padding:0;
  list-style:none;
}
.svc-support-legend li {
  display:grid;
  grid-template-columns:8px minmax(0,1fr) auto;
  align-items:center;
  gap:4px;
  min-width:0;
  border-top:1px solid var(--v14-list-line);
  font:400 14px/24px var(--v14-font);
  white-space:nowrap;
}
.svc-support-legend i { width:8px; height:8px; border-radius:2px; }
.svc-support-legend b { color:var(--v14-metric); font-variant-numeric:tabular-nums; }
@container facility-overview (max-width:290px) {
  .svc-resource-grid :deep(.capacity-tile) { gap:4px; padding-inline:5px; }
  .svc-resource-grid :deep(.capacity-tile svg) { width:20px; height:20px; }
  .svc-resource-grid :deep(.svc-resource-copy b) { font-size:14px; }
  .svc-support-legend { column-gap:8px; }
}
@container facility-overview (max-width:236px) {
  .svc-resource-grid :deep(.capacity-tile svg) { display:none; }
  .svc-support-legend { column-gap:6px; }
  .svc-composition h3 { max-width:7em; }
}
@container facility-overview (max-width:185px) {
  .svc-support-legend li { grid-template-columns:8px 1fr; }
  .svc-support-legend b { grid-column:2; }
}
.svc-gauge-layout{display:flex;align-items:center;justify-content:space-evenly;gap:8px}.svc-gauge-layout .svc-gauge{width:min(55%,220px)}
.svc-chart-key span{white-space:nowrap}
.svc-chart-key{display:flex;justify-content:center;gap:6px 12px;flex-wrap:wrap;font-size:16px}.svc-chart-key i{display:inline-block;width:10px;height:10px;margin-right:5px}
@container (max-width: 300px) {
  .svc-gauge-layout { flex-direction: column; }
  .svc-gauge-layout .svc-gauge { width: min(100%, 176px); }
}
@container (max-width: 235px) {
  .population-metrics {grid-template-columns:1fr}
  .v14-services .population-metric {display:flex;justify-content:space-between;align-items:center}
}
</style>

