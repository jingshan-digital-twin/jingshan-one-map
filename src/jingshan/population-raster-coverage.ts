import { distanceM } from './analytics.ts'
import { featureCenter, type CityFeature, type Coordinate } from './types.ts'
import type { PopulationBlock, PopulationRaster, RasterSelection } from './population-raster.ts'
import type { PopulationView } from './overview-court-coverage.ts'

export const viewBits:Record<PopulationView,number>={all:1,covered:2,uncovered:4,denseUncovered:8}
function tally(){return {grids:0,known:0,people:0}}
function add(t:ReturnType<typeof tally>, n:number){t.grids++;t.known++;t.people+=n}

export function rasterRadiusPopulation(grid:PopulationRaster, center:Coordinate, meters:number, counts?:Uint16Array,
  visit?:(offset:number,block:PopulationBlock,index:number,distance:number)=>void){
  const result=tally()
  if(meters<=0)return result
  // Coarse envelope only. The final test uses the same geodesic distance as the court coverage panels.
  const dy=meters/110000, dx=meters/(110000*Math.cos((Math.abs(center[1])+dy)*Math.PI/180))
  const west=center[0]-dx, east=center[0]+dx, south=center[1]-dy, north=center[1]+dy
  for(const b of grid.blocks){
    if(b.bounds[0]>east || b.bounds[2]<west || b.bounds[1]>north || b.bounds[3]<south)continue
    for(let i=0;i<b.people.length;i++){
      if(b.people[i]<0 || b.lon[i]<west || b.lon[i]>east || b.lat[i]<south || b.lat[i]>north)continue
      const distance=distanceM(center,[b.lon[i],b.lat[i]])
      if(distance<=meters){
        add(result,b.people[i])
        if(counts)counts[b.offset+i]++
        visit?.(b.offset+i,b,i,distance)
      }
    }
  }
  return result
}
export function rasterCourtCoverage(grid:PopulationRaster,courts:CityFeature[],meters:number){
  const counts=new Uint16Array(grid.slots), byCourt=new Map<string,ReturnType<typeof tally>>()
  for(const court of courts){
    const center=featureCenter(court)
    if(center && meters>0)byCourt.set(court.id,rasterRadiusPopulation(grid,center,meters,counts))
  }
  return {counts,byCourt}
}
export type RasterScope={towns?:string[]; contains?:(x:number,y:number)=>boolean}
export function rasterGroups(grid:PopulationRaster, scope:RasterScope, coverage?:ReturnType<typeof rasterCourtCoverage>){
  const groups={all:tally(),covered:tally(),uncovered:tally(),denseUncovered:tally()}
  const mask=new Uint8Array(grid.slots)
  const threshold=grid.highDensityThreshold
  for(const b of grid.blocks){
    const allowed=b.regions.map(name=>scope.towns?.every(town=>town===name) ?? true)
    if(!allowed.some(Boolean))continue
    for(let i=0;i<b.people.length;i++){
      const n=b.people[i]
      if(n<0 || !allowed[b.zones[i]] || scope.contains && !scope.contains(b.lon[i],b.lat[i]))continue
      const key=b.offset+i
      mask[key]=viewBits.all; add(groups.all,n)
      if(!coverage?.byCourt.size) continue
      const view=coverage.counts[key] ? 'covered' : 'uncovered'
      mask[key]|=viewBits[view]; add(groups[view],n)
      if(view==='uncovered' && n>0 && threshold!==null && n*100>=threshold){
        mask[key]|=viewBits.denseUncovered; add(groups.denseUncovered,n)
      }
    }
  }
  return {groups,mask,hasCourts:!!coverage?.byCourt.size,highDensityThreshold:threshold}
}

export function blockVisible(block:PopulationBlock, selection:RasterSelection){
  return !selection.mask || selection.mask.subarray(block.offset,block.offset+block.people.length).some(v=>Boolean(v&selection.bit))
}
