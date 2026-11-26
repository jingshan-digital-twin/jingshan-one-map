import { reserveLayerId,eligibleReserve } from './investment-planning.ts'
import { isCourtLedgerId } from './court-ledger.ts'
import { populationDataset } from './population-grid.ts'
import { venueOwnershipGroup, venueOwnershipGroups } from './venue-ownership.ts'
import { calendar, coverage, distanceM, eventAssistance, industry } from './analytics.ts'
import type { Entry, Metric, Section } from './DashboardPanel.vue'
import { featureCenter, type CityFeature, type Coordinate, type Dataset, type Result } from './types.ts'
import { fusionPeriodIncludesMonth, fusionPromotion } from './fusion-promotion.ts'

export type V3PanelPage = 'overview' | 'industry-map' | 'investment' | 'event-live' | 'fusion-consumption' | 'fusion-merchants'
export type ResourceFilter = 'all' | 'courts' | 'subjects' | 'projects' | 'support'
export type ConsumptionPeriod = 'month' | 'quarter' | 'year' | 'event'
export type V3PanelContext = {
  datasets: Dataset[]
  region?: string
  now?: Date
  event?: CityFeature
  resource?: CityFeature
  resourceFilter?: ResourceFilter
  period?: ConsumptionPeriod
  liveDate?: string
  results?: Result[]
  rules?: Record<string, number>
  schoolsOpen?: boolean
  officesOpen?: boolean
  focus?: (feature: CityFeature) => void
  openEvent?: (feature: CityFeature) => void
  openResult?: () => void
  openFusion?: () => void
  onBusinessAction?: (action: 'manage-merchants' | 'manage-offers' | 'manage-routes' | 'tasks' | 'remind') => void
}
export type V3PanelSide = { title: string; main?: Metric; metrics: Metric[]; sections: Section[] }
export type V3PanelContent = {
  left: V3PanelSide
  right: V3PanelSide
  trend?: { title: string; labels: string[]; values: number[]; unit: string }
  statusCard?: { title: string; rows: Entry[] }
  extraMapFeatures?: CityFeature[]
}

const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const monthFormat = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Shanghai' })
const dateFormat = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' })
const missing = '—'
type Props = CityFeature['properties']

