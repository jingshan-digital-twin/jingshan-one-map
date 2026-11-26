import { distanceM } from './analytics.ts'
import { roadControlStyles } from './road-controls.ts'
import type { AssessmentItem, EventAssessment } from './event-plan-types.ts'
import type { CityFeature, Coordinate } from './types.ts'

export function trafficRoadsForMap(plan:EventAssessment | undefined, selected:ReadonlySet<string | undefined>, filter:string, focused:string | null) {
  if (!plan) return []
  return plan.roads.filter(road =>
    (filter==='all' || road.properties.action===filter) &&
    (plan.status==='draft' || selected.has(road.id) || (plan.status==='review' && road.id===focused)))
}

// Venue-relative rehearsal sections, in metres. A service can supply the same line features and item IDs.
const examples: { name:string; state:'closed'|'restricted'; code:string; offsets:Coordinate[]; hours:string }[] = [
  {name:'东侧联络段',state:'closed',code:'CL-01',offsets:[[65,145],[150,105],[170,25]],hours:'07:00–18:00'},
  {name:'南侧连接段',state:'closed',code:'CL-02',offsets:[[115,-90],[35,-160],[-65,-155]],hours:'07:30–18:30'},
  {name:'西侧支路段',state:'closed',code:'CL-03',offsets:[[-155,-95],[-180,0],[-150,85]],hours:'07:00–17:30'},
  {name:'外围北侧路段',state:'restricted',code:'RT-01',offsets:[[-265,205],[-105,285],[120,295]],hours:'07:00–19:00'},
  {name:'外围东侧路段',state:'restricted',code:'RT-02',offsets:[[200,240],[300,145],[320,-75]],hours:'07:30–19:00'},
]
function simulatedRoad(eventId:string, center:Coordinate, section:typeof examples[number]): CityFeature {
  const longitudeScale=111195*Math.cos(center[1]*Math.PI/180)
  const points:Coordinate[]=section.offsets.map(([x,y])=>[center[0]+x/longitudeScale,center[1]+y/111195])
  return {id:eventId+':mock-road:'+section.code,type:'Feature',geometry:{type:'LineString',coordinates:points},
    properties:{name:section.name,kind:'road-control',region:'京山市',...roadControlStyles[section.state],
      controlStatus:section.state,sectionCode:section.code,planSource:'simulation',sample:true,
      lengthM:Math.round(points.slice(1).reduce((length,p,i)=>length+distanceM(points[i],p),0)),
      controlWindow:'比赛日 '+section.hours}}
}

export function prepareTrafficProposals(plan:EventAssessment):EventAssessment {
  const traffic=plan.topics.find(t=>t.id==='traffic')
  if (!traffic || (traffic.items.length && traffic.items.every(item=>item.controlWindow) && plan.roads.every(r=>r.properties.assessmentLineStyle))) return plan
  const hasRestrictions=plan.roads.some(r=>r.properties.controlStatus==='restricted')
  const existingItems=new Set(traffic.items.map(i=>i.id))
  const extra=plan.example ? examples.filter(s=>(s.state==='closed'||!hasRestrictions)&&!existingItems.has(plan.eventId+':mock-road:'+s.code)) : []
  const center=plan.position
  const generated=center?extra.map(s=>simulatedRoad(plan.eventId,center,s)):[]
  const roads:CityFeature[]=[...generated,...plan.roads].map(road=>{
    const closed=road.properties.controlStatus==='closed'
    const controlWindow=String(road.properties.controlWindow || '待核实')
    return {...road,properties:{...road.properties,assessmentLineStyle:closed?'solid':'dashed',controlWindow}}
  })
  const byId=new Map(roads.map(road=>[road.id,road]))
  const added:AssessmentItem[]=extra.map(s=>{
    const id=plan.eventId+':mock-road:'+s.code, road=byId.get(id)
    return {id,title:s.code+' '+s.name+'（模拟）',status:roadControlStyles[s.state].action,
      detail:road?'场馆周边模拟路段 · '+road.properties.lengthM+' 米':'场馆待核实，暂未定位',
      controlWindow:'比赛日 '+s.hours,featureId:road?.id}
  })
  const items=traffic.items.map(item=>{
    const road=item.featureId?byId.get(item.featureId):undefined
    return {...item,detail:item.detail.replace(/\s*·?\s*管控时段[：:]\s*无\s*$/,''),
      controlWindow:item.controlWindow ?? (road ? String(road.properties.controlWindow ?? '待核实') : undefined)}
  })
  return {...plan,roads,topics:plan.topics.map(t=>t===traffic?{...traffic,items:[...added,...items]}:t)}
}
