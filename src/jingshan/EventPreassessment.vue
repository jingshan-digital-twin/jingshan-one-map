<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { api, downloadFile, jsonRequest } from './api.ts'
import { assessmentReport, locatePlanVenue } from './event-assessment.ts'
import { eventVenueDetail, eventVenueOverview } from './event-venue-map.ts'
import { serviceDetailRadiusKm } from './venue-support.ts'
import { prepareEstimatedInputs, calculateEventDemand } from './event-estimates.ts'
import { eventCalendarStatus, eventIntroduction, eventYearSummary } from './event-plan-data.ts'
import { eventTopics, type AssessmentInputs, type AssessmentSelection, type AssessmentWithdrawal, type EventAssessment, type EventCatalog, type EventTopic, type PlannedEvent } from './event-plan-types.ts'
import { allAssessmentItems, checkedSelection, sameSelection, selectedTopics } from './event-plan-selection.ts'
import { needsSurveyRoads, pendingRoadBasis, withSurveyRoads } from './event-survey-roads.ts'
import { prepareTrafficProposals, trafficRoadsForMap } from './event-traffic-proposals.ts'
import { roadControlPosition, roadControlStyles } from './road-controls.ts'
import { featureCenter, type CityFeature, type Dataset, type DataDocument, type MapCommand } from './types.ts'
import type { CimService } from './cim-types.ts'
import EventCompactPanels from './EventCompactPanels.vue'
import EventMapToolbar from './EventMapToolbar.vue'
import { nearbyEventVenue, useEventMapDisplay } from './map-layer-directory'
import SceneAssistant from './SceneAssistant.vue'
import EventMapLegend, { type EventLegendRow } from './EventMapLegend.vue'
import EventWorkflowOverview from './EventWorkflowOverview.vue'
import OverviewPanelIcon from './OverviewPanelIcon.vue'
import PortalIcon from './PortalIcon.vue'
import EventAssessmentProgress from './EventAssessmentProgress.vue'
import EventAssessmentLedger from './EventAssessmentLedger.vue'
import type { ReusedExperience } from './event-post-review.ts'
import { assessmentStatus, assessmentProgress, assessmentVersion } from './event-workflow.ts'
import { assessmentOverview, eventAssessmentStage, type AssessmentStage } from './event-assessment-overview.ts'

const CityMap=defineAsyncComponent(()=>import('./CityMap.vue'))
const props=defineProps<{datasets:Dataset[];light:boolean;imagery?:DataDocument['imagery'];cimLayers:CimService[];loading:boolean;taskStates:string;version?:number;initialId?:string}>()
const emit=defineEmits<{navigate:[scene:'overview'|'liveEvent'|'tourism'];tasks:[];withdrawTasks:[ids:number[]];dispatched:[]}>()
const dialog=ref<HTMLDialogElement>(),completeDialog=ref<HTMLDialogElement>()
const feedbackError=ref(''),completeError=ref('')
const compactPane=ref<'left'|'map'|'right'>('map')
const catalog=ref<EventCatalog>(),error=ref(''),message=ref(''),busy=ref(false)
const localDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'})
const today=ref(localDay.format(new Date()))
const year=ref(Number(today.value.slice(0,4))),search=ref(''),month=ref<number|null>(null),filter=ref<AssessmentStage|'all'>('all')
const selected=ref<string>(),screen=ref<'overview'|'detail'|'plan'>('overview'),topic=ref<EventTopic>('traffic')
const inputs=ref<AssessmentInputs>(),openedFromPending=ref(false)
const selectedFeatureId=ref<string|null>(null)
const dialogSearch=ref(''),dialogMode=ref<'calendar'|'history'>('calendar')
const ledgerOpen=ref(false)
let catalogRequest=0
let serial=0,noticeTimer:ReturnType<typeof setTimeout>|undefined,refreshTimer:ReturnType<typeof setInterval>|undefined
const command=ref<MapCommand|null>(null)
const lastWithdrawal=computed(()=>{
  const latest=new Map<string,AssessmentWithdrawal>()
  for(const entry of catalog.value?.withdrawals??[])if(entry.revision>(latest.get(entry.eventId)?.revision??0))latest.set(entry.eventId,entry)
  return latest
})
// A withdrawn legacy plan can also be restarted directly from the event list.
const events=computed(()=>(catalog.value?.events??[]).map(event=>
  !event.assessment&&lastWithdrawal.value.has(event.id)?{...event,assessment:true}:event))
const examples=computed(()=>new Map((catalog.value?.examples??[]).filter(({event})=>
  !catalog.value?.assessments[event.id]&&!lastWithdrawal.value.has(event.id)).map(example=>[example.event.id,example])))
const selectedExample=computed(()=>selected.value?examples.value.get(selected.value):undefined)
const current=computed(()=>events.value.find(e=>e.id===selected.value))
const reviewExperience=ref<ReusedExperience[]>([])
const experienceError=ref(false), experienceRetry=ref(0)
watch([()=>current.value?.id,experienceRetry],async ([id],_,onCleanup)=>{
  reviewExperience.value=[];experienceError.value=false
  if(!id || !current.value?.assessment)return
  const abort=new AbortController()
  onCleanup(()=>abort.abort())
  try {
    const rows=await api<ReusedExperience[]>('/event-reviews/for-plan/'+encodeURIComponent(id),{signal:abort.signal})
    if(!abort.signal.aborted)reviewExperience.value=rows
  } catch { if(!abort.signal.aborted)experienceError.value=true }
},{immediate:true})
const plan=computed(()=>selected.value?catalog.value?.assessments[selected.value]??selectedExample.value?.plan:undefined)
const detailEvent=computed(()=>plan.value?.eventSnapshot??current.value)
const summary=computed(()=>eventYearSummary(events.value,year.value,today.value))
const years=computed(()=>[...new Set(events.value.map(e=>e.year))].sort((a,b)=>b-a))
const sourceSummary=computed(()=>catalog.value?.sourceSummaries?.find(s=>s.year===year.value))
const assessmentSummary = computed(() => catalog.value
  ? assessmentOverview(events.value, catalog.value.assessments, year.value, month.value, today.value)
  : undefined)
