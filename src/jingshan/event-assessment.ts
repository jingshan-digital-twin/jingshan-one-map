import { circle, distanceM } from './analytics.ts'
import { planRoadControls } from './road-controls.ts'
import { pendingRoadBasis, pendingRoadNote, roadAssessmentItem, surveyedRoadControls, surveyRoadBasis, surveyRoadNote } from './event-survey-roads.ts'
import { alignSampleTennisCenter } from './service-model-location.ts'
import { facilityDirectory, nearbyFacilitySites, supportLayerIds } from './venue-support.ts'
import { featureCenter, type CityFeature, type Dataset } from './types.ts'
import { eventTopics, type AssessmentInputs, type AssessmentItem, type AssessmentTopic, type EventTopic, type EventAssessment, type EventWorkflowRecord, type PlannedEvent } from './event-plan-types.ts'
import { eventIntroduction, eventVenueNames } from './event-plan-data.ts'
import { calculateEventDemand } from './event-estimates.ts'
import { assessmentProgress, assessmentStatus, assessmentVersion } from './event-workflow.ts'
import { itemDescription, selectedTopics } from './event-plan-selection.ts'
import { prepareTrafficProposals } from './event-traffic-proposals.ts'
export { defaultAssessmentInputs } from './event-estimates.ts'

