<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { api, jsonRequest } from './api'
import { browserUuid } from './browser-uuid'
import type { CityFeature } from './types'
import { isOpeningActive,openingActions, openingStages, openingStageLabels, type OpeningAction, type OpeningMode, type OpeningTask } from './venue-opening'
import {chinaClock,dayNames} from './opening-schedule'
import ServicePager from './ServicePager.vue'
import VenueOpeningSchedule from './VenueOpeningSchedule.vue'
import {coordinatingOffice, gapLabels, periods, type GapSource} from './service-gaps'
import { useServicePage } from './service-pagination'

const props = defineProps<{ venue:{id:string;name:string;feature?:Pick<CityFeature,'properties'>}; mode: OpeningMode; taskId?: string; source?:GapSource; suggestion?:string }>()
const emit = defineEmits<{changed:[];detail:[task:OpeningTask|null]}>()
const task = ref<OpeningTask | null>(null)
const page = ref(1)
const count = ref(0)
const loading = ref(false)
const saving = ref(false)
const loaded = ref(false)
const creating = ref(false)
const notice = ref('')
const loadError = ref('')
const form = reactive({ department:'', due:'', requirement:'', outcome:'scheduled', startsOn:'', hours:'', note:'', decision:'close' })
let generation = 0
let venueGeneration = 0
let request: {key:string; id:string} | null = null
const scope = computed(() => JSON.stringify([props.mode, props.venue.id]))
const step = computed(() => openingStages.findIndex(item => item.id === task.value?.stage))
const activeTask=computed(()=>!!task.value && isOpeningActive(task.value.stage))
const showAssignment = computed(() => loaded.value && (!task.value || creating.value))
const historyList = useServicePage(computed(() => task.value?.history.slice().reverse() ?? []),
  [() => task.value?.id, () => task.value?.history.length])
