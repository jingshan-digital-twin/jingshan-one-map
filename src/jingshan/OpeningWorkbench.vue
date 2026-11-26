<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, toRaw, watch } from 'vue'
import { api, jsonRequest } from './api'
import { chinaClock, dayNames, type OpeningSchedule } from './opening-schedule'
import { planningInventory, proposalGroups, weeklyWindow, type CourtChoice } from './opening-proposal'
import { openingStageLabels,openingTaskLink,type ActiveVenueTask,type CreatedOpeningTask,type OpeningTaskLink } from './venue-opening'
import { gapAreaFrame, gapAreaMask, openingGapSelection, openingImpact, openingRecommendations, type GapArea, type OpeningPopulation } from './opening-population'
import { dashboardPalette } from './dashboard-palette'
import { featureCenter, type CityFeature, type Dataset } from './types'
import { circle } from './analytics'
import type { SceneMap } from './scene-map'
import IndustryRail from './IndustryRail.vue'
import IndustryModule from './IndustryModule.vue'
import ServicePager from './ServicePager.vue'
import { useServicePage } from './service-pagination'

const props=defineProps<{pane:'gaps'|'plan';data:Dataset[];model?:OpeningPopulation;areas:GapArea[];version:number;taskRefresh:number;mode:'demo'|'live';plans:OpeningSchedule[];
  region:string;scopeName:string;leftOpen:boolean;rightOpen:boolean;today:string;warning:string;mapPick?:{feature:CityFeature}|null}>()
const emit=defineEmits<{navigate:[page:'plan'|'tasks'|'gaps'];task:[link:OpeningTaskLink];close:[side:'right'];open:[side:'right'];scene:[view:SceneMap];created:[]}>()
const chosen=defineModel<string[]>('chosen',{required:true})
const areaId=defineModel<string>('areaId',{required:true})
const days=ref<number[]>([6]),from=ref('09:00'),until=ref('12:00'),query=ref(''),gapQuery=ref('')
const focusCourt=ref(''), focusRevision=ref(0)
const due=ref(chinaClock(Date.now()+7*86400000).date),busy=ref(false),error=ref('')
const createdTasks=shallowRef<CreatedOpeningTask[]>([])
const number=(n:number)=>Math.round(n).toLocaleString('zh-CN')
const percent=(n:number,total:number)=>total ? (100*n/total).toFixed(1)+'%' : '—'
const scopeLabel=computed(()=>props.scopeName||props.region)
const selectedArea=computed(()=>props.areas.find(a=>a.id===areaId.value))
const areaMask=computed(()=>props.model && selectedArea.value ? gapAreaMask(props.model,selectedArea.value) : undefined)
const areaRows=computed(()=>props.areas.filter(a=>a.name.includes(gapQuery.value.trim())))
const areaPage=useServicePage(areaRows,[gapQuery,()=>props.region],10)
const topTowns=computed(()=>props.areas.filter(a=>a.town!=='京山市').slice(0,5))
const gapSummary=computed(()=>{
  const a=selectedArea.value,m=props.model
  const total=a?.total??m?.total??0,covered=a?.covered??m?.covered??0,gap=a?.people??m?.densePeople??0
  const uncovered=total-covered
  return {total,gap,uncovered,parts:[
    {label:'已覆盖',people:covered,color:dashboardPalette.blue},
    {label:'高密度未覆盖',people:gap,color:dashboardPalette.orange},
    {label:'其他未覆盖',people:uncovered-gap,color:'var(--v14-muted)'},
  ]}
})
function selectArea(area:GapArea){
  areaId.value=area.id;focusCourt.value=''
  focusRevision.value++
  if(!areaRows.value.some(a=>a.id===area.id))gapQuery.value=''
  areaPage.reveal(areaRows.value.findIndex(a=>a.id===area.id))
  emit('open','right')
}
function clearArea(){areaId.value='';focusCourt.value=''}
const windowSpec=computed(()=>{try{return weeklyWindow({days:days.value,from:from.value,until:until.value})}catch{return undefined}})
const inventoryWindow=shallowRef(weeklyWindow({days:days.value,from:from.value,until:until.value}))
watch(windowSpec,value=>{if(value)inventoryWindow.value=value},{flush:'sync'})
const available=computed(()=>planningInventory(toRaw(props.data),toRaw(props.plans),inventoryWindow.value,props.today).choices
  .filter(c=>props.region==='京山市'||c.region===props.region))