function properties(feature?: CityFeature): Props | undefined {
  return feature?.properties
}
function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
function amount(props: Record<string, unknown> | undefined, key: string) {
  return numeric(props?.[key]) ?? 0
}
function label(props: Record<string, unknown> | undefined, key: string) {
  const value = props?.[key]
  return typeof value === 'string' ? value : ''
}
function fields(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : []
}
function fmt(value: number | undefined) {
  return value === undefined ? missing : numberFormat.format(value)
}
function pct(part: number, total: number) {
  return total ? Math.round(part * 1000 / total) / 10 : 0
}
function metric(label: string, value: number | undefined, unit?: string): Metric {
  return { label, value: fmt(value), unit: value === undefined ? undefined : unit }
}
function side(title: string, sections: Section[] = [], metrics: Metric[] = [], main?: Metric): V3PanelSide {
  return { title, sections, metrics, main }
}
function section(title: string, entries: Entry[], note?: string, style?: Section['style']): Section {
  return { title, rows: entries, note, style }
}
function scoped(context: V3PanelContext, id: string) {
  const features = context.datasets.find(dataset => dataset.id === id)?.features ?? []
  return !context.region || context.region === '京山市' ? features
    : features.filter(feature => feature.properties.region === context.region || feature.properties.community === context.region)
}
function total(features: CityFeature[], key: string, defaultValue = 0) {
  return features.reduce((sum, feature) => sum + (numeric(feature.properties[key]) ?? defaultValue), 0)
}
function near(context: V3PanelContext, id: string, center: Coordinate | null, radius: number) {
  if (!center) return []
  const layer = id === 'population' ? populationDataset(context.datasets) : context.datasets.find(dataset => dataset.id === id)
  return (layer?.features ?? []).filter(feature => {
    const position = featureCenter(feature)
    return position && distanceM(center, position) <= radius
  })
}
function focus(context: V3PanelContext, feature: CityFeature | undefined, button = '定位'): Pick<Entry,'action'|'button'> {
  const callback = context.focus
  return callback && feature ? { action: () => callback(feature), button } : {}
}
function eventButton(context: V3PanelContext, feature: CityFeature): Pick<Entry,'action'|'button'> {
  const callback = context.openEvent
  return callback ? { action: () => callback(feature), button: '查看' } : focus(context,feature)
}
function businessAction(context: V3PanelContext, action: Parameters<NonNullable<V3PanelContext['onBusinessAction']>>[0], button: string): Pick<Entry,'action'|'button'> {
  const callback = context.onBusinessAction
  return callback ? { action: () => callback(action), button } : {}
}
function rateRow(label: string, rate: number, detail?: string): Entry {
  return { label, value: fmt(rate) + '%', bar: rate, detail }
}
function statusTone(status: string): Entry['tone'] {
  if (/完成|已入驻|已接收|已发布|已上架|已反馈|审查通过|已办结/.test(status)) return 'green'
  if (/待接收|缺口|投诉|未通过/.test(status)) return 'red'
  return 'amber'
}
function orderedByDate(features: CityFeature[], key: string) {
  return [...features].sort((a,b) => label(b.properties,key).localeCompare(label(a.properties,key)))
}
function localDate(context: V3PanelContext) {
  return dateFormat.format(context.now ?? new Date())
}
function currentMonth(context: V3PanelContext) {
  return monthFormat.format(context.now ?? new Date())
}
function monthlyRows(context: V3PanelContext, dataset: string) {
  return orderedByDate(scoped(context,dataset),'month')
    .filter(item => /^\d{4}-\d{2}$/.test(label(item.properties,'month')) &&
      label(item.properties,'month') <= currentMonth(context))
}
function findMonthly(context: V3PanelContext, dataset: string) {
  const records = monthlyRows(context,dataset)
  const selectedMonth = label(records[0]?.properties,'month')
  return { month: selectedMonth, records: records.filter(item => label(item.properties,'month') === selectedMonth) }
}
function monthlyValue(features: CityFeature[], key: string) {
  return features.some(item => numeric(item.properties[key]) !== undefined) ? total(features,key) : undefined
}
function latestTrend(context: V3PanelContext, dataset: string, key: string, title: string, unit: string) {
  const months = new Map<string,{ value:number; through:string }>()
  for (const feature of monthlyRows(context,dataset)) {
    const month = label(feature.properties,'month')
    const value = numeric(feature.properties[key])
    if (month && value !== undefined) months.set(month,{
      value:(months.get(month)?.value ?? 0) + value,
      through:label(feature.properties,'observedThrough') || months.get(month)?.through || '',
    })
  }
  const trend = [...months].slice(0,5).reverse()
  return trend.length ? {
    title, labels:trend.map(([month,entry]) => {
      const [year,number] = month.split('-').map(Number)
      const monthEnd = new Date(Date.UTC(year,number,0)).getUTCDate()
      const observed = Number(entry.through.slice(8,10))
      return number + '月' + (observed > 0 && observed < monthEnd ? '·' + observed + '日' : '')
    }), values:trend.map(([,entry]) => entry.value),unit,
  } : undefined
}
function sumObject(features: CityFeature[], key: string) {
  const totals = new Map<string,number>()
  for (const item of features) {
    for (const [category,value] of Object.entries(fields(item.properties[key]))) {
      const number = numeric(value)
      if (number !== undefined) totals.set(category,(totals.get(category) ?? 0) + number)
    }
  }
  return [...totals].sort((a,b) => b[1]-a[1])
}
function volumeForMonth(feature: CityFeature, key: 'orders'|'redemptions', month: string) {
  const volumes = fields(feature.properties[key + 'ByMonth'])
  return Object.keys(volumes).length ? numeric(volumes[month]) ?? 0 : amount(feature.properties,key)
}
function eventFeature(context: V3PanelContext, id: string) {
  const source = scoped(context,id)
  return orderedByDate(source.filter(item => item.properties.eventId === context.event?.id),'date')[0]
}
function ranking(entries: Entry[], max = 6) {
  return entries.slice(0,max)
}

