<script setup lang="ts">
import {computed} from 'vue'
import ServiceResourceMetric from './ServiceResourceMetric.vue'
import {capacityFigure, type SupportKind, type SupportMetric} from './venue-support'

const props=defineProps<{rows:SupportMetric[]; interactive?:boolean; category?:SupportKind|''}>()
const emit=defineEmits<{select:[kind:SupportKind]}>()
const icons={beds:'lodging',seats:'dining',spaces:'parking',charging:'charging'} as const
const figures=computed(()=>props.rows.map(row=>({kind:row.kind,icon:icons[row.id],...capacityFigure(row)})))
</script>

<template>
  <div class="venue-capacity"><div class="venue-capacity-grid" role="group" aria-label="周边配套容量">
    <ServiceResourceMetric v-for="f in figures" :key="f.kind" compact :icon="f.icon" :label="f.label"
      :value="f.value===undefined ? '—' : (f.minimum ? '≥ ' : '')+f.value.toLocaleString('zh-CN')"
      :unit="f.value===undefined ? undefined : f.unit" :interactive="interactive" :pressed="category===f.kind"
      @click="interactive && emit('select',f.kind)"/>
  </div></div>
</template>

<style scoped>
.venue-capacity {container:venue-capacity / inline-size;min-width:0}
.venue-capacity-grid {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}
@container venue-capacity (min-width:464px) {
  .venue-capacity-grid {grid-template-columns:repeat(4,minmax(0,1fr))}
}
</style>
