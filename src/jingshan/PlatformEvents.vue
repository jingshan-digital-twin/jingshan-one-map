<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { api } from './api'
import type { EventCatalog } from './event-plan-types'
import type { LiveEventMonitor, LiveIncidentStatus } from './event-live-types'
import type { ReviewCatalog } from './event-post-review'
import { assessmentProgress, assessmentStatus, assessmentVersion } from './event-workflow'
import { isPlatformFormDataset } from './platform-forms'
import { platformLink } from './platform-navigation'
import PortalIcon from './PortalIcon.vue'
import type { Dataset } from './types'

const props = defineProps<{datasets:Dataset[];version:number}>()
const sections = [
  {id:'plans',label:'赛前研判',scene:'events'}, {id:'live',label:'赛中协同',scene:'liveEvent'},
  {id:'archives',label:'赛后复盘',scene:'tourism'}, {id:'data',label:'数据维护',scene:''},
] as const
type Section = typeof sections[number]['id']
const section = ref<Section>('plans'), refresh = ref(0), search = ref(''), page = ref(1)
const plans = shallowRef<EventCatalog>(), monitors = shallowRef<LiveEventMonitor[]>([]), reviews = shallowRef<ReviewCatalog>()
const loading = ref(false), error = ref('')
const resources = computed(() => {
  const ids = ['event_plans','events','event_live_monitors','event_live_points','event_live_roads','event_live_alerts','event_live_incidents','event_live','event_actuals']
  return ids.flatMap(id => props.datasets.filter(d => d.id === id))
})
const title = computed(() => sections.find(item=>item.id===section.value)!)
function cockpit(id?:string) {
  const params = new URLSearchParams({scene:title.value.scene})
  if (id) params.set('eventId',id)
  return '/?' + params
}
watch(section,()=>{search.value=''; page.value=1})
watch(search,()=>{page.value=1})
watch([section,refresh,()=>props.version],async ([target],_,onCleanup) => {
  error.value=''
  loading.value=target!=='data'
  if (target==='data') return
  const controller=new AbortController()
  onCleanup(()=>controller.abort())
  const opts={signal:controller.signal}
  try {
    if (target==='plans') {
      const data=await api<EventCatalog>('/event-plans',opts)
      if (!controller.signal.aborted) plans.value=data
    } else if (target==='live') {
      const data=await api<{events:LiveEventMonitor[]}>('/event-live',opts)
      if (!controller.signal.aborted) monitors.value=data.events
    } else {
      const data=await api<ReviewCatalog>('/event-reviews',opts)
      if (!controller.signal.aborted) reviews.value=data
    }
  } catch(e) {
    if (!controller.signal.aborted) error.value=e instanceof Error ? e.message : '赛事数据读取失败'
  } finally { if (!controller.signal.aborted) loading.value=false }
},{immediate:true})
const incidentStatus:Record<LiveIncidentStatus,string> = {
  pending:'待派单',dispatched:'已派单',received:'已签收',onsite:'到场处置',resolved:'已办结',
}
const includesSearch=(...values:string[]) => values.join(' ').toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())
const planRows = computed(() => {
  const catalog=plans.value
  if (!catalog) return []
  const events=new Map(catalog.events.map(event=>[event.id,event]))
  for (const plan of Object.values(catalog.assessments)) {
    if (plan.eventSnapshot && !events.has(plan.eventId)) events.set(plan.eventId,plan.eventSnapshot)
  }
  return [...events.values()].map(event=>{
    const plan=catalog.assessments[event.id], progress=assessmentProgress(plan)
    const state=plan || event.assessment ? assessmentStatus(plan) : '已入赛历'
    const feedback=plan?.departments.map((department,index)=>{
      const entry=plan.feedback?.find(item=>item.taskId===plan.taskIds[index])
      const status=entry?.status==='completed'?'已反馈':entry?.status==='received'?'已签收':'待反馈'
      return {department,status,comment:entry?.comment}
    }) ?? []
    return {event,plan,progress,state,feedback,date:event.dateText || event.monthText || '待定'}
  }).filter(({event,state})=>includesSearch(event.name,String(event.year),state))
    .sort((a,b)=>Number(!!b.plan)-Number(!!a.plan) || b.event.year-a.event.year || a.event.sequence-b.event.sequence)
})
const liveRows=computed(()=>monitors.value.filter(event=>includesSearch(event.name,event.venueName)))
const archiveRows=computed(()=>(reviews.value?.archives ?? []).filter(event=>includesSearch(event.name,event.region)))
const count=computed(()=>section.value==='plans'?planRows.value.length:section.value==='live'?liveRows.value.length:archiveRows.value.length)
const perPage=12
const pages=computed(()=>Math.max(1,Math.ceil(count.value/perPage)))
watch(pages,max=>{page.value=Math.min(page.value,max)})
function slice<T>(rows:T[]) { return rows.slice((page.value-1)*perPage,page.value*perPage) }
</script>

