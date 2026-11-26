import type { CityFeature, Coordinate } from './types.ts'

import { districtCenter, type createFacilityBoundaryIndex } from './facility-boundaries.ts'
import controlLayers from './planning-symbology.json' with {type:'json'}
export {controlLayers}
export const reserveLayerId = 'investment_reserve_parcels'
export const surveyReferenceLayerId = 'investment_survey_reference'
export const reserveColor='#9A58FF'
export const availableParcelStyle={color:'#995add',strokeColor:'#dfc8ff',fillOpacity:.40}
export const reserveLandUses:Record<string,string>={'0601':'工业用地','0508':'物流仓储用地','05H1':'商业服务业设施用地','1201':'空闲地'}
export type ReserveScale = 'town' | 'village' | 'parcel'

export function reserveScaleAt(height:number, scope:'city'|'town'|'community'):ReserveScale {
  if(scope==='city' && height>=40_000)return 'town'
  if(scope!=='community' && height>=8_000)return 'village'
  return 'parcel'
}
export const urbanRelations={
  inside:{label:'界内',action:'优先比选',note:'核对详细规划用途、建设强度及现状使用条件。',rank:0},
  crossing:{label:'跨界',action:'分区复核',note:'分别核对界内外范围，按拟用地红线复核项目布局。',rank:1},
  outside:{label:'界外',action:'专项核实',note:'核实现状用地手续及规划依据。涉及新增独立城镇建设用地时，核对湖北省清单和特定选址要求。',rank:2},
  unknown:{label:'待核实',action:'待叠加核实',note:'需用已发布的开发边界核对整块图斑。',rank:3},
} as const
export type UrbanRelation=keyof typeof urbanRelations
export function urbanRelationOf(f:CityFeature):UrbanRelation {
  const value=f.properties.urbanRelation
  if(value==='inside' || value==='crossing' || value==='outside')return value
  return 'unknown'
}
export function urbanPlacement(f:CityFeature){ return urbanRelations[urbanRelationOf(f)] }
export function urbanExtentText(f:CityFeature){
  const relation=urbanRelationOf(f)
  if(relation!=='crossing')return urbanRelations[relation].label
  const percent=f.properties.urbanInsidePercent
  if(typeof percent!=='number' || !Number.isFinite(percent))return '跨界'
  const share=percent<.1?'不足 0.1%':percent>99.9?'超过 99.9%':' '+percent.toFixed(1)+'%'
  return '跨界，界内占比'+share
}
export const planningPolicyUrl='https://zrzyt.hubei.gov.cn/fbjd/zhengce/gfwj/xxyxgfxwj/202609/t20260902_6006195.shtml'
export type ReserveFilter = { landUse?:string; search?:string; town?:string; urban?:UrbanRelation|''; ids?:ReadonlySet<string> }
export function matchesReserve(feature:CityFeature, filter?:ReserveFilter) {
  const p=feature.properties
  const words=filter?.search?.trim().split(/\s+/) ?? []
  const text=[p.name,p.region,p.surveyUnit,p.landUse,p.surveyParcel,p.surveyId,p.sourceFid].join(' ')
  return (!filter?.ids || filter.ids.has(feature.id)) && (!filter?.town || p.region===filter.town) && (!filter?.urban || urbanRelationOf(feature)===filter.urban) &&
    (!filter?.landUse || p.landUseCode===filter.landUse) && words.every(word=>text.includes(word))
}
export function reserveMapFeature(feature:CityFeature, selected=false):CityFeature {
  return {...feature,properties:{...feature.properties,mapRole:'candidate',optionId:feature.id,selected,
    legendLabel:'项目拟储备地块',color:reserveColor,strokeColor:'#E0C9FF',fillOpacity:selected ? .76 : .54,showLabel:false}}
}
type ReserveGroup = {level:'town'|'village'; area:CityFeature; marker:CityFeature; parcels:CityFeature[]; children:Set<CityFeature>}