const selection=computed(()=>new Set(chosen.value))
const picked=computed(()=>chosen.value.flatMap(id=>availableById.value.get(id)??[]))
const availableById=computed(()=>new Map(available.value.map(c=>[c.id,c])))
const impact=computed(()=>props.model && openingImpact(props.model,picked.value.map(c=>c.id)))
const after=computed(()=>(props.model?.covered??0)+(impact.value?.added??0))
const grouped=computed(()=>proposalGroups(picked.value))
const hours=computed(()=>picked.value.reduce((n,c)=>n+c.missingMinutes/60,0))
const venueRows=computed(()=>{
  const groups=new Map<string,CourtChoice[]>()
  for(const c of available.value){
    const rows=groups.get(c.venueId)
    if(rows)rows.push(c);else groups.set(c.venueId,[c])
  }
  return [...groups.values()].map(courts=>{
    const first=courts[0],effect=props.model && openingImpact(props.model,courts.map(c=>c.id))
    return {id:first.venueId,name:first.venueName,region:first.region,office:first.office,courts,effect}
  }).sort((a,b)=>(b.effect?.denseAdded??0)-(a.effect?.denseAdded??0) ||
    (b.effect?.added??0)-(a.effect?.added??0) || a.name.localeCompare(b.name,'zh-CN'))
})
type VenueRow=typeof venueRows.value[number]
const ranked=computed(()=>venueRows.value.filter(v=>(v.name+v.office+v.region+v.courts.map(c=>c.name).join(' ')).includes(query.value.trim())))
const pager=useServicePage(ranked,[query,areaId,()=>props.region],6)
const activeTasks=shallowRef<Map<string,ActiveVenueTask>>(),activeError=ref(''),reloadActive=ref(0)
function refreshActive(){if(props.pane==='plan')reloadActive.value++}
onMounted(()=>window.addEventListener('focus',refreshActive))
onBeforeUnmount(()=>window.removeEventListener('focus',refreshActive))
watch([()=>props.pane,()=>props.mode,()=>props.taskRefresh,reloadActive,chosen],async([pane,mode],previous,onCleanup)=>{
  if(pane!=='plan' || previous?.[0]!==pane || previous?.[1]!==mode)activeTasks.value=undefined
  activeError.value=''
  if(pane!=='plan')return
  const controller=new AbortController()
  const receipts=createdTasks.value
  onCleanup(()=>controller.abort())
  try{
    const result=await api<{tasks:ActiveVenueTask[]}>('/venue-opening/active-venues?mode='+mode,{signal:controller.signal})
    if(controller.signal.aborted)return
    activeTasks.value=new Map(result.tasks.map(task=>[task.venueId,task]))
    if(receipts===createdTasks.value && receipts.length){
      const activeIds=new Set(result.tasks.map(task=>task.taskId))
      const remaining=receipts.filter(task=>activeIds.has(task.id))
      if(remaining.length!==receipts.length)createdTasks.value=remaining
    }
  }catch{
    if(!controller.signal.aborted){activeTasks.value=undefined;activeError.value='在办场馆名单读取失败。'}
  }
},{immediate:true})
const recommended=computed(()=>props.model && activeTasks.value ?
  openingRecommendations(props.model,venueRows.value,selection.value,impact.value?.indices,new Set(activeTasks.value.keys())).slice(0,3) : [])
const linkedTasks=computed(()=>{
  if(createdTasks.value.length)return createdTasks.value.map(task=>({...openingTaskLink(task),department:task.department}))
  const tasks=new Map<string,ActiveVenueTask>()
  for(const court of picked.value){
    const task=activeTasks.value?.get(court.venueId)
    if(task)tasks.set(task.taskId,task)
  }
  return [...tasks.values()]
})
const ledgerTaskId=ref('')
const ledgerTarget=computed(()=>linkedTasks.value.find(task=>task.taskId===ledgerTaskId.value)??linkedTasks.value[0])
const mixedSelection=computed(()=>linkedTasks.value.length>0 && !createdTasks.value.length &&
  picked.value.some(c=>!activeTasks.value?.has(c.venueId)))
