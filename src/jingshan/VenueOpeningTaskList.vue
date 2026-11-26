<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { api } from './api'
import ServicePager from './ServicePager.vue'
import { servicePageSizes, type ServicePagination } from './service-pagination'
import { isOpeningActive,openingStageLabels,openingTaskLink,type OpeningMode,type OpeningTaskLink,type OpeningTaskRow,type OpeningStage } from './venue-opening'
import {chinaClock,scheduleState} from './opening-schedule'

const props = defineProps<{mode:OpeningMode; region:string; refreshKey:number; selectedId?:string; workspaceLayout?:boolean}>()
const emit = defineEmits<{rows:[items:OpeningTaskRow[]];select:[selection:OpeningTaskLink]}>()
const query = ref('')
const stage = ref<OpeningStage | ''>('')
const overdue=ref(false)
const page = ref(1)
const size = ref<number>(servicePageSizes[0])
const total = ref(0)
const rows = ref<OpeningTaskRow[]>([])
type Counts=Partial<Record<OpeningStage|'overdue',number>>
const counts=ref<Counts>({})
watch(rows,next=>emit('rows',next),{immediate:true})
const busy = ref(false)
const error = ref('')
let request = 0
let active: AbortController | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let focusId=props.selectedId
const table=ref<HTMLTableElement>()
const pagination = computed<ServicePagination>(() => ({
  page:page.value, total:total.value, pageCount:Math.max(1,Math.ceil(total.value/size.value)), pageSize:size.value,
  go: n => load(n),
  resize(n) {
    if (!servicePageSizes.some(s => s === n)) return
    const offset = (page.value - 1) * size.value
    size.value = n
    void load(Math.floor(offset / n) + 1)
  },
}))
async function load(n: number) {
  clearTimeout(timer)
  const current = ++request
  active?.abort()
  active = new AbortController()
  busy.value = true
  error.value = ''
  const params = new URLSearchParams({mode:props.mode,region:props.region,q:query.value.trim(),stage:stage.value,overdue:overdue.value?'1':'0',page:String(n),size:String(size.value)})
  if(focusId)params.set('focusId',focusId)
  try {
    const result = await api<{items:OpeningTaskRow[];page:number;total:number;counts?:Counts}>('/venue-opening/tasks?' + params, {signal:active.signal})
    if (request !== current) return
    focusId=undefined
    rows.value = result.items
    counts.value=result.counts??{}
    total.value = result.total
    page.value = result.page
  } catch (e) {
    if (request === current) error.value = e instanceof Error ? e.message : '台账读取失败'
  } finally { if (request === current) busy.value = false }
}
function reset() {
  request++
  active?.abort()
  clearTimeout(timer)
  rows.value = []
  total.value = 0
  page.value = 1
  error.value = ''
  busy.value = true
}
watch([()=>props.mode,()=>props.region,stage,overdue,query], (values,previous) => {
  reset()
  if(previous?.length && values[4]!==previous[4] && !focusId)timer=setTimeout(()=>void load(1),180)
  else void load(1)
},{immediate:true})
watch(()=>props.selectedId,id=>{
  if(!id || rows.value.some(row=>row.id===id))return
  focusId=id
  if(stage.value || overdue.value || query.value){stage.value='';overdue.value=false;query.value=''}
  else void load(1)
})
watch([rows,()=>props.selectedId],()=>table.value?.querySelector('tr.selected')?.scrollIntoView({block:'nearest'}),{flush:'post'})
watch(()=>props.refreshKey, () => void load(page.value))
const now=ref(Date.now())
watch(()=>chinaClock(now.value).date,()=>void load(page.value))
let clock:ReturnType<typeof setInterval>
function scheduleLabel(row:OpeningTaskRow){
  if(row.schedule)return scheduleState(row.schedule,now.value)
  return row.outcome==='unavailable'?'暂不能开放':'尚未登记排期'
}
function refreshSchedule(){now.value=Date.now();void load(page.value)}
function storage(e:StorageEvent){if(e.key==='jingshan-opening-schedules')refreshSchedule()}
onMounted(()=>{
  clock=setInterval(()=>now.value=Date.now(),15000)
  window.addEventListener('jingshan-opening-schedules',refreshSchedule)
  window.addEventListener('storage',storage)
  window.addEventListener('focus',refreshSchedule)
})
onBeforeUnmount(() => {request++; clearTimeout(timer); clearInterval(clock);active?.abort()
  window.removeEventListener('jingshan-opening-schedules',refreshSchedule)
  window.removeEventListener('storage',storage)
  window.removeEventListener('focus',refreshSchedule)
})
</script>