function overview(context: V3PanelContext): V3PanelContent {
  const chain = industry(context.datasets,context.region,true)
  const courts = scoped(context,'courts')
  const cover = coverage(context.datasets,{region:context.region},context.rules)
  const events = calendar(context.datasets).filter(event => !context.region || context.region === '京山市' || event.properties.region === context.region)
  const today = localDate(context)
  const upcoming = events.filter(item => item.properties.status !== '已办结' &&
    (label(item.properties,'endDate') || label(item.properties,'date')) >= today)
  const annual = events.filter(item => label(item.properties,'date').startsWith(today.slice(0,4)) && item.properties.status === '已办结')
  const monthly = findMonthly(context,'operations_monthly')
  const venueMonth = findMonthly(context,'venue_operations')
  const venueFeatures = scoped(context,'venues')
  const merchants = scoped(context,'merchants')
  const operated = new Set(venueFeatures.filter(venue => venue.properties.companyOperated === true ||
    /网球产业(?:发展有限)?公司/.test(label(venue.properties,'operator'))).map(item => item.id))
  const selfManaged = courts.filter(item => item.properties.companyOperated === true ||
    (item.properties.companyOperated === undefined && operated.has(label(item.properties,'facilityId'))))
  const recent = upcoming.slice(0,4).map(event => {
    const start = label(event.properties,'date')
    const days = Math.round((Date.parse(start) - Date.parse(today)) / 86_400_000)
    return {
      label:event.properties.name, value:start.slice(5),
      detail:[label(event.properties,'venue'),label(event.properties,'status'),days > 0 ? '还有 ' + days + ' 天' : ''].filter(Boolean).join(' · '),
      tone:statusTone(label(event.properties,'status')), ...eventButton(context,event),
    }
  })
  const pending = (context.results ?? []).filter(item => item.status !== 'completed')
  const groups = [
    { label:'赛事保障任务', match:(item:Result) => item.scene === 'events' },
    { label:'学校场地错时开放', match:(item:Result) => /学校|教育|错时/.test(item.title) },
    { label:'新建场地用地审查', match:(item:Result) => /选址|用地|地块/.test(item.title) },
  ].map(group => {
    const matches = pending.filter(group.match)
    const incoming = matches.filter(item => item.status === 'pending').length
    const active = matches.length - incoming
    return {
      label:group.label,value:matches.length ? ['待接收 ' + incoming,'办理中 ' + active].join(' · ') : '暂无待办',
      tone:(incoming ? 'amber' : 'cyan') as Entry['tone'],
      action:matches.length ? context.openResult : undefined,button:'查看',
    }
  })
  const utilization = [...venueMonth.records]
    .sort((a,b) => amount(b.properties,'utilization') - amount(a.properties,'utilization')).slice(0,6)
    .map(item => {
      const venue = venueFeatures.find(feature => feature.id === item.properties.venueId)
      return { ...rateRow(venue?.properties.name ?? item.properties.name, amount(item.properties,'utilization')), ...focus(context,venue) }
    })
  return {
    left:side('网球产业家底',[],[
      metric('产业公司自营',courts.some(c=>c.properties.companyOperated!==undefined || label(c.properties,'operator')) ? selfManaged.length : undefined,'片'),
      metric('每万人场地',cover.totalPopulation ? courts.length * 10000 / cover.totalPopulation : 0,'片'),
      metric('15分钟服务覆盖',cover.coveredRate,'%'),
      metric('俱乐部',chain.clubs,'个'),metric('培训机构',chain.training,'家'),
      metric('产业链主体',chain.total,'家'),
      metric('年办赛',annual.length,'场'),metric('年参赛人次',total(annual,'registered') || total(annual,'players'),'人次'),
      metric('配套商家',merchants.length || scoped(context,'hotels').length + scoped(context,'food').length + scoped(context,'tourism').length,'家'),
    ],metric(context.region && context.region !== '京山市' ? '本区域网球场地' : '全市网球场地',courts.length,'片')),
    right:side('运行态势',[
      section('近期赛事',recent,'年度赛历'),
      section('待办事项',groups,'共 ' + pending.length + ' 项'),
      section('场地利用率排名',utilization,venueMonth.month,'bar'),
    ],[
      metric(monthly.month && monthly.month !== currentMonth(context) ? monthly.month + ' 订场' : '本月订场',monthlyValue(monthly.records,'bookings'),'次'),
      metric(monthly.month && monthly.month !== currentMonth(context) ? monthly.month + ' 办赛' : '本月办赛',monthlyValue(monthly.records,'events'),'场'),
      metric(monthly.month && monthly.month !== currentMonth(context) ? monthly.month + ' 到访' : '本月到访',monthlyValue(monthly.records,'visits'),'人次'),
    ]),
  }
}

function resourceMetrics(context: V3PanelContext, filter: ResourceFilter) {
  const courts = scoped(context,'courts')
  const chain = industry(context.datasets,context.region,true)
  const merchants = scoped(context,'merchants')
  const subjectRows = [
    {label:'俱乐部',value:chain.clubs + ' 个'},
    {label:'培训机构',value:chain.training + ' 家'},
    {label:'产业链主体',value:chain.total + ' 家'},
  ]
  const merchantRows = [
    {label:'酒店民宿',value:merchants.filter(item => item.properties.category === '酒店民宿').length || scoped(context,'hotels').length},
    {label:'餐饮',value:merchants.filter(item => item.properties.category === '餐饮').length || scoped(context,'food').length},
    {label:'景区温泉',value:merchants.filter(item => item.properties.category === '景区温泉').length || scoped(context,'tourism').length},
  ].map(row => ({...row,value:row.value + (row.label === '景区温泉' ? ' 处' : ' 家')}))
  const timed = courts.filter(item => item.properties.status === '错时开放' || item.properties.openMode === '错时开放').length
  const open = courts.filter(item => item.properties.open === true && item.properties.status !== '错时开放' && item.properties.openMode !== '错时开放').length
  const ownership = [...venueOwnershipGroups,{label:'未填'}].map(({label}) => {
    const count = courts.filter(item => (venueOwnershipGroup(item.properties.ownership)?.label ?? '未填')===label).length
    return { label,value:count + ' 片',bar:pct(count,courts.length) }
  })
  const allSections = [
    section('按权属',ownership,'场地片数','bar'),
    section('开放状态',context.datasets.some(d=>isCourtLedgerId(d.id)) ? [...new Set(courts.map(c=>label(c.properties,'开放方式') || '未填'))].map(mode=>({label:mode,value:courts.filter(c=>(label(c.properties,'开放方式') || '未填')===mode).length+' 片'})) : [
      { label:'对外开放',value:open + ' 片',tone:'cyan' },
      { label:'错时开放',value:timed + ' 片',tone:'green' },
      { label:'暂未开放',value:Math.max(0,courts.length-open-timed) + ' 片' },
    ]),
    section('产业主体',subjectRows,chain.total + ' 家'),
    section('配套商家',merchantRows),
  ]
  if (filter === 'courts') return { main:metric('网球场地',courts.length,'片'),sections:allSections.slice(0,2) }
  if (filter === 'subjects') return {
    main:metric('产业主体',chain.total,'家'),sections:[section('主体分类',subjectRows),
      section('产业主体清单',chain.businesses.slice(0,9).map(item => ({label:item.properties.name,value:label(item.properties,'subtype'),...focus(context,item)})))],
  }
  if (filter === 'projects') return { main:metric('网球产业项目',chain.projects.length,'个'),sections:[
    section('项目清单',chain.projects.slice(0,12).map(item => ({
      label:item.properties.name,value:label(item.properties,'status'),detail:'进度 ' + fmt(numeric(item.properties.progress)) + '%',...focus(context,item),
    }))),
  ] }
  if (filter === 'support') return {
    main:metric('配套商家',merchants.length || scoped(context,'hotels').length + scoped(context,'food').length + scoped(context,'tourism').length,'家'),
    sections:[section('配套类别',merchantRows),section('配套清单',merchants.slice(0,10).map(item => ({
      label:item.properties.name,value:label(item.properties,'category'),...focus(context,item),
    })))],
  }
  return {main:metric('网球场地',courts.length,'片'),sections:allSections}
}

