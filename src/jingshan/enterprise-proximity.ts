import type { Geometry, Position } from 'geojson'
import { distanceM, inPolygon } from './analytics.ts'
import type { CatalogEnterprise, ChainTopic } from './industry-panorama.ts'
import type { CityFeature, Coordinate, Dataset } from './types.ts'

export type ProximityMatch = {
  key: string
  datasetId: string
  feature: CityFeature
  name: string
  category: string
  label: string
  distanceMeters: number
  originLabel: string
  originSource: string
  originUrl?: string
  source: string
  sourceUrl?: string
  sourceDate?: string
  method: string
  serviceContext: string
}

type Target = 'sports' | 'tourism'
export type ServiceProximityPolicy = {
  eligible: boolean
  reason: string
  targets: Target[]
  topics: ChainTopic[]
}

const stringValue = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const normalized = (name: string) => name.normalize('NFKC').replace(/\s+/g, '')
const publicUrl = (value: unknown) => /^https?:\/\//i.test(stringValue(value)) ? stringValue(value) : undefined

function usableLocationSource(feature: CityFeature, value: unknown) {
  const source = stringValue(value)
  return feature.properties.sample === true || !source || /示例|样例|演示|模拟|随机|待核实|未记录|\b(?:demo|sample|mock|simulated)\b/i.test(source) ? '' : source
}

function validCoordinate(point: Position): point is Coordinate {
  return point.length >= 2 && Number.isFinite(point[0]) && Math.abs(point[0]) <= 180 &&
    Number.isFinite(point[1]) && Math.abs(point[1]) <= 90
}

// Project locally to identify the closest point on a short facility edge, then
// measure to that point with the same great-circle distance used by the city map.
function segmentDistance(origin: Coordinate, a: Position, b: Position) {
  const longitudeScale = Math.cos(origin[1] * Math.PI / 180)
  const dx = (b[0] - a[0]) * longitudeScale
  const dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  const fraction = lengthSquared ? Math.max(0, Math.min(1,
    ((origin[0] - a[0]) * longitudeScale * dx + (origin[1] - a[1]) * dy) / lengthSquared)) : 0
  return distanceM(origin, [a[0] + fraction * (b[0] - a[0]), a[1] + fraction * dy])
}

function facilityDistance(origin: Coordinate, geometry: Geometry) {
  if (geometry.type === 'Point') {
    return validCoordinate(geometry.coordinates) ? distanceM(origin, geometry.coordinates) : Infinity
  }
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  let closest = Infinity
  for (const polygon of polygons) {
    if (!polygon.length || !polygon.every(ring => ring.length >= 4 && ring.every(validCoordinate) &&
      ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1])) continue
    if (inPolygon(origin, polygon)) return 0
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) {
        closest = Math.min(closest, segmentDistance(origin, ring[i - 1], ring[i]))
      }
    }
  }
  return closest
}

const serviceTopics: ChainTopic[] = ['住宿接待', '餐饮服务', '购物展销', '运动康养', '景区游览', '场馆运营', '俱乐部运营', '培训陪练']
const visitorTopics: ChainTopic[] = ['住宿接待', '餐饮服务', '购物展销']
const retailSite = /门店|直营店|专卖店|专营店|零售店|实体店|线下店|展厅|展示中心|展销中心/
const nonOperatingSite = /登记地址|注册地址|登记住所|工商登记|注册地所在|集团总部|总部办公|办公地址|公司总部|生产车间|仓储点/
const temporaryService = /嘉年华|摆摊|临时摊|临时供餐|赛事现场|现场供餐/
const facilityLayers = new Set(['courts', 'venues', 'cim_parks', 'tourism'])

function hasRetailSite(text: string) {
  return text.split(/[，。；、]/).some(clause => retailSite.test(clause) &&
    !/线上门店|网上门店|虚拟门店|未开|不设|尚无|没有|计划|筹建|拟建|向.*门店供货/.test(clause))
}

/** The chain code identifies the activity; site evidence distinguishes a
 * physical visitor service from online sales, temporary stalls or investment. */