export function checkAssessmentInputs(value: unknown, event: PlannedEvent): AssessmentInputs {
  if(!value||typeof value!=='object')throw new Error('研判参数不完整')
  const v=value as AssessmentInputs
  if(event.venueNames.length?!event.venueNames.includes(v.venueName):v.venueName!=='')throw new Error('请选择赛事资料中登记的场馆')
  for(const [key,min,max,nullable] of [
    ['spectators',0,1000000,true],['outsidePercent',0,100,true],['overnightPercent',0,100,true],
    ['carPercent',0,100,false],['peoplePerCar',1,60,false],['coreM',0,2000,false],['bufferM',0,5000,false],
  ] as const){
    const n=v[key]
    if(nullable&&n===null)continue
    if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw new Error('请检查人数、比例或半径范围')
  }
  if(v.spectators!==null&&!Number.isInteger(v.spectators))throw new Error('观众人数应为整数')
  if(v.bufferM<v.coreM)throw new Error('缓冲区半径不能小于核心区')
  if(typeof v.scenario!=='boolean'||typeof v.note!=='string'||v.note.length>1000||v.note.includes('\0'))throw new Error('请检查参数说明')
  return {venueName:v.venueName,spectators:v.spectators,outsidePercent:v.outsidePercent,overnightPercent:v.overnightPercent,
    carPercent:v.carPercent,peoplePerCar:v.peoplePerCar,coreM:v.coreM,bufferM:v.bufferM,scenario:v.scenario,note:v.note.trim()}
}
export function topicsByDepartment(topics: AssessmentTopic[]) {
  const groups = new Map<string, AssessmentTopic[]>()
  for (const topic of topics) {
    const group = groups.get(topic.department)
    if (group) group.push(topic)
    else groups.set(topic.department, [topic])
  }
  return groups
}
export function locateEventVenue(name: string, datasets: Dataset[]) {
  const data=alignSampleTennisCenter(datasets)
  const registered=data.find(d=>d.id==='venues')?.features??[]
  const names=eventVenueNames(name)
  // Resolve the venue against the currently published ledger before looking for a single-court geometry.
  const matched=names.map(label=>registered.find(f=>f.properties.name===label)).find(Boolean)
  const footprints=data.find(d=>d.id==='court_footprints')?.features??[]
  const surveyed=matched?.properties.ledgerVenue ? matched : footprints.find(f=>names.includes(f.properties.name))
  const venue=surveyed??matched
  const center=venue?.geometry ? featureCenter(venue) : null
  const position=center?.every(Number.isFinite) ? center : null
  return {position,venue,note:!position?'无场馆坐标':venue?.properties.sample?'平台示意场馆位置，需现场核实':surveyed?'场馆位置来自已发布场地台账':'平台场馆坐标'}
}
export function locatePlanVenue(event:PlannedEvent,name:string,datasets:Dataset[]) {
  const venue=locateEventVenue(name,datasets)
  if (!venue.position && event.position && name===(event.venueNames[0]??'')) {
    return {...venue,position:event.position,note:'赛事位置来自已发布赛历的登记点'}
  }
  return venue
}
// null defers the road survey; an empty array is a completed survey with no matching roads.
export function buildEventAssessment(event: PlannedEvent, inputs: AssessmentInputs, datasets: Dataset[], roadNetwork: CityFeature[] | null, version: number, generatedAt: string, exercise=false): EventAssessment {
  const {position,note}=locatePlanVenue(event,inputs.venueName,datasets)
  const awaitingRoads = !exercise && roadNetwork===null && !!position && inputs.bufferM>0
  const {totalPeople,parkingDemand,lodgingDemand,lodgingRooms}=calculateEventDemand(event,inputs)
  const directory=facilityDirectory(datasets.filter(d=>supportLayerIds.includes(d.id))).filter(item=>exercise||item.feature.properties.sample!==true)
  const nearby=(kind:'parking'|'hotels'|'medical'|'food',radius=3000)=>nearbyFacilitySites(position,directory.filter(f=>f.kind===kind),radius)
    .map(({feature,meters})=>({feature,distance:Math.round(meters)}))
  const parking=nearby('parking'),hotels=nearby('hotels'),medical=nearby('medical',15000),food=nearby('food')
  const shelters=!position?[]:datasets.filter(d=>d.id==='emergency'||d.id==='emergency_shelters').flatMap(d=>d.features).flatMap(feature=>{
    const p=featureCenter(feature),distance=p?distanceM(position,p):Infinity
    return (exercise||feature.properties.sample!==true)&&distance<=5000?[{feature,distance:Math.round(distance)}]:[]
  }).sort((a,b)=>a.distance-b.distance)
  // Registered beds/spaces are capacities, not verified real-time availability. Never silently count missing capacity as zero.
  const capacity=(rows:ReturnType<typeof nearby>,key:string)=>{
    return !rows.length||rows.some(r=>typeof r.feature.properties[key]!=='number')?null:
      rows.reduce((s,r)=>s+Number(r.feature.properties[key]),0)
  }
  const parkingSupply=capacity(parking,'spaces'),lodgingSupply=capacity(hotels,'beds')
  const surfaces=roadNetwork??[]
  const roads=exercise && position?planRoadControls({center:position,coreM:inputs.coreM,bufferM:inputs.bufferM,region:'京山市',eventId:event.id,
    venueId:inputs.venueName,useEventPlan:false,roads:surfaces,published:[]}):surveyedRoadControls(event.id,inputs,position,surfaces)
  const features:CityFeature[]=[]
  if(position){
    for(const [kind,radius,color] of [['event-buffer',inputs.bufferM,'#ffae00'],['event-core',inputs.coreM,'#ff4f52']] as const){
      if(radius>0)features.push(circle(event.id+':'+kind,`${kind==='event-core'?'核心区':'缓冲区'} ${radius}米${exercise?'（演练）':''}`,kind,'京山市',position,radius,color))
    }
    features.push({id:event.id,type:'Feature',geometry:{type:'Point',coordinates:position},properties:{name:inputs.venueName||event.name,kind:'event',region:'京山市',color:'#ffae00',mapRole:'venue'}})
  }
  for(const [kind,rows,color] of [['parking',parking,'#4db3ff'],['hotels',hotels,'#ffae00'],['medical',medical,'#ff4f52'],['food',food,'#11ca14'],['shelters',shelters,'#07eeff']] as const){
    features.push(...rows.slice(0,20).map(({feature:f})=>({...f,properties:{...f.properties,mapRole:'support',supportKind:kind,color}})))
  }
  const resources=(rows:ReturnType<typeof nearby>,capacityKey?:string):AssessmentItem[]=>rows.slice(0,12).map(({feature:f,distance})=>({
    id:f.id,title:f.properties.name,detail:`距场馆约 ${distance.toLocaleString()} 米${capacityKey?' · 登记容量 '+(f.properties[capacityKey]??'无'):''}${f.properties.sample?' · 演示资源':''}`,
    status:'待联系核实',featureId:f.id,
  }))
  const item=(id:string,title:string,detail:string):AssessmentItem=>({id,title,detail,status:'待复核'})
  const display=(v:number|null,unit:string)=>v===null?'无':v.toLocaleString()+unit
  const rows: Record<EventTopic,{department:string;items:AssessmentItem[]}>= {
      traffic:{department:'公安交警',items:[...(!position?[item('traffic-venue','核实比赛场馆与进出路线','确认场馆及出入口后，复核周边路段、停车场和接驳点。')]:[]),...roads.map(roadAssessmentItem),...resources(parking,'spaces')]},
      medical:{department:'卫健局',items:[item('medical-needs','医疗点与救护车配置',`同场人数：${display(totalPeople,'人')}；医疗点位、车辆数量由卫健部门复核填报。`),...resources(medical)]},
      security:{department:'属地街镇',items:[item('security-access','入口安检与人流组织','核验出入口容量、隔离设施及入场高峰，保持消防通道畅通。'),item('security-count','现场人数核验',`原表规模 ${display(event.participants,'人')}；观众输入 ${display(inputs.spectators,'人')}。安保人员数量：无。`)]},
      lodging:{department:'文旅局',items:[item('lodging-demand','住宿需求测算',`住宿需求预估 ${display(lodgingRooms,'间房')}，按每间 2 人折算，预估床位 ${display(lodgingDemand,'床')}。3 公里内登记床位 ${display(lodgingSupply,'床')}，当日空余床位需逐店确认。`),...resources(hotels,'beds')]},
      food:{department:'市场监管局',items:[item('food-check','供餐单位核验','确认供餐资质、食品留样、过敏原提示及饮用水供应。'),...resources(food)]},
      volunteers:{department:'团市委',items:[item('volunteer-post','志愿岗位排班','按入场引导、问询、交通接驳、无障碍服务安排岗位，人数与班次：无。'),item('volunteer-youth','未成年参赛者服务','核对监护人联系流程，设置走失联络点与双语指引（国际赛事）。')]},
      weather:{department:'气象局',items:[item('weather-forecast','赛期天气信息','无。未接入赛期天气预报，不使用当前天气替代历史赛期。'),item('weather-response','天气应对清单','赛前核验降雨、高温、大风等预警；确认室内备选场地及延期通知流程。')]},
      supplies:{department:'应急管理局',items:[item('supplies-stock','应急物资核验','核对急救包、饮用水、照明、通信、雨具及消防器材，库存数量：无。'),...resources(shelters)]},
  }
  const topics=eventTopics.map(([id,label])=>({id,label,...rows[id]}))
  const risks=[
    ...(inputs.scenario?['当前为人工演练参数，测算值不是赛事事实。']:[]),
    ...(totalPeople===null?['观众规模无，停车和住宿需求无法完整测算。']:[]),
    ...(lodgingDemand===null?['外地占比或住宿比例无，住宿需求待补充。']:[]),
    ...(parkingDemand!==null&&parkingSupply!==null&&parkingDemand>parkingSupply?[`登记停车容量差额 ${parkingDemand-parkingSupply} 个，待核验当日可用泊位。`]:[]),
    ...(lodgingDemand!==null&&lodgingSupply!==null&&lodgingDemand>lodgingSupply?[`登记床位容量差额 ${lodgingDemand-lodgingSupply} 床。`]:[]),
    ...(note.includes('示意')?[note]:[]),
    ...(!position?['无场馆坐标，暂不能生成空间研判。']:[]),
    exercise?'演练道路及管控时段为模拟建议。':awaitingRoads?pendingRoadNote:surveyRoadNote,
  ]
  return prepareTrafficProposals({...(exercise?{example:true}:{roadBasis:awaitingRoads?pendingRoadBasis:surveyRoadBasis}),eventId:event.id,eventSnapshot:structuredClone(event),revision:0,generatedAt,version,inputs,status:'draft',position,locationNote:note,totalPeople,parkingDemand,lodgingDemand,
    parkingSupply,lodgingSupply,risks,topics,features,roads,departments:[],taskIds:[]})
}
// Older plans can have saved milestone times without a complete activity log.
export function assessmentRecords(plan: EventAssessment): EventWorkflowRecord[] {
  const records = [...(plan.timeline ?? [])]
  function appendMissing(action: EventWorkflowRecord['action'], at: string | undefined, detail: string) {
    if (at && !records.some(record => record.action === action && record.at === at)) {
      records.push({ action, at, detail })
    }
  }
  appendMissing('generated', plan.generatedAt, `生成研判方案 V${assessmentVersion(plan)}`)
  appendMissing('submitted', plan.submittedAt, `推送至 ${plan.departments.length} 个责任部门`)
  for (const item of plan.feedback ?? []) {
    if (item.status === 'completed') appendMissing('feedback', item.feedbackAt, `${item.department}反馈已登记`)
  }
  appendMissing('completed', plan.completedAt, '平台确认完结，方案归档锁定')
  return records.sort((a,b) => Date.parse(a.at) - Date.parse(b.at))
}

