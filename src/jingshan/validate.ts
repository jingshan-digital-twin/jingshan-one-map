import { populationRaster, residentGridId } from './population-raster.ts'
import { checkMonitoringFeature } from './event-monitor-records.ts'
import { validatePortalCatalog } from './portal-catalog.ts'
import { overviewCourtStatsId } from './estimated-court-inventory.ts'
import { checkOverviewCourtStats } from './overview-inventory-form.ts'
import { chain, enterpriseDirectoryId } from './chain-taxonomy.ts'
import { checkMapBindings } from './map-bindings.ts'
import { ledgerTemplate } from './industry-ledgers.ts'
import { checkFormSchema, checkFormValues } from './platform-forms.ts'
import { checkEventPlanRecord, eventPlanDatasetId } from './event-platform-data.ts'
import { arrivalRecordKey, checkArrivalRecord, fusionArrivalsId } from './fusion-arrivals.ts'
import type { CityFeature, DataDocument, Dataset } from './types.ts'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function label(value: unknown, max = 120): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0')
}

function position(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length >= 2 && value.length <= 3 &&
    value.every(number => typeof number === 'number' && Number.isFinite(number)) &&
    Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90
}

function line(value: unknown, length: number): value is [number, number][] {
  return Array.isArray(value) && value.length >= length && value.every(position)
}

function polygon(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(ring =>
    line(ring, 4) && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] &&
    new Set(ring.map(point => point.slice(0, 2).join(','))).size >= 3)
}

export function acceptsPendingLocation(datasetId?: string) {
  return ['commerce_hotels','commerce_food','emergency_shelters'].includes(datasetId ?? '')
}

function geometry(value: unknown, kind: unknown, datasetId?: string, customForm = false) {
  if (!record(value)) return false
  const { type, coordinates } = value
  if (type === 'GeometryCollection') return (kind === 'business' || acceptsPendingLocation(datasetId) || Boolean(ledgerTemplate(datasetId)) || customForm || (datasetId === 'event_actuals' && kind === 'event_actual')) &&
    Array.isArray(value.geometries) && value.geometries.length === 0
  if (type === 'Point') return position(coordinates)
  if (type === 'MultiPoint') return line(coordinates,1)
  if (type === 'MultiLineString') return Array.isArray(coordinates) && coordinates.length>0 && coordinates.every(path=>line(path,2))
  if (type === 'LineString') return line(coordinates, 2)
  if (type === 'Polygon') return polygon(coordinates)
  return type === 'MultiPolygon' && Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(polygon)
}

export function checkFeature(value: unknown, context: string, datasetId?: string, customForm = false): asserts value is CityFeature {
  if (!record(value) || value.type !== 'Feature' || !label(value.id, 150) ||
      !record(value.properties) || !label(value.properties.name) || !label(value.properties.region) ||
      !label(value.properties.kind) || !geometry(value.geometry, value.properties.kind, datasetId, customForm)) {
    throw new Error(context + '：检查要素 ID、名称、行政区、类别和 WGS84 GeoJSON 几何（面必须闭合）')
  }
  if (value.properties.kind === 'court' && record(value.geometry) &&
      !['Polygon', 'MultiPolygon'].includes(String(value.geometry.type))) {
    throw new Error(context + '：网球场地必须使用面几何')
  }
}

