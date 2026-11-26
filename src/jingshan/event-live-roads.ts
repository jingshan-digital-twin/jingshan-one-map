import type { LineString, MultiLineString } from 'geojson'
import type { CityFeature, Coordinate } from './types.ts'
import type { LiveEventMonitor, LiveTrafficStatus } from './event-live-types.ts'

type RoadContext = Pick<LiveEventMonitor, 'id' | 'position' | 'routes' | 'demo'>
export type LiveRoadLayer = { source: 'service' | 'published'; roads: CityFeature[] }

// Speed is in screen pixels per second, regardless of the map scale.
export const liveRoadStyles = {
  smooth: { label: '畅通', color: '#30c97d', speed: 46 },
  slow: { label: '缓行', color: '#ff9f36', speed: 24 },
  congested: { label: '拥堵', color: '#f24b52', speed: 8 },
  closed: { label: '封闭', color: '#6b3345', speed: 0 },
} satisfies Record<LiveTrafficStatus, { label: string; color: string; speed: number }>

export function venueOffset([lon, lat]: Coordinate, east: number, north: number): Coordinate {
  return [lon + east / (111320 * Math.cos(lat * Math.PI / 180)), lat + north / 111320]
}

function roadFeature(id: string, name: string, status: LiveTrafficStatus, geometry: LineString | MultiLineString, demo: boolean): CityFeature {
  return { type: 'Feature', id, geometry, properties: {
    name, region: '京山市', kind: 'event-live-road', mapRole: 'link', trafficStatus: status, demo,
    interactive: false, showLabel: false,
  } }
}

// Separate segments meet at their ends so a closed or congested section never shares a drawn path with a smooth section.
const exerciseSegments: { id: string; name: string; status: LiveTrafficStatus; path: Coordinate[] }[] = [
  { id: 'west', name: '西入口通道', status: 'congested', path: [[-420,-100],[-354,0],[-190,77],[-113,120]] },
  { id: 'north', name: '北侧停车场进场路', status: 'slow', path: [[-354,0],[-362,130],[-320,225],[-108,309],[76,270]] },
  { id: 'east', name: '东侧通行路', status: 'smooth', path: [[-113,120],[60,200],[245,173],[430,214]] },
  { id: 'south', name: '南侧接驳通道', status: 'smooth', path: [[60,200],[172,52],[275,-62],[345,-210],[-80,-319],[-278,-111],[-354,0]] },
  { id: 'access', name: '场馆内部临时封闭路段', status: 'closed', path: [[-113,120],[-62,24],[15,-62],[110,-128],[224,-154]] },
]