function resourceDetail(context: V3PanelContext, feature: CityFeature | undefined) {
  if (!feature) return [section('资源详情',[], '点击地图选择要素')]
  const value = feature.properties
  if (!['venue','court'].includes(value.kind)) {
    const detailLabels: Record<string,string> = {
      type:'类型',subtype:'业态',segment:'产业链环节',category:'分类',status:'状态',progress:'项目进度',
      investment:'计划投资（万元）',beds:'床位数',rating:'综合评价',redemptions:'本月核销次数',
      grade:'食品安全等级',area:'面积（平方米）',visits:'到访人数',capacity:'服务容量',price:'参考价格（元）',
    }
    return [section(feature.properties.name,Object.entries(detailLabels).flatMap(([key,title]) => {
      const current = value[key]
      return typeof current === 'number' || typeof current === 'string'
        ? [{label:title,value:typeof current === 'number' ? fmt(current) : current}] : []
    }),feature.properties.region)]
  }
  const venueId = label(value,'facilityId') || feature.id
  const venue = scoped(context,'venues').find(item => item.id === venueId) ?? feature
  const venueProps = venue.properties
  const venueCourts = scoped(context,'courts').filter(item => item.properties.facilityId === venueId)
  const month = findMonthly(context,'venue_operations')
  const operation = month.records.find(item => item.properties.venueId === venueId)?.properties
  const updated = label(operation,'updatedAt') || label(venueProps,'updatedAt')
  const location = featureCenter(venue)
  const nearbyHotels = near(context,'hotels',location,1000)
  const nearbyFood = near(context,'food',location,1000)
  const nearbyParking = near(context,'parking',location,1000)
  const nearbyTransit = near(context,'transit',location,1000)
  const population = near(context,'population',location,context.rules?.walkM ?? 1200)
  const venueEvents = calendar(context.datasets).filter(item =>
    item.properties.venueId === venueId && (label(item.properties,'endDate') || label(item.properties,'date')) >= localDate(context))
  const count = venueCourts.length || amount(venueProps,'count')
  const indoor = amount(venueProps,'indoorCourts')
  const courtCode = label(value,'courtCode') || label(venueProps,'courtCodeStart') || missing
  return [
    section(venue.properties.name,[
      {label:'场地编码',value:courtCode},
      {label:'场地片数',value:fmt(count) + ' 片' + (indoor > 0 ? '（室内 ' + indoor + '，室外 ' + amount(venueProps,'outdoorCourts') + '，风雨 ' + amount(venueProps,'coveredCourts') + '）' : '')},
      {label:'权属和运营',value:[venueOwnershipGroup(venueProps.ownership)?.shortLabel,label(venueProps,'operator')].filter(Boolean).join(' · ') || missing},
      {label:'开放时间',value:label(venueProps,'openingHours') || label(venueCourts[0]?.properties,'openingHours') || missing},
      {label:'可承办赛事',value:label(venueProps,'level') || missing},
      {label:'本月预约和利用率',value:operation ? fmt(numeric(operation.bookings)) + ' 次 · ' + fmt(numeric(operation.utilization)) + '%' : missing,tone:'cyan'},
      {label:'15分钟服务人口',value:fmt(numeric(operation?.servicePopulation) ?? total(population,'population')) + ' 人'},
      {label:'信息更新',value:updated.slice(0,10) || missing},
    ],venue.properties.region),
    section('周边配套',[
      {label:'酒店民宿',value:nearbyHotels.length + ' 家 · 床位 ' + fmt(total(nearbyHotels,'beds')) + ' 张'},
      {label:'餐饮',value:nearbyFood.length + ' 家'},
      {label:'停车泊位',value:fmt(total(nearbyParking,'spaces')) + ' 个'},
      {label:'公交站点',value:nearbyTransit.length + ' 个'},
    ],'1公里范围'),
    section('近期赛事',venueEvents.slice(0,4).map(event => ({
      label:event.properties.name,value:label(event.properties,'date').slice(5),...eventButton(context,event),
    }))),
  ]
}

