import type { CimAdminService, CimKind, CimRasterConfig } from '../src/jingshan/cim-types.ts'
import { defaultRasterConfig } from '../src/jingshan/cim-types.ts'
import { CimError } from './cim-error.ts'

export function rasterConfig(kind: CimKind, raw: unknown, url: string): CimRasterConfig | null {
  if (kind !== 'xyz' && kind !== 'wmts') return null
  if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) throw new CimError('瓦片参数格式无效。', 400)
  const config = { ...defaultRasterConfig, ...raw as Partial<CimRasterConfig> }
  if (!['EPSG:3857','EPSG:4326'].includes(config.projection)) throw new CimError('请选择瓦片坐标系。', 400)
  if (!Number.isInteger(config.maxLevel) || config.maxLevel < 0 || config.maxLevel > 24) throw new CimError('最大瓦片级别须为 0 到 24 的整数。', 400)
  if (kind === 'xyz') {
    const fields: string[] = url.match(/\{[^{}]*\}/g) ?? []
    if (!fields.includes('{x}') || !fields.includes('{z}') || !(fields.includes('{y}') || fields.includes('{-y}')) ||
        fields.some(field => !['{z}','{x}','{y}','{-y}'].includes(field)) || /[{}]/.test(new URL(url).host)) {
      throw new CimError('XYZ 地址须在路径或查询参数中包含 {z}、{x} 和 {y}（TMS 可用 {-y}）。', 400)
    }
    return { ...defaultRasterConfig, maxLevel: config.maxLevel, projection: config.projection }
  }
  if (!Number.isInteger(config.matrixOffset) || Math.abs(config.matrixOffset) > 24) throw new CimError('矩阵级别偏移须为 -24 到 24 的整数。', 400)
  for (const value of [config.matrixSet, config.matrixPrefix, config.style]) {
    if (typeof value !== 'string' || value.length > 160 || /[\u0000-\u001f]/.test(value)) throw new CimError('请核对矩阵集、级别前缀和样式名称。', 400)
  }
  if (!config.matrixSet.trim() || !['image/png','image/jpeg','image/webp'].includes(config.format)) throw new CimError('请填写矩阵集并选择图像格式。', 400)
  return { projection: config.projection, maxLevel: config.maxLevel, matrixSet: config.matrixSet.trim(),
    matrixPrefix: config.matrixPrefix.trim(), matrixOffset: config.matrixOffset, style: config.style.trim(), format: config.format }
}

export function rasterUrl(service: Pick<CimAdminService,'kind'|'url'|'raster'|'layer'>, z: number, x: number, y: number) {
  const config = service.raster ?? defaultRasterConfig
  const rows = 2 ** z
  const cols = rows * (config.projection === 'EPSG:4326' ? 2 : 1)
  if (![z,x,y].every(Number.isSafeInteger) || z < 0 || z > config.maxLevel || x < 0 || x >= cols || y < 0 || y >= rows) {
    throw new CimError('瓦片级别或行列号超出范围。', 400)
  }
  if (service.kind === 'xyz') {
    return new URL(service.url.replaceAll('{z}',String(z)).replaceAll('{x}',String(x)).replaceAll('{y}',String(y)).replaceAll('{-y}',String(rows - y - 1)))
  }
  const url = new URL(service.url)
  const params = { service: 'WMTS', request: 'GetTile', version: '1.0.0', layer: service.layer, style: config.style,
    format: config.format, tilematrixset: config.matrixSet, tilematrix: config.matrixPrefix + (z + config.matrixOffset),
    tilerow: String(y), tilecol: String(x) }
  for (const key of [...url.searchParams.keys()]) if (Object.hasOwn(params,key.toLowerCase())) url.searchParams.delete(key)
  for (const [key,value] of Object.entries(params)) url.searchParams.set(key, value)
  return url
}

export function sampleTile(service: Pick<CimAdminService,'raster'>) {
  const config = service.raster ?? defaultRasterConfig
  const z = Math.min(12, config.maxLevel), rows = 2 ** z
  const lon = 113.12, lat = 31.04, geographic = config.projection === 'EPSG:4326'
  const x = Math.floor((lon + 180) / 360 * rows * (geographic ? 2 : 1))
  const y = Math.floor(rows * (geographic ? (90 - lat) / 180 : (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2))
  return { z,x,y }
}

export function rasterMime(data: Buffer) {
  if (data.length >= 24 && data.subarray(0,8).toString('hex') === '89504e470d0a1a0a') return 'image/png'
  if (data.length > 4 && data.subarray(0,3).toString('hex') === 'ffd8ff') return 'image/jpeg'
  if (data.length > 16 && data.toString('ascii',0,4) === 'RIFF' && data.toString('ascii',8,12) === 'WEBP') return 'image/webp'
  throw new CimError('服务未返回 PNG、JPEG 或 WebP 图块，请核对服务地址和矩阵参数。')
}
