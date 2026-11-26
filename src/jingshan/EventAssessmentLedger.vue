<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api, jsonRequest } from './api.ts'
import { assessmentRecords } from './event-assessment.ts'
import { itemDescription, selectedTopics } from './event-plan-selection.ts'
import { assessmentProgress, assessmentStatus, assessmentVersion } from './event-workflow.ts'
import type { AssessmentWithdrawal, EventAssessment, EventCatalog } from './event-plan-types.ts'

const props = defineProps<{ catalog: EventCatalog; year: number }>()
const emit = defineEmits<{
  close: []; select: [id: string]; refresh: []
  withdrawn: [entry: AssessmentWithdrawal, cancelledTaskIds: number[]]
}>()
const dialog = ref<HTMLDialogElement>()
const search = ref(''), stage = ref('全部状态'), message = ref(''), error = ref('')
const submitting = ref(false), fetching = ref(false)
const candidate = ref<{ name: string; plan: EventAssessment }>()
const reason = ref('')
const archive = ref<{ entry?: AssessmentWithdrawal; plan: EventAssessment }>()
const archivedTopics = computed(()=>archive.value ? selectedTopics(archive.value.plan.topics,archive.value.plan.dispatchedItems) : [])
const date = new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' })
const time = (iso?: string) => iso ? date.format(new Date(iso)) : '—'
const states = ['全部状态','待研判','处理中','已完结','已撤回','已换版']
const ledgerYear=ref(props.year)
const ledgerYears=computed(()=>[...new Set([props.year,...props.catalog.events.map(e=>e.year),
  ...Object.values(props.catalog.assessments).flatMap(plan=>plan.eventSnapshot?[plan.eventSnapshot.year]:[]),
  ...(props.catalog.withdrawals??[]).map(entry=>entry.year)])].sort((a,b)=>b-a))

type Row = {
  key: string; id: string; name: string; schedule: string; state: string; version: number
  at?: string; completed: number; total: number; plan?: EventAssessment; entry?: AssessmentWithdrawal; snapshotOnly?:boolean
}
const rows = computed(() => {
  const events = new Map(props.catalog.events.map(e => [e.id,e]))
  const published = new Set(events.keys())
  for (const plan of Object.values(props.catalog.assessments)) {
    if(plan.eventSnapshot && !published.has(plan.eventId)) events.set(plan.eventId,plan.eventSnapshot)
  }
  const result: Row[] = []
  const recalled = new Set<string>()
  for (const entry of props.catalog.withdrawals ?? []) {
    if (entry.year !== ledgerYear.value) continue
    recalled.add(entry.eventId)
    result.push({ key: entry.eventId+'-'+entry.revision, id: entry.eventId, name: entry.name, schedule: events.get(entry.eventId)?.dateText ?? '',
      state:entry.replacedByVersion?'已换版':'已撤回', version:entry.planVersion, at:entry.withdrawnAt, completed:entry.feedbackCount, total:entry.departmentCount, entry })
  }
  const samples = new Map(props.catalog.examples?.map(item => [item.event.id,item.plan]))
  for (const event of events.values()) {
    if (event.year!==ledgerYear.value) continue
    const plan = props.catalog.assessments[event.id] ?? (recalled.has(event.id) ? undefined : samples.get(event.id))
    if (!event.assessment && !plan && !recalled.has(event.id)) continue
    const progress = assessmentProgress(plan)
    result.push({ key:event.id, id:event.id, name:plan?.eventSnapshot?.name ?? event.name, schedule:plan?.eventSnapshot?.dateText ?? event.dateText,
      state:assessmentStatus(plan), version:assessmentVersion(plan), at:plan?.timeline?.at(-1)?.at ?? plan?.completedAt ?? plan?.submittedAt ?? plan?.generatedAt,
      completed:progress.completed, total:progress.total, plan, snapshotOnly:!published.has(event.id) })
  }
  return result.sort((a,b) => (b.at ?? '').localeCompare(a.at ?? '') || a.name.localeCompare(b.name,'zh-CN'))
})
const visible = computed(() => rows.value.filter(row => (stage.value === '全部状态' || row.state === stage.value)
  && row.name.toLowerCase().includes(search.value.trim().toLowerCase())))

onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => dialog.value?.close())
function back() {
  if (submitting.value) return
  if (candidate.value || archive.value) { candidate.value=undefined; archive.value=undefined; error.value='' }
  else emit('close')
}
function requestWithdrawal(row: Row) {
  if (!row.plan || row.plan.example || row.state !== '处理中') return
  candidate.value={ name:row.name, plan:row.plan }
  reason.value=''; message.value=''; error.value=''
}
async function withdraw() {
  const target = candidate.value
  if (!target || submitting.value) return
  submitting.value=true; error.value=''
  try {
    const { entry, cancelledTaskIds } = await api<{ entry: AssessmentWithdrawal; cancelledTaskIds: number[] }>(
      '/event-plans/'+encodeURIComponent(target.plan.eventId)+'/withdraw',
      jsonRequest('POST',{ revision:target.plan.revision, reason:reason.value.trim() }))
    emit('withdrawn',entry,cancelledTaskIds)
    candidate.value=undefined; stage.value='全部状态'
    message.value='《'+entry.name+'》已撤回，赛事已回到待研判。'
  } catch (e) {
    candidate.value=undefined
    error.value=e instanceof Error ? e.message : '撤回失败，请重试'
    emit('refresh')
  } finally { submitting.value=false }
}
async function showArchive(entry: AssessmentWithdrawal) {
  if (fetching.value) return
  fetching.value=true; error.value=''; message.value=''
  try {
    archive.value=await api('/event-plans/'+encodeURIComponent(entry.eventId)+'/withdrawals/'+entry.revision)
  } catch (e) { error.value=e instanceof Error ? e.message : '撤回记录读取失败' }
  finally { fetching.value=false }
}
</script>

