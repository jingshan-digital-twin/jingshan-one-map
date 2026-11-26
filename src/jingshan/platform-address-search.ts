import { formId } from './form-designer-id.ts'
import LineString from 'ol/geom/LineString.js'
import { districtCenter } from './facility-boundaries.ts'
import { isPlatformFormDataset } from './platform-forms.ts'
import { withLocalDataset } from './platform-local-data.ts'
import type { CityFeature, Coordinate, DataDocument, Dataset } from './types.ts'

export const addressLayerId = 'map_address_marks'
export const addressLayerName = '地址标注'

export type MapAddress = {
  name: string
  address: string
  region: string
  position: Coordinate
  source: string
  sourceKey?: string
}

type IndexedAddress = { place: MapAddress; name: string; address: string; text: string; layerId: string }

// Statistical cells, schedules and trips represent activity, not individual places.
const nonPlaceLayers = new Set(['population', 'jingshan_population_100m', 'worldpop_population_2025', 'learners', 'origins', 'events',
  'offers', 'operations_monthly', 'event_live', 'investment_hotspots', 'constraints'])

function normalize(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(/[\s·—,，-]+/gu, '')
}
const cityPrefix = /^(?:湖北省\s*)?(?:荆门市\s*)?京山市\s*/u

function field(...values: unknown[]) {
  return values.find((value): value is string => typeof value === 'string' && !!value.trim())?.trim() ?? ''
}

function validPosition(position: Coordinate) {
  return position.every(Number.isFinite) && Math.abs(position[0]) <= 180 && Math.abs(position[1]) <= 90
}

function addressPosition(feature: CityFeature): Coordinate | undefined {
  const g = feature.geometry
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') return districtCenter(feature)
  if (g.type === 'GeometryCollection') return
  if (g.type === 'Point' || g.type === 'MultiPoint') {
    const p = g.type === 'Point' ? g.coordinates : g.coordinates[0]
    return p && [p[0], p[1]]
  }
  // Keep the pin on the road, including when its paths are disjoint.
  const paths = g.type === 'LineString' ? [g.coordinates] : g.coordinates
  let longest: LineString | undefined
  for (const path of paths) {
    if (path.length < 2) continue
    const line = new LineString(path)
    if (!longest || line.getLength() > longest.getLength()) longest = line
  }
  const p = longest?.getCoordinateAt(.5)
  return p && [p[0], p[1]]
}

export function coordinateAddress(query: string): MapAddress | undefined {
  const text = query.trim().normalize('NFKC')
  const match = /^([+-]?\d+(?:\.\d+)?)\s*(?:,|\s)\s*([+-]?\d+(?:\.\d+)?)$/.exec(text)
  if (!match) return
  const position: Coordinate = [Number(match[1]), Number(match[2])]
  if (!validPosition(position)) return
  return { name: position.join(', '), position, address: '', region: '', source: 'WGS84 经纬度' }
}

export function indexMapAddresses(datasets: Dataset[]): IndexedAddress[] {
  const entries: IndexedAddress[] = []
  for (const layer of datasets) {
    if (isPlatformFormDataset(layer) || nonPlaceLayers.has(layer.id)) continue
    for (const feature of layer.features) {
      const position = addressPosition(feature)
      if (!position || !validPosition(position)) continue
      const p = feature.properties
      const name = field(p.name, p['名称'])
      if (!name) continue
      const sourceFields = p.sourceAttributes && typeof p.sourceAttributes === 'object'
        ? p.sourceAttributes as Record<string,unknown> : {}
      const address = field(p.address, p['地址'], p['详细地址'], p['场馆地址'], p['所在地址'], p['坐落'],
        sourceFields['地址'], sourceFields['详细地址'], sourceFields['坐落'], sourceFields.zl)
      const region = field(p.region, p['镇街或片区'], p['所属镇街'], sourceFields.xzjxzqhmc)
      const community = field(p['社区'], p['所属村社区'], p.surveyUnit, sourceFields.sqjcwhmc)
      const sourceKey = layer.id === addressLayerId ? field(p.sourceKey) : layer.id + ':' + feature.id
      const precision = feature.geometry.type === 'Point' ? field(p.locationSource)
        : feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon' ? '范围中心' : '要素位置'
      const source = layer.id === addressLayerId ? field(p.locationSource, layer.name)
        : [layer.name, precision].filter(Boolean).join(' · ')
      const text = [region + name, address, region + normalize(address).replace(cityPrefix, ''),
        p['所属场馆'], p.facilityName, p.locationLabel, community, region + community + name, p['镇街或片区']].map(v => normalize(field(v))).join('|')
      entries.push({ place: { name, address, region, position, source, sourceKey }, name: normalize(name),
        address: normalize(address), text, layerId: layer.id })
    }
  }
  return entries
}

function locationKey(name: string, position: number[]) {
  return [normalize(name), position[0].toFixed(5), position[1].toFixed(5)].join('|')
}

export function findMapAddresses(index: IndexedAddress[], query: string, activeLayer?: string, limit = 8): MapAddress[] {
  const text = query.trim().normalize('NFKC')
  const words = (text.replace(cityPrefix, '') || text).split(/\s+/u).map(normalize).filter(Boolean)
  if (!words.length) return []
  const coordinate = coordinateAddress(query)
  if (coordinate) return [coordinate]
  const term = words.join('')
  const matches = index.filter(row => words.every(word => row.text.includes(word))).map(row => {
    const exact = row.name === term || row.address === term
    const rank = exact ? 0 : row.name.startsWith(term) ? 1 : row.address.includes(term) || row.name.includes(term) ? 2 : 3
    return { row, rank }
  }).sort((a, b) => a.rank - b.rank || Number(b.row.layerId === activeLayer) - Number(a.row.layerId === activeLayer)
    || Number(b.row.layerId === addressLayerId) - Number(a.row.layerId === addressLayerId))
  const seen = new Set<string>(), found: MapAddress[] = []
  for (const { row } of matches) {
    const key = locationKey(row.place.name, row.place.position)
    if (seen.has(key)) continue
    seen.add(key)
    found.push(row.place)
    if (found.length >= limit) break
  }
  return found
}

export function hasAddressMark(layer: Dataset | undefined, place: MapAddress) {
  const key = locationKey(place.name, place.position)
  return !!layer?.features.some(({ geometry, properties }) => geometry.type === 'Point' && (
    (place.sourceKey && properties.sourceKey === place.sourceKey)
    || locationKey(properties.name, geometry.coordinates) === key))
}

export function addAddressMark(draft: DataDocument, place: MapAddress): DataDocument {
  const layer = draft.datasets.find(d => d.id === addressLayerId) ?? {
    id: addressLayerId, name: addressLayerName, category: '地名地址', department: '本地数据',
    description: '地图预览中按地址搜索、经纬度或地图选点添加的位置。', features: [],
  }
  if (hasAddressMark(layer, place)) return draft
  return withLocalDataset(draft, { ...layer, features: [...layer.features, {
    type: 'Feature', id: 'address-mark-' + formId(), geometry: { type: 'Point', coordinates: [...place.position] },
    properties: { kind: 'address-mark', name: place.name, region: place.region || '待核实',
      address: place.address, locationSource: place.source, ...(place.sourceKey ? { sourceKey: place.sourceKey } : {}) },
  }] })
}
