import { featureCenter, type CityFeature, type Coordinate } from './types.ts'
import type { ConsumptionPeriod, V3PanelContext } from './v3-panels.ts'

export const fusionTiers = [
  { id: 'local', scope: '京山', label: '京山本地', shortLabel: '留在京山' },
  { id: 'regional', scope: '荆门', label: '荆门周边', shortLabel: '延伸荆门' },
  { id: 'province', scope: '湖北', label: '湖北省内', shortLabel: '游湖北' },
] as const

export type FusionTier = typeof fusionTiers[number]['id']
export type FusionRoute = {
  feature: CityFeature
  id: string
  name: string
  tier: FusionTier
  orders: number | undefined
  status: string
  published: boolean
  destination: Coordinate | null
  source: Coordinate | null
  from: string
  to: string
  days: number | undefined
  travelMinutes: number | undefined
  price: number | undefined
  itinerary: string[]
  merchantIds: string[]
  merchants: CityFeature[]
}
export type FusionPromotion = {
  periodLabel: string
  observedThrough: string | undefined
  eventDate: string | undefined
  routes: FusionRoute[]
  tiers: (typeof fusionTiers[number] & {
    routes: FusionRoute[]
    orders: number | undefined
    share: number | undefined
    top: FusionRoute | undefined
  })[]
  totalOrders: number | undefined
  localShare: number | undefined
  top: FusionRoute | undefined
  excludedRoutes: number
}

const monthFormat = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Shanghai' })

function calendarPeriod(period: ConsumptionPeriod, now: Date) {
  const lastMonth = monthFormat.format(now)
  const [year, month] = lastMonth.split('-').map(Number)
  const quarter = Math.floor((month - 1) / 3) + 1
  const firstMonth = period === 'year' ? year + '-01'
    : period === 'quarter' ? year + '-' + String(quarter * 3 - 2).padStart(2, '0') : lastMonth
  return {year, month, quarter, firstMonth, lastMonth}
}

export function fusionPeriodIncludesMonth(period: ConsumptionPeriod, now: Date, value: string) {
  if (period === 'event' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false
  const {firstMonth,lastMonth} = calendarPeriod(period,now)
  return value >= firstMonth && value <= lastMonth
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function count(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function fields(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : text(value).split(/\r?\n/).filter(Boolean)
}

function coord(value: number[] | undefined): Coordinate | null {
  if (!value || value.length < 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) return null
  return [value[0], value[1]]
}

function endpoints(feature: CityFeature): [Coordinate | null, Coordinate | null] {
  const { geometry } = feature
  if (geometry.type === 'LineString') return [coord(geometry.coordinates[0]), coord(geometry.coordinates.at(-1))]
  if (geometry.type === 'MultiLineString') {
    const lines = geometry.coordinates.filter(line => line.length)
    return [coord(lines[0]?.[0]), coord(lines.at(-1)?.at(-1))]
  }
  return [null, featureCenter(feature)]
}

function total(values: (number | undefined)[]): number | undefined {
  const reported = values.filter((value): value is number => value !== undefined)
  return reported.length ? reported.reduce((sum, value) => sum + value, 0) : undefined
}

function share(orders: number | undefined, totalOrders: number | undefined) {
  return orders !== undefined && totalOrders ? Math.round(orders * 1000 / totalOrders) / 10 : undefined
}

export function fusionPromotion(context: V3PanelContext): FusionPromotion {
  const features = (id: string) => context.datasets.find(dataset => dataset.id === id)?.features ?? []
  const period = context.period ?? 'month'
  const now = context.now ?? new Date()
  const {year,month,quarter} = calendarPeriod(period,now)
  const monthInScope = (value:string) => fusionPeriodIncludesMonth(period,now,value)
  const event = period === 'event' ? context.event : undefined
  const eventDate = text(event?.properties.date) || undefined
  const periodLabel = period === 'event' ? text(event?.properties.name) || '按赛事'
    : period === 'year' ? year + ' 年'
    : period === 'quarter' ? year + ' 年第 ' + quarter + ' 季度' : year + ' 年 ' + month + ' 月'
  const observedThrough = period === 'event' ? undefined : features('operations_monthly')
    .filter(item => monthInScope(text(item.properties.month)))
    .map(item => text(item.properties.observedThrough))
    .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort().at(-1)

  const merchants = new Map(features('merchants').map(item => [item.id, item]))
  const places = new Map([...features('tourism'), ...features('venues')].map(item => [item.id, item]))
  const eventVenue = places.get(text(event?.properties.venueId))
  const eventPoint = eventVenue ? featureCenter(eventVenue) : event ? featureCenter(event) : null
  let excludedRoutes = 0
  const routes = features('route_packages').flatMap((feature): FusionRoute[] => {
    const props = feature.properties
    const tier = fusionTiers.find(item => item.scope === text(props.scope))
    const eventVolumes = fields(props.ordersByEvent)
    const linked = event && text(props.eventId) === event.id
    if (!tier || (period === 'event' && (!event || (!linked && !Object.hasOwn(eventVolumes,event.id))))) {
      excludedRoutes += 1
      return []
    }
    const status = text(props.status) || '未上架'
    const volumes = fields(props.ordersByMonth)
    const monthOfTotal = text(props.ordersMonth) || text(props.month)
    const datedVolume = monthInScope(monthOfTotal) && !Object.hasOwn(volumes, monthOfTotal) ? count(props.orders) : undefined
    const orders = event ? count(eventVolumes[event.id]) ?? (linked ? count(props.eventOrders) ??
      (eventDate && text(props.ordersDate) === eventDate ? count(props.orders) : undefined) : undefined)
      : total([...Object.entries(volumes).filter(([key]) => monthInScope(key)).map(([,value]) => count(value)), datedVolume])
    const place = places.get(text(props.destinationId))
    const merchantIds = [...new Set([...list(props.merchantIds), text(props.merchantId)].filter(Boolean))]
    const [source,destination] = endpoints(feature)

    return [{
      feature, id:feature.id, name:props.name, tier:tier.id, orders, status, published:status === '已上架',
      source:eventPoint ?? source, destination:destination ?? (place && featureCenter(place)) ?? null,
      from:text(eventVenue?.properties.name) || text(event?.properties.venue) || text(props.from) || '京山赛事场馆',
      to:text(props.to) || text(props.location) || text(place?.properties.name) || props.name,
      days:count(props.days), travelMinutes:count(props.travelMinutes), price:count(props.price),
      itinerary:list(props.itinerary).filter(item => !/^[一二三四五六七八九十\d]+[日天]游$/.test(item)), merchantIds,
      merchants:merchantIds.flatMap(id => { const merchant = merchants.get(id); return merchant ? [merchant] : [] }),
    }]
  }).sort((a,b) => (b.orders ?? -1) - (a.orders ?? -1) || a.name.localeCompare(b.name, 'zh-CN'))
  const totalOrders = total(routes.map(route => route.orders))
  const top = (items: FusionRoute[]) => items.find(route => route.published && (route.orders ?? 0) > 0)
  const tiers = fusionTiers.map(tier => {
    const items = routes.filter(route => route.tier === tier.id)
    const orders = total(items.map(route => route.orders))
    return {...tier, routes:items, orders, share:share(orders,totalOrders), top:top(items)}
  })
  return {periodLabel, observedThrough, eventDate, routes, tiers, totalOrders, localShare:tiers[0].share, top:top(routes), excludedRoutes}
}
