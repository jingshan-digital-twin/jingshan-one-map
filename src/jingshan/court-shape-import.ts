import type { Polygon, MultiPolygon } from 'geojson'
import { inPolygon } from './analytics.ts'
import { createFacilityBoundaryIndex } from './facility-boundaries.ts'
import { courtSourceField, surveyCourtFields, surveyCourtLedgerId, surveyCourtName } from './court-ledger.ts'
import { featureCenter, type CityFeature, type Dataset } from './types.ts'

type Fields = Record<string, unknown>
function fields(value: unknown): value is Fields {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

// DBF updates can reorder rows or change a ring's starting vertex and winding.
// Compare all polygon edges at the eight decimal places of the published survey.
function ringKey(ring: unknown) {
  if (!Array.isArray(ring) || ring.length < 4) return ''
  const points: string[] = []
  for (const point of ring) {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return ''
    points.push(point[0].toFixed(8) + ',' + point[1].toFixed(8))
  }
  if (points[0] !== points.at(-1)) return ''
  return points.slice(1).map((next, index) => [points[index], next].sort().join(':')).sort().join(';')
}

function boundaryKey(geometry: unknown) {
  if (!fields(geometry) || !Array.isArray(geometry.coordinates)) return ''
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  if (!polygons.length) return ''
  const keys: string[] = []
  for (const rings of polygons) {
    if (!Array.isArray(rings) || !rings.length) return ''
    const [shell, ...holes] = rings.map(ringKey)
    if (!shell || holes.includes('')) return ''
    keys.push([shell, ...holes.sort()].join('|'))
  }
  return keys.sort().join('/')
}

function remember(index: Map<string, CityFeature | null>, key: string, feature: CityFeature) {
  if (key) index.set(key, index.has(key) ? null : feature)
}

export function importLedgerPolygons(datasets: Dataset[], ledger: Dataset, rows: unknown[]) {
  const existing = new Map<string, CityFeature | null>()
  const businessIds = new Map<string, CityFeature | null>()
  for (const feature of ledger.features) {
    remember(existing, boundaryKey(feature.geometry), feature)
    if (ledger.id===surveyCourtLedgerId) remember(businessIds,text(feature.properties['实体业务ID']),feature)
  }
  const features = (id: string) => datasets.find(dataset => dataset.id === id)?.features ?? []
  const areas = createFacilityBoundaryIndex(features('administration'), features('communities'))
  const seen = new Set<string>()
  const seenBusinessIds = new Set<string>()
  return rows.map((row, index) => {
    const label = '第 ' + (index + 1) + ' 个图斑'
    if (!fields(row) || row.type !== 'Feature' || !fields(row.properties)) throw Error(label + '缺少 SHP 要素或属性')
    const key = boundaryKey(row.geometry)
    if (!key) throw Error(label + '缺少有效的场地面边界')
    if (seen.has(key) || existing.get(key) === null) throw Error(label + '的边界重复，无法唯一对应场地')
    seen.add(key)
    const attributes = {...row.properties}
    const boundaryMatch=existing.get(key)
    const businessId=ledger.id===surveyCourtLedgerId ? text(attributes['实体业务ID']) : ''
    const businessMatch=businessIds.get(businessId)
    if (businessId) {
      if (seenBusinessIds.has(businessId) || businessMatch===null) throw Error(label+'的实体业务ID重复，无法唯一对应场地')
      if (boundaryMatch && ((businessMatch && businessMatch.id!==boundaryMatch.id) ||
          (text(boundaryMatch.properties['实体业务ID']) && text(boundaryMatch.properties['实体业务ID'])!==businessId))) {
        throw Error(label+'的实体业务ID与已有场地边界不一致')
      }
      seenBusinessIds.add(businessId)
    } else if (ledger.id===surveyCourtLedgerId && boundaryMatch?.properties['实体业务ID']) {
      attributes['实体业务ID']=boundaryMatch.properties['实体业务ID']
    }
    for (const [field,rawField] of Object.entries(surveyCourtFields)) {
      const keep=courtSourceField(ledger.id,field), alias=keep===rawField ? field : rawField
      if (!Object.hasOwn(attributes,alias)) continue
      if (!Object.hasOwn(attributes,keep)) attributes[keep]=attributes[alias]
      delete attributes[alias]
    }
    const nameField=courtSourceField(ledger.id,'名称')
    if (!Object.hasOwn(attributes,nameField) && !Object.hasOwn(attributes,'所属场馆')) {
      throw Error(label + '缺少名称或所属场馆字段，请检查 DBF 和字符编码')
    }
    const shape = row.geometry as Polygon | MultiPolygon
    // The projected SHP extent is not an axis-aligned envelope after reprojection.
    const geometry = {type:shape.type, coordinates:shape.coordinates} as Polygon | MultiPolygon
    const name = ledger.id===surveyCourtLedgerId ? surveyCourtName(attributes) : text(attributes[nameField]) || '未命名场地（图斑 ' + (index + 1) + '）'
    const properties = {...attributes, name, region:text(attributes['所属行政区'] ?? row.properties['所属行政区']) || '京山市', kind:'court-footprint'}
    // The source's 镇街或片区 can be a road or an address. Scope the map by the published polygons.
    const center = featureCenter({type:'Feature',id:'',geometry,properties})
    if (center) {
      const {town,village} = areas.locate(center)
      properties.region = town?.properties.name || village?.properties.region || properties.region
    }
    return {type:'Feature', id:boundaryMatch?.id ?? businessMatch?.id ?? row.id, geometry, properties}
  })
}

function verifiedComment(raw: Fields, geometry: Polygon | MultiPolygon): Fields {
  const comment = Object.keys(raw).filter(key => /^O_Com\d*$/i.test(key))
    .sort((a,b) => Number(a.slice(5)) - Number(b.slice(5))).map(key => String(raw[key] ?? '')).join('')
  if (!comment.startsWith('<?ovital_ct')) return {}
  try {
    const attrs = JSON.parse(comment.slice(comment.indexOf('{'), comment.lastIndexOf('}') + 1)
      .replace(/;\s*(?="[^"]+"\s*:|\})/g, ''))
    if (!fields(attrs) || !attrs.TYSBDM || typeof attrs.X !== 'number' || typeof attrs.Y !== 'number') return {}
    const point = [attrs.X, attrs.Y]
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    return polygons.some(rings => inPolygon(point, rings)) ? attrs : {}
  } catch { return {} }
}

export function reconcileCourtShape(dataset: Dataset, rows: unknown[], updateOnly: boolean) {
  const boundaries = new Map<string, CityFeature | null>()
  const codes = new Map<string, CityFeature | null>()
  const ids = new Map(dataset.features.map(feature => [feature.id, feature]))
  for (const feature of dataset.features) {
    remember(boundaries, boundaryKey(feature.geometry), feature)
    remember(codes, text(feature.properties.registrationCode), feature)
  }
  const newCodes = new Set<string>()
  return rows.map((row, index) => {
    const label = '第 ' + (index + 1) + ' 片'
    if (!fields(row) || row.type !== 'Feature' || !fields(row.properties)) throw new Error(label + '缺少 SHP 要素或属性')
    const key = boundaryKey(row.geometry)
    if (!key) throw new Error(label + '的 SHP 边界无效')
    const p = {...verifiedComment(row.properties, row.geometry as Polygon | MultiPolygon), ...row.properties}
    const code = text(p.registrationCode ?? p['登记编码'] ?? p.TYSBDM)
    const geometric = boundaries.get(key)
    const coded = codes.get(code)
    const byId = ids.get(text(row.id))
    if (coded === null || (geometric === null && !coded && !byId)) throw new Error(label + '无法唯一对应原场地，请核对登记编码')
    const matches = new Set([byId, coded, geometric].filter((item): item is CityFeature => !!item))
    if (matches.size > 1 || (code && newCodes.has(code))) throw new Error(label + '的登记编码和场地边界对应不一致或编码重复')
    if (code) newCodes.add(code)
    const existing = [...matches][0]
    if (updateOnly && !existing) throw new Error(label + '未匹配已有场地边界或登记编码，请核对源数据')
    const previous = existing?.properties
    // The Ovital comment has already been checked against the actual footprint.
    // Styling and raw comment fragments do not belong in the business attributes.
    const attributes = Object.fromEntries(Object.entries(p).filter(([k, v]) =>
      !/^O_(?:Com\d*|LClr|LWidth|LAlpha|AAlpha|AClr|Flag|Name)$/i.test(k) && v != null && v !== '',
    ))
    const originalName = text(p.O_Name)
    const name = text(p.name ?? p['场地名称'] ?? p['名称'] ?? p.MC) ||
      (originalName && !/^\d+$/.test(originalName) && originalName !== previous?.originalName ? originalName : '')
    const operator = text(p.operator ?? p['管理单位'] ?? p.GLDW)
    const region = text(p.region ?? p['所属乡镇'] ?? p['乡镇街道'])
    const props: Fields = {
      ...attributes,
      kind:'court-footprint',
      sourceAttributes: {...(fields(previous?.sourceAttributes) ? previous.sourceAttributes : {}), ...attributes},
    }
    if (name) props.name = name
    if (operator) props.operator = operator
    if (region) props.region = region
    if (originalName) props.originalName = originalName
    if (code) props.registrationCode = code
    const id = existing?.id || text(row.id) || (code ? 'court-footprint-' + code : undefined)
    // This import mode updates attributes only; verified boundaries, positions and
    // administrative assignments are retained even when identified by code.
    return {...row, id, geometry:existing && updateOnly ? existing.geometry : row.geometry,
      properties: {...previous, ...props}}
  })
}
