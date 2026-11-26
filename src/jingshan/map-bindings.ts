import { isCimBasemap, type CimKind, type CimService } from './cim-types.ts'
import { isPlatformFormDataset } from './platform-forms.ts'
import type { Dataset } from './types.ts'
import { pages, type V3Page } from './v3-navigation.ts'

export type MapScope = 'all' | V3Page
export type MapBinding = { scope: MapScope; slot: string; serviceId: string | null }
export type MapSlot = { id: string; name: string; group: string }
type ServiceRef = Pick<CimService, 'id' | 'kind' | 'category' | 'enabled'>

export function mapSlots(datasets: readonly Dataset[]): MapSlot[] {
  const slots = [
    {id:'basemap', name:'基础影像', group:'地图底座'},
    {id:'townBoundaries', name:'乡镇界线', group:'基础地理'},
    {id:'roadNetwork', name:'道路网', group:'基础地理'},
    {id:'model', name:'三维模型', group:'地图底座'},
  ]
  for (const item of datasets) {
    if (['administration','road_network','event_road_controls'].includes(item.id) || isPlatformFormDataset(item)) continue
    slots.push({id:'dataset:' + item.id, name:item.name, group:item.category})
  }
  return slots
}

export function acceptsMapService(slot:string, service:ServiceRef) {
  if (!service.enabled) return false
  if (slot === 'basemap') return ['wms','xyz','wmts'].includes(service.kind)
  if (slot === 'model') return service.kind === '3dtiles'
  return service.kind !== '3dtiles' && !isCimBasemap(service)
}

export function checkMapBindings(value: unknown, datasets: readonly Dataset[]): asserts value is MapBinding[] | undefined {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new Error('地图绑定需为列表')
  const slots = new Set(mapSlots(datasets).map(slot => slot.id))
  if (value.length > slots.size * (1 + Object.keys(pages).length)) throw new Error('地图绑定数量超出场景和图层数')
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.scope !== 'string' ||
        (item.scope !== 'all' && !Object.hasOwn(pages,item.scope)) || !slots.has(item.slot) ||
        !(item.serviceId === null || typeof item.serviceId === 'string' && /^[a-zA-Z0-9_-]{1,150}$/.test(item.serviceId))) {
      throw new Error('地图绑定包含无效的场景、图层或服务')
    }
    if (item.serviceId?.startsWith('hosted-') && !datasets.some(d=>d.id===item.serviceId.slice(7) && !d.derivedFrom && !isPlatformFormDataset(d))) {
      throw new Error('已绑定的托管服务缺少源图层，请先更换绑定')
    }
    const key = item.scope + '/' + item.slot
    if (seen.has(key)) throw new Error('同一场景的同一图层只能指定一个来源')
    seen.add(key)
  }
}

export function resolveMapBindings(bindings: readonly MapBinding[] = [], scope: MapScope) {
  const resolved = new Map<string, string | null>()
  for (const item of bindings) if (item.scope === 'all') resolved.set(item.slot,item.serviceId)
  for (const item of bindings) if (item.scope === scope) resolved.set(item.slot,item.serviceId)
  return resolved
}

export function checkBindingServices(bindings: readonly MapBinding[], services: readonly ServiceRef[]) {
  const catalog = new Map(services.map(service => [service.id,service]))
  for (const item of bindings) {
    if (item.serviceId === null) continue
    const service = catalog.get(item.serviceId)
    if (!service || !acceptsMapService(item.slot,service)) throw new Error('绑定的服务已移除、未启用或协议不兼容，请重新选择来源：' + item.serviceId)
  }
  for (const scope of new Set(bindings.map(item=>item.scope))) {
    const resolved = resolveMapBindings(bindings,scope)
    const base = resolved.get('basemap')
    if (base && [...resolved].some(([slot,id]) => slot !== 'basemap' && id === base)) throw new Error('同一场景的底图服务不能同时充当叠加图层')
  }
}

export const bindingProtocolNames: Record<'basemap'|'model'|'overlay', readonly CimKind[]> = {
  basemap:['wms','wmts','xyz'], model:['3dtiles'], overlay:['wms','wfs','geojson','arcgis','wmts','xyz'],
}
