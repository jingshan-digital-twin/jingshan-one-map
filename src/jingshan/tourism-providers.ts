import type { CityFeature, Dataset } from './types.ts'

export const tourismProviderId = 'form_tourism_providers'
export const providerTypes = ['旅行社','网球俱乐部','培训机构'] as const
export const panoramaProviderTopics = {
  网球俱乐部: '俱乐部运营',
  体育培训: '培训陪练',
  旅行社: '景区游览',
} as const
export type PanoramaProviderGroup = keyof typeof panoramaProviderTopics

export function panoramaProviderGroup(feature: CityFeature): PanoramaProviderGroup | undefined {
  const { sample, providerType, classification } = feature.properties
  if (sample === true) return
  if (providerType === '培训机构' && classification === '体育类') return '体育培训'
  if (providerType === '网球俱乐部' || providerType === '旅行社') return providerType
}

export function tourismProviders(datasets: Dataset[], category?: typeof providerTypes[number]) {
  const providers = datasets.find(dataset => dataset.id === tourismProviderId)?.features ?? []
  return category ? providers.filter(row => row.properties.providerType === category) : providers
}

export function providersAtVenue(providers: CityFeature[], venueName: string) {
  return venueName ? providers.filter(row => row.properties.venueName === venueName) : []
}

