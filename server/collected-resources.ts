import { legacyPopulationGridId, populationGridId } from '../src/jingshan/population-grid.ts'
import { publishedCatalog } from '../src/jingshan/portal-catalog.ts'
import { readFile } from 'node:fs/promises'
import type { CityFeature, DataDocument, Dataset } from '../src/jingshan/types.ts'
import { checkDocument } from '../src/jingshan/validate.ts'
import { isCourtLedgerId, withCourtLedger } from '../src/jingshan/court-ledger.ts'
import { overviewCourtStatsId } from '../src/jingshan/estimated-court-inventory.ts'

export async function readCollectedResources(): Promise<Dataset[]> {
  const [registers, footprints, population] = await Promise.all([
    readFile(new URL('./resource-sources/collected-202611.json', import.meta.url), 'utf8'),
    readFile(new URL('./resource-sources/tennis1124.json', import.meta.url), 'utf8'),
    readFile(new URL('./resource-sources/jingshan-population-100m.json', import.meta.url), 'utf8'),
  ])
  return [...JSON.parse(registers), JSON.parse(footprints), JSON.parse(population)]
}

function applyLocationReview(row: CityFeature, source?: CityFeature): CityFeature {
  const current = row.properties
  const reviewed = source?.properties
  const previous = current.locationReview
  if (!source || !reviewed?.locationReview || current.locationManuallyEdited ||
      row.geometry.type !== 'GeometryCollection' || current.locationSource || current.locationRef ||
      current.name !== reviewed.name || current.address !== reviewed.address || current.region !== reviewed.region ||
      current.recordSource !== reviewed.recordSource || current.sourceRow !== reviewed.sourceRow) return row
  if (previous && (previous.poi || previous.checkedOn > reviewed.locationReview.checkedOn ||
      previous.checkedOn === reviewed.locationReview.checkedOn && !reviewed.locationReview.poi)) return row

  const properties = {...current, locationReview: reviewed.locationReview}
  if (source.geometry.type === 'Point') {
    const {bbox, ...original} = row
    return {...original, geometry: source.geometry, properties: {...properties,
      locationSource: reviewed.locationSource, locationRef: reviewed.locationRef}}
  }
  return {...row, properties}
}

export function withCollectedResources(data: DataDocument, additions: Dataset[], contacts: Record<string,string> = {}) {
  const population=additions.find(s=>s.id===populationGridId)
  if(population) data=replacePopulationSource(data,population)
  const datasets = [...data.datasets]
  let changed = false
  for (const source of additions) {
    if(source.id===populationGridId)continue
    const index = datasets.findIndex(dataset => dataset.id === source.id)
    const existing = datasets[index]
    // A later install must preserve edited counts, verified rows and intentional deletions.
    if (existing && (source.id === overviewCourtStatsId || isCourtLedgerId(source.id))) continue
    const remaining = new Map(source.features.map(row => [row.id,row]))
    let updated = false
    const features = (existing?.features ?? []).map(row => {
      const reviewed = applyLocationReview(row, remaining.get(row.id))
      remaining.delete(row.id)
      if (reviewed !== row) updated = true
      return reviewed
    })
    features.push(...remaining.values())
    if (source.id === 'emergency_shelters') {
      for (const [i, row] of features.entries()) {
        if (!row.properties.dutyContact && contacts[row.id]) {
          features[i] = {...row, properties:{...row.properties, dutyContact:contacts[row.id]}}
          updated = true
        }
      }
    }
    if (!existing) datasets.push({...source, features})
    else if (remaining.size || updated) datasets[index] = {...existing, features}
    else continue
    changed = true
  }
  if (!changed) return data
  const next = withCourtLedger({...data, datasets})
  checkDocument(next)
  return next
}

// Replace only this source in each snapshot. Draft changes to unrelated resources remain independent.
function replacePopulationSource(data:DataDocument, source:Dataset):DataDocument {
  const old=data.datasets.find(d=>d.id===legacyPopulationGridId)
  const current=data.datasets.find(d=>d.id===populationGridId)
  if(current && !old)return data
  const datasets=old
    ? data.datasets.filter(d=>d!==old || !current).map(d=>d===old ? source : d)
    : [...data.datasets,source]
  const next:DataDocument={...data,datasets}
  const oldSlot='dataset:'+legacyPopulationGridId,newSlot='dataset:'+populationGridId
  const oldService='hosted-'+legacyPopulationGridId,newService='hosted-'+populationGridId
  if(old && data.mapBindings)next.mapBindings=data.mapBindings.map(b=>({...b,slot:b.slot===oldSlot ? newSlot : b.slot,
    serviceId:b.serviceId===oldService ? newService : b.serviceId}))
  if(old && data.portalCatalog)next.portalCatalog={folders:data.portalCatalog.folders.map(f=>({...f,resources:[...new Set(f.resources.map(key=>
    key===oldSlot ? newSlot : key==='service:'+oldService ? 'service:'+newService : key))]}))}
  checkDocument(next)
  return next
}

const courtContactFields=['联系人','联系电话','CONTACT','PHONE']

export function publicResourceData(data: DataDocument): DataDocument {
  return {...data, ...(data.portalCatalog ? {portalCatalog:publishedCatalog(data.portalCatalog)} : {}), datasets:data.datasets.map(dataset => {
    const privateFields = isCourtLedgerId(dataset.id) ? courtContactFields : dataset.id==='emergency_shelters' ? ['dutyContact'] : undefined
    if (!privateFields) return dataset
    return {...dataset, features:dataset.features.map(row => {
      const properties = {...row.properties}
      for (const key of privateFields) delete properties[key]
      return {...row, properties}
    })}
  })}
}
