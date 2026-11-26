<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PortalIcon from './PortalIcon.vue'
import type { EventAssessment, EventDepartmentFeedback, EventTopic, EventWorkflowRecord } from './event-plan-types.ts'
import { assessmentRecords, topicsByDepartment } from './event-assessment.ts'
import { selectedTopics } from './event-plan-selection.ts'
import { assessmentProgress, assessmentStatus, assessmentVersion } from './event-workflow.ts'

const props=defineProps<{plan:EventAssessment;busy?:boolean;feedbackError?:string;readonlyExample?:boolean}>()
const emit=defineEmits<{
  feedback:[value:{taskId:number;comment:string;disposition:'adopted'|'noted'}]
  viewPlan:[topic?:EventTopic]
}>()
const recordDialog=ref<HTMLDialogElement>()
const editingTask=ref<number|null>(null),comment=ref(''),disposition=ref<'adopted'|'noted'>('noted')
const submittedFeedback=ref<{taskId:number;comment:string;disposition:'adopted'|'noted';feedbackAt?:string;revision:number}|null>(null)
const locked=computed(()=>assessmentStatus(props.plan)==='已完结')
const readOnly=computed(()=>locked.value||props.readonlyExample)
const progress=computed(()=>assessmentProgress(props.plan))
const feedback=computed<EventDepartmentFeedback[]>(()=>{
  const plan=props.plan
  if(locked.value&&plan.feedback)return plan.feedback
  return plan.taskIds.map((taskId,index)=>plan.feedback?.find(item=>item.taskId===taskId)??{
    taskId,department:plan.departments[index]??'责任部门',status:'pending',
  })
})
const assignedTopics=computed(()=>selectedTopics(props.plan.topics,props.plan.dispatchedItems))
const departmentTopics=computed(()=>topicsByDepartment(assignedTopics.value))
const editing=computed(()=>feedback.value.find(item=>item.taskId===editingTask.value))
const percentage=computed(()=>progress.value.total?Math.round(progress.value.completed/progress.value.total*100):0)
const records=computed(()=>assessmentRecords(props.plan))
const milestones=computed(()=>{
  const result:EventWorkflowRecord[]=[]
  for(const action of ['generated','submitted','feedback','completed'] as const){
    const item=records.value.findLast(record=>record.action===action)
    if(item)result.push(action==='feedback'&&progress.value.completed===progress.value.total
      ?{...item,detail:`${progress.value.completed} 个部门完成反馈与意见处理`}:item)
  }
  return result
})
function dateTime(value?:string){
  if(!value)return '未记录'
  const date=new Date(value)
  return Number.isNaN(date.getTime())?'未记录':new Intl.DateTimeFormat('zh-CN',{
    timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,
  }).format(date)
}
function shortDate(value:string){return dateTime(value).replace(/^\d{4}\//,'')}
function stateText(item:EventDepartmentFeedback){return item.status==='completed'?'已反馈':item.status==='received'?'已签收':'待签收'}
function opinionText(item:EventDepartmentFeedback){
  return item.disposition==='adopted'?'意见已采纳':item.disposition==='noted'?'意见已记录':item.status==='completed'?'反馈已完成':'等待部门反馈'
}
function feedbackAction(item:EventDepartmentFeedback){return item.comment?'更新反馈':item.status==='completed'?'补充反馈':'登记反馈'}
function showRecords(item?:EventDepartmentFeedback){
  editingTask.value=null;comment.value='';disposition.value='noted';submittedFeedback.value=null
  if(item&&!readOnly.value)selectFeedback(item)
  recordDialog.value?.showModal()
}
function selectFeedback(item:EventDepartmentFeedback){
  if(readOnly.value||props.busy)return
  editingTask.value=item.taskId;comment.value=item.comment??'';disposition.value=item.disposition??'noted';submittedFeedback.value=null
}
function saveFeedback(){
  if(props.busy||readOnly.value||!editing.value||!comment.value.trim())return
  const value={taskId:editing.value.taskId,comment:comment.value.trim(),disposition:disposition.value}
  submittedFeedback.value={...value,feedbackAt:editing.value.feedbackAt,revision:props.plan.revision}
  emit('feedback',value)
}
watch(()=>props.plan.eventId,()=>{recordDialog.value?.close();editingTask.value=null;comment.value='';submittedFeedback.value=null})
watch([()=>props.plan.revision,()=>props.busy,()=>props.feedbackError],()=>{
  const submitted=submittedFeedback.value
  if(!submitted)return
  if(props.feedbackError&&!props.busy){submittedFeedback.value=null;return}
  const saved=feedback.value.find(item=>item.taskId===submitted.taskId)
  // A different department's polling update must not discard this department's unsaved text.
  if(props.plan.revision>submitted.revision&&saved?.status==='completed'&&saved.feedbackAt&&saved.feedbackAt!==submitted.feedbackAt&&saved.comment===submitted.comment&&saved.disposition===submitted.disposition){
    editingTask.value=null;comment.value='';submittedFeedback.value=null
  }
})
</script>

<template>
  <div class="eap-progress" :class="{'is-locked':locked}">
    <section class="ep-block eap-summary">
      <h3>{{ locked?'完结信息':'专项分工情况' }}</h3>
      <div class="eap-summary-grid">
        <div><span>方案版本</span><strong>V{{ assessmentVersion(plan) }}</strong></div>
        <div><span>专项预案</span><strong>{{ assignedTopics.length }}<small> 项</small></strong></div>
        <div><span>{{ locked?'部门会签':'责任部门' }}</span><strong>{{ locked?`${progress.completed}/${progress.total}`:departmentTopics.size }}<small v-if="!locked"> 个</small></strong></div>
        <div><span>反馈意见</span><strong>{{ progress.opinions }}<small> 条</small></strong></div>
        <template v-if="locked">
          <div><span>采纳意见</span><strong>{{ progress.adopted }}<small> 条</small></strong></div>
        </template>
      </div>
      <dl v-if="locked" class="eap-dispatch-dates"><div><dt>完结时间</dt><dd><time :datetime="plan.completedAt">{{ dateTime(plan.completedAt) }}</time></dd></div></dl>
      <dl v-if="!locked" class="eap-dispatch-dates">
        <div><dt>生成时间</dt><dd><time :datetime="plan.generatedAt">{{ shortDate(plan.generatedAt) }}</time></dd></div>
        <div><dt>任务分派</dt><dd><time v-if="plan.submittedAt" :datetime="plan.submittedAt">{{ shortDate(plan.submittedAt) }}</time><span v-else>{{ progress.total?'未记录':'待推送' }}</span></dd></div>
      </dl>
    </section>

    <template v-if="!locked">
      <section v-if="progress.total" class="ep-block eap-departments">
        <div class="eap-section-heading"><h3>部门反馈进度</h3><span><b>{{ progress.completed }}/{{ progress.total }}</b> 已反馈</span></div>
        <div class="eap-progress-track" role="progressbar" aria-label="部门反馈进度" :aria-valuenow="progress.completed" :aria-valuemin="0" :aria-valuemax="Math.max(1,progress.total)"><i :style="{width:percentage+'%'}"></i></div>
        <p class="eap-progress-caption">{{ progress.canComplete?'全部部门已反馈，等待平台确认完结。':`待反馈 ${progress.total-progress.completed} 个部门` }}</p>
        <div class="eap-department-grid">
          <button v-for="item in feedback" :key="item.taskId" type="button" class="eap-department-card" :class="{'is-done':item.status==='completed'}" :aria-label="`${item.department}，${stateText(item)}，${readOnly?'查看反馈':feedbackAction(item)}`" :disabled="busy" @click="showRecords(item)">
            <span class="eap-department-line"><strong>{{ item.department }}</strong><small>{{ stateText(item) }}</small></span>
            <span class="eap-assignment">{{ departmentTopics.get(item.department)?.map(topic=>topic.label).join('、')||'未指定责任专项' }}</span>
            <span v-if="item.comment" class="eap-comment" :title="item.comment">{{ item.comment }}</span>
            <span class="eap-department-note">{{ opinionText(item) }}<time v-if="item.feedbackAt" :datetime="item.feedbackAt">{{ shortDate(item.feedbackAt) }}</time></span>
          </button>
        </div>
        <button class="ep-link eap-record-link" @click="showRecords()">部门反馈与意见记录<PortalIcon name="chevron" :size="16" /></button>
      </section>
      <section v-else class="ep-block eap-departments">
        <div class="eap-section-heading"><h3>专项责任部门</h3><span>按专项预案分工</span></div>
        <div class="eap-department-grid eap-proposed">
          <article v-for="[department,topics] in departmentTopics" :key="department" class="eap-department-card">
            <div class="eap-department-line"><strong>{{ department }}</strong><small>待推送</small></div>
            <button v-for="topic in topics" :key="topic.id" class="ep-link eap-topic-link" type="button" :aria-label="`查看${topic.label}专项预案`" @click="emit('viewPlan',topic.id)">{{ topic.label }} <PortalIcon name="chevron" :size="16" /></button>
          </article>
        </div>
      </section>
    </template>

    <template v-else>
      <section class="ep-block eap-locked-topics">
        <h3>已锁定专项方案</h3>
        <div class="eap-topic-grid">
          <button v-for="item in assignedTopics" :key="item.id" type="button" :aria-label="`查看${item.label}归档方案`" @click="emit('viewPlan',item.id)">
            <span><PortalIcon name="check" :size="16"/>{{ item.label }}</span><PortalIcon name="chevron" :size="16" />
          </button>
        </div>
      </section>
      <section class="ep-block eap-milestones">
        <h3>完结记录</h3>
        <ol><li v-for="(record,index) in milestones" :key="index"><time :datetime="record.at">{{ shortDate(record.at) }}</time><span>{{ record.detail }}</span></li></ol>
        <button class="ep-link eap-record-link" @click="showRecords()">归档反馈与处理记录<PortalIcon name="chevron" :size="16" /></button>
      </section>
    </template>

    <dialog ref="recordDialog" class="eap-dialog" aria-labelledby="eap-record-heading" @click="($event.target===recordDialog)&&!busy&&recordDialog?.close()" @cancel="busy&&$event.preventDefault()">
      <header><div><span>{{ locked?'归档记录':'部门协同' }}</span><h2 id="eap-record-heading">部门反馈与意见处理</h2></div><button type="button" aria-label="关闭部门反馈记录" :disabled="busy" @click="recordDialog?.close()">×</button></header>
      <div class="eap-dialog-content">
        <p class="eap-dialog-summary">{{ progress.completed }} / {{ progress.total }} 个部门已反馈 · {{ progress.opinions }} 条意见 · {{ progress.adopted }} 条已采纳</p>
        <div class="eap-feedback-records">
          <article v-for="item in feedback" :key="item.taskId" :class="{'is-editing':editingTask===item.taskId}">
            <div class="eap-record-heading"><strong>{{ item.department }}</strong><span :class="{'is-done':item.status==='completed'}">{{ stateText(item) }}</span><button v-if="!readOnly" type="button" :disabled="busy" @click="selectFeedback(item)">{{ feedbackAction(item) }}</button></div>
            <p>{{ item.comment||(item.status==='completed'?'未登记具体意见':'尚未收到部门反馈') }}</p>
            <footer v-if="item.status==='completed'"><span>{{ opinionText(item) }}</span><time v-if="item.feedbackAt" :datetime="item.feedbackAt">{{ dateTime(item.feedbackAt) }}</time></footer>
          </article>
        </div>
        <form v-if="editing&&!readOnly" class="eap-feedback-form" @submit.prevent="saveFeedback">
          <h3>{{ editing.department }} · {{ feedbackAction(editing) }}</h3>
          <p>由平台工作人员登记已收到的部门意见及处理结果。</p>
          <label>反馈内容<textarea v-model="comment" :disabled="busy" required maxlength="2000" rows="4" placeholder="请输入部门反馈内容；无修改意见时请据实填写。"></textarea></label>
          <fieldset :disabled="busy"><legend>意见处理</legend><label><input v-model="disposition" type="radio" value="noted">已记录</label><label><input v-model="disposition" type="radio" value="adopted">已采纳</label></fieldset>
          <p v-if="feedbackError" class="eap-form-error" role="alert">{{ feedbackError }}</p>
          <div class="eap-form-actions"><button type="button" :disabled="busy" @click="editingTask=null">取消登记</button><button class="ep-primary" type="submit" :disabled="busy||!comment.trim()">{{ busy?'正在保存…':'保存部门反馈' }}</button></div>
        </form>
        <section v-if="records.length" class="eap-full-records"><h3>流程记录</h3><ol><li v-for="(record,index) in records" :key="index"><time :datetime="record.at">{{ dateTime(record.at) }}</time><span>{{ record.detail }}</span></li></ol></section>
        <p v-if="locked" class="eap-archive-note">已完结方案及反馈记录已归档锁定。</p>
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.eap-progress { --eap-green:#79e8b3; --eap-amber:#ffca68; }
:global(.cockpit-light) .eap-progress { --eap-green:#087b57; --eap-amber:#946000; }
.eap-summary-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:4px; }
.eap-summary-grid>div { min-width:0; padding:2px 5px; background:var(--ep-card); border:1px solid var(--ep-line); border-radius:2px; display:flex; align-items:baseline; justify-content:space-between; gap:2px; }
.eap-department-line, .eap-record-heading, .eap-section-heading { flex-wrap:wrap; }
.eap-summary-grid span { color:var(--ep-muted); font-size:16px; line-height:24px; white-space:nowrap; }
.eap-summary-grid strong { font:22px/28px "Cockpit Bebas","Microsoft YaHei",sans-serif; color:var(--ep-accent); white-space:nowrap; }
.eap-summary-grid small { color:var(--ep-ink); font:16px/24px "Microsoft YaHei",sans-serif; }
.eap-dispatch-dates { display:grid; gap:2px; margin:6px 0 0; font-size:16px; line-height:24px; }
.eap-dispatch-dates>div { display:flex; flex-wrap:wrap; gap:0 5px; }
.eap-dispatch-dates dt { color:var(--ep-muted); }
.eap-dispatch-dates dd { margin:0; font-variant-numeric:tabular-nums; }
.eap-section-heading { display:flex; justify-content:space-between; align-items:center; gap:8px; }
.eap-section-heading h3 { border-left:3px solid #07eeff; padding-left:8px; }
.eap-section-heading>span { font-size:16px; color:var(--ep-muted); white-space:nowrap; }
.eap-section-heading b { font:22px/24px "Cockpit Bebas",sans-serif; color:var(--eap-green); margin-right:4px; }
.eap-progress-track { height:4px; background:var(--ep-line); margin:8px 0 5px; border-radius:4px; overflow:hidden; }
.eap-progress-track i { display:block; height:100%; background:var(--eap-green); transition:width .25s; }
.eap-progress-caption { color:var(--ep-muted); font-size:16px; line-height:24px; margin:0 0 7px; }
.eap-department-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.eap-department-grid .eap-department-card { min-width:0; padding:6px 8px; text-align:left; background:var(--ep-card); border:1px solid var(--ep-line); border-radius:3px; }
.eap-department-grid button.eap-department-card:is(:hover,:focus-visible) { border-color:var(--ep-accent); }
.eap-department-line { display:flex; align-items:center; justify-content:space-between; gap:4px; }
.eap-department-line strong { font-size:16px; line-height:24px; }
.eap-department-line small { color:var(--eap-amber); font-size:16px; line-height:24px; white-space:nowrap; }
.is-done .eap-department-line small { color:var(--eap-green); }
.eap-assignment,.eap-comment { display:block; color:var(--ep-muted); font-size:16px; line-height:24px; }
.eap-comment { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; color:var(--ep-ink); }
.eap-department-note { display:flex; flex-wrap:wrap; justify-content:space-between; column-gap:5px; align-items:center; color:var(--ep-muted); font-size:16px; line-height:24px; margin-top:2px; }
.eap-record-link { display:inline-flex; align-items:center; gap:2px; margin-top:5px; }
.eap-proposed { margin-top:6px; }
.eap-proposed .eap-topic-link { display:flex; justify-content:space-between; align-items:center; width:100%; padding:1px 0; text-align:left; font-size:16px; line-height:24px; }
.eap-topic-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:4px; }
.eap-topic-grid>button { display:flex; align-items:center; justify-content:space-between; gap:4px; padding:5px 7px; background:var(--ep-card); border:1px solid var(--ep-line); border-radius:3px; }
.eap-topic-grid>button:hover,.eap-topic-grid>button:focus-visible { border-color:var(--eap-green); }
.eap-topic-grid span { display:inline-flex; align-items:center; gap:4px; font-size:16px; line-height:24px; white-space:nowrap; }
.eap-topic-grid svg { color:var(--eap-green); flex:none; }
.eap-milestones ol,.eap-full-records ol { padding:0; margin:0; list-style:none; }
.eap-milestones li { display:flex; gap:9px; position:relative; padding:0 0 9px 15px; font-size:16px; line-height:24px; margin-left:5px; border-left:1px solid var(--ep-line); }
.eap-milestones li:before { content:""; position:absolute; left:-4px; top:7px; height:7px; width:7px; background:var(--ep-accent); border-radius:50%; }
.eap-milestones li:last-child { padding-bottom:0; }
.eap-milestones time { color:var(--ep-muted); font-size:16px; flex:0 0 96px; line-height:24px; }
.eap-dialog { width:min(720px,92vw); max-height:88vh; padding:0; color:var(--ep-ink); border:1px solid var(--ep-border); background:var(--ep-overlay); backdrop-filter:blur(24px); font:16px/24px "Microsoft YaHei",sans-serif; }
.eap-dialog::backdrop { background:#031329a8; }
.eap-dialog>header { display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid var(--ep-line); }
.eap-dialog>header span { color:var(--ep-accent); font-size:16px; }
.eap-dialog>header h2 { font-size:22px; line-height:30px; }
.eap-dialog>header>button { font-size:24px; min-width:36px; }
.eap-dialog-content { padding:16px 20px 20px; overflow-y:auto; max-height:calc(88vh - 100px); }
.eap-dialog-summary { margin:0 0 12px; color:var(--ep-muted); }
.eap-feedback-records { display:grid; gap:10px; }
.eap-feedback-records article { border:1px solid var(--ep-line); padding:12px; background:var(--ep-card); border-radius:3px; }
.eap-feedback-records article.is-editing { border-color:var(--ep-accent); }
.eap-record-heading { display:flex; align-items:center; gap:12px; }
.eap-record-heading strong { font-size:16px; }
.eap-record-heading>span { font-size:16px; color:var(--eap-amber); }
.eap-record-heading>span.is-done { color:var(--eap-green); }
.eap-record-heading button { margin-left:auto; font-size:16px; }
.eap-feedback-records p { margin:8px 0 0; overflow-wrap:anywhere; white-space:pre-wrap; }
.eap-feedback-records footer { display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px; color:var(--ep-muted); margin-top:8px; font-size:16px; }
.eap-feedback-form { margin-top:16px; padding:16px; border:1px solid var(--ep-border); background:var(--ep-card); }
.eap-feedback-form h3 { font-size:18px; margin:0 0 6px; }
.eap-feedback-form>p { font-size:16px; color:var(--ep-muted); margin:0 0 12px; }
.eap-feedback-form>label { display:block; font-size:16px; }
.eap-feedback-form textarea { display:block; width:100%; resize:vertical; min-height:90px; margin-top:6px; font-size:16px; }
.eap-feedback-form fieldset { margin:12px 0; padding:8px 12px; border:1px solid var(--ep-line); }
.eap-feedback-form legend { padding:0 4px; font-size:16px; color:var(--ep-muted); }
.eap-feedback-form fieldset label { display:inline-flex; align-items:center; gap:6px; margin-right:24px; }
.eap-feedback-form input { accent-color:#2371f7; }
.eap-form-actions { display:flex; justify-content:flex-end; gap:8px; }
.eap-feedback-form .eap-form-error { color:#ff9e98; margin:8px 0; }
.eap-full-records { margin-top:20px; }
.eap-full-records h3 { font-size:16px; margin-bottom:8px; }
.eap-full-records li { display:flex; gap:12px; padding:6px 0; border-bottom:1px solid var(--ep-line); }
.eap-full-records time { flex:0 1 176px; color:var(--ep-muted); font-size:16px; }
.eap-full-records span { overflow-wrap:anywhere; }
.eap-archive-note { color:var(--eap-green); background:#36c99b12; padding:10px 12px; margin:16px 0 0; border-left:2px solid var(--eap-green); }
@media(prefers-reduced-motion:reduce){.eap-progress-track i{transition:none}}

@container (max-width:330px) {
  .eap-department-grid { grid-template-columns:minmax(0,1fr); }
  .eap-topic-grid>button { padding-inline:4px; gap:2px; }
}
@media(max-width:600px) {
  .eap-dialog { width:calc(100% - 16px); }
  .eap-full-records li { display:grid; gap:2px; }
}
</style>
