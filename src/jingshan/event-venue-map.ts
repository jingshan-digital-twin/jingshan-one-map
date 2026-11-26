import { featureCenter, type CityFeature, type Dataset } from './types.ts'
import { facilityDirectory, nearbyProviders, serviceDetailRadiusKm, supportLayerIds } from './venue-support.ts'
import { venueDetailMap } from './service-scene-map.ts'
import { surveyedCourtsInRange } from './analytics.ts'
import { venueModelTile } from './service-model-location.ts'
import { dashboardPalette } from './dashboard-palette.ts'
import type { SceneMap } from './scene-map.ts'
import { locateEventVenue } from './event-assessment.ts'
import type { PlannedEvent } from './event-plan-types.ts'

export function eventVenueOverview(datasets: Dataset[]): CityFeature[] {
  const venues = datasets.find(layer => layer.id === 'venues')
  return (venues?.features ?? []).flatMap(venue => {
    const center = venue.geometry && featureCenter(venue)
    if (venue.properties.sample === true || !center?.every(Number.isFinite)) return []
    return [{ ...venue, id: 'event-venue:' + venue.id, geometry: { type: 'Point' as const, coordinates: center },
      properties: { ...venue.properties, mapRole: 'venue', clusterFacilities: true, legendLabel: '网球场馆', color: '#4db3ff' } }]
  })
}

export function eventVenueDetail(datasets:Dataset[], event:PlannedEvent, name:string): (SceneMap & {calendarLocation:boolean}) | undefined {
  if (!name.trim() || !event.venueNames.includes(name) || /^(?:无|待定|待确认|待核实|未定|未确定|未登记|[-—]+)$/.test(name.trim())) return
  const resolved = locateEventVenue(name,datasets)
  const registered = resolved.position && resolved.venue?.properties.sample!==true ? resolved.venue : undefined
  const position = registered ? resolved.position : name===event.venueNames[0] ? event.position : null
  if (!position?.every(Number.isFinite)) return
  const feature:CityFeature = registered ?? {type:'Feature', id:'event-location:'+event.id, geometry:{type:'Point',coordinates:position},
    properties:{name,region:'京山市',kind:'event-plan-venue'}}
  const venue = {id:typeof feature.properties.facilityId==='string' ? feature.properties.facilityId : feature.id,
    name:typeof feature.properties.facilityName==='string' ? feature.properties.facilityName : feature.properties.name, position,feature}
  const directory = facilityDirectory(datasets.filter(layer=>supportLayerIds.includes(layer.id)))
    .filter(site=>site.feature.properties.sample!==true)
  const providers = nearbyProviders(venue,directory,serviceDetailRadiusKm*1000)
  const detail = venueDetailMap(venue,providers,serviceDetailRadiusKm,Boolean(registered && venueModelTile(venue)))
  if (!registered) return {...detail,courtFootprints:undefined,calendarLocation:true}
  const footprints = datasets.find(layer=>layer.id==='court_footprints')?.features ?? []
  const ownCourts = surveyedCourtsInRange(footprints,detail.fitFeature,venue.id).map(court=>({
    ...court, properties:{...court.properties,legendLabel:'本场馆场地',color:dashboardPalette.cyan},
  }))
  return {...detail, features:[...detail.features,...ownCourts],calendarLocation:false}
}
