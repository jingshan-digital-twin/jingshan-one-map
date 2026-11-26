import {featureCenter, type CityFeature, type Coordinate} from './types.ts'
import type {VenueFacilityCapacity} from './venue-capacity'
import {facilitySiteKey,isFacilityAttraction,serviceDistance,supportCategories,uniqueFacilitySites,type Facility,type ServedVenue} from './venue-support.ts'
import type {SceneMap} from './scene-map'
import {openingStageLabels, type OpeningTaskRow} from './venue-opening.ts'
import {tennisCenterBuildings} from './tennis-center-buildings.ts'
import {distanceM,inPolygon} from './analytics.ts'
import {venueOwnershipGroup} from './venue-ownership.ts'
import {serviceSymbols} from './service-point-markers.ts'
import {chainMapFeature} from './industry-panorama.ts'

type Role = 'range'|'link'|'venue'|'support'|'task'|'gap'
type VenueMapLocation = Pick<VenueFacilityCapacity,'id'|'name'|'position'|'feature'>
export function serviceFeature(feature:CityFeature,mapRole:Role,extra:Record<string,unknown>={}):CityFeature {
  return {...feature,properties:{...feature.properties,mapRole,...extra}}
}
export function venuePin(venue:VenueMapLocation,selected=false,style:'resource'|'ownership'='resource'):CityFeature {
  const group=style==='ownership' ? venueOwnershipGroup(venue.feature.properties.ownership) : undefined
  const color=group?.color??serviceSymbols.venue.color
  return serviceFeature({...venue.feature,id:venue.id??venue.feature.id,geometry:{type:'Point',coordinates:venue.position}},'venue',
    {selected,name:venue.name,label:venue.name,legendLabel:group?.shortLabel??'场馆',color:selected&&group?'#ffc448':color,labelOnZoom:true,legendColor:group?.color,datasetId:venue.feature.properties.kind==='court'?'courts':'venues'})
}
export function providerPin(item:Facility,selected=false):CityFeature {
  const center=featureCenter(item.feature)
  const point=center && item.feature.geometry.type!=='Point' ? {...item.feature,geometry:{type:'Point' as const,coordinates:center}} : item.feature
  const {color}=serviceSymbols[item.kind]
  return serviceFeature(point,'support',{selected,label:item.feature.properties.name,color,labelOnZoom:true,legendLabel:supportCategories[item.kind],supportKind:item.kind,datasetId:item.layer,mapSiteId:facilitySiteKey(item)})
}
export function supportOverviewMap(facilities:Facility[]):SceneMap {
  const pins = uniqueFacilitySites(facilities).map(item => {
    const pin = providerPin({...item,feature:chainMapFeature(item.feature,item.layer)})
    pin.properties.clusterFacilities = true
    return pin
  })
  return {features:pins.filter(pin => featureCenter(pin)),focus:'county',facilityView:'directory'}
}
export function taskPins(rows:OpeningTaskRow[],venues:VenueFacilityCapacity[],selectedId?:string):CityFeature[] {
  const places=new Map(venues.map(venue=>[venue.id,venue]))
  return rows.flatMap(task=>{
    const place=places.get(task.venueId)
    if(!place)return []
    const base=venuePin(place)
    return [serviceFeature({...base,id:'service-task:'+task.id},'task',{kind:'service-task',taskId:task.id,venueId:place.id,
      label:place.name+' · '+openingStageLabels[task.stage],selected:task.id===selectedId,legendLabel:openingStageLabels[task.stage],
      color:{assigned:'#4893ff',received:'#30cacc',review:'#efa94d',closed:'#4cb977',withdrawn:'#8999ad'}[task.stage]})]
  })
}
// Sample a small circle on the earth. Distances stay in metres at every zoom and latitude.
function rangeBoundary(center:Coordinate,km:number):Coordinate[] {
  const [lon,lat]=center.map(v=>v*Math.PI/180)
  const arc=km/6371.0088
  return Array.from({length:81},(_,i)=>{
    const bearing=(i%80)*2*Math.PI/80
    const phi=Math.asin(Math.sin(lat)*Math.cos(arc)+Math.cos(lat)*Math.sin(arc)*Math.cos(bearing))
    const lambda=lon+Math.atan2(Math.sin(bearing)*Math.sin(arc)*Math.cos(lat),Math.cos(arc)-Math.sin(lat)*Math.sin(phi))
    return [lambda*180/Math.PI,phi*180/Math.PI]
  })
}
function serviceRangePin(feature:CityFeature,center=false):CityFeature {
  return {...feature,properties:{...feature.properties,clusterFacilities:true,markerStyle:'service-range-pin',serviceRangeCenter:center}}
}
export function resourceDetailMap(focus:CityFeature,neighbors:CityFeature[],km:number,venue:boolean,model:boolean):SceneMap {
  const center=focus.geometry&&featureCenter(focus)
  if(!center)return {features:[],focus:'county'}
  const ranges=(venue&&km>1?[km,1]:[km]).map((radius):CityFeature=>({
    ...focus,id:'service-range:'+focus.id+':'+radius,
    geometry:{type:'Polygon',coordinates:[rangeBoundary(center,radius)]},
    properties:{region:focus.properties.region,mapRole:'range',kind:'service-range',name:radius+' 公里服务圈',legendLabel:radius+' 公里服务圈',showLabel:radius===km,
      color:venue&&radius>1?'#438aff':'#4cddd8',dashed:venue&&radius>1,radiusKm:radius},
  }))
  const sites=new Map<string,CityFeature>()
  const focusSite=String(focus.properties.mapSiteId??focus.id)
  for(const f of neighbors){
    if(venue && f.properties.mapRole!=='support') continue
    const key=String(f.properties.mapSiteId??f.id)
    const pos=featureCenter(f)
    if(key!==focusSite && !sites.has(key) && pos && distanceM(center,pos)<=km*1000)sites.set(key,f)
  }
  const unique=[...sites.values()]
  const buildings:CityFeature[]=model?Object.values(tennisCenterBuildings).flatMap(building=>{
    const provider=unique.find(f=>f.id===building.providerId)
    if(provider?.geometry.type!=='Point'||!inPolygon(provider.geometry.coordinates,[building.ring]))return []
    return [{...provider,id:'service-building:'+building.id,
      geometry:{type:'Polygon' as const,coordinates:[[...building.ring,building.ring[0]]]},
      properties:{...provider.properties,mapRole:'building',pickFeatureId:provider.id,sourceBuildingId:building.id,
        heightM:building.height,color:'#5cd6fa',legendLabel:'关联配套建筑',showLabel:false}}]
  }):[]
  const centerPin=serviceRangePin(serviceFeature(focus,venue?'venue':'support',{selected:true,legendLabel:venue?'当前场馆':'当前设施'}),true)
  return {features:[...ranges,...buildings,...unique.map(f=>serviceRangePin(f)),centerPin],focus:model?'model':'area',anchor:center,
    fitFeature:ranges[0],...(model ? {venueModelFocus:{name:focus.properties.name,id:focus.id,position:center}} : {}),
    ...(venue ? {venueDetail:true,courtFootprints:{radiusM:km*1000,facilityId:focus.id}} : {})}
}