function industryMap(context: V3PanelContext): V3PanelContent {
  const filter = context.resourceFilter ?? 'all'
  const resource = resourceMetrics(context,filter)
  const primary = filter === 'subjects' ? scoped(context,'businesses')[0] :
    filter === 'projects' ? scoped(context,'projects')[0] :
    filter === 'support' ? scoped(context,'merchants')[0] : scoped(context,'venues').find(item => item.id === 'venue-international') ?? scoped(context,'venues')[0]
  return { left:side('产业资源',resource.sections,[],resource.main),right:side('资源详情',resourceDetail(context,context.resource ?? primary)) }
}

const investmentCategories = [
  { title:'住宿（床位）', key:'lodging' },
  { title:'运动康复（家）', key:'rehab' },
  { title:'器材销售维修（家）', key:'equipment' },
  { title:'餐饮（家）', key:'dining' },
  { title:'网球培训（家）', key:'training' },
] as const

function investment(context: V3PanelContext): V3PanelContent {
  const hotspots = scoped(context,'investment_hotspots')
  const needs = scoped(context,'investment_needs')
  const parcels = scoped(context,reserveLayerId).filter(eligibleReserve)
  const chain = industry(context.datasets,context.region)
  const sumPeople = total(hotspots,'people')
  const statuses = (context.results ?? []).filter(item => /招商|补链/.test(item.title))
  const layers = hotspots.map(feature => ({
    ...feature, properties:{ ...feature.properties, kind:'investment-hotspot', color:'#ff8669' },
  }))
  const candidateFeatures = needs.flatMap(item => {
    const parcel = parcels.find(feature => feature.id === item.properties.parcelId)
    return parcel ? [{
      ...parcel, id:'investment:' + parcel.id,
      properties:{ ...parcel.properties, kind:'investment-parcel', color:'#3ee08f', demandId:item.id },
    }] : []
  })
  const supplied = investmentCategories.map(({ title,key }) => {
    const source = hotspots.map(feature => ({
      name:feature.properties.name.replace(/\s*·\s*赛事热区$/, ''),
      supply:numeric(feature.properties[key+'Supply']), demand:numeric(feature.properties[key+'Demand']),
    })).filter(item => item.supply !== undefined && item.demand !== undefined)
      .sort((a,b) => ((b.demand ?? 0) - (b.supply ?? 0)) - ((a.demand ?? 0) - (a.supply ?? 0)))[0]
    const status = (source?.demand ?? 0) > (source?.supply ?? 0) ? source?.supply ? '不足' : '空白' : '供需匹配'
    return { label:title,value:source ? status : missing,
      detail:source ? '需求 ' + fmt(source.demand) + ' · 供给 ' + fmt(source.supply) + ' · ' + source.name : undefined,
      tone:(status === '供需匹配' ? 'green' : status === '空白' ? 'red' : 'amber') as Entry['tone'] }
  })
  const gapFeatures = hotspots.filter(hotspot => needs.some(need => need.properties.hotspotId === hotspot.id &&
    amount(need.properties,'gap') > 0)).map(feature => ({
      ...feature,id:'supply-gap:' + feature.id,
      properties:{ ...feature.properties, name:feature.properties.name.replace('赛事热区','配套短板片区'),
        kind:'investment-gap', color:'#ff685f' },
    }))
  const trackedStatuses = statuses.slice(0,5).map(item => ({
    label:item.department,value:resultState(item),detail:item.title,action:context.openResult,button:'查看',
  }))
  return {
    left:side('配套分析',[
      section('供需对比',supplied,'按各类最大缺口热区'),
      section('各热区配套',hotspots.slice(0,6).map(item => ({
        label:item.properties.name,value:fmt(numeric(item.properties.lodgingSupply)) + ' 床',
        detail:'康复 ' + amount(item.properties,'rehabSupply') + ' 家 · 器材 ' + amount(item.properties,'equipmentSupply') + ' 家',
        ...focus(context,item),
      })),'按 2 公里范围测算'),
      section('产业链环节',chain.stages.map(item => ({label:item.name,value:item.count + ' 家',bar:item.percentage})),'企业数','bar'),
    ],[
      metric('热区覆盖人次',hotspots.length ? sumPeople : undefined,'人次'),
      metric('赛事热区',hotspots.length,'处'),
      metric('招商需求',needs.length,'项'),
    ]),
    right:side('招商需求清单',[
      section('招商项目与备选地块',needs.slice(0,8).map(item => {
        const parcel = parcels.find(feature => feature.id === item.properties.parcelId)
        const review = label(item.properties,'reviewStatus')
        return {
          label:item.properties.name, value:review || label(item.properties,'status'), tone:statusTone(review),
          detail:[parcel?.properties.name,parcel && fmt(numeric(parcel.properties.area)) + '㎡',label(item.properties,'rationale')].filter(Boolean).join(' · '),
          ...focus(context,parcel ?? item,'查看地块'),
        }
      }),'共 ' + needs.length + ' 项','card'),
      section('办理进度',trackedStatuses.length ? trackedStatuses : needs.slice(0,5).map(item => ({
        label:item.properties.name,value:label(item.properties,'status'),detail:label(item.properties,'reviewStatus'),
      }))),
    ]),
    extraMapFeatures:[...layers,...candidateFeatures,...gapFeatures],
  }
}

