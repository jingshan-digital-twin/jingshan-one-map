import { isDeepStrictEqual } from 'node:util'
import { readFile } from 'node:fs/promises'
import type { CityFeature, DataDocument } from '../src/jingshan/types.ts'

export async function readSeededCourtRows() {
  const seeds = await Promise.all(['demo-data.json', 'demo-data-v3.json'].map(async filename => {
    const text = await readFile(new URL('../public/jingshan/' + filename, import.meta.url), 'utf8')
    const document = JSON.parse(text) as DataDocument
    return document.datasets.find(layer => layer.id === 'courts')?.features.filter(row=>row.properties.sample===true) ?? []
  }))
  const rows = new Map<string, CityFeature[]>()
  for (const row of seeds.flat()) {
    if (row.properties.sample === true && row.properties.kind === 'court') {
      rows.set(row.id, [...(rows.get(row.id) ?? []), row])
    }
  }
  return rows
}

// Keep the layer ID for existing bindings and any records maintained by the user.
export function retireDemoCourts(data: DataDocument, seeds: Map<string, CityFeature[]>, scheduled: Set<string>) {
  const inventory = data.datasets.find(layer => layer.id === 'courts')
  if (!inventory?.features.length || !data.datasets.some(layer => layer.id === 'court_footprints' && layer.features.length)) return data
  const features = inventory.features.filter(feature =>
    scheduled.has(feature.id) || !seeds.get(feature.id)?.some(seed => isDeepStrictEqual(feature, seed)),
  )
  if (features.length === inventory.features.length) return data
  return { ...data, datasets: data.datasets.map(layer => layer === inventory ? {...layer, features} : layer) }
}