export function groupReserveParcels(parcels:CityFeature[], boundaries:CityFeature[], index?:ReturnType<typeof createFacilityBoundaryIndex>) {
  const townAreas=new Map(boundaries.filter(f=>f.properties.kind==='town-boundary' && !f.properties.sample).map(f=>[f.properties.name,f]))
  const towns=new Map<string,ReserveGroup>(), villages=new Map<string,ReserveGroup>()
  const withoutTown:CityFeature[]=[], withoutVillage:CityFeature[]=[]
  function include(level:ReserveGroup['level'],area:CityFeature|undefined,parcel:CityFeature) {
    const position=area && districtCenter(area)
    if(!area || !position)return
    const groups=level==='town' ? towns : villages
    const id='reserve-'+level+':'+area.id
    let group=groups.get(id)
    if(!group){
      const marker:CityFeature={type:'Feature',id,geometry:{type:'Point',coordinates:position},
        properties:{name:area.properties.name,region:parcel.properties.region,kind:'reserve-'+level,
          mapRole:'reserveGroup',groupLevel:level,color:reserveColor,legendLabel:'项目拟储备地块'}}
      group={level,area,marker,parcels:[],children:new Set()}
      groups.set(id,group)
    }
    group.parcels.push(parcel)
    group.marker.properties.count=group.parcels.length
    return group
  }
  for(const parcel of parcels){
    const town=townAreas.get(parcel.properties.region)
    const parent=include('town',town,parcel)
    if(!parent)withoutTown.push(parcel)
    const center=districtCenter(parcel)
    const area=center && index?.locate(center)
    const village=town && area?.town?.id===town.id ? area.village : undefined
    const child=include('village',village,parcel)
    if(child)parent?.children.add(child.area)
    else withoutVillage.push(parcel)
  }
  return {towns,villages,withoutTown,withoutVillage}
}

export function reserveDrillView(group:ReserveGroup) {
  const town=group.level==='town'
  const origin=group.marker.geometry
  let anchor:Coordinate|undefined, nearest=Infinity
  if(origin.type==='Point'){
    const [lon,lat]=origin.coordinates, xScale=Math.cos(lat*Math.PI/180)
    const targets=group.children.size ? group.children : group.parcels
    for(const target of targets){
      const point=districtCenter(target)
      if(!point)continue
      const distance=Math.hypot((point[0]-lon)*xScale,point[1]-lat)
      if(distance<nearest){nearest=distance;anchor=point}
    }
  }
  // A capped flight lands on a visible child circle or, at the next level, on a real parcel.
  return {features:town?[group.area]:group.parcels,view:'context' as const,anchor,
    minHeight:town?14_000:550,maxHeight:town?21_000:3_200}
}
export const controlServiceId = (key:string) => 'js-planning-' + key
export function controlService(id:string) { return controlLayers.find(item=>controlServiceId(item.key)===id) }

// Screening applies to this exact survey boundary. Editing the geometry requires re-screening.
export function geometryStamp(feature:CityFeature) {
  const geometry=feature.geometry
  if(geometry.type!=='Polygon' && geometry.type!=='MultiPolygon')return ''
  const text=JSON.stringify(geometry.coordinates), length=text.length
  let hash=2166136261
  for(let i=0;i<length;i++) hash=Math.imul(hash ^ text.charCodeAt(i),16777619)
  return length+'-'+(hash>>>0).toString(16)
}
export function eligibleReserve(feature:CityFeature){return feature.properties.inBusinessArea===true && screenedParcel(feature)}
export function screenedParcel(feature:CityFeature) {
  const p=feature.properties
  return p.screened===true && p.ecologyIntersects!==true && p.farmlandIntersects!==true && !p.sample && typeof p.landUseCode==='string' && Object.hasOwn(reserveLandUses,p.landUseCode) && Number.isInteger(p.sourceFid) &&
    (feature.geometry?.type==='Polygon' || feature.geometry?.type==='MultiPolygon') && p.screenedBoundary===geometryStamp(feature)
}
