import type { Dataset } from './types.ts'

export const overviewCourtStatsId = 'form_overview_court_stats'

// Used only to read historic, manually entered summary forms.
export function overviewCourtStatistics(region: string, dataset?: Dataset) {
  const records: Record<string, unknown>[] = dataset
    ? dataset.features.map((f) => f.properties)
    : []
  const scope =
    region === '京山市' ? records : records.filter((row) => row.region === region || row.name === region)
  const sum = (key: string) => {
    if (!scope.length) return undefined
    let total = 0
    for (const row of scope) {
      const value = row[key]
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return undefined
      total += value
    }
    return total
  }
  return {
    venues: sum('venues'),
    courts: sum('courts'),
    nationalVenues: sum('nationalSites'),
    ownership: ['stateCourts', 'schoolCourts', 'officeCourts', 'privateCourts', 'villageCourts'].map(sum),
    opening: ['fullOpenCourts', 'timedOpenCourts', 'closedCourts'].map(sum),
    estimated: scope.some((row) => row.estimated !== false),
  }
}
