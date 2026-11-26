import type { LiveAction, LiveAlert, LiveEventMonitor, LiveIncident, LiveMonitorPoint } from './event-live-types.ts'
import { eventVenueNames } from './event-plan-data.ts'
import type { CityFeature, Coordinate, Dataset, FormField } from './types.ts'

export const monitorId='event_live_monitors', pointsId='event_live_points', incidentsId='event_live_incidents', alertsId='event_live_alerts', roadsId='event_live_roads'
export const pointKinds={venue:'场馆',parking:'停车场',police:'交警岗',medical:'医疗点',camera:'摄像头',entrance:'出入口',shuttle:'接驳点',supplies:'物资点'}
export const pointStatuses={normal:'正常',busy:'忙碌',warning:'预警',offline:'离线',standby:'备用'}
export const incidentStatuses={pending:'待派单',dispatched:'待签收',received:'已签收',onsite:'处置中',resolved:'已办结'}
export const severities={high:'高',medium:'中',info:'提示'}
export const alertTypes={parking:'停车',crowd:'客流',weather:'天气'}
export const cameraViews={entrance:'出入口',parking:'停车场',court:'场地'}

const numeric=(key:string,label:string):FormField=>({key,label,type:'number'})
export const measureFields = [
  numeric('onsite','现场人数'),numeric('capacity','可容纳人数'),numeric('vehicles','在场车辆'),
  numeric('hotelRooms','接待客房数'),numeric('medicalPoints','医疗点数'),numeric('staff','保障人员数'),
  numeric('smooth','畅通占比（%）'),numeric('slow','缓行占比（%）'),numeric('congested','拥堵占比（%）'),
]
type Props=CityFeature['properties']
const text=(v:unknown)=>typeof v==='string'?v.trim():''
const count=(v:unknown)=>typeof v==='number' && Number.isFinite(v)?v:null
const position=(f:CityFeature):Coordinate|null=>f.geometry.type==='Point' ? [f.geometry.coordinates[0],f.geometry.coordinates[1]] : null
function code<T extends string>(dict:Record<T,string>,value:unknown):T {
  const key=(Object.keys(dict) as T[]).find(k=>dict[k]===value || k===value)
  if (!key) throw Error('无法识别选项「'+String(value??'')+'」')
  return key
}
const list=(v:unknown)=>text(v).split(/[,、，\n]/).map(s=>s.trim()).filter(Boolean)
const obj=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==='object' && !Array.isArray(v)
function readArray<T>(value:unknown,valid:(v:unknown)=>boolean,label:string):T[] {
  if(!value)return []
  try {
    const rows=JSON.parse(text(value))
    if(Array.isArray(rows) && rows.every(valid))return rows
  }catch{/* Report the editable field name below. */}
  throw Error(label+'需要填写有效的 JSON 数组')
}
const metrics=(v:unknown)=>readArray<LiveMonitorPoint['metrics'][number]>(v,m=>obj(m) && typeof m.label==='string' &&
  (typeof m.value==='string' || typeof m.value==='number') && (m.percent==null || typeof m.percent==='number') &&
  (m.unit==null || typeof m.unit==='string'),'点位指标')
const history=(v:unknown)=>readArray<LiveAction>(v,h=>obj(h) && ['id','at','label','note'].every(k=>typeof h[k]==='string') &&
  ['alert','dispatch','receive','onsite','resolve','consult'].includes(String(h.action)),'原始办理记录')

