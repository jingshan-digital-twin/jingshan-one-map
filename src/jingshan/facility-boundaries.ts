import type { Position } from 'geojson'
import Polygon from 'ol/geom/Polygon.js'
import { inPolygon } from './analytics.ts'
import type { CityFeature, Coordinate } from './types.ts'

const districtCenters = new WeakMap<CityFeature,Coordinate | undefined>()

function centerOfDistrict(area:CityFeature):Coordinate | undefined {
  const g = area.geometry
  const parts = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
  const contains = (point:Coordinate) => parts.some(rings => inPolygon(point,rings))
  const published = area.properties.center
  if (Array.isArray(published) && published.length === 2 && published.every(Number.isFinite)) {
    const point:Coordinate = [published[0],published[1]]
    if (contains(point)) return point
  }
  const origin = parts.find(rings => rings[0]?.length)?.[0][0]
  if (!origin) return
  // Area-weighted centroid in local coordinates, accounting for holes irrespective of ring winding.
  let areaSum = 0, momentX = 0, momentY = 0, largestArea = 0
  let mainland:Position[][] | undefined
  for (const rings of parts) {
    let partArea = 0
    for (const [index,ring] of rings.entries()) {
      let twiceArea = 0, mx = 0, my = 0
      for (let i=0, j=ring.length-1; i<ring.length; j=i++) {
        const ax=ring[j][0]-origin[0], ay=ring[j][1]-origin[1]
        const bx=ring[i][0]-origin[0], by=ring[i][1]-origin[1]
        const cross=ax*by-bx*ay
        twiceArea+=cross
        mx+=(ax+bx)*cross
        my+=(ay+by)*cross
      }
      const sign = Math.sign(twiceArea) * (index === 0 ? 1 : -1)
      partArea += sign*twiceArea
      momentX += sign*mx
      momentY += sign*my
    }
    areaSum += partArea
    if (partArea > largestArea) { largestArea=partArea; mainland=rings }
  }
  if (areaSum <= 0 || !mainland) return
  const centroid:Coordinate = [origin[0]+momentX/(3*areaSum),origin[1]+momentY/(3*areaSum)]
  if (contains(centroid)) return centroid
  // A hole, concavity or gap between islands can contain the centroid. Use an interior label point on the largest part.
  const [x,y,width] = new Polygon(mainland).getFlatInteriorPoint()
  if (width > 0 && inPolygon([x,y],mainland)) return [x,y]
}

export function districtCenter(area:CityFeature) {
  if (!districtCenters.has(area)) districtCenters.set(area,centerOfDistrict(area))
  return districtCenters.get(area)
}

interface BoundaryPart {
  feature: CityFeature
  rings: Position[][]
  west: number
  south: number
  east: number
  north: number
}

function boundaryParts(features: readonly CityFeature[], kind: string) {
  const parts: BoundaryPart[] = []
  for (const feature of features) {
    if (feature.properties.kind !== kind || feature.properties.sample === true) continue
    const geometry = feature.geometry
    const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates
      : geometry.type === 'Polygon' ? [geometry.coordinates] : []
    for (const rings of polygons) {
      if (!rings[0]?.length) continue
      let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
      for (const [x, y] of rings[0]) {
        west = Math.min(west, x)
        south = Math.min(south, y)
        east = Math.max(east, x)
        north = Math.max(north, y)
      }
      parts.push({ feature, rings, west, south, east, north })
    }
  }
  // A facility on a shared edge gets the same administrative unit on every reload.
  return parts.sort((a, b) => a.feature.id.localeCompare(b.feature.id))
}

function matchingParts(point: Coordinate, parts: BoundaryPart[]) {
  const [x, y] = point
  return parts.filter(part => x >= part.west && x <= part.east && y >= part.south && y <= part.north &&
    inPolygon(point, part.rings))
}

function belongsToTown(village: CityFeature, town: CityFeature) {
  const code = village.properties.regionCode
  if (code && town.properties.adcode) return String(code) === String(town.properties.adcode)
  return !village.properties.region || village.properties.region === town.properties.name
}

/** Look up both levels in the published administrative polygons, including islands and holes. */
export function createFacilityBoundaryIndex(townFeatures: readonly CityFeature[], communityFeatures: readonly CityFeature[]) {
  const towns = boundaryParts(townFeatures, 'town-boundary')
  const villages = boundaryParts(communityFeatures, 'community')
  return {
    locate(point: Coordinate): { town?: CityFeature; village?: CityFeature } {
      const townHits = matchingParts(point, towns)
      const villageHits = matchingParts(point, villages)
      for (const { feature: town } of townHits) {
        const village = villageHits.find(hit => belongsToTown(hit.feature, town))?.feature
        if (village) return { town, village }
      }
      // Separately simplified layers can leave slivers between adjacent boundaries.
      // Keep a confirmed town even when no child polygon covers this point.
      return { town: townHits[0]?.feature, village: townHits.length ? undefined : villageHits[0]?.feature }
    },
  }
}
