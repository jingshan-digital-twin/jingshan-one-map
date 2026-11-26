<script setup lang="ts">
import OverviewPanelIcon from './OverviewPanelIcon.vue'

defineProps<{ label: string; value: string | number; unit?: string; icon: string; missing?: boolean; interactive?: boolean }>()
</script>

<template>
  <component :is="interactive ? 'button' : 'div'" :type="interactive ? 'button' : undefined" class="event-stat">
    <span class="event-stat-label">{{ label }}</span>
    <span class="event-stat-value" :class="{missing}"><b>{{ value }}</b><span v-if="unit && !missing">{{ unit }}</span></span>
    <OverviewPanelIcon :name="icon" />
  </component>
</template>

<style scoped>
.event-stat.event-stat {
  display:grid; grid-template-columns:minmax(0,1fr) auto; grid-template-rows:auto 1fr;
  align-items:center; gap:0 3px; min-width:0; min-height:0; margin:0; padding:4px 8px;
  color:var(--v14-ink); background:var(--v14-list); border:1px solid var(--v14-edge); border-radius:3px; text-align:left;
}
.event-stat-label { grid-column:1/-1; font:400 16px/22px var(--v14-font); text-wrap:pretty; }
.event-stat-value { white-space:nowrap; font:400 16px/22px var(--v14-font); }
.event-stat-value > span { margin-inline-start:3px; }
.event-stat-value b { color:var(--v14-metric); font:400 22px/24px "Cockpit Bebas",var(--v14-font); font-variant-numeric:tabular-nums; }
.event-stat-value.missing b { font:inherit; color:var(--v14-muted); }
.event-stat .overview-panel-icon { width:26px; height:24px; }
</style>