<template>
  <section class="opening-task-list" :class="{'wlo-list':workspaceLayout}" aria-label="场地开放交办台账">
    <div v-if="workspaceLayout" class="wlo-metrics" role="group" aria-label="按办理状态筛选">
      <button v-for="(label,id) in openingStageLabels" :key="id" type="button" :aria-pressed="stage===id" @click="stage=stage===id?'':id">
        <strong>{{counts[id] ?? '—'}}</strong><span>{{label}}</span>
      </button>
    </div>
    <div :class="workspaceLayout ? 'wlo-panel' : 'opening-task-contents'">
    <header v-if="workspaceLayout" class="wlo-panel-title"><h2>协调任务</h2><span>{{mode==='demo'?'演示台账':'业务台账'}} · {{total}} 项</span></header>
    <form v-if="!workspaceLayout" class="opening-task-filters" role="search" @submit.prevent="load(1)">
      <div class="svc-task-stages" role="group" aria-label="筛选办理状态">
        <button v-for="(label,id) in openingStageLabels" :key="id" type="button" class="svc-tag" :data-type="id" :aria-pressed="stage===id" @click="stage=stage===id?'':id">{{ label }} <b v-if="counts[id]!==undefined">{{ counts[id] }}</b></button>
        <button class="svc-tag" data-type="overdue" type="button" :aria-pressed="overdue" @click="overdue=!overdue">超期预警 <b v-if="counts.overdue!==undefined">{{ counts.overdue }}</b></button>
        <button type="button" class="industry-row-action" @click="stage='';overdue=false">全部</button>
      </div>
      <label class="service-search-box"><input v-model="query" type="search" aria-label="搜索协调任务" maxlength="120" placeholder="搜索场馆、承办单位或任务"></label>
    </form>
    <form v-else class="wlo-filters" role="search" @submit.prevent="load(1)">
      <input v-model="query" type="search" aria-label="搜索协调任务" maxlength="120" placeholder="搜索场馆、承办单位或任务"/>
      <select v-model="stage" aria-label="筛选办理状态"><option value="">全部状态</option><option v-for="(label,id) in openingStageLabels" :key="id" :value="id">{{label}}</option></select>
      <label><input v-model="overdue" type="checkbox"/> 超期预警<span v-if="counts.overdue"> ({{counts.overdue}})</span></label>
      <slot name="workspace-actions"/>
    </form>
    <p v-if="error" role="alert">{{ error }} <button type="button" class="industry-button" @click="load(page)">重试</button></p>
    <div v-else class="service-table-scroll"><table ref="table" class="industry-table svc-task-table" :aria-busy="busy">
      <thead><tr><th scope="col">{{ workspaceLayout ? '协调事项' : '工单编号' }}</th><th scope="col">责任单位</th><th v-if="!workspaceLayout" scope="col">协调事项</th><th scope="col">状态</th><th scope="col">办理期限</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" :class="{selected:row.id === selectedId}">
          <td><button class="industry-row-action" type="button" :aria-current="row.id === selectedId" :title="workspaceLayout ? row.venueName+' · '+row.requirement : row.id" @click="emit('select',openingTaskLink(row))">{{ workspaceLayout ? row.venueName : row.id }}</button></td>
          <td :title="row.department">{{ row.department }}</td>
          <td v-if="!workspaceLayout"><button class="industry-row-action" type="button" :title="row.venueName+' · '+row.requirement" @click="emit('select',openingTaskLink(row))">{{ row.venueName }}</button></td>
          <td><span class="svc-tag" :data-type="row.stage" :title="row.stage==='closed'?scheduleLabel(row):undefined">{{ openingStageLabels[row.stage] }}</span></td>
          <td><time :class="{late:isOpeningActive(row.stage) && row.due < chinaClock(now).date}" :datetime="row.due">{{ row.due }}</time></td>
        </tr>
        <tr v-if="!rows.length"><td :colspan="workspaceLayout ? 4 : 5" class="task-empty">{{ busy ? '正在读取协调台账…' : query.trim() || stage || overdue ? '没有符合筛选条件的任务' : '当前区域暂无场地开放协调任务' }}</td></tr>
      </tbody>
    </table></div>
    <ServicePager v-if="!error" :pagination="pagination" label="协调任务分页" unit="项" />
    </div>
  </section>
</template>

<style scoped>
.opening-task-list { display:grid; align-content:start; gap:12px; min-width:0; }
.opening-task-contents { display:contents; }
.opening-task-filters { display:grid;grid-template-columns:minmax(0,1fr);gap:8px; }
.svc-task-stages {display:flex;align-items:center;gap:4px;max-width:100%;overflow-x:auto;white-space:nowrap}
.svc-task-stages button {flex:none}
.svc-task-stages .svc-tag {cursor:pointer}.svc-task-stages [aria-pressed=true]{outline:1px solid var(--v14-ink);outline-offset:-1px}
.svc-task-table {width:100%;min-width:590px;table-layout:fixed}
.svc-task-table th:nth-child(1){width:17%}.svc-task-table th:nth-child(4){width:76px}.svc-task-table th:nth-child(5){width:110px}
.svc-task-table time.late{color:var(--red)}.service-table-scroll{min-width:0;overflow-x:auto}
.opening-task-list .task-empty { text-align:center; color:var(--v14-muted); }
.opening-task-list p { margin:0; }
</style>
