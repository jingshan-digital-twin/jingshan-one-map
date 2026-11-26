<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import IndustryModule from './IndustryModule.vue'
import IndustryRail from './IndustryRail.vue'
import PortalIcon from './PortalIcon.vue'
import ServicePager from './ServicePager.vue'
import InvestmentOverview from './InvestmentOverview.vue'
import AvailableParcelPicker from './AvailableParcelPicker.vue'
import { useInvestmentSelection } from './use-investment-selection'
import { buildChainCatalog, scopeEnterprises } from './industry-panorama.ts'
import { isSiteRecord, parcelPoint, recordPoint, targetEnterprises } from './investment-selection.ts'
import { api,jsonRequest } from './api.ts'
import InvestmentDemandDetail from './InvestmentDemandDetail.vue'
import { useServicePage } from './service-pagination'
import { buildDemands, demandCategories, demandMap, investmentOverviewMap, siteOptions, type Category, type Demand, type InvestmentMap } from './investment-demand'
import { denseGapAreas } from './investment-population'
import { matchesReserve, planningPolicyUrl, reserveLandUses, reserveLayerId, reserveMapFeature, screenedParcel, surveyReferenceLayerId, urbanExtentText, urbanPlacement, urbanRelationOf, urbanRelations, type UrbanRelation } from './investment-planning'
import { assessVenueSupport, stadiumStandardTitle, stadiumStandardUrl, venueStandardTitle, venueStandardUrl } from './venue-support-demand'
import type { RasterSelection } from './population-raster'
import { encodeDispatch, readDispatch } from './industry-investment.ts'
import type { DispatchMaterial, DispatchPayload } from './industry-investment.ts'
import { featureCenter } from './types.ts'
import type { CityFeature, Dataset, Result } from './types.ts'

type Tab = 'leads' | 'reserve' | 'records' | 'tasks'
type TaskTab = 'material' | 'flow' | 'history'
type Feedback = { text: string; at: string }

const props = defineProps<{
  datasets: Dataset[]; rules: Record<string, number>; mode: 'demo' | 'live'; region: string
  leftOpen: boolean; rightOpen: boolean; selectedFeature?: CityFeature | null; results: Result[]
  scopedReserves?:CityFeature[]; reserveAreaName?:string; version?:number; siteLoadState:string; candidateInScope:(f:CityFeature)=>boolean
  initialTab?: 'site'
  getGapSelection:()=>RasterSelection|undefined; populationRadiusM:number
  mapPick?: {feature:CityFeature} | null
  submitResult?: (payload: DispatchPayload) => Promise<Result>
  advanceResult?: (item: Result) => Promise<Result>
}>()
const emit = defineEmits<{
  'scene-map': [map: InvestmentMap]
  'reserve-zoom': [town:string]
  'reserve-enable': []
  'retry-site': []
  'investment-record':[row:Result]
  'venue-population': [needed:boolean]
  locate: [feature: CityFeature, datasetId?: string]
  close: [side: 'left' | 'right']
  open: [side: 'left' | 'right']
}>()

const tabs = [
  ['leads', '招商需求', 'network'],
  ['reserve', '项目选址', 'pin'],
  ['tasks', '交办台账', 'results'],
] as const
const taskTabs = [['material', '交办资料'], ['flow', '办理流程'], ['history', '操作记录']] as const
const tab = ref<Tab>(props.initialTab==='site'?'reserve':'leads')
const taskTab = ref<TaskTab>('flow')
const query = ref('')
const filter = ref('')
const recordId=ref<number>()
const siteDemand=shallowRef<Demand>()
const storedRecords=shallowRef<Result[]>([])
const historicalShapes=shallowRef<CityFeature[]>([])
const recordLoadError=ref(''), recordLoadAttempt=ref(0)
let pendingSelection:{key:string;id:string}|undefined
const reserveId = ref('')
const reserveUse = ref('')
const reserveTown = ref('')
const reserveUrban = ref<UrbanRelation|''>('')
const taskId = ref<number>()
const category = ref<Category>('chain')
const demandId = ref('')
const activateFirstChain=ref(false)
const demandRegion = ref('')
const demandState = ref('')
const filterOpen = ref(false)
const form = ref<DispatchMaterial>()
const dispatchLeadId = ref('')
const dispatchFeatures = ref<CityFeature[]>([])
const notice = ref('')
const busy = ref(false)
const feedbackOpen = ref(false)
const feedbackText = ref('')
const modeKey = computed(() => 'jingshan-investment-' + props.mode)

const savedReviews = ref<Record<string,string>>({})
const savedParcels = ref<Record<string, string[]>>({})
const drafts = ref<Record<string, DispatchMaterial>>({})
const feedbacks = ref<Record<string, Feedback>>({})
const sampleTransitions = ref<Record<string, Result['status']>>({})

function restore<T>(field: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(modeKey.value + '-' + field) ?? 'null') as T ?? fallback }
  catch { return fallback }
}
function save(field: string, content: object, message: string) {
  try {
    localStorage.setItem(modeKey.value + '-' + field, JSON.stringify(content))
    notice.value = message
  } catch { notice.value = '当前浏览器无法保存，记录仅在本次打开时有效。' }
}
watch(modeKey, () => {
  savedReviews.value = restore('reviews', {})
  savedParcels.value = restore('parcels', {})
  drafts.value = restore('drafts', {})
  feedbacks.value = restore('feedback', {})
  sampleTransitions.value = restore('sample-status', {})
}, { immediate: true })
watch(() => props.initialTab, value => { if (value==='site') openTab('reserve') })

const isDemo = computed(() => props.mode === 'demo')
const sourcedData = computed(() => isDemo.value ? props.datasets : props.datasets.map(item => ({
  ...item, features: item.features.some(f=>f.properties.sample===true) ? item.features.filter(f=>f.properties.sample!==true) : item.features,
})))
const surveyedParcels=computed(()=>sourcedData.value.find(d=>d.id===reserveLayerId)?.features.filter(screenedParcel)??[])
const scopeParcels=computed(()=>props.scopedReserves ?? surveyedParcels.value.filter(f=>f.properties.inBusinessArea===true && (props.region==='京山市' || f.properties.region===props.region)))
const nearbySites=computed(()=>{
  if(!siteDemand.value)return
  const scoped=new Set(scopeParcels.value.map(f=>f.id))
  return siteOptions(siteDemand.value,sourcedData.value).filter(o=>scoped.has(o.id)).flatMap(o=>parcelPoint(o.feature)??[])
})
const localParcels=computed(()=>reserveTown.value ? scopeParcels.value.filter(f=>f.properties.region===reserveTown.value) : scopeParcels.value)
const referenceParcels=computed(()=>props.region==='京山市' && !reserveTown.value ?
  (sourcedData.value.find(d=>d.id===surveyReferenceLayerId)?.features ?? surveyedParcels.value)
    .filter(f=>f.properties.inBusinessArea===false && screenedParcel(f)) : [])