function resultState(item: Result) {
  return item.status === 'completed' ? '已完成' : item.status === 'received' ? '办理中' : '待接收'
}

function liveEvent(context: V3PanelContext): V3PanelContent {
  const all = orderedByDate(scoped(context,'event_live').filter(item => item.properties.eventId === context.event?.id),'date')
  const snapshot = all.find(item => label(item.properties,'date') === context.liveDate) ??
    all.find(item => label(item.properties,'date') <= localDate(context)) ??
    all.find(item => item.properties.simulation === true && item.properties.day === 3) ??
    all.filter(item => item.properties.simulation === true).at(-1)
  const data = snapshot?.properties
  const taskRows = rows(data?.tasks)
  const completed = taskRows.reduce((sum,item) => sum+amount(item,'completed'),0)
  const required = taskRows.reduce((sum,item) => sum+amount(item,'total'),0)
  const recordedTasks = (context.results ?? []).filter(item => item.scene === 'events' &&
    (!context.event || item.summary.includes(context.event.properties.name)))
  const taskEntries: Entry[] = taskRows.map(item => {
    const status = label(item,'status') || (amount(item,'completed') === amount(item,'total') ? '已完成' : '办理中')
    return {
      label:label(item,'department'),value:amount(item,'completed') + '/' + amount(item,'total') + ' ' + status,
      detail:label(item,'title'),tone:statusTone(status),...businessAction(context,'tasks','查看'),
    }
  })
  const tasks = [...taskEntries,...recordedTasks.slice(0,7).map(item => ({
    label:item.department,value:resultState(item),detail:item.title,
    tone:statusTone(resultState(item)),action:context.openResult,button:'办理',
  }))]
  const reports = rows(data?.updates).sort((a,b) => label(a,'time').localeCompare(label(b,'time')))
  const asOf = label(data,'asOf') || label(data,'date')
  const eventTitle = context.event?.properties.name || '赛历未选择赛事'
  const progress: Entry[] = required ? [
    {label:'已完成',value:completed + '/' + required + ' 项',tone:'green',bar:pct(completed,required)},
    {label:'剩余任务',value:required-completed + ' 项',tone:'amber'},
  ] : []
  return {
    left:side('赛事进行中',[
      section('保障任务进度',progress,asOf,'bar'),
      section('出行服务发布',rows(data?.services).map(item => ({
        label:label(item,'title'),value:label(item,'status'),tone:statusTone(label(item,'status')),
        detail:[label(item,'detail'),numeric(item.readCount) === undefined ? '' : fmt(numeric(item.readCount)) + ' 人已读'].filter(Boolean).join(' · '),
      })),'京网通'),
      section('安全保障',data ? [
        {label:'保障点到位',value:fmt(numeric(data.pointsReady)) + ' / ' + fmt(numeric(data.pointsTotal)) + ' 处',tone:'green'},
        {label:'当日事件',value:fmt(numeric(data.incidentCount)) + ' 起',detail:label(data,'incidentSummary')},
      ] : []),
    ],[
      metric('今日到场',numeric(data?.attendees),'人'),metric('停车占用',numeric(data?.parkingRate),'%'),metric('酒店入住',numeric(data?.hotelRate),'%'),
    ],{ label:eventTitle, value:label(context.event?.properties,'level') || '赛事' }),
    right:side('部门任务看板',[
      section('保障任务',tasks,required ? required + ' 项保障任务' : '等待赛中记录'),
      section('今日动态',reports.map(item => ({
        label:label(item,'time') + ' · ' + label(item,'department'),detail:label(item,'summary'),
      })),'部门反馈'),
    ]),
    statusCard:data ? {title:(data.simulation === true ? '赛中演练' : '现场实况') + ' · ' + (asOf.replace('T',' ').slice(0,16) || '赛中快照'),rows:[
      {label:'在场人数',value:fmt(numeric(data.present)) + ' 人',tone:'cyan'},
      {label:'停车占用',value:fmt(numeric(data.parkingRate)) + '%',tone:'amber'},
      {label:'接驳班车',value:fmt(numeric(data.shuttleRoutes)) + ' 条 · 每 ' + fmt(numeric(data.shuttleIntervalMinutes)) + ' 分钟'},
      {label:'临时停车场',value:fmt(numeric(data.temporaryParkingLots)) + ' 处 · 余位 ' + fmt(numeric(data.temporaryParkingRemaining))},
      {label:'保障点到位',value:fmt(numeric(data.pointsReady)) + ' / ' + fmt(numeric(data.pointsTotal)),tone:'green'},
    ]} : undefined,
  }
}

