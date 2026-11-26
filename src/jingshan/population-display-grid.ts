import { rasterFeatureById, selectedPixel, type RasterSelection } from './population-raster.ts'
import { viewBits } from './population-raster-coverage.ts'
import type { PopulationRange } from './population-surface.ts'
import type { CityFeature, Coordinate } from './types.ts'

// At Jingshan's latitude these angular steps are about 497 m east–west and 499 m north–south.
export const displayColumnsPerDegree = 192
export const displayRowsPerDegree = 222
const columnsAroundGlobe = 360 * displayColumnsPerDegree
const idPrefix = 'js-pop-display-'
const cellKey = (column:number, row:number) => row * columnsAroundGlobe + column

type DisplayCell = {
  column:number; row:number; people:number; sourceCells:number; regions:Set<string>
  coveredPeople:number; plannedPeople:number; minCourts:number; maxCourts:number
}
export type PopulationDisplayGrid = ReturnType<typeof populationDisplayGrid>

export function populationDisplayGrid(selection:RasterSelection, range?:PopulationRange, courtCounts?:Uint16Array) {
  const cells = new Map<number, DisplayCell>()
  const radiusX = range ? range.meters / (111320 * Math.cos(range.center[1] * Math.PI / 180)) : 0
  const radiusY = range ? range.meters / 110900 : 0
  for (const block of selection.grid.blocks) {
    for (let i = 0; i < block.people.length; i++) {
      if (!selectedPixel(selection, block, i)) continue
      const x = block.lon[i], y = block.lat[i]
      if (range && ((x-range.center[0])/radiusX)**2 + ((y-range.center[1])/radiusY)**2 > 1) continue
      const column = Math.floor(x * displayColumnsPerDegree), row = Math.floor(y * displayRowsPerDegree)
      const key = cellKey(column, row)
      let cell = cells.get(key)
      if (!cell) {
        cell = { column, row, people:0, sourceCells:0, regions:new Set(), coveredPeople:0, plannedPeople:0, minCourts:Infinity, maxCourts:0 }
        cells.set(key, cell)
      }
      const people = block.people[i]
      cell.people += people
      if(selection.planned?.has(block.offset+i))cell.plannedPeople+=people
      cell.sourceCells++
      cell.regions.add(block.regions[block.zones[i]])
      if (courtCounts) {
        const count = courtCounts[block.offset+i]
        if (count) cell.coveredPeople += people
        cell.minCourts = Math.min(cell.minCourts, count)
        cell.maxCourts = Math.max(cell.maxCourts, count)
      }
    }
  }
  const bounds:[number,number,number,number] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [key, cell] of cells) {
    if (!cell.people) {
      cells.delete(key)
      continue
    }
    bounds[0] = Math.min(bounds[0], cell.column)
    bounds[1] = Math.min(bounds[1], cell.row)
    bounds[2] = Math.max(bounds[2], cell.column+1)
    bounds[3] = Math.max(bounds[3], cell.row+1)
  }
  // High-density residents are grouped into the same display cells as the other views.
  // Their displayed area still ends at the service-circle and township boundaries.
  const footprint = selection.bit === viewBits.denseUncovered ? {...selection, bit:viewBits.uncovered} : selection
  return {cells, bounds, footprint, selection, range, radiusX, radiusY}
}

export function displayCellAt(display:PopulationDisplayGrid, x:number, y:number) {
  return display.cells.get(cellKey(Math.floor(x * displayColumnsPerDegree), Math.floor(y * displayRowsPerDegree)))
}

export function displayCellId(cell:DisplayCell) { return idPrefix + cellKey(cell.column, cell.row) }
export function displayDensity(cell:DisplayCell) { return cell.people * 100 / cell.sourceCells }

export function displayCellGeometry(column:number,row:number){
  const west=column/displayColumnsPerDegree, east=(column+1)/displayColumnsPerDegree
  const south=row/displayRowsPerDegree, north=(row+1)/displayRowsPerDegree
  const center:Coordinate=[(west+east)/2,(south+north)/2]
  return {center,geometry:{type:'Polygon' as const,coordinates:[[[west,north],[west,south],[east,south],[east,north],[west,north]]]}}
}
export function populationMapFeature(display:PopulationDisplayGrid, id:string):CityFeature|undefined {
  if (!id.startsWith(idPrefix)) return rasterFeatureById(display.selection.grid, id, display.selection)
  const cell = display.cells.get(Number(id.slice(idPrefix.length)))
  if (!cell) return
  const {center,geometry}=displayCellGeometry(cell.column,cell.row)
  return {type:'Feature', id, geometry,
    properties:{kind:'population-grid', name:'人口汇总网格', region:[...cell.regions].join('、'), center,
      population:cell.people, densityPerKm2:displayDensity(cell), sourceCells:cell.sourceCells,
      ...(display.selection.planned ? {plannedPopulation:cell.plannedPeople} : {}),
      ...(Number.isFinite(cell.minCourts) ? {coveredPopulation:cell.coveredPeople, minCourts:cell.minCourts, maxCourts:cell.maxCourts} : {}),
    }}
}
