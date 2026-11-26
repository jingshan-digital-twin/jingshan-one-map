import { courtAvailable, coverage, distanceM, featureAreaM2, normalizeRules, type BlindArea, type CoverageOptions, type Rules } from './analytics.ts'
import { featureCenter, type CityFeature, type Coordinate, type Dataset } from './types.ts'
import { dashboardPalette } from './dashboard-palette.ts'
import { highDensityCutoff, populationDataset } from './population-grid.ts'
import { populationCellId, populationRaster, residentGridId } from './population-raster.ts'
import { rasterRadiusPopulation } from './population-raster-coverage.ts'

export type VenueCapacityOptions = CoverageOptions & {
  populationFilter?: (feature:CityFeature) => boolean
  facilityFilter?: (feature:CityFeature) => boolean
}

export type VenueFacilityCapacity = {
  id:string
  name:string
  region:string
  feature:CityFeature
  position:Coordinate
  totalCourts:number
  openCourts:number
  capacity:number
  reachablePopulation:number
  servedPopulation:number
  loadRate:number | null
  remainingCapacity:number
}

export type VenueCapacityCell = {
  feature:CityFeature
  position:Coordinate
  population:number
  servedPopulation:number
  outsidePopulation:number
  capacityShortfallPopulation:number
  underservedPopulation:number
  reachableCourts:number
  nearestDistanceM:number | null
  densityPerKm2:number | null
  highDensity:boolean
}

export type VenuePriorityArea = BlindArea & VenueCapacityCell & { capacityShortfall:boolean }

type VenueChoice = {index:number; distance:number}
type AllocationDemand = {population:number; options:VenueChoice[]}
type Demand = VenueCapacityCell & AllocationDemand
type Edge = {to:number; reverse:number; remaining:number}

function nearestChoice(a:VenueChoice, b:VenueChoice) {
  return a.distance-b.distance || a.index-b.index
}

function demandPriority(a:AllocationDemand, b:AllocationDemand) {
  return a.options.length-b.options.length || b.population-a.population
}

function rankFacilities(facilities:VenueFacilityCapacity[]) {
  return facilities.sort((a,b) => b.servedPopulation-a.servedPopulation || b.openCourts-a.openCourts || a.id.localeCompare(b.id))
}

function sum<T>(items:T[], value:(item:T) => number) {
  return items.reduce((total,item) => total + value(item),0)
}

function amount(value:unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback
}