const canAssign=computed(()=>!!activeTasks.value && !busy.value && picked.value.length>0 && !linkedTasks.value.length &&
  !!windowSpec.value && !!due.value && due.value>=props.today && !props.warning)
function venueStatus(venue:VenueRow){
  if(!activeTasks.value)return activeError.value?'工单状态待核实':'正在核对工单'
  const task=activeTasks.value.get(venue.id)
  if(task)return openingStageLabels[task.stage]
  return '可协调 '+venue.courts.length+' 片'
}
function openVenueTask(venueId:string){
  const task=activeTasks.value?.get(venueId)
  if(task)emit('task',task)
}
const expanded=ref('')
function choose(ids:string[],checked:boolean){
  const next=new Set(chosen.value)
  for(const id of ids){if(checked)next.add(id);else next.delete(id)}
  chosen.value=[...next]
  if(checked && ids.length)locate(ids[0])
  if(checked && !props.rightOpen && window.matchMedia('(min-width:877px)').matches)emit('open','right')
}
function setVenue(v:VenueRow,event:Event){choose(v.courts.map(c=>c.id),(event.target as HTMLInputElement).checked)}
function locate(id:string){focusCourt.value=id;focusRevision.value++}
function pickedName(v:VenueRow){return v.courts.map(c=>c.name).join('、')}
watch(available,rows=>{
  if(!windowSpec.value)return
  const ids=new Set(rows.map(c=>c.id))
  if(chosen.value.some(id=>!ids.has(id)))chosen.value=chosen.value.filter(id=>ids.has(id))
})
watch(()=>props.pane,()=>{focusCourt.value='';focusRevision.value=0;gapQuery.value=''})
watch(()=>props.mapPick,pick=>{
  const id=pick?.feature.properties.choiceId
  const row=venueRows.value.find(v=>v.courts.some(c=>c.id===id))
  if(!row || props.pane!=='plan')return
  if(query.value && !ranked.value.some(v=>v.id===row.id))query.value=''
  expanded.value=row.id
  pager.reveal(ranked.value.findIndex(v=>v.id===row.id))
})
watch([chosen,windowSpec,due,areaId,()=>props.version,()=>props.mode],()=>{createdTasks.value=[];error.value=''})
const mapSelection=computed(()=>props.model && openingGapSelection(props.model,props.pane==='plan' ? impact.value?.indices : undefined,areaMask.value))
const scene=computed<SceneMap>(()=>{
  const features:CityFeature[]=[]
  const area=selectedArea.value, fit=area && gapAreaFrame(area)
  if(area?.boundary)features.push({...area.boundary,id:'opening-area:'+area.id,properties:{...area.boundary.properties,mapRole:'range',showLabel:false,
    color:'#52cde0',fillOpacity:.04,dashed:false,legendLabel:'所选片区',interactive:false}})
  if(props.pane==='plan'){
    const visible=new Map(recommended.value.map(({venue})=>[venue.id,venue]))
    for(const row of venueRows.value)if(row.courts.some(c=>selection.value.has(c.id)))visible.set(row.id,row)
    for(const row of visible.values()){
      const selected=row.courts.filter(c=>selection.value.has(c.id))
      const representative=row.courts.find(c=>c.id===focusCourt.value)??selected[0]??row.courts[0]
      const pos=featureCenter(representative.feature)
      if(pos)features.push({type:'Feature',id:'opening-venue:'+row.id,geometry:{type:'Point',coordinates:pos},properties:{
        name:row.name,region:row.region,kind:'plan-court',choiceId:representative.id,mapRole:'venue',selected:!!selected.length,
        showLabel:true,labelOnZoom:true,limitLabelAtDistance:true,labelMaxDistance:7500,color:selected.length?'#22cab2':'#5699f5',legendLabel:selected.length?'拟开放场馆':'推荐场馆'}})
      for(const c of selected){
        const center=featureCenter(c.feature)
        if(!center || !props.model)continue
        const ring=circle('opening-circle:'+c.id,c.name,'opening-range',c.region,center,props.model.radius,'#29c9b7')
        features.push({...ring,properties:{...ring.properties,mapRole:'range',fillOpacity:.06,dashed:false,showLabel:false,interactive:false,legendLabel:'拟开放服务圈'}})
      }
    }
  }
  const focused=props.pane==='plan' && availableById.value.get(focusCourt.value)
  const anchor=focused && featureCenter(focused.feature)
  return {servicePane:props.pane,populationMode:'opening',populationSelection:mapSelection.value,features,focusRevision:focusRevision.value,
    ...(anchor ? {focus:'area',anchor,height:Math.max(3700,(props.model?.radius??1000)*5)} : fit ? {focus:'area',fitFeature:fit} : {focus:'county'})}
})
watch(scene,view=>emit('scene',view),{immediate:true})
let retry:{key:string;id:string}|undefined
async function assign(){
  if(!canAssign.value)return
  const body={...windowSpec.value,mode:props.mode,version:props.version,due:due.value,gridId:selectedArea.value?.boundary?.id??'',
    courtIds:picked.value.map(c=>c.id).sort(),scheduleKey:props.plans.map(s=>s.taskId+':'+s.revision+':'+s.venueId).sort().join('|')}
  const key=JSON.stringify(body)
  if(retry?.key!==key)retry={key,id:crypto.randomUUID()}
  busy.value=true;error.value=''
  try{const result=await api<{tasks:CreatedOpeningTask[]}>('/venue-opening/batch',jsonRequest('POST',{...body,requestId:retry.id}))
    createdTasks.value=result.tasks;retry=undefined;emit('created')
  }catch(e){error.value=(e as Error).message;refreshActive()}finally{busy.value=false}
}
</script>
<template>
  <IndustryRail side="left" :open="leftOpen" aria-label="服务能力台账">
    <IndustryModule :title="pane==='gaps'?'服务缺口片区':'开放协调方案'" fill>
      <div class="industry-tabs" aria-label="开放协调导航">
        <button type="button" :aria-pressed="pane==='gaps'" @click="emit('navigate','gaps')">缺口片区</button>
        <button type="button" :aria-pressed="pane==='plan'" @click="emit('navigate','plan')">协调方案</button>
        <button type="button" @click="emit('navigate','tasks')">交办台账</button>
      </div>
      <template v-if="pane==='gaps'">
        <label class="service-search-box"><input v-model="gapQuery" type="search" aria-label="搜索缺口镇街" placeholder="搜索镇街"></label>
        <table class="industry-table opening-areas"><thead><tr><th>镇街</th><th>高密度未覆盖人口</th></tr></thead><tbody>
          <tr v-for="a in areaPage.rows" :key="a.id" :class="{selected:areaId===a.id}"><td><button class="industry-row-action" :aria-pressed="areaId===a.id" @click="selectArea(a)">{{ a.name }}</button></td><td>{{ number(a.people) }} 人</td></tr>
          <tr v-if="!areaPage.total"><td colspan="2">当前筛选下没有缺口片区</td></tr>
        </tbody></table>
      </template>
      <template v-else>
        <label class="service-search-box"><input v-model="query" type="search" aria-label="筛选待开放场馆" placeholder="搜索场馆、场地或责任单位"></label>
        <div class="opening-choices" aria-label="可协调场馆">
          <div v-for="v in pager.rows" :key="v.id" class="industry-card opening-choice" :class="{picked:v.courts.some(c=>selection.has(c.id))}">
            <label><input type="checkbox" :aria-label="'选择'+v.name" :disabled="busy" :checked="v.courts.every(c=>selection.has(c.id))"
              :indeterminate="v.courts.some(c=>selection.has(c.id)) && !v.courts.every(c=>selection.has(c.id))" @change="setVenue(v,$event)"><strong>{{ v.name }}</strong></label>
            <div class="opening-subhead"><small>{{ v.region }} · {{ venueStatus(v) }}</small><button type="button" class="industry-row-action" :aria-expanded="expanded===v.id" @click="expanded=expanded===v.id?'':v.id">逐片选择</button></div>
            <button v-if="activeTasks?.has(v.id)" type="button" class="industry-row-action opening-task-link" @click="openVenueTask(v.id)">查看交办台账</button>
            <div v-if="expanded===v.id" class="court-options"><label v-for="c in v.courts" :key="c.id"><input type="checkbox" :aria-label="'选择场地'+c.name" :checked="selection.has(c.id)" :disabled="busy" @change="choose([c.id],($event.target as HTMLInputElement).checked)">{{ c.name }}</label></div>
          </div><p v-if="!pager.total">当前条件下暂无可协调场馆</p>
        </div>
        <ServicePager v-if="pager.total" :pagination="pager" label="待开放场馆分页" unit="处"/>
        <h3 class="service-section-title">拟开放时段</h3>
        <div class="industry-card plan-window"><div class="plan-days"><label v-for="d in [1,2,3,4,5,6,0]" :key="d" :class="{selected:days.includes(d)}"><input type="checkbox" v-model="days" :value="d" :disabled="busy"><span>周{{ dayNames[d] }}</span></label></div>
          <div class="industry-filters"><label>开始时间<input type="time" v-model="from" :disabled="busy"></label><label>结束时间<input type="time" v-model="until" :disabled="busy"></label></div>
          <p v-if="!windowSpec" role="alert">请选择开放日和有效的起止时间。</p></div>
      </template>
      <template #actions><ServicePager v-if="pane==='gaps'" :pagination="areaPage" label="缺口片区分页" unit="个" compact/>
        <template v-else><b>已选 {{ picked.length }} 片 · 每周新增 {{ +hours.toFixed(1) }} 场时</b><button class="industry-button primary plan-preview-action" @click="emit('open','right')">查看方案</button></template></template>
    </IndustryModule>
  </IndustryRail>
  <IndustryRail side="right" :open="rightOpen" class="industry-detail-rail" aria-label="服务能力详情">
    <IndustryModule :title="pane==='gaps'?'片区缺口':'方案覆盖效果'" fill>
      <button class="industry-button svc-mobile-return" type="button" @click="emit('close','right')">返回选择</button>
      <p v-if="!model">当前发布版本缺少可用于覆盖分析的实有人口网格。</p>
      <template v-if="pane==='gaps' && model">
        <div class="opening-subhead"><h3 class="service-section-title">{{ selectedArea?.name || scopeLabel }}</h3><button v-if="selectedArea" class="industry-row-action" @click="clearArea">返回总览</button></div>
        <div class="industry-card gap-summary">
          <div class="opening-total"><span>高密度未覆盖人口</span><strong>{{ number(gapSummary.gap) }} <small>人</small></strong></div>
          <small>占未覆盖人口 {{ percent(gapSummary.gap,gapSummary.uncovered) }} · 已开放场地 {{ model.radius/1000 }} 公里服务圈</small>
        </div>
        <section class="gap-section" aria-label="人口覆盖构成">
          <h3 class="service-section-title">人口覆盖构成</h3>
          <div class="industry-card gap-composition">
            <div class="opening-subhead"><span>总人口</span><b>{{ number(gapSummary.total) }} 人</b></div>
            <div class="gap-stack" aria-hidden="true"><i v-for="part in gapSummary.parts" :key="part.label" :style="{flexGrow:part.people,background:part.color}"></i></div>
            <dl><div v-for="part in gapSummary.parts" :key="part.label"><dt><i :style="{background:part.color}"></i>{{ part.label }}</dt><dd>{{ number(part.people) }} 人</dd><dd>{{ percent(part.people,gapSummary.total) }}</dd></div></dl>
          </div>
        </section>
        <section v-if="topTowns.length" class="gap-section" aria-label="镇街缺口人口排行">
          <h3 class="service-section-title">镇街缺口人口排行</h3>
          <ol class="gap-ranking"><li v-for="(a,index) in topTowns" :key="a.id">
            <button type="button" :aria-pressed="areaId===a.id" @click="selectArea(a)">
              <span class="gap-rank">{{ index+1 }}</span><span>{{ a.name }}</span><b>{{ number(a.people) }} 人</b>
              <span class="gap-rank-track" aria-hidden="true"><i :style="{width:(100*a.people/topTowns[0].people)+'%'}"></i></span>
            </button>
          </li></ol>
        </section>
      </template>
      <template v-else-if="pane==='plan'">
        <template v-if="model"><h3 class="service-section-title">{{ scopeLabel }}人口覆盖率</h3>
          <div class="industry-card opening-impact" aria-live="polite"><div><small>开放前</small><b>{{ percent(model.covered,model.total) }}</b><span>{{ number(model.covered) }} 人</span></div><i aria-hidden="true">→</i><div><small>方案开放后</small><b>{{ percent(after,model.total) }}</b><span>{{ number(after) }} 人</span></div></div>
          <p class="opening-note">新增覆盖 <strong>{{ number(impact?.added??0) }} 人</strong>，其中高密度缺口人口 {{ number(impact?.denseAdded??0) }} 人。以已开放场地为基准，按 {{ model.radius/1000 }} 公里服务圈去重。</p></template>
        <h3 class="service-section-title">已选场地（{{ picked.length }} 片）</h3>
        <div v-if="picked.length" class="opening-chosen" aria-live="polite"><div v-for="c in picked" :key="c.id" class="industry-card opening-subhead">
          <button type="button" class="industry-row-action" @click="locate(c.id)">{{ c.name }}</button><button type="button" class="remove-choice" :aria-label="'移除'+c.name" :disabled="busy" @click="choose([c.id],false)">×</button></div></div>
        <p v-else>勾选场馆或场地可试算覆盖效果，点击「确认交办」后生成工单。</p>
        <h3 class="service-section-title">推荐场馆</h3>
        <article v-for="{venue:v,gain} in recommended" :key="v.id" class="industry-card opening-recommend">
          <button type="button" class="industry-row-action" :title="pickedName(v)" @click="locate(v.courts[0].id)"><strong>{{ v.name }}</strong></button>
          <small>{{ v.region }} · {{ v.courts.length }} 片可协调 · {{ v.office }}</small>
          <div>加入方案可再覆盖 <b>{{ number(gain.added) }} 人</b>，其中高密度缺口 {{ number(gain.denseAdded) }} 人。</div>
          <div>服务圈内覆盖 {{ number(gain.before) }} 人 → {{ number(gain.after) }} 人</div>
          <div v-if="model">{{ scopeLabel }}覆盖率 {{ percent(after,model.total) }} → {{ percent(after+gain.added,model.total) }}</div>
        </article>
        <p v-if="activeError" role="alert">{{ activeError }} <button class="industry-row-action" @click="reloadActive++">重新读取</button></p>
        <p v-else-if="!activeTasks">正在核对在办场馆…</p>
        <p v-else-if="!recommended.length">当前范围暂无可再增加覆盖人口的待协调场馆。</p>
        <template v-if="picked.length"><h3 class="service-section-title">按责任单位分单</h3><div class="industry-card plan-office" v-for="g in grouped" :key="g.department"><b>{{ g.department }}</b><span>{{ g.venues.length }} 处场馆</span></div>
          <label>办理期限<input type="date" v-model="due" :min="today" :disabled="busy"></label>
          <p v-if="mixedSelection">取消勾选已有工单的场馆，即可交办其余场馆。</p></template>
      </template>
      <p v-if="warning||error" role="alert">{{ warning||error }}</p><p v-if="createdTasks.length" role="status">已交办 {{ createdTasks.length }} 张工单。</p>
      <template #actions><button v-if="pane==='gaps'" class="industry-button primary" @click="emit('navigate','plan')">查看协调方案</button>
        <template v-else-if="ledgerTarget">
          <label v-if="linkedTasks.length>1" class="opening-ledger-select">交办单
            <select aria-label="选择要查看的交办单" :value="ledgerTarget.taskId" @change="ledgerTaskId=($event.target as HTMLSelectElement).value">
              <option v-for="task in linkedTasks" :key="task.taskId" :value="task.taskId">{{ task.department }} · {{ task.venueName }}</option>
            </select></label>
          <button type="button" class="industry-button primary" @click="emit('task',ledgerTarget)">查看交办台账</button>
        </template>
        <button v-else type="button" class="industry-button primary" :disabled="!canAssign" @click="assign">确认交办（{{ grouped.length }} 张工单）</button></template>
    </IndustryModule>
  </IndustryRail>
