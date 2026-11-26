import { createLiveEvents } from '../src/jingshan/event-live-data.ts'
import type { PlannedEvent } from '../src/jingshan/event-plan-types.ts'
import type { CityFeature, Coordinate, Dataset, FormField } from '../src/jingshan/types.ts'
import { monitorId,pointsId,incidentsId,alertsId,roadsId,pointKinds,pointStatuses,incidentStatuses,severities,alertTypes,cameraViews,measureFields } from '../src/jingshan/event-monitor-records.ts'

const str=(key:string,label:string,options:Partial<FormField>={}):FormField=>({key,label,type:'text',...options})
const numeric=(key:string,label:string):FormField=>({key,label,type:'number'})
const choice=(key:string,label:string,map:Record<string,string>):FormField=>({key,label,type:'select',options:Object.values(map),required:true})
const joinField=str('monitorCode','监测编号',{required:true,hint:'填写赛中监测总表中的监测编号。'})
function form(id:string,name:string,description:string,fields:FormField[]):Dataset {
  return {id,name,category:'赛事引流',department:'文旅局',description,formSchema:{fields},features:[]}
}
const record=(id:string,name:string,attrs:Record<string,unknown>,pos?:Coordinate|null):CityFeature=>({
  type:'Feature',id,properties:{name,region:'京山市',kind:'form_record',...attrs},
  geometry:pos?{type:'Point',coordinates:pos}:{type:'GeometryCollection',geometries:[]},
})
export function eventMonitoringDatasets(plans:PlannedEvent[],datasets:Dataset[]):Dataset[] {
  const main=form(monitorId,'赛中监测总表','按场次登记监测汇总和场馆中心点。下属点位、路况、预警和事件使用相同监测编号。',[
    {...joinField,unique:true},str('planId','赛历编号'),str('venueName','监测场馆'),{key:'exercise',label:'演练数据',type:'boolean'},
    numeric('day','比赛日序'),str('startTime','开赛时间'),str('nextPeak','下次高峰时间'),str('snapshotAt','数据采集时间'),...measureFields,
  ])
  const points=form(pointsId,'赛中监测点位','为每处监测点填写监测编号并附带地图点位，可登记设备、值守单位和指标。',[
    joinField,choice('pointType','点位类别',pointKinds),choice('pointStatus','点位状态',pointStatuses),
    str('snapshotAt','数据采集时间'),str('metrics','点位指标',{type:'textarea',hint:'JSON 数组，例如 [{"label":"空余车位","value":20,"unit":"个"}]'}),
    str('contact','联系人'),str('phone','联系电话'),str('office','值守部门'),str('cameraCode','设备编号'),
    str('cameraUrl','视频地址'),{key:'cameraOnline',label:'视频在线',type:'boolean'},
    {...choice('cameraView','监控视角',cameraViews),required:false},
  ])
  const incidents=form(incidentsId,'赛中处置事件','登记需跟进的事项、责任部门和关联监测点。派单以后的操作保存在办理记录中。',[
    joinField,str('incidentType','事件类型'),choice('severity','级别',severities),choice('initialStatus','登记状态',incidentStatuses),
    str('pointId','关联点位编号'),str('department','责任部门',{required:true}),str('collaborators','协作部门',{hint:'多个部门用顿号分隔'}),
    str('deadline','处置时限'),str('openedAt','登记时间'),str('updatedAt','状态时点'),
    str('resources','联动资源编号',{type:'textarea',hint:'多个点位编号用顿号分隔'}),
    str('priorHistory','原始办理记录',{type:'textarea',hint:'首次登记前已有的记录，以 JSON 数组保存。'}),
  ])
  const alerts=form(alertsId,'赛中预警','登记预警信息，可关联监测点及处置事件。',[
    joinField,choice('alertType','预警类型',alertTypes),choice('severity','级别',severities),str('detail','预警详情',{type:'textarea'}),
    str('pointId','关联点位编号'),str('incidentId','处置事件编号'),str('openedAt','预警时间'),
  ])
  const roads:Dataset={id:roadsId,name:'赛中交通路段',category:'赛事引流',department:'公安交警',description:'按 monitorCode 关联场次。trafficStatus 可填写 smooth（畅通）、slow（缓行）、congested（拥堵）、closed（封闭）。',features:[]}
  for(const e of createLiveEvents(plans,datasets,new Date('2026-11-24T00:00:00+08:00'))) {
    const monitorCode='exercise-'+e.id
    main.features.push(record('monitor-'+e.id,e.name,{monitorCode,planId:e.id,exercise:true,venueName:e.venueName,
      day:e.day,startTime:e.startTime,nextPeak:e.nextPeak,snapshotAt:e.snapshotAt,...e.metrics,...e.traffic},e.position))
    for(const p of e.points)points.features.push(record(p.id,p.name,{monitorCode,pointType:pointKinds[p.kind],pointStatus:pointStatuses[p.status],
      snapshotAt:p.updatedAt,metrics:JSON.stringify(p.metrics),contact:p.contact?.name,phone:p.contact?.phone,office:p.contact?.department,
      cameraCode:p.camera?.code,cameraOnline:p.camera?.online,cameraUrl:p.camera?.url,cameraView:p.camera?cameraViews[p.camera.view]:undefined},p.position))
    for(const i of e.incidents)incidents.features.push(record(i.id,i.title,{monitorCode,incidentType:i.type,severity:severities[i.level],
      initialStatus:incidentStatuses[i.status],pointId:i.pointId,department:i.department,collaborators:i.collaborators.join('、'),deadline:i.deadline,
      openedAt:i.createdAt,updatedAt:i.updatedAt,resources:i.resourceIds.join('、'),priorHistory:JSON.stringify(i.history)}))
    for(const a of e.alerts)alerts.features.push(record(a.id,a.title,{monitorCode,alertType:alertTypes[a.type],severity:severities[a.level],detail:a.detail,
      pointId:a.pointId,incidentId:a.incidentId,openedAt:a.createdAt}))
    for(const r of e.routes)roads.features.push({...r,properties:{...r.properties,monitorCode}})
  }
  return [main,points,incidents,alerts,roads]
}