const reserveTowns=computed(()=>[...new Set(scopeParcels.value.map(f=>f.properties.region))].sort((a,b)=>a.localeCompare(b,'zh-CN')))
const reserveFilter=computed(()=>({landUse:reserveUse.value,search:query.value.trim(),town:reserveTown.value,urban:reserveUrban.value}))
const boundaryCounts=computed(()=>{
  const counts:Record<UrbanRelation,number>={inside:0,crossing:0,outside:0,unknown:0}
  for(const f of localParcels.value)counts[urbanRelationOf(f)]++
  return (Object.keys(counts) as UrbanRelation[]).filter(key=>key!=='unknown' || counts[key]).map(key=>({key,count:counts[key],label:urbanRelations[key].label}))
})
async function selectReserveTown(name:string){
  reserveTown.value=name
  reserveId.value=''
  await nextTick()
  emit('reserve-zoom',name || props.region)
}
const inventory=computed(()=>localParcels.value.filter(f=>matchesReserve(f,reserveFilter.value)).sort((a,b)=>urbanPlacement(a).rank-urbanPlacement(b).rank || Number(b.properties.area)-Number(a.properties.area) || a.id.localeCompare(b.id)))
const inventoryPage=useServicePage(inventory,[query,reserveTown,reserveUse,reserveUrban,()=>props.region],10)
const selectedReserve=computed(()=>inventory.value.find(f=>f.id===reserveId.value))
const reserveClasses=computed(()=>Object.entries(reserveLandUses).map(([code,label])=>({code,label,count:localParcels.value.filter(f=>f.properties.landUseCode===code).length})).filter(c=>c.count))
watch(localParcels,()=>{if(reserveUse.value && !reserveClasses.value.some(c=>c.code===reserveUse.value))reserveUse.value=''})
const reserveArea=computed(()=>localParcels.value.reduce((sum,f)=>sum+Number(f.properties.area),0)/10000)
const surveyArea=(f:CityFeature)=>Number(f.properties.area).toLocaleString('zh-CN',{maximumFractionDigits:2})+' ㎡'
function showReserve(feature:CityFeature) {
  if(siteDemand.value){selection.toggle(feature.id);return}
  emit('reserve-enable')
  reserveId.value=feature.id
  inventoryPage.reveal(inventory.value.findIndex(f=>f.id===feature.id))
  emit('open','right')
}
const demandView=computed(()=>tab.value==='leads')
const venueDemandActive=computed(()=>category.value==='venue' && demandView.value)
watch(venueDemandActive,needed=>emit('venue-population',needed),{immediate:true})
const gapSelection=computed(()=>venueDemandActive.value ? props.getGapSelection() : undefined)
const demandGaps=computed(()=>gapSelection.value ? denseGapAreas(gapSelection.value,props.rules.peoplePerCourt || 4000) : [])
const supportChecks=computed(()=>category.value==='support' && demandView.value ? assessVenueSupport(sourcedData.value,props.region) : [])
const unlocatedFood=computed(()=>supportChecks.value[0]?.items.find(i=>i.label==='餐饮')?.unlocated??0)
const gapTotal=computed(()=>demandGaps.value.reduce((n,g)=>n+g.population,0))
const unassignedPeople=computed(()=>demandGaps.value.reduce((n,g)=>n+(g.region==='京山市'?g.population:0),0))
const demands=computed(()=>sourcedData.value.length ? buildDemands(sourcedData.value,props.region,demandGaps.value,props.populationRadiusM,category.value,supportChecks.value) : [])
const inCategory = computed(()=>demands.value.filter(d=>d.category===category.value))
const demandGroups = computed(()=>[...new Set(inCategory.value.map(d=>d.group))])
const demandStates = computed(()=>[...new Set(inCategory.value.map(d=>d.status))])
const visibleDemands = computed(()=>inCategory.value.filter(d=>
  (!demandRegion.value || d.group===demandRegion.value) && (!demandState.value || d.status===demandState.value) &&
  [d.name,d.direction,d.region,d.topic,d.group].some(v=>v.includes(query.value.trim()))))
const demandPage=useServicePage(visibleDemands,[category,query,demandRegion,demandState,()=>props.region])
demandPage.resize(15)
const groupedPage=computed(()=>Array.from(new Set(demandPage.rows.map(d=>d.group))).map(group=>({
  name:group,rows:demandPage.rows.filter(d=>d.group===group),count:visibleDemands.value.filter(d=>d.group===group).length
})))
const selectedDemand=computed(()=>visibleDemands.value.find(d=>d.id===demandId.value))
const chainDemand=computed(()=>tab.value==='leads' && selectedDemand.value?.category==='chain'?selectedDemand.value:undefined)
const pickerDemand=computed(()=>chainDemand.value ?? siteDemand.value)
const selection=useInvestmentSelection(pickerDemand,()=>props.version,()=>props.reserveAreaName??props.region,
  f=>props.candidateInScope(f),nearbySites)
function selectDemand(d:Demand) {
  if(busy.value)return
  if(chainDemand.value?.id===d.id){
    const first=selection.recommended[0]??selection.filtered[0]?.id
    if(first)selection.locate(first)
  }
  form.value=undefined
  category.value=d.category
  demandId.value=d.id
  activateFirstChain.value=false
  notice.value=''
  demandPage.reveal(visibleDemands.value.findIndex(row=>row.id===d.id))
  emit('open','right')
}
function setCategory(value:Category) {
  if(busy.value)return
  openTab('leads')
  category.value=value
  demandId.value=''
  activateFirstChain.value=value==='chain'
  demandRegion.value=''
  demandState.value=''
  filterOpen.value=false
  if(value==='chain' && visibleDemands.value[0])selectDemand(visibleDemands.value[0])
}
function showOverview() {
  form.value=undefined
  demandId.value=''
  activateFirstChain.value=false
  notice.value=''
}
function sampleTask(id: number, title: string, direction: string, status: Result['status'], deadline: string): Result {
  const material = { title, direction, evidence:'弥补产业或赛事服务缺口（演示）',
    sites:'',
    department:'招商服务中心', assignee:'', deadline, requirement:'核实落地条件并对接意向主体' }
  return { id, scene:'investment', title, department:material.department, summary:encodeDispatch(material),
    status:sampleTransitions.value[String(id)] ?? status, createdAt:'2026-11-17T01:30:00Z', version:0,
    features:[] }
}
const businessResults=computed(()=>[...new Map([...props.results,...storedRecords.value].filter(r=>r.scene==='investment').map(r=>[r.id,r])).values()].sort((a,b)=>b.id-a.id))
const tasks = computed(() => {
  const published = businessResults.value.filter(r=>readDispatch(r).recordKind!=='selection')
  return published.length || !isDemo.value ? published : [
    sampleTask(-1,'新市北片球场招引','网球场建设与运营','received','2026-12-01'),
    sampleTask(-2,'球线供应商对接','球线配套供应商','pending','2026-12-05'),
  ]
})
const statuses = { pending: '待签收', received: '办理中', completed: '已归档' } as const
const filteredTasks = computed(() => tasks.value.filter(item =>
  item.title.includes(query.value.trim()) && (filter.value === '' || item.status === filter.value)))