export function checkDataset(value: unknown, ids = new Set<string>()): asserts value is Dataset {
  if (!record(value) || !label(value.id, 72) || !/^[a-z][a-z0-9_-]*$/.test(value.id) ||
      !label(value.name) || !label(value.department) || !label(value.category) ||
      typeof value.description !== 'string' || value.description.length > 800 || !Array.isArray(value.features)) {
    throw new Error('数据集需包含英文 ID、名称、部门、分类、说明和要素数组')
  }
  if (value.features.length > 12000) throw new Error(value.name + '：单个数据集最多 12,000 条要素')
  const schema = value.formSchema
  if (schema !== undefined) {
    if (!String(value.id).startsWith('form_') && ![eventPlanDatasetId,'event_live_monitors','event_live_points','event_live_incidents','event_live_alerts'].includes(value.id))
      throw new Error('自定义表单 ID 应以 form_ 开头')
    checkFormSchema(schema)
  }
  if (value.source !== undefined) {
    const source = value.source
    if (!record(source) || !label(source.serviceId, 150) || !label(source.serviceName) ||
      !label(source.syncedAt, 60) || !Number.isFinite(Date.parse(source.syncedAt)) ||
      typeof source.count !== 'number' || !Number.isInteger(source.count) || source.count < 0) {
      throw new Error(value.name + '：请核对来源服务、同步日期和记录数')
    }
  }
  const directory = value.id === 'businesses' && record(value.source) && value.source.serviceId === enterpriseDirectoryId
  const topics = new Set<string>(chain.flatMap(stage => [...stage.topics]))
  const names = new Set<string>()
  const codes = new Set<string>()
  const arrivalKeys=new Set<string>()
  const uniqueFields = (schema?.fields ?? []).filter(field => field.unique).map(field => ({field, seen:new Set<string>()}))
  value.features.forEach((feature, index) => {
    checkFeature(feature, value.name + '第 ' + (index + 1) + ' 条', String(value.id), !!schema)
    if (value.id===fusionArrivalsId) {
      checkArrivalRecord(feature.properties)
      const key=arrivalRecordKey(feature.properties)
      if (arrivalKeys.has(key)) throw new Error('同一天的全市汇总或同一来源地市分项不能重复')
      arrivalKeys.add(key)
    }
    if (String(value.id).startsWith('event_live_')) checkMonitoringFeature(String(value.id),feature)
    if (schema) {
      try {
        checkFormValues(schema.fields,feature.properties)
        if (value.id===eventPlanDatasetId) checkEventPlanRecord(feature.properties)
      }
      catch (error) { throw new Error(value.name + '第 ' + (index+1) + ' 条：' + (error instanceof Error ? error.message : '填报值无效')) }
      for (const {field, seen} of uniqueFields) {
        const raw = feature.properties[field.key]
        if (raw == null || raw === '' || (Array.isArray(raw) && !raw.length)) continue
        const key = JSON.stringify(Array.isArray(raw) ? [...raw].sort() : typeof raw === 'string' ? raw.trim() : raw)
        if (seen.has(key)) throw new Error(value.name + '第 ' + (index+1) + ' 条：' + field.label + ' 不可重复')
        seen.add(key)
      }
    }
    if (directory) {
      const p = feature.properties
      const name = p.name.normalize('NFKC').trim()
      const code = typeof p.creditCode === 'string' ? p.creditCode.trim().toUpperCase() : ''
      if (names.has(name) || (code && codes.has(code))) throw new Error('企业名录存在重复主体：' + name)
      names.add(name)
      if (code) codes.add(code)
      if (p.sample === true || !Array.isArray(p.chainTopics) || !p.chainTopics.length || !p.chainTopics.every(topic => topics.has(topic)) ||
          !Array.isArray(p.sources) || !p.sources.length || !p.sources.every(source => record(source) && label(source.title,300) &&
          label(source.evidence,2000) && label(source.url,2000) && /^https?:\/\//i.test(source.url))) {
        throw new Error(name + '：请填写企业名录中的 chainTopics 环节，以及 sources 依据的标题、网页地址和业务说明')
      }
    }
    if (ids.has(feature.id)) throw new Error('重复要素 ID：' + feature.id)
    ids.add(feature.id)
    if (value.id === 'courts' && (!['Polygon', 'MultiPolygon'].includes(feature.geometry.type) ||
        feature.properties.kind !== 'court')) throw new Error('场地数据需使用 kind= court 的面要素')
    if (value.id === 'court_footprints' && (!['Polygon', 'MultiPolygon'].includes(feature.geometry.type) ||
        feature.properties.kind !== 'court-footprint')) throw new Error('网球场地边界需使用 kind= court-footprint 的面要素')
  })
  if (value.id===residentGridId && value.features.length && !populationRaster(value as Dataset)) throw new Error('100 米人口网格需保留原始栅格结构')
  if (value.id === overviewCourtStatsId) checkOverviewCourtStats(value as Dataset)
}

export function checkDocument(value: unknown): asserts value is DataDocument {
  if (!record(value) || !Array.isArray(value.datasets) || value.datasets.length > 100 ||
      !record(value.rules) || !['demo', 'live'].includes(String(value.mode))) {
    throw new Error('配置需包含 datasets、rules 和数据标识 mode（demo 或 live）')
  }
  const ids = new Set<string>()
  if (value.portalCatalog !== undefined) validatePortalCatalog(value.portalCatalog)
  const datasets = new Set<string>()
  for (const dataset of value.datasets) {
    checkDataset(dataset, ids)
    if (datasets.has(dataset.id)) throw new Error('重复数据集 ID：' + dataset.id)
    datasets.add(dataset.id)
  }
  checkMapBindings(value.mapBindings, value.datasets)
  if (value.serviceRemovals !== undefined) {
    if (!Array.isArray(value.serviceRemovals)) throw new Error('待删除服务需为列表')
    const ids = new Set<string>()
    for (const row of value.serviceRemovals) {
      if (!record(row) || typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(row.id) ||
          typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision<1 || ids.has(row.id))
        throw new Error('待删除服务的编号或修订号无效')
      ids.add(row.id)
    }
    if (value.mapBindings?.some(b=>b.serviceId && ids.has(b.serviceId))) throw new Error('请先移除待删除服务的地图绑定')
  }
  for (const [key, entry] of Object.entries(value.rules)) {
    if (!/^[a-z][a-z0-9_]*$/i.test(key) || typeof entry !== 'number' || !Number.isFinite(entry) ||
        entry < 0 || entry > 10_000_000) throw new Error('无效规则参数：' + key)
    if (/(share|ratio)$/i.test(key) && entry > 1) throw new Error(key + ' 应填写 0 至 1 的小数')
    if (/(occupancy|areaM2|walkM|cycleM|driveM|radiusM|pointPeople|ambulancePeople|peoplePerCourt)$/i.test(key) && entry <= 0) {
      throw new Error(key + ' 必须大于 0')
    }
  }
  if (value.imagery !== undefined) {
    const imagery = value.imagery
    if (!record(imagery) || !label(imagery.url, 1500) || !/^https:\/\//i.test(imagery.url) ||
        !label(imagery.credit) || !Array.isArray(imagery.bounds) || imagery.bounds.length !== 4 ||
        !position(imagery.bounds.slice(0, 2)) || !position(imagery.bounds.slice(2, 4)) ||
        imagery.bounds[0] >= imagery.bounds[2] || imagery.bounds[1] >= imagery.bounds[3]) {
      throw new Error('自定义影像需提供 HTTPS 单图地址、署名及西南东北边界')
    }
  }
}