const history=computed(()=>summary.value.events.filter(e=>!e.assessment))
function planStage(event:PlannedEvent){
  return catalog.value ? eventAssessmentStage(event, catalog.value.assessments) : undefined
}
function calendarStatus(event:PlannedEvent){
  const phase=eventCalendarStatus(event,today.value)
  return phase==='已完结'||phase==='进行中' ? phase : planStage(event)??phase
}
function status(event:PlannedEvent){
  return planStage(event) ?? eventCalendarStatus(event,today.value)
}
const locked=computed(()=>assessmentStatus(plan.value)==='已完结')
const detailPlan=computed(()=>screen.value==='plan'&&openedFromPending.value&&!locked.value?undefined:plan.value)
const progress=computed(()=>assessmentProgress(plan.value))
const processingNotice=computed(()=>{
  if(plan.value?.status==='draft')return '请在专项预案中勾选子项，再一键推送给责任部门。'
  if(hasUnsentChanges.value)return '子项勾选已调整，推送新版后由所选责任部门重新办理。'
  if(progress.value.canComplete)return '全部部门已反馈。确认完结后，方案与反馈记录将锁定归档。'
  const remaining=progress.value.total-progress.value.completed
  return remaining>0?`还需 ${remaining} 个部门反馈，全部反馈后可确认完结。`:'请核对推送台账及部门反馈记录。'
})
const sorted=(rows:PlannedEvent[])=>[...rows].sort((a,b)=>(b.startDate??`${b.year}-${String(b.months[0]).padStart(2,'0')}`).localeCompare(a.startDate??`${a.year}-${String(a.months[0]).padStart(2,'0')}`))
const stages=['待研判','处理中','已完结'] as const
const listed=computed(()=>{
  const stageRows = assessmentSummary.value?.stageRows ?? []
  const rows = filter.value === 'all'
    ? (month.value ? summary.value.monthly[month.value-1].events : stageRows.flatMap(row => row.events))
    : stageRows.find(row => row.stage === filter.value)?.events ?? []
  const matches=rows.filter(e=>!search.value||e.name.toLowerCase().includes(search.value.toLowerCase()))
  if(month.value)return matches
  matches.sort((a,b)=>(a.startDate??'').localeCompare(b.startDate??''))
  if(filter.value!=='all')return matches
  const first=stages.flatMap(stage=>matches.filter(e=>planStage(e)===stage).slice(0,1))
  return [...first,...matches.filter(e=>!first.includes(e))]
})
const dialogEvents=computed(()=>{
  const rows=dialogMode.value==='history'?sorted(history.value):summary.value.events
  return rows.filter(e=>!dialogSearch.value||e.name.toLowerCase().includes(dialogSearch.value.toLowerCase()))
})
const mapVenueChoice=ref('')
const mapVenueName=computed(()=>{
  const names=detailEvent.value?.venueNames ?? []
  if (names.includes(mapVenueChoice.value)) return mapVenueChoice.value
  const primary=inputs.value?.venueName
  return primary && names.includes(primary) ? primary : names[0] ?? ''
})
function changeMapVenue(event:Event){
  mapVenueChoice.value=(event.target as HTMLSelectElement).value
  selectedFeatureId.value=null
  hiddenMapLabels.value=[]
}
const eventVenue=computed(()=>detailEvent.value&&inputs.value?locatePlanVenue(detailEvent.value,inputs.value.venueName,props.datasets):undefined)
const detailMap=computed(()=>screen.value==='detail' && detailEvent.value
  ? eventVenueDetail(props.datasets,detailEvent.value,mapVenueName.value) : undefined)
const venuePosition=computed(()=>screen.value==='detail' ? detailMap.value?.anchor : eventVenue.value?.position ?? plan.value?.position)
const venueFocus=computed(()=>screen.value==='detail' ? detailMap.value?.venueModelFocus : venuePosition.value ? {
  name:eventVenue.value?.venue?.properties.name ?? inputs.value?.venueName ?? '',
  id:eventVenue.value?.venue?.id, position:venuePosition.value,
} : undefined)
const surveyPreview=ref<{plan:EventAssessment;signature:string}>(), surveyError=ref(''),surveyRetry=ref(0)
const previewKey=computed(()=>screen.value==='plan'&&needsSurveyRoads(plan.value)
  ? [plan.value!.eventId,plan.value!.revision,props.version].join(':') : '')
watch([previewKey,surveyRetry],async([key],_,onCleanup)=>{
  surveyPreview.value=undefined;surveyError.value=''
  if(!key||!plan.value)return
  const controller=new AbortController()
  onCleanup(()=>controller.abort())
  try{
    const result=await api<{plan:EventAssessment;signature:string}>('/event-plans/'+encodeURIComponent(plan.value.eventId)+'/traffic-preview',{signal:controller.signal})
    if(controller.signal.aborted || previewKey.value!==key)return
    if(result.plan.eventId===plan.value?.eventId && result.plan.revision===plan.value.revision)surveyPreview.value=result
    else await load()
  }catch(e){
    if(controller.signal.aborted)return
    surveyError.value=e instanceof Error?e.message:'京山市道路面读取失败'
    if(surveyError.value.includes('方案已更新'))await load()
  }
})
const roadPreviewPending=computed(()=>!!previewKey.value&&!surveyPreview.value)
const deferRoads=computed(()=>plan.value?.roadBasis===pendingRoadBasis && roadPreviewPending.value && !!surveyError.value)
const waitForRoads=computed(()=>roadPreviewPending.value && !deferRoads.value)
const proposal=computed(()=>{
  const saved=plan.value
  if(!saved||locked.value)return saved
  if(needsSurveyRoads(saved))return surveyPreview.value?.plan??(saved.roadBasis===pendingRoadBasis?saved:withSurveyRoads(saved,[]))
  return prepareTrafficProposals(saved)
})
const selectedTopic=computed(()=>proposal.value?.topics.find(t=>t.id===topic.value))
const baseline=computed(()=>{
  const data=proposal.value
  if(!data)return
  if(data.dispatchedItems)return data.dispatchedItems
  const all=allAssessmentItems(data.topics)
  if(needsSurveyRoads(plan.value) && plan.value?.roadBasis!==pendingRoadBasis){
    const replaced=new Set(data.roads.map(r=>r.id))
    all.traffic=all.traffic.filter(id=>!replaced.has(id))
  }
  return all
})
const working=ref<AssessmentSelection>()
const draftKey=computed(()=>plan.value?'jingshan-preassessment-items:'+plan.value.eventId+':'+assessmentVersion(plan.value)+':'+plan.value.generatedAt+':'+Boolean(plan.value.example):'')
watch([draftKey,()=>surveyPreview.value?.signature],([key])=>{
  working.value=undefined
  if(!key||locked.value||!proposal.value)return
  try{
    const saved=sessionStorage.getItem(key)
    if(!saved)return
    const choices=JSON.parse(saved)
    if(needsSurveyRoads(plan.value)&&Array.isArray(choices?.traffic)){
      const allowed=new Set(proposal.value.topics.find(t=>t.id==='traffic')?.items.map(i=>i.id))
      choices.traffic=choices.traffic.filter((id:string)=>allowed.has(id))
    }
    working.value=checkedSelection(proposal.value.topics,choices)
  }catch{/* An outdated draft defaults to the current proposal. */}
},{immediate:true,flush:'sync'})
const selection=computed(()=>locked.value?baseline.value:working.value??baseline.value)
const selectedForTopic=computed(()=>new Set(selection.value?.[topic.value]??[]))
const topicTotal=computed(()=>selectedTopic.value?.items.length??0)
const included=computed(()=>proposal.value&&selection.value?selectedTopics(proposal.value.topics,selection.value):[])
const selectedCount=computed(()=>included.value.reduce((sum,t)=>sum+t.items.length,0))
const recipientCount=computed(()=>new Set(included.value.map(t=>t.department)).size)
const sentUnchanged=computed(()=>!!plan.value?.dispatchedItems&&!!selection.value&&sameSelection(plan.value.dispatchedItems,selection.value))
const hasUnsentChanges=computed(()=>!locked.value&&!!working.value&&!!baseline.value&&!sameSelection(working.value,baseline.value))
const canCloseCurrent=computed(()=>progress.value.canComplete&&!hasUnsentChanges.value&&(screen.value!=='plan'||!!plan.value?.dispatchedItems))
function chooseItems(ids:string[]){
  if(!selection.value||!selectedTopic.value||locked.value||busy.value)return
  working.value={...selection.value,[topic.value]:ids}
  if(selectedFeatureId.value&&!selectedTopic.value.items.some(i=>i.featureId===selectedFeatureId.value&&ids.includes(i.id)))selectedFeatureId.value=null
  try{sessionStorage.setItem(draftKey.value,JSON.stringify(working.value))}catch{/* The current tab still retains the selection in memory. */}
}
function toggleItem(id:string,on:boolean){
  const ids=new Set(selectedForTopic.value)
  if(on)ids.add(id);else ids.delete(id)
  chooseItems([...ids])
}
const demand=computed(()=>locked.value&&plan.value?{parkingDemand:plan.value.parkingDemand,lodgingRooms:plan.value.lodgingDemand===null?null:Math.ceil(plan.value.lodgingDemand/2)}:detailEvent.value&&inputs.value?calculateEventDemand(detailEvent.value,inputs.value):undefined)
const roadFilter=ref('all')
const topicItems=computed(()=>selectedTopic.value?.items.filter(i=>(!locked.value||selectedForTopic.value.has(i.id))&&(topic.value!=='traffic'||roadFilter.value==='all'||i.status===roadFilter.value))??[])
const topicResources:Record<EventTopic,string[]>= {traffic:['parking'],medical:['medical'],lodging:['hotels'],food:['food'],security:['shelters'],volunteers:[],weather:[],supplies:['shelters']}
const mappedIds=computed(()=>{
  const items=included.value.find(t=>t.id===topic.value)?.items
  return new Set(items?.map(i=>i.featureId).filter(Boolean))
})
const mapControls=computed(()=>screen.value==='plan' && topic.value==='traffic'
  ? trafficRoadsForMap(proposal.value,mappedIds.value,roadFilter.value,selectedFeatureId.value) : [])
