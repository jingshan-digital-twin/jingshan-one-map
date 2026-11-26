import type { Dataset } from './types.ts'

import { residentGridId, populationDemandRows, populationRaster } from './population-raster.ts'
import { dashboardPalette } from './dashboard-palette.ts'
export const plannedCoverageColor=dashboardPalette.green
export const populationGridId = residentGridId
export const legacyPopulationGridId = 'worldpop_population_2025'
export const worldPopSource = 'https://hub.worldpop.org/geodata/summary?id=76799'

export const populationBands = [
  { min: 0, label: '0–<10', color: '#377bea' },
  { min: 10, label: '10–<50', color: '#15c4df' },
  { min: 50, label: '50–<150', color: '#82e6a4' },
  { min: 150, label: '150–<500', color: '#ffdc54' },
  { min: 500, label: '500–<2,000', color: '#ff852e' },
  { min: 2000, label: '≥2,000', color: '#ee2850' },
] as const
export const noPopulationData = { label: '无数据', color: '#a5b4c1' }

export function highDensityCutoff(densities: number[]) {
  const ranked = densities.sort((a, b) => a - b)
  return ranked[Math.ceil(ranked.length * 0.75) - 1] ?? null
}

export function populationBand(density: unknown) {
  if (typeof density !== 'number' || !Number.isFinite(density) || density < 0) return noPopulationData
  return populationBands.findLast(band => density >= band.min)!
}

export function populationDataset(datasets: Dataset[]) {
  const source=datasets.find(dataset=>dataset.id===populationGridId)
  if(source && populationRaster(source)) return {...source,features:populationDemandRows(source)}
  return source ?? datasets.find(dataset=>dataset.id===legacyPopulationGridId) ?? datasets.find(dataset=>dataset.id==='population')
}
