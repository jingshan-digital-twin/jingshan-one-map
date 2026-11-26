<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import IndustryModule from './IndustryModule.vue'
import IndustryRail from './IndustryRail.vue'
import FusionPackages from './FusionPackages.vue'
import { downloadCsv } from './api.ts'
import { locatePlanVenue } from './event-assessment.ts'
import { publishedCompetitions, upcomingCompetitions } from './event-platform-data.ts'
import { fusionArrivals, type FusionOrigin } from './fusion-arrivals.ts'
import { fusionDestinationsId } from './fusion-destinations.ts'
import { fusionItineraries, fusionReturnCities, fusionTripMap, type FusionMapView, type FusionTicket } from './fusion-itinerary.ts'
import type { FusionRoute } from './fusion-promotion.ts'
import { dashboardPalette } from './dashboard-palette.ts'
import { featureCenter, type Dataset } from './types.ts'

const props = defineProps<{
  datasets:Dataset[]; today:string; mode:'demo'|'live'; leftOpen:boolean; rightOpen:boolean; mapPick?:string
}>()
const emit = defineEmits<{
  'map-view':[view:FusionMapView, focus:boolean]
  'open-right':[]
  operations:[panel:'merchants'|'routes'|'coupons', id?:string, tab?:string]
}>()
const metrics = [{id:'people', title:'来京山人数', short:'人数', unit:'人'}, {id:'vehicles', title:'来京山车辆', short:'车辆', unit:'辆'}] as const
const tabs = [{id:'between',name:'赛间游览'}, {id:'return',name:'返程顺游'}, {id:'tickets',name:'票根权益'}] as const
type Tab = typeof tabs[number]['id']
const metricId = ref<'people'|'vehicles'>('people')
const requestedDate = ref('')
const latest = computed(() => fusionArrivals(props.datasets,'',props.mode))
const date = computed(() => requestedDate.value || latest.value.date || props.today)
const daily = computed(() => date.value === latest.value.date ? latest.value : fusionArrivals(props.datasets,date.value,props.mode))
const metric = computed(() => metrics.find(item => item.id === metricId.value)!)
const trendMax = computed(() => Math.max(1,...daily.value.trend.map(day => day[metricId.value] ?? 0)))
const origins = computed(() => [...daily.value.origins].sort((a,b)=>(b[metricId.value]??-1)-(a[metricId.value]??-1)))
const originId = ref('')
const chosenOrigin = computed(() => daily.value.origins.find(row => row.id===originId.value))
const expandOrigins = ref(false)
const number = (value:number|null|undefined) => value == null ? '—' : value.toLocaleString('zh-CN')
const km = (value:number) => Number(value.toFixed(1)).toLocaleString('zh-CN')
function percent(row:FusionOrigin) {
  const total=daily.value[metricId.value], value=row[metricId.value]
  return total && value != null ? 100*value/total : null
}

const tab = ref<Tab>('between')
const flowMode = ref<'between'|'return'|'origin'>('between')
const minutes = ref(180)
const focusSerial = ref(0)
const chosenStop = ref('')
const stopsContainer = ref<HTMLElement>()
const eventChoice = ref<string|null>(null)
const venueChoice = ref('')
const returnChoice = ref('')
const competitions = computed(() => publishedCompetitions(props.datasets))
const upcoming = computed(() => upcomingCompetitions(competitions.value,date.value))
const events = computed(() => [...upcoming.value, ...competitions.value.filter(item=>!upcoming.value.some(e=>e.id===item.id))
  .sort((a,b)=>(b.startDate??'').localeCompare(a.startDate??''))])
