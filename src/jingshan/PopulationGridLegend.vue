<script setup lang="ts">
import { computed } from 'vue'
import { noPopulationData, plannedCoverageColor, populationBands } from './population-grid.ts'

const props=defineProps<{view?:string; missing?:boolean; minimum?:number; showPlanned?:boolean}>()
const gradient = 'linear-gradient(to right, ' + populationBands.map(band => band.color).join(', ') + ')'
const gapBands=computed(()=>populationBands.flatMap((band,i)=>{
  const low=Math.max(band.min,props.minimum??0), high=populationBands[i+1]?.min
  if(high!==undefined && high<=low)return []
  return [{color:band.color,label:high===undefined?'≥ '+low.toLocaleString('zh-CN'):low.toLocaleString('zh-CN')+'–<'+high.toLocaleString('zh-CN')}]
}))
</script>

<template>
  <section class="population-key" aria-label="人口密度图例">
    <strong class="population-view">{{ view || '人口密度' }}<small v-if="minimum!==undefined">（人/km²）</small></strong>
    <template v-if="minimum!==undefined">
      <span v-for="band in gapBands" :key="band.color" class="population-entry"><b :style="{background:band.color}" aria-hidden="true"></b>{{ band.label }}</span>
    </template>
    <div v-else class="population-scale"><span>低</span><b class="population-ramp" :style="{backgroundImage:gradient}" aria-label="人口密度"></b><span>高</span></div>
    <span v-if="showPlanned" class="population-entry"><b :style="{background:plannedCoverageColor}" aria-hidden="true"></b>方案新增覆盖</span>
    <span v-if="missing" class="population-entry"><b :style="{background:noPopulationData.color}" aria-hidden="true"></b>无数据</span>
  </section>
</template>

<style scoped>
.population-key { display:grid; gap:3px; width:max-content; max-width:100%; color:inherit; white-space:nowrap; font:inherit }
.population-scale { display:flex; align-items:center; gap:6px }
.population-entry{display:flex;align-items:center;gap:6px}
.population-entry b{width:14px;height:9px;border-radius:1px}
.population-key strong{font-weight:600}.population-key small{font:inherit;color:var(--v14-muted)}
.population-ramp { width:clamp(55px,5vw,80px); height:8px; border-radius:3px; box-shadow:inset 0 0 0 1px rgb(20 46 73 / 23%) }
</style>
