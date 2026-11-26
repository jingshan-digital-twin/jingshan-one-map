import type { FeatureCollection } from 'geojson'
import { isFeatureService, type CimService } from './cim-types.ts'
import type { DataDocument, Dataset } from './types.ts'
import { prepareGeoImport } from './platform-local-data.ts'

export type WfsFields = { identifier:string; name:string; region:string }

export function prepareWfsSync(draft:DataDocument, dataset:Dataset, service:Pick<CimService,'kind'|'id'|'name'>,
  collection:FeatureCollection, fields:WfsFields) {
  if (!isFeatureService(service.kind) || !Array.isArray(collection.features) || !collection.features.length) throw new Error('服务未返回可同步的要素')
  if (!fields.name) throw new Error('请选择名称字段')
  const known = new Map(dataset.features.filter(f=>f.properties.sourceServiceId===service.id && f.properties.sourceFeatureId!=null)
    .map(f=>[String(f.properties.sourceFeatureId),f]))
  const existingIds = new Set(dataset.features.map(row=>row.id))
  const kinds = new Set(dataset.features.map(row=>row.properties.kind))
  const defaultKind = kinds.size === 1 ? [...kinds][0] : kinds.size === 0 ? dataset.id : undefined
  const mapped = collection.features.map((feature,index)=>{
    const properties = feature.properties ?? {}
    const id = fields.identifier ? properties[fields.identifier] : feature.id
    if (!['string','number'].includes(typeof id) || !String(id).trim()) throw new Error('第 '+(index+1)+' 条缺少稳定的来源编号')
    const sourceId = String(id)
    const previous = known.get(sourceId)
    const name = properties[fields.name]
    if (typeof name !== 'string' || !name.trim()) throw new Error('第 '+(index+1)+' 条缺少名称，请核对字段')
    const region = fields.region ? properties[fields.region] : previous?.properties.region ?? '京山市'
    if (typeof region !== 'string' || !region.trim()) throw new Error('第 '+(index+1)+' 条缺少所属区域，请核对字段')
    const rowId = previous?.id ?? dataset.id+':'+service.id+':'+sourceId
    if (!previous && existingIds.has(rowId)) throw new Error('要素编号与已有业务记录冲突：'+rowId)
    const kind = properties.kind ?? previous?.properties.kind ?? defaultKind
    if (typeof kind!=='string' || !kind) throw new Error('目标数据集有多种要素类别，来源数据需提供 kind 字段')
    return {...feature,id:rowId,properties:{...properties,name,region,kind,sourceServiceId:service.id,sourceFeatureId:sourceId}}
  })
  const review = prepareGeoImport(draft,dataset,{...collection,features:mapped},'merge')
  const source = {serviceId:service.id,serviceName:service.name,syncedAt:new Date().toISOString(),count:mapped.length}
  const data = {...review.data,datasets:review.data.datasets.map(row=>row.id===dataset.id ? {...row,source} : row)}
  return {...review,data}
}
