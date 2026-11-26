import { Cartesian2, Cartesian3, PolygonHierarchy } from '@cesium/core'
import type { Position } from 'geojson'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import type { MapBounds } from './cim-map.ts'

/** Partition a roof along the edge of a higher-resolution raster. Each part keeps its native imagery. */
export function splitReliefCoverage(rings: Position[][], [west,south,east,north]: MapBounds) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x,y] of rings[0]) {
    minX = Math.min(minX,x)
    minY = Math.min(minY,y)
    maxX = Math.max(maxX,x)
    maxY = Math.max(maxY,y)
  }
  if (minX >= west && maxX <= east && minY >= south && maxY <= north) return [{rings,detail:true}]
  if (maxX <= west || minX >= east || maxY <= south || minY >= north) return [{rings,detail:false}]
  const rectangle: Polygon = [[[west,south],[east,south],[east,north],[west,north],[west,south]]]
  const inside = polygonClipping.intersection(rings as Polygon, rectangle)
  if (!inside.length) return [{rings,detail:false}]
  const outside = polygonClipping.difference(rings as Polygon, rectangle)
  return [...inside.map(rings=>({rings,detail:true})), ...outside.map(rings=>({rings,detail:false}))]
}

function surfaceRing(path: Position[]) {
  const ring = path.filter(([x,y], i) => {
    const previous = path[(i + path.length - 1) % path.length]
    return previous[0] !== x || previous[1] !== y
  })
  // Cesium normalizes the winding of position and texture hierarchies independently.
  // Supply both in its final (counterclockwise) order, including interior rings.
  let twiceArea = 0
  for (let i = 0; i < ring.length; i++) {
    const [x,y] = ring[i]
    const [nextX,nextY] = ring[(i + 1) % ring.length]
    twiceArea += x*nextY - nextX*y
  }
  return twiceArea < 0 ? ring.reverse() : ring
}

export function reliefSurface(paths: Position[][], height: number, bounds?: MapBounds) {
  const [outer,...holes] = paths.map(surfaceRing)
  const worldRing = (ring: Position[]) => ring.map(([lon,lat]) => Cartesian3.fromDegrees(lon,lat,height))
  const hierarchy = new PolygonHierarchy(worldRing(outer),holes.map(ring => new PolygonHierarchy(worldRing(ring))))
  if (!bounds) return {hierarchy}
  const [west,south,east,north] = bounds
  const texelRing = (ring: Position[]) => ring.map(([lon,lat]) => new Cartesian2((lon-west)/(east-west),(lat-south)/(north-south)))
  // PolygonGraphics accepts a hierarchy of Cartesian2 for texture coordinates.
  const textureCoordinates = {positions:texelRing(outer), holes:holes.map(ring=>({positions:texelRing(ring)}))} as unknown as PolygonHierarchy
  return {hierarchy,textureCoordinates}
}
