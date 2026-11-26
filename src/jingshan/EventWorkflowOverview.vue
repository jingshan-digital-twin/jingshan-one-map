<script setup lang="ts">
import { ref } from 'vue'
import type { AssessmentOverview, AssessmentStage } from './event-assessment-overview'
import type { PlannedEvent } from './event-plan-types'
import PortalIcon from './PortalIcon.vue'

defineProps<{ summary:AssessmentOverview; activeFilter:string }>()
const emit = defineEmits<{ filter:[stage:AssessmentStage]; select:[event:PlannedEvent] }>()
const dialog = ref<HTMLDialogElement>()
const issue = ref<'overlap'|'venue'>('overlap')

function openIssue(value:typeof issue.value) {
  issue.value = value
  dialog.value?.showModal()
}
function select(event:PlannedEvent) {
  dialog.value?.close()
  emit('select',event)
}
function overlapDates(start:string, end:string) {
  const monthDay = (iso:string) => Number(iso.slice(5,7)) + '月' + Number(iso.slice(8)) + '日'
  if (start === end) return monthDay(start)
  return monthDay(start) + '至' + (start.slice(0,7) === end.slice(0,7) ? Number(end.slice(8)) + '日' : monthDay(end))
}
</script>

<template>
  <section class="ew-overview" aria-labelledby="assessment-overview-heading">
    <header class="v14-overview-heading ep-heading"><h2 id="assessment-overview-heading">赛前研判概览</h2></header>
    <div class="ew-body">
      <section class="ew-section" aria-labelledby="assessment-stages-heading">
        <h3 id="assessment-stages-heading">研判进度</h3>
        <div class="ew-stats" role="group" aria-label="按研判进度筛选赛事">
          <button v-for="row in summary.stageRows" :key="row.stage" type="button" class="ew-stat"
            :aria-pressed="activeFilter===row.stage" @click="emit('filter',row.stage)">
            <strong>{{ row.stage }}</strong>
            <span class="ew-metric"><b>{{ row.count }}</b> 场</span>
          </button>
        </div>
      </section>

      <section class="ew-section" aria-labelledby="assessment-topics-heading">
        <h3 id="assessment-topics-heading">专项保障进度</h3>
        <div v-if="summary.topics.length" class="ew-topics">
          <div class="ew-topic-head"><span>保障专项</span><span>已反馈 / 已交办部门</span></div>
          <ul>
            <li v-for="topic in summary.topics" :key="topic.id" :class="{'ew-pending':topic.responded < topic.assigned}">
              <span>{{ topic.label }}</span>
              <progress :value="topic.responded" :max="topic.assigned" :aria-label="topic.label+'部门反馈进度'"></progress>
              <span class="ew-ratio"><b>{{ topic.responded }}</b> / {{ topic.assigned }}</span>
            </li>
          </ul>
        </div>
        <p v-else class="ew-empty">暂无已交办专项</p>
      </section>

      <section class="ew-section" aria-labelledby="assessment-issues-heading">
        <h3 id="assessment-issues-heading">赛前待核事项</h3>
        <button type="button" class="ew-issue" :class="{'ew-highlight':summary.overlaps.length}" aria-haspopup="dialog"
          :disabled="!summary.overlaps.length" @click="openIssue('overlap')">
          <span class="ew-issue-title"><PortalIcon name="layers"/><strong>同馆赛期重叠</strong><b>{{ summary.overlaps.length }} 组</b><PortalIcon v-if="summary.overlaps.length" name="chevron" :size="16"/></span>
          <span v-if="summary.overlaps.length" class="ew-issue-note">{{ summary.overlaps[0].venue }} · {{ overlapDates(summary.overlaps[0].startDate,summary.overlaps[0].endDate) }}</span>
        </button>
        <button type="button" class="ew-issue" aria-haspopup="dialog" :disabled="!summary.missingVenues.length" @click="openIssue('venue')">
          <span class="ew-issue-title"><PortalIcon name="pin"/><strong>场馆待确定</strong><b>{{ summary.missingVenues.length }} 场</b><PortalIcon v-if="summary.missingVenues.length" name="chevron" :size="16"/></span>
          <span v-if="summary.missingVenues.length" class="ew-issue-note">{{ summary.missingVenues[0].dateText }} · {{ summary.missingVenues[0].name }}</span>
        </button>
      </section>
    </div>

    <dialog ref="dialog" class="ep-dialog ew-dialog" aria-labelledby="assessment-issue-heading">
      <header><h2 id="assessment-issue-heading">{{ issue==='overlap'?'同馆赛期重叠':'场馆待确定' }}</h2>
        <button type="button" aria-label="关闭待核事项" autofocus @click="dialog?.close()">×</button>
      </header>
      <div class="ew-dialog-body">
        <template v-if="issue==='overlap'">
          <section v-for="group in summary.overlaps" :key="group.venue+group.startDate+group.endDate" class="ew-compare">
            <header><h3>{{ group.venue }}</h3><span>重叠赛期 {{ overlapDates(group.startDate,group.endDate) }}</span></header>
            <div class="ew-match-grid">
              <article v-for="event in group.events" :key="event.id" class="ew-match">
                <h4>{{ event.name }}</h4>
                <dl><div><dt>比赛日期</dt><dd>{{ event.year }}年 {{ event.dateText }}</dd></div>
                  <div><dt>举办场馆</dt><dd>{{ event.venueNames.join('、') }}</dd></div></dl>
                <button type="button" :aria-label="'查看赛事：'+event.name" @click="select(event)">查看赛事 <PortalIcon name="chevron" :size="16"/></button>
              </article>
            </div>
          </section>
        </template>
        <template v-else>
          <button v-for="event in summary.missingVenues" :key="event.id" type="button" class="ew-missing-event" @click="select(event)">
            <strong>{{ event.name }}</strong><span>{{ event.year }}年 {{ event.dateText || '赛期待定' }}</span><PortalIcon name="chevron" :size="18"/>
          </button>
        </template>
      </div>
    </dialog>
  </section>
