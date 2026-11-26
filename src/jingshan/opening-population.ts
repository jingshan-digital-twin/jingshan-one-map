import { rasterGroups, rasterRadiusPopulation, viewBits, type RasterScope } from './population-raster-coverage.ts'
import type { PopulationRaster, RasterSelection } from './population-raster.ts'
import { featureCenter, type CityFeature, type Coordinate } from './types.ts'

export function openingPopulation(grid:PopulationRaster, courts:CityFeature[], scope:RasterScope, radius:number) {
  const {mask,groups}=rasterGroups(grid,scope)
  const people=new Int32Array(grid.slots), open=new Uint16Array(grid.slots)
  const footprints=new Map<string,number[]>()
  for(const court of courts){
    const center=featureCenter(court)
    if(!center)continue
    const indices:number[]=[]
    rasterRadiusPopulation(grid,center,radius,undefined,i=>{
      if(!mask[i])return
      indices.push(i)
      if(court.properties.open===true)open[i]++
    })
    footprints.set(court.id,indices)
  }
  let covered=0, densePeople=0
  for(const block of grid.blocks)for(let i=0;i<block.people.length;i++){
    const index=block.offset+i
    if(!mask[index])continue
    const n=people[index]=block.people[i]
    if(open[index]){covered+=n;mask[index]|=viewBits.covered}
    else{
      mask[index]|=viewBits.uncovered
      if(n>0 && grid.highDensityThreshold!==null && n*100>=grid.highDensityThreshold){
        mask[index]|=viewBits.denseUncovered
        densePeople+=n
      }
    }
  }
  return {grid,mask,people,footprints,covered,densePeople,total:groups.all.people,radius}
}
export type OpeningPopulation=ReturnType<typeof openingPopulation>

export function openingImpact(model:OpeningPopulation, courtIds:Iterable<string>, alreadyPlanned?:ReadonlySet<number>){
  const indices=new Set<number>()
  for(const id of courtIds)for(const i of model.footprints.get(id)??[])indices.add(i)
  let before=0,added=0,denseAdded=0
  for(const i of indices){
    const n=model.people[i]
    if((model.mask[i]&viewBits.covered) || alreadyPlanned?.has(i))before+=n
    else {added+=n;if(model.mask[i]&viewBits.denseUncovered)denseAdded+=n}
  }
  return {indices,before,after:before+added,added,denseAdded}
}

export function openingRecommendations<T extends {id:string;name:string;courts:{id:string}[]}>(
  model:OpeningPopulation, venues:T[], chosen:ReadonlySet<string>, planned:ReadonlySet<number>|undefined, activeVenues:ReadonlySet<string>
){
  return venues.flatMap(venue=>{
    if(activeVenues.has(venue.id) || venue.courts.some(court=>chosen.has(court.id)))return []
    const gain=openingImpact(model,venue.courts.map(court=>court.id),planned)
    return gain.added>0 ? [{venue,gain}] : []
  }).sort((a,b)=>b.gain.added-a.gain.added || b.gain.denseAdded-a.gain.denseAdded || a.venue.name.localeCompare(b.venue.name,'zh-CN'))
}

export type GapArea={
  id:string; name:string; town:string; boundary?:CityFeature
  total:number; covered:number; people:number; bounds:[number,number,number,number]
}
export function openingGapAreas(model:OpeningPopulation, towns:CityFeature[]){
  const byTown=new Map(towns.filter(f=>f.properties.kind==='town-boundary').map(f=>[f.properties.name,f]))
  const areas=new Map<string,GapArea>()
  for(const block of model.grid.blocks)for(let i=0;i<block.people.length;i++){
    const slot=block.offset+i, flags=model.mask[slot], residents=model.people[slot]
    if(!flags || !residents)continue
    const town=block.regions[block.zones[i]]
    let area=areas.get(town)
    if(!area){
      const boundary=byTown.get(town)
      area={id:boundary?.id??'gap-town:'+town,name:town==='京山市'?'镇街待匹配':town,town,boundary,
        total:0,covered:0,people:0,bounds:[Infinity,Infinity,-Infinity,-Infinity]}
      areas.set(town,area)
    }
    area.total+=residents
    if(flags&viewBits.covered)area.covered+=residents
    if(!(flags&viewBits.denseUncovered))continue
    area.people+=residents
    const b=area.bounds,x=block.lon[i],y=block.lat[i]
    b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y)
  }
  return [...areas.values()].filter(a=>a.people>0).sort((a,b)=>b.people-a.people || a.name.localeCompare(b.name,'zh-CN'))
}

export function gapAreaMask(model:OpeningPopulation,area:GapArea){
  const mask=new Uint8Array(model.mask.length)
  for(const block of model.grid.blocks){
    if(!block.regions.includes(area.town))continue
    for(let i=0;i<block.people.length;i++)if(block.regions[block.zones[i]]===area.town)mask[block.offset+i]=model.mask[block.offset+i]
  }
  return mask
}

export function openingGapSelection(model:OpeningPopulation, planned?:ReadonlySet<number>, areaMask?:Uint8Array):RasterSelection{
  return {grid:model.grid,mask:areaMask??model.mask,bit:viewBits.denseUncovered,planned}
}

export function gapAreaFrame(area:GapArea):CityFeature{
  if(area.boundary)return area.boundary
  const [w,s,e,n]=area.bounds,center:Coordinate=[(w+e)/2,(s+n)/2]
  return {id:area.id,type:'Feature',properties:{kind:'gap-bounds',region:area.town,name:area.name,center},
    geometry:{type:'Polygon',coordinates:[[[w-.001,s-.001],[e+.001,s-.001],[e+.001,n+.001],[w-.001,n+.001],[w-.001,s-.001]]]}}
}
