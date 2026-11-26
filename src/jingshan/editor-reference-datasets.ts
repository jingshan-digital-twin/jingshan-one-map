import { toRaw } from 'vue'
import type { Geometry } from 'geojson'
import Feature from 'ol/Feature.js'
import { asArray } from 'ol/color.js'
import GeoJSON from 'ol/format/GeoJSON.js'
import type BaseLayer from 'ol/layer/Base.js'
import ImageLayer from 'ol/layer/Image.js'
import VectorLayer from 'ol/layer/Vector.js'
import ImageSource from 'ol/source/Image.js'
import VectorSource from 'ol/source/Vector.js'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style.js'
import { isPlatformFormDataset } from './platform-forms.ts'
import { legacyPopulationGridId } from './population-grid.ts'
import { populationDisplayGrid } from './population-display-grid.ts'
import { populationRaster } from './population-raster.ts'
import { rasterSurface } from './population-raster-surface.ts'
import { populationSurface } from './population-surface.ts'
import type { Dataset } from './types.ts'

function hasPosition(coordinates: unknown): boolean {
  if (!Array.isArray(coordinates)) return false
  if (typeof coordinates[0] === 'number') {
    return Number.isFinite(coordinates[0]) && Number.isFinite(coordinates[1])
  }
  return coordinates.some(hasPosition)
}

function isLocated(geometry: Geometry | null): boolean {
  if (!geometry) return false
  if (geometry.type === 'GeometryCollection') return geometry.geometries.some(isLocated)
  return hasPosition(geometry.coordinates)
}

export function canReferenceDataset(dataset: Dataset): boolean {
  return !isPlatformFormDataset(dataset) && dataset.features.some(feature => isLocated(feature.geometry))
}

function populationImage(canvas: HTMLCanvasElement, extent: number[]) {
  // The population renderer paints in longitude/latitude. Supply both native resolutions
  // so OpenLayers can reproject its rectangular pixels onto the editing map.
  const resolution = [(extent[2] - extent[0]) / canvas.width, (extent[3] - extent[1]) / canvas.height]
  return new ImageLayer({ source: new ImageSource({
    projection: 'EPSG:4326',
    interpolate: false,
    loader: () => ({ image: canvas, extent, resolution, pixelRatio: 1 }),
  }) })
}

export async function createDatasetReference(dataset: Dataset, color: string, signal: AbortSignal): Promise<BaseLayer> {
  signal.throwIfAborted()
  const data = toRaw(dataset)
  if (!canReferenceDataset(data)) throw new Error('该数据集没有可叠加的空间要素。')
  const grid = populationRaster(data)
  if (grid || data.id === legacyPopulationGridId) {
    const surface = grid
      ? await rasterSurface(populationDisplayGrid({ grid, bit: 1 }), signal)
      : await populationSurface(data.features, undefined, signal)
    signal.throwIfAborted()
    if (!surface) throw new Error('当前人口图层没有可显示的网格。')
    return populationImage(surface.canvas, surface.bounds)
  }

  const format = new GeoJSON()
  const projection = { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }
  const features: Feature[] = []
  let deadline = performance.now() + 10
  for (const row of data.features) {
    if (performance.now() >= deadline) {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      signal.throwIfAborted()
      deadline = performance.now() + 10
    }
    if (!isLocated(row.geometry)) continue
    const feature = new Feature(format.readGeometry(row.geometry, projection))
    feature.setId(row.id)
    features.push(feature)
  }
  const fill = asArray(color).slice()
  fill[3] = .18
  return new VectorLayer({
    source: new VectorSource({ features, wrapX: false }),
    style: new Style({
      stroke: new Stroke({ color, width: 2 }),
      fill: new Fill({ color: fill }),
      image: new CircleStyle({
        radius: 5, fill: new Fill({ color }), stroke: new Stroke({ color: 'white', width: 1.5 }),
      }),
    }),
  })
}