export function enterpriseServicePolicy(enterprise: CatalogEnterprise): ServiceProximityPolicy {
  const p = enterprise.feature.properties
  const registered = new Set(enterprise.memberships.flatMap(group => group.topics))
  const business = stringValue(p.mainBusiness)
  const skip = (reason: string): ServiceProximityPolicy => ({ eligible: false, reason, targets: [], topics: [] })
  if (p.sample === true) return skip('演示主体不参与服务距离分析。')
  if (/停业|歇业|注销|吊销|闭店|尚未开业|筹建|在建/.test([p.businessPhase, p.registrationStatus].join(' ')) ||
      /(?:仅|只)(?:从事|负责|提供)?(?:投资|融资|持股|招商)|尚未(?:开业|营业)/.test(business)) {
    return skip('当前业务资料尚未显示该主体经营面向到访者的服务。')
  }
  let topics = serviceTopics.filter(topic => registered.has(topic))
  if (!topics.length) {
    if (registered.has('赛事组织')) return skip('赛事承办、统筹或赞助关系按具体赛事凭证判断。')
    return skip('该主体的供货、生产或建设关系按合同及项目凭证判断。')
  }
  const siteNames = Array.isArray(p.siteNames) ? p.siteNames.map(stringValue) : []
  const siteLabels = enterprise.points.map(entry => stringValue(entry.feature.properties.locationLabel))
  const venues = [...siteNames, ...siteLabels].filter(label => !nonOperatingSite.test(label)).join('、')
  if (topics.includes('购物展销')) {
    const sources = Array.isArray(p.sources) ? p.sources : []
    const attributedShop = sources.some(source => {
      const evidence = stringValue(source?.evidence)
      const start = evidence.indexOf(p.name + '的')
      return start >= 0 && hasRetailSite(evidence.slice(start + p.name.length + 1).split(/[、，。与及]/)[0])
    })
    if (!hasRetailSite(venues) && !hasRetailSite(business) && !attributedShop) {
      topics = topics.filter(topic => topic !== '购物展销')
    }
  }
  if (topics.includes('餐饮服务') && temporaryService.test(business) &&
      !/门店|餐厅|餐馆|饭店|酒店|食堂|堂食|固定餐饮/.test(venues + business)) {
    topics = topics.filter(topic => topic !== '餐饮服务')
  }
  if (!topics.length) return skip('档案只确认销售渠道或活动现场服务，尚无常设接待场所的业务依据。')
  const servesVisitors = topics.some(topic => visitorTopics.includes(topic))
  const targets: Target[] = servesVisitors ? ['sports', 'tourism'] : ['sports']
  const targetText = servesVisitors ? '体育场地与游览目的地' : '体育场地'
  return { eligible: true, topics, targets,
    reason: '按' + topics.join('、') + '业务，测算经营场所与' + targetText + '的直线距离。' }
}

// The sports bureau documents a tennis event at this park. CIM provides a
// park marker only, so its distance must never be shown as distance to a court.
const wenfengEvent = 'https://www.sport.gov.cn/n14471/n14488/n14525/c25811709/content.html'
function facilityCategory(id: string, feature: CityFeature, policy: ServiceProximityPolicy) {
  const { name, sourceServiceId, facilityType, status, businessPhase, sourceAttributes } = feature.properties
  const facilityStatus = sourceAttributes && typeof sourceAttributes === 'object' && 'objstate' in sourceAttributes ? sourceAttributes.objstate : ''
  if (/在建|拟建|待建|尚未开放|停运|停业|已关闭|已拆除|废弃/.test([status, businessPhase, facilityStatus].join(' '))) return ''
  switch (id) {
    case 'courts': return '球场'
    case 'venues': return '场馆'
    case 'cim_parks':
      if (sourceServiceId === 'cim-13' && name === '文峰公园') return '网球赛事举办地'
      return /体育公园|运动公园|网球公园/.test(name + stringValue(facilityType)) ? '体育公园' : ''
    case 'tourism': return policy.targets.includes('tourism') ? /文化馆|博物馆/.test(name) ? '文化场馆' : '景区' : ''
    default: return ''
  }
}

function locationMarkers(enterprise: CatalogEnterprise) {
  return enterprise.points.flatMap(({ feature }) => {
    const p = feature.properties
    const source = usableLocationSource(feature, p.locationSource)
    if (!source || nonOperatingSite.test([p.locationLabel, p.locationSource].join(' ')) ||
        feature.geometry?.type !== 'Point' || !validCoordinate(feature.geometry.coordinates)) return []
    const site = p.sitePoint && typeof p.sitePoint === 'object' ? p.sitePoint as Record<string, unknown> : {}
    return [{ coordinate: feature.geometry.coordinates, source, url: publicUrl(site.url),
      label: stringValue(p.locationLabel) || p.name }]
  })
}