export function postEventReview(context: V3PanelContext): Section {
  const feature = eventFeature(context,'event_actuals')
  const actual = feature?.properties
  const forecast = context.event ? eventAssistance(context.datasets,context.event.id,undefined,context.rules) : undefined
  return section('保障复盘',context.event ? [
    {label:'保障任务按时完成',value:actual ? fmt(numeric(actual.tasksCompleted)) + '/' + fmt(numeric(actual.tasksTotal)) + ' 项' : missing,tone:'green'},
    {label:'停车缺口实际 / 预测',value:fmt(numeric(actual?.parkingGap)) + ' / ' + fmt(numeric(actual?.forecastParkingGap) ?? forecast?.parkingGap)},
    {label:'床位缺口实际 / 预测',value:fmt(numeric(actual?.bedGap)) + ' / ' + fmt(numeric(actual?.forecastBedGap) ?? forecast?.lodgingGap)},
  ] : [],'实际与预测')
}

export function venueCoverageSection(context: V3PanelContext, radiusM: number): Section {
  const entries = scoped(context,'venues').filter(item => {
    const owner=venueOwnershipGroup(item.properties.ownership)?.label
    return item.properties.open===true || (context.schoolsOpen && owner==='学校') || (context.officesOpen && owner==='机关单位')
  })
    .map(item => ({item,population:total(near(context,'population',featureCenter(item),radiusM),'population')}))
    .sort((a,b) => b.population - a.population).slice(0,5)
  return section('各场馆服务居民',entries.map(({item,population}) => ({
    label:item.properties.name,value:fmt(population) + ' 人',bar:pct(population,entries[0].population),...focus(context,item),
  })),'范围约 ' + fmt(radiusM) + ' 米','bar')
}

function percentRows(entries: [string,number][]) {
  const count = entries.reduce((sum,[,value]) => sum + value,0)
  return entries.map(([name,value]) => rateRow(name,pct(value,count)))
}

function orderCount(feature: CityFeature, month: string) {
  return volumeForMonth(feature,'orders',month)
}

function fusionConsumption(context: V3PanelContext): V3PanelContent {
  const programme = fusionPromotion(context)
  const eventScope = context.period === 'event'
  const event = eventScope ? context.event : undefined
  const props = event?.properties.status === '已办结' ? event.properties : undefined
  const selected = monthlyRows(context,'operations_monthly').filter(item =>
    fusionPeriodIncludesMonth(context.period ?? 'month',context.now ?? new Date(),label(item.properties,'month')))
  const places = scoped(context,'tourism')
  const consumption = sumObject(selected,'consumption')
  const stays = sumObject(selected,'stays')
  const hot = sumObject(selected,'hotspots')
  const eventRedemptions = event ? scoped(context,'offers').map(item =>
    numeric(fields(item.properties.redemptionsByEvent)[event.id]) ??
    (item.properties.eventId === event.id ? numeric(item.properties.eventRedemptions) : undefined),
  ).filter((value):value is number => value !== undefined) : []
  const redemptions = eventScope ? (eventRedemptions.length ? eventRedemptions.reduce((a,b) => a+b,0) : undefined) : monthlyValue(selected,'redemptions')
  const attendance = numeric(props?.attendance)
  const scenicVisitors = numeric(props?.scenicVisitors)
  const linkedOrders = programme.routes.filter(item => item.orders !== undefined).length
  const selectedLocations = [...scoped(context,'venues'), ...places, ...scoped(context,'communities')]
  const spendingMax = hot[0]?.[1] ?? 0
  const heatFeatures = (eventScope ? [] : hot).slice(0,8).flatMap(([name,value],index):CityFeature[] => {
    const location = selectedLocations.find(item => item.properties.name === name ||
      item.properties.name.includes(name.replace(/^城区/,'').replace(/周边$|片区$/,'')))
    const point = location && featureCenter(location)
    return point ? [{
      type:'Feature',id:'consumption-heat:' + index,geometry:{type:'Point',coordinates:point},
      properties:{name,region:location.properties.region,kind:'consumption-heat',color:'#ff9853',spend:value,
        count:pct(value,spendingMax)},
    }] : []
  })
  return {
    left:side('赛事带动与转化',[
      section('已报订单去向',programme.tiers.map(tier => ({
        label:tier.label,value:tier.orders === undefined ? '未报送' : fmt(tier.orders) + ' 单' + (tier.share === undefined ? '' : ' · ' + fmt(tier.share) + '%'),
        bar:tier.share,
      })),linkedOrders + ' 条线路有订单记录','bar'),
      ...(eventScope ? [
        {...section('赛后旅游转化',props ? [
          {label:'游览景区人数',value:scenicVisitors === undefined ? missing : fmt(scenicVisitors) + ' 人'},
          {label:'到场→游览转化率',value:scenicVisitors !== undefined && attendance ? fmt(pct(scenicVisitors,attendance)) + '%' : missing},
          {label:'过夜游客',value:numeric(props.overnightGuests) === undefined ? missing : fmt(numeric(props.overnightGuests)) + ' 人'},
          {label:'平均停留',value:numeric(props.stayDays) === undefined ? missing : fmt(numeric(props.stayDays)) + ' 天'},
        ] : [],'赛事回报口径'),empty:'暂无已办赛事的旅游回报。'},
      ] : [
        {...section('消费结构',percentRows(consumption),'京网通运营汇总','bar'),empty:'当前统计期未报送消费结构。'},
        {...section('外地用户停留天数',percentRows(stays),undefined,'bar'),empty:'当前统计期未报送停留数据。'},
      ]),
    ],[
      metric(eventScope ? '赛事到场' : '赛事到场人次',eventScope ? attendance : monthlyValue(selected,'attendance'),eventScope ? '人' : '人次'),
      metric('票根核销',redemptions,'次'),
      metric(eventScope ? '赛事带动消费' : '网旅估算消费',eventScope ? numeric(props?.spend) : monthlyValue(selected,'spend'),'万元'),
    ],metric('套餐已报订单',programme.totalOrders,'单')),
    right:side('线路推介'),
    extraMapFeatures:heatFeatures,
  }
}

