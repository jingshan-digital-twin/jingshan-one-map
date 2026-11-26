import { fusionDestinationsId } from './fusion-destinations.ts'
import type { CityFeature, Dataset } from './types.ts'

export function isTourismReference(feature:CityFeature) {
  return ['村级参考','待定位'].includes(String(feature.properties.locationPrecision))
}

// Keep existing spatial IDs for saved tickets, map selections and business associations.
export function withLocalTourismSites(datasets:Dataset[]):Dataset[] {
  const registered=datasets.find(d=>d.id===fusionDestinationsId)?.features.filter(f=>f.properties.scope==='京山' && f.properties.registerSource)
  const tourism=datasets.find(d=>d.id==='tourism')
  if (!registered?.length || !tourism) return datasets
  const bySource=new Map(registered.map(f=>[String(f.properties.sourceId || f.id),f]))
  const used=new Set<string>()
  const visible=(f:CityFeature)=>f.geometry.type==='Point' && f.properties.status!=='暂停'
  const features=tourism.features.flatMap(f=>{
    const update=bySource.get(f.id)
    if (!update) return [f]
    used.add(update.id)
    return visible(update)?[{...f,geometry:update.geometry,properties:{...f.properties,...update.properties,
      region:update.properties.region==='京山市'?f.properties.region:update.properties.region,kind:f.properties.kind}}]:[]
  })
  for (const f of registered) {
    if (!used.has(f.id) && visible(f)) features.push(f)
  }
  return datasets.map(d=>d===tourism?{...d,features}:d)
}
