<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CimService } from './cim-types'
import { cimProtocols } from './cim-types'
import type { CimMapStatus } from './cim-map'

const props = defineProps<{ services: CimService[]; visible: string[]; states: Record<string, CimMapStatus>; error: string }>()
defineEmits<{ toggle: [id: string]; reload: [] }>()
const filter = ref('')
const matches = computed(() => {
  const term = filter.value.trim().toLowerCase()
  return props.services.filter(item => !term || [item.name, item.category, item.kind].join(' ').toLowerCase().includes(term))
})
function status(item: CimService) {
  const state = props.states[item.id]
  if (props.visible.includes(item.id) && state && state.state !== 'off') {
    return { loading: '载入中', ready: '已加载', error: state.message || '加载失败' }[state.state]
  }
  return item.status === 'online' ? '可用' : item.status === 'unchecked' ? '待检测' : item.statusMessage || '服务不可用'
}
</script>

<template>
  <details class="cim-layer-catalog" open>
    <summary>地图服务图层 <small>（{{ services.length }}）</small></summary>
    <p v-if="error" role="alert">{{ error }} <button class="mini" type="button" @click="$emit('reload')">重试</button></p>
    <template v-else-if="services.length">
      <input v-model="filter" class="cim-layer-search" type="search" aria-label="筛选 CIM 图层" placeholder="按名称、主题或协议筛选" />
      <label v-for="item in matches" :key="item.id" class="cim-layer-row">
        <input type="checkbox" :checked="visible.includes(item.id)" @change="$emit('toggle', item.id)" />
        <span>{{ item.name }}<small>{{ cimProtocols[item.kind] }} · {{ status(item) }}</small></span>
      </label>
      <p v-if="!matches.length">没有匹配的服务。</p>
    </template>
    <p v-else>暂无已启用的图层服务。</p>
  </details>
</template>

<style scoped>
.cim-layer-catalog .cim-layer-search { box-sizing: border-box; width: 100%; margin: 4px 0 6px; padding: 6px 8px; border: 1px solid var(--v14-list-line); border-radius: 2px; color: var(--v14-ink); background: var(--v14-list); font: inherit; }
.cim-layer-search::placeholder { color: var(--v14-muted); }
.cim-layer-row { display: flex; align-items: flex-start; gap: 8px; padding: 4px 8px; cursor: pointer; line-height: 1.4; }
.cim-layer-row input { flex: none; margin: 4px 0 0; }
.cim-layer-row small { display: block; color: var(--v14-muted); overflow-wrap: anywhere; }
</style>