const lastFeedback = computed(() => task.value?.history.findLast(event => event.action === 'feedback'))
const assignedGap = computed(() => task.value?.history[0].source)
const gapDescription = (s:GapSource) => s.name+' · '+s.kinds.map(k=>gapLabels[k]).join('、')+'缺口 · '+periods[s.period].label
const lastReturn = computed(() => {
  const step=task.value?.history.findLast(e=>e.action!=='remind')
  return step?.action==='return'?step.note:''
})
const reminderForm=ref(false),reminderNote=ref('')
const latestReminder=computed(()=>task.value?.history.findLast(e=>e.action==='remind'))
function beginReminder(){
  if(!task.value||!activeTask.value)return
  reminderForm.value=!reminderForm.value
  if(reminderForm.value&&!reminderNote.value){
    reminderNote.value=task.value.due<chinaClock(Date.now()).date?'已超过办理期限，请反馈办理进展。':'请于 '+task.value.due+' 前反馈场地开放协调进展。'
  }
}
const dateTime = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
const activeSection=ref<'info'|'process'|'feedback'>('info')
const infoBlock=ref<HTMLElement>(),processBlock=ref<HTMLElement>(),feedbackBlock=ref<HTMLElement>()
const taskSections=[['info','基本信息'],['process','跟办流程'],['feedback','反馈结果']] as const
function showSection(section:typeof activeSection.value){
  activeSection.value=section
  const el={info:infoBlock,process:processBlock,feedback:feedbackBlock}[section].value
  el?.scrollIntoView({block:'nearest',behavior:'smooth'})
}
const timeline = computed(() => {
  if(task.value?.stage==='withdrawn' && !creating.value)return task.value.history.filter(e=>e.action!=='remind').map(e=>({
    id:e.requestId,name:openingActions[e.action],done:e.action!=='withdraw',active:false,at:e.at,label:dateTime.format(new Date(e.at)),
  }))
  const reached = creating.value ? -1 : step.value
  const actions: OpeningAction[] = ['assign','receive','feedback','close']
  const pendingLabels = ['待交办','待签收','办理中','待核验']
  return openingStages.map((item,i) => {
    const done = i <= reached
    const active = i === reached + 1
    const event = done ? task.value?.history.findLast(e => e.action === actions[i]) : undefined
    return {...item, done, active, at:event?.at, label:event ? dateTime.format(new Date(event.at)) : active ? pendingLabels[i] : '待办理'}
  })
})
function resetForm() {
  const department = props.venue.feature ? coordinatingOffice(props.venue.feature) : ''
  const requirement = props.source ? gapDescription(props.source)+'。请核实可向公众开放的场地和时段。'+(props.suggestion??'') : ''
  Object.assign(form, {department, due:'', requirement, outcome:'scheduled', startsOn:'', hours:'', note:'', decision:'close'})
  request = null
}
function showTask(next: OpeningTask | null) {
  if(task.value?.id!==next?.id || next?.stage==='withdrawn'){reminderForm.value=false;reminderNote.value=''}
  if (task.value?.id !== next?.id || task.value?.history.findLast(e=>e.action!=='remind')?.requestId !== next?.history.findLast(e=>e.action!=='remind')?.requestId) {
    resetForm()
    creating.value = false
  }
  task.value = next
  emit('detail',next)
}
async function fetchPage(n = page.value, taskId?:string) {
  const token = ++generation
  loading.value = true
  loadError.value = ''
  try {
    const params = new URLSearchParams({venueId:props.venue.id, mode:props.mode, page:String(n)})
    if (taskId) params.set('taskId',taskId)
    const data = await api<{task:OpeningTask | null;count:number;page:number}>('/venue-opening?' + params)
    if (generation !== token) return
    page.value = data.page
    count.value = data.count
    showTask(data.task)
    loaded.value = true
  } catch (error) {
    if (token === generation) loadError.value = error instanceof Error ? error.message : '任务读取失败'
  } finally { if (token === generation) loading.value = false }
}
function openNew() {
  resetForm()
  creating.value = true
  notice.value = ''
}
async function save(action: OpeningAction) {
  if (saving.value || loading.value || loadError.value || !loaded.value) return
  const context = venueGeneration
  const target = task.value
  const assign = action === 'assign'
  if (!assign && !target) return
  const fields = assign ? {venueId:props.venue.id, mode:props.mode, department:form.department, due:form.due, note:form.requirement, source:props.source}
    : action==='withdraw'?{revision:target!.history.length,action}
    : action==='remind'?{revision:target!.history.length,action,note:reminderNote.value.trim()}
    : {revision:target!.history.length, action, outcome:form.outcome, startsOn:form.startsOn, hours:form.hours, note:form.note}
  const key = JSON.stringify([scope.value, target?.id, fields])
  if (request?.key !== key) request = {key, id:browserUuid()}
  saving.value = true
  notice.value = ''
  try {
    const result = await api<OpeningTask>('/venue-opening' + (assign ? '' : '/' + target!.id),
      jsonRequest(assign ? 'POST' : 'PATCH', {...fields, requestId:request.id}))
    emit('changed')
    if (context !== venueGeneration) return
    if (assign) { count.value++; page.value = 1 }
    showTask(result)
    if(action==='remind'){reminderForm.value=false;reminderNote.value=''}
    notice.value = action==='withdraw'?'已撤回交办':openingActions[action]
  } catch (error) {
    if (context !== venueGeneration) return
    notice.value = error instanceof Error ? error.message : '保存失败，请重试'
    await fetchPage(assign ? 1 : page.value, assign ? undefined : target?.id)
  } finally { if (context === venueGeneration) saving.value = false }
}
watch([scope,()=>props.taskId], () => {
  venueGeneration++
  task.value = null
  loaded.value = false
  saving.value = false
  creating.value = false
  count.value = 0
  page.value = 1
  notice.value = ''
  resetForm()
  void fetchPage(1, props.taskId)
}, {immediate:true, flush:'sync'})
function refresh() { return fetchPage(page.value, task.value?.id ?? props.taskId) }
function onFocus() { if (!saving.value && !loading.value) void refresh() }
onMounted(() => window.addEventListener('focus',onFocus))
onBeforeUnmount(() => { generation++; venueGeneration++; window.removeEventListener('focus',onFocus) })
</script>

