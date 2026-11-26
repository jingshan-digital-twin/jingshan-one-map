<script setup lang="ts">
import { venueOwnershipGroup } from './venue-ownership.ts'
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { api, jsonRequest } from './api.ts'
import { calendar, coverage, distanceM, eventAssistance, normalizeRules, siteSelection } from './analytics.ts'
import { featureCenter, type CityFeature, type Coordinate, type DataDocument, type DataWorkspace, type PublishedData, type Result } from './types.ts'
import { checkDocument } from './validate.ts'
import { browserUuid } from './browser-uuid.ts'
import { fusionTicketDestinations } from './fusion-itinerary.ts'
import { tourismProviders } from './tourism-providers.ts'
import { publishedCompetitions } from './event-platform-data.ts'

type Panel = 'merchants'|'routes'|'coupons'|'app'|'investment'|'atlas'|'review'|'eventCompare'|'travel'|'urge'
type AppPage = 'home'|'venues'|'events'|'traffic'|'itinerary'|'food'|'coupons'|'tour'
type FormType = 'route'|'offer'

const props = defineProps<{ panel: Panel; published: PublishedData; initialId?: string; initialTab?: string }>()
const emit = defineEmits<{ close: []; published: [value: PublishedData]; locate: [feature: CityFeature]; results: [value: Result[]] }>()
const title: Record<Panel,string> = {
  merchants:'合作商家', routes:'线路套餐', coupons:'优惠活动管理', app:'京网通 · 公众服务端',
  investment:'招商需求清单', atlas:'产业资源清单', review:'用地审查', eventCompare:'场馆比选',
  travel:'发布出行提示', urge:'部门任务催办',
}
const appPages: {id:AppPage; label:string; icon:string; group:AppPage}[] = [
  {id:'home',label:'首页',icon:'⌂',group:'home'},{id:'venues',label:'找场订场',icon:'◎',group:'venues'},
  {id:'events',label:'赛事报名',icon:'★',group:'events'},{id:'traffic',label:'比赛日出行',icon:'→',group:'events'},
  {id:'itinerary',label:'我的行程',icon:'◇',group:'itinerary'},{id:'food',label:'食宿推荐',icon:'♨',group:'itinerary'},
  {id:'coupons',label:'票根优惠',icon:'▣',group:'coupons'},{id:'tour',label:'赛后游',icon:'⌁',group:'itinerary'},
]
const shortcuts = [
  ['打','找场订场','venues',''], ['赛','赛事报名','events',''], ['学','培训约课','food','training'],
  ['训','约教练','food','coach'], ['行','出行停车','traffic',''], ['吃','美食','food','dining'],
  ['住','酒店民宿','food','lodging'], ['游','景区线路','tour',''], ['购','京山好物','food','shopping'],
  ['娱','温泉休闲','tour','spa'],
] as const
const statusByPanel: Partial<Record<Panel,string[]>> = {
  merchants:['已入驻','待审核','未入驻'],
  routes:['已上架','待上架'],
  coupons:['已上架','待审核','已下架'],
}
const data = shallowRef(props.published)
const error = ref('')
const notice = ref('')
const pending = ref(false)
const keyword = ref('')
const statusFilter = ref('')
const selected = ref(props.initialId ?? '')
const page = ref<AppPage>('home')
const appCategory = ref('')
const closeButton = ref<HTMLButtonElement>()
const results = ref<Result[]>([])
const formType = ref<FormType>()
const form = ref({
  id:'', name:'', scope:'京山', destinationId:'', eventId:'', travelMinutes:60, days:1, price:0, itinerary:'',
  destinationMode:'published' as 'published'|'manual', destinationName:'', longitude:'', latitude:'',
  agencyId:'', merchantId:'', rule:'', validFrom:'', validTo:'',
})
const travelText = ref('')
const departments = ref<string[]>([])
const bookings = ref<string[]>(readDemoList('bookings'))
const registrations = ref<string[]>(readDemoList('registrations'))
const claimed = ref<string[]>(readDemoList('claimed'))

const datasets = computed(() => data.value.data.datasets)
const agencies = computed(() => tourismProviders(datasets.value, '旅行社'))
const ticketDestinations = computed(() => fusionTicketDestinations(datasets.value))
const layer = (id:string) => datasets.value.find(item => item.id === id)?.features ?? []
const featuresById = computed(() => new Map(datasets.value.flatMap(item => item.features).map(item => [item.id,item])))
const feature = (id:string) => featuresById.value.get(id)
const events = computed(() => calendar(datasets.value))
const formEvents = computed(() => {
  const legacy = events.value.map(e => ({id:e.id, name:e.properties.name}))
  if (formType.value !== 'offer') return legacy
  const matches = publishedCompetitions(datasets.value).map(e => ({id:e.id, name:e.name}))
  if (!matches.length) return legacy
  const previous = legacy.find(e => e.id === form.value.eventId && !matches.some(current => current.id === e.id))
  return previous ? [previous, ...matches] : matches
})
const defaultRouteVenue = computed(() => layer('venues').find(item => item.id === 'venue-international') ??
  layer('venues').find(item => item.properties.name === '京山国际网球中心'))
const pickedEvent = computed(() => events.value.find(item => item.id === props.initialId) ??
  events.value.find(item => str(item,'status') === '进行中') ??
  events.value.find(item => str(item,'status') === '待举办') ?? events.value.at(-1))
const ruleSet = computed(() => normalizeRules(data.value.data.rules))
const eventResult = computed(() => eventAssistance(datasets.value,pickedEvent.value?.id,undefined,ruleSet.value))
const courts = computed(() => layer('courts'))
const latestVenueOperations = computed(() => {
  const byVenue = new Map<string,CityFeature>()
  for (const operation of layer('venue_operations')) {
    const venue = str(operation,'venueId')
    if (venue && str(operation,'month') > str(byVenue.get(venue),'month')) byVenue.set(venue,operation)
  }
  return byVenue
})
const notices = computed(() => layer('travel_notices').filter(item => str(item,'eventId') === pickedEvent.value?.id))
const publicOffers = computed(() => layer('offers').filter(item => str(item,'status') === '已上架'))
const publicRoutes = computed(() => layer('route_packages').filter(item => str(item,'status') === '已上架'))
const visiblePublicRoutes = computed(() => appCategory.value === 'spa'
  ? publicRoutes.value.filter(item => [item.properties.name,str(item,'location'),str(item,'to')].some(value => value.includes('温泉')))
  : publicRoutes.value)
const specializedMerchants = computed(() => layer('merchants').filter(item =>
  str(item,'status') === '已入驻' && str(item,'category') === (appCategory.value === 'shopping' ? '购物' : '培训机构')))
