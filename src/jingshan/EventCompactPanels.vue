<script setup lang="ts">
defineProps<{leftLabel:string;rightLabel:string}>()
const panel=defineModel<'map'|'left'|'right'>({required:true})
</script>

<template>
  <nav class="event-compact-panels" aria-label="赛事内容面板">
    <button v-for="[key,label] in [['map','地图'],['left',leftLabel],['right',rightLabel]] as const"
      :key="key" type="button" :aria-pressed="panel===key" @click="panel=key">{{label}}</button>
  </nav>
</template>

<style scoped>
.event-compact-panels { display:none; }
@media(max-width:1000px) {
  .event-compact-panels {
    position:absolute; z-index:9; inset:8px 8px auto; display:flex; align-items:stretch;
    background:var(--event-dialog); border:1px solid var(--event-edge); pointer-events:auto;
  }
  .event-compact-panels button {
    flex:1; min-width:0; min-height:40px; padding:4px 8px; border:0; border-radius:0;
    background:var(--v14-tab); color:var(--event-ink); font:700 16px/24px var(--v14-font);
  }
  .event-compact-panels button[aria-pressed="true"] { color:white; background:var(--v14-tab-active); box-shadow:inset 0 -2px #ffae00; }
}
</style>
