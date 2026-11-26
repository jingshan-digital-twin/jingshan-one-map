import type { CityFeature, DataDocument, Dataset } from './types.ts'
import { isPopulationRaster, withPixelPopulation } from './population-raster.ts'
import { activeCourtSourceId, isCourtLedgerId, surveyCourtLedgerId, surveyCourtName, withCourtViews } from './court-ledger.ts'
import { featureCenter } from './types.ts'
import { formId } from './form-designer-id.ts'
import { importLedgerPolygons, reconcileCourtShape } from './court-shape-import.ts'
import { checkFormRowChanges, isPlatformFormDataset, operationalForm } from './platform-forms.ts'
import { acceptsPendingLocation, checkDocument, checkFeature } from './validate.ts'

export type ImportMode = 'append' | 'merge' | 'replace'
export type GeometryName = CityFeature['geometry']['type']
export const geometryLabels: Record<GeometryName,string> = {
  Point:'点', LineString:'线', Polygon:'面', MultiPolygon:'多面', GeometryCollection:'待定位',
  MultiPoint:'多点', MultiLineString:'多线',
}
export const localFileLimit = 18 * 1024 * 1024

export function withLocalDataset(draft:DataDocument, dataset:Dataset): DataDocument {
  const previous = draft.datasets.find(item => item.id === dataset.id)
  if (previous?.derivedFrom || dataset.derivedFrom) throw new Error('展示图层随源数据更新，请在源数据集中修改记录')
  const next = dataset.id === activeCourtSourceId(draft) ? withCourtViews(draft,dataset) : {
    ...draft, datasets:previous ? draft.datasets.map(item => item.id===dataset.id ? dataset : item) : [...draft.datasets,dataset],
  }
  checkDocument(next)
  return next
}

export function removeLocalFeature(draft:DataDocument,datasetId:string,featureId:string):DataDocument {
  const dataset=draft.datasets.find(d=>d.id===datasetId)
  if (!dataset || dataset.derivedFrom) throw new Error('请在源数据集中选择要删除的记录')
  if(isPopulationRaster(dataset))return withLocalDataset(draft,withPixelPopulation(dataset,featureId,null))
  const index=dataset.features.findIndex(f=>f.id===featureId)
  if (index<0) throw new Error('这条记录已不存在，请重新选择')
  const features=[...dataset.features.slice(0,index),...dataset.features.slice(index+1)]
  return withLocalDataset(draft,{...dataset,features})
}