function fusionMerchants(context: V3PanelContext): V3PanelContent {
  const month = findMonthly(context,'operations_monthly').month
  const merchants = scoped(context,'merchants')
  const offers = scoped(context,'offers')
  const routes = scoped(context,'route_packages')
  const joined = merchants.filter(item => item.properties.joined === true || item.properties.status === '已入驻')
  const categories = ['酒店民宿','餐饮','景区温泉','购物','培训机构']
  const categoriesData = categories.map(label => ({
    label,count:merchants.filter(item => item.properties.category === label).length,
    joined:joined.filter(item => item.properties.category === label).length,
  }))
  const awaitingMerchants = merchants.filter(item => item.properties.status === '待审核')
  const awaitingOffers = offers.filter(item => item.properties.status === '待审核')
  const complaints = total(merchants,'complaintsOpen')
  const ratings = joined.filter(item => numeric(item.properties.rating) !== undefined)
  const incomingEvent = calendar(context.datasets).find(item => label(item.properties,'date') >= localDate(context) && item.properties.status !== '已办结')
  const incomingOffers = offers.filter(item => item.properties.eventId === incomingEvent?.id && item.properties.status === '已上架')
  const incomingRoutes = routes.filter(item => item.properties.eventId === incomingEvent?.id && item.properties.status === '已上架')
  const weekly = findMonthly(context,'operations_monthly').records[0]?.properties.redemptionsByWeek
  const weeks = Array.isArray(weekly) ? weekly.filter((value): value is number => numeric(value) !== undefined) : []
  const trend = weeks.length ? { title:'近' + weeks.length + '周票根核销', labels:weeks.map((_,index) => '第' + (index+1) + '周'), values:weeks, unit:'次' }
    : latestTrend(context,'operations_monthly','redemptions','票根核销趋势','次')
  return {
    left:side('合作商家',[
      section('入驻率',categoriesData.filter(item => item.count > 0).map(item => rateRow(item.label,pct(item.joined,item.count))),'已入驻 ÷ 全部','bar'),
      section('待办事项',[
        {label:'入驻申请待审核',value:awaitingMerchants.length + ' 家',tone:'amber',...businessAction(context,'manage-merchants','审核')},
        {label:'优惠活动待审核',value:awaitingOffers.length + ' 项',tone:'amber',...businessAction(context,'manage-offers','管理')},
        {label:'投诉待处理',value:complaints + ' 件',tone:'red'},
        {label:'商家综合满意度',value:ratings.length ? (total(ratings,'rating')/ratings.length).toFixed(1) + ' / 5.0' : missing,tone:'green'},
      ],'共 ' + (awaitingMerchants.length+awaitingOffers.length+complaints) + ' 项'),
    ],[
      ...categoriesData.map(item => metric(item.label,item.joined,item.label === '景区温泉' ? '处' : '家')),
      metric('本月新增',joined.filter(item => label(item.properties,'joinedAt').startsWith(month || currentMonth(context))).length,'家'),
    ],metric('入驻合作商家',joined.length,'家')),
    right:side('线路和优惠',[
      section('线路套餐',ranking([...routes].sort((a,b) => orderCount(b,month)-orderCount(a,month)).map(item => ({
        label:item.properties.name,value:fmt(orderCount(item,month)) + ' 单',
        detail:label(item.properties,'status'),tone:statusTone(label(item.properties,'status')),...focus(context,item),
      }))),routes.length + ' 条'),
      section('票根优惠',ranking([...offers].sort((a,b) => volumeForMonth(b,'redemptions',month)-volumeForMonth(a,'redemptions',month)).map(item => ({
        label:item.properties.name,value:fmt(volumeForMonth(item,'redemptions',month)) + ' 次',
        detail:label(item.properties,'status'),tone:statusTone(label(item.properties,'status')),...focus(context,item),
      }))),month ? month + ' 核销' : '核销'),
      section('下一场赛事配套',incomingEvent ? [
        {label:'已配置票根优惠',value:incomingOffers.length + ' 项'},
        {label:'已上架线路',value:incomingRoutes.length + ' 条'},
      ] : [],incomingEvent?.properties.name),
    ]),trend,
  }
}

export function v3Panels(page: V3PanelPage, context: V3PanelContext): V3PanelContent {
  switch (page) {
    case 'overview': return overview(context)
    case 'industry-map': return industryMap(context)
    case 'investment': return investment(context)
    case 'event-live': return liveEvent(context)
    case 'fusion-consumption': return fusionConsumption(context)
    case 'fusion-merchants': return fusionMerchants(context)
  }
}