</template>

<style scoped>
.opening-choices,.opening-chosen,.opening-recommend,.court-options{display:grid;gap:5px}
.opening-choice,.opening-recommend,.opening-impact{padding:8px 10px}
.opening-choice.picked{border-inline-start:3px solid var(--v14-metric)}
.opening-choice label,.court-options label{display:flex;align-items:center;gap:6px;cursor:pointer}
.opening-choice strong,.opening-recommend strong,.opening-chosen button{overflow-wrap:anywhere}
.opening-choice .industry-row-action,.opening-subhead .industry-row-action,.opening-recommend .industry-row-action{border:0;background:transparent;color:var(--v14-ink);cursor:pointer;font:inherit;text-align:start;padding:0}
.opening-choice .industry-row-action,.opening-subhead>.industry-row-action:last-child{color:var(--v14-metric)}
.opening-task-link{justify-self:start;flex:none;white-space:nowrap}
.opening-ledger-select{display:flex;align-items:center;gap:6px;flex:1 1 100%;min-width:0;white-space:nowrap}
.opening-ledger-select select{flex:1;min-width:0}
.industry-row-action:hover{text-decoration:underline}
.opening-choice small,.opening-recommend small,.opening-impact small,.opening-areas small{display:block;color:var(--v14-text-secondary,currentColor)}
.opening-subhead,.opening-total,.plan-office{display:flex;align-items:center;justify-content:space-between;gap:8px}
.opening-total strong,.opening-impact b,.opening-note strong,.opening-recommend b{color:var(--v14-metric)}
.opening-total strong{font-size:1.5em}.opening-impact{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px}
.gap-summary,.gap-composition{padding:8px 12px;gap:6px}
.gap-summary small,.gap-composition dd:last-child{color:var(--v14-muted)}
.gap-summary .opening-total strong{white-space:nowrap;font-variant-numeric:tabular-nums}
.gap-section{display:grid;gap:6px;min-width:0}
.gap-stack,.gap-rank-track{display:flex;overflow:hidden;background:var(--v14-chart-track);border-radius:2px}
.gap-stack{height:9px;margin-block:2px 4px}.gap-stack i{flex-basis:0}
.gap-composition dl{display:grid;gap:4px;margin:0}
.gap-composition dl>div{display:grid;grid-template-columns:minmax(0,1fr) auto 4em;align-items:center;gap:5px}
.gap-composition dt{display:flex;align-items:center;gap:6px}
.gap-composition dt i{width:.55em;height:.55em;border-radius:1px;flex:none}
.gap-composition dd,.gap-ranking b{margin:0;text-align:end;font-variant-numeric:tabular-nums;white-space:nowrap}
.gap-ranking{list-style:none;padding:0;margin:0;display:grid;gap:2px}
.gap-ranking button{display:grid;grid-template-columns:1.4em minmax(0,1fr) auto;align-items:center;gap:2px 6px;width:100%;padding:5px 9px;border:1px solid transparent;background:var(--v14-list);color:var(--v14-ink);font:inherit;text-align:start;cursor:pointer}
.gap-ranking button:is(:hover,:focus-visible,[aria-pressed=true]){border-color:var(--v14-list-line);background:var(--v14-tab)}
.gap-rank{grid-row:span 2;color:var(--v14-metric);font-weight:700;text-align:center}
.gap-rank-track{grid-column:2 / -1;height:3px}.gap-rank-track i{background:var(--v14-metric)}
.opening-impact>div{display:grid;gap:3px}.opening-impact b{font-size:1.55em}.opening-impact i{font-style:normal}
.opening-chosen .industry-card{padding:5px 8px}.opening-chosen button{text-align:start}.remove-choice{background:transparent;border:0;color:inherit;cursor:pointer;font-size:1.3em}
.opening-areas th:last-child,.opening-areas td:last-child{text-align:end}.opening-areas th:first-child{width:49%}
.opening-choices input,.plan-days input{accent-color:var(--v14-metric)}.court-options{padding:6px 0 0 1em}
.opening-recommend{margin-bottom:5px}.opening-recommend button{text-align:start}.opening-note{line-height:1.5}
.plan-days{display:flex;gap:3px;margin-bottom:8px}.plan-days label{position:relative;flex:1;min-width:0;text-align:center;cursor:pointer;background:var(--v14-tab);border:1px solid var(--v14-edge)}
.plan-days label.selected{background:var(--v14-tab-active);color:white}.plan-days input{position:absolute;opacity:0}.plan-days label:focus-within{outline:2px solid var(--v14-metric)}
.plan-window .industry-filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.plan-preview-action{display:none}
@media(max-width:876px){.plan-preview-action{display:inline-flex}}
</style>