const eventId = computed(() => eventChoice.value ?? upcoming.value[0]?.id ?? '')
const currentEvent = computed(() => competitions.value.find(item=>item.id===eventId.value))
const tripDate = computed(() => {
  const event = currentEvent.value
  if (event?.startDate && (date.value<event.startDate || date.value>(event.endDate||event.startDate))) return event.startDate
  return date.value
})
const venues = computed(() => (props.datasets.find(d=>d.id==='venues')?.features??[])
  .filter(f=>f.properties.sample!==true && f.geometry)
  .flatMap(f=>{const position=featureCenter(f); return position ? [{name:f.properties.name,position}] : []})
  .sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')))
const venuesForEvent = computed(() => {
  const event=currentEvent.value
  return event ? event.venueNames.flatMap(name=>{
    const match=locatePlanVenue(event,name,props.datasets)
    return match.position ? [{name,position:match.position}] : []
  }) : []
})
const venueOptions = computed(() => venuesForEvent.value.length ? venuesForEvent.value : venues.value)
const venue = computed(() => venueOptions.value.find(item=>item.name===venueChoice.value) ??
  (currentEvent.value ? venuesForEvent.value[0] : venues.value.find(item=>item.name.includes('网球训练基地')) ?? venues.value[0]) ?? null)
const cityChoices = computed(() => {
  const reported=daily.value.origins.filter(row=>row.position)
  const names=new Set(reported.map(row=>row.name.replace(/市$/u,'')))
  return [...reported,...fusionReturnCities.filter(row=>!names.has(row.name.replace(/市$/u,'')))]
})
const destination = computed(() => cityChoices.value.find(row=>row.name===returnChoice.value) ??
  chosenOrigin.value ?? cityChoices.value[0] ?? null)
const tripLayers = computed(() => {
  const relevant=props.datasets.filter(d=>['tourism','springs',fusionDestinationsId,'merchants','offers'].includes(d.id))
  return props.mode==='demo' ? relevant : relevant.map(d=>({...d,features:d.features.filter(row=>row.properties.sample!==true)}))
})
const itineraries = computed(() => fusionItineraries(tripLayers.value,venue.value,destination.value,tripDate.value,minutes.value,eventId.value||undefined))
const kind = ref('全部')
const scope = ref('全部')
const stops = computed(() => flowMode.value==='between'
  ? itineraries.value.between.filter(item=>kind.value==='全部'||item.kind===kind.value)
  : itineraries.value.returnStops.filter(item=>scope.value==='全部'||item.scope===scope.value))
const activeStop = computed(() => stops.value.find(item=>item.id===chosenStop.value))
const ticketScope=ref<'trip'|'all'>('all')
const tripTickets=computed(() => {
  if(ticketScope.value==='all') return itineraries.value.offers
  if(activeStop.value) return activeStop.value.offers
  const relevant=new Set(stops.value.map(s=>s.id))
  return itineraries.value.offers.filter(offer=>offer.placeId && relevant.has(offer.placeId))
})
const packageView = shallowRef<FusionMapView|null>(null)
const map = computed(() => packageView.value ?? fusionTripMap(flowMode.value,venue.value,destination.value,stops.value,activeStop.value?.id))
watch([map,focusSerial], ([view,serial],old) => emit('map-view',view,old[1]!==undefined && serial!==old[1]), {immediate:true,flush:'post'})
watch(()=>props.mapPick, async id=>{
  if (!id || !stops.value.some(item=>item.id===id)) return
  chosenStop.value=id
  if(flowMode.value==='origin') flowMode.value='return'
  tab.value=flowMode.value
  await nextTick()
  const row=stopsContainer.value?.querySelector<HTMLElement>('[data-stop-id="'+CSS.escape(id)+'"]')
  row?.scrollIntoView({block:'nearest',inline:'nearest'})
})
function setDate(value:string) {
  if(!value) return
  packageView.value=null
  requestedDate.value=value
  originId.value=''; returnChoice.value=''; expandOrigins.value=false; chosenStop.value=''
  flowMode.value=tab.value==='return'?'return':'between'
}
function changeTab(value:Tab) {
  packageView.value=null
  tab.value=value
  if(value==='tickets') { ticketScope.value=activeStop.value?'trip':'all'; return }
  flowMode.value=value; chosenStop.value=''; focusSerial.value++
}
function chooseOrigin(row:FusionOrigin) {
  packageView.value=null
  originId.value=row.id; returnChoice.value=row.name; tab.value='return'; flowMode.value='origin'
  chosenStop.value=''; scope.value='全部'; focusSerial.value++
  if(!props.rightOpen && window.matchMedia('(max-width: 960px)').matches) emit('open-right')
}
function changeEvent(id:string) {
  packageView.value=null
  eventChoice.value=id; venueChoice.value=''; chosenStop.value=''; focusSerial.value++
}
function changeDestination(name:string) {
  packageView.value=null
  returnChoice.value=name; originId.value=daily.value.origins.find(item=>item.name===name)?.id??''
  chosenStop.value=''; flowMode.value='return'; focusSerial.value++
}
function chooseStop(id:string) {
  packageView.value=null
  if(flowMode.value==='origin') flowMode.value='return'
  chosenStop.value=id; focusSerial.value++
}
watch([venueChoice,minutes,scope,kind],()=>{packageView.value=null},{flush:'sync'})
function previewPackage(route:FusionRoute|null) {
  if (!route?.source || !route.destination) { packageView.value=null; return }
  const color={local:dashboardPalette.cyan,regional:dashboardPalette.sky,province:dashboardPalette.yellow}[route.tier]
  const qualifier=route.published?'推广线路方向':'候选线路方向'
  packageView.value={features:[],legend:[{label:qualifier,color}],regional:route.tier!=='local',
    flow:{id:route.id,from:route.source,to:route.destination,fromLabel:route.from,toLabel:route.to,color,qualifier}}
  focusSerial.value++
}
function locateOffer(offer:FusionTicket) {
  if(!offer.placeId) return
  const inBreak=itineraries.value.between.some(row=>row.id===offer.placeId)
  changeTab(inBreak?'between':'return'); kind.value='全部'; scope.value='全部'; chooseStop(offer.placeId)
}
function onMap(offer:FusionTicket) {
  return offer.placeId && [...itineraries.value.between,...itineraries.value.returnStops].some(row=>row.id===offer.placeId)
}
function exportDaily() {
  const lines=[
    ['统计日期','数据类型','地区','到访人数（人）','到访车辆（辆）'],
    [date.value,daily.value.sample?'演示汇总':'全市汇总','京山市',daily.value.people,daily.value.vehicles],
    ...origins.value.map(item=>[date.value,daily.value.sample?'演示客源':'客源分项',item.name,item.people,item.vehicles]),
  ]
  downloadCsv('京山到访日报-'+date.value+'.csv',lines)
}
function exportTrip() {
  if(tab.value==='tickets') {
    downloadCsv('京山票根权益-'+tripDate.value+'.csv',[
      ['行程日期','赛事','出发场馆','权益范围','权益','商家','适用规则','有效期起','有效期止','演示'],
      ...tripTickets.value.map(o=>[tripDate.value,currentEvent.value?.name,venue.value?.name,
        ticketScope.value==='all'?'全部权益':activeStop.value?.name??(flowMode.value==='between'?'赛间地点':'沿途地点'),
        o.name,o.merchantName,o.rule,o.validFrom,o.validTo,o.sample?'是':'否']),
    ])
    return
  }
  downloadCsv('京山'+(tab.value==='between'?'赛间游览':'返程顺游')+'-'+tripDate.value+'.csv',[
    ['行程日期','赛事','出发场馆','返程城市','地点','类型','区域','地址','等级','运营主体','距场馆直线公里','经停直线增程公里','赛间预计分钟','可用权益','已选择','演示'],
    ...stops.value.map(s=>[tripDate.value,currentEvent.value?.name,venue.value?.name,tab.value==='return'?destination.value?.name:'',s.name,s.kind,s.city,
      s.address,s.grade,s.operator,km(s.distanceKm),s.detourKm==null?'':km(s.detourKm),tab.value==='between'?s.estimatedMinutes:'',s.offers.map(o=>o.name).join('、'),s.id===activeStop.value?.id?'是':'',s.sample?'是':'否']),
  ])
}
</script>

<template>
  <IndustryRail side="left" :open="leftOpen" aria-label="来京山客流" class="fusion-dashboard-rail">
    <IndustryModule title="来京山客流" fill>
      <label class="fusion-field"><span>统计日期</span><input type="date" aria-label="到访统计日期" :value="date" @change="setDate(($event.target as HTMLInputElement).value)"></label>
      <div class="fusion-heading"><h3 :title="daily.sources.join('、')">每日到访</h3><span v-if="daily.sample" class="fusion-badge">演示日报</span></div>
      <div class="fusion-metrics">
        <button v-for="m in metrics" :key="m.id" class="fusion-metric" :aria-pressed="metricId===m.id" @click="metricId=m.id">
          <span>{{ m.title }}</span><strong>{{ number(daily[m.id]) }} <small>{{ m.unit }}</small></strong>
        </button>
      </div>
      <p v-if="!daily.reported" class="fusion-muted">当日暂无到访日报</p>
      <section class="fusion-section" aria-label="近七日到访趋势">
        <div class="fusion-heading"><h3>近七日到访趋势</h3><span>{{ metric.short }} / {{ metric.unit }}</span></div>
        <div class="fusion-trend">
          <button v-for="day in daily.trend" :key="day.date" class="fusion-day" :class="{on:day.date===date}"
            :aria-label="day.date+'，'+number(day[metricId])+metric.unit" :title="day.date+' · '+number(day[metricId])+metric.unit" @click="setDate(day.date)">
            <span class="fusion-bar-track"><i :style="{height: 100*(day[metricId]??0)/trendMax+'%'}"></i></span>
            <span>{{ day.date.slice(8) }}</span>
          </button>
        </div>
      </section>
      <section class="fusion-section">
        <div class="fusion-heading"><h3>客源地分布</h3><span>{{ metric.short }}占比</span></div>
        <ul v-if="origins.length" class="fusion-origins">
          <li v-for="(row,i) in (expandOrigins?origins:origins.slice(0,6))" :key="row.id">
            <button :aria-pressed="chosenOrigin?.id===row.id" @click="chooseOrigin(row)">
              <span class="fusion-rank">{{ String(i+1).padStart(2,'0') }}</span>
              <span class="fusion-origin-text"><strong>{{ row.name }}</strong><span class="fusion-meter"><i :style="{width:Math.min(percent(row)??0,100)+'%'}"></i></span></span>
              <span class="fusion-amount">{{ number(row[metricId]) }}{{ metric.unit }}<small>{{ percent(row)==null?'—':percent(row)!.toFixed(1)+'%' }}</small></span>
            </button>
          </li>
        </ul>
        <p v-else class="fusion-muted">当日暂无客源地分项</p>
        <button v-if="origins.length>6" class="fusion-link" @click="expandOrigins=!expandOrigins">{{ expandOrigins?'收起':'查看全部 '+origins.length+' 个客源地' }}</button>
      </section>
      <template #actions><button class="industry-button" :disabled="!daily.reported" @click="exportDaily">导出到访日报</button></template>
    </IndustryModule>
  </IndustryRail>

  <IndustryRail side="right" :open="rightOpen" aria-label="网球文旅联动" class="fusion-dashboard-rail">
    <IndustryModule title="网球文旅联动" fill>
      <nav class="industry-tabs fusion-trip-tabs" aria-label="文旅行程">
        <button v-for="item in tabs" :key="item.id" :aria-pressed="tab===item.id" @click="changeTab(item.id)">{{ item.name }}</button>
      </nav>
      <div class="fusion-fields">
        <label class="fusion-field"><span>选择赛事</span><select aria-label="选择赛事" :value="eventId" @change="changeEvent(($event.target as HTMLSelectElement).value)">
          <option value="">自选出发场馆</option><option v-for="e in events" :key="e.id" :value="e.id">{{ e.name }}</option>
        </select></label>
        <label class="fusion-field"><span>出发场馆</span><select aria-label="出发场馆" :value="venue?.name??''" @change="venueChoice=($event.target as HTMLSelectElement).value; chosenStop=''; focusSerial++">
          <option v-if="!venue" value="">{{ currentEvent&&!currentEvent.venueNames.length?'赛历未登记，手动选择':'选择出发场馆' }}</option>
          <option v-for="v in venueOptions" :key="v.name" :value="v.name">{{ v.name }}</option>
        </select></label>
        <label v-if="tab==='between'" class="fusion-field"><span>比赛间隙</span><select aria-label="比赛间隙" v-model.number="minutes" @change="chosenStop=''; focusSerial++">
          <option v-for="n in [60,90,120,180,240,360]" :key="n" :value="n">{{ n }} 分钟</option>
        </select></label>
        <label v-if="tab==='return'" class="fusion-field"><span>返回城市</span><select aria-label="返回城市" :value="destination?.name??''" @change="changeDestination(($event.target as HTMLSelectElement).value)">
          <option v-if="chosenOrigin&&!chosenOrigin.position" :value="chosenOrigin.name">{{ chosenOrigin.name }}</option>
          <option v-for="city in cityChoices" :key="city.name" :value="city.name">{{ city.name }}</option>
        </select></label>
      </div>
      <section v-if="tab!=='tickets'" ref="stopsContainer" class="fusion-section">
        <div class="fusion-heading"><h3>{{ tab==='between'?'赛间可往返':'沿途可停留' }}</h3><span>{{ stops.length }} 处</span></div>
        <p class="fusion-muted">行程日期 {{ tripDate }}</p>
        <div v-if="tab==='between'" class="fusion-filter" aria-label="游览类型"><button v-for="s in ['全部','景区','温泉']" :key="s" :aria-pressed="kind===s" @click="kind=s; chosenStop=''">{{ s }}</button></div>
        <div v-else class="fusion-filter" aria-label="沿途范围"><button v-for="s in ['全部','京山','荆门','湖北']" :key="s" :aria-pressed="scope===s" @click="scope=s; chosenStop=''">{{ s==='湖北'?'省内其他':s }}</button></div>
        <p v-if="!venue" class="fusion-muted">{{ currentEvent&&!currentEvent.venueNames.length?'这场赛事尚未登记场馆，可手动选择出发场馆。':'选择出发场馆后查看游览地点' }}</p>
        <p v-else-if="tab==='return'&&!destination?.position" class="fusion-muted">选择有位置的返程城市查看沿途景点</p>
        <p v-else-if="!stops.length" class="fusion-muted">{{ tab==='between'?'当前时长内暂无匹配地点':'当前方向暂无匹配地点' }}</p>
        <div v-for="s in stops" :key="s.id" :data-stop-id="s.id" class="fusion-stop" :class="{on:activeStop?.id===s.id}">
          <button :aria-pressed="activeStop?.id===s.id" @click="chooseStop(s.id)">
            <span class="fusion-place-title"><span class="fusion-kind" :class="{hot:s.kind==='温泉'}">{{ s.resourceClass==='乡村旅游点'?'乡村游':s.kind }}</span><strong>{{ s.name }}</strong></span>
            <span class="fusion-place-meta">{{ tab==='between'?'预计往返含游览 '+s.estimatedMinutes+' 分钟':s.city+' · '+(s.detourKm!=null?'经停直线增程 '+km(s.detourKm)+' 公里':'沿途') }}</span>
            <span class="fusion-place-meta">距场馆直线 {{ km(s.distanceKm) }} 公里<span v-if="s.offers.length"> · 票根权益 {{ s.offers.length }} 项</span><span v-if="s.sample"> · 演示点位</span></span>
          </button>
          <div v-if="activeStop?.id===s.id && (s.address||s.operator||s.grade)" class="fusion-stop-offers">
            <div v-if="s.grade">景区等级　{{ s.grade }}</div>
            <div v-if="s.address">{{ s.address }}</div>
            <div v-if="s.operator">运营　{{ s.operator }}</div>
          </div>
          <ul v-if="activeStop?.id===s.id&&s.offers.length" class="fusion-stop-offers"><li v-for="o in s.offers" :key="o.id">{{ o.name }} · {{ o.rule }}<span v-if="o.sample">（演示）</span></li></ul>
        </div>
      </section>
      <section v-else class="fusion-section">
        <div class="fusion-heading"><h3>可用票根权益</h3><span>{{ tripDate }}</span></div>
        <div class="fusion-filter" aria-label="权益范围">
          <button :aria-pressed="ticketScope==='trip'" @click="ticketScope='trip'">{{ activeStop?'当前地点':flowMode==='between'?'赛间地点':'沿途地点' }}</button>
          <button :aria-pressed="ticketScope==='all'" @click="ticketScope='all'">全部权益</button>
        </div>
        <p v-if="ticketScope==='trip'&&activeStop" class="fusion-muted">{{ activeStop.name }}</p>
        <p v-if="!tripTickets.length" class="fusion-muted">{{ ticketScope==='all'?'当前行程日期暂无可用权益':'所选地点暂无可用权益' }}</p>
        <article v-for="o in tripTickets" :key="o.id" class="fusion-ticket">
          <div><strong>{{ o.name }}</strong><span v-if="o.sample" class="fusion-badge">演示</span></div>
          <p>{{ o.merchantName }}</p><p>{{ o.rule }}</p>
          <small v-if="o.validFrom||o.validTo">{{ o.validFrom||'即日起' }} 至 {{ o.validTo||'长期' }}</small>
          <button v-if="onMap(o)" class="fusion-link" @click="locateOffer(o)">地图定位 ›</button>
        </article>
        <button class="industry-button" @click="emit('operations','coupons')">优惠管理</button>
      </section>
      <FusionPackages :datasets="datasets" :date="date" @preview="previewPackage" @manage="(id)=>emit('operations','routes',id,id?'edit':undefined)" />
      <template #actions><button class="industry-button" :disabled="tab==='tickets'?!tripTickets.length:!stops.length" @click="exportTrip">{{ tab==='tickets'?'导出票根权益':'导出当前行程' }}</button></template>
    </IndustryModule>
  </IndustryRail>
</template>

<style src="./fusion-panels.css"></style>
