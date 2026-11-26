export const cimProtocols = { wms: 'WMS', wfs: 'WFS', geojson: 'GeoJSON', arcgis: 'ArcGIS FeatureServer', xyz: 'XYZ 瓦片', wmts: 'WMTS', '3dtiles': '3D Tiles' } as const
export type CimKind = keyof typeof cimProtocols
export type CimStatus = 'unchecked' | 'online' | 'offline' | 'auth' | 'invalid'

export interface CimRasterConfig {
  projection: 'EPSG:3857' | 'EPSG:4326'
  maxLevel: number
  matrixSet: string
  matrixPrefix: string
  matrixOffset: number
  style: string
  format: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/jpgpng'
}

export const defaultRasterConfig: Readonly<CimRasterConfig> = {
  projection: 'EPSG:3857', maxLevel: 19, matrixSet: 'EPSG:3857', matrixPrefix: '',
  matrixOffset: 0, style: 'default', format: 'image/png',
}

export const isRasterService = (kind: CimKind) => kind === 'xyz' || kind === 'wmts'
export const isFeatureService = (kind: CimKind | undefined) => kind === 'wfs' || kind === 'geojson' || kind === 'arcgis'

export interface CimService {
  id: string
  name: string
  category: string
  kind: CimKind
  layer: string
  version: string
  enabled: boolean
  defaultVisible: boolean
  mapRole?: 'basemap'
  sortOrder: number
  description: string
  status: CimStatus
  statusMessage: string
  checkedAt: string | null
  sourceRow: number | null
  revision: number
  mapUrl: string
  reliefUrl?:string
  wmsCrs?: 'EPSG:4326' | 'EPSG:4490'
  raster?: CimRasterConfig | null
  bounds?: [number, number, number, number]
  hostedDatasetId?: string
  supportsRecords?: boolean
}

export interface CimAdminService extends CimService {
  url: string
  sourceSheet: string | null
}

export function isCimBasemap(service: Pick<CimService,'id'|'kind'|'category'|'mapRole'>) {
  return (service.kind === 'wms' || isRasterService(service.kind)) &&
    (service.mapRole === 'basemap' || service.category === '基础影像' || service.id === 'cim-01' || service.id === 'jingmen-2026-05m')
}

export interface GatewayStatus {
  resource: string
  resourceId: string
  status: CimStatus
  statusMessage: string
  checkedAt: string | null
}
