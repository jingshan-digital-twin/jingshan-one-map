<script setup lang="ts">
defineProps<{ side: 'left' | 'right'; open: boolean }>()
</script>

<template>
  <aside v-show="open" :id="'dashboard-' + side" class="v14-overview-rail-shell industry-rail"
    :class="side + '-panel'" :aria-label="side === 'left' ? '产业推介左侧面板' : '产业推介右侧面板'" tabindex="0">
    <slot />
  </aside>
</template>
