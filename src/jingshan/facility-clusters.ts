import type { Coordinate } from './types'
import { badgeBounds, badgeLabelOptions, countBadgeDiameter, overlaps, placeBadgeLabels, type BadgeBounds, type CourtMarker } from './court-markers.ts'

export type FacilityAnchor = {
  id: string
  name: string
  region: string
  townId?: string
  village?: string
  villageId?: string
  category: string
  kind?: string
  color?: string
  selected?: boolean
  serviceRangeCenter?: boolean
  highlighted?: boolean
  position: Coordinate
}
type Projected = FacilityAnchor & { x: number; y: number }
type DistrictScale = 'town' | 'village'
export type FacilityScale = DistrictScale | 'detail'
type DistrictAnchor = (scale: DistrictScale, member: FacilityAnchor) =>
  { x: number; y: number; position: Coordinate } | null | undefined

export const SERVICE_RANGE_LABEL_WIDTH = 216
const SERVICE_RANGE_CENTER_PREFIX_WIDTH = 36
export const SERVICE_RANGE_CENTER_LABEL_WIDTH = SERVICE_RANGE_LABEL_WIDTH + SERVICE_RANGE_CENTER_PREFIX_WIDTH
export const FACILITY_TOWN_RESOLUTION = 35
export const FACILITY_VILLAGE_RESOLUTION = 3
export function facilityClusterScale(metersPerPixel: number): FacilityScale {
  if (metersPerPixel > FACILITY_TOWN_RESOLUTION) return 'town'
  if (metersPerPixel > FACILITY_VILLAGE_RESOLUTION) return 'village'
  return 'detail'
}

export interface FacilityMarker extends Pick<CourtMarker,'x'|'y'|'diameter'|'label'|'detail'> {
  labelBounds?: BadgeBounds
  members: Projected[]
  symbol: FacilityAnchor
  key: string
  description: string
  scale: FacilityScale
  pin: boolean
  mixedKinds?: boolean
  target: Coordinate
}

function isVisible(point: {x:number; y:number}, width: number, height: number) {
  return point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height
}

function districtKey(point: FacilityAnchor, scale: DistrictScale) {
  const town = point.townId || point.region
  return JSON.stringify(scale === 'town' ? [town] : [town, point.villageId || point.village || null])
}

function buildDistrict(key: string, members: Projected[], scale: DistrictScale, width: number, height: number,
  districtAnchor?: DistrictAnchor): FacilityMarker | undefined {
  let symbol = members[0]
  let anchor:Pick<Projected,'x'|'y'|'position'> = symbol
  if (districtAnchor) {
    const center = districtAnchor(scale,symbol)
    if (center === null) return
    anchor = center ?? symbol
    if (!isVisible(anchor,width,height)) return
    if (center) {
      const [lon,lat] = center.position
      const scaleX = Math.cos(lat*Math.PI/180)
      const distance = (p:FacilityAnchor) => ((p.position[0]-lon)*scaleX)**2 + (p.position[1]-lat)**2
      symbol = members.reduce((a,b)=>distance(a)<=distance(b)?a:b)
    }
  } else {
    const x = members.reduce((sum,p)=>sum+p.x,0)/members.length
    const y = members.reduce((sum,p)=>sum+p.y,0)/members.length
    const distance = (p:Projected)=>Math.hypot(p.x-x,p.y-y)
    symbol = members.reduce((a,b)=>distance(a)<=distance(b)?a:b)
    const visible = members.filter(p=>isVisible(p,width,height))
    if (!visible.length) return
    anchor = visible.reduce((a,b)=>distance(a)<=distance(b)?a:b)
  }
  const detail = scale === 'town' ? symbol.region || '镇街待核实' : symbol.village || '村社待核实'
  const counts = new Map<string, number>()
  for (const p of members) counts.set(p.category, (counts.get(p.category) ?? 0) + 1)
  const summary = [...counts].map(([category, count]) => category + ' ' + count + ' 处').join('、')
  const path = scale === 'village' ? [symbol.region, detail].filter(Boolean).join(' · ') : detail
  return { key, members, symbol, target:anchor.position, x:anchor.x, y:anchor.y, detail,
    scale, pin:false, diameter:countBadgeDiameter(members.length,false,true), description:path + ' · ' + summary }
}

function badgesCollide(a: FacilityMarker, b: FacilityMarker) {
  const gap = (a.diameter + b.diameter) / 2 + 4
  return Math.abs(a.x - b.x) < gap && Math.abs(a.y - b.y) < gap
}