<template>
  <section class="venue-opening" aria-label="场地开放协调">
    <header class="opening-heading"><h3>场地开放协调</h3>
      <button v-if="activeTask && !showAssignment" type="button" class="industry-button" :disabled="loading||saving||!!loadError" @click="save('withdraw')">撤回交办</button>
      <button type="button" class="industry-button" :disabled="loading || saving" @click="refresh()">刷新进度</button>
    </header>
    <p v-if="loading && !loaded" role="status">正在读取协调任务…</p>
    <p v-if="loadError" role="alert">{{ loadError }}</p>
    <template v-if="loaded">
      <div v-if="count > 1" class="opening-pages" aria-label="协调任务分页">
        <button type="button" class="industry-button" :disabled="page <= 1 || saving || loading" @click="fetchPage(page-1)">上一项</button>
        <span>{{ page }} / {{ count }} 项</span>
        <button type="button" class="industry-button" :disabled="page >= count || saving || loading" @click="fetchPage(page+1)">下一项</button>
      </div>
      <div v-if="task && !showAssignment" class="industry-tabs task-section-nav" aria-label="交办单详情导航">
        <button v-for="[key,label] in taskSections" :key="key" type="button" :aria-pressed="activeSection===key" @click="showSection(key)">{{ label }}</button>
      </div>
      <template v-if="showAssignment">
        <p v-if="!venue.feature">此场馆已移出当前发布台账。</p>
        <form v-else class="opening-form" @submit.prevent="save('assign')">
          <div class="opening-fields">
            <label>承办单位<input v-model.trim="form.department" list="venue-opening-offices" required maxlength="100" placeholder="选择或填写承办单位"></label>
            <datalist id="venue-opening-offices"><option>教育局</option><option>机关事务服务中心</option><option>文旅局</option></datalist>
            <label>办理期限<input v-model="form.due" type="date" required></label>
          </div>
          <label>交办要求<textarea v-model.trim="form.requirement" rows="2" required maxlength="600" placeholder="填写拟协调的场地、开放对象及需核实的事项"></textarea></label>
          <div class="opening-buttons"><button v-if="creating" type="button" class="industry-button" @click="creating=false">取消</button>
            <button type="submit" class="industry-button primary" :disabled="saving || loading || !!loadError">确认交办</button></div>
        </form>
      </template>
      <template v-else-if="task">
        <p v-if="source && activeTask && assignedGap?.id!==source.id">该馆已有在办工单。以下为原工单的交办范围和进度。</p>
        <p v-if="task.stage==='withdrawn'">本单已撤回，关联场馆可重新协调。</p>
        <dl ref="infoBlock" class="opening-facts">
          <div><dt>工单编号</dt><dd :title="task.id">{{ task.id }}</dd></div><div><dt>所属片区</dt><dd :title="task.region">{{ task.region }}</dd></div>
          <div><dt>关联场馆</dt><dd :title="task.venueName">{{ task.venueName }}</dd></div><div><dt>承办单位</dt><dd :title="task.department">{{ task.department }}</dd></div>
          <div><dt>办理状态</dt><dd><span class="svc-tag" :data-type="task.stage">{{ openingStageLabels[task.stage] }}</span></dd></div><div><dt>办理期限</dt><dd>{{ task.due }}</dd></div>
          <div v-if="assignedGap" class="opening-description"><dt>交办片区</dt><dd>{{ gapDescription(assignedGap) }}</dd></div>
          <div class="opening-description"><dt>交办要求</dt><dd>{{ task.history[0].note }}</dd></div>
        </dl>
        <section v-if="task.history[0].proposal" class="opening-feedback"><h4>交办场地与拟开放时段</h4>
          <p>周{{ task.history[0].proposal.days.map(d=>dayNames[d]).join('、') }}　{{ task.history[0].proposal.from }}–{{ task.history[0].proposal.until }}</p>
          <p v-for="v in task.history[0].proposal.venues" :key="v.id"><strong>{{ v.name }}</strong> · {{ v.courts.map(c=>c.name).join('、') }}</p>
          <p v-if="activeTask && task.history[0].proposal.venues.length>1">撤回本单将释放以上 {{ task.history[0].proposal.venues.length }} 处场馆。</p>
        </section>
        <h4 ref="processBlock" class="service-section-title">跟办流程</h4>
      <ol class="opening-steps" aria-label="办理进度">
        <li v-for="item in timeline" :key="item.id" :class="{passed:item.done}" :aria-current="item.active ? 'step' : undefined">
          <i aria-hidden="true"></i><strong>{{ item.name }}</strong><time v-if="item.at" :datetime="item.at">{{ item.label }}</time><span v-else>{{ item.label }}</span>
        </li>
      </ol>
        <div v-if="latestReminder" class="opening-feedback"><h4>最近督办 · {{ task.department }}</h4>
          <time :datetime="latestReminder.at">{{ dateTime.format(new Date(latestReminder.at)) }}</time><p>{{ latestReminder.note }}</p>
        </div>
        <button v-if="activeTask" type="button" class="industry-button remind-button" :aria-expanded="reminderForm" :disabled="loading||saving||!!loadError" @click="beginReminder">督办提醒</button>
        <form v-if="reminderForm&&activeTask" class="opening-form industry-card" @submit.prevent="save('remind')">
          <label>督办说明<textarea v-model.trim="reminderNote" required rows="2" maxlength="600"></textarea></label>
          <div class="opening-buttons"><button type="button" class="industry-button" @click="reminderForm=false">取消</button>
            <button class="industry-button primary" :disabled="saving||loading||!!loadError||!reminderNote">登记督办</button></div>
        </form>
        <h4 ref="feedbackBlock" class="service-section-title">反馈结果</h4>
        <p v-if="!lastFeedback">承办单位尚未提交反馈。</p>
        <p v-if="lastReturn" class="opening-feedback">退回意见　{{ lastReturn }}</p>
        <section v-if="lastFeedback && (task.stage === 'review' || !activeTask)" class="opening-feedback">
          <h4>{{ lastFeedback.outcome === 'scheduled' ? '拟开放方案' : '暂不能开放' }}</h4>
          <p v-if="lastFeedback.startsOn">{{ lastFeedback.startsOn }} 起 · {{ lastFeedback.hours }}</p><p>{{ lastFeedback.note }}</p>
        </section>
        <div v-if="task.stage === 'assigned'" class="opening-buttons"><button type="button" class="industry-button primary" :disabled="saving || loading || !!loadError" @click="save('receive')">签收任务</button></div>
        <form v-if="task.stage === 'received'" class="opening-form" @submit.prevent="save('feedback')">
          <label>协调结果<select v-model="form.outcome"><option value="scheduled">拟安排开放</option><option value="unavailable">暂不能开放</option></select></label>
          <div v-if="form.outcome === 'scheduled'" class="opening-fields">
            <label>拟开放日期<input v-model="form.startsOn" type="date" required></label>
            <label>拟开放时段<input v-model.trim="form.hours" placeholder="如 周六 09:00–12:00" maxlength="120" required></label>
          </div>
          <label>{{ form.outcome === 'scheduled' ? '开放场地及安排' : '暂不能开放的原因' }}<textarea v-model.trim="form.note" required rows="2" maxlength="600"></textarea></label>
          <div class="opening-buttons"><button class="industry-button primary" type="submit" :disabled="saving || loading || !!loadError">提交反馈</button></div>
        </form>
        <form v-if="task.stage === 'review'" class="opening-form" @submit.prevent="save(form.decision === 'return' ? 'return' : 'close')">
          <label>核验结果<select v-model="form.decision"><option value="close">核验办结</option><option value="return">退回补充</option></select></label>
          <label>{{ form.decision === 'return' ? '退回原因' : '核验意见' }}<textarea v-model.trim="form.note" required rows="2" maxlength="600"></textarea></label>
          <div class="opening-buttons"><button class="industry-button primary" type="submit" :disabled="saving || loading || !!loadError">{{ form.decision === 'return' ? '退回补充' : '确认办结' }}</button></div>
        </form>
        <VenueOpeningSchedule v-if="task.stage==='closed' && lastFeedback?.outcome==='scheduled'" :key="task.id" :task-id="task.id" :proposal="task.history[0].proposal" :starts-on="lastFeedback.startsOn" />
        <p v-else-if="task.stage==='closed' && lastFeedback?.outcome==='unavailable'">工单已办结，此次协调未新增开放场地。</p>
        <div v-if="!activeTask && page === 1 && venue.feature" class="opening-buttons"><button type="button" class="industry-button" @click="openNew">发起新任务</button></div>
        <details class="opening-history" :key="task.id">
          <summary>办理记录（{{ task.history.length }} 条）</summary>
          <ol><li v-for="event in historyList.rows" :key="event.requestId"><strong>{{ openingActions[event.action] }}</strong>
            <time :datetime="event.at">{{ dateTime.format(new Date(event.at)) }}</time>
            <p v-if="event.outcome">{{ event.outcome === 'scheduled' ? '拟安排开放 · ' + event.startsOn + ' 起 · ' + event.hours : '暂不能开放' }}</p><p v-if="event.note">{{ event.note }}</p></li></ol>
          <ServicePager v-if="historyList.pageCount>1" :pagination="historyList" label="办理记录分页" />
        </details>
      </template>
    </template>
    <p v-if="notice" role="status">{{ notice }}</p>
  </section>