const venues = computed(() => layer('venues').slice().sort((left,right) => {
  const origin = eventResult.value.position
  const a = featureCenter(left), b = featureCenter(right)
  return origin && a && b ? distanceM(origin,a) - distanceM(origin,b) : 0
}))
const availableVenues = computed(() => venues.value.filter(item => {
  const open = item.properties.open
  return open !== false && !['暂停开放','闭馆'].includes(str(item,'status')) && (freeCourts(item) ?? 0) > 0
}).slice(0,12))
const phoneVenueId=ref('')
const publicVenueList=computed(()=>[...availableVenues.value,...venues.value.filter(v=>!availableVenues.value.some(open=>open.id===v.id))])
function vacancy(item:CityFeature) {
  const count=freeCourts(item)
  return count===undefined ? '预约余量未报送' : '空闲 '+count+' 片'
}
const publicHotels = computed(() => eventResult.value.hotels.slice().sort((left,right) =>
  Number(right.capacity > 0) - Number(left.capacity > 0) || left.distanceM - right.distanceM).slice(0,5))
const publicParking = computed(() => eventResult.value.parking.slice().sort((left,right) => right.capacity-left.capacity).slice(0,5))
const publicRestaurants = computed(() => eventResult.value.food.slice(0,5))
const publicEventOffer = computed(() => publicOffers.value.filter(item => {
  const event = str(item,'eventId')
  const date = str(pickedEvent.value,'date',today())
  return (!event || event === pickedEvent.value?.id) && date >= str(item,'validFrom') && date <= str(item,'validTo','9999-12-31')
}))
const currentAppPage = computed(() => appPages.find(item => item.id === page.value)!)
const publicMapPoints = computed(() => {
  if (page.value === 'venues') return publicVenueList.value.slice(0,4).map(item => ({item,tag:'馆',color:'#0baf73'}))
  if (page.value === 'traffic') return [
    ...(eventResult.value.venue ? [{item:eventResult.value.venue,tag:'赛',color:'#1667dc'}] : []),
    ...publicParking.value.slice(0,3).map(({feature:item}) => ({item,tag:'P',color:'#0baf73'})),
  ]
  return [
    ...(eventResult.value.venue ? [{item:eventResult.value.venue,tag:'赛',color:'#1667dc'}] : []),
    ...publicHotels.value.slice(0,1).map(({feature:item}) => ({item,tag:'住',color:'#e74a88'})),
    ...publicRestaurants.value.slice(0,1).map(({feature:item}) => ({item,tag:'吃',color:'#ed8b13'})),
  ]
})
const mapExtent = [113.06,30.974,113.205,31.077]
const merchantCounts = computed(() => Object.fromEntries(statusByPanel.merchants!.map(status =>
  [status,layer('merchants').filter(item => str(item,'status') === status).length])))
const parcelResults = computed(() => ['review','investment'].includes(props.panel)
  ? siteSelection(datasets.value, coverage(datasets.value,{},ruleSet.value), {courtCount:1},ruleSet.value)
  : undefined)
const parcel = computed(() => parcelResults.value?.candidates.find(item => item.id === selected.value))
const currentParcelReviews = computed(() => results.value.filter(item =>
  item.scene === 'venues' && item.features.some(item => item.id === parcel.value?.feature.id || item.id === parcel.value?.id)))
const eventTasks = computed(() => results.value.filter(item => item.scene === 'events' &&
  item.status !== 'completed' && !item.title.startsWith('催办 ·') &&
  (!props.initialId || item.features.some(feature => feature.id.includes(props.initialId!)) ||
    item.summary.includes(pickedEvent.value?.properties.name ?? '\0'))))
const possibleDepartments = computed(() => [...new Set(eventTasks.value.map(item => item.department))])
const compare = computed(() => venues.value.slice(0,5).map(item => ({
  venue:item, stats:eventAssistance(datasets.value,pickedEvent.value?.id,undefined,ruleSet.value,item.id),
})))
const datasetId = computed(() => ({merchants:'merchants',routes:'route_packages',coupons:'offers'}[props.panel as 'merchants'|'routes'|'coupons']))
const filtered = computed(() => {
  const features = datasetId.value ? layer(datasetId.value)
    : props.panel === 'atlas' ? ['venues','businesses','projects','merchants'].flatMap(layer)
    : []
  const search = keyword.value.trim().toLocaleLowerCase('zh-CN')
  return features.filter(item => {
    if (statusFilter.value && str(item,'status') !== statusFilter.value) return false
    return !search || [item.properties.name,item.properties.region,str(item,'category'),str(item,'scope')]
      .some(value => value.toLocaleLowerCase('zh-CN').includes(search))
  }).sort((a,b) => Number(b.id === props.initialId) - Number(a.id === props.initialId))
})
const shown = ref(36)
watch(() => props.published, value => { data.value = value })
watch([() => props.panel,() => props.initialId,() => props.initialTab], () => reset(), {immediate:true})
watch([keyword,statusFilter], () => { shown.value = 36 })
onMounted(() => {
  if (['review','urge'].includes(props.panel)) void refreshResults()
  closeButton.value?.focus()
})

