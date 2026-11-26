import type { Position } from 'geojson'
import { FACILITY_VILLAGE_RESOLUTION } from './facility-clusters.ts'
import type { Coordinate } from './types.ts'

type Target = {position: Coordinate; count: number; outline?: Position[]}
type Extent = {left:number; right:number; top:number; bottom:number}

function extentOf(points: {x:number; y:number}[]): Extent {
  return points.reduce(({left,right,top,bottom},{x,y}) => ({
    left:Math.min(left,x),right:Math.max(right,x),top:Math.max(top,y),bottom:Math.min(bottom,y),
  }),{left:Infinity,right:-Infinity,top:-Infinity,bottom:Infinity})
}

/** Frame the next level's visible content. At court level the first view must resolve individual surfaces. */
export function courtDrillFrame(targets: Target[], level: 'town' | 'village', width: number, height: number,
  currentResolution: number, heading: number, incline: number) {
  if (!targets.length || width <= 0 || height <= 0) return
  const [lon,lat] = targets[0].position
  const latitudeScale = 111195, longitudeScale = latitudeScale*Math.cos(lat*Math.PI/180)
  const c = Math.cos(heading), s = Math.sin(heading), pitch = Math.max(.4,Math.cos(incline))
  // Screen axes in ground metres at the centre of the tilted view, relative to the first target.
  const project = ([lng,latitude]: Position) => {
    const east = (lng-lon)*longitudeScale, north = (latitude-lat)*latitudeScale
    return {x:(c*east-s*north)*pitch, y:(s*east+c*north)*pitch*pitch}
  }
  const points = targets.map(t => ({...project(t.position),count:t.count,
    corners:(t.outline?.length ? t.outline : [t.position]).map(project)}))
  const extent = (items: typeof points) => extentOf(items.flatMap(p=>p.corners))
  const fit = (e: Extent) => Math.max((e.right-e.left)/width,(e.bottom-e.top)/height)
  const town = level === 'town'
  const minResolution = town ? FACILITY_VILLAGE_RESOLUTION*1.25 : .24
  const maxResolution = Math.max(minResolution,Math.min(currentResolution*.55,town ? 28 : .65*pitch*pitch))
  let bounds = extent(points)
  if (fit(bounds) > maxResolution) {
    // Widely separated courts remain in the layer. Start over the group with the most courts in view.
    const halfWidth = width*maxResolution/2, halfHeight = height*maxResolution/2
    let best = -1
    for (const anchor of points) {
      const nearby = points.filter(p=>Math.abs(p.x-anchor.x)<=halfWidth && Math.abs(p.y-anchor.y)<=halfHeight)
      const count = nearby.reduce((sum,p)=>sum+p.count,0)
      if (count > best) { best = count; bounds = extent(nearby) }
    }
  }
  const x = (bounds.left+bounds.right)/(2*pitch), y = (bounds.top+bounds.bottom)/(2*pitch*pitch)
  const center: Coordinate = [lon+(x*c+y*s)/longitudeScale,lat+(-x*s+y*c)/latitudeScale]
  return {center,resolution:Math.max(minResolution,Math.min(maxResolution,fit(bounds)))}
}
