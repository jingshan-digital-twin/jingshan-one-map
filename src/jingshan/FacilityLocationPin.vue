<script setup lang="ts">
import {computed} from 'vue'
import {servicePictograms} from './service-pictograms'

const props=defineProps<{kind?:string; color?:string; center?:boolean}>()
const glyph = computed(()=>servicePictograms[props.kind as keyof typeof servicePictograms] ?? 'M7 12h10m-5-5v10')
</script>
<template>
  <svg :viewBox="center ? '0 0 44 44' : '0 0 30 34'" aria-hidden="true">
    <g v-if="center" class="range-anchor" fill="none">
      <ellipse class="range-anchor-wave" cx="22" cy="42" rx="21" ry="5.5" fill="#9bf0ff" fill-opacity=".25" stroke="#baf5ff" stroke-width="1.25"/>
      <ellipse cx="22" cy="42" rx="12" ry="3.2" fill="#164387" fill-opacity=".56" stroke="#e2fbff" stroke-width="1.7"/>
      <circle cx="22" cy="42" r="2.2" fill="#fff"/>
    </g>
    <g :transform="center ? 'translate(3.25 0.75) scale(1.25)' : undefined">
      <path class="pin-outline" d="M15 33S2 21 2 14a13 13 0 0 1 26 0c0 7-13 19-13 19Z"
        :fill="color||'#287ac2'" :stroke="center ? '#e2fbff' : 'white'" :stroke-width="center ? 2 : 1.5"/>
      <circle cx="15" cy="14" r="9.7" fill="#143451"/>
      <path :d="glyph" :transform="kind==='venue' ? 'translate(5.4 4.4) scale(.8)' : 'translate(7.3 6.3) scale(.64)'"
        fill="none" stroke="white" :stroke-width="kind==='venue' ? 1.65 : 2.4" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </svg>
</template>