export function createDemoRoads(eventId: string, venue: Coordinate): CityFeature[] {
  return exerciseSegments.map(({ id, name, status, path }) => roadFeature(
    `${eventId}:demo-road:${id}`, name, status, {
      type: 'LineString', coordinates: path.map(([east, north]) => venueOffset(venue, east, north)),
    }, true,
  ))
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function trafficStatus(value: unknown): value is LiveTrafficStatus {
  return value === 'closed' || value === 'congested' || value === 'slow' || value === 'smooth'
}

function isLine(value: unknown): value is number[][] {
  return Array.isArray(value) && value.length >= 2 && value.every(point =>
    Array.isArray(point) && point.length >= 2 && point.every(Number.isFinite)
    && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90,
  ) && value.some(point => point[0] !== value[0][0] || point[1] !== value[0][1])
}

function readGeometry(value: unknown): LineString | MultiLineString | undefined {
  if (!object(value)) return
  const { type, coordinates } = value
  if (type === 'LineString' && isLine(coordinates)) return { type, coordinates }
  if (type === 'MultiLineString' && Array.isArray(coordinates) && coordinates.length && coordinates.every(isLine)) {
    return { type, coordinates }
  }
}

function serviceRoads(payload: unknown, eventId: string): CityFeature[] {
  if (!object(payload) || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw new Error('道路服务未返回 GeoJSON FeatureCollection')
  }
  return payload.features.flatMap((feature: unknown, index: number) => {
    if (!object(feature) || feature.type !== 'Feature' || !object(feature.properties)) {
      throw new Error(`道路服务第 ${index + 1} 条记录格式有误`)
    }
    if (feature.properties.sample===true || feature.properties.demo===true) return []
    const geometry = readGeometry(feature.geometry)
    if (!geometry) throw new Error(`道路服务第 ${index + 1} 个路段缺少有效的经纬度线形`)
    const status = feature.properties.trafficStatus
    if (!trafficStatus(status)) throw new Error(`道路服务第 ${index + 1} 个路段缺少可识别的路况`)
    const p=feature.properties
    const name=String(p.dlmc??p.name??'').trim()||'未登记路名'
    const road=roadFeature(eventId+':service-road:'+index,name,status,geometry,false)
    return [{...road,properties:{...road.properties,roadCode:p.roadCode??p.wyid,sourceFeatureId:p.sourceFeatureId,sourceServiceId:p.sourceServiceId}}]
  })
}

export async function loadLiveRoads(event: RoadContext, endpoint?: string, signal?: AbortSignal): Promise<LiveRoadLayer> {
  if (!endpoint?.trim() || !event.position) {
    if (event.demo) return {source:'published', roads:[]}
    const roads = event.routes.filter(road => road.properties.demo !== true && road.properties.sample !== true)
    return {source:'published', roads:serviceRoads({type:'FeatureCollection',features:roads},event.id)}
  }
  const url = new URL(endpoint.trim(), globalThis.location?.href)
  url.searchParams.set('eventId', event.id)
  url.searchParams.set('longitude', String(event.position[0]))
  url.searchParams.set('latitude', String(event.position[1]))
  const response = await fetch(url, {
    signal, cache: 'no-store', headers: { Accept: 'application/geo+json, application/json' },
  })
  if (!response.ok) throw new Error(`道路服务请求失败（HTTP ${response.status}）`)
  return { source: 'service', roads: serviceRoads(await response.json(), event.id) }
}

export type VenueRoadMap = LiveRoadLayer & { surfaces:CityFeature[]; warnings:string[] }
export const venueRoadRadiusM=1000

async function readVenueSurfaces(position:Coordinate,signal?:AbortSignal):Promise<CityFeature[]> {
  const params=new URLSearchParams({scope:'liveEvent',lon:String(position[0]),lat:String(position[1]),radius:String(venueRoadRadiusM)})
  const response=await fetch('/api/jingshan/event-road-surfaces?'+params,{signal})
  if(!response.ok)throw Error('京山道路面服务读取失败。')
  const data=await response.json()
  if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))throw Error('京山道路面数据格式无效。')
  return data.features.map((f:CityFeature)=>({...f,properties:{...f.properties,kind:'event-live-road-surface',
    mapRole:'parcel',color:'#75adc7',strokeColor:'#badbef',fillOpacity:.24,showLabel:false,interactive:true}}))
}

export async function loadVenueRoadMap(event:RoadContext,endpoint?:string,signal?:AbortSignal):Promise<VenueRoadMap>{
  const [survey,observations]=await Promise.allSettled([
    event.position?readVenueSurfaces(event.position,signal):Promise.resolve([]),
    loadLiveRoads(event,endpoint,signal),
  ])
  signal?.throwIfAborted()
  const surfaces=survey.status==='fulfilled'?survey.value:[]
  const warnings:string[]=[]
  if(survey.status==='rejected')warnings.push('京山道路面服务读取失败')
  if(observations.status==='rejected')warnings.push('实况数据读取失败')
  const {source,roads}=observations.status==='fulfilled'?observations.value:{source:'published' as const,roads:[]}
  // A measured traffic line describes only its reported section. Never paint the entire survey polygon as closed.
  const named=roads.map(road=>{
    const p=road.properties
    const match=surfaces.find(f=>(!p.sourceServiceId || p.sourceServiceId===f.properties.sourceServiceId) &&
      ((p.sourceFeatureId && p.sourceFeatureId===f.properties.sourceFeatureId)||(p.roadCode && p.roadCode===f.properties.roadCode)))
    return match ? {...road,properties:{...p,name:match.properties.name,surveySurfaceId:match.id}} : road
  })
  return {source,roads:named,surfaces,warnings}
}