function arrangeMarkers(markers: FacilityMarker[], width: number, height: number, maxLabelWidth?: number, venueNeighbors = false) {
  const circles: BadgeBounds[] = []
  const labels: {marker: FacilityMarker; bounds: BadgeBounds}[] = []
  const anchors = markers.map(badgeBounds)
  for (const [index,marker] of markers.entries()) {
    const center = marker.symbol.serviceRangeCenter
    const inset = marker.diameter/2 + 3
    const originX = Math.max(inset,Math.min(width-inset,marker.x))
    const originY = Math.max(inset,Math.min(height-inset,marker.y))
    const availableNames = (x: number,y: number) => badgeLabelOptions({...marker,x,y},width,height,true,
      center ? SERVICE_RANGE_CENTER_LABEL_WIDTH : maxLabelWidth, center ? SERVICE_RANGE_CENTER_PREFIX_WIDTH : 0)
      .filter(({bounds}) => !circles.some(circle=>overlaps(circle,bounds)) && !labels.some(label=>overlaps(label.bounds,bounds)))
    const tryPosition = (x: number,y: number, withName: boolean) => {
      if (x<inset || x>width-inset || y<inset || y>height-inset) return false
      const bounds = badgeBounds({x,y,diameter:marker.diameter})
      if (circles.some(other=>overlaps(other,bounds)) || labels.some(other=>overlaps(other.bounds,bounds))) return false
      if (withName && !availableNames(x,y).length) return false
      marker.x = x
      marker.y = y
      circles.push(bounds)
      return true
    }
    const placeCircle = (withName: boolean,maxRadius: number) => {
      if (tryPosition(originX,originY,withName)) return true
      // Search from the boundary anchor outwards, leaving the larger counts in place.
      for (let radius=8; radius<maxRadius; radius+=8) {
        const steps = Math.ceil(2*Math.PI*radius/12)
        for (let step=0; step<steps; step++) {
          const angle = 2*Math.PI*step/steps
          if (tryPosition(originX+radius*Math.cos(angle),originY+radius*Math.sin(angle),withName)) return true
        }
      }
      return false
    }
    // Keep marked places visible. If space runs out, release the lower-priority names first.
    const reserveName = center || (!venueNeighbors && (marker.members.length>1 || marker.symbol.selected || marker.symbol.highlighted))
    if (center) {
      // The pin tip identifies the circle's origin even when it is near a viewport edge.
      circles.push(badgeBounds(marker))
    } else if (!reserveName || !placeCircle(true,48)) {
      while (!placeCircle(false,Math.hypot(width,height))) {
        const last = labels.at(-1)
        if (!last || last.marker.symbol.serviceRangeCenter) break
        labels.pop()
        delete last.marker.label
        delete last.marker.labelBounds
      }
    }
    if (venueNeighbors && !center) continue
    const options = availableNames(marker.x,marker.y)
    const ranked = options.map(option=>({...option, blocked:anchors.slice(index+1)
      .reduce((n,anchor)=>n+Number(overlaps(option.bounds,anchor)),0)})).sort((a,b)=>a.blocked-b.blocked)
    const best = ranked[0]
    if (best && (reserveName || best.blocked===0)) {
      marker.label = best.label
      marker.labelBounds = best.bounds
      labels.push({marker,bounds:best.bounds})
    }
  }
  if (!venueNeighbors) return
  // In a venue circle, place every facility symbol before allocating room for names.
  const occupied = [...circles,...labels.map(item=>item.bounds)]
  let remaining = Math.max(2,Math.min(8,Math.floor(width*height/40000)))
  for (const marker of markers) {
    if (!remaining) break
    if (marker.symbol.serviceRangeCenter || marker.members.length>1) continue
    const option = badgeLabelOptions(marker,width,height,true,maxLabelWidth)
      .find(({bounds})=>!occupied.some(other=>overlaps(other,bounds)))
    if (!option) continue
    marker.label = option.label
    marker.labelBounds = option.bounds
    occupied.push(option.bounds)
    remaining--
  }
}

function pinMarker(p: Projected): FacilityMarker {
  const diameter = p.serviceRangeCenter ? 44 : p.kind==='venue' ? 36 : 30
  const description = (p.serviceRangeCenter ? '服务圈中心 · ' : '') + p.category + ' · ' + p.name
  return {key:p.id,members:[p],symbol:p,scale:'detail',pin:true,target:p.position,
    x:p.x,y:p.y-diameter/2,diameter,detail:p.name,description}
}