export function assessmentReport(event: PlannedEvent, plan: EventAssessment, maxItemsPerTopic=Infinity, preview=false) {
  event=plan.eventSnapshot??event
  const {parkingDemand,lodgingDemand}=plan
  const lodgingRooms=lodgingDemand===null?null:Math.ceil(lodgingDemand/2)
  const progress=assessmentProgress(plan)
  const status=assessmentStatus(plan)
  const example=plan.example||plan.eventId.startsWith('example-')
  const topics=selectedTopics(plan.topics,plan.dispatchedItems)
  return [`# ${event.name} · ${status==='已完结'?'赛前研判完结方案':'赛前研判方案'}`,
    ...(preview?['**勾选预览 · 尚未推送**']:[]),
    ...(example?[preview?'本次预览使用模拟保障资源。':'**只读演练样例** · 方案、部门反馈与时间线为演示数据。']:[]),
    `方案版本 V${assessmentVersion(plan)} · ${plan.inputs.scenario?'含规划预估参数':'按已填报参数'}`,
    `## 基本信息\n${event.year}年 ${event.dateText}｜${plan.inputs.venueName||'场馆待核实'}\n赛事级别：${event.level}｜主办单位：${event.host}｜承办单位：${event.organizer}\n赛事简介：${eventIntroduction(event)}`,
    `位置依据：${plan.locationNote}`,`## 规模预测\n参赛人数：${event.participants??'无'}人；观众人数（预估）：${plan.inputs.spectators??'无'}人；外地占比：${plan.inputs.outsidePercent??'无'}%；住宿比例：${plan.inputs.overnightPercent??'无'}%。`,
    `交通假设：驾车比例 ${plan.inputs.carPercent}%，每车 ${plan.inputs.peoplePerCar} 人，核心区 ${plan.inputs.coreM} 米，缓冲区 ${plan.inputs.bufferM} 米。`,
    `停车需求（预估）：${parkingDemand??'无'}个；住宿需求（预估）：${lodgingRooms??'无'}间房（按每间2人折算，不是间夜或实际订房量）。`,
    `参数说明：${plan.inputs.note||'无'}`,
    preview ? `## 勾选清单\n已选 ${topics.length} 类预案，共 ${topics.reduce((sum,t)=>sum+t.items.length,0)} 个子项，拟推送至 ${topicsByDepartment(topics).size} 个责任部门。`
      : `## ${status==='已完结'?'完结信息':'研判进度'}\n流程状态：${status}；专项预案：${topics.length} 项；部门会签：${progress.completed}/${progress.total}；意见 ${progress.opinions} 条，已采纳 ${progress.adopted} 条。\n生成时间：${plan.generatedAt}；平台完结时间：${plan.completedAt??'尚未完结'}；关联数据版本：${plan.version}。`,
    `## 风险提示\n${plan.risks.map(r=>'- '+r).join('\n')}`,
    ...topics.map(t=>`## ${t.label}\n责任部门：${t.department}\n`+t.items.slice(0,maxItemsPerTopic).map(i=>`- ${i.title}：${itemDescription(i)}（${i.status}）`).join('\n')+
      (t.items.length>maxItemsPerTopic?`\n其余 ${t.items.length-maxItemsPerTopic} 项在赛事研判页面查看或导出完整报告。`:'')),
    ...(!preview?[`## 部门反馈与意见处理\n已反馈 ${progress.completed}/${progress.total} 个部门；已登记意见 ${progress.opinions} 条；已采纳 ${progress.adopted} 条。\n`+
      (plan.feedback?.map(item=>`- ${item.department}：${item.status==='completed'?'已反馈':item.status==='received'?'已签收，待反馈':'待反馈'}；${item.comment||'未登记具体意见'}${item.disposition?'（'+(item.disposition==='adopted'?'已采纳':'已阅归档')+'）':''}${item.feedbackAt?' · '+item.feedbackAt:''}`).join('\n')||'尚未推送部门任务。'),
    `## 流程记录\n`+assessmentRecords(plan).map(item=>`- ${item.at}：${item.detail}`).join('\n')]:[]),
    `## 资料来源\n${event.sourceFile} / ${event.sourceSheet} / 第${event.sourceRow}行\n`+event.sources.map(s=>`- ${s.title}：${s.url}`).join('\n'),
    '部门任务与反馈保存在本机协同台账；平台确认完结表示本次研判资料归档，不代表已接入外部部门系统或批准现场执行。'].join('\n\n')
}
