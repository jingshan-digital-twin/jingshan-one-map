import polygonClipping, { type Polygon, type MultiPolygon } from 'polygon-clipping'
import { circle, featureAreaM2 } from './analytics.ts'
import { roadControlStyles } from './road-controls.ts'
import { districtCenter } from './facility-boundaries.ts'
import type { AssessmentInputs, AssessmentItem, EventAssessment } from './event-plan-types.ts'
import type { CityFeature, Coordinate } from './types.ts'

export const surveyRoadBasis = 'road-surfaces' as const
export const pendingRoadBasis = 'pending-road-surfaces' as const
export const pendingRoadNote = '京山市道路面待同步，封闭、限行建议待核实。'
export const surveyRoadNote = '道路建议依据已发布的京山市道路面与研判范围相交生成，管控措施和执行时段由交警部门确认。'

// A buffer-zone proposal uses only the annulus outside the core. Preserve every
// polygon part and hole from the authoritative surface, including shared road names.
export function surveyedRoadControls(eventId:string, inputs:AssessmentInputs, position:Coordinate|null, surfaces:CityFeature[]) {
  if (!position || inputs.bufferM<=0 || !surfaces.length) return []
  const disk=(meters:number) => {
    const area=circle('','', '', '',position,meters,'').geometry
    return area.type==='Polygon' ? area.coordinates as Polygon : []
  }
  const core=inputs.coreM>0 ? disk(inputs.coreM) : undefined
  const buffer=disk(inputs.bufferM)
  const zones: {status:'closed'|'restricted';geometry:Polygon|MultiPolygon}[]=[]
  if(core)zones.push({status:'closed',geometry:core})
  if(inputs.bufferM>inputs.coreM)zones.push({status:'restricted',geometry:core?polygonClipping.difference(buffer,core):buffer})
  const controls:CityFeature[]=[]
  for(const {status,geometry:zone} of zones){
    for(const source of surfaces){
      const {geometry,properties:p}=source
      if(!geometry || (geometry.type!=='Polygon'&&geometry.type!=='MultiPolygon') || p.sample===true || !p.sourceFeatureId)continue
      const parts=polygonClipping.intersection(geometry.coordinates as Polygon|MultiPolygon,zone)
      if(!parts.length)continue
      const road:CityFeature={type:'Feature',id:[eventId,'road-surface',p.sourceServiceId,p.sourceFeatureId,status].join(':'),
        geometry:parts.length===1?{type:'Polygon',coordinates:parts[0]}:{type:'MultiPolygon',coordinates:parts},
        properties:{...p,...roadControlStyles[status],kind:'road-control',planSource:surveyRoadBasis,controlStatus:status,
          // Store a label point inside this clipped section rather than the full road.
          center:undefined}}
      const center=districtCenter(road)
      if(center)road.properties.center=center
      road.properties.areaM2=featureAreaM2(road,position)
      controls.push(road)
    }
  }
  return controls.sort((a,b)=>Number(b.properties.controlStatus==='closed')-Number(a.properties.controlStatus==='closed') ||
    a.properties.name.localeCompare(b.properties.name,'zh-CN') || a.id.localeCompare(b.id))
}

export function roadAssessmentItem(road:CityFeature):AssessmentItem{
  const p=road.properties
  const surveyed=p.planSource===surveyRoadBasis
  const area=Number(p.areaM2)
  return {id:road.id,title:p.name,
    detail:surveyed?[p.zone, p.sectionName?'道路台账起止 '+p.sectionName:'', Number.isFinite(area)?'范围内路面约 '+area.toLocaleString('zh-CN')+' 平方米':''].filter(Boolean).join(' · ')
      :[p.sectionName??p.zone, p.lengthM==null?'':p.lengthM+' 米'].filter(Boolean).join(' · '),
    status:String(p.action),featureId:road.id,controlWindow:typeof p.controlWindow==='string'?p.controlWindow:undefined}
}

export function needsSurveyRoads(plan?:EventAssessment){
  if (!plan || plan.example || plan.completedAt || plan.withdrawnAt || plan.roadBasis===surveyRoadBasis) return false
  if (plan.roadBasis===pendingRoadBasis) return plan.status==='draft' || plan.status==='review'
  return plan.status==='draft' && !plan.taskIds.length && !plan.submittedAt
}

// Preserve the other seven topics, parking choices and the original draft parameters.
export function withSurveyRoads(plan:EventAssessment,surfaces:CityFeature[]):EventAssessment{
  const roads=surveyedRoadControls(plan.eventId,plan.inputs,plan.position,surfaces)
  const replaced=new Set(plan.roads.map(r=>r.id))
  return {...plan,roadBasis:surveyRoadBasis,roads,topics:plan.topics.map(t=>t.id!=='traffic'?t:{
    ...t,items:[...roads.map(roadAssessmentItem),...t.items.filter(i=>!replaced.has(i.id)&&(!i.featureId||!replaced.has(i.featureId)))]}),
    risks:[...plan.risks.filter(x=>x!==pendingRoadNote && x!==surveyRoadNote && x!=='道路为参考路网，建议路段和时段须经现场勘察与部门复核。'),surveyRoadNote]}
}
