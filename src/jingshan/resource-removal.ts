import type { CimAdminService } from './cim-types.ts'
import type { DataDocument, Dataset } from './types.ts'

export type ResourceTarget = {kind:'dataset'; id:string} | {kind:'service'; service:CimAdminService}

export function draftServices(services:CimAdminService[], data?:DataDocument) {
  if (!data) return services
  const sourceIds = new Set(data.datasets.map(d=>d.id))
  const pending = new Set(data.serviceRemovals?.map(s=>s.id))
  return services.filter(s=>!pending.has(s.id) && (!s.hostedDatasetId || sourceIds.has(s.hostedDatasetId)))
}

export function planResourceRemoval(data:DataDocument, target:ResourceTarget) {
  let source:Dataset | undefined
  const datasets = new Set<string>(), services = new Set<string>()
  if (target.kind === 'dataset') {
    source = data.datasets.find(row=>row.id===target.id)
    if (!source) throw new Error('找不到这份数据集，请重新打开资源目录')
    if (source.derivedFrom) throw new Error('这是由源数据生成的展示图层，仅支持预览')
    const children = new Map<string,Dataset[]>()
    for (const row of data.datasets) {
      if (!row.derivedFrom) continue
      const group = children.get(row.derivedFrom) ?? []
      group.push(row)
      children.set(row.derivedFrom,group)
    }
    const remaining = [source]
    while (remaining.length) {
      const row = remaining.pop()!
      if (datasets.has(row.id)) continue
      datasets.add(row.id)
      services.add('hosted-'+row.id)
      remaining.push(...(children.get(row.id) ?? []))
    }
  } else services.add(target.service.id)

  const keys = new Set([...Array.from(datasets,id=>'dataset:'+id),...Array.from(services,id=>'service:'+id)])
  const bindings = (data.mapBindings ?? []).filter(b=>keys.has(b.slot) || (b.serviceId !== null && services.has(b.serviceId)))
  const folders = (data.portalCatalog?.folders ?? []).filter(f=>f.resources.some(k=>keys.has(k)))
  const next:DataDocument = {...data,datasets:data.datasets.filter(d=>!datasets.has(d.id))}
  if (bindings.length) next.mapBindings = data.mapBindings!.filter(b=>!bindings.includes(b))
  if (folders.length) next.portalCatalog = {folders:data.portalCatalog!.folders.map(f=>folders.includes(f) ?
    {...f,resources:f.resources.filter(k=>!keys.has(k))} : f)}
  if (target.kind === 'service') {
    const {id,revision} = target.service
    next.serviceRemovals = [...(data.serviceRemovals ?? []).filter(s=>s.id!==id),{id,revision}]
  }
  return {next, source, children:data.datasets.filter(d=>d.id!==source?.id && datasets.has(d.id)), services, bindings, folders}
}

export function planBulkRemoval(data:DataDocument,targets:ResourceTarget[]){
  let next=data
  const sources=new Set<string>(),services=new Set<string>()
  for(const target of targets){
    if(target.kind==='dataset' && sources.has(target.id) || target.kind==='service' && services.has(target.service.id))continue
    const plan=planResourceRemoval(next,target)
    if(target.kind==='dataset')sources.add(target.id)
    plan.services.forEach(id=>services.add(id))
    next=plan.next
  }
  return {next,sources:[...sources],services,bindings:(data.mapBindings?.length??0)-(next.mapBindings?.length??0)}
}

// Whole-dataset intent is separate from the GeoJSON records in a draft update.
export function missingSourceDatasets(previous:DataDocument, next:DataDocument) {
  const remaining=new Set(next.datasets.map(row=>row.id))
  return previous.datasets.filter(row=>!row.derivedFrom && !remaining.has(row.id))
}

export function checkDatasetRemovals(previous:DataDocument, next:DataDocument, confirmed:unknown) {
  const ids=new Set(Array.isArray(confirmed) ? confirmed : [])
  const missing=missingSourceDatasets(previous,next).find(row=>!ids.has(row.id))
  if (missing) throw new Error('草稿将删除整份「'+missing.name+'」。请在该数据集或表单的设置中单独确认整项删除。')
}
