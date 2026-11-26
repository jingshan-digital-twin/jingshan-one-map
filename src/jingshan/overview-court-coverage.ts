import { distanceM } from './analytics.ts'
import { highDensityCutoff } from './population-grid.ts'
import { featureCenter, type CityFeature, type Coordinate } from './types.ts'

export const populationViews = [
  { id: 'all', metric: '网格人口', layer: '全部人口网格' },
  { id: 'covered', metric: '已覆盖人口', layer: '已覆盖网格' },
  { id: 'uncovered', metric: '未覆盖人口', layer: '未覆盖网格' },
  { id: 'denseUncovered', metric: '高密度未覆盖', layer: '高密度未覆盖网格' },
] as const
export type PopulationView = typeof populationViews[number]['id']
export const coverageRadii = [500, 1000, 2000, 3000] as const

type PopulationTally = { grids: number; known: number; people: number }
const emptyTally = (): PopulationTally => ({ grids: 0, known: 0, people: 0 })
function countGrid(tally: PopulationTally, population: number | null) {
  tally.grids++
  if (population !== null) {
    tally.known++
    tally.people += population
  }
}
export function estimatedPeople(tally: PopulationTally, hasPopulation: boolean) {
  return hasPopulation && (tally.known > 0 || tally.grids === 0) ? tally.people : undefined
}

function nonNegative(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
function withinRadius(a: Coordinate, b: Coordinate, meters: number) {
  return Math.abs(a[1] - b[1]) * 110000 <= meters && distanceM(a, b) <= meters
}

export function preparePopulationGrid(features: CityFeature[]) {
  const cells = features.map(feature => ({
    feature, center: featureCenter(feature), population: nonNegative(feature.properties.population),
    density: nonNegative(feature.properties.densityPerKm2),
  }))
  const densities = cells.flatMap(({population, density}) =>
    population !== null && population > 0 && density !== null ? [density] : [])
  return { cells, highDensityThreshold: highDensityCutoff(densities), hasPopulation: cells.some(cell => cell.population !== null) }
}
type PopulationGrid = ReturnType<typeof preparePopulationGrid>

export function populationAroundPoint(grid: PopulationGrid, center: Coordinate, radiusM: number) {
  const tally = emptyTally()
  for (const cell of grid.cells) {
    if (cell.center && withinRadius(center, cell.center, radiusM)) countGrid(tally, cell.population)
  }
  return estimatedPeople(tally, grid.hasPopulation)
}

export function measureCourtCoverage(grid: PopulationGrid, courts: CityFeature[], radiusM: number) {
  const sites = courts.flatMap(feature => {
    const center = featureCenter(feature)
    return center ? [{id: feature.id, center, tally: emptyTally()}] : []
  })
  const courtCounts = new Map<string, number>()
  const cells = grid.cells.map(cell => {
    let count = 0
    if (cell.center && sites.length && radiusM > 0) {
      for (const site of sites) {
        if (withinRadius(site.center, cell.center, radiusM)) {
          countGrid(site.tally, cell.population)
          count++
        }
      }
      courtCounts.set(cell.feature.id, count)
      return {...cell, courtCount: count}
    }
    return {...cell, courtCount: null}
  })
  const byCourt = new Map(sites.map(site => [site.id, site.tally]))
  return { cells, byCourt, courtCounts, highDensityThreshold: grid.highDensityThreshold }
}

export function groupCoverageGrids(coverage: ReturnType<typeof measureCourtCoverage>, include?: (feature: CityFeature) => boolean) {
  const group = () => ({...emptyTally(), features: [] as CityFeature[]})
  const groups = {all: group(), covered: group(), uncovered: group(), denseUncovered: group()}
  function add(view: PopulationView, feature: CityFeature, population: number | null) {
    groups[view].features.push(feature)
    countGrid(groups[view], population)
  }
  for (const {feature, population, density, courtCount} of coverage.cells) {
    if (include && !include(feature)) continue
    add('all', feature, population)
    if (courtCount === null) continue
    add(courtCount ? 'covered' : 'uncovered', feature, population)
    if (!courtCount && population !== null && population > 0 && density !== null &&
        coverage.highDensityThreshold !== null && density >= coverage.highDensityThreshold) {
      add('denseUncovered', feature, population)
    }
  }
  return { groups, hasCourts: coverage.byCourt.size > 0, highDensityThreshold: coverage.highDensityThreshold }
}
export type CoverageGridSummary = {
  groups: Record<PopulationView, PopulationTally>; hasCourts:boolean; highDensityThreshold:number|null
}

export function courtPopulationCoverage(courts: CityFeature[], cells: CityFeature[], walkM: number) {
  if (!(walkM > 0)) return undefined
  const {groups, hasCourts} = groupCoverageGrids(measureCourtCoverage(preparePopulationGrid(cells), courts, walkM))
  return hasCourts && groups.all.people ? Math.round(groups.covered.people * 1000 / groups.all.people) / 10 : undefined
}
