<script lang="ts">
export interface EventLegendRow {
  id: string
  label: string
  group?: string
  color: string
  shape?: 'line' | 'dash' | 'stripe' | 'area' | 'area-dash'
  value?: string
  glyph?: string
  pinKind?: string
  center?: boolean
  active?: boolean
  select?: () => void
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import FacilityLocationPin from './FacilityLocationPin.vue'

const props=defineProps<{ rows: EventLegendRow[] }>()
const selected=ref('')
const groups=computed(()=>[...new Set(props.rows.map(r=>r.group).filter((s):s is string=>!!s))])
const activeGroup=computed(()=>groups.value.includes(selected.value)?selected.value:groups.value[0])
const shown=computed(()=>props.rows.filter(r=>!r.group||r.group===activeGroup.value))
const compact = window.matchMedia('(max-width: 600px), (max-height: 540px)')
const expanded = ref(!compact.matches)
function adapt() { expanded.value = !compact.matches }
onMounted(() => compact.addEventListener('change', adapt))
onBeforeUnmount(() => compact.removeEventListener('change', adapt))
</script>

<template>
  <aside v-if="rows.length" class="business-map-legend event-map-legend" aria-label="赛事地图图例">
    <button class="legend-toggle" type="button" :aria-expanded="expanded" @click="expanded=!expanded">
      图例 <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 4-4 4 4"/></svg>
    </button>
    <nav v-if="expanded && groups.length>1" class="legend-groups" aria-label="图例分类">
      <button v-for="name in groups" :key="name" type="button" :aria-pressed="name===activeGroup" @click="selected=name">{{ name }}</button>
    </nav>
    <div v-if="expanded" class="legend-items">
      <component v-for="row in shown" :key="row.id" :is="row.select ? 'button' : 'span'"
        class="legend-row" :type="row.select ? 'button' : undefined" :aria-pressed="row.active" @click="row.select?.()">
        <FacilityLocationPin v-if="row.pinKind" class="legend-location-pin" :kind="row.pinKind" :color="row.color" :center="row.center"/>
        <i v-else :data-role="row.glyph ? 'glyph' : row.shape ?? 'support'" :style="{'--symbol':row.color}" aria-hidden="true">{{row.glyph}}</i>
        {{ row.label }}<b v-if="row.value">{{ row.value }}</b>
      </component>
    </div>
  </aside>
</template>

<style scoped>
.business-map-legend.event-map-legend {
  left: 8px; bottom: max(8px,calc(var(--scene-footer-height) - var(--rail-bottom-inset) + 8px)); z-index: 2;
  display: grid; align-items: stretch; gap: 0; width: max-content; max-width: calc(100% - 68px);
  max-height: min(40%, 230px); box-sizing: border-box; padding: 6px 9px;
  grid-template-rows: auto auto minmax(0,1fr); pointer-events: auto; font: 400 16px/24px var(--v14-font);
}
.event-map-legend .legend-toggle { display: none; }
.event-map-legend .legend-groups { grid-row: 2; display:flex; gap: 2px; margin-bottom: 4px; }
.event-map-legend .legend-groups button { min-height: 24px; padding: 0 6px; border: 1px solid var(--v14-list-line); background: var(--v14-tab); color: var(--v14-ink); font: inherit; }
.event-map-legend .legend-groups button[aria-pressed="true"] { color: white; background: var(--v14-tab-active); }
.event-map-legend .legend-items { grid-row: 3; display: grid; gap: 2px; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.event-map-legend .legend-row,.event-map-legend .legend-toggle {
  align-items: center; gap: 6px; min-height: 24px; margin: 0; padding: 0 2px;
  border: 0; border-radius: 0; background: none; box-shadow: none; color: inherit;
  font: inherit; text-align: left; white-space: nowrap;
}
.event-map-legend .legend-row { display: grid; grid-template-columns: 16px auto 1fr; }
.event-map-legend .legend-row b { justify-self: end; margin-left: 4px; font-weight: 400; font-variant-numeric: tabular-nums; }
.event-map-legend .legend-row i { justify-self: center; }
.event-map-legend .legend-row i[data-role=glyph] {
  width: 20px; height: 20px; border: 1px solid var(--symbol); border-radius: 3px;
  color: var(--symbol); background: #103755; text-align: center; font: 600 16px/18px var(--v14-font);
}
.event-map-legend .legend-row i:is([data-role=line],[data-role=dash],[data-role=stripe]) {
  width: 16px; height: 0; border: 0; border-top: 3px solid var(--symbol); border-radius: 0; background: transparent;
}
.event-map-legend .legend-row i[data-role=dash] { border-top-style: dashed; }
.event-map-legend .legend-row i[data-role=area-dash] { border:2px dashed var(--symbol); }
.event-map-legend .legend-row i[data-role=stripe] { height: 5px; border: 0; background: repeating-linear-gradient(120deg,var(--symbol) 0 4px,#ffe3bc 4px 6px); }
.event-map-legend button.legend-row:is(:hover,[aria-pressed=true],:focus-visible) {
  color: var(--v14-ink); background: var(--v14-list); box-shadow: inset 2px 0 var(--v14-icon);
}
.event-map-legend .legend-toggle svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.7; }
.event-map-legend .legend-toggle[aria-expanded=true] svg { transform: rotate(180deg); }
@media(max-width:1000px) {
  .business-map-legend.event-map-legend { bottom: max(8px,calc(var(--scene-footer-height) - var(--event-footer-room) + 8px)); }
}
@media(max-width:600px),(max-height:540px) {
  .event-map-legend .legend-toggle { display: flex; justify-content: space-between; width: 100%; gap: 8px; }
  .event-map-legend .legend-items { margin-top: 3px; }
}
</style>

<style>
.jt-screen :is(.ep-center,.el-center,.er-center):has(.event-tool-menu,.home-region-popover,.scene-assistant-panel) > .event-map-legend { visibility: hidden; }
</style>