const overviewFeatures=computed(()=>eventVenueOverview(props.datasets))
const mapFeatures=computed<CityFeature[]>(()=>{
  if(screen.value==='overview')return overviewFeatures.value
  if(screen.value==='detail')return detailMap.value?.features ?? []
  return plan.value?.features.filter(f=>{
    if(f.id===plan.value!.eventId)return true
    if(['event-core','event-buffer'].includes(f.properties.kind))return !locked.value&&mapControls.value.length>0
    if(topic.value==='traffic' && roadFilter.value!=='all' && roadFilter.value!=='待联系核实')return false
    return topicResources[topic.value].includes(String(f.properties.supportKind))&&mappedIds.value.has(f.id)
  })??[]
})
const hiddenMapLabels=ref<string[]>([])
const classOfFeature=(f:CityFeature)=>typeof f.properties.legendLabel==='string' ? f.properties.legendLabel : ''
const mapLabels=computed(()=>[...new Set(mapFeatures.value.map(classOfFeature).filter(Boolean))])
function toggleMapLabel(label:string) {
  hiddenMapLabels.value=hiddenMapLabels.value.includes(label)?hiddenMapLabels.value.filter(v=>v!==label):[...hiddenMapLabels.value,label]
}
watch([screen,selected,topic],()=>{hiddenMapLabels.value=[]})
const {catalog:mapCatalog,displayFeatures,displayCommand}=useEventMapDisplay(
  ()=>mapFeatures.value.filter(f=>!hiddenMapLabels.value.includes(classOfFeature(f))),command,()=>++serial)
