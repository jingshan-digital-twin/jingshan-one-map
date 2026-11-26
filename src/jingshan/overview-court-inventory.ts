import { ledgerDetails } from './court-ledger.ts'
import type { CityFeature } from './types.ts'
function recorded(value: unknown): value is string | number | boolean {
  if (typeof value === 'string') return value.trim().length > 0
  return typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
}

function sourceFields(feature: CityFeature): Record<string, unknown> {
  const source = feature.properties.sourceAttributes
  return source && typeof source === 'object' && !Array.isArray(source)
    ? (source as Record<string, unknown>)
    : {}
}

const rawAliases: Record<string, string> = {
  MC: '原图名称',
  TYSBDM: '统一识别码',
  GLDW: '管理单位',
  GXSJ: '数据更新时间',
  BJMC: '别名',
  BDEWWGWZM: '北斗二维网格位置码',
  BDSWWGWZM: '北斗三维网格位置码',
  QXXZQHDM: '区县代码',
  QXXZQHMC: '区县名称',
  FLM: '分类码',
  X: '登记经度',
  Y: '登记纬度',
}
const mappedRawFields: Record<string, string> = {
  MC: 'name',
  TYSBDM: 'registrationCode',
  GLDW: 'operator',
  GXSJ: 'updatedAt',
}
const internalFields = new Set([
  'kind',
  'color',
  'id',
  'name',
  'region',
  'sourceAttributes',
  'sourceId',
  'sourceServiceId',
  'originalName',
])
const technicalRawFields = new Set(['ID', 'FID', 'OBJECTID', 'SHAPE_LENG', 'SHAPE_AREA', 'Z'])

export function courtFootprintDetails(feature: CityFeature) {
  if (feature.properties.ledgerId) return ledgerDetails(feature)
  const props = feature.properties
  const fields = new Map<string, string | boolean | number>()
  for (const [key, value] of Object.entries(props)) {
    if (!internalFields.has(key) && recorded(value)) fields.set(key, value)
  }
  if (recorded(props.originalName) && props.originalName !== props.name)
    fields.set('originalName', props.originalName)
  for (const [key, value] of Object.entries(sourceFields(feature))) {
    if (technicalRawFields.has(key) || !recorded(value) || recorded(props[mappedRawFields[key]])) continue
    const label = rawAliases[key] ?? key
    if (!fields.has(label) && !fields.has(key)) {
      fields.set(label, (key === 'X' || key === 'Y') && typeof value === 'number' ? value.toFixed(6) : value)
    }
  }
  return [...fields.entries()]
}
