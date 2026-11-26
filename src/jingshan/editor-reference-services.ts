import type BaseLayer from 'ol/layer/Base.js'
import TileLayer from 'ol/layer/Tile.js'
import ImageTileSource from 'ol/source/ImageTile.js'
import { createXYZ } from 'ol/tilegrid.js'
import { transformExtent } from 'ol/proj.js'
import { renderXYZTemplate } from 'ol/uri.js'
import { api } from './api.ts'
import { cimMapImageUrl, type MapBounds } from './cim-map-image-url.ts'
import { defaultRasterConfig, isFeatureService, isRasterService, type CimService } from './cim-types.ts'
import { createDatasetReference } from './editor-reference-datasets.ts'
import { readServiceAttributes } from './map-service-attributes.ts'
import { residentGridId } from './population-raster.ts'
import type { Dataset } from './types.ts'

export function canReferenceService(service: CimService) {
  return service.enabled && !!service.mapUrl &&
    (isFeatureService(service.kind) || isRasterService(service.kind) || service.kind === 'wms')
}

export async function createServiceReferenceLayer(
  service: CimService, color: string, signal: AbortSignal, onTileError?: (message: string) => void,
): Promise<BaseLayer> {
  signal.throwIfAborted()
  if (!canReferenceService(service)) throw new Error('请选择已启用的二维地图服务。')
  if (isFeatureService(service.kind)) {
    // The public GeoJSON endpoint expands this raster into hundreds of thousands of cells.
    const dataset = service.hostedDatasetId === residentGridId
      ? (await api<{ dataset: Dataset }>('/layers/'+residentGridId+'/population-blocks', { signal })).dataset
      : await readServiceAttributes(service, signal)
    return createDatasetReference(dataset, color, signal)
  }

  const wms = service.kind === 'wms'
  const config = service.raster ?? defaultRasterConfig
  const projection = wms ? 'EPSG:4326' : config.projection
  // Geographic tiles at level zero use two columns and one row in the platform proxy.
  const tileGrid = createXYZ({
    extent: projection === 'EPSG:4326' ? [-180, -90, 180, 90] : undefined,
    maxResolution: projection === 'EPSG:4326' ? 180 / 256 : undefined,
    maxZoom: wms ? 24 : config.maxLevel,
  })
  const template = service.mapUrl + (service.mapUrl.includes('?') ? '&' : '?') + 'revision=' + service.revision
  let notified = false
  const source = new ImageTileSource({
    projection, tileGrid, wrapX: false,
    async loader(z, x, y, options) {
      const tileSignal = AbortSignal.any([options.signal, signal])
      const url = wms ? cimMapImageUrl(service, tileGrid.getTileCoordExtent([z,x,y]) as MapBounds, 256, 256)
        : renderXYZTemplate(template, z, x, y, options.maxY)
      try {
        const response = await fetch(url, { signal: tileSignal })
        if (!response.ok) throw new Error('HTTP ' + response.status)
        const image = await createImageBitmap(await response.blob())
        if (tileSignal.aborted) { image.close(); tileSignal.throwIfAborted() }
        return image
      } catch (error) {
        if (!tileSignal.aborted && !notified) {
          notified = true
          onTileError?.('地图瓦片读取失败，请检查服务连接后重试。')
        }
        throw error
      }
    },
  })
  return new TileLayer({
    source,
    extent: service.bounds ? transformExtent(service.bounds, 'EPSG:4326', 'EPSG:3857') : undefined,
  })
}