</template>

<style scoped>
.ew-overview,.ew-body { display:flex; flex:1; flex-direction:column; min-height:0; }
.ew-body { gap:16px; padding:12px; overflow:auto; scrollbar-width:thin; scrollbar-color:var(--v14-scroll-thumb) transparent; }
.ew-section { display:grid; gap:6px; min-width:0; }
.ew-section h3,.ew-compare h3 { margin:0; border-inline-start:3px solid var(--ep-accent); padding-inline-start:8px; }
.ew-stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; }
.event-preassessment :is(.ew-stat,.ew-issue,.ew-match,.ew-missing-event),.ew-empty,.ew-topics {
  min-width:0; color:var(--ep-ink); background:var(--ep-card); border:1px solid var(--ep-line); border-radius:3px;
}
.event-preassessment .ew-stat { display:grid; justify-items:center; gap:3px; padding:8px 2px; }
.event-preassessment .ew-stat[aria-pressed="true"] { background:var(--ep-selected); color:#fff; border-color:var(--ep-border); }
.ew-stat strong,.ew-issue-title { font:700 16px/24px var(--v14-font); }
.ew-metric { font:400 16px/22px var(--v14-font); }
.ew-metric b { color:var(--ep-accent); font:400 30px/32px "Cockpit Bebas",var(--v14-font); }
.ew-stat[aria-pressed="true"] .ew-metric b { color:inherit; }
.ew-empty,.ew-topics { margin:0; padding:8px 10px; }
.ew-empty,.ew-topic-head,.ew-issue-note,.ew-match dt,.ew-missing-event span { color:var(--ep-muted); }
.ew-topic-head,.ew-compare header { display:flex; align-items:baseline; justify-content:space-between; flex-wrap:wrap; gap:2px 10px; }
.ew-topic-head { padding-bottom:4px; border-bottom:1px solid var(--ep-line); }
.ew-topics ul { list-style:none; margin:0; padding:0; }
.ew-topics li { display:grid; grid-template-columns: auto minmax(24px,1fr) auto; gap:8px; align-items:center; padding:3px 0; }
.ew-topics progress { display:block; width:100%; height:6px; overflow:hidden; border:0; border-radius:3px; appearance:none; background:var(--v14-chart-track); }
.ew-topics progress::-webkit-progress-bar { background:var(--v14-chart-track); }
.ew-topics progress::-webkit-progress-value { border-radius:3px; background:linear-gradient(90deg,#2485ff,var(--ep-accent)); }
.ew-topics progress::-moz-progress-bar { background:var(--ep-accent); }
.ew-ratio { min-width:3em; text-align:end; font-variant-numeric:tabular-nums; }
.ew-ratio b { color:var(--ep-accent); }
.ew-pending .ew-ratio b,.ew-highlight .ew-issue-title :is(svg,b),.ew-compare header span { color:var(--ep-gold); }
.event-preassessment .ew-issue { display:grid; gap:3px; padding:8px 10px; text-align:start; }
.event-preassessment .ew-issue:disabled { opacity:1; color:var(--ep-muted); }
.event-preassessment .ew-issue.ew-highlight { border-inline-start:3px solid var(--ep-gold); padding-inline-start:8px; }
.ew-issue-title { display:flex; gap:6px; align-items:center; }
.ew-issue-title b { margin-inline-start:auto; white-space:nowrap; }
.ew-issue-title svg { flex:none; }
.ew-issue-note { overflow-wrap:anywhere; font:400 16px/22px var(--v14-font); }
.event-preassessment .ew-dialog { width:min(760px,96vw); max-height:85dvh; box-sizing:border-box; }
.ew-dialog h2,.ew-match h4,.ew-match dl,.ew-match dd { margin:0; }
.ew-dialog-body,.ew-compare,.ew-match { display:grid; }
.ew-dialog-body { gap:16px; padding:14px 18px; max-height:calc(85dvh - 76px); overflow:auto; box-sizing:border-box; }
.ew-compare { gap:8px; min-width:0; }
.ew-match-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.event-preassessment .ew-match { grid-row:span 3; grid-template-rows:subgrid; gap:8px; padding:12px; overflow-wrap:anywhere; }
.ew-match h4 { font:700 18px/25px var(--v14-font); }
.ew-match dl { display:grid; align-content:start; gap:6px; }
.ew-match button { display:flex; align-items:center; justify-content:space-between; align-self:end; }
.event-preassessment .ew-missing-event { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:2px 6px; text-align:start; padding:8px 12px; }
.ew-missing-event svg { grid-column:2; grid-row:1 / 3; align-self:center; }
@media (min-width:961px) and (max-height:820px) {
  .ew-body { gap:8px; padding:8px; }
  .ew-section { gap:4px; }
  .event-preassessment .ew-stat { gap:0; padding:3px 2px; }
  .ew-topics { padding:4px 8px; }
  .ew-topic-head { line-height:22px; padding-bottom:2px; }
  .ew-topics li { line-height:23px; padding:0; }
  .event-preassessment .ew-issue { padding-block:4px; }
  .ew-body:has(.ew-topics li:nth-child(6)) .ew-issue:not(.ew-highlight) .ew-issue-note { display:none; }
}
@media(max-width:560px) {
  .ew-dialog-body,.event-preassessment .ew-match { padding:8px; }
  .ew-match-grid { gap:4px; }
}
</style>