</template>

<style scoped>
.remind-button{justify-self:start}.task-section-nav{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
.venue-opening { display:grid; gap:12px; min-width:0; color:var(--v14-ink); font:400 16px/1.5 var(--v14-font); }
.venue-opening :is(h3,h4,p,dl,dd,ol) { margin:0; }
.venue-opening h3 { font-size:20px; }
.venue-opening h4 { font-size:16px; }
.opening-heading,.opening-pages,.opening-buttons { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.opening-heading { justify-content:space-between; }
.opening-pages,.opening-buttons { justify-content:flex-end; }
.opening-steps { display:grid; padding:8px 24px 8px 32px; list-style:none; border:1px solid var(--industry-table-line); border-radius:4px; background:var(--v14-list); }
.opening-steps li { position:relative; display:grid; grid-template-columns:24px auto minmax(0,1fr); gap:12px; align-items:center; min-height:48px; }
.opening-steps li:not(:last-child)::before { content:''; position:absolute; inset-block-start:50%; inset-inline-start:11px; height:100%; width:3px; background:var(--v14-chart-track); }
.opening-steps i { display:grid; place-items:center; width:22px; height:22px; justify-self:center; z-index:1; border-radius:50%; background:#8b9db5; }
.opening-steps i::after { content:''; width:8px; height:8px; border-radius:50%; background:white; }
.opening-steps .passed i,.opening-steps .passed::before { background:var(--green); }
.opening-steps .passed i::after { width:9px; height:5px; border:2px solid white; border-width:0 0 2px 2px; border-radius:0; background:transparent; transform:translateY(-1px) rotate(-45deg); }
.opening-steps [aria-current=step] i { background:var(--blue); }
.opening-steps time,.opening-steps li>span { text-align:end; font-variant-numeric:tabular-nums; }
.opening-steps [aria-current=step]>span { color:var(--v14-metric); font-weight:700; }
.opening-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr)); gap:8px; }
.opening-form,.opening-form label,.opening-facts,.opening-history li { display:grid; gap:4px; min-width:0; }
.opening-form { gap:12px; }
.opening-form :is(input,select,textarea) { width:100%; min-width:0; box-sizing:border-box; font:inherit; color:var(--v14-ink); border:1px solid var(--v14-list-line); padding:4px 8px; background:var(--v14-list); }
.opening-form textarea { resize:vertical; }
.opening-facts {grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.opening-facts div {display:grid;grid-template-rows:auto 1fr;min-width:0;gap:4px;padding:6px 10px;border:1px solid var(--industry-table-line);background:var(--v14-list)}
.opening-facts .opening-description {grid-column:1/-1}
.opening-facts dt,.opening-history time { color:var(--v14-muted); }
.opening-facts dd {min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.opening-description dd,.opening-history p,.opening-feedback p {overflow-wrap:anywhere;white-space:pre-line}
.opening-feedback,.opening-form { padding:12px; background:var(--v14-list); }
.opening-history summary { cursor:pointer; font-weight:700; }
.opening-history ol { padding:0; list-style:none; }
.opening-history li { padding:8px; border-bottom:1px solid var(--industry-table-line); }
</style>