function isObject(value:unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sameJson(left:unknown, right:unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((value,i) => sameJson(value,right[i]))
  if (!isObject(left) || !isObject(right)) return false
  const keys=Object.keys(left)
  return keys.length===Object.keys(right).length && keys.every(key=>Object.hasOwn(right,key) && sameJson(left[key],right[key]))
}

function readProperties(value:unknown, context:string) {
  if (value == null) return {}
  if (!isObject(value)) throw new Error(context + '的 properties 需为对象')
  return value
}

function checkCrs(crs:unknown) {
  if (crs == null) return
  const name = isObject(crs) && crs.type === 'name' && isObject(crs.properties) ? crs.properties.name : null
  if (typeof name !== 'string' || !/(?:^EPSG:4326$|^urn:ogc:def:crs:EPSG:(?:[^:]*:)?4326$|^urn:ogc:def:crs:OGC:[^:]*:CRS84$|^OGC:CRS84$)/i.test(name)) {
    throw new Error('请先将文件转换为 WGS84 经纬度坐标')
  }
}

export function prepareGeoImport(draft:DataDocument, dataset:Dataset, raw:unknown, mode:ImportMode) {
  if (!isObject(raw) || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) throw new Error('请导入 GeoJSON FeatureCollection')
  const form = isPlatformFormDataset(dataset)
  const op = operationalForm(dataset.id)
  if (form && raw.formDatasetId !== undefined && raw.formDatasetId !== dataset.id) throw new Error('文件属于另一张业务表单，请切换到对应的表单类型')
  checkCrs(raw.crs)
  if (!raw.features.length && !(form && mode==='replace')) throw new Error('文件中没有可导入的要素')
  if (raw.features.length > 12000) throw new Error('单个图层最多支持 12,000 条要素')
  const old = new Map(dataset.features.map(item => [item.id, item]))
  const imported = new Map<string, CityFeature>()
  let updated = 0
  let rows: unknown[] = raw.features
  if (raw.courtShape === true) {
    if (isCourtLedgerId(dataset.id)) rows = importLedgerPolygons(draft.datasets, dataset, rows)
    else if (dataset.id === 'court_footprints') rows = reconcileCourtShape(dataset, rows, mode === 'merge')
  }
  const defaultKind = dataset.id === 'courts' ? 'court' : dataset.id
  const fallbackKind = dataset.features[0]?.properties.kind || op?.kind || (dataset.formSchema ? 'form_record' : defaultKind)
  const links = op ? new Map(draft.datasets.find(d=>d.id===op.sourceId)?.features.map(row=>[row.id,row])) : undefined

  for (const [i, entry] of rows.entries()) {
    const label = '第 ' + (i + 1) + ' 条'
    if (!isObject(entry) || entry.type !== 'Feature') throw new Error(label + '缺少 Feature 类型')
    checkCrs(entry.crs)
    const props = readProperties(entry.properties, label)
    if (entry.id == null && mode === 'merge') throw new Error(label + '缺少要素 ID，按 ID 更新时每条记录都需要 ID')
    if (entry.id != null && typeof entry.id !== 'number' && typeof entry.id !== 'string') throw new Error(label + '的 ID 需为字符串或数字')
    const id = entry.id == null ? dataset.id + '-' + formId() : String(entry.id)
    if (imported.has(id)) throw new Error('文件内存在重复要素 ID：' + id)
    const existing = old.get(id)
    if (mode === 'append' && existing) throw new Error('目标图层已有 ID ' + id + '，可选择按 ID 更新')
    const previous = mode === 'merge' || form ? existing : undefined
    const defaults = !previous && dataset.formSchema
      ? Object.fromEntries(dataset.formSchema.fields.filter(f=>f.defaultValue!==undefined).map(f=>[f.key,f.defaultValue])) : {}
    const linked = op ? links?.get(String(props[op.linkKey] ?? previous?.properties[op.linkKey] ?? '')) : undefined
    const linkedRegion = op && linked && previous?.properties[op.linkKey] !== linked.id ? linked.properties.region : undefined
    const properties = {
      ...defaults, ...previous?.properties, ...props,
      name:props.name ?? props['名称'] ?? previous?.properties.name ?? (dataset.name + ' ' + (i + 1)),
      region:props.region ?? props['所属乡镇'] ?? props['行政区'] ?? linkedRegion ?? previous?.properties.region ?? '京山市',
      kind:props.kind ?? previous?.properties.kind ?? fallbackKind,
    }
    if (dataset.id===surveyCourtLedgerId) properties.name=surveyCourtName(properties)
    else if (raw.dbfEncodingUsed && typeof props['实体名称']==='string' && props['实体名称'].trim()) properties.name=props['实体名称']
    let geometry = !form && entry.geometry === null && (properties.kind === 'business' || acceptsPendingLocation(dataset.id))
      ? {type:'GeometryCollection',geometries:[]} : entry.geometry
    if (form && geometry == null) {
      geometry = previous?.geometry
      if (op && linked && (!geometry || linked.id!==previous?.properties[op.linkKey])) {
        const point = featureCenter(linked)
        geometry = point ? {type:'Point',coordinates:point} : linked.geometry
      } else if (!geometry && !op) geometry = {type:'GeometryCollection',geometries:[]}
      if (!geometry && op) throw new Error(label+'需要已有'+op.linkLabel+'的关联编号 '+op.linkKey)
    }
    const feature:unknown = {...(form?previous:undefined), ...entry, type:'Feature', id, properties, geometry}
    checkFeature(feature, label, dataset.id, !!dataset.formSchema)
    imported.set(id, feature)
    if (existing) updated++
  }

  const added = imported.size - updated
  const removed = mode === 'replace' ? old.size - updated : 0
  const features = mode === 'replace' ? [...imported.values()] : [
    ...dataset.features.map(item => imported.get(item.id) ?? item),
    ...[...imported.values()].filter(item => !old.has(item.id)),
  ]
  const nextDataset = {...dataset, features}
  const data = withLocalDataset(draft, nextDataset)
  if (form) checkFormRowChanges(nextDataset,dataset,data.datasets,sameJson)
  if (new Blob([JSON.stringify({revision: Number.MAX_SAFE_INTEGER, data})]).size > localFileLimit) {
    throw new Error('导入后草稿超出 18 MiB 的保存上限，请精简属性或压缩几何后重试')
  }
  return { data, added, updated, removed, total:features.length, first:[...imported.values()].slice(0,4) }
}
