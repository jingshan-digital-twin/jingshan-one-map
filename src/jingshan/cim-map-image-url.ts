import type { CimService } from './cim-types.ts'

export type MapBounds = [number, number, number, number]

export function cimMapImageUrl(service: CimService, [west,south,east,north]: MapBounds, width: number, height: number) {
  const url = new URL(service.mapUrl, location.href)
  const modern = Number.parseFloat(service.version) >= 1.3
  const params = new URLSearchParams({
    service: 'WMS', request: 'GetMap', version: service.version, layers: service.layer,
    styles: '', format: 'image/png', transparent: 'true', width: String(width), height: String(height),
    bbox: (modern ? [south,west,north,east] : [west,south,east,north]).join(','),
  })
  params.set(modern ? 'crs' : 'srs', service.wmsCrs ?? 'EPSG:4326')
  for (const [key, value] of params) url.searchParams.set(key, value)
  return url
}