<template>
  <section class="platform-events">
    <nav class="event-admin-tabs" aria-label="赛事管理模块">
      <button v-for="item in sections" :key="item.id" type="button" :aria-pressed="section===item.id" @click="section=item.id">{{ item.label }}</button>
    </nav>
    <section class="event-admin-panel">
      <header class="event-admin-toolbar">
        <h2>{{ section==='plans'?'赛事计划及办理进度':section==='live'?'赛中处置与通知':section==='archives'?'复盘归档':title.label }}</h2>
        <template v-if="section!=='data'">
          <input v-model="search" type="search" aria-label="搜索赛事" placeholder="搜索赛事">
          <button type="button" :disabled="loading" @click="refresh++">刷新</button>
          <a :href="cockpit()" target="_blank" rel="noopener">进入{{ title.label }} <PortalIcon name="external" :size="14"/></a>
        </template>
      </header>
      <template v-if="section==='data'">
        <div class="event-resource-list">
          <a v-for="resource in resources" :key="resource.id" :href="platformLink(isPlatformFormDataset(resource)?'forms':'local',resource.id)">
            <PortalIcon :name="isPlatformFormDataset(resource)?'forms':'local'"/><strong>{{ resource.name }}</strong>
            <span>{{ resource.features.length.toLocaleString('zh-CN') }} 条</span><PortalIcon name="chevron" :size="14"/>
          </a>
          <p v-if="!resources.length">当前工作区尚无赛事资源。</p>
        </div>
      </template>
      <p v-else-if="error" role="alert">{{error}}</p>
      <p v-else-if="loading" role="status">正在读取{{ title.label }}数据…</p>
      <p v-else-if="!count">{{ search.trim()?'没有匹配的赛事。':section==='archives'?'暂无已归档的复盘报告。':section==='live'?'暂无进行中的赛事监测记录。':'暂无已发布的赛事计划。' }}</p>
      <template v-else>
        <div v-if="section==='plans'" class="event-admin-scroll">
          <table><thead><tr><th>赛事</th><th>计划赛期</th><th>状态</th><th>责任部门反馈</th><th>研判方案</th></tr></thead>
            <tbody><tr v-for="r in slice(planRows)" :key="r.event.id">
              <th scope="row">{{r.event.name}}</th><td>{{r.event.year}} · {{r.date}}</td><td>{{r.state}}</td>
              <td><details v-if="r.plan && r.progress.total"><summary>{{r.progress.completed}} / {{r.progress.total}} 个部门</summary>
                <ul><li v-for="entry in r.feedback" :key="entry.department"><strong>{{entry.department}}</strong> · {{entry.status}}<template v-if="entry.comment"> · {{entry.comment}}</template></li></ul>
              </details><span v-else>—</span></td>
              <td><a :href="cockpit(r.event.id)" target="_blank" rel="noopener">{{r.plan?'查看 V'+assessmentVersion(r.plan):'查看赛事'}}</a></td>
            </tr></tbody>
          </table>
        </div>
        <div v-else-if="section==='live'" class="event-live-items">
          <article v-for="event in slice(liveRows)" :key="event.id">
            <div class="event-live-heading"><h3>{{event.name}} <small v-if="event.demo">演练</small></h3><a :href="cockpit(event.id)" target="_blank" rel="noopener">查看协同</a></div>
            <span>{{event.venueName || '场馆待补充'}} · {{event.points.length}} 个监测点 · {{event.alerts.length}} 条预警</span>
            <details><summary>处置事项（{{event.incidents.length}}）</summary>
              <ul v-if="event.incidents.length"><li v-for="item in event.incidents" :key="item.id"><strong>{{item.title}}</strong> · {{item.department}} · {{incidentStatus[item.status]}}</li></ul>
              <p v-else>暂无处置事项。</p>
            </details>
            <details><summary>已发通知（{{event.publicNotices.length}}）</summary>
              <ul v-if="event.publicNotices.length"><li v-for="notice in event.publicNotices" :key="notice.id">{{notice.text}} <time>{{new Date(notice.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}}</time></li></ul>
              <p v-else>暂无已发通知。</p>
            </details>
          </article>
        </div>
        <div v-else class="event-admin-scroll"><table><thead><tr><th>赛事</th><th>开赛日期</th><th>所属区域</th><th>报告</th></tr></thead>
          <tbody><tr v-for="event in slice(archiveRows)" :key="event.id"><th scope="row">{{event.name}}</th><td>{{event.start || '待补充'}}</td><td>{{event.region || '待补充'}}</td>
            <td><a :href="cockpit(event.id)" target="_blank" rel="noopener">查看归档</a></td></tr></tbody>
        </table></div>
        <footer><span>共 {{count}} 条</span><button :disabled="page===1" type="button" @click="page--">上一页</button><span>{{page}} / {{pages}}</span><button :disabled="page===pages" type="button" @click="page++">下一页</button></footer>
      </template>
    </section>
  </section>
</template>

<style scoped>
.platform-events { display:grid; gap:16px; min-width:0; color:var(--platform-ink); }
.event-admin-tabs, .event-admin-toolbar, .event-live-heading, footer { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.event-admin-tabs button[aria-pressed=true] { background:var(--platform-accent); border-color:var(--platform-accent); color:white; }
.event-admin-panel { min-width:0; background:var(--platform-paper); border:1px solid var(--platform-line); border-radius:14px; padding:clamp(12px,2vw,24px); }
.event-admin-toolbar h2,.event-live-heading h3 { margin:0 auto 0 0; font-size:17px; }
.event-admin-toolbar { margin-bottom:16px; }
.event-admin-toolbar input { max-width:100%; width:170px; }
.platform-events a { color:var(--platform-accent); text-decoration:none; }
.platform-events a:hover { text-decoration:underline; }
.event-admin-toolbar a, .event-resource-list a { display:inline-flex; align-items:center; gap:8px; }
.event-admin-scroll { overflow:auto; border:1px solid var(--platform-line); border-radius:8px; }
.event-admin-scroll table { width:100%; min-width:580px; border-collapse:collapse; }
.event-admin-scroll :is(th,td) { text-align:left; padding:11px 13px; border-bottom:1px solid var(--platform-line); }
.event-admin-scroll thead { background:var(--platform-soft); font-size:13px; }
.event-admin-scroll tbody th { font-weight:550; }
.event-admin-scroll details summary { cursor:pointer; }
.event-admin-scroll details ul { margin:6px 0; padding-left:16px; max-width:33ch; overflow-wrap:anywhere; }
.event-admin-scroll tr:last-child td,.event-admin-scroll tbody tr:last-child th { border-bottom:0; }
footer { justify-content:flex-end; margin-top:14px; color:var(--platform-muted); font-size:13px; }
footer span:first-child { margin-right:auto; }
.event-resource-list { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr)); gap:10px; }
.event-resource-list a,.event-live-items article { border:1px solid var(--platform-line); padding:14px; border-radius:8px; }
.event-resource-list strong { color:var(--platform-ink); }
.event-resource-list span { margin-left:auto; color:var(--platform-muted); white-space:nowrap; }
.event-live-items { display:grid; gap:12px; }
.event-live-heading { margin-bottom:5px; }
.event-live-heading h3 { font-size:16px; }
.event-live-items article > span,.event-live-items time,.event-live-items small { color:var(--platform-muted); font-size:12px; }
.event-live-items details { margin-top:9px; }
.event-live-items summary { cursor:pointer; }
.event-live-items li { margin:5px 0; overflow-wrap:anywhere; }
</style>
