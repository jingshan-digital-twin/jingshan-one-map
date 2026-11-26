<script setup lang="ts">
import { computed, ref } from 'vue'
import VenueOpeningTaskList from './VenueOpeningTaskList.vue'
import VenueOpeningCoordination from './VenueOpeningCoordination.vue'
import type { CityFeature, DataDocument } from './types'
import { workspaceEdition } from './workspace-artwork'
import { openingStageLabels, type OpeningTask, type OpeningTaskRow } from './venue-opening'
import PortalIcon from './PortalIcon.vue'
import './workspace-ledgers.css'
const props = defineProps<{ published: DataDocument }>()
const emit = defineEmits<{ changed: [] }>()
type Venue = { id: string; name: string; feature?: CityFeature }
const venues = computed(() => {
  const map = new Map<string, Venue>()
  for (const f of props.published.datasets.find((d) => d.id === 'venues')?.features ?? [])
    map.set(f.id, { id: f.id, name: f.properties.name, feature: f })
  for (const f of props.published.datasets.find((d) => d.id === 'courts')?.features ?? []) {
    if(f.properties.ledgerId && !f.properties.facilityName) continue
    const id =
      typeof f.properties.facilityId === 'string' && f.properties.facilityId.trim()
        ? f.properties.facilityId
        : f.id
    if (!map.has(id)) map.set(id, { id, name: String(f.properties.facilityName || f.properties.name), feature: f })
  }
  return map
})
const current = ref<Venue>(),
  taskId = ref(''),
  selected = ref(''),
  key = ref(0)
const picker = ref<HTMLDialogElement>()
const pageTasks = ref<OpeningTaskRow[]>([])
const taskDetail = ref<OpeningTask | null>(null)
const summary = computed(() => current.value
  ? taskDetail.value ?? pageTasks.value.find(row => row.id === taskId.value)
  : pageTasks.value[0])
function open(id: string, name: string, task = '') {
  taskDetail.value = null
  taskId.value = task
  current.value = venues.value.get(id) ?? { id, name }
}
function closeDetail() {
  current.value = undefined
  taskId.value = ''
  taskDetail.value = null
}
function onTaskChanged() {
  key.value++
  emit('changed')
}
</script>
<template>
  <section v-if="workspaceEdition" class="wlo-workspace">
    <VenueOpeningTaskList :mode="published.mode" region="京山市" :refresh-key="key" :selected-id="taskId" workspace-layout
      @rows="pageTasks=$event" @select="s=>open(s.venueId,s.venueName,s.taskId)">
      <template #workspace-actions><button class="wlo-primary" type="button" @click="picker?.showModal()">办理场馆开放</button></template>
    </VenueOpeningTaskList>
    <button v-if="summary" type="button" class="wlo-summary" :aria-expanded="!!current"
      @click="current ? closeDetail() : open(summary.venueId,summary.venueName,summary.id)">
      <strong><PortalIcon name="results" :size="17"/>工单详情</strong><span>责任单位 <b>{{summary.department}}</b></span>
      <span>办理期限 <b>{{summary.due}}</b></span><span>当前状态 <b>{{openingStageLabels[summary.stage]}}</b></span>
      <PortalIcon name="chevron" :size="15"/>
    </button>
    <dialog ref="picker" class="wlo-picker" aria-label="办理场馆开放">
      <form method="dialog" @submit.prevent="open(selected, ''); picker?.close()">
        <header><h2>办理场馆开放</h2><button type="button" aria-label="关闭选择场馆" @click="picker?.close()"><PortalIcon name="close" :size="16"/></button></header>
        <label>选择交办场馆<select v-model="selected" required><option value="">选择场馆</option><option v-for="v in venues.values()" :key="v.id" :value="v.id">{{v.name}}</option></select></label>
        <footer><button type="button" @click="picker?.close()">取消</button><button class="wlo-primary" :disabled="!selected">查看办理详情</button></footer>
      </form>
    </dialog>
  </section>
  <section v-else class="platform-card platform-opening">
    <header>
      <h2>协调任务</h2>
      <span>{{ published.mode === 'demo' ? '演示台账' : '业务台账' }}</span>
    </header>
    <div class="opening-toolbar">
      <select aria-label="选择交办场馆" v-model="selected">
        <option value="">选择场馆</option>
        <option v-for="v in venues.values()" :key="v.id" :value="v.id">{{ v.name }}</option>
      </select>
      <button class="primary" :disabled="!selected" @click="open(selected, '')">办理场馆开放</button>
    </div>
    <VenueOpeningTaskList
      :mode="published.mode"
      region="京山市"
      :refresh-key="key"
      :selected-id="taskId"
      @select="(s) => open(s.venueId, s.venueName, s.taskId)"
    />
  </section>
  <section v-if="current" class="platform-card platform-opening">
    <header>
      <h2>{{ current.name }}</h2>
      <button @click="workspaceEdition ? closeDetail() : (current = undefined)">收起详情</button>
    </header>
    <VenueOpeningCoordination
      :key="current.id + taskId"
      :mode="published.mode"
      :venue="current"
      :task-id="taskId || undefined"
      @detail="taskDetail=$event"
      @changed="onTaskChanged"
    />
  </section>
</template>

<style scoped>
.platform-opening {min-width:0}
.platform-opening button.primary {background:#176f72;color:#f2ffff;border-color:#318f91}
.platform-opening :deep(.svc-task-table){min-width:750px}
.platform-opening :deep(.svc-task-table :is(th,td)){white-space:nowrap}
.platform-opening :deep(.svc-task-table .industry-row-action){display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;min-width:0}
.platform-opening :deep(.opening-task-filters input[type=search]){width:100%}
.platform-opening :deep(.opening-steps){--v14-chart-track:#385061}
@media(max-width:600px){.platform-opening .opening-toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto}.platform-opening .opening-toolbar select{width:100%}}
</style>