function str(item:CityFeature|undefined,key:string,fallback='') {
  const value = item?.properties[key]
  return typeof value === 'string' && value.length ? value : fallback
}
function num(item:CityFeature|undefined,key:string,fallback=0) {
  const value = item?.properties[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
const number = new Intl.NumberFormat('zh-CN')
const format = (value:number) => number.format(value)
function shortDate(date:string) { return date ? date.replace(/^\d{4}-/,'').replace('-','月') + '日' : '待定' }
const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date())
function reset() {
  error.value = ''
  notice.value = ''
  keyword.value = ''
  selected.value = props.initialId ?? ''
  formType.value = undefined
  statusFilter.value = statusByPanel[props.panel]?.includes(props.initialTab ?? '') ? props.initialTab! : ''
  page.value = appPages.some(item => item.id === props.initialTab) ? props.initialTab as AppPage : 'home'
  appCategory.value = ''
  if (props.panel === 'routes' && props.initialTab === 'new') editForm('route')
  if (props.panel === 'routes' && props.initialTab === 'edit') {
    const route = layer('route_packages').find(item => item.id === props.initialId)
    if (route) editForm('route',route)
  }
  if (props.panel === 'coupons' && props.initialTab === 'new') editForm('offer')
  if (props.panel === 'travel') {
    const event = pickedEvent.value
    const notice = layer('travel_notices').find(item => str(item,'eventId') === event?.id)
    const current = eventResult.value
    const date = shortDate(str(event,'date'))
    travelText.value = str(notice,'message', event ?
      date + ' ' + str(event,'venue','赛事主场馆') + '周边建议错峰到达。' +
      (current.roadControls.length ? '拟实施临时交通疏导，请按现场指引通行。' : '') +
      (current.parking[0] ? '可优先前往' + current.parking[0].feature.properties.name + '。' : '') : '')
  }
}
function rowDetails(item:CityFeature) {
  if (props.panel === 'merchants') return [
    str(item,'category'),item.properties.region,'本月核销 ' + format(num(item,'redemptions'))+' 次',
    num(item,'rating') > 0 ? num(item,'rating').toFixed(1)+' 分（'+format(num(item,'reviewCount'))+' 条评价）' : '',
  ]
  if (props.panel === 'routes') return [
    str(item,'scope'), [str(item,'from'),str(item,'to',str(item,'location'))].filter(Boolean).join(' → '),
    num(item,'days',1)+'天',num(item,'travelMinutes')+'分钟',
    typeof item.properties.orders === 'number' ? '记录订单 '+format(num(item,'orders'))+' 单' : '',
  ]
  if (props.panel === 'coupons') return [feature(str(item,'merchantId'))?.properties.name ?? '',str(item,'validFrom')+' 至 '+str(item,'validTo'),'核销 '+format(num(item,'redemptions'))+' 次']
  const owner = item.properties.kind==='venue' || item.properties.kind==='court'
    ? venueOwnershipGroup(item.properties.ownership)?.shortLabel??'' : str(item,'ownership')
  return [item.properties.region,str(item,'category',str(item,'type',str(item,'segment'))),owner]
}
function err(exception:unknown) { error.value = exception instanceof Error ? exception.message : '操作未完成，请重试。' }
async function refreshResults() {
  try { results.value = await api<Result[]>('/results') }
  catch (exception) { err(exception) }
}
function update(snapshot: PublishedData) {
  data.value = {data:snapshot.data,version:snapshot.version,publishedAt:snapshot.publishedAt}
  emit('published', data.value)
}
async function changeDocument(mutate:(document:DataDocument) => void, success:string) {
  if (pending.value) return false
  pending.value = true
  notice.value = ''
  error.value = ''
  let saved = false
  try {
    const latest = await api<DataWorkspace>('/admin')
    if (latest.version !== data.value.version) {
      update(latest)
      throw new Error('数据版本已更新，请核对最新记录后重新操作。')
    }
    if (JSON.stringify(latest.draft) !== JSON.stringify(latest.data)) {
      throw new Error('数据中台已有未发布草稿，请先发布或恢复草稿，再操作此记录。')
    }
    const next = structuredClone(latest.data)
    mutate(next)
    checkDocument(next)
    const draft = await api<DataWorkspace>('/admin/draft',jsonRequest('PUT',{revision:latest.revision,data:next}))
    saved = true
    const published = await api<PublishedData>('/admin/publish',jsonRequest('POST',{revision:draft.revision}))
    update(published)
    notice.value = success
    return true
  } catch (exception) {
    err(exception)
    if (saved) error.value += ' 此操作已写入草稿，可在数据中台查看并发布。'
    return false
  } finally { pending.value = false }
}
function changeFeatureStatus(item:CityFeature,nextStatus:string) {
  if (!datasetId.value) return
  const id = datasetId.value
  void changeDocument(document => {
    const found = document.datasets.find(item => item.id === id)?.features.find(current => current.id === item.id)
    if (!found || str(found,'status') !== str(item,'status')) throw new Error('记录状态已变化，请重新打开。')
    if (id === 'offers' && nextStatus === '已上架') {
      const merchantId = str(found,'merchantId')
      const merchant = document.datasets.find(layer => layer.id === 'merchants')?.features.find(item => item.id === merchantId)
      if (!merchant || str(merchant,'status') !== '已入驻') throw new Error('关联商家入驻后才能上架优惠。')
      if (str(found,'validTo') < today()) throw new Error('活动已过有效期，请先调整日期。')
    }
    if (id === 'merchants') Object.assign(found.properties, {
      joined:nextStatus === '已入驻', reviewStatus:nextStatus === '已入驻' ? '审核通过' : '审核退回',
      reviewedAt:today(), joinedAt:nextStatus === '已入驻' ? today() : '',
    })
    found.properties.status = nextStatus
  },'已更新「'+item.properties.name+'」为'+nextStatus+'。')
}
function routeDestination(item:CityFeature): Coordinate | null {
  const { geometry } = item
  const point = geometry.type === 'LineString' ? geometry.coordinates.at(-1)
    : geometry.type === 'MultiLineString' ? geometry.coordinates.findLast(path => path.length)?.at(-1) : undefined
  return point ? [point[0],point[1]] : featureCenter(item)
}
function routeStart(eventId: string) {
  const event = events.value.find(item => item.id === eventId)
  const venue = event ? layer('venues').find(item => item.id === str(event,'venueId')) : defaultRouteVenue.value
  const position = (venue && featureCenter(venue)) ?? (event && featureCenter(event))
  return { position, name: venue?.properties.name ?? str(event,'venue'), region: venue?.properties.region ?? event?.properties.region }
}
const routeStartName = computed(() => {
  const existing = feature(form.value.id)
  return (existing && form.value.eventId === str(existing,'eventId') ? str(existing,'from') : '') ||
    routeStart(form.value.eventId).name || '请选择有关联场馆的赛事'
})
function editForm(type:FormType,item?:CityFeature) {
  formType.value = type
  const itinerary = item?.properties.itinerary
  const destinationId = str(item,'destinationId')
  const center = type === 'route' && item ? routeDestination(item) : null
  form.value = {
    id:item?.id ?? '',name:item?.properties.name ?? '',scope:str(item,'scope','京山'),
    destinationId,eventId:str(item,'eventId'),travelMinutes:num(item,'travelMinutes',60),
    destinationMode:item && !feature(destinationId) ? 'manual' : 'published',
    destinationName:str(item,'to',str(item,'location',item?.properties.name)),
    longitude:center ? String(center[0]) : '',latitude:center ? String(center[1]) : '',
    days:num(item,'days',1),price:num(item,'price'),itinerary:Array.isArray(itinerary) ? itinerary.join('\n') : str(item,'itinerary'),
    agencyId:str(item,'agencyId'),merchantId:str(item,'merchantId'),rule:str(item,'rule'),validFrom:str(item,'validFrom'),validTo:str(item,'validTo'),
  }
}
async function submitForm() {
  const current = {...form.value}
  const type = formType.value
  const name = current.name.trim()
  if (!name || !type) return
  const id = type === 'route' ? 'route_packages' : 'offers'
  const existing = current.id ? feature(current.id) : undefined
  let geometry: CityFeature['geometry']
  let region: string
  let values: Record<string,unknown>
  if (type === 'route') {
    const manual = current.destinationMode === 'manual'
    const destinationId = manual ? '' : current.destinationId
    const destination = feature(destinationId)
    const site = ticketDestinations.value.find(item => item.id === destinationId)
    let center = site?.position ?? (destination && featureCenter(destination))
    let to = site?.name ?? destination?.properties.name
    if (manual) {
      const longitude = Number(current.longitude), latitude = Number(current.latitude)
      if (!current.destinationName.trim() || !current.longitude.trim() || !current.latitude.trim() ||
          !Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < 73 || longitude > 136 || latitude < 18 || latitude > 54) {
        error.value = '请填写终点名称和 WGS84 经纬度。经度范围为 73° 至 136°，纬度范围为 18° 至 54°。'
        return
      }
      center = [longitude,latitude]
      to = current.destinationName.trim()
    }
    if (!center || !to) { error.value = '请选择有地图坐标的已发布目的地。'; return }
    const end = existing && routeDestination(existing)
    const sameManualDestination = manual && end?.[0] === center[0] && end?.[1] === center[1]
    const retainGeometry = existing && current.eventId === str(existing,'eventId') &&
      (manual ? sameManualDestination : destinationId === str(existing,'destinationId'))
    const start = routeStart(current.eventId)
    if (retainGeometry) geometry = existing.geometry
    else {
      if (!start.position) { error.value = '请关联已登记场馆的赛事，或在后台补录该赛事的位置。'; return }
      geometry = {type:'LineString',coordinates:[start.position,center]}
    }
    region = destination?.properties.region ?? existing?.properties.region ?? start.region ?? '京山市'
    const from = (retainGeometry ? str(existing,'from') : '') || start.name || '京山赛事场馆'
    values = {
      scope:current.scope,destinationId,agencyId:current.agencyId,from,to,location:to,travelMinutes:current.travelMinutes,days:current.days,
      price:current.price,itinerary:current.itinerary.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
    }
  } else {
    const merchant = feature(current.merchantId)
    const destination = ticketDestinations.value.find(site => site.id === current.destinationId)
    if (current.destinationId && !destination) { error.value = '请选择已发布的游览地。'; return }
    const center = destination?.position ?? (merchant && featureCenter(merchant))
    if (!merchant || !center) { error.value = '请选择有地图坐标的商家。'; return }
    if (current.validFrom > current.validTo) { error.value = '结束日期需不早于开始日期。'; return }
    geometry = existing && current.merchantId === str(existing,'merchantId') && current.destinationId === str(existing,'destinationId') && current.eventId === str(existing,'eventId')
      ? existing.geometry : {type:'Point',coordinates:center}
    region = destination?.city ?? merchant.properties.region
    values = { merchantId:current.merchantId,merchantName:merchant.properties.name,category:str(merchant,'category'),
      destinationId:current.destinationId, rule:current.rule.trim(),validFrom:current.validFrom,validTo:current.validTo }
  }
  const item:CityFeature = {
    type:'Feature', id:existing?.id ?? id+'-'+browserUuid(), geometry,
    properties:{
      ...(existing?.properties ?? {}), ...values,
      name,region,kind:type === 'route' ? 'route_package' : 'offer',
      eventId:current.eventId,status:str(existing,'status',type === 'route' ? '待上架' : '待审核'),
    },
  }
  const success = await changeDocument(document => {
    const target = document.datasets.find(item => item.id === id)
    if (!target) throw new Error('请先在数据中台配置对应数据集。')
    const index = target.features.findIndex(item => item.id === existing?.id)
    if (existing && index < 0) throw new Error('记录已删除。')
    if (index < 0) target.features.push(item)
    else target.features[index] = item
  },'已保存「'+name+'」。')
  if (success) { formType.value = undefined; selected.value = item.id }
}
async function publishTravel() {
  const event = pickedEvent.value
  if (!event || !travelText.value.trim()) return
  const position = eventResult.value.position ?? featureCenter(event)
  if (!position) { error.value = '赛事缺少场馆位置。'; return }
  const featureId = 'travel-notice-'+event.id
  const message = travelText.value.trim()
  const record:CityFeature = {
    type:'Feature',id:featureId,geometry:{type:'Point',coordinates:position},properties:{
      kind:'travel-notice',name:event.properties.name+' · 出行提示',region:event.properties.region,eventId:event.id,
      date:str(event,'date'),message,publishedAt:new Date().toISOString(),
    },
  }
  await changeDocument(document => {
    let target = document.datasets.find(item => item.id === 'travel_notices')
    if (!target) {
      target = {id:'travel_notices',name:'赛事出行提示',department:'文旅局',category:'赛事服务',description:'京网通公众服务端已发布的赛事出行提示。',features:[]}
      document.datasets.push(target)
    }
    target.features = [...target.features.filter(item => item.id !== featureId),record]
  },'出行提示已发布到本机京网通预览。')
}
async function recordResult(value:Pick<Result,'scene'|'department'|'title'|'summary'|'features'>) {
  return api<Result>('/results',jsonRequest('POST',{...value,version:data.value.version}))
}
async function submitReview() {
  if (!parcel.value || pending.value) return
  const item = parcel.value
  pending.value = true
  error.value = ''
  try {
    const row = await recordResult({
      scene:'venues',department:'自然资源和规划局',title:'用地审查 · '+item.name,
      summary:[item.name,format(item.area)+'平方米',item.compliant ? '模型初筛符合条件，待主管部门复核' : item.reason || '模型初筛未通过',item.use].join(' · '),
      features:[item.feature],
    })
    results.value.unshift(row)
    emit('results',[row])
    notice.value = '已提交本地用地审查任务。'
  } catch (exception) { err(exception) } finally { pending.value = false }
}
async function urgeTasks() {
  if (!departments.value.length || pending.value) return
  pending.value = true
  error.value = ''
  const event = pickedEvent.value
  try {
    const items = departments.value.map(department => ({
      scene:'events',department,title:'催办 · '+(event?.properties.name ?? '赛事保障'),
      summary:'请复核待办赛事保障任务，更新办理进度。',features:event ? [event] : [],
    }))
    const rows = await api<Result[]>('/results/batch',jsonRequest('POST',{version:data.value.version,items}))
    results.value.unshift(...rows)
    emit('results',rows)
    departments.value = []
    notice.value = '已登记 '+rows.length+' 条本地催办。'
  } catch (exception) { err(exception) } finally { pending.value = false }
}
function freeCourts(item:CityFeature) {
  const explicit = item.properties.availableCourts ?? item.properties.freeCourts ??
    latestVenueOperations.value.get(item.id)?.properties.freeCourts
  if (typeof explicit === 'number') return Math.max(0,Math.floor(explicit))
  return undefined
}
function mapPin(item:CityFeature) {
  const center = featureCenter(item)
  if (!center) return {display:'none'}
  const [west,south,east,north] = mapExtent
  const left = 100 * (center[0]-west) / (east-west)
  const top = 100 * (north-center[1]) / (north-south)
  if (left < 3 || left > 97 || top < 4 || top > 96) return {display:'none'}
  return {left:left+'%',top:top+'%'}
}
function readDemoList(key:string) {
  try {
    const list:unknown = JSON.parse(localStorage.getItem('jingshan-v3-preview-'+key) ?? '[]')
    return Array.isArray(list) ? list.filter((item):item is string => typeof item === 'string') : []
  } catch { return [] }
}
function remember(list:string[],key:string,id:string) {
  const next = [...new Set([...list,id])]
  try { localStorage.setItem('jingshan-v3-preview-'+key,JSON.stringify(next)) } catch { /* Preview still works in memory. */ }
  return next
}
function book(venue:CityFeature) {
  bookings.value = remember(bookings.value,'bookings',venue.id)
  notice.value = '已记录本机试订 · '+venue.properties.name
}
function register(event:CityFeature) {
  registrations.value = remember(registrations.value,'registrations',event.id)
  notice.value = '已生成本机演示参赛凭证。'
  page.value = 'events'
}
function claim(offer:CityFeature) {
  claimed.value = remember(claimed.value,'claimed',offer.id)
  notice.value = '已领取演示优惠 · '+offer.properties.name
}
function switchApp(id:AppPage,category='') {
  notice.value = ''
  page.value = id
  appCategory.value = category
}
</script>

<template>
  <div class="modal-scrim" @click.self="!pending && emit('close')" @keydown.esc.stop="!pending && emit('close')">
    <section class="modal-box v3-operations" :class="{'is-public':panel === 'app'}" role="dialog" aria-modal="true" :aria-label="title[panel]">
      <header class="modal-title">
        <div><p>{{ panel === 'app' ? '本机演示' : '京山网球产业一张图 · V'+data.version }}</p><h2>{{ title[panel] }}</h2></div>
        <button ref="closeButton" type="button" :disabled="pending" aria-label="关闭操作窗口" @click="emit('close')">×</button>
      </header>
      <div v-if="error" class="op-error" role="alert">{{ error }}</div>
      <div v-if="notice" class="op-notice" role="status">{{ notice }}</div>

      <template v-if="panel === 'app'">
        <div class="phone">
          <header class="phone-header">
            <button v-if="page !== 'home'" type="button" class="phone-back" aria-label="返回京网通首页" @click="switchApp('home')">←</button>
            <div><h3>{{ page === 'home' ? '京网通' : currentAppPage.label }}</h3>
            <span>{{ page === 'home' ? '打球 · 参赛 · 游京山' : pickedEvent?.properties.name }}</span></div>
          </header>
          <div class="phone-content" :key="page">
            <template v-if="page === 'home'">
              <div class="phone-shortcuts">
                <button v-for="[icon,label,id,category] in shortcuts" :key="label" type="button" @click="switchApp(id,category)">
                  <i aria-hidden="true">{{ icon }}</i>{{ label }}
                </button>
              </div>
              <article v-if="pickedEvent" class="phone-card feature-card">
                <small>近期赛事</small><h4>{{ pickedEvent.properties.name }}</h4>
                <p>{{ shortDate(str(pickedEvent,'date')) }} · {{ str(pickedEvent,'venue') }}</p>
                <button type="button" @click="switchApp('events')">参赛服务包</button>
              </article>
              <article class="phone-card">
                <h4>附近空场</h4>
                <div v-for="item in availableVenues.slice(0,3)" :key="item.id" class="phone-row">
                  <div><b>{{ item.properties.name }}</b><small>{{ item.properties.region }} · {{ vacancy(item) }}</small></div>
                  <button type="button" @click="switchApp('venues')">查看</button>
                </div>
                <p v-if="!availableVenues.length">暂无已确认的空闲场地记录。</p>
              </article>
            </template>
            <template v-if="['venues','traffic','itinerary'].includes(page)">
              <div v-if="page === 'venues' && venues.length" class="phone-info">全市 {{ courts.length }} 片场地 · 已登记 {{ venues.length }} 处场馆</div>
              <div v-if="page === 'traffic'" class="phone-info" role="status">
                {{ notices.length ? str(notices[0],'message') : '该赛事暂无已发布的出行提示。下方显示本机测算的停车资源。' }}
              </div>
              <div class="phone-map">
                <img src="/jingshan/eox2016-city.jpg" alt="京山城区影像" />
                <span v-for="{item,tag,color} in publicMapPoints" :key="item.id" :style="{...mapPin(item),background:color}" :title="item.properties.name">{{ tag }}</span>
              </div>
            </template>
            <template v-if="page === 'venues'">
              <article class="phone-card">
                <h4>场馆资源</h4>
                <template v-for="item in publicVenueList" :key="item.id">
                <div class="phone-row">
                  <div><b>{{ item.properties.name }}</b><small>{{ item.properties.region }} · {{ vacancy(item) }}</small></div>
                  <button v-if="(freeCourts(item) ?? 0)>0" type="button" :disabled="bookings.includes(item.id)" @click="book(item)">{{ bookings.includes(item.id) ? '已试订' : '试订' }}</button><button v-else type="button" :aria-expanded="phoneVenueId===item.id" @click="phoneVenueId=phoneVenueId===item.id?'':item.id">场馆详情</button>
                </div>
                <div v-if="phoneVenueId===item.id" class="phone-card"><h4>{{item.properties.name}}</h4><p>{{item.properties.region}} · {{item.properties.count}} 片</p><p>运营单位　{{item.properties.operator || '未填'}}</p><p>开放方式　{{item.properties.openMode || '未填'}}</p></div>
                </template>
                <p v-if="!publicVenueList.length">暂无已登记场馆。</p>
              </article>
            </template>
            <template v-else-if="page === 'events'">
              <article v-if="pickedEvent" class="phone-card">
                <h4>{{ pickedEvent.properties.name }}</h4>
                <p>{{ shortDate(str(pickedEvent,'date')) }} · {{ str(pickedEvent,'venue') }}</p>
                <p v-if="registrations.includes(pickedEvent.id)" class="phone-success">演示报名成功 · 凭证 {{ pickedEvent.id.slice(-12).toUpperCase() }}</p>
                <button v-else-if="str(pickedEvent,'status') !== '已办结'" type="button" @click="register(pickedEvent)">试报名</button>
              </article>
              <article class="phone-card">
                <h4>参赛服务包</h4>
                <div v-for="[id,label,description] in [['traffic','比赛日出行提示','停车和疏导信息'],['itinerary','我的行程','比赛、用餐、住宿'],['coupons','票根优惠','合作商家已上架活动'],['tour','赛后游','浏览已上架线路']] as const" :key="id" class="phone-row">
                  <div><b>{{ label }}</b><small>{{ description }}</small></div>
                  <button type="button" @click="switchApp(id)">查看</button>
                </div>
              </article>
            </template>
            <template v-else-if="page === 'traffic'">
              <article class="phone-card">
                <h4>停车和接驳</h4>
                <div v-for="item in publicParking" :key="item.feature.id" class="phone-row">
                  <div><b>{{ item.feature.properties.name }}</b><small>距场馆 {{ format(item.distanceM) }} 米</small></div>
                  <span>{{ format(item.capacity) }} 泊位</span>
                </div>
                <p v-if="!publicParking.length">暂无停车数据。</p>
              </article>
              <article v-if="eventResult.roadControls.length" class="phone-card">
                <h4>交通疏导测算</h4>
                <div v-for="item in eventResult.roadControls.slice(0,4)" :key="item.id" class="phone-row">
                  <b>{{ item.properties.name }}</b><span>{{ str(item,'action') }}</span>
                </div>
              </article>
            </template>
            <template v-else-if="page === 'itinerary'">
              <article class="phone-card">
                <h4>{{ shortDate(str(pickedEvent,'date')) }} · 比赛日参考行程</h4>
                <ol class="phone-agenda">
                  <li><time>09:00</time><b>赛事报到</b><small>{{ str(pickedEvent,'venue','查看赛事场地') }}</small></li>
                  <li v-if="publicRestaurants.length"><time>12:00</time><b>午餐 · {{ publicRestaurants[0].feature.properties.name }}</b></li>
                  <li v-if="publicRoutes.length"><time>15:00</time><b>{{ publicRoutes[0].properties.name }}</b></li>
                  <li v-if="publicHotels.length"><time>18:30</time><b>住宿参考 · {{ publicHotels[0].feature.properties.name }}</b></li>
                </ol>
                <button type="button" @click="switchApp('food')">查看食宿</button>
              </article>
            </template>
            <template v-else-if="page === 'food'">
              <article v-if="['training','coach','shopping'].includes(appCategory)" class="phone-card">
                <h4>{{ appCategory === 'shopping' ? '京山好物' : appCategory === 'coach' ? '教练服务机构' : '网球培训机构' }}</h4>
                <div v-for="item in specializedMerchants.slice(0,10)" :key="item.id" class="phone-row">
                  <div><b>{{ item.properties.name }}</b><small>{{ item.properties.region }} · {{ str(item,'category') }}</small></div>
                  <span>{{ num(item,'rating') ? num(item,'rating')+' 分' : '已入驻' }}</span>
                </div>
                <p v-if="!specializedMerchants.length">暂无入驻商家。</p>
              </article>
              <article v-if="!appCategory || appCategory === 'lodging'" class="phone-card">
                <h4>住</h4>
                <div v-for="item in publicHotels" :key="item.feature.id" class="phone-row">
                  <div><b>{{ item.feature.properties.name }}</b><small>{{ item.feature.properties.region }} · {{ format(item.distanceM) }} 米</small></div>
                  <span>{{ item.capacity ? '可供 '+item.capacity+' 床' : '已满' }}</span>
                </div>
                <p v-if="!publicHotels.length">暂无住宿数据。</p>
              </article>
              <article v-if="!appCategory || appCategory === 'dining'" class="phone-card">
                <h4>吃</h4>
                <div v-for="item in publicRestaurants" :key="item.feature.id" class="phone-row">
                  <div><b>{{ item.feature.properties.name }}</b><small>距场馆 {{ format(item.distanceM) }} 米</small></div>
                  <span>{{ str(item.feature,'grade','等级待补') }}</span>
                </div>
                <p v-if="!publicRestaurants.length">暂无餐饮数据。</p>
              </article>
            </template>
            <template v-else-if="page === 'coupons'">
              <article class="phone-card feature-card offer-card">
                <h4>我的参赛服务</h4><p>{{ pickedEvent?.properties.name }}</p>
                <p>{{ pickedEvent && registrations.includes(pickedEvent.id) ? '演示凭证 · '+pickedEvent.id.slice(-12).toUpperCase() : '可从赛事页试报名，生成本机演示凭证。' }}</p>
              </article>
              <article class="phone-card">
                <h4>已上架票根优惠</h4>
                <div v-for="item in publicEventOffer" :key="item.id" class="phone-row">
                  <div><b>{{ item.properties.name }}</b><small>{{ str(item,'rule') }} · {{ shortDate(str(item,'validTo')) }}截止</small></div>
                  <button type="button" :disabled="claimed.includes(item.id)" @click="claim(item)">{{ claimed.includes(item.id) ? '已领取' : '试领取' }}</button>
                </div>
                <p v-if="!publicEventOffer.length">当前赛事暂无票根优惠。</p>
              </article>
            </template>
            <template v-else-if="page === 'tour'">
              <article v-for="item in visiblePublicRoutes" :key="item.id" class="phone-card tour-card">
                <small>{{ str(item,'scope') }} · {{ num(item,'days',1) }}日游</small>
                <h4>{{ item.properties.name }}</h4>
                <p>预计车程 {{ num(item,'travelMinutes') }} 分钟 · {{ format(num(item,'price')) }} 元</p>
                <details><summary>查看行程</summary>
                  <ol v-if="Array.isArray(item.properties.itinerary)"><li v-for="(stop,index) in item.properties.itinerary" :key="index">{{ stop }}</li></ol>
                </details>
              </article>
              <article v-if="!visiblePublicRoutes.length" class="phone-card">暂无已上架线路。</article>
            </template>
          </div>
          <nav class="phone-nav" aria-label="京网通底部导航">
            <button v-for="[id,label,icon] in [['home','首页','⌂'],['venues','订场','◎'],['events','赛事','★'],['itinerary','行程','◇'],['coupons','我的','◉']] as const"
              :key="id" type="button" :class="{active:currentAppPage.group === id}" @click="switchApp(id)"><i aria-hidden="true">{{ icon }}</i>{{ label }}</button>
          </nav>
        </div>
      </template>

      <template v-else-if="['merchants','routes','coupons','atlas'].includes(panel)">
        <div v-if="panel === 'merchants'" class="op-kpis">
          <div v-for="status in statusByPanel.merchants" :key="status"><span>{{ status }}</span><b>{{ merchantCounts[status] }}</b></div>
        </div>
        <div class="op-tools">
          <input v-model="keyword" type="search" aria-label="搜索记录" placeholder="搜索名称、片区或分类" />
          <select v-if="statusByPanel[panel]" v-model="statusFilter" aria-label="筛选状态">
            <option value="">全部状态</option><option v-for="status in statusByPanel[panel]" :key="status">{{ status }}</option>
          </select>
          <button v-if="panel === 'routes' || panel === 'coupons'" type="button" class="primary" @click="editForm(panel === 'routes' ? 'route' : 'offer')">
            {{ panel === 'routes' ? '新增线路' : '新增优惠' }}
          </button>
        </div>
        <div v-if="formType" class="op-editor">
          <form @submit.prevent="submitForm">
            <div class="op-editor-title"><h3>{{ form.id ? '编辑' : '新增' }}{{ formType === 'route' ? '线路' : '优惠' }}</h3><button type="button" @click="formType = undefined">取消</button></div>
            <div class="op-fields">
              <label>名称<input v-model.trim="form.name" maxlength="120" required /></label>
              <label>关联赛事<select v-model="form.eventId"><option value="">全部赛事</option><option v-for="event in formEvents" :key="event.id" :value="event.id">{{ event.name }}</option></select></label>
              <template v-if="formType === 'route'">
                <label>线路范围<select v-model="form.scope"><option>京山</option><option>荆门</option><option>湖北</option></select></label>
                <label>承接旅行社<select v-model="form.agencyId"><option value="">未指定</option><option v-for="agency in agencies" :key="agency.id" :value="agency.id">{{ agency.properties.name }}</option></select></label>
                <label>出发场馆<input :value="routeStartName" readonly /></label>
                <label>终点来源<select v-model="form.destinationMode"><option value="published">选择已发布目的地</option><option value="manual">填写名称和坐标</option></select></label>
                <label v-if="form.destinationMode === 'published'">目的地<select v-model="form.destinationId" required>
                  <option value="">选择目的地</option>
                  <option v-if="form.destinationId && feature(form.destinationId) && !ticketDestinations.some(item => item.id === form.destinationId)" :value="form.destinationId">{{ feature(form.destinationId)?.properties.name }}</option>
                  <option v-for="item in ticketDestinations" :key="item.id" :value="item.id">{{ item.city }} · {{ item.name }}</option>
                </select></label>
                <template v-else>
                  <label>终点名称<input v-model.trim="form.destinationName" maxlength="120" required /></label>
                  <label>终点经度（WGS84）<input v-model.trim="form.longitude" inputmode="decimal" placeholder="如 112.61" required /></label>
                  <label>终点纬度（WGS84）<input v-model.trim="form.latitude" inputmode="decimal" placeholder="如 31.21" required /></label>
                </template>
                <label>预计车程（分钟）<input v-model.number="form.travelMinutes" type="number" min="1" max="1440" required /></label>
                <label>行程天数<input v-model.number="form.days" type="number" min="1" max="30" required /></label>
                <label>参考价格（元）<input v-model.number="form.price" type="number" min="0" max="99999" step=".01" required /></label>
                <label class="op-wide">行程（每行一站）<textarea v-model.trim="form.itinerary" rows="3" maxlength="600" required></textarea></label>
              </template>
              <template v-else>
                <label>合作商家<select v-model="form.merchantId" required><option value="">选择商家</option>
                  <option v-for="item in layer('merchants').filter(item => str(item,'status') === '已入驻' || item.id === form.merchantId)" :key="item.id" :value="item.id">{{ item.properties.name }}</option>
                </select></label>
                <label>适用游览地<select v-model="form.destinationId">
                  <option value="">商户自身</option>
                  <option v-for="site in ticketDestinations" :key="site.id" :value="site.id">{{ site.city }} · {{ site.name }}</option>
                </select></label>
                <label>优惠规则<input v-model.trim="form.rule" maxlength="220" required /></label>
                <label>开始日期<input v-model="form.validFrom" type="date" required /></label>
                <label>结束日期<input v-model="form.validTo" type="date" required /></label>
              </template>
            </div>
            <button type="submit" class="primary" :disabled="pending">保存{{ formType === 'route' ? '线路' : '优惠' }}</button>
          </form>
        </div>
        <div class="op-list" :aria-label="title[panel]+'记录'">
          <article v-for="item in filtered.slice(0,shown)" :key="item.id" class="op-row" :class="{chosen:item.id === selected}">
            <div>
              <h3>{{ item.properties.name }} <span v-if="str(item,'status')" class="op-pill">{{ str(item,'status') }}</span></h3>
              <p>{{ rowDetails(item).filter(Boolean).join(' · ') }}</p>
              <p v-if="panel === 'coupons'">{{ str(item,'rule') }}</p>
            </div>
            <div class="op-actions">
              <button type="button" @click="selected = item.id; emit('locate',item)">定位</button>
              <template v-if="panel === 'merchants' && str(item,'status') === '待审核'">
                <button type="button" class="primary" :disabled="pending" @click="changeFeatureStatus(item,'已入驻')">通过</button>
                <button type="button" :disabled="pending" @click="changeFeatureStatus(item,'未入驻')">退回</button>
              </template>
              <template v-if="panel === 'routes' || panel === 'coupons'">
                <button type="button" @click="editForm(panel === 'routes' ? 'route' : 'offer',item)">编辑</button>
                <button v-if="str(item,'status') !== '已上架'" type="button" class="primary" :disabled="pending" @click="changeFeatureStatus(item,'已上架')">上架</button>
                <button v-else type="button" :disabled="pending" @click="changeFeatureStatus(item,panel === 'routes' ? '待上架' : '已下架')">下架</button>
              </template>
            </div>
          </article>
          <p v-if="!filtered.length" class="op-empty">当前筛选条件下暂无记录。</p>
          <button v-if="shown < filtered.length" type="button" @click="shown += 36">加载更多（{{ filtered.length - shown }} 条）</button>
        </div>
        <footer class="op-footer">共 {{ filtered.length }} 条记录 <span v-if="panel !== 'atlas'">业务操作保存后生成新的发布版本。</span></footer>
      </template>

      <template v-else-if="panel === 'review' || panel === 'investment'">
        <div class="op-list">
          <div v-if="parcel" class="op-highlight">
            <b>{{ parcel.name }}</b>
            <p>{{ format(parcel.area) }} 平方米 · {{ parcel.use }} · {{ parcel.ownership }}</p>
            <p>{{ parcel.compliant ? '模型初筛符合用地条件，待主管部门复核' : parcel.reason }}</p>
            <p v-if="currentParcelReviews[0]">最近审查记录 · {{ currentParcelReviews[0].status === 'completed' ? '已办理' : currentParcelReviews[0].status === 'received' ? '办理中' : '待接收' }}</p>
          </div>
          <article v-for="item in (parcelResults?.candidates ?? []).slice(0,18)" :key="item.id" class="op-row" :class="{chosen:item.id === selected}">
            <div><h3>{{ item.name }}</h3><p>{{ item.area }} 平方米 · 推荐度 {{ item.score }} · {{ item.compliant ? '模型初筛符合条件' : item.reason }}</p></div>
            <div class="op-actions"><button type="button" @click="selected = item.id">查看</button><button type="button" @click="emit('locate',item.feature)">定位</button></div>
          </article>
          <p v-if="!parcelResults?.candidates.length" class="op-empty">暂无候选地块。</p>
        </div>
        <footer class="op-footer" v-if="panel === 'review'">
          <button type="button" class="primary" :disabled="!parcel || pending || currentParcelReviews.some(item => item.status !== 'completed')" @click="submitReview">提交用地审查</button>
        </footer>
      </template>

      <template v-else-if="panel === 'eventCompare'">
        <div class="op-list">
          <p class="op-empty">{{ pickedEvent?.properties.name ?? '当前赛事' }} · 相同赛事规模下的停车、床位和医疗测算</p>
          <article v-for="{venue,stats} in compare" :key="venue.id" class="op-row">
            <div><h3>{{ venue.properties.name }}</h3><p>停车供给 {{ stats.parkingSupply }} · 停车缺口 {{ stats.parkingGap }} · 床位缺口 {{ stats.lodgingGap }} · 急救医院预计到达 {{ stats.hospitalMinutes == null ? '待核实' : stats.hospitalMinutes + ' 分钟' }}</p></div>
            <button type="button" @click="emit('locate',venue)">定位场馆</button>
          </article>
          <p v-if="!compare.length" class="op-empty">暂无场馆数据。</p>
        </div>
      </template>

      <template v-else-if="panel === 'travel'">
        <form class="op-list op-travel" @submit.prevent="publishTravel">
          <p>{{ pickedEvent?.properties.name ?? '暂无赛事' }} · {{ shortDate(str(pickedEvent,'date')) }}</p>
          <label>出行提示正文<textarea v-model.trim="travelText" rows="7" maxlength="800" required></textarea></label>
          <button class="primary" type="submit" :disabled="pending || !pickedEvent">发布到本机京网通</button>
        </form>
      </template>

      <template v-else-if="panel === 'urge'">
        <div class="op-list">
          <p class="op-empty">{{ pickedEvent?.properties.name ?? '赛事保障' }} · 选择需要催办的部门</p>
          <label v-for="department in possibleDepartments" :key="department" class="op-checkbox">
            <input v-model="departments" type="checkbox" :value="department" />{{ department }}
            <span>{{ eventTasks.filter(item => item.department === department).length }} 项未办结</span>
          </label>
          <p v-if="!possibleDepartments.length" class="op-empty">当前赛事暂无需要催办的任务。</p>
        </div>
        <footer class="op-footer"><button type="button" class="primary" :disabled="pending || !departments.length" @click="urgeTasks">登记催办</button></footer>
      </template>
    </section>
  </div>
</template>

<style scoped>
.v3-operations { width: min(64rem, 100%); min-height: 0; }
.v3-operations.is-public { width: min(28rem, 100%); }
.op-kpis { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: .55em; }
.op-kpis > div {
  display: grid; gap: .2em; justify-items: center; padding: .65em .4em;
  border: 1px solid #326eb4; background: linear-gradient(170deg,#215498,#173f81);
}
.op-kpis b { color: #49dafe; font-size: 1.65em; }
.op-tools { display: grid; grid-template-columns: minmax(8rem,1fr) minmax(7rem,auto) auto; gap: .55em; }
.op-list { display: grid; align-content: start; gap: .45em; overflow: auto; min-height: 5rem; scrollbar-color: #4a71a9 transparent; }
.op-row {
  display: flex; justify-content: space-between; align-items: center; gap: .75em;
  padding: .58em .68em; border: 1px solid #2f5992; background: #12346b;
}
.op-row.chosen { border-color: #32cffa; background: #164278; }
.op-row h3 { margin: 0 0 .32em; font-size: 1em; font-weight: 700; }
.op-row p, .op-highlight p { color: #a7c5ec; font-size: .84em; line-height: 1.45; overflow-wrap: anywhere; }
.op-actions { display: flex; justify-content: end; flex-wrap: wrap; gap: .35em; flex-shrink: 0; }
.op-actions button { padding: .35em .54em; font-size: .84em; }
.op-pill { display: inline-flex; margin-left: .35em; padding: .08em .34em; color: #78dffb; border: 1px solid #4386c1; font-size: .72em; white-space: nowrap; }
.op-footer { display: flex; justify-content: space-between; align-items: center; gap: .75em; color: #97b6e0; font-size: .86em; }
.op-empty { color: #acd0f6; padding: .5em; line-height: 1.45; }
.op-editor, .op-highlight, .op-error, .op-notice { padding: .75em; border: 1px solid #3278b9; background: #143b74; }
.op-editor { flex-shrink: 0; }
.op-editor-title { display: flex; align-items: center; justify-content: space-between; }
.op-editor-title h3 { margin: 0; font-size: 1.05em; }
.op-editor form, .op-travel { display: grid; gap: .65em; }
.op-editor form > button, .op-travel button { justify-self: start; }
.op-fields { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: .55em; }
.op-wide { grid-column: 1 / -1; }
.op-highlight b { color: #ffd054; }
.op-error { border-color: #b45164; background: #512a47; color: #ffc1c5; }
.op-notice { border-color: #349c82; background: #143f50; color: #a1f4c8; }
.v3-operations .op-checkbox { display: flex; gap: .7em; align-items: center; padding: .6em; border: 1px solid #325583; }
.op-checkbox span { margin-left: auto; color: #a6c6ed; }

.phone {
  display: grid; grid-template-rows: auto minmax(0,1fr) auto; height: min(72dvh,45rem); min-height: 16rem;
  border: 3px solid #315b9b; border-radius: 1.18rem; overflow: hidden; background: #f1f4f8; color: #19273e;
  font-size: clamp(.88rem,.94vw,1rem);
}
.phone-header { display: flex; align-items: center; gap: .65em; background: #1666de; color: #fff; padding: .75em .85em; }
.phone-header h3 { margin: 0 0 .18em; font-size: 1.22em; }
.phone-header span { color: #edf5ff; font-size: .85em; }
.phone-content { overflow-y: auto; padding: .65em; display: grid; align-content: start; gap: .58em; }
.phone-card, .phone-shortcuts { padding: .7em .8em; border-radius: .8em; background: white; box-shadow: 0 2px 7px #29385116; }
.phone-card h4 { margin: 0 0 .4em; font-size: 1em; }
.phone-card p, .phone-card small { margin: .26em 0; color: #536786; line-height: 1.4; }
.phone-card small { display: block; font-size: .8em; }
.phone-shortcuts { display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); gap: .6em .25em; }
.v3-operations .phone button { padding: .34em .65em; border: 1px solid transparent; border-radius: 999px; background: #1666de; color: white; font-weight: 600; font-size: .82em; }
.v3-operations .phone .phone-back { font-size: 1.2em; padding: .15em .32em; background: #205ab7; }
.v3-operations .phone .phone-shortcuts button { display: grid; gap: .35em; justify-items: center; padding: 0; background: white; color: #243653; white-space: nowrap; font-size: clamp(.65rem,2.75vw,.83rem); }
.phone-shortcuts i { display: grid; place-items: center; width: 2.3em; height: 2.3em; border-radius: .72em; color: white; background: #1666de; font-size: 1.1em; font-style: normal; }
.phone-shortcuts button:nth-child(3n+2) i { background: #13866d; }
.phone-shortcuts button:nth-child(3n+3) i { background: #c95025; }
.phone-card.feature-card { background: linear-gradient(130deg,#1666de,#2797fa); color: white; }
.phone-card.feature-card p, .phone-card.feature-card small { color: #eef7ff; }
.v3-operations .phone .feature-card button { background: white; color: #155cbf; margin-top: .45em; }
.phone-card.offer-card { background: linear-gradient(130deg,#d74e24,#e7832d); }
.phone-row { display: flex; justify-content: space-between; align-items: center; gap: .55em; padding: .55em 0; border-top: 1px solid #e6edf6; }
.phone-row:first-of-type { border-top: 0; }
.phone-row span { color: #176962; font-size: .84em; flex-shrink: 0; }
.phone-row button { flex-shrink: 0; }
.phone-info { background: #fff6e4; color: #7c4a09; border: 1px solid #efce90; border-radius: .56em; padding: .58em; line-height: 1.45; }
.phone-success { color: #147353 !important; }
.phone-map { position: relative; width: 100%; border-radius: .7em; overflow: hidden; }
.phone-map img { display: block; width: 100%; }
.phone-map span { position: absolute; display: grid; place-items: center; width: 1.48em; height: 1.48em; border: 2px solid white; border-radius: 50%; transform: translate(-50%,-50%); color: white; font-weight: 700; }
.phone-agenda { list-style: none; padding: 0; margin: .4em 0 .7em; }
.phone-agenda li { padding: .38em 0 .38em .6em; border-left: 2px solid #add1ff; }
.phone-agenda time { display: inline-block; margin-right: .55em; color: #145cb9; font-weight: 700; }
.phone-agenda small { padding-left: 3.3em; }
.tour-card { border-left: 4px solid #169373; }
.tour-card details { color: #145cb9; font-size: .88em; }
.phone-nav { display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); background: #fff; border-top: 1px solid #d9e2ef; }
.v3-operations .phone .phone-nav button { display: grid; gap: .15em; justify-items: center; color: #60728f; background: #fff; padding: .55em .25em; }
.v3-operations .phone .phone-nav button.active { color: #135ec4; }
.phone-nav i { font-style: normal; font-size: 1.16em; }

@media (max-width: 660px) {
  .op-tools { grid-template-columns: minmax(0,1fr) minmax(0,1fr); }
  .op-tools button { grid-column: 1/-1; }
  .op-fields { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .op-row { align-items: start; flex-direction: column; }
  .op-actions { justify-content: start; }
  .op-editor { max-height: 45dvh; overflow-y: auto; }
  .phone { height: 72dvh; }
}
</style>
