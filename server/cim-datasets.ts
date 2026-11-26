import { createHash } from 'node:crypto'
import type { FeatureCollection, Position } from 'geojson'
import type { CityFeature, Dataset, DataDocument } from '../src/jingshan/types.ts'
import { inPolygon } from '../src/jingshan/analytics.ts'
import { cimDatasetBindings } from '../src/jingshan/cim-datasets.ts'
import { checkDocument } from '../src/jingshan/validate.ts'
import type { CimService } from '../src/jingshan/cim-types.ts'

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value).trim()
  }
  return ''
}

function townAt(coordinates: Position, towns: CityFeature[]): string | undefined {
  return towns.find(({geometry}) => geometry.type === 'Polygon' ? inPolygon(coordinates, geometry.coordinates)
    : geometry.type === 'MultiPolygon' && geometry.coordinates.some(polygon => inPolygon(coordinates, polygon)))?.properties.name
}

export function updateCimDataset(draft: DataDocument, service: CimService, collection: FeatureCollection) {
  const binding = cimDatasetBindings[service.id]
  if (!binding || service.kind !== 'wfs') throw new Error('该服务没有对应的业务数据集')
  const previous = draft.datasets.find(item => item.id === binding.id)
  if (!collection.features.length && previous?.features.length) throw new Error('来源返回空集，已保留已有数据，请核对服务及查询条件')
  const towns = draft.datasets.find(item => item.id === 'administration')?.features
    .filter(item => item.properties.kind === 'town-boundary') ?? []
  const existing = new Map(previous?.features.map(item => [item.id, item]))
  const synchronized: CityFeature[] = collection.features.map((feature, index) => {
    const raw = feature.properties ?? {}
    const geometry = feature.geometry
    if (geometry?.type !== 'Point') throw new Error('第 ' + (index + 1) + ' 条机构记录不是点，已保留原数据')
    const sourceId = firstText(feature.id, raw.tysbdm, raw.CD_LSH, raw.objid)
    if (!sourceId) throw new Error('第 ' + (index + 1) + ' 条记录缺少稳定的来源编号')
    const id = service.id + '-' + createHash('sha256').update(sourceId).digest('hex').slice(0, 22)
    const sourceName = firstText(raw.gcmc, raw.gymc, raw.sqjcwhmc, raw.bjmc, raw.name, raw.mc)
    const name = sourceName || binding.name + '（名称待补）'
    const town = firstText(raw.xzjxzqhmc, raw.xzmc, raw.town)
    const inferredTown = town ? undefined : townAt(geometry.coordinates, towns)
    const region = firstText(town, inferredTown, raw.qxxzqhmc, '行政区待核实')
    // Retain locally maintained operational fields across subsequent source refreshes.
    const properties: CityFeature['properties'] = { ...existing.get(id)?.properties, name, region, kind: binding.kind }
    for (const key of ['address','students','regionMethod','sourceUpdatedAt','facilityType','sample']) delete properties[key]
    Object.assign(properties, {source: service.name, sourceServiceId: service.id, sourceFeatureId: sourceId, sourceAttributes: raw})
    if (inferredTown) properties.regionMethod = '按镇街边界空间匹配'
    if (raw.zl) properties.address = raw.zl
    if (raw.gxsj) properties.sourceUpdatedAt = raw.gxsj
    const students = firstText(raw.enrolment)
    if (binding.id === 'schools' && /^\d+$/.test(students)) properties.students = Number(students)
    if (raw.yljglx || raw.gylx || raw.education_type) properties.facilityType = firstText(raw.yljglx, raw.gylx, raw.education_type)
    return {type: 'Feature', id, geometry, properties}
  })
  const retained = previous?.features.filter(item => item.properties.sourceServiceId !== service.id && item.properties.sample !== true) ?? []
  const source = {serviceId: service.id, serviceName: service.name, syncedAt: new Date().toISOString(), count: synchronized.length}
  const dataset: Dataset = {
    id: binding.id, name: previous?.source ? previous.name : binding.name, department: previous?.source ? previous.department : binding.department,
    category: previous?.category || '公共设施', description: previous?.source ? previous.description : '来自京山 CIM 的机构名称、坐标及源属性，按批次完整同步。',
    features: [...synchronized, ...retained], source,
  }
  const result = {...draft, datasets: previous ? draft.datasets.map(item => item.id === binding.id ? dataset : item) : [...draft.datasets, dataset]}
  checkDocument(result)
  return {draft: result, datasetId: binding.id, count: synchronized.length}
}