const supportLabels:Record<string,string>={parking:'停车场',hotels:'住宿',medical:'医疗',food:'餐饮',shelters:'应急保障'}
const mapLegend=computed<EventLegendRow[]>(()=>{
  const rows=new Map<string,EventLegendRow>()
  for(const f of mapFeatures.value){
    const p=f.properties, color=String(p.color??'#4db3ff')
    let label:string, shape:EventLegendRow['shape']
    if(typeof p.legendLabel==='string') label=p.legendLabel
    else if(p.mapRole==='link'){label='归档管控路段';shape='line'}
    else if(p.kind==='event-core'||p.kind==='event-buffer'){label=p.kind==='event-core'?'核心区':'缓冲区';shape='area'}
    else if(p.mapRole==='venue') label=locked.value?'归档场馆':'当前赛事'
    else label=supportLabels[String(p.supportKind)]??'保障资源'
    const value=screen.value==='overview' ? overviewFeatures.value.length+' 处'
      : screen.value==='detail' && p.mapRole==='venue' ? '周边 '+serviceDetailRadiusKm+' 公里' : undefined
    if (screen.value==='detail' && (p.mapRole==='range'||p.mapRole==='building'||p.kind==='court-footprint')) shape='area'
    const pinKind=screen.value==='detail' && p.markerStyle==='service-range-pin'
      ? p.mapRole==='venue' ? 'venue' : String(p.supportKind) : undefined
    rows.set(label,{id:label,label,color,shape,value,pinKind,center:p.serviceRangeCenter===true})
  }
  for(const status of ['closed','restricted'] as const){
    const roads=mapControls.value.filter(r=>r.properties.controlStatus===status)
    if(!roads.length)continue
    const hasSurface=roads.some(r=>r.geometry.type==='Polygon'||r.geometry.type==='MultiPolygon')
    const shape=status==='closed' ? (hasSurface?'area':'line') : (hasSurface?'area-dash':'dash')
    rows.set(status,{id:status,label:roadControlStyles[status].action,color:roadControlStyles[status].color,
      shape,value:roads.length+' 段'})
  }
  return [...rows.values()]
})
const details=computed(()=>detailEvent.value?[
  ['赛事类型',detailEvent.value.category==='赛事'?'网球':detailEvent.value.category],['赛事级别',detailEvent.value.level],
  ['比赛时间',`${detailEvent.value.year}年 ${detailEvent.value.dateText}`],['比赛场馆',plan.value?.inputs.venueName||detailEvent.value.venueNames.join('、')||'无'],
  ['主办单位',detailEvent.value.host],['承办单位',detailEvent.value.organizer],['保障等级','无'],['赛事简介',eventIntroduction(detailEvent.value)],
]:[])
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('zh-CN'):'无'
function notice(text:string){message.value=text;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>message.value='',6000)}
async function load(quiet=false){
  if(quiet&&busy.value)return
  const request=++catalogRequest
  if(!quiet)error.value=''
  try{
    const result=await api<EventCatalog>('/event-plans');if(request!==catalogRequest||quiet&&busy.value)return
    const previousPlan=plan.value
    catalog.value=result
    if(years.value.length&&!years.value.includes(year.value)){year.value=years.value[0];setYear()}
    if(selected.value&&!current.value)overview()
    if(current.value){
      if(previousPlan&&!plan.value){filter.value='all';selectEvent(current.value)}
      else inputs.value=plan.value?{...plan.value.inputs}:prepareEstimatedInputs(current.value)
    }
  }
  catch(e){if(request===catalogRequest&&!quiet)error.value=e instanceof Error?e.message:'赛事目录加载失败'}
}
function overview(){mapCatalog.clearOverlays();compactPane.value='left';screen.value='overview';selected.value=undefined;selectedFeatureId.value=null;command.value={action:'home',serial:++serial}}
function focusEventVenue(){
  if (screen.value==='detail') {
    const detail = detailMap.value
    command.value = detail?.fitFeature ? {action:'fit-features',features:[detail.fitFeature],
      view:detail.venueModelFocus?'plan':undefined,venueFocus:detail.venueModelFocus,serial:++serial} : {action:'home',serial:++serial}
    return
  }
  const position=venuePosition.value
  command.value=position ? {action:'focus',position,height:4200,view:'area',venueFocus:venueFocus.value,serial:++serial} : {action:'home',serial:++serial}
}
watch([screen,selected,mapVenueName,()=>venuePosition.value?.[0],()=>venuePosition.value?.[1],()=>detailMap.value?.venueModelFocus?.id],()=>{
  if(screen.value==='detail'&&selected.value)focusEventVenue()
})
function selectEvent(event:PlannedEvent){
  mapCatalog.clearOverlays()
  const alreadyOpen=selected.value===event.id&&screen.value==='detail'
  if (!alreadyOpen) mapVenueChoice.value=''
  compactPane.value='right';selected.value=event.id;year.value=event.year;screen.value='detail';selectedFeatureId.value=null
  feedbackError.value='';completeError.value=''
  inputs.value=plan.value?{...plan.value.inputs}:prepareEstimatedInputs(event)
  if(alreadyOpen)focusEventVenue()
}
function selectFilter(value:AssessmentStage|'all'){
  filter.value=value
  if(selected.value&&!listed.value.some(event=>event.id===selected.value))overview()
  compactPane.value='left'
}
function filterFromOverview(stage:AssessmentStage){
  search.value=''
  selectFilter(stage)
}
function selectFromOverview(event:PlannedEvent){
  if(!listed.value.some(item=>item.id===event.id)){filter.value='all';search.value=''}
  selectEvent(event)
}
function selectMap(id:string){
  selectedFeatureId.value=id
  if(id.startsWith('event-venue:')){
    const venue=overviewFeatures.value.find(f=>f.id===id)
    if(venue)focusMapResource(venue)
  } else if(detailMap.value?.features.some(f=>f.id===id && f.properties.serviceRangeCenter))focusEventVenue()
}
function focusMapResource(feature:CityFeature) {
  const position=roadControlPosition(feature)??featureCenter(feature)
  if(!position)return
  const target=feature.properties.mapRole==='venue' && !(screen.value==='detail' && detailMap.value?.calendarLocation) ? {
    name:feature.properties.name,position,id:feature.id.replace(/^event-venue:/,'')
  } : undefined
  command.value={action:'focus',position,height:target?1550:2200,view:'area',
    venueFocus:target ?? (screen.value!=='overview' ? nearbyEventVenue(venueFocus.value,position) : undefined),serial:++serial}
}
function locate(id:string){
  const f=[...mapFeatures.value,...(proposal.value?.features??[]),...(proposal.value?.roads??[])].find(f=>f.id===id)
  if(f){compactPane.value='map';selectedFeatureId.value=id;focusMapResource(f)}
}
function locateAssistantResult(layer:string, feature:CityFeature) {
  if (layer !== 'event_plans') { locate(feature.id); return }
  const event = events.value.find(item => item.id === feature.id)
  if (event) selectEvent(event)
  compactPane.value = 'map'
}
function setTopic(value:EventTopic){
  topic.value=value;selectedFeatureId.value=null;roadFilter.value='all'
  if(value==='traffic'){
    const buffer=roadPreviewPending.value && plan.value?.features.find(f=>f.properties.kind==='event-buffer')
    const extent=mapControls.value.length ? mapControls.value : buffer ? [buffer] : []
    if(extent.length){
      command.value={action:'fit-features',features:extent,venueFocus:venueFocus.value,serial:++serial}
      return
    }
  }
  focusEventVenue()
}
function setYear(){month.value=null;filter.value='all';search.value='';overview()}
function selectMonth(value:number|null){
  month.value=value===month.value?null:value
  search.value=''
  filter.value='all'
  if(screen.value!=='overview')overview()
}
watch([()=>props.initialId,()=>events.value.find(e=>e.id===props.initialId)?.id],([id,found])=>{
  if (id && found) selectEvent(events.value.find(e=>e.id===id)!)
},{immediate:true})
function showDialog(value:'calendar'|'history'){dialogMode.value=value;dialogSearch.value='';dialog.value?.showModal()}
function openLedger(){ledgerOpen.value=true;void load(true)}
function selectLedgerEvent(id:string){
  const event=events.value.find(e=>e.id===id)
  if(event){ledgerOpen.value=false;filter.value='all';month.value=null;search.value='';selectEvent(event)}
}
function applyWithdrawal(entry:AssessmentWithdrawal,cancelledTaskIds:number[]){
  if(!catalog.value)return
  catalogRequest++
  const active=catalog.value.assessments[entry.eventId]
  if(active&&active.revision<entry.revision)delete catalog.value.assessments[entry.eventId]
  catalog.value.withdrawals=[entry,...(catalog.value.withdrawals??[]).filter(old=>old.eventId!==entry.eventId||old.revision!==entry.revision)]
  if(current.value?.id===entry.eventId&&!plan.value){filter.value='all';selectEvent(current.value)}
  emit('withdrawTasks',cancelledTaskIds)
  try{localStorage.setItem('jingshan-results-changed',entry.eventId+':'+entry.revision)}catch{/* The local ledger is already updated. */}
}
async function generate(){
  if(!current.value||!inputs.value||busy.value||locked.value||plan.value&&!selectedExample.value)return
  const id=current.value.id
  const wasPending=!plan.value
  busy.value=true
  try{
    const saved=await api<EventAssessment>(`/event-plans/${encodeURIComponent(id)}/assessment`,jsonRequest('PUT',{inputs:prepareEstimatedInputs(current.value),revision:lastWithdrawal.value.get(id)?.revision??0}))
    catalogRequest++
    catalog.value!.assessments[id]=saved
    if(selected.value===id){inputs.value={...saved.inputs};filter.value='all';viewPlan();openedFromPending.value=wasPending}
    notice('研判方案已生成，可勾选八项专项预案的子项。')
  }catch(e){notice(e instanceof Error?e.message:'生成失败');await load()}finally{busy.value=false}
}
async function dispatchItems(){
  if(!plan.value||!selection.value||locked.value||busy.value||waitForRoads.value||!selectedCount.value||sentUnchanged.value)return
  const key=draftKey.value, id=plan.value.eventId
  busy.value=true
  try{
    const saved=await api<EventAssessment>(`/event-plans/${encodeURIComponent(id)}/submit`,jsonRequest('POST',{
      revision:selectedExample.value?0:plan.value.revision,selection:selection.value,
      ...(deferRoads.value?{roadsDeferred:true}:{roadSignature:surveyPreview.value?.signature}),
    }))
    try{sessionStorage.removeItem(key);localStorage.setItem('jingshan-results-changed',id+':'+saved.revision)}catch{/* Storage is optional. */}
    catalogRequest++;catalog.value!.assessments[id]=saved
    if(selected.value===id){working.value=undefined;openedFromPending.value=false}
    emit('dispatched');notice(`已推送 V${assessmentVersion(saved)}，共 ${saved.departments.length} 个责任部门。`);await load()
  }catch(e){
    const message=e instanceof Error?e.message:'推送失败'
    if(message.includes('道路面资料已更新')&&selected.value===id&&selection.value&&proposal.value){
      const stale=new Set(proposal.value.roads.map(r=>r.id))
      const choices={...selection.value,traffic:selection.value.traffic.filter(item=>!stale.has(item))}
      try{sessionStorage.setItem(key,JSON.stringify(choices))}catch{/* Session storage is optional. */}
      working.value=choices;selectedFeatureId.value=null;surveyRetry.value++
    }
    notice(message);await load()
  }finally{busy.value=false}
}
function exportReport(){if(current.value&&plan.value&&!waitForRoads.value){
  const preview=screen.value==='plan'&&!locked.value&&!sentUnchanged.value
  const reportPlan=preview&&proposal.value?{...proposal.value,dispatchedItems:selection.value}:plan.value
  downloadFile((detailEvent.value?.name??current.value.name).replace(/[\\/:*?"<>|]/g,'-')+(selectedExample.value?'-演练样例':'')+(locked.value?'-完结方案.md':preview?'-勾选预览.md':'-赛前研判.md'),assessmentReport(current.value,reportPlan,Infinity,preview),'text/markdown;charset=utf-8');notice('研判报告已导出。')
}}
function viewPlan(requested:EventTopic='traffic'){if(plan.value){compactPane.value='right';openedFromPending.value=false;screen.value='plan';setTopic(requested)}}
async function recordFeedback(value:{taskId:number;comment:string;disposition:'adopted'|'noted'}){
  if(selectedExample.value||!plan.value||busy.value||locked.value)return
  busy.value=true;feedbackError.value=''
  try{const saved=await api<EventAssessment>(`/event-plans/${encodeURIComponent(plan.value.eventId)}/feedback`,jsonRequest('POST',{...value,revision:plan.value.revision}));catalogRequest++;catalog.value!.assessments[saved.eventId]=saved;notice('部门反馈已登记，平台确认后方可完结。')}
  catch(e){feedbackError.value=e instanceof Error?e.message:'反馈保存失败';busy.value=false;await load(true)}finally{busy.value=false}
}
function requestComplete(){if(selectedExample.value||!canCloseCurrent.value)return;completeError.value='';completeDialog.value?.showModal()}
async function complete(){
  if(selectedExample.value||!plan.value||busy.value||!canCloseCurrent.value)return
  busy.value=true;completeError.value=''
  try{
    const saved=await api<EventAssessment>(`/event-plans/${encodeURIComponent(plan.value.eventId)}/complete`,jsonRequest('POST',{revision:plan.value.revision}))
    catalogRequest++;catalog.value!.assessments[saved.eventId]=saved;filter.value='all';completeDialog.value?.close();notice('已确认完结，方案与部门反馈已归档锁定。')
  }catch(e){completeError.value=e instanceof Error?e.message:'完结失败';busy.value=false;await load(true)}finally{busy.value=false}
}
function refreshProgress(){
  today.value=localDay.format(new Date())
  if(document.visibilityState==='visible'&&(ledgerOpen.value||!locked.value||selectedExample.value))void load(true)
}
function sharedTasksChanged(event:StorageEvent){if(event.key==='jingshan-results-changed')void load(true)}
function exportCalendar(){
  const cell=(v:unknown)=>'"'+String(v??'无').replace(/^[=+@\-]/,"'$&").replaceAll('"','""')+'"'
  const rows=summary.value.events.map(e=>[e.sequence,e.name,e.dateText,e.category,e.host,e.organizer,e.participants,e.venueNames.join('、')||'无',e.assessment?'赛前研判':'历史赛事',planStage(e)??'历史赛事',eventIntroduction(e),e.sources.map(s=>s.url).join(' '),e.notes.join('；')])
  downloadFile(`${year.value}年京山赛事活动.csv`,'\ufeff'+[['原表序号','名称','时间','类型','主办单位','承办单位','原表规模（人）','场馆','分组','研判状态','赛事简介','补充来源','说明'],...rows].map(r=>r.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8')
}
watch(()=>props.taskStates,()=>{void load(true)})
watch(()=>props.version,()=>{void load()})
onMounted(()=>{
  void load();
  refreshTimer=setInterval(refreshProgress,30000);window.addEventListener('focus',refreshProgress)
  window.addEventListener('storage',sharedTasksChanged)
})
onUnmounted(()=>{clearTimeout(noticeTimer);clearInterval(refreshTimer);window.removeEventListener('focus',refreshProgress);window.removeEventListener('storage',sharedTasksChanged)})
defineExpose({overview})
</script>

<template>
  <section class="event-preassessment" aria-label="赛事引流赛前研判" :data-pane="compactPane">
    <CityMap class="ep-map" :event-scene="true" :service-labels-light="light" :features="displayFeatures" region="京山市" :selected-id="selectedFeatureId" :command="displayCommand"
      :venue-detail="!!detailMap"
      :imagery="mapCatalog.imagery" :imagery-config="imagery" light-theme county-relief :show-town-boundaries="mapCatalog.towns" business-scene
      :administration="datasets.find(d=>d.id==='administration')?.features" :community-boundaries="datasets.find(d=>d.id==='communities')?.features" :road-controls="mapControls"
      :attribute-service-id="mapCatalog.attributeServiceId" :cim-layers="cimLayers" @cim-status="mapCatalog.status" @cim-pick="mapCatalog.pickService" :cim-catalog-ready="!loading" :show-scale="false" @select="id=>mapCatalog.table?mapCatalog.pickRow(id):selectMap(id)" />
    <div class="ep-ui">
      <div v-if="error" class="ep-error" role="alert">{{ error }} <button @click="load()">重试赛事目录</button></div>
      <div v-if="!catalog&&!error" class="ep-error" role="status">正在读取赛事计划…</div>
      <EventCompactPanels v-model="compactPane" :left-label="screen==='plan'?'赛事详情':'赛事计划'" :right-label="screen==='overview'?'研判概览':screen==='detail'?'赛事详情':'专项预案'" />
      <div class="ep-layout">
        <aside v-if="screen!=='plan'" class="v14-overview-rail-shell ep-rail ep-left" aria-label="赛事计划">
          <div class="event-rail-module v14-overview-module">
            <header class="v14-overview-heading ep-heading"><h2>赛事计划</h2><div class="ep-heading-actions"><select v-model.number="year" aria-label="赛事年份" @change="setYear"><option v-for="y in years.length ? years : [year]" :key="y" :value="y">{{ y }} 年</option></select></div></header>
            <div class="ep-list-controls">
              <div class="ep-search-row"><label class="ep-search"><img src="/jingshan/ui/panorama-v14/search.svg" alt=""><input v-model.trim="search" type="search" aria-label="搜索赛事名称" placeholder="搜索赛事名称" /></label><button type="button" aria-haspopup="dialog" :disabled="!catalog||busy" @click="openLedger">研判台账</button></div>
              <div class="ep-filters" aria-label="方案状态"><button v-for="f in ['all',...stages] as const" :key="f" :aria-pressed="filter===f" :data-state="f" @click="selectFilter(f)">{{ f==='all'?'全部':f }}</button></div>
              <p v-if="month" class="ep-caption"><button class="ep-link" @click="selectMonth(null)">清除 {{ month }} 月筛选 ×</button></p>
            </div>
            <div class="ep-event-list">
              <button v-for="e in listed" :key="e.id" class="ep-event-card" :aria-pressed="selected===e.id" @click="selectEvent(e)">
                <strong>{{ e.name }}</strong><span><small v-if="examples.has(e.id)" class="ep-example-label">演练样例</small>{{ e.year }} 年 {{ e.dateText }}</span><div><small>{{ e.venueNames.join('、')||'场馆：无' }}</small><em :data-state="status(e)" :class="{'ep-history-tag':!e.assessment}">{{ status(e) }}</em></div>
              </button>
              <div v-if="!listed.length" class="ep-empty">{{ !catalog?'正在加载赛事…':'没有符合条件的赛事' }}<button v-if="catalog" class="ep-link" @click="search='';month=null;filter='all'">清除筛选</button></div>
            </div>
            <section class="ep-calendar"><div class="ep-section-title"><h3>年度赛历</h3><button class="ep-link" type="button" aria-haspopup="dialog" @click="showDialog('calendar')">查看完整赛历<PortalIcon name="chevron" :size="16"/></button></div>
              <div class="ep-months"><button v-for="m in summary.monthly" :key="m.month" :aria-pressed="month===m.month" :aria-label="`${m.month}月，${m.events.length}条赛事活动`" :title="`${m.month}月，${m.events.length}条赛事活动`" @click="selectMonth(m.month)">
                <span>{{ m.month }}月</span><div><i v-if="m.events.some(e=>e.assessment)" class="ep-dot planned"></i><i v-if="m.events.some(e=>!e.assessment)" class="ep-dot historical"></i><small>{{ m.events.length }}</small></div>
              </button></div>
              <dl class="ep-calendar-counts">
                <div><dt>全年赛事</dt><dd><b>{{ summary.competitionCount }}</b> 场</dd></div>
                <div><dt>已完成</dt><dd><b>{{ summary.completedCompetitionCount }}</b> 场</dd></div>
              </dl>
              <div class="ep-actions"><button @click="exportCalendar">导出赛历</button></div>
            </section>
          </div>
        </aside>

        <div id="cockpit-map-column" class="ep-center map-scene">
          <div class="event-map-frame" aria-hidden="true"></div>
          <SceneAssistant page="events" area="京山市" :context-id="year + ':' + (selected ?? '')" :loading="!catalog && !error"
            :ledger-layers="[{id:'event-map',name:'研判地图资源',features:mapFeatures}, ...datasets.filter(d=>d.id==='event_plans')]"
            @locate="locateAssistantResult" />
          <EventMapToolbar :scope="screen+':'+(selected||'')" :datasets="datasets" :features="[...mapFeatures,...mapControls]" :administration="datasets.find(d=>d.id==='administration')?.features"
            dispatch-label="互动调度 · 研判台账" :dispatch-disabled="!catalog || busy" @dispatch="openLedger"
            @action="action => command={action,serial:++serial}" @area="town=>command={action:'fit-features',features:[town],view:'context',serial:++serial}"
            @place="p=>command={action:'focus',position:p.position,locationName:p.name,venueFocus:{name:p.name,position:p.position},height:1800,serial:++serial}"
            @resource="f=>{selectedFeatureId=f.id;focusMapResource(f)}"
            @reset="hiddenMapLabels=[];command={action:'home',serial:++serial}">
            <template #layers>
              <label v-for="label in mapLabels" :key="label" class="catalog-row"><input type="checkbox" :checked="!hiddenMapLabels.includes(label)" @change="toggleMapLabel(label)"/>{{ label }}</label>
              <template v-if="screen==='plan'"><label v-for="t in eventTopics" :key="t[0]" class="catalog-row"><input type="radio" name="event-map-plan-topic" :checked="topic===t[0]" @change="setTopic(t[0])"/>{{ t[1] }}</label></template>

            </template>
            <template #location="{close}"><button type="button" :disabled="!venuePosition" @click="close();focusEventVenue()">赛事场馆周边</button></template>
          </EventMapToolbar>

          <p v-if="screen==='detail'&&!loading&&!venuePosition" class="ep-map-warning" role="status">本赛事尚无场馆坐标，暂无周边配套可展示。</p>
          <p v-else-if="detailMap?.calendarLocation" class="ep-map-warning" role="status">场馆位置取自赛历登记点。</p>
          <EventMapLegend :rows="mapLegend.filter(row=>!hiddenMapLabels.includes(row.label))"/>
        </div>

        <aside class="v14-overview-rail-shell ep-rail" :class="screen==='plan'?'ep-left':'ep-right'" :aria-label="screen==='overview'?'赛前研判概览':'赛事详情'">
          <div class="event-rail-module v14-overview-module">
          <template v-if="screen==='overview'">
            <EventWorkflowOverview v-if="assessmentSummary" :key="year+'-'+month" :summary="assessmentSummary"
              :active-filter="filter" @filter="filterFromOverview" @select="selectFromOverview" />
            <header v-else class="v14-overview-heading ep-heading"><h2>赛前研判概览</h2></header>
          </template>
          <template v-else-if="current&&inputs">
            <header class="v14-overview-heading ep-heading"><h2>{{ current.assessment||plan?'赛事详情':'历史赛事档案' }}</h2><button class="ep-link" @click="overview">返回总览</button></header>
            <section class="ep-block ep-detail-title"><h3>{{ detailEvent?.name }}</h3>
              <div class="ep-event-meta"><em :data-state="status(current)">{{ status(current) }}</em><small v-if="selectedExample" class="ep-example-label">研判演练</small><span>{{ detailEvent?.year }} 年 {{ detailEvent?.dateText }}</span></div>
              <p v-if="detailPlan?.inputs.venueName">{{ detailPlan.inputs.venueName }}</p>
            </section>
            <div class="ep-right-scroll" :class="{'ep-progress-detail':!!detailPlan,'ep-archived-detail':locked}">
              <section class="ep-block"><h3>基本信息</h3><dl class="ep-details"><div v-for="[label,value] in details" :key="label">
                <dt>{{ label }}</dt><dd>
                  <select v-if="label==='比赛场馆' && detailEvent && detailEvent.venueNames.length>1" class="ep-venue-select" aria-label="选择地图上展示的比赛场馆" :value="mapVenueName" @change="changeMapVenue">
                    <option v-for="name in detailEvent.venueNames" :key="name" :value="name">{{ name }}</option>
                  </select><template v-else>{{ value }}</template>
                </dd>
              </div></dl></section>
              <section v-if="reviewExperience.length || experienceError" class="ep-block"><h3>历届赛事复盘经验</h3>
                <button v-if="experienceError" class="ep-link" @click="experienceRetry++">复盘经验读取失败，重试</button>
                <details v-for="record in reviewExperience" :key="record.id" open><summary>{{ record.name }}{{ record.sample?' · 演示复盘':'' }}</summary>
                  <p v-for="i in record.issues" :key="i.id" class="ep-note">{{ i.title }} · {{ i.action }}</p>
                  <details v-if="record.template.length"><summary>保障方案模板</summary><ul><li v-for="row in record.template" :key="row">{{ row }}</li></ul></details>
                </details>
              </section>
              <section class="ep-block"><h3>{{ locked?'规模预测':current.assessment||plan?'规模与保障信息':'历史记录' }}</h3>
                <div class="ep-metrics ep-small-metrics">
                  <div><span>参赛人数</span><strong>{{ number(detailEvent?.participants) }}<small> 人</small></strong><OverviewPanelIcon name="trophy" /></div>
                  <div :title="inputs.note"><span>预计观众</span><strong>{{ number(inputs.spectators) }}<small> 人</small></strong><OverviewPanelIcon name="audience" /></div>
                  <div :title="inputs.note"><span>预计车位需求</span><strong>{{ number(demand?.parkingDemand) }}<small> 个</small></strong><OverviewPanelIcon name="parking" /></div>
                  <div :title="inputs.note"><span>预计客房需求</span><strong>{{ number(demand?.lodgingRooms) }}<small> 间</small></strong><OverviewPanelIcon name="lodging" /></div>
                </div>
                <p v-if="locked&&inputs.outsidePercent!=null" class="ep-archive-ratio">外地人员占比（预估） <b>{{ inputs.outsidePercent }}%</b></p>
              </section>
              <EventAssessmentProgress v-if="detailPlan" :key="detailPlan.eventId" :plan="detailPlan" :busy="busy" :readonly-example="!!selectedExample" :feedback-error="feedbackError" @feedback="recordFeedback" @view-plan="viewPlan" />
              <section v-if="detailEvent" class="ep-block"><h3>赛事资料</h3><p class="ep-source-file">{{ detailEvent.sourceFile }}<small v-if="detailEvent.sourceRow>0">{{ detailEvent.sourceSheet }} · 第 {{ detailEvent.sourceRow }} 行</small></p><a v-for="s in detailEvent.sources" :key="s.url" class="ep-source" :href="s.url" target="_blank" rel="noopener noreferrer"><span>{{ s.title }}</span><PortalIcon name="external" :size="16"/><small>补充：{{ s.fields.join('、') }}</small></a><p v-if="!detailEvent.sources.length" class="ep-caption">公开补充资料：无</p></section>
            </div>
            <div v-if="current.assessment||plan" class="ep-detail-actions">
              <template v-if="locked"><p class="ep-lifecycle-notice ep-closed-notice">{{ selectedExample?'演练归档：专项方案与部门会签记录已锁定。':'赛前研判已完结，方案与部门会签记录已归档。' }}</p><div class="ep-actions"><button v-if="screen!=='plan'" @click="exportReport">导出完结方案</button><button v-if="screen!=='plan'" class="ep-primary" @click="viewPlan()">查看完结方案</button><button v-else @click="screen='detail'">返回赛事列表</button></div></template>
              <template v-else-if="plan">
                <p id="ep-processing-notice" class="ep-lifecycle-notice" :class="{'ep-ready-notice':progress.canComplete}">{{ processingNotice }}</p>
                <div class="ep-actions">
                  <button v-if="screen!=='plan'" type="button" @click="viewPlan()">查看研判方案</button>
                  <button v-else type="button" @click="screen='detail'">返回赛事列表</button>
                  <button v-if="!selectedExample&&plan.status!=='draft'" type="button" class="ep-confirm" aria-describedby="ep-processing-notice" :disabled="busy||!canCloseCurrent" @click="requestComplete">确认完结</button>
                </div>
              </template>
              <button v-else class="ep-primary ep-wide" :disabled="busy||loading" @click="generate">{{ busy?'正在生成…':'开始研判' }}</button>
            </div>
            <div v-else class="ep-detail-actions"><p class="ep-caption">归入历史赛事不表示已核实实际举办、实绩或评分。</p><button class="ep-wide" @click="showDialog('history')">浏览历史赛事</button></div>
          </template>
          </div>
        </aside>
        <aside v-if="screen==='plan'&&plan&&current" class="v14-overview-rail-shell ep-rail ep-right" aria-label="专项预案">
          <div class="event-rail-module v14-overview-module">
            <header class="v14-overview-heading ep-heading"><h2>专项预案</h2><small>V{{ assessmentVersion(plan) }} · {{ locked?'已锁定':'处理中' }}</small></header>
            <nav class="ep-topic-grid" aria-label="选择专项预案"><button v-for="[id,label] in eventTopics" :key="id" type="button" :aria-pressed="topic===id" aria-controls="ep-topic-content" @click="setTopic(id)">{{ label }}</button></nav>
            <div class="ep-section-title ep-topic-title"><h3 id="ep-topic-title">{{ selectedTopic?.label }}预案</h3><span>责任部门 · {{ selectedTopic?.department }}</span></div>
            <div v-if="topic==='traffic'" class="ep-filters ep-road-filters"><button v-for="f in ['all','封闭建议','限行建议','待联系核实']" :key="f" :aria-pressed="roadFilter===f" :title="f==='all'?'全部':f" @click="roadFilter=f">{{ f==='all'?'全部':f==='待联系核实'?'停车':f.slice(0,2) }}</button></div>
            <div v-if="!locked&&selectedTopic" class="ep-check-toolbar">
              <label><input type="checkbox" :checked="topicTotal>0&&selectedForTopic.size===topicTotal" :indeterminate="selectedForTopic.size>0&&selectedForTopic.size<topicTotal" :disabled="busy||!topicTotal" @change="chooseItems(($event.target as HTMLInputElement).checked?selectedTopic.items.map(i=>i.id):[])">全选本类</label>
              <span>已选 {{ selectedForTopic.size }} / {{ topicTotal }} 项</span>
            </div>
            <p v-if="topic==='traffic' && previewKey && (roadPreviewPending || plan.roadBasis!==pendingRoadBasis)" class="ep-note" role="status">
              <template v-if="surveyError">京山市道路面暂未载入，封闭、限行路段待核实。<button class="ep-link" type="button" @click="surveyRetry++">重试</button></template>
              <template v-else-if="roadPreviewPending">正在读取京山市道路面…</template>
              <template v-else>道路清单已更新，请重新勾选需要推送的路段。</template>
            </p>
            <p v-if="topic==='traffic' && proposal?.roadBasis==='road-surfaces' && !roadPreviewPending && venuePosition" class="ep-note">{{ !proposal.roads.length?'当前研判范围内没有登记名称的道路面。':proposal.status==='draft'?'地图预览京山市道路面的封闭、限行建议，勾选的路段将随方案推送。':'路名和范围取自京山市道路面，封闭、限行均为赛前建议。' }}</p>
            <section :key="topic" id="ep-topic-content" class="ep-plan-items" aria-labelledby="ep-topic-title">
              <article v-for="i in topicItems" :key="i.id" class="ep-plan-item" :class="{'ep-unchecked':!selectedForTopic.has(i.id)}">
                <div><label v-if="!locked"><input type="checkbox" :checked="selectedForTopic.has(i.id)" :disabled="busy" @change="toggleItem(i.id,($event.target as HTMLInputElement).checked)"><strong>{{ i.title }}</strong></label><strong v-else>{{ i.title }}</strong>
                  <button v-if="i.featureId" :disabled="!selectedForTopic.has(i.id)&&!proposal?.roads.some(r=>r.id===i.featureId)" @click="locate(i.featureId)">定位</button></div>
                <p>{{ i.detail }}</p><p v-if="i.controlWindow" class="ep-control-time">{{ selectedExample?'模拟管控时段':'管控时段' }} · {{ i.controlWindow }}</p>
                <em :class="{'ep-red':i.status==='封闭建议'}">{{ i.status }}</em>
              </article>
              <p v-if="!topicItems.length" class="ep-empty">{{ locked?'本版没有符合条件的已确认子项':'当前分类没有匹配的子项' }}</p>
            </section>
            <footer class="ep-bottom ep-dispatch">
              <template v-if="!locked"><p class="ep-selected-totals" aria-live="polite"><span>已选 {{ selectedCount }} 项</span><span>{{ included.length }} 类预案</span><span>{{ recipientCount }} 个责任部门</span></p>
                <small v-if="plan.taskIds.length&&!sentUnchanged">推送新版后，原版反馈归档，所选责任部门重新办理。</small></template>
              <div class="ep-actions"><button type="button" :disabled="waitForRoads" @click="exportReport">{{ locked?'导出完结方案':sentUnchanged?'导出研判报告':'导出勾选预览' }}</button>
                <button v-if="!locked" type="button" class="ep-primary" :disabled="busy||waitForRoads||!selectedCount||sentUnchanged" @click="dispatchItems">{{ busy?'正在办理…':sentUnchanged?'已推送':plan.taskIds.length?'一键推送新版':'一键推送' }}</button></div>
            </footer>
          </div>
        </aside>
      </div>
      <div v-if="message" class="ep-notice" role="status">{{ message }}</div>
    </div>
    <EventAssessmentLedger v-if="ledgerOpen&&catalog" :catalog="catalog" :year="year" @close="ledgerOpen=false" @select="selectLedgerEvent" @refresh="load(true)" @withdrawn="applyWithdrawal" />
    <dialog ref="dialog" class="ep-dialog" @click="($event.target===dialog)&&dialog?.close()">
      <header><div><small>{{ year }} 年 · 京山网球</small><h2>{{ dialogMode==='calendar'?'完整赛事活动赛历':'历史赛事档案' }}</h2></div><button aria-label="关闭赛事列表" @click="dialog?.close()">×</button></header>
      <div class="ep-dialog-controls"><input v-model.trim="dialogSearch" type="search" placeholder="搜索赛事名称" aria-label="检索完整赛事列表"/><span>{{ dialogEvents.length }} 条记录</span><button @click="exportCalendar">导出全年赛历</button></div>
      <div class="ep-table-scroll"><table><thead><tr><th>序号</th><th>赛事 / 活动</th><th>时间</th><th>规模（人）</th><th>场馆</th><th>分类</th><th>操作</th></tr></thead><tbody><tr v-for="e in dialogEvents" :key="e.id"><td>{{ e.sequence }}</td><td>{{ e.name }}</td><td>{{ e.dateText }}</td><td>{{ number(e.participants) }}</td><td>{{ e.venueNames.join('、')||'无' }}</td><td>{{ e.category }} · {{ calendarStatus(e) }}</td><td><button @click="selectEvent(e);dialog?.close()">详情</button></td></tr></tbody></table><p v-if="!dialogEvents.length" class="ep-empty">没有找到匹配记录</p></div>
      <footer>保留原表序号；跨月赛事在赛历涉及月份均可筛选。未知信息显示“无”。<p v-if="sourceSummary?.note">{{ sourceSummary.note }}</p></footer>
    </dialog>
    <dialog ref="completeDialog" class="ep-dialog ep-complete-dialog" aria-labelledby="ep-complete-title" @cancel="busy&&$event.preventDefault()">
      <header><h2 id="ep-complete-title">确认完结并锁定方案</h2><button aria-label="取消完结" :disabled="busy" @click="completeDialog?.close()">×</button></header>
      <div class="ep-complete-body"><h3>{{ current?.name }}</h3><p>方案 V{{ assessmentVersion(plan) }} · {{ plan && selectedTopics(plan.topics,plan.dispatchedItems).length }} 项专项预案 · {{ progress.completed }}/{{ progress.total }} 个部门已反馈</p><p>确认后保存完结记录，专项方案和部门反馈将一同归档，保留查看和导出功能。</p><p v-if="completeError" role="alert" class="ep-inline-error">{{ completeError }}</p></div>
      <footer class="ep-actions"><button :disabled="busy" @click="completeDialog?.close()">返回核对</button><button class="ep-confirm" :disabled="busy||!progress.canComplete" @click="complete">{{ busy?'正在归档…':'确认完结并锁定' }}</button></footer>
    </dialog>
  </section>
</template>

<style src="./event-preassessment.css"></style>
