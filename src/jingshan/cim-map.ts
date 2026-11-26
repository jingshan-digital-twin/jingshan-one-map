import {
  BoundingSphere, Cartesian3, Cartographic, Cesium3DTileColorBlendMode, Cesium3DTileFeature, Cesium3DTileStyle, Cesium3DTileset,
  Color, ConstantPositionProperty, Entity, GeoJsonDataSource,
  GeographicTilingScheme, PointGraphics, Rectangle, UrlTemplateImageryProvider, WebMapServiceImageryProvider, type ImageryLayer, type TileProviderError, type Viewer,
} from 'cesium'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import type { CimService } from './cim-types.ts'
import { isCimBasemap, isRasterService } from './cim-types.ts'
import { cimMapImageUrl, type MapBounds } from './cim-map-image-url.ts'
export { cimMapImageUrl, type MapBounds } from './cim-map-image-url.ts'

export type CimMapStatus = { id: string; state: 'loading' | 'ready' | 'error' | 'off'; message?: string; hasTileContent?: boolean }
import { identifiedServiceFeatures } from './map-service-attributes.ts'

export type CimPick = { featureId?:string; serviceId: string; serviceName: string; name: string; properties: Record<string, string> }
export type CimFocusTarget = { sphere: BoundingSphere; model: boolean }

function lightLocalModel(tiles: Cesium3DTileset) {
  // Keep roofs and facades legible in the cockpit even after sunset.
  const sky = Array.from({ length: 9 }, () => new Cartesian3())
  sky[0] = new Cartesian3(1.15, 1.15, 1.15)
  sky[2] = new Cartesian3(.22, .22, .22)
  tiles.imageBasedLighting.sphericalHarmonicCoefficients = sky
  tiles.lightColor = new Cartesian3(.55, .55, .55)
}

export function focusTargetFromBounds(bounds?: MapBounds): CimFocusTarget | undefined {
  if (!bounds || !bounds.every(Number.isFinite)) return
  const [west, south, east, north] = bounds
  if (Math.abs(west) > 180 || Math.abs(east) > 180 || south < -90 || north > 90 || south > north) return
  return { sphere: BoundingSphere.fromRectangle3D(Rectangle.fromDegrees(...bounds)), model: false }
}

export function focusTargetFromFeatures(features: readonly Feature<Geometry | null>[]): CimFocusTarget | undefined {
  const positions: Cartesian3[] = []
  function addPosition([longitude, latitude, height = 0]: Position) {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !Number.isFinite(height)
        || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return
    positions.push(Cartesian3.fromDegrees(longitude, latitude, height))
  }
  function addGeometry(geometry: Geometry | null) {
    if (!geometry) return
    switch (geometry.type) {
      case 'Point': addPosition(geometry.coordinates); break
      case 'LineString':
      case 'MultiPoint': geometry.coordinates.forEach(addPosition); break
      case 'MultiLineString':
      case 'Polygon': geometry.coordinates.forEach(line => line.forEach(addPosition)); break
      case 'MultiPolygon':
        for (const polygon of geometry.coordinates) for (const ring of polygon) ring.forEach(addPosition)
        break
      case 'GeometryCollection': geometry.geometries.forEach(addGeometry); break
    }
  }
  for (const feature of features) addGeometry(feature.geometry)
  if (!positions.length) return
  const sphere = BoundingSphere.fromPoints(positions)
  if (validSphere(sphere)) return { sphere, model: false }
}

function validSphere({ center, radius }: BoundingSphere) {
  return Number.isFinite(center.x) && Number.isFinite(center.y) && Number.isFinite(center.z)
    && Number.isFinite(radius) && radius >= 0
}

type Entry = {
  service: CimService
  signature: string
  controller: AbortController
  loaded: Promise<void>
  image?: ImageryLayer
  vector?: GeoJsonDataSource
  tiles?: Cesium3DTileset
  points?: Map<Entity, Cartographic>
  features?: Feature[]
  vectorTarget?: CimFocusTarget
  imageryBounds?: MapBounds
  lastState?: CimMapStatus['state']
  lastMessage?: string
  hasTileContent?: boolean
}

