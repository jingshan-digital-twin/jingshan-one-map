<script setup lang="ts">
import OverviewPanelIcon from './OverviewPanelIcon.vue'

defineProps<{icon:string; label:string; value:string|number; unit?:string; compact?:boolean; interactive?:boolean; pressed?:boolean}>()
</script>

<template>
  <component :is="interactive ? 'button' : 'div'" class="industry-card svc-resource" :class="{'capacity-tile':compact}"
    :type="interactive ? 'button' : undefined" :aria-pressed="interactive ? !!pressed : undefined">
    <OverviewPanelIcon :name="icon" :variant="compact?'symbol':'illustrated'"/>
    <span class="svc-resource-copy">
      <b>{{ label }}</b><span class="svc-resource-value"><strong>{{ value }}</strong><span v-if="unit"> {{ unit }}</span></span>
    </span>
  </component>
</template>

<style scoped>
.v14-services .svc-resource {
  display:flex; align-items:center; gap:8px; min-width:0; min-height:64px; padding:8px;
  text-align:start; color:var(--v14-ink); background:var(--v14-tab);
}
button.svc-resource {cursor:pointer}
button.svc-resource:is(:hover,:focus-visible) {border-color:var(--v14-edge)}
.v14-services .svc-resource[aria-pressed="true"] {border-color:var(--v14-metric); background:var(--industry-selected)}
.svc-resource svg {width:28px;height:28px;flex:none}
.svc-resource-copy {display:grid;min-width:0;white-space:nowrap;font:400 16px/24px var(--v14-font)}
.svc-resource-value {color:var(--v14-ink);font:400 16px/26px var(--v14-font);white-space:nowrap}
.svc-resource-value strong {color:var(--v14-metric);font:400 20px/30px "Cockpit Bebas",var(--v14-font)}
.v14-services .svc-resource.capacity-tile {min-height:54px;gap:6px;padding:4px 8px;border-radius:2px}
.capacity-tile svg {width:24px;height:24px;color:var(--v14-metric)}
.capacity-tile .svc-resource-copy {line-height:20px}
.capacity-tile .svc-resource-value {line-height:22px}
.capacity-tile .svc-resource-value strong {font-size:18px;line-height:26px}
@container support-overview (max-width:284px) {
  .v14-services .svc-resource {gap:6px}
  .svc-resource svg {width:24px;height:24px}
}
@container support-overview (max-width:255px) {
  .v14-services .svc-resource {min-height:44px}
  .svc-resource-copy {display:flex;align-items:center;justify-content:space-between;flex:1;gap:6px}
}
</style>