<template>
  <dialog ref="dialog" class="ep-dialog ep-ledger" :class="{'ep-ledger-confirm':candidate}" aria-labelledby="ep-ledger-title" @cancel.prevent="back()" @click="($event.target===dialog)&&back()">
    <header>
      <div><small>{{ ledgerYear }} 年 · 赛前研判</small><h2 id="ep-ledger-title">{{ candidate?'撤回研判方案':archive?.entry?.replacedByVersion?'换版记录':archive?.entry?'撤回记录':archive?'已保存的研判方案':'研判台账' }}</h2></div>
      <button type="button" :disabled="submitting" :aria-label="candidate||archive?'返回研判台账':'关闭研判台账'" @click="back()">×</button>
    </header>
    <template v-if="candidate">
      <div class="ep-ledger-detail">
        <h3>{{ candidate.name }}</h3>
        <p>方案 V{{ assessmentVersion(candidate.plan) }} · {{ assessmentProgress(candidate.plan).completed }}/{{ candidate.plan.taskIds.length }} 个部门已反馈</p>
        <p>撤回后赛事回到待研判，未办结的部门任务将取消。已收到的反馈和本版方案保存在台账中。</p>
        <label>撤回原因（选填）<textarea v-model="reason" rows="3" maxlength="200" placeholder="填写本次撤回的原因" /></label>
      </div>
      <footer class="ep-ledger-actions"><button type="button" autofocus :disabled="submitting" @click="back()">取消</button><button type="button" class="ep-confirm" :disabled="submitting" @click="withdraw">{{ submitting?'正在撤回…':'确认撤回' }}</button></footer>
    </template>
    <template v-else-if="archive">
      <div class="ep-ledger-detail ep-ledger-record">
        <h3>{{ archive.entry?.name ?? archive.plan.eventSnapshot?.name }} · V{{ archive.entry?.planVersion ?? assessmentVersion(archive.plan) }}</h3>
        <p v-if="archive.entry"><time :datetime="archive.entry.withdrawnAt">{{ time(archive.entry.withdrawnAt) }}</time> · {{ archive.entry.operator }}{{ archive.entry.replacedByVersion?'推送 V'+archive.entry.replacedByVersion:'撤回' }} · 取消 {{ archive.entry.cancelledCount }} 项部门任务</p>
        <p v-else>赛历记录已移除，以下为该方案保存的办理资料。</p>
        <p v-if="archive.entry?.reason">{{ archive.entry.replacedByVersion?'换版说明':'撤回原因' }}　{{ archive.entry.reason }}</p>
        <h3>部门反馈</h3>
        <ul v-if="archive.plan.feedback?.length"><li v-for="item in archive.plan.feedback" :key="item.taskId"><strong>{{ item.department }}</strong> · {{ item.status==='completed'?'已反馈':item.status==='received'?'已签收':'待签收' }}<span v-if="item.comment">　{{ item.comment }}</span></li></ul>
        <p v-else>本版方案尚未分派部门任务。</p>
        <h3>办理记录</h3>
        <ol><li v-for="(record,i) in assessmentRecords(archive.plan)" :key="i"><time :datetime="record.at">{{ time(record.at) }}</time>　{{ record.detail }}</li></ol>
        <details v-if="archivedTopics.length" class="ep-ledger-topics"><summary>本版专项预案（{{ archivedTopics.length }} 项）</summary>
          <section v-for="topic in archivedTopics" :key="topic.id"><h4>{{ topic.label }} · {{ topic.department }}</h4>
            <ul><li v-for="item in topic.items" :key="item.id"><strong>{{ item.title }}</strong>　{{ itemDescription(item) }}</li></ul>
          </section>
        </details>
      </div>
      <footer class="ep-ledger-actions"><button type="button" @click="back()">返回台账</button></footer>
    </template>
    <template v-else>
      <div class="ep-dialog-controls"><input v-model="search" type="search" aria-label="台账赛事名称" placeholder="搜索赛事名称"><select v-model.number="ledgerYear" aria-label="台账年份"><option v-for="y in ledgerYears" :key="y" :value="y">{{ y }} 年</option></select><select v-model="stage" aria-label="台账研判状态"><option v-for="state in states" :key="state">{{ state }}</option></select><span>{{ visible.length }} 条记录</span></div>
      <p v-if="message" class="ep-ledger-message" role="status">{{ message }}</p>
      <p v-if="error" class="ep-ledger-message ep-inline-error" role="alert">{{ error }}</p>
      <div class="ep-table-scroll"><table aria-label="赛事研判台账"><thead><tr><th>赛事 / 赛期</th><th>研判状态</th><th>方案版本</th><th>部门反馈</th><th>最近办理时间</th><th>操作</th></tr></thead>
        <tbody><tr v-for="row in visible" :key="row.key">
          <td><strong>{{ row.name }}</strong><small>{{ row.schedule }}<template v-if="row.plan?.example"> · 演练样例</template></small></td>
          <td><em :data-state="row.state">{{ row.state }}</em></td><td>{{ row.version?'V'+row.version:'—' }}</td>
          <td>{{ row.total?row.completed+' / '+row.total:'—' }}</td><td>{{ time(row.at) }}</td>
          <td><div class="ep-ledger-row-actions">
            <button v-if="row.entry" type="button" :disabled="fetching" @click="showArchive(row.entry)">{{ row.entry.replacedByVersion?'换版记录':'撤回记录' }}</button>
            <button v-else-if="row.snapshotOnly && row.plan" type="button" @click="archive={plan:row.plan}">查看快照</button>
            <template v-else><button type="button" @click="emit('select',row.id)">详情</button><button v-if="row.plan&&!row.plan.example&&row.state==='处理中'" type="button" class="ep-ledger-withdraw" :disabled="fetching" @click="requestWithdrawal(row)">撤回</button></template>
          </div></td>
        </tr></tbody></table><p v-if="!visible.length" class="ep-empty">没有符合条件的研判记录</p></div>
    </template>
  </dialog>
</template>