function ownSites(enterprise: CatalogEnterprise) {
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const { feature } of [enterprise, ...enterprise.points]) {
    const p = feature.properties
    ids.add(feature.id)
    if (p.locationFeatureId) ids.add(String(p.locationFeatureId))
    const site = p.sitePoint && typeof p.sitePoint === 'object' ? p.sitePoint as Record<string, unknown> : {}
    for (const name of [p.name, stringValue(site.name), ...(Array.isArray(p.siteNames) ? p.siteNames : [])]) {
      if (typeof name === 'string' && name) names.add(normalized(name))
    }
  }
  return { ids, names }
}

const sportFacilities = new Set(['球场', '场馆', '体育公园', '网球赛事举办地'])
function matchOrder(a: ProximityMatch, b: ProximityMatch) {
  return Number(sportFacilities.has(b.category)) - Number(sportFacilities.has(a.category)) ||
    a.distanceMeters - b.distanceMeters || a.key.localeCompare(b.key)
}

/** Independently sourced physical facilities around a documented enterprise site. */
export function buildEnterpriseProximity(datasets: Dataset[], enterprise: CatalogEnterprise, radiusKm = 3) {
  const radius = Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : 3
  const policy = enterpriseServicePolicy(enterprise)
  const origins = policy.eligible ? locationMarkers(enterprise) : []
  const result = { policy, located: origins.length > 0, radiusKm: radius, matches: [] as ProximityMatch[] }
  if (!origins.length) return result
  const own = ownSites(enterprise)
  const bySite = new Map<string, ProximityMatch>()
  for (const dataset of datasets) {
    if (!facilityLayers.has(dataset.id)) continue
    for (const feature of dataset.features) {
      const p = feature.properties
      const name = stringValue(p.name)
      const category = facilityCategory(dataset.id, feature, policy)
      if (!category || !name || !feature.geometry || own.ids.has(feature.id) || own.names.has(normalized(name))) continue
      const source = usableLocationSource(feature, p.source ||
        (p.sourceServiceId === dataset.source?.serviceId && dataset.source?.serviceName))
      if (!source) continue
      const samePoint = feature.geometry.type === 'Point'
      const candidates = origins.map(origin => ({ origin, distance: facilityDistance(origin.coordinate, feature.geometry) }))
      if (samePoint && candidates.some(item => item.distance < 1)) continue
      const { origin, distance } = candidates.reduce((a, b) => a.distance <= b.distance ? a : b)
      if (distance > radius * 1000) continue
      const key = dataset.id + ':' + feature.id
      const objectKey = p.sourceFeatureId && p.sourceServiceId
        ? String(p.sourceServiceId) + ':' + String(p.sourceFeatureId) : key
      const distanceLabel = distance < 10 ? '不足 10 米' : distance < 1000 ? '约 ' + Math.round(distance / 10) * 10 + ' 米'
        : '约 ' + (distance / 1000).toFixed(1) + ' 公里'
      const within = !samePoint && distance === 0
      const match: ProximityMatch = { key, datasetId: dataset.id, feature, name, category,
        label: within ? '位于' + category + '范围内' : '邻近' + category + ' · ' + distanceLabel,
        distanceMeters: distance, originLabel: origin.label, originSource: origin.source, originUrl: origin.url,
        source, sourceUrl: publicUrl(p.sourceUrl), sourceDate: stringValue(p.sourceUpdatedAt) || undefined,
        serviceContext: category + '与' + policy.topics.join('、') + '经营点的区位联系，实际接待情况需查阅业务记录。',
        method: samePoint ? '企业定位点至设施标注点的直线距离' : '企业定位点至设施范围的最短直线距离，范围内记为 0 米' }
      if (category === '网球赛事举办地') {
        match.source += '（公园点位）、湖北省体育局（2023 年网球之乡杯京山站）'
        match.sourceUrl = wenfengEvent
        match.method = '企业定位点至文峰公园 CIM 标注点的直线距离，球场入口位置未单独标注'
      }
      const previous = bySite.get(objectKey)
      if (!previous || matchOrder(match, previous) < 0) bySite.set(objectKey, match)
    }
  }
  for (const match of [...bySite.values()].sort(matchOrder)) {
    const geometry = match.feature.geometry
    const duplicate = geometry.type === 'Point' && result.matches.some(other => {
      const otherGeometry = other.feature.geometry
      return normalized(match.name) === normalized(other.name) && otherGeometry.type === 'Point' &&
        validCoordinate(geometry.coordinates) && validCoordinate(otherGeometry.coordinates) &&
        distanceM(geometry.coordinates, otherGeometry.coordinates) <= 50
    })
    if (!duplicate) result.matches.push(match)
  }
  return result
}
