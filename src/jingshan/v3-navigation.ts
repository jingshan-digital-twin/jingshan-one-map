import type { Scene } from './types.ts'
import { populationGridId, legacyPopulationGridId } from './population-grid.ts'
import { fusionDestinationsId } from './fusion-destinations.ts'
import { tourismProviderId } from './tourism-providers.ts'

export type V3Page = Exclude<Scene, 'talent'> | 'site'

type PageDefinition = {
  label: string
  left: string
  right: string
  department: string
  report: string
  urban?: boolean
  layers: string[]
  activeLayers: string[]
}

// The overview inventory uses the surveyed court footprints. Venue ledgers and population
// surfaces remain available to the analytical scenes that use them.
const excludedOverviewLayers = new Set(['courts', 'venues', 'population', populationGridId, legacyPopulationGridId])
export const panoramaRegisterLayers: readonly string[] = [tourismProviderId, fusionDestinationsId]
export function sceneAllowsLayer(page: V3Page | 'all', id: string) {
  if(id==='event_live_roads')return page==='liveEvent' || page==='all'
  if(id==='investment_survey_reference')return page==='all'
  if(id==='investment_reserve_parcels')return page==='investment' || page==='site' || page==='all'
  if((page==='investment' || page==='site') && ['capacityGaps','eventHeat','supplyGaps','sitePassed','siteRejected','parcels','constraints','ecology','farmland','development'].includes(id))return false
  return page !== 'overview' || !excludedOverviewLayers.has(id)
}

export const pages: Record<V3Page, PageDefinition> = {
  overview: {
    label: '一图总览', left: '网球产业家底', right: '运行态势', department: '政数局', report: '网球产业总览',
    layers: ['court_footprints', 'businesses', 'training', 'merchants', 'charging', 'commerce_hotels', 'commerce_food', 'emergency_shelters'], activeLayers: ['court_footprints'],
  },
  industry: {
    label: '产业全景', left: '产业链目录', right: '产业链介绍与分析', department: '京山市文旅局', report: '产业推介图册',
    layers: ['court_footprints', 'service', 'businesses', 'training', 'projects', 'merchants', 'commerce_hotels', 'commerce_food', ...panoramaRegisterLayers, 'townBoundaries'],
    activeLayers: ['businesses', 'merchants', 'commerce_hotels', 'commerce_food', ...panoramaRegisterLayers, 'townBoundaries'],
  },
  venues: {
    label: '服务能力', left: '服务覆盖测算', right: '需要补足的区域', department: '教育局', report: '服务覆盖缺口清单',
    layers: ['court_footprints', 'venues', 'capacityGaps', 'service', 'population', 'hotels', 'food', 'parking', 'medical', 'training', 'charging', 'commerce_hotels', 'commerce_food', 'emergency_shelters', 'coaches', 'sparring_partners', 'additional', 'schools', 'transport', 'transit'],
    activeLayers: ['court_footprints', 'capacityGaps'],
  },
  site: {
    label: '智能选址', left: '新建选址', right: '地块初筛', department: '自然资源和规划局', report: '选址建议',
    layers: ['investment_reserve_parcels','court_footprints'],
    activeLayers: ['investment_reserve_parcels'],
  },
  investment: {
    label: '智能招商', left: '配套分析', right: '招商需求清单', department: '商务局', report: '招商推介书',
    layers: ['investment_reserve_parcels', 'court_footprints', 'projects'],
    activeLayers: ['investment_reserve_parcels'],
  },
  events: {
    label: '赛前研判', left: '赛事信息', right: '研判结论', department: '公安交警', report: '赛事保障方案', urban: true,
    layers: ['roadNetwork', 'trafficPlan', 'court_footprints', 'medicalPlan', 'hotelPlan', 'parking', 'charging', 'commerce_hotels', 'commerce_food', 'emergency_shelters', 'food', 'security'],
    activeLayers: ['roadNetwork', 'court_footprints', 'trafficPlan', 'parking', 'eventAnchor'],
  },
  liveEvent: {
    label: '赛中协同', left: '赛事进行中', right: '部门任务看板', department: '京山市文旅局', report: '当日保障日报', urban: true,
    layers: ['roadNetwork', 'trafficPlan', 'court_footprints', 'medicalPlan', 'hotelPlan', 'parking', 'charging', 'commerce_hotels', 'commerce_food', 'emergency_shelters', 'security'],
    activeLayers: ['roadNetwork', 'court_footprints', 'trafficPlan', 'medicalPlan', 'parking', 'eventAnchor'],
  },
  tourism: {
    label: '赛后复盘', left: '赛事效益', right: '流量去向', department: '京山市文旅局', report: '赛事效益报告',
    layers: ['roadNetwork', 'origins', 'routes', 'consumeHeat', 'tourism'],
    activeLayers: ['origins', 'routes', 'consumeHeat', 'tourism', 'events'],
  },
  consumption: {
    label: '赛事转化与线路推介', left: '来京山客流', right: '网球文旅联动', department: '京山市文旅局', report: '网球旅游融合分析',
    layers: ['promotion', 'townBoundaries', 'tourism', 'merchants', 'consumeHeat'],
    activeLayers: ['promotion', 'townBoundaries'],
  },
  merchants: {
    label: '商家和线路', left: '合作商家', right: '线路和优惠', department: '京山市文旅局', report: '商家和线路月报',
    layers: ['hotelPartners', 'foodPartners', 'scenicPartners', 'shoppingPartners', 'redeemHeat', 'court_footprints'],
    activeLayers: ['hotelPartners', 'foodPartners', 'scenicPartners', 'shoppingPartners', 'redeemHeat', 'court_footprints'],
  },
}

export const groups = [
  { id: 'overview', label: '一图总览', pages: ['overview'] },
  { id: 'industry', label: '产业推介', pages: ['industry', 'venues', 'site', 'investment'] },
  { id: 'events', label: '赛事引流', pages: ['events', 'liveEvent', 'tourism'] },
  { id: 'fusion', label: '融合发展', pages: ['consumption', 'merchants'] },
] as const satisfies readonly { id: string; label: string; pages: readonly V3Page[] }[]

export function pageFromLocation(value: string | null): V3Page {
  return value && Object.hasOwn(pages, value) ? value as V3Page : 'overview'
}