export function checkMonitoringFeature(id:string,f:CityFeature) {
  const p=f.properties
  if(id===pointsId) {
    if(!position(f))throw Error('监测点「'+p.name+'」请附带地图点位')
    metrics(p.metrics)
    if(p.cameraUrl && !/^https?:\/\//i.test(text(p.cameraUrl)))throw Error('视频地址须为 HTTP 或 HTTPS 地址')
  }else if(id===incidentsId)history(p.priorHistory)
  else if(id===monitorId) {
    for(const field of [...measureFields,numeric('day','比赛日序')]) {
      const v=p[field.key]
      if(v!=null && v!=='' && (typeof v!=='number'||v<0||(field.label.includes('%') && v>100)))throw Error(field.label+'超出可填范围')
    }
  }else if(id===roadsId && (f.geometry.type!=='LineString' && f.geometry.type!=='MultiLineString' ||
      !text(p.monitorCode) || !['closed','slow','smooth','congested'].includes(text(p.trafficStatus)))) {
    throw Error('赛中路段需有线几何、monitorCode 监测编号及 trafficStatus 路况（smooth、slow、congested 或 closed）')
  }
}

function monitorPoint(row:CityFeature,exercise:boolean,eventId:string):LiveMonitorPoint {
  const p=row.properties
  const kind=code(pointKinds,p.pointType), url=text(p.cameraUrl)
  return {id:row.id,eventId,name:p.name,kind,position:position(row)!,demo:exercise,status:code(pointStatuses,p.pointStatus),
    updatedAt:text(p.snapshotAt),metrics:metrics(p.metrics),contact:p.contact||p.phone||p.office?{name:text(p.contact),phone:text(p.phone),department:text(p.office)}:undefined,
    camera:kind==='camera'?{code:text(p.cameraCode),online:p.cameraOnline===true,view:p.cameraView?code(cameraViews,p.cameraView):'court',
      source:exercise && !url?'simulation':'url',url:url||undefined}:undefined}
}
function monitorIncident(row:CityFeature,eventId:string):LiveIncident {
  const p=row.properties
  return {id:row.id,eventId,title:p.name,type:text(p.incidentType),level:code(severities,p.severity),pointId:text(p.pointId)||undefined,
    department:text(p.department),collaborators:list(p.collaborators),deadline:text(p.deadline),status:code(incidentStatuses,p.initialStatus),
    createdAt:text(p.openedAt),updatedAt:text(p.updatedAt)||text(p.openedAt),history:history(p.priorHistory),resourceIds:list(p.resources)}
}
function monitorAlert(row:CityFeature):LiveAlert {
  const p=row.properties
  return {id:row.id,title:p.name,level:code(severities,p.severity),pointId:text(p.pointId)||undefined,detail:text(p.detail),
    type:code(alertTypes,p.alertType),createdAt:text(p.openedAt),incidentId:text(p.incidentId)||undefined}
}
export function publishedLiveMonitors(datasets:Dataset[]):LiveEventMonitor[] {
  const rows=(id:string)=>datasets.find(d=>d.id===id)?.features??[]
  const venuePositions=new Map<string,Coordinate>()
  for(const venue of rows('venues')) {
    const center=position(venue)
    if(venue.properties.ledgerVenue===true && center) venuePositions.set(venue.properties.name,center)
  }
  function venueCenter(name:string) {
    const primary=name.split(/[、；;\n]/u)[0] ?? ''
    for(const label of eventVenueNames(primary)) {
      const center=venuePositions.get(label)
      if(center)return center
    }
  }
  function byMonitor(layer:string) {
    const index=new Map<string,CityFeature[]>()
    for(const row of rows(layer)){
      const key=text(row.properties.monitorCode)
      const group=index.get(key)
      if(group)group.push(row)
      else index.set(key,[row])
    }
    return index
  }
  const points=byMonitor(pointsId),roads=byMonitor(roadsId),incidents=byMonitor(incidentsId),alerts=byMonitor(alertsId)
  const plans=new Map([...rows('events'),...rows('event_plans')].map(f=>[f.id,f]))
  const monitors=rows(monitorId).map((row):LiveEventMonitor=>{
    const p:Props=row.properties, id=text(p.monitorCode), demo=p.exercise===true
    const planId=text(p.planId), venueName=text(p.venueName) || text(plans.get(planId)?.properties.venueText)
    return {id,planId:planId||undefined,name:p.name,venueName,position:venueCenter(venueName)??position(row),day:count(p.day),
      status:'ongoing',demo,startTime:text(p.startTime),nextPeak:text(p.nextPeak),snapshotAt:text(p.snapshotAt),revision:0,
      metrics:{onsite:count(p.onsite),capacity:count(p.capacity),vehicles:count(p.vehicles),hotelRooms:count(p.hotelRooms),medicalPoints:count(p.medicalPoints),staff:count(p.staff)},
      traffic:{smooth:count(p.smooth),slow:count(p.slow),congested:count(p.congested)},
      points:(points.get(id)??[]).filter(f=>position(f)).map(f=>{
        const point=monitorPoint(f,demo,id)
        if(point.kind==='venue') point.position=venueCenter(point.name)??point.position
        return point
      }),
      routes:(roads.get(id)??[]).map(f=>({...f,properties:{...f.properties,kind:'event-live-road',demo}})),
      incidents:(incidents.get(id)??[]).map(f=>monitorIncident(f,id)),alerts:(alerts.get(id)??[]).map(monitorAlert),publicNotices:[]}
  }).filter(m=>m.demo || !m.planId || plans.get(m.planId)?.properties.status!=='已办结')
  const monitoredPlans=new Set(monitors.filter(m=>!m.demo).map(m=>m.planId))
  const monitorCodes=new Set(monitors.map(m=>m.id))
  for(const plan of plans.values()){
    if(plan.properties.status!=='进行中' || plan.properties.sample===true || monitoredPlans.has(plan.id))continue
    const id=monitorCodes.has(plan.id)?'schedule:'+plan.id:plan.id
    const venue=text(plan.properties.venueText)||text(plan.properties.venueName)
    monitors.push({id,planId:plan.id,name:plan.properties.name,venueName:venue,position:venueCenter(venue)??position(plan),day:null,status:'ongoing',
      demo:false,awaitingMonitor:true,startTime:'',nextPeak:'',snapshotAt:'',revision:0,
      metrics:{onsite:null,capacity:null,vehicles:null,hotelRooms:null,medicalPoints:null,staff:null},
      traffic:{smooth:null,slow:null,congested:null},points:[],routes:[],incidents:[],alerts:[],publicNotices:[]})
  }
  return monitors.sort((a,b)=>Number(a.demo)-Number(b.demo))
}