// Test an actual map image before registering a tiled layer. A failed intranet
// connection then costs one request instead of a whole screen of failed tiles.
async function checkMapImage(service: CimService, signal: AbortSignal) {
  const url = cimMapImageUrl(service, [113.07,31.04,113.14,31.12], 64, 64)
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`地图图像请求失败（HTTP ${response.status}）`)
  const image = await response.blob()
  const bitmap = await createImageBitmap(image).catch(() => { throw new Error('服务未返回可读取的地图图像') })
  bitmap.close()
}

function pickDetails(service: CimService, values: Record<string, unknown>, fallback?: string): CimPick {
  const properties: Record<string, string> = Object.create(null)
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue
    properties[key] = typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
  const available = Object.keys(properties).filter(key => properties[key].trim())
  const names = ['gcmc', 'gymc', 'sqjcwhmc', 'bjmc', '学校名称', '机构名称', '景区名称', '名称', 'name', 'mingcheng', 'mc']
  const nameKey = names.map(name => available.find(key => key.toLowerCase() === name)).find(Boolean)
    ?? available.find(key => /名称$/.test(key))
  return { serviceId: service.id, serviceName: service.name, name: (nameKey && properties[nameKey]) || fallback || service.name, properties }
}

export function createCimMap(viewer: Viewer, report: (status: CimMapStatus) => void,
  onLayersChanged: (groundOverlay: boolean, countyOutline: boolean, townOutlines: boolean, basemap?: CimService) => void,
  allowReliefAboveModel?: (service: CimService) => boolean, hasReliefImage?: (service:CimService)=>boolean) {
  const entries = new Map<string, Entry>()
  let ordered: CimService[] = []
  let surfaceHeight = 0

  function positionPoints(entry: Entry) {
    for (const [entity, point] of entry.points ?? []) {
      entity.position = new ConstantPositionProperty(Cartesian3.fromRadians(point.longitude, point.latitude,
        point.height + surfaceHeight))
    }
  }

  function setSurfaceHeight(height: number) {
    if (height === surfaceHeight) return
    surfaceHeight = height
    for (const entry of entries.values()) positionPoints(entry)
    // In the raised overview the same image is already drawn on the roof.
    // Resume ground tiles when the camera returns to the surface.
    const basemap = [...entries.values()].find(entry => isCimBasemap(entry.service))
    if (basemap?.image && basemap.service.kind === 'wms') basemap.image.show = height === 0 && basemap.lastState !== 'error'
  }

  function active(entry: Entry) {
    return entries.get(entry.service.id) === entry && !viewer.isDestroyed()
  }

  function status(entry: Entry, state: CimMapStatus['state'], message?: string, hasTileContent = entry.hasTileContent) {
    if (!active(entry) || (entry.lastState === state && entry.lastMessage === message && entry.hasTileContent === hasTileContent)) return
    entry.lastState = state
    entry.lastMessage = message
    entry.hasTileContent = hasTileContent
    report({ id: entry.service.id, state, message, hasTileContent })
  }

  function reorder() {
    if (viewer.isDestroyed()) return
    for (const service of ordered) {
      const layer = entries.get(service.id)?.image
      if (layer) viewer.imageryLayers.raiseToTop(layer)
    }
    const loaded = [...entries.values()]
    const wmsNames = new Set(loaded.filter(entry => entry.image && entry.service.kind === 'wms')
      .flatMap(entry => entry.service.layer.toLowerCase().split(',').map(layer => layer.trim().split(':').pop())))
    const basemap = loaded.find(entry => entry.image && isCimBasemap(entry.service) && entry.lastState !== 'error')
    const groundOverlay = loaded.some(entry => !isCimBasemap(entry.service) &&
      ((entry.image && !hasReliefImage?.(entry.service)) || (entry.tiles && !allowReliefAboveModel?.(entry.service))))
    onLayersChanged(groundOverlay,
      wmsNames.has('jss_skjc_xzq_qxj'), wmsNames.has('jss_skjc_xzq_xzj'), basemap?.service)
    viewer.scene.requestRender()
  }

  function remove(entry: Entry) {
    entries.delete(entry.service.id)
    entry.controller.abort()
    if (viewer.isDestroyed()) return
    if (entry.image) viewer.imageryLayers.remove(entry.image, true)
    if (entry.vector) viewer.dataSources.remove(entry.vector, true)
    if (entry.tiles) viewer.scene.primitives.remove(entry.tiles)
  }

  async function load(entry: Entry) {
    const service = entry.service
    const signal = entry.controller.signal
    status(entry, 'loading', '正在加载图层')
    try {
      if (service.kind === 'wms' || isRasterService(service.kind)) {
        if (service.kind === 'wms') await checkMapImage(service, signal)
        if (!active(entry)) return
        const bounds = entry.imageryBounds ?? service.bounds
        const rectangle = bounds && Rectangle.fromDegrees(...bounds)
        const provider = service.kind === 'wms' ? new WebMapServiceImageryProvider({
          url: service.mapUrl, layers: service.layer, crs: service.wmsCrs ?? 'EPSG:4326', srs: service.wmsCrs ?? 'EPSG:4326',
          rectangle,
          parameters: { version: service.version, format: 'image/png', transparent: true },
          enablePickFeatures: false,
        }) : new UrlTemplateImageryProvider({
          url: service.mapUrl + (service.mapUrl.includes('?')?'&':'?') + 'revision=' + service.revision,
          rectangle,
          tilingScheme: service.raster?.projection === 'EPSG:4326' ? new GeographicTilingScheme() : undefined,
          maximumLevel: service.raster?.maxLevel, enablePickFeatures: false,
        })
        let receivedTile = false
        let consecutiveFailures = 0
        const base = isCimBasemap(service)
        if (base || provider instanceof UrlTemplateImageryProvider) {
          const requestImage = provider.requestImage.bind(provider)
          provider.requestImage = (...coordinates) => {
            const image = requestImage(...coordinates)
            if (!image) return image
            return image.then(tile => {
              if (tile && active(entry) && entry.lastState !== 'error') {
                receivedTile = true
                consecutiveFailures = 0
                if (entry.lastState === 'loading') status(entry, 'ready', '已接收地图瓦片')
              }
              return tile
            })
          }
        }
        provider.errorEvent.addEventListener((error: TileProviderError) => {
          if (!active(entry)) return
          if (error.timesRetried === 0) { error.retry = true; return }
          // An isolated edge tile can fail while neighbouring Jingmen tiles are healthy.
          if (base && receivedTile && ++consecutiveFailures < 3) return
          if (base && entry.image) entry.image.show = false
          status(entry, 'error', '部分地图瓦片未能加载，可重新打开图层重试')
          reorder()
        })
        entry.image = viewer.imageryLayers.addImageryProvider(provider)
        if (isCimBasemap(service) && service.kind === 'wms') entry.image.show = surfaceHeight === 0
        if (service.kind === 'wms') status(entry, 'ready', '已接收地图图像')
      } else if (service.kind === '3dtiles') {
        const tiles = await Cesium3DTileset.fromUrl(service.mapUrl)
        if (!active(entry)) { tiles.destroy(); return }
        const localModel = /^\/api\/jingshan\/cim\/local-tiles\/(central-white|tennis-(?:southwest|northeast|center))\/tileset\.json$/.exec(service.mapUrl)
        if (localModel) {
          lightLocalModel(tiles)
          if (localModel[1] === 'central-white') {
            tiles.style = new Cesium3DTileStyle({color: 'color("#edf4ff")'})
            tiles.colorBlendMode = Cesium3DTileColorBlendMode.REPLACE
          }
        }
        entry.tiles = tiles
        tiles.tileFailed.addEventListener(() => status(entry, 'error', '部分模型瓦片未能加载，可重新打开图层重试'))
        tiles.tileLoad.addEventListener(() => {
          if (entry.hasTileContent) return
          if (entry.lastState === 'error') status(entry, 'error', entry.lastMessage, true)
          else status(entry, 'ready', '已加载模型瓦片', true)
        })
        viewer.scene.primitives.add(tiles)
        status(entry, 'ready', '已加载模型索引')
      } else {
        const response = await fetch(service.mapUrl, { signal })
        if (!response.ok) throw new Error(`要素请求失败（HTTP ${response.status}）`)
        const data=identifiedServiceFeatures(await response.json() as FeatureCollection)
        if (!active(entry)) return
        const source = await GeoJsonDataSource.load(data, {
          stroke: Color.fromCssColorString('#1979bc'), fill: Color.fromCssColorString('#4dccff').withAlpha(.35),
          strokeWidth: 2, clampToGround: true,
        })
        if (!active(entry)) return
        source.name = service.name
        entry.points = new Map()
        for (const entity of source.entities.values) {
          if (!entity.billboard) continue
          const position = entity.position?.getValue(viewer.clock.currentTime)
          if (position) entry.points.set(entity, Cartographic.fromCartesian(position))
          entity.billboard = undefined
          entity.point = new PointGraphics({ color: Color.fromCssColorString('#00859e'), pixelSize: 10,
            outlineColor: Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Infinity })
        }
        if (surfaceHeight) positionPoints(entry)
        await viewer.dataSources.add(source)
        if (!active(entry)) {
          if (!viewer.isDestroyed()) viewer.dataSources.remove(source, true)
          return
        }
        entry.vector = source
        entry.features = data.features
        status(entry, 'ready', `已获取 ${data.features.length} 个要素`)
      }
      reorder()
    } catch (error) {
      if (!active(entry)) return
      const reason = error instanceof Error && !(error instanceof TypeError) && service.kind !== '3dtiles'
        ? error.message : '请检查服务连通性后重新打开图层'
      status(entry, 'error', reason)
    }
  }

  function setLayers(services: readonly CimService[], countyBounds?: MapBounds) {
    ordered = services.filter(service => service.enabled && (!isCimBasemap(service) || countyBounds))
      .sort((a, b) => Number(isCimBasemap(b)) - Number(isCimBasemap(a)) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    const wanted = new Set(ordered.map(service => service.id))
    for (const [id, entry] of entries) {
      if (wanted.has(id)) continue
      remove(entry)
      report({ id, state: 'off' })
    }
    for (const service of ordered) {
      const imageryBounds = isCimBasemap(service) ? countyBounds : undefined
      const signature = JSON.stringify([service.name, service.mapUrl, service.kind, service.layer, service.version,
        service.revision, service.raster, service.wmsCrs, service.bounds, imageryBounds])
      const previous = entries.get(service.id)
      if (previous?.signature === signature) continue
      if (previous) remove(previous)
      const controller = new AbortController()
      let finishLoad!: () => void
      const loaded = new Promise<void>(resolve => { finishLoad = resolve })
      controller.signal.addEventListener('abort', finishLoad, { once: true })
      const entry: Entry = { service, signature, controller, loaded, imageryBounds }
      entries.set(service.id, entry)
      void load(entry).finally(finishLoad)
    }
    reorder()
  }

  async function getFocusTarget(id: string): Promise<CimFocusTarget | undefined> {
    const entry = entries.get(id)
    if (!entry || !active(entry)) return
    await entry.loaded
    if (!active(entry) || entry.lastState === 'error') return
    if (entry.tiles) {
      const sphere = entry.tiles.boundingSphere
      if (validSphere(sphere)) return { sphere, model: true }
    }
    if (entry.image) return focusTargetFromBounds(entry.imageryBounds ?? entry.service.bounds)
    if (entry.features) {
      entry.vectorTarget = focusTargetFromFeatures(entry.features)
      entry.features = undefined
    }
    return entry.vectorTarget
  }

  function pick(hit: { id?: unknown; primitive?: unknown } | Cesium3DTileFeature): CimPick | undefined {
    for (const entry of entries.values()) {
      if (hit instanceof Cesium3DTileFeature) {
        if (hit.tileset !== entry.tiles) continue
        const properties = Object.fromEntries(hit.getPropertyIds().map(key => [key, hit.getProperty(key)]))
        return pickDetails(entry.service, properties)
      }
      if (entry.vector && hit.id instanceof Entity && entry.vector.entities.contains(hit.id)) {
        return {...pickDetails(entry.service, hit.id.properties?.getValue(viewer.clock.currentTime) ?? {}, hit.id.name),featureId:hit.id.id}
      }
      if (entry.tiles && hit.primitive === entry.tiles) return pickDetails(entry.service, {})
    }
  }

  function renderedLayer(id:string) {
    const entry=entries.get(id)
    if (entry) return {image:entry.image,vector:entry.vector,tiles:entry.tiles}
  }
  return { setLayers, setSurfaceHeight, reorder, getFocusTarget, pick, renderedLayer, destroy() { for (const entry of entries.values()) remove(entry) } }
}
