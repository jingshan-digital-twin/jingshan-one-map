<script setup lang="ts">
import IndustryModule from './IndustryModule.vue'
import IndustryRail from './IndustryRail.vue'
defineProps<{title:string;source?:string;side:'left'|'right';variant?:'industry'}>()
</script>
<template>
  <IndustryRail v-if="variant==='industry'" :side="side" :open="true" class="fusion-merchant-rail" :aria-label="title">
    <IndustryModule :title="title" fill>
      <slot/>
      <template v-if="$slots.actions" #actions><slot name="actions"/></template>
    </IndustryModule>
  </IndustryRail>
  <aside v-else class="dash-panel" :class="side+'-panel'" :aria-label="title">
    <header class="panel-header"><span class="chevrons" aria-hidden="true"></span><h2>{{ title }}</h2><small>{{ source }}</small></header>
    <div class="panel-body"><slot/></div>
    <footer v-if="$slots.actions" class="panel-actions"><slot name="actions"/></footer>
  </aside>
</template>
<style scoped>
.fusion-merchant-rail { --industry-gap: 12px; }
.fusion-merchant-rail :deep(.industry-module-body) { padding: 12px; }
.fusion-merchant-rail :deep(.industry-module-body > *) { min-width: 0; }
.fusion-merchant-rail :deep(.industry-module-body :is(p,span,small,button,input,select,th,td)) { font-size: 16px; }
.fusion-merchant-rail :deep(.industry-module-body .entry strong) { white-space: normal; line-height: 22px; overflow-wrap: anywhere; }
.fusion-merchant-rail :deep(.entry p) { white-space: normal; overflow: visible; }
.fusion-merchant-rail :deep(.industry-actions > button) {
  min-height: 38px; padding: 5px 10px; border: 1px solid var(--v14-list-line);
  border-radius: 4px; background: var(--v14-tab); color: var(--v14-ink); font-size: 16px; font-weight: 700;
}
</style>