const taskPage=useServicePage(filteredTasks,[query,filter,()=>props.region])
const activeTask = computed(() => filteredTasks.value.find(item => item.id === taskId.value) ?? filteredTasks.value[0])
const material = computed(() => activeTask.value ? readDispatch(activeTask.value) : undefined)
const feedback = computed(() => feedbacks.value[String(activeTask.value?.id)])
const dateFormat = new Intl.DateTimeFormat('zh-CN',{ timeZone:'Asia/Shanghai', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' })
const dateText = (value: string) => Number.isNaN(Date.parse(value)) ? '—' : dateFormat.format(new Date(value))
const numberText = (value: number) => value.toLocaleString('zh-CN')
const tone = (value: string) => /初筛通过|推进|归档|已接收/.test(value) ? 'green'
  : /待核|办理中|复核/.test(value) ? 'amber' : 'blue'

watch(()=>[props.region,props.reserveAreaName,props.mode],()=>{showOverview();siteDemand.value=undefined;reserveTown.value='';if(tab.value!=='reserve')query.value='';reserveId.value='';demandRegion.value='';demandState.value=''})
watch(()=>props.version,(version,previous)=>{
  const captured=siteDemand.value
  if(!previous || version===previous || !captured)return
  if(form.value) drafts.value[captured.id]={...form.value}
  openTab('leads')
  category.value=captured.category
  demandId.value=captured.id
  notice.value='已载入新发布版本，请按当前需求重新核对选址。'
})
watch(visibleDemands,items=>{
  if(activateFirstChain.value && category.value==='chain' && items[0])selectDemand(items[0])
  else if(demandId.value && !items.some(d=>d.id===demandId.value))showOverview()
})
const siteRecords=computed(()=>{
  const result=businessResults.value.filter(isSiteRecord)
  // Old browser-only backups remain accessible alongside saved server records.
  if(tab.value==='records'){
    const source=new Map(scopeParcels.value.map(f=>[f.id,f]))
    Object.entries(savedParcels.value).forEach(([id,ids],i)=>{
      const features=ids.flatMap(id=>source.get(id)??[])
      if(features.length)result.push({id:-1000-i,scene:'investment',version:0,status:'completed',createdAt:'',
        title:id.replace(/^chain:/,'')+' · 本机备选',department:'',summary:'历史本机备选',features})
    })
  }
  return result.filter(r=>(props.region==='京山市' || r.features.some(f=>f.properties.region===props.region)) &&
    (r.title+' '+readDispatch(r).direction+' '+(readDispatch(r).enterpriseTypes??[]).join(' ')+' '+r.features.map(f=>f.properties.name).join(' ')).includes(query.value.trim()))
})
const recordPage=useServicePage(siteRecords,[query,()=>props.region],10)
const activeRecord=computed(()=>siteRecords.value.find(r=>r.id===recordId.value)??siteRecords.value[0])
const recordMaterial=computed(()=>activeRecord.value?readDispatch(activeRecord.value):undefined)
watch([tab,recordLoadAttempt],async([view],_,onCleanup)=>{
  recordLoadError.value=''
  if(view!=='records' && view!=='tasks')return
  const controller=new AbortController();onCleanup(()=>controller.abort())
  try{
    const rows=await api<Result[]>('/investment/records',{signal:controller.signal})
    if(!controller.signal.aborted)storedRecords.value=rows
  }catch(e){if(!controller.signal.aborted)recordLoadError.value=e instanceof Error?e.message:'记录加载失败'}
},{immediate:true})
watch([()=>tab.value==='records'?activeRecord.value?.id:undefined,recordLoadAttempt],async([id],_,onCleanup)=>{
  historicalShapes.value=[]
  if(!id)return
  if(id<0){historicalShapes.value=activeRecord.value?.features??[];return}
  const controller=new AbortController();onCleanup(()=>controller.abort())
  try{
    const row=await api<Result>('/investment/records/'+id,{signal:controller.signal})
    if(!controller.signal.aborted)historicalShapes.value=row.features
  }catch(e){if(!controller.signal.aborted)recordLoadError.value=e instanceof Error?e.message:'记录图形加载失败'}
},{immediate:true})
const chainCatalog=computed(()=>buildChainCatalog(sourcedData.value,props.region))
const businessPoints=computed(()=>{
  if(!demandView.value || category.value!=='chain')return []
  const rows=scopeEnterprises(chainCatalog.value,null,chainDemand.value?.topic)
  return rows.flatMap(row=>row.points.filter(({feature:f})=>props.candidateInScope(f)).map(({feature:f,datasetId})=>({
    ...f,id:'chain-business:'+datasetId+':'+f.id,properties:{...f.properties,mapRole:'support',kind:'chain-business',
      color:'#52b7df',legendLabel:'关联企业',showLabel:false,interactive:false}
  })))
})
const sceneMap=computed<InvestmentMap>(()=>{
  if(tab.value==='reserve' && siteDemand.value){
    const d=siteDemand.value
    const selected=new Set(selection.checkedIds)
    const features:CityFeature[]=scopeParcels.value.filter(f=>selected.has(f.id)).map(f=>reserveMapFeature(f,true))
    if(d.anchor)features.push({type:'Feature',id:'siting:'+d.id,geometry:{type:'Point',coordinates:d.anchor},
      properties:{name:d.name,region:d.region,kind:'investment-anchor',mapRole:'venue',legendLabel:'需求中心',interactive:false,serviceRangeCenter:true}})
    return {focus:'area',features,venueModelFocus:d.venueModelFocus,anchor:selection.focus?featureCenter(selection.focus)??d.anchor:d.anchor,
      height:3000,focusRevision:selection.revision,reserveFilter:{ids:new Set([...selection.filtered.map(f=>f.id),...selected])}}
  }
  if(tab.value==='reserve'){
    const f=selectedReserve.value, filter=reserveFilter.value
    return f ? {focus:'area',features:[reserveMapFeature(f,true)],fitFeature:f,reserveFilter:filter}
      : {focus:'county',features:[],reserveFilter:filter}
  }
  if(tab.value==='records'){
    const features=historicalShapes.value.map(f=>{
      const shape=reserveMapFeature(f,true)
      return {...shape,id:'record:'+activeRecord.value?.id+':'+f.id,properties:{...shape.properties,kind:'record-parcel',recordId:activeRecord.value?.id}}
    })
    return {focus:features.length?'area':'county',features,focusRevision:activeRecord.value?.id}
  }
  if(tab.value==='tasks'){
    const features=(activeTask.value?.features??[]).flatMap(f=>{
      const p=recordPoint(f)
      return p?[{...p,id:'task-point:'+p.id,properties:{...p.properties,kind:'task-site',mapRole:'task',showLabel:false,interactive:false,legendLabel:'交办点位'}}]:[]
    })
    return {focus:features.length?'area':'county', features,
      anchor:features.length ? featureCenter(features[0]) ?? undefined : undefined, height:3500}
  }
  if(chainDemand.value){
    return {features:selection.features,focus:selection.focus?'area':'county',fitFeature:selection.focus,focusRevision:selection.revision}
  }
  if(selectedDemand.value)return {...demandMap(selectedDemand.value,[],''),courtFootprints:undefined}
  if(category.value==='venue')return {focus:'county',features:visibleDemands.value.flatMap(d=>d.anchor?[{
    type:'Feature',id:'gap-demand:'+d.id,geometry:{type:'Point',coordinates:d.anchor},properties:{
      name:d.name,region:d.region,kind:'gap-demand',mapRole:'demand',leadId:d.id,showLabel:false,legendLabel:'场馆需求'}
  }]:[])}
  const overview=category.value==='chain' && !query.value.trim() && !demandRegion.value && !demandState.value
  const map=investmentOverviewMap(visibleDemands.value,sourcedData.value,props.region,overview)
  return {...map,courtFootprints:undefined,features:[...map.features.filter(f=>f.geometry.type==='Point'),...businessPoints.value]}
})
watch(()=>[sceneMap.value,tab.value==='leads' && venueDemandActive.value ? gapSelection.value : undefined] as const,
  ([map,grid])=>emit('scene-map',{...map,investmentPane:tab.value==='leads'?'demand':tab.value,
    ...(grid?{populationMode:'investment' as const,populationSelection:grid}:{})}),{immediate:true})
watch(()=>props.mapPick,pick=>{
  if(!pick || busy.value || form.value)return
  const p=pick.feature.properties
  if(tab.value==='leads' && chainDemand.value && p.kind==='available-parcel' && typeof p.optionId==='string'){
    selection.toggle(p.optionId)
    return
  }
  if(tab.value==='tasks' || tab.value==='records')return
  if(p.kind==='investment-reserve' && p.inBusinessArea===true){
    if(tab.value!=='reserve')return
    showReserve(pick.feature)
    return
  }
  if(tab.value!=='leads' || typeof p.leadId!=='string') return
  const d=demands.value.find(item=>item.id===p.leadId)
  if(d){if(!visibleDemands.value.some(row=>row.id===d.id)){query.value='';demandRegion.value='';demandState.value=''}selectDemand(d)}
})
function openTab(value: Tab) {
  siteDemand.value=undefined
  if(value!==tab.value || value==='reserve')reserveId.value=''
  if(value!=='reserve'){reserveUse.value='';reserveTown.value='';reserveUrban.value=''}
  if(value==='reserve' || value==='records')emit('reserve-enable')
  tab.value = value
  query.value = ''
  filter.value = ''
  notice.value = ''
  form.value = undefined

  feedbackOpen.value = false
  emit('open','right')
}
function chooseNearbySites(d:Demand){
  openTab('reserve')
  siteDemand.value=d
}
function navigateBusiness(value:Tab) {
  if (value === 'leads') showOverview()
  openTab(value)
}
function selectTask(item: Result) {
  taskId.value = item.id
  taskPage.reveal(filteredTasks.value.findIndex(row=>row.id===item.id))
  feedbackOpen.value = false
  notice.value = ''
  emit('open','right')
}
function openRecordTask(item:Result){
  openTab('tasks')
  selectTask(item)
}
function saveReview() {
  const selected = selectedDemand.value
  if (!selected) return
  savedReviews.value = { ...savedReviews.value, [selected.id]: new Date().toISOString() }
  save('reviews', savedReviews.value, '已保存本地研判。')
}
async function postSelection(kind:'selection'|'dispatch',material:DispatchMaterial,features:CityFeature[]){
  const body={kind,version:props.version,material,parcelIds:features.map(f=>f.id)}
  const key=JSON.stringify(body)
  if(pendingSelection?.key!==key){
    const id=crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('')
    pendingSelection={key,id}
  }
  const row=await api<Result>('/investment/records',jsonRequest('POST',{...body,requestId:pendingSelection.id}))
  pendingSelection=undefined
  storedRecords.value=[row,...storedRecords.value.filter(r=>r.id!==row.id)]
  emit('investment-record',row)
  return row
}
function currentMaterial(project:Demand,features:CityFeature[]):DispatchMaterial {
  return {title:project.name,demandId:project.id,direction:project.direction,enterpriseTypes:targetEnterprises(project),evidence:project.evidence,
    sites:features.map(f=>f.properties.name).join('、'),department:'招商事务中心',assignee:'',deadline:'',
    requirement:'核实用地条件，对接意向企业并回填洽谈进展。'}
}
async function saveSelection(){
  const d=pickerDemand.value, chosen=selection.selected
  if(!d || !chosen.length || busy.value)return
  busy.value=true
  try{
    const row=await postSelection('selection',currentMaterial(d,chosen),chosen)
    openTab('records');recordId.value=row.id;notice.value='选址记录已保存。'
  }catch(e){notice.value=e instanceof Error?e.message:'保存失败'}finally{busy.value=false}
}
function openDispatch(){
  const project=pickerDemand.value??selectedDemand.value
  if(!project)return
  const chosen=pickerDemand.value?selection.selected:[]
  if(pickerDemand.value && !chosen.length)return
  const fresh=currentMaterial(project,chosen)
  dispatchLeadId.value=project.id
  dispatchFeatures.value=chosen.length ? [...chosen] : project.anchor ? [{
    type:'Feature',id:project.id+':demand',geometry:{type:'Point',coordinates:project.anchor},
    properties:{name:project.support?.venue.properties.name??project.name,region:project.region,kind:'investment-demand-point'},
  }] : []
  form.value={...fresh,...drafts.value[project.id],demandId:project.id,enterpriseTypes:fresh.enterpriseTypes,sites:fresh.sites,department:'招商事务中心'}
  notice.value=''
  emit('open','right')
}
function saveDraft() {
  if (!form.value || !dispatchLeadId.value) return
  drafts.value = { ...drafts.value, [dispatchLeadId.value]: { ...form.value } }
  save('drafts',drafts.value,'已保存本地草稿。')
}
async function dispatch() {
  const record = form.value
  if (busy.value || !record || !props.submitResult) return
  if (!record.department || !record.deadline || !record.requirement.trim()) {
    notice.value = '请填写接收单位、办理期限和办理要求。'
    return
  }
  busy.value = true
  try {
    const result=dispatchFeatures.value.some(f=>f.properties.kind==='available-parcel')
      ? await postSelection('dispatch',record,dispatchFeatures.value)
      : await props.submitResult({title:record.title,department:record.department,summary:encodeDispatch(record),features:dispatchFeatures.value})
    if(!storedRecords.value.some(r=>r.id===result.id))storedRecords.value=[result,...storedRecords.value]
    openTab('tasks')
    taskId.value = result.id
    taskTab.value = 'flow'
    notice.value = '已推送至招商事务中心，等待签收。'
  } catch (error) { notice.value = error instanceof Error ? error.message : '交办保存失败。' }
  finally { busy.value = false }
}
async function taskAction() {
  const item = activeTask.value
  if (!item || busy.value || item.status === 'completed') return
  if (item.status === 'received' && !feedback.value) {
    feedbackText.value = ''
    feedbackOpen.value = true
    taskTab.value = 'flow'
    return
  }
  const next = item.status === 'pending' ? 'received' : 'completed'
  busy.value = true
  try {
    if (item.id < 0) {
      sampleTransitions.value = { ...sampleTransitions.value, [item.id]: next }
      save('sample-status',sampleTransitions.value,next === 'received' ? '已签收演示任务。' : '已归档演示任务。')
    } else if (props.advanceResult) {
      const updated=await props.advanceResult(item)
      storedRecords.value=storedRecords.value.map(r=>r.id===item.id?updated:r)
      notice.value = next === 'received' ? '已签收任务。' : '已复核归档。'
    } else notice.value = '当前无法更新任务，请刷新后重试。'
  } catch (error) { notice.value = error instanceof Error ? error.message : '任务更新失败。' }
  finally { busy.value = false }
}
function saveFeedback() {
  const item = activeTask.value
  if (!item || !feedbackText.value.trim()) return
  feedbacks.value = { ...feedbacks.value, [item.id]: { text:feedbackText.value.trim(), at:new Date().toISOString() } }
  feedbackOpen.value = false
  save('feedback',feedbacks.value,'已登记本地反馈，等待复核。')
}
</script>

<template>
  <IndustryRail class="investment-rail" side="left" :open="leftOpen"
    :class="{ 'investment-chain-directory': demandView && category === 'chain' }">
    <IndustryModule title="智能招商" fill>
      <template #navigation>
        <div class="investment-navigation">
          <nav class="investment-business-nav" aria-label="招商业务入口">
            <button v-for="[key,label,icon] in tabs" :key="key" type="button" :disabled="busy"
              :aria-pressed="key === tab || (key === 'reserve' && tab === 'records')" @click="navigateBusiness(key)">
              <PortalIcon class="investment-nav-icon" :name="icon" :size="17" />{{ label }}
            </button>
          </nav>
          <nav v-if="demandView" class="investment-subnav" aria-label="招商需求分类">
            <button v-for="(text,key) in demandCategories" :key="key" type="button" :disabled="busy"
              :aria-pressed="category === key" @click="setCategory(key)">{{ text }}</button>
          </nav>
          <nav v-else-if="tab === 'reserve' || tab === 'records'" class="investment-subnav" aria-label="项目选址分类">
            <button type="button" :aria-pressed="tab === 'reserve'" @click="openTab('reserve')">储备地块</button>
            <button type="button" :aria-pressed="tab === 'records'" @click="openTab('records')">选址记录</button>
          </nav>
        </div>
      </template>
      <p v-if="(tab==='reserve'||tab==='records') && siteLoadState" role="status">{{siteLoadState}} <button v-if="!siteLoadState.includes('正在')" class="industry-button" @click="emit('retry-site')">重试</button></p>
      <p v-if="recordLoadError && (tab==='records'||tab==='tasks')" role="status">{{recordLoadError}} <button class="industry-button" @click="recordLoadAttempt++">重试</button></p>
      <template v-if="tab==='leads'">
      <div class="investment-search-bar"><input v-model="query" class="investment-search" type="search" aria-label="搜索需求名称" placeholder="搜索需求名称"/>
        <button v-if="category==='chain'" class="industry-button" type="button" aria-controls="investment-filters" :aria-expanded="filterOpen" @click="filterOpen=!filterOpen">筛选</button></div>
      <div v-if="filterOpen || category!=='chain'" id="investment-filters" class="industry-filters">
        <select v-model="demandRegion" :aria-label="category==='chain'?'筛选产业阶段':'筛选需求分组'"><option value="">{{ category==='chain'?'全部阶段':'全部分组' }}</option><option v-for="group in demandGroups" :key="group">{{ group }}</option></select>
        <select v-model="demandState" aria-label="筛选核实状态"><option value="">全部状态</option><option v-for="state in demandStates" :key="state">{{ state }}</option></select>
      </div>
      <div v-if="category!=='chain'" class="investment-column-head"><span>线索名称</span><span>{{category==='venue'?'需求类型':'业态缺口'}}</span></div>
      <div class="investment-directory"><section v-for="group in groupedPage" :key="group.name">
        <h3 v-if="category==='chain'">{{ group.name }}<small>{{ group.count }} 条需求</small></h3>
        <button v-for="d in group.rows" :key="d.id" type="button" class="investment-demand-row" :aria-pressed="d.id===selectedDemand?.id" :title="d.name+' · '+d.direction"
          @click="selectDemand(d)"><span class="demand-copy"><strong>{{ d.name }}</strong><small v-if="category==='chain'" :title="d.direction">{{ d.direction }}</small></span><span class="demand-tag">{{d.blind?'覆盖缺口':d.support?d.support.missing.map(i=>i.label).join('、'):d.topic}}</span></button>
      </section></div>
      <p v-if="!visibleDemands.length" class="industry-empty">当前条件下暂无需求</p>
      </template>
      <template v-else-if="tab==='records'">
        <input v-model="query" class="investment-search" type="search" aria-label="搜索选址记录" placeholder="搜索需求、企业类型或地块"/>
        <div class="investment-column-head"><span>选址记录</span><span>地块数</span></div>
        <div class="investment-directory"><button v-for="r in recordPage.rows" :key="r.id" class="investment-demand-row" type="button" :aria-pressed="r.id===activeRecord?.id" @click="recordId=r.id">
          <span class="demand-copy"><strong>{{r.title}}</strong><small>{{r.id<0?'本机备选':readDispatch(r).recordKind==='selection'?'已保存':'已交办'}} · {{dateText(r.createdAt)}}</small></span><span>{{r.features.length}} 块</span>
        </button></div><p v-if="!recordPage.total" class="industry-empty">暂无符合条件的选址记录。</p>
      </template>
      <template v-else-if="tab==='reserve' && siteDemand">
        <section class="industry-card"><h4>{{siteDemand.name}}</h4>
          <dl class="industry-kv"><div><dt>需求来源</dt><dd>{{demandCategories[siteDemand.category]}}</dd></div>
            <div><dt>所属镇街</dt><dd>{{siteDemand.region}}</dd></div>
            <div><dt>选址半径</dt><dd>{{(siteDemand.radiusM??1000)/1000}} 公里</dd></div>
            <div><dt>周边可用地块</dt><dd>{{selection.options.length}} 块</dd></div></dl>
          <p>{{siteDemand.evidence}}</p>
          <button type="button" class="industry-button" @click="openTab('reserve')">查看全部储备地块</button>
        </section>
      </template>
      <template v-else-if="tab==='reserve'">
        <input v-model="query" class="investment-search" type="search" aria-label="搜索储备地块" placeholder="搜索村名、地块名称或图斑号"/>
        <div class="industry-filters reserve-filters">
          <select :value="reserveTown" aria-label="地块所属镇街" @change="selectReserveTown(($event.target as HTMLSelectElement).value)"><option value="">{{region==='京山市'?'全部镇街':'当前行政区'}}</option><option v-for="town in reserveTowns" :key="town">{{ town }}</option></select>
          <select v-model="reserveUse" aria-label="筛选调查地类"><option value="">全部地类</option><option v-for="c in reserveClasses" :key="c.code" :value="c.code">{{ c.label }}</option></select>
        </div>
        <div class="investment-column-head"><span>地块名称</span><span>调查面积</span></div>
        <div class="investment-directory"><button v-for="f in inventoryPage.rows" :key="f.id" class="investment-demand-row" type="button" :aria-pressed="f.id===selectedReserve?.id" @click="showReserve(f)">
          <span class="demand-copy"><strong :title="f.properties.name">{{ f.properties.name }}</strong><small>{{f.properties.region}} · {{urbanPlacement(f).label}} · {{urbanPlacement(f).action}}</small></span><span>{{surveyArea(f)}}</span>
        </button></div>
        <p v-if="!inventoryPage.total" class="industry-empty">当前条件下未找到地块</p>
      </template>
      <template v-else>
      <div class="industry-filters"><input v-model="query" type="search" placeholder="搜索任务" aria-label="搜索任务"/>
        <select v-model="filter" aria-label="办理状态"><option value="">全部状态</option><option v-for="(label,key) in statuses" :key="key" :value="key">{{ label }}</option></select>
      </div>
      <table class="industry-table" aria-label="交办任务">
        <thead><tr><th scope="col">任务</th><th scope="col">办理状态</th><th scope="col">期限</th></tr></thead>
        <tbody>
          <tr v-for="item in taskPage.rows" :key="item.id" :class="{selected:item.id === activeTask?.id}">
            <td><button type="button" class="industry-row-action" :title="item.title" :aria-pressed="item.id === activeTask?.id" @click="selectTask(item)">{{ item.title }}</button></td>
            <td><span class="industry-status" :data-tone="tone(statuses[item.status])">{{ statuses[item.status] }}</span></td>
            <td>{{ readDispatch(item).deadline.slice(5).replace('-', '/') || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!filteredTasks.length" class="industry-empty">当前范围暂无交办任务</p>
      </template>
      <template #actions>
        <ServicePager v-if="tab==='leads'" :pagination="demandPage" label="招商需求分页"/>
        <ServicePager v-else-if="tab==='records'" :pagination="recordPage" label="选址记录分页"/>
        <ServicePager v-else-if="tab==='reserve' && !siteDemand" compact :pagination="inventoryPage" label="储备地块分页"/>
        <ServicePager v-else-if="tab==='tasks'" :pagination="taskPage" label="招商台账分页"/>
      </template>
    </IndustryModule>
  </IndustryRail>

  <IndustryRail class="investment-rail" side="right" :open="rightOpen"
    :class="{ 'industry-detail-rail': tab !== 'leads' || !!selectedDemand || !!form }">
    <IndustryModule :title="form ? '发起交办' : tab==='reserve' ? (siteDemand?'需求选址':selectedReserve?'地块详情':'地块总览') : tab === 'records' ? '选址记录' : tab === 'tasks' ? '交办单详情' : selectedDemand ? '招商线索详情' : '招商总览'" fill>
      <template v-if="form">
        <h3 class="industry-card">{{ form.title }}</h3>
        <form id="industry-dispatch-form" class="industry-form" @submit.prevent="dispatch">
          <label>招引方向<input v-model="form.direction" maxlength="160" required /></label>
          <label>需求依据<input v-model="form.evidence" maxlength="500" required /></label>
          <label>企业类型<span class="form-summary">{{form.enterpriseTypes?.join('、') || form.direction}}</span></label>
          <label v-if="form.sites">已选地块<span class="form-summary" aria-label="推送地块清单">{{form.sites}}</span></label>
          <label>接收单位<input :value="form.department" aria-label="接收单位" readonly/></label>
          <label>承办人<select v-model="form.assignee"><option value="">待接收单位分配</option><option v-if="isDemo">招商事务中心承办岗（演示）</option></select></label>
          <label>办理期限<input v-model="form.deadline" type="date" required /></label>
          <label>办理要求<textarea v-model="form.requirement" rows="3" maxlength="1500" required /></label>
        </form>
      </template>
      <AvailableParcelPicker v-else-if="tab==='reserve' && siteDemand" :selection="selection" :types="targetEnterprises(siteDemand)" :radius-m="siteDemand.radiusM??1000"/>
      <template v-else-if="tab==='reserve'">
        <section v-if="selectedReserve" class="industry-card" aria-label="当前地块详情">
          <div class="reserve-heading"><h4>{{ selectedReserve.properties.name }}</h4><button type="button" class="industry-button" aria-label="关闭地块详情" @click="reserveId=''">×</button></div>
          <dl class="industry-kv">
            <div><dt>所属镇街</dt><dd>{{selectedReserve.properties.region}}</dd></div>
            <div><dt>村或社区</dt><dd>{{selectedReserve.properties.surveyUnit}}</dd></div>
            <div><dt>调查地类</dt><dd>{{selectedReserve.properties.landUse}}（{{selectedReserve.properties.landUseCode}}）</dd></div>
            <div><dt>调查面积</dt><dd>{{surveyArea(selectedReserve)}}</dd></div>
            <div><dt>调查图斑号</dt><dd>{{selectedReserve.properties.surveyParcel}}</dd></div>
            <div><dt>调查标识码</dt><dd>{{selectedReserve.properties.surveyId}}</dd></div>
            <div><dt>调查权属单位</dt><dd>{{selectedReserve.properties.surveyOwner || '未登记'}}</dd></div>
            <div><dt>城镇开发边界</dt><dd>{{urbanExtentText(selectedReserve)}}</dd></div>
            <div><dt>保护线核查</dt><dd>已避让生态保护红线、永久基本农田</dd></div>
            <div><dt>选址研判</dt><dd>{{urbanPlacement(selectedReserve).action}}。{{urbanPlacement(selectedReserve).note}}</dd></div>
            <div><dt>储备状态</dt><dd>拟储备 · 待核实</dd></div>
          </dl>
        </section>
        <section v-else class="industry-card">
          <h4>{{reserveTown || reserveAreaName || region}}拟储备地块</h4>
          <dl class="industry-kv"><div><dt>地块数量</dt><dd>{{localParcels.length}} 块</dd></div><div><dt>调查总面积</dt><dd>{{reserveArea.toLocaleString('zh-CN',{maximumFractionDigits:2})}} 公顷</dd></div></dl>
          <nav class="industry-tabs reserve-relations" aria-label="按城镇开发边界筛选"><button v-for="item in boundaryCounts" :key="item.key" type="button" :aria-pressed="reserveUrban===item.key" @click="reserveUrban=reserveUrban===item.key?'':item.key">{{item.label}} {{item.count}}</button></nav>
          <div class="reserve-breakdown"><button v-for="c in reserveClasses" :key="c.code" type="button" class="investment-demand-row" :aria-pressed="reserveUse===c.code" @click="reserveUse=reserveUse===c.code?'':c.code"><strong>{{c.label}}</strong><span>{{c.count}} 块</span></button></div>
        </section>
        <section class="industry-card">
          <h4>地块来源</h4>
          <p>京山市 2022 年度国土变更调查。按整块图斑筛选业务镇街内的工业、商服和物流仓储用地，避让生态保护红线和永久基本农田。</p>
          <p class="industry-empty">城镇建设项目优先比选界内地块，并核对详细规划。跨界地块分段核对，界外地块需结合存量利用或特定选址条件专项核实。各类地块的现状和权属意向均待核实。</p>
          <a class="planning-source" :href="planningPolicyUrl" target="_blank" rel="noopener noreferrer">湖北省城镇开发边界优化及管理实施细则</a>
          <details v-if="referenceParcels.length" class="reserve-archive"><summary>业务区外备查（{{referenceParcels.length}} 块）</summary>
            <p v-for="f in referenceParcels" :key="f.id">{{f.properties.region}}{{f.properties.surveyUnit}}，{{f.properties.surveyParcel}} 号，{{f.properties.landUse}} {{surveyArea(f)}}。位于系统镇街范围之外，仅保留调查记录。</p>
          </details>
        </section>
      </template>
      <template v-else-if="tab==='records'">
        <section v-if="activeRecord && recordMaterial" class="industry-card">
          <h4>{{activeRecord.title}}</h4>
          <dl class="industry-kv"><div><dt>记录时间</dt><dd>{{dateText(activeRecord.createdAt)}}</dd></div>
            <div><dt>企业类型</dt><dd>{{recordMaterial.enterpriseTypes?.join('、') || recordMaterial.direction || '未记录'}}</dd></div>
            <div><dt>业务状态</dt><dd>{{activeRecord.id<0?'本机备选':recordMaterial.recordKind==='selection'?'已保存选址':statuses[activeRecord.status]}}</dd></div>
            <div v-if="recordMaterial.recordKind!=='selection' && activeRecord.department"><dt>接收单位</dt><dd>{{activeRecord.department}}</dd></div>
          </dl>
          <h4>已选地块（{{activeRecord.features.length}}）</h4>
          <ul class="record-parcels"><li v-for="f in activeRecord.features" :key="f.id">{{f.properties.name}}<small>{{f.properties.region}} · {{urbanPlacement(f).label}}</small></li></ul>
          <button v-if="activeRecord.id>0 && recordMaterial.recordKind!=='selection'" class="industry-button" type="button" @click="openRecordTask(activeRecord)">查看交办单</button>
        </section><p v-else class="industry-empty">保存选址或推送交办后，可在这里查看所选地块。</p>
      </template>
      <template v-else-if="tab === 'tasks'">
        <template v-if="activeTask && material">
          <h3 class="industry-card investment-task-heading">{{ activeTask.title }} <span class="industry-status" :data-tone="tone(statuses[activeTask.status])">{{ statuses[activeTask.status] }}</span></h3>
          <nav class="industry-tabs" aria-label="任务详情分类">
            <button v-for="[key,label] in taskTabs" :key="key" type="button" :aria-pressed="taskTab === key" @click="taskTab = key">{{ label }}</button>
          </nav>
          <dl v-if="taskTab !== 'history'" class="industry-kv">
            <template v-if="taskTab === 'material'">
              <div><dt>招引方向</dt><dd>{{ material.direction || '未记录' }}</dd></div>
              <div><dt>企业类型</dt><dd>{{material.enterpriseTypes?.join('、') || material.direction || '未记录'}}</dd></div>
              <div><dt>需求依据</dt><dd>{{ material.evidence || '未记录' }}</dd></div>
            </template>
            <div><dt>接收单位</dt><dd>{{ material.department }}</dd></div>
            <div v-if="taskTab === 'material'"><dt>承办人</dt><dd>{{ material.assignee || '待分配' }}</dd></div>
            <div><dt>办理期限</dt><dd>{{ material.deadline || '未记录' }}</dd></div>
            <div><dt>已选地块</dt><dd class="form-summary">{{ material.sites || '无' }}</dd></div>
            <div><dt>办理要求</dt><dd>{{ material.requirement }}</dd></div>
          </dl>
          <template v-if="taskTab === 'flow'">
            <ol class="industry-card investment-flow">
              <li><span>已交办</span><time>{{ dateText(activeTask.createdAt) }}</time></li>
              <li><span>签收</span><span>{{ activeTask.status === 'pending' ? '待签收' : '已签收' }}</span></li>
              <li><span>办理反馈</span><span>{{ feedback ? '已登记' : activeTask.status === 'received' ? '进行中' : '—' }}</span></li>
              <li><span>复核归档</span><span>{{ activeTask.status === 'completed' ? '已归档' : '待办理' }}</span></li>
            </ol>
            <section class="industry-card">
              <h4>项目招商进展</h4>
              <p>{{ feedback?.text || (activeTask.status === 'received' ? '由' + material.department + '回填' : statuses[activeTask.status]) }}</p>
            </section>
            <form v-if="feedbackOpen" class="industry-form" @submit.prevent="saveFeedback">
              <label>办理反馈<textarea v-model="feedbackText" rows="3" maxlength="1500" required /></label>
              <button type="submit" class="industry-button primary">保存反馈</button>
            </form>
          </template>
          <ul v-if="taskTab === 'history'" class="industry-card investment-flow">
            <li><span>发起交办</span><time>{{ dateText(activeTask.createdAt) }}</time></li>
            <li v-if="feedback"><span>登记反馈</span><time>{{ dateText(feedback.at) }}</time></li>
            <li v-if="activeTask.status !== 'pending'"><span>当前状态</span><span>{{ statuses[activeTask.status] }}</span></li>
          </ul>
        </template>
        <p v-else class="industry-empty">请从交办任务清单选择一项任务</p>
      </template>
      <InvestmentDemandDetail v-else-if="selectedDemand" :lead="selectedDemand" :data="sourcedData" :region="region" :mode="mode"
        :reviewed="!!savedReviews[selectedDemand.id]" @review="saveReview">
        <AvailableParcelPicker v-if="chainDemand" :selection="selection" :types="targetEnterprises(chainDemand)"/>
      </InvestmentDemandDetail>
      <template v-else>
        <section v-if="category==='venue'" class="industry-card">
          <h4>全部场地开放后的高密度缺口</h4>
          <dl class="industry-kv"><div><dt>服务半径</dt><dd>{{ populationRadiusM/1000 }} 公里</dd></div>
            <div><dt>未覆盖人口</dt><dd>{{ gapSelection ? numberText(gapTotal)+' 人' : '待测算' }}</dd></div>
            <div><dt>涉及镇街</dt><dd>{{ new Set(demandGaps.map(g=>g.region).filter(r=>r!=='京山市')).size }} 个</dd></div></dl>
          <p class="industry-empty">地图显示全部高密度缺口，每个镇街优先列出未覆盖人口最多的网格。<template v-if="unassignedPeople">其中 {{ numberText(unassignedPeople) }} 人的镇街归属待核实。</template></p>
        </section>
        <section v-if="category==='support'" class="industry-card">
          <h4>场馆周边配套筛查</h4>
          <dl class="industry-kv"><div><dt>核查场馆</dt><dd>{{ supportChecks.length }} 座</dd></div><div><dt>有补点线索</dt><dd>{{ supportChecks.filter(v=>v.missing.length).length }} 座</dd></div></dl>
          <p class="industry-empty">按场馆周边 1 公里检索已登记的医疗、餐饮、停车和日用品零售。圈内零记录形成核查线索，缺少有效台账的类别标为待核实。<template v-if="unlocatedFood">另有 {{unlocatedFood}} 条餐饮记录待定位。</template></p>
          <a class="planning-source" :href="stadiumStandardUrl" target="_blank" rel="noopener noreferrer">{{stadiumStandardTitle}}</a>
          <a class="planning-source" :href="venueStandardUrl" target="_blank" rel="noopener noreferrer">{{venueStandardTitle}}</a>
        </section>
        <InvestmentOverview :data="sourcedData" :region="region" :demands="demands" :tasks="tasks"
        @task="id=>{openTab('tasks');const item=tasks.find(t=>t.id===id);if(item)selectTask(item)}"/>
      </template>
      <p v-if="notice" role="status">{{ notice }}</p>
      <template #actions>
        <template v-if="form">
          <button type="button" class="industry-button" :disabled="busy" @click="form=undefined">返回修改</button>
          <button type="button" class="industry-button" :disabled="busy" @click="saveDraft">保存草稿</button>
          <button type="submit" form="industry-dispatch-form" class="industry-button primary" :disabled="busy || !submitResult">确认交办</button>
        </template>
        <template v-else-if="tab === 'tasks' && activeTask">
          <button v-if="activeTask.status !== 'completed'" type="button" class="industry-button primary" :disabled="busy" @click="taskAction">
            {{ activeTask.status === 'pending' ? '签收任务' : feedback ? '复核归档' : '登记反馈' }}
          </button>
          <button type="button" class="industry-button" @click="taskTab = 'material'">查看交办资料</button>
        </template>
        <template v-else-if="tab==='leads' && selectedDemand || siteDemand">
          <button v-if="pickerDemand" type="button" class="industry-button" :disabled="busy || !selection.selected.length" @click="saveSelection">保存选址记录</button>
          <button v-else-if="selectedDemand?.anchor && selectedDemand.siteRequired" type="button" class="industry-button" :disabled="busy" @click="chooseNearbySites(selectedDemand)">前往项目选址</button>
          <button type="button" class="industry-button primary" :disabled="busy || (!!pickerDemand && !selection.selected.length)" @click="openDispatch">推送至招商事务中心</button>
        </template>
      </template>
    </IndustryModule>
  </IndustryRail>
</template>

<style scoped>
.planning-source { color:var(--v14-icon); font-size:15px; }
.reserve-entry,.reserve-heading {display:flex;align-items:center;justify-content:space-between;gap:8px}
.reserve-entry {width:100%;text-align:left;cursor:pointer;font:inherit;color:var(--v14-ink)}
.reserve-entry b {color:var(--v14-metric);font-size:24px}
.reserve-heading h4 {margin:0;min-width:0}
.reserve-heading .industry-button {flex:none}
.reserve-breakdown,.reserve-relations {margin-top:8px}
.reserve-filters {display:grid;grid-template-columns:1fr 1.4fr}
.reserve-filters select {min-width:0}
.reserve-archive {color:var(--v14-muted);margin-top:8px}
.reserve-archive summary {cursor:pointer}
.investment-chain-directory {
  background: linear-gradient(var(--v14-surface), var(--v14-surface)), #527f99;
}
.investment-rail :deep(.industry-module-fill){flex:1 1 auto;min-height:0;overflow:hidden}
.investment-rail :deep(.industry-module-fill > .v14-overview-heading),.investment-rail :deep(.industry-actions){flex-shrink:0}
.investment-rail :deep(.industry-module-body){min-height:0;min-width:0;flex:1 1 auto;overflow:auto;gap:10px;padding:12px;grid-template-columns:minmax(0,1fr)}
.investment-rail :deep(.industry-actions:not(:empty)){padding-top:8px}
.investment-rail :deep(.industry-actions:empty){display:none}
.investment-directory {display:grid;align-content:start;min-width:0;gap:4px}
.investment-directory section {min-width:0}
.investment-directory h3,.investment-column-head {display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0;padding:4px 10px;border-left:3px solid var(--v14-metric);background:var(--v14-chart-track);font-size:18px;line-height:26px;white-space:nowrap}
.investment-column-head {font-weight:700;font-size:16px;line-height:24px}
.investment-directory h3 small {font-size:16px;font-weight:400}
.investment-demand-row {display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;width:100%;min-height:36px;gap:8px;text-align:left;padding:5px 8px;color:var(--v14-ink);background:var(--v14-surface);border:1px solid transparent;border-bottom-color:var(--industry-table-line);cursor:pointer;font:400 16px/24px var(--v14-font)}
.investment-demand-row:hover {background:var(--industry-selected)}
.investment-demand-row[aria-pressed="true"] {border-color:var(--v14-list-line);background:var(--v14-tab-active);color:#fff;box-shadow:inset 3px 0 #70d5ff}
.investment-demand-row strong {min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px}
.demand-copy {display:grid;min-width:0}
.demand-copy small {min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 14px/24px var(--v14-font);color:var(--v14-muted)}
.demand-tag {display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:44px;height:26px;padding:0 6px;line-height:24px;white-space:nowrap;border:1px solid var(--v14-edge);border-radius:3px;background:var(--v14-tab);color:var(--v14-ink)}
.investment-rail :deep(.industry-actions > .investment-push) {flex:1 1 100%;width:100%;min-width:0;white-space:nowrap;}
.investment-rail.left-panel :deep(.industry-actions) {display:grid;grid-template-columns:minmax(0,1fr);gap:8px;justify-content:stretch;padding:8px 12px 12px;}
.investment-rail.left-panel :deep(.industry-module-body input[type=search]) {min-height:36px;padding:5px 8px 5px 35px;background:var(--v14-overlay) url('/jingshan/ui/panorama-v14/search.svg') 9px center/18px 18px no-repeat}
.investment-search-bar {display:flex;align-items:stretch;gap:6px}
.investment-search-bar input {min-width:0;flex:1}
.investment-search-bar .industry-button {min-height:36px;padding:4px 9px;white-space:nowrap}
.investment-rail :deep(.industry-filters select){min-height:34px;padding:4px 6px;}
.investment-rail .industry-tabs {display:grid;grid-auto-columns:minmax(0,1fr);grid-auto-flow:column;gap:4px}
.investment-rail .industry-tabs > button {min-width:0;min-height:32px;padding:3px;font-size:16px;line-height:24px;white-space:nowrap}
.investment-navigation {
  flex: none;
  display: grid;
  gap: 5px;
  min-width: 0;
  padding: 8px 12px 0;
}
.investment-business-nav {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--v14-list-line);
  border-radius: 4px;
  background: var(--v14-tab);
}
.investment-business-nav > button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 0;
  min-height: 38px;
  padding: 4px 2px;
  border: 0;
  border-radius: 0;
  color: var(--v14-ink);
  background: transparent;
  font: 700 16px/24px var(--v14-font);
  white-space: nowrap;
}
.investment-business-nav > button + button { border-inline-start: 1px solid var(--v14-list-line); }
.investment-business-nav > button[aria-pressed="true"] { background: var(--v14-tab-active); color: #fff; }
.investment-business-nav > button[aria-pressed="false"]:hover:not(:disabled) { background: var(--industry-selected); }
.investment-business-nav > button:focus-visible { outline-offset: -3px; }
.investment-subnav {
  display: flex;
  flex-wrap: wrap;
  gap: 0 clamp(6px, 3cqi, 16px);
  padding-inline: 2px;
  border-bottom: 1px solid color-mix(in srgb, var(--v14-icon) 38%, transparent);
}
.investment-subnav > button {
  min-height: 34px;
  padding: 4px 3px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--v14-muted);
  font: 400 16px/24px var(--v14-font);
  white-space: nowrap;
}
.investment-subnav > button[aria-pressed="true"] {
  color: var(--v14-ink);
  font-weight: 700;
  box-shadow: inset 0 -3px var(--v14-icon);
}
.investment-subnav > button:hover:not(:disabled) { color: var(--v14-ink); }
@container (max-width: 305px) {
  .investment-business-nav .investment-nav-icon { display: none; }
}
@container (max-width: 280px) {
  .investment-navigation { padding-inline: 8px; }
  .investment-subnav { column-gap: 8px; padding-inline: 0; }
  .investment-subnav > button { padding-inline: 0; font-size: 15px; }
}
.form-summary {white-space:normal;overflow-wrap:anywhere;max-height:10em;overflow:auto;line-height:1.55}
.record-parcels {list-style:none;padding:0;margin:0;display:grid;gap:4px}
.record-parcels li {padding:4px 7px;border-bottom:1px solid var(--v14-edge)}
.record-parcels small {display:block;color:var(--v14-muted)}
.investment-rail :deep(.industry-row-action),.investment-rail :deep(.industry-table th),.investment-rail :deep(.industry-table td),.investment-rail :deep(.industry-kv dt) {white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.investment-rail :deep(.industry-row-action){display:block;max-width:100%}
.investment-rail :deep(.industry-table th),.investment-rail :deep(.industry-table td){padding:5px 8px;font-size:16px;line-height:24px}
.investment-rail :deep(.industry-kv dt),.investment-rail :deep(.industry-kv dd){padding:5px 8px;font-size:16px;line-height:24px}
.investment-rail :deep(.industry-status){white-space:nowrap}
.industry-table[aria-label="招商线索"] th:first-child,
.industry-table[aria-label="交办任务"] th:first-child { width: 45%; }
.industry-table[aria-label="招商线索"] th:first-child:nth-last-child(2) { width: 66%; }
.investment-meter {
  display: grid;
  grid-template-columns: 5em minmax(0,1fr) auto;
  align-items: center;
  gap: 8px;
}
.investment-meter meter { width: 100%; min-width: 0; accent-color: var(--v14-metric); }
.investment-meter meter::-webkit-meter-bar { border-color: transparent; background: var(--v14-chart-track); }
.investment-meter meter::-webkit-meter-optimum-value { background: var(--v14-metric); }
.investment-flow { padding-inline-start: 32px; }
.investment-flow li { padding-block: 4px; }
.investment-flow li span:last-child, .investment-flow li time { float: inline-end; }
.investment-task-heading { display: flex; align-items: center; justify-content: space-between; }
.industry-form label { display: grid; grid-template-columns: minmax(5em, .7fr) minmax(0, 1.65fr); gap: 8px; align-items: start; white-space:nowrap;}
.industry-form label > :is(input,textarea,select) { min-width: 0; }
</style>
