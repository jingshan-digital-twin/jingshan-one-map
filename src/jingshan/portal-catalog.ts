import type { Dataset } from './types.ts'
import type { CimAdminService } from './cim-types.ts'
import { populationRecordCount, residentGridId } from './population-raster.ts'
import { isCourtLedgerId } from './court-ledger.ts'
import { isPlatformFormDataset } from './platform-forms.ts'

export type CatalogFolder = {
  id: string
  name: string
  parent: string
  resources: string[]
  workspaceOnly?: boolean
}
export type PortalCatalog = { folders: CatalogFolder[] }
export type CatalogAsset = {
  key: string
  id: string
  name: string
  type: 'local' | 'views' | 'services' | 'forms'
  sourceName?: string
  format: string
  group: string
  detail: string
  info: string
  style: string
  dataset?: Dataset
  service?: CimAdminService
}
export const catalogTypes = { local: '空间源数据', views: '展示图层', services: '地图服务', forms: '业务表单' }
export function datasetCatalogType(dataset:Dataset): 'local' | 'views' | 'forms' {
  if (dataset.derivedFrom) return 'views'
  return isPlatformFormDataset(dataset) ? 'forms' : 'local'
}
function recordUnit(dataset:Dataset) {
  if (dataset.id===residentGridId) return ' 个像元'
  if (dataset.id==='venues') return ' 处场馆'
  if (isCourtLedgerId(dataset.id) || isCourtLedgerId(dataset.derivedFrom) && ['courts','court_footprints'].includes(dataset.id)) return ' 片场地'
  return isPlatformFormDataset(dataset) ? ' 条记录' : ' 个要素'
}
const collator = new Intl.Collator('zh-CN', { numeric: true })
export function catalogAssets(datasets: Dataset[], services: CimAdminService[]) {
  const names=new Map(datasets.map(d=>[d.id,d.name]))
  const assets: CatalogAsset[] = datasets.map((dataset) => {
    const type = datasetCatalogType(dataset)
    const form = type === 'forms'
    return {
      key: 'dataset:' + dataset.id,
      id: dataset.id,
      name: dataset.name,
      type,
      sourceName: dataset.derivedFrom ? names.get(dataset.derivedFrom) ?? dataset.derivedFrom : dataset.source?.serviceName,
      format: dataset.id===residentGridId ? 'GeoTIFF' : form ? '表单' : 'GeoJSON',
      group: dataset.category,
      detail: dataset.description,
      info: populationRecordCount(dataset).toLocaleString('zh-CN') + recordUnit(dataset),
      style: form ? 'form' : dataset.id.includes('population') ? 'density' : 'vector',
      dataset,
    }
  })
  for (const service of services)
    assets.push({
      key: 'service:' + service.id,
      id: service.id,
      name: service.name,
      type: 'services',
      sourceName: service.hostedDatasetId ? names.get(service.hostedDatasetId) ?? service.hostedDatasetId : undefined,
      format: service.kind === '3dtiles' ? '3D Tiles' : service.kind.toUpperCase(),
      group: service.category,
      detail: service.description,
      info: service.enabled ? '已启用' : '已停用',
      style: service.kind === '3dtiles' ? 'model' : service.category.includes('影像') ? 'image' : 'service',
      service,
    })
  const featured = [
    'dataset:administration',
    assets.find((a) => a.style === 'image' && a.service?.enabled)?.key,
    assets.find((a) => a.style === 'model' && a.name.includes('本地'))?.key,
    'dataset:'+residentGridId,
    'dataset:court_footprints',
    'dataset:venue_operations',
    'dataset:venues',
    'dataset:charging',
    'dataset:parcels',
  ]
  return assets.sort(
    (a, b) =>
      (featured.includes(a.key) ? featured.indexOf(a.key) : 100) -
        (featured.includes(b.key) ? featured.indexOf(b.key) : 100) || collator.compare(a.name, b.name),
  )
}
export function validatePortalCatalog(value: unknown): asserts value is PortalCatalog {
  const folders = (value as PortalCatalog | null)?.folders
  if (!Array.isArray(folders) || folders.length > 200) throw new Error('专题目录最多 200 个')
  const byId = new Map<string, CatalogFolder>()
  for (const f of folders) {
    if (
      !f ||
      typeof f.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(f.id) ||
      byId.has(f.id) ||
      typeof f.name !== 'string' ||
      !f.name.trim() ||
      f.name.length > 60 ||
      f.name.includes('\0') ||
      (f.workspaceOnly !== undefined && typeof f.workspaceOnly !== 'boolean') ||
      typeof f.parent !== 'string' ||
      !Array.isArray(f.resources) ||
      f.resources.length > 1000 ||
      f.resources.some(
        (key) => typeof key !== 'string' || !/^(dataset|service):[^\s:\x00]{1,160}$/.test(key),
      ) ||
      new Set(f.resources).size !== f.resources.length
    )
      throw new Error('请检查专题目录的名称、标识和资源')
    byId.set(f.id, f)
  }
  for (const f of folders) {
    const seen = new Set([f.id])
    let parent = f.parent
    while (parent) {
      const folder = byId.get(parent)
      if (!folder || seen.has(parent)) throw new Error('目录层级存在循环或上级目录不存在')
      seen.add(parent)
      parent = folder.parent
    }
  }
}
export function folderResources(folders: CatalogFolder[], id: string) {
  const keys = new Set<string>()
  const pending = [id],
    visited = new Set<string>()
  while (pending.length) {
    const current = pending.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    folders.find((f) => f.id === current)?.resources.forEach((k) => keys.add(k))
    pending.push(...folders.filter((f) => f.parent === current).map((f) => f.id))
  }
  return keys
}

export function publishedCatalog(catalog: PortalCatalog | undefined): PortalCatalog | undefined {
  if (!catalog) return undefined
  const map = new Map(catalog.folders.map((f) => [f.id, f]))
  return {
    folders: catalog.folders.filter((f) => {
      let node: CatalogFolder | undefined = f
      while (node) {
        if (node.workspaceOnly) return false
        node = map.get(node.parent)
      }
      return true
    }),
  }
}