export function venueDetailMap(venue:VenueMapLocation,providers:Facility[],km:number,model:boolean):SceneMap {
  return resourceDetailMap(venuePin(venue,true),providers.map(provider=>providerPin(provider)),km,true,model)
}

export function facilityDetailMap(facility:Facility,served:ServedVenue[],km:number,neighbors:Facility[]=[]):SceneMap {
  const venues = served.filter(row=>row.meters<=km*1000).map(({venue,meters}) => {
    const pin = venuePin(venue)
    return serviceFeature(pin,'venue',{
      label:venue.name + ' · ' + serviceDistance(meters),legendLabel:'半径内场馆',
    })
  })
  if (!featureCenter(facility.feature)) {
    const address = chainMapFeature(facility.feature,facility.layer)
    const anchor = featureCenter(address)
    if (!anchor) return {features:[],facilityView:'detail'}
    const pin = serviceRangePin(providerPin({...facility,feature:address},true))
    return {features:[pin],facilityView:'detail',focus:'area',anchor,height: /道路|社区/.test(String(address.properties.locationLabel)) ? 2400 : 900}
  }
  const focus = providerPin(facility,true)
  const attractions = neighbors.filter(isFacilityAttraction).map(f=>providerPin(f))
  return {...resourceDetailMap(focus,[...attractions,...venues],km,false,false),facilityView:'detail'}
}

