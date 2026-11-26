import type { BlindArea } from './analytics.ts'
import { displayCellGeometry, displayColumnsPerDegree, displayRowsPerDegree } from './population-display-grid.ts'
import type { RasterSelection } from './population-raster.ts'

export function denseGapAreas(selection:RasterSelection,peoplePerCourt:number):BlindArea[] {
  const groups=new Map<string,BlindArea>()
  if(!selection.mask)return []
  for(const block of selection.grid.blocks){
    for(let i=0;i<block.people.length;i++){
      if(!(selection.mask[block.offset+i]&selection.bit))continue
      const region=block.regions[block.zones[i]]
      const col=Math.floor(block.lon[i]*displayColumnsPerDegree), row=Math.floor(block.lat[i]*displayRowsPerDegree)
      const id='investment-pop:'+col+':'+row+':'+region
      let cell=groups.get(id)
      if(!cell){
        const {center,geometry}=displayCellGeometry(col,row), name=region+'高密度缺口网格'
        cell={id,name,region,population:0,reachableCourts:0,gap:0,
          feature:{type:'Feature',id,geometry,properties:{kind:'coverage-blind',name,region,center}}}
        groups.set(id,cell)
      }
      cell.population+=block.people[i]
      cell.feature.properties.population=cell.population
      cell.gap=Math.ceil(cell.population/Math.max(1,peoplePerCourt))
    }
  }
  return [...groups.values()].sort((a,b)=>b.population-a.population || a.id.localeCompare(b.id))
}