// Colliding facilities in a crowded venue circle share a pin until zoom separates them.
function groupVenueNeighbors(pins: FacilityMarker[]) {
  const groups: FacilityMarker[] = []
  for (const pin of pins) {
    const others = groups.filter(marker=>!marker.symbol.serviceRangeCenter && badgesCollide(marker,pin))
    const group = others.find(marker=>marker.symbol.kind===pin.symbol.kind) ?? others[0]
    if (!group || pin.symbol.serviceRangeCenter) {
      groups.push(pin)
      continue
    }
    group.members.push(...pin.members)
    const categories = [...new Set(group.members.map(point=>point.category))]
    group.mixedKinds = categories.length > 1
    group.description = categories.join('、') + ' · 附近 ' + group.members.length + ' 处设施'
  }
  return groups
}

export function layoutServiceRangeMarkers(points: Projected[], width: number, height: number): FacilityMarker[] {
  if (width < 60 || height < 60) return []
  const priority = (p: FacilityAnchor) => p.serviceRangeCenter ? -1 : p.selected ? 0 : p.highlighted ? 1 : p.kind==='venue' ? 2 : 3
  const venue = points.find(p=>p.serviceRangeCenter && p.kind==='venue')
  const distance = (p: Projected) => venue ? Math.hypot(p.x-venue.x,p.y-venue.y) : 0
  const pins = points.filter(p=>isVisible(p,width,height))
    .sort((a,b)=>priority(a)-priority(b) || distance(a)-distance(b) || a.id.localeCompare(b.id)).map(pinMarker)
  const markers = venue && pins.length>8 ? groupVenueNeighbors(pins) : pins
  arrangeMarkers(markers,width,height,SERVICE_RANGE_LABEL_WIDTH,Boolean(venue))
  return markers
}

function layoutPins(points: Projected[], width: number, height: number) {
  const pins: FacilityMarker[] = []
  const ordered = points.filter(p => isVisible(p,width,height))
    .sort((a,b) => Number(!!b.selected) - Number(!!a.selected) || a.id.localeCompare(b.id))
  for (const p of ordered) {
    const pin = pinMarker(p)
    const sameSpot = pins.find(other => badgesCollide(pin,other))
    if (sameSpot) sameSpot.members.push(p)
    else pins.push(pin)
  }
  pins.sort((a,b) => Number(!!b.symbol.selected)-Number(!!a.symbol.selected) || b.members.length-a.members.length || a.key.localeCompare(b.key))
  placeBadgeLabels(pins, width, height, true)
  const focus = pins.find(p => p.symbol.selected)
  if (focus && !focus.label) {
    // Reserve the selected name when every free placement is blocked by a pin.
    const [option] = badgeLabelOptions(focus,width,height,true)
    if (option) {
      for (let i = pins.length-1; i >= 0; i--) {
        const other = pins[i]
        if (other !== focus && overlaps(badgeBounds(other),option.bounds)) {
          focus.members.push(...other.members)
          pins.splice(i,1)
        }
      }
      pins.forEach(p => { delete p.label })
      placeBadgeLabels(pins,width,height,true)
    }
  }
  for (const pin of pins) {
    if (pin.members.length > 1) pin.description += '（附近共 ' + pin.members.length + ' 处设施）'
  }
  return pins
}

export function layoutFacilityMarkers(points: Projected[], width: number, height: number, metersPerPixel: number,
  districtAnchor?: DistrictAnchor): FacilityMarker[] {
  if (width < 60 || height < 60) return []
  const scale = facilityClusterScale(metersPerPixel)
  if (scale === 'detail') return layoutPins(points,width,height)
  const buckets = new Map<string,Projected[]>()
  for (const p of points) {
    const key = districtKey(p,scale)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(p)
    else buckets.set(key,[p])
  }
  const markers: FacilityMarker[] = []
  for (const [key,members] of buckets) {
    const marker = buildDistrict(key,members,scale,width,height,districtAnchor)
    if (marker) markers.push(marker)
  }
  markers.sort((a,b) => b.members.length - a.members.length || a.key.localeCompare(b.key))
  if (districtAnchor) placeBadgeLabels(markers,width,height,true)
  else arrangeMarkers(markers,width,height)
  return markers
}
