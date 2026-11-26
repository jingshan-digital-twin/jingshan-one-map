<script setup lang="ts">
defineProps<{total:number; selected:number; label:string}>()
defineEmits<{all:[]; clear:[]}>()
</script>
<template><div class="platform-selection-bar"><label><input type="checkbox" :aria-label="'全选'+label" :checked="total>0&&selected===total" :indeterminate="selected>0&&selected<total" :disabled="!total" @change="$emit('all')"/>全选筛选结果</label><span>已选 {{selected}} / {{total}}</span><button v-if="selected" type="button" @click="$emit('clear')">清除选择</button><slot/></div></template>
<style scoped>.platform-selection-bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;padding:7px 0;min-width:0;color:var(--platform-muted);font-size:13px}.platform-selection-bar label{display:inline-flex;align-items:center;gap:6px;color:var(--platform-ink);cursor:pointer}.platform-selection-bar input{width:16px;height:16px;accent-color:var(--cyan)}.platform-selection-bar button{font:inherit;min-height:29px}</style>