function label(value:unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function inScope(feature:CityFeature, region:string|undefined) {
  return !region || region === '京山市' || feature.properties.region === region || feature.properties.community === region
}

function facilityInventory(venueRows:CityFeature[], courts:CityFeature[], options:VenueCapacityOptions, peoplePerCourt:number) {
  const venues = new Map(venueRows.map(venue => [venue.id,venue]))
  const grouped = new Map<string,CityFeature[]>()
  for (const court of courts) {
    const id = label(court.properties.facilityId) ?? court.id
    const list = grouped.get(id)
    if (list) list.push(court)
    else grouped.set(id,[court])
  }
  const ids = new Set([...venues.keys(),...grouped.keys()])
  return [...ids].sort().flatMap((id):VenueFacilityCapacity[] => {
    const items = grouped.get(id) ?? []
    const venue = venues.get(id)
    const feature = venue ?? items[0]
    const totalCourts = items.length ? sum(items,court => amount(court.properties.count,1)) : amount(feature.properties.count)
    const openCourts = items.length ? sum(items.filter(court => courtAvailable(court,options)),court => amount(court.properties.count,1))
      : courtAvailable(feature,options) ? totalCourts : 0
    const centers = items.flatMap(court => {
      const position = featureCenter(court)
      return position ? [position] : []
    })
    const position:Coordinate|null = (venue ? featureCenter(venue) : null) ?? (centers.length
      ? [sum(centers,item => item[0]) / centers.length,sum(centers,item => item[1]) / centers.length] : null)
    if (!position) return []
    const name = venue?.properties.name ?? label(feature.properties.facilityName) ?? feature.properties.name
    const capacity = openCourts * peoplePerCourt
    return [{
      id,name,region:feature.properties.region,position,feature,totalCourts,openCourts,capacity,
      reachablePopulation:0,servedPopulation:0,loadRate:null,remainingCapacity:capacity,
    }]
  })
}

function connect(graph:Edge[][], from:number, to:number, limit:number) {
  const edge = {to,reverse:graph[to].length,remaining:limit}
  graph[to].push({to:from,reverse:graph[from].length,remaining:0})
  graph[from].push(edge)
  return edge
}

function distribute(graph:Edge[][], source:number, sink:number) {
  // Residents can be reassigned to nearby alternatives to use all feasible supply.
  while (true) {
    const levels = graph.map(() => -1)
    levels[source] = 0
    const queue = [source]
    for (let index = 0; index < queue.length; index++) {
      const node = queue[index]
      for (const edge of graph[node]) if (edge.remaining > 0 && levels[edge.to] < 0) {
        levels[edge.to] = levels[node] + 1
        queue.push(edge.to)
      }
    }
    if (levels[sink] < 0) return
    const next = graph.map(() => 0)
    function send(node:number, flow:number):number {
      if (node === sink) return flow
      while (next[node] < graph[node].length) {
        const edge = graph[node][next[node]]
        if (edge.remaining > 0 && levels[edge.to] === levels[node] + 1) {
          const moved = send(edge.to,Math.min(flow,edge.remaining))
          if (moved > 0) {
            edge.remaining -= moved
            graph[edge.to][edge.reverse].remaining += moved
            return moved
          }
        }
        next[node]++
      }
      return 0
    }
    while (send(source,Number.MAX_SAFE_INTEGER) > 0) { /* push available paths until this level graph is exhausted */ }
  }
}

function assignPopulation(cells:AllocationDemand[], facilities:VenueFacilityCapacity[]) {
  const source = cells.length + facilities.length
  const sink = source + 1
  const graph:Edge[][] = Array.from({length:sink+1},() => [])
  const edges = cells.map((cell,index) => {
    const edge = connect(graph,source,index,cell.population)
    for (const {index:venue} of cell.options) connect(graph,index,cells.length+venue,cell.population)
    return edge
  })
  const supply = facilities.map((facility,index) => connect(graph,cells.length+index,sink,facility.capacity))
  distribute(graph,source,sink)
  facilities.forEach((facility,index) => {
    facility.remainingCapacity = supply[index].remaining
    facility.servedPopulation = facility.capacity - facility.remainingCapacity
    facility.loadRate = facility.capacity ? Math.round(facility.servedPopulation * 1000 / facility.capacity) / 10 : null
  })
  return edges
}

export function walkingVenueDirectory(datasets:Dataset[], overrides?:Partial<Rules>):VenueFacilityCapacity[] {
  const grid = populationRaster(datasets.find(dataset => dataset.id === residentGridId))
  if (!grid) return venueCapacity(datasets,{mode:'walk'},overrides).facilities

  const rules = normalizeRules(overrides)
  const features = (id:string) => datasets.find(dataset => dataset.id === id)?.features ?? []
  const facilities = facilityInventory(features('venues'),features('courts'),{},Math.max(1,Math.round(rules.peoplePerCourt)))
  const demand = new Map<number,AllocationDemand & {id:string}>()
  // Cells outside every open venue's radius cannot supply a flow edge or affect directory order.
  for (const [index,facility] of facilities.entries()) {
    const nearby = rasterRadiusPopulation(grid,facility.position,rules.walkM,undefined,(offset,block,pixel,distance) => {
      const population = block.people[pixel]
      if (!population || !facility.capacity) return
      let cell = demand.get(offset)
      if (!cell) {
        cell = {id:populationCellId(block,pixel),population,options:[]}
        demand.set(offset,cell)
      }
      cell.options.push({index,distance})
    })
    facility.reachablePopulation = nearby.people
  }
  const cells = [...demand.values()].sort((a,b) => demandPriority(a,b) || a.id.localeCompare(b.id))
  for (const cell of cells) cell.options.sort(nearestChoice)
  assignPopulation(cells,facilities)
  return rankFacilities(facilities)
}

export function venueCapacity(datasets:Dataset[], options:VenueCapacityOptions = {}, overrides?:Partial<Rules>) {
  const rules = normalizeRules(overrides)
  const peoplePerCourt = Math.max(1,Math.round(rules.peoplePerCourt))
  const features = (id:string) => datasets.find(dataset => dataset.id === id)?.features ?? []
  const populationSource = populationDataset(datasets)
  const populations = populationSource?.features ?? []
  const selectedPopulation = populations.filter(feature => options.populationFilter?.(feature) ?? true)
  const coverageDatasets = options.populationFilter
    ? datasets.map(dataset => dataset.id === populationSource?.id ? {...dataset,features:selectedPopulation} : dataset) : datasets
  const baseline = coverage(coverageDatasets,options,rules)
  const radiusM = baseline.radiusM
  const facilities = facilityInventory(features('venues'),features('courts'),options,peoplePerCourt)
  const cells = populations.flatMap((feature):Demand[] => {
    const position = featureCenter(feature)
    const population = amount(feature.properties.population)
    if (!position || !population) return []
    const sourceDensity = feature.properties.densityPerKm2
    const area = typeof sourceDensity === 'number' ? 0 : featureAreaM2(feature,position)
    const densityPerKm2 = typeof sourceDensity === 'number' ? sourceDensity : area > 0 ? Math.round(population * 1_000_000 / area) : null
    let nearestDistance = Infinity
    const choices = facilities.flatMap((facility,index) => {
      const distance = distanceM(position,facility.position)
      if (facility.capacity) nearestDistance = Math.min(nearestDistance,distance)
      if (distance > radiusM) return []
      facility.reachablePopulation += population
      return facility.capacity ? [{index,distance}] : []
    }).sort(nearestChoice)
    return [{
      feature,position,population,densityPerKm2,highDensity:false,
      servedPopulation:0,outsidePopulation:0,capacityShortfallPopulation:0,underservedPopulation:0,
      nearestDistanceM:Number.isFinite(nearestDistance) ? Math.round(nearestDistance) : null,
      reachableCourts:sum(choices,choice => facilities[choice.index].openCourts),options:choices,
    }]
  }).sort((a,b) => demandPriority(a,b) || a.feature.id.localeCompare(b.feature.id))
  const highDensityThreshold = highDensityCutoff(cells.flatMap(cell => cell.densityPerKm2 === null ? [] : [cell.densityPerKm2]))
  const edges = assignPopulation(cells,facilities)
  cells.forEach((cell,index) => {
    cell.servedPopulation = cell.population - edges[index].remaining
    cell.underservedPopulation = edges[index].remaining
    cell.outsidePopulation = cell.options.length ? 0 : cell.population
    cell.capacityShortfallPopulation = cell.underservedPopulation - cell.outsidePopulation
  })
  const selectedIds = new Set(selectedPopulation.filter(feature => inScope(feature,options.region)).map(feature => feature.id))
  const capacityCells:VenueCapacityCell[] = cells.filter(cell => selectedIds.has(cell.feature.id)).map(({options:choices,...cell}) => ({
    ...cell,highDensity:cell.densityPerKm2 !== null && highDensityThreshold !== null && cell.densityPerKm2 >= highDensityThreshold,
  }))
  const priorityAreas:VenuePriorityArea[] = capacityCells.filter(cell => cell.underservedPopulation > 0).map(cell => {
    const capacityShortfall = cell.capacityShortfallPopulation > 0
    const kind = capacityShortfall ? 'capacity-gap' : 'coverage-blind'
    const id = kind + ':' + cell.feature.id
    const gap = Math.ceil(cell.underservedPopulation / peoplePerCourt)
    const {name,region} = cell.feature.properties
    return {
      ...cell,id,name,region,gap,capacityShortfall,
      feature:{...cell.feature,id,properties:{
        ...cell.feature.properties,kind,sourceId:cell.feature.id,color:capacityShortfall ? dashboardPalette.orange : dashboardPalette.red,
        population:cell.population, densityPerKm2:cell.densityPerKm2, gap, highDensity:cell.highDensity,
        outsidePopulation:cell.outsidePopulation,capacityShortfallPopulation:cell.capacityShortfallPopulation,
        underservedPopulation:cell.underservedPopulation,reachableCourts:cell.reachableCourts,
        nearestDistanceM:cell.nearestDistanceM,
      }},
    }
  }).sort((a,b) => Number(b.highDensity)-Number(a.highDensity) || b.underservedPopulation-a.underservedPopulation ||
    (b.densityPerKm2 ?? 0)-(a.densityPerKm2 ?? 0) || a.id.localeCompare(b.id))
  const visibleFacilities = rankFacilities(facilities.filter(facility =>
    inScope(facility.feature,options.region) && (options.facilityFilter?.(facility.feature) ?? true)))
  const totalPopulation = sum(capacityCells,cell => cell.population)
  const outsidePopulation = sum(capacityCells,cell => cell.outsidePopulation)
  return {
    radiusM,peoplePerCourt,highDensityThreshold,totalPopulation,outsidePopulation,
    reachablePopulation:totalPopulation-outsidePopulation,
    capacityServedPopulation:sum(capacityCells,cell => cell.servedPopulation),
    capacityShortfallPopulation:sum(capacityCells,cell => cell.capacityShortfallPopulation),
    underservedPopulation:sum(capacityCells,cell => cell.underservedPopulation),
    openCourts:sum(visibleFacilities,facility => facility.openCourts),
    facilities:visibleFacilities,priorityAreas,capacityCells,overlays:priorityAreas.map(area => area.feature),coverage:baseline,
  }
}
