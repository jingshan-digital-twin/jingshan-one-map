import { courtSourceField, isCourtLedgerId, surveyCourtLedgerId, surveyCourtName } from './court-ledger.ts'
import { localFieldLabel, localFields } from './local-feature-fields.ts'
import { attributeFields, type SpatialAttributeField } from './platform-attribute-table.ts'
import { isPopulationRaster } from './population-raster.ts'
import { isAttributeIdHeader, type SpatialAttributeSheet } from './spatial-attribute-workbook.ts'
import { planRasterAttributeUpdate } from './spatial-raster-attribute-update.ts'
import type { CityFeature, Dataset } from './types.ts'
import { acceptsPendingLocation, checkDataset, checkFeature } from './validate.ts'

export type SpatialAttributeOptions = {clearBlank?:boolean; matchColumn?:string}
export type SpatialAttributePlan = {
  dataset:Dataset
  matched:number
  updated:number
  unchanged:number
  changeCount:number
  fields:string[]
  ignored:string[]
  samples:{row:number;id:string;field:string;before:unknown;after:unknown}[]
}

type Field = SpatialAttributeField
type Cell = SpatialAttributeSheet['rows'][number]['values'][number]
type Column = {field:Field; index:number; header:string}
type ValueType = 'text'|'number'|'boolean'|'object'|'array'|'date'|'month'
const isRecord = (value:unknown):value is Record<string,unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const isBlank = (value:unknown) => value == null || (typeof value === 'string' && !value.trim())
const matchKey = (value:unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''

function fieldLookup(fields:Field[]) {
  const labels = new Map(fields.map(field=>[field.label,field]))
  const keys = new Map<string, Field | null>()
  for (const field of fields) {
    if (!('key' in field.target)) continue
    const key=field.target.key
    keys.set(key,keys.has(key) ? null : field)
  }
  return (header:string) => labels.get(header) ?? keys.get(header)
}

export function spatialMatchColumns(dataset:Dataset, headers:string[]) {
  if (isPopulationRaster(dataset)) return []
  const lookup = fieldLookup(attributeFields(dataset))
  return headers.filter(header=>{
    const field=lookup(header.trim())
    return field && 'key' in field.target && dataset.features.some(feature=>matchKey(field.read(feature)) !== '')
  })
}

function importColumns(dataset:Dataset, sheet:SpatialAttributeSheet, selected?:string) {
  const fields=attributeFields(dataset)
  const headers=sheet.headers.map(value=>value.trim())
  const byField=fieldLookup(fields)
  // Older exports of this source disambiguated raw DBF names with bracketed column keys.
  const oldSurvey=dataset.id===surveyCourtLedgerId && headers.some(h=>h==='实体名称 [实体名称]' || h==='所属行政区 [所属行政区]')
  const oldLabels:Record<string,string>={'实体名称':'地图显示名','所属行政区':'地图所属镇街','实体名称 [实体名称]':'实体名称',
    '所属行政区 [所属行政区]':'所属行政区','实体业务ID [实体业务ID]':'原台账业务ID'}
  const lookup=(header:string)=>{
    const label=oldSurvey && Object.hasOwn(oldLabels,header) ? oldLabels[header] : header
    return byField(dataset.id===surveyCourtLedgerId && (label==='name' || label==='地图显示名') ? '实体名称' : label)
  }
  const nativeID=headers.findIndex(header=>header.toLowerCase()==='实体业务id')
  const idColumns=headers.flatMap((header,i)=>isAttributeIdHeader(header) ? [i] : [])
  if (nativeID<0 && idColumns.length>1) throw Error('工作表有多个可能的要素 ID 列，请保留一个匹配列')
  const byID=nativeID>=0 || idColumns.length>0
  const keyIndex=byID ? (nativeID>=0 ? nativeID : idColumns[0]) : headers.indexOf(selected?.trim() ?? '')
  if (keyIndex<0 || (!byID && !selected?.trim())) throw Error('请提供「实体业务ID」列，或选择一个值唯一的匹配字段')
  const keyField=byID ? fields[0] : lookup(headers[keyIndex])
  if (!keyField || keyField.target.kind==='coordinate') throw Error('所选匹配列不是当前资源的业务字段')
  const used=new Set([keyField]), ignored:string[]=[], columns:Column[]=[]
  headers.forEach((header,index)=>{
    if (index===keyIndex) return
    if (dataset.id===surveyCourtLedgerId && (header==='name' || header==='地图显示名') && headers.includes('实体名称')) {
      ignored.push(header)
      return
    }
    if (oldSurvey && (header==='实体名称' || header==='所属行政区') && headers.includes(header+' ['+header+']')) {
      // Before the layer was linked, these platform columns held generated names and default regions.
      // Its bracketed columns contain the actual recorded names and addresses.
      ignored.push(header)
      return
    }
    if (!header) {
      if (sheet.rows.some(row=>!isBlank(row.values[index]))) throw Error('第 '+(index+1)+' 列有数据但缺少表头')
      return
    }
    const field=lookup(header)
    if (!field) throw Error('无法识别列「'+header+'」，请使用当前资源导出的表头或属性字段名')
    if (used.has(field)) throw Error('字段「'+field.label+'」重复匹配，请检查表头')
    used.add(field)
    if (field.target.kind==='coordinate') ignored.push(header)
    else columns.push({field,index,header})
  })
  if (!columns.length) throw Error('工作表至少需要一个可替换的属性列')
  const propertyLabels=new Map(fields.flatMap(field=>field.target.kind==='property' ? [[field.target.key,field.label] as const] : []))
  return {keyIndex,keyField,columns,ignored,propertyLabels}
}

function valueType(value:unknown):ValueType|undefined {
  if (typeof value==='string') return 'text'
  if (typeof value==='boolean') return 'boolean'
  if (typeof value==='number') return 'number'
  if (Array.isArray(value)) return 'array'
  if (isRecord(value)) return 'object'
}

function typeResolver(dataset:Dataset) {
  const declared=new Map<string,ValueType>()
  const fallback=new Map<Field,ValueType|undefined>()
  for (const field of localFields(dataset)) declared.set(field.key,field.type)
  for (const {key,type} of dataset.formSchema?.fields ?? []) {
    declared.set(key,type==='multiselect' ? 'array' : type==='select' || type==='textarea' ? 'text' : type)
  }
  return (field:Field,before:unknown)=>{
    const hint=field.target.kind==='property' ? declared.get(field.target.key) : undefined
    const current=valueType(before)
    if (current==='text' && (hint==='date' || hint==='month')) return hint
    if (current || hint) return current ?? hint
    if (!fallback.has(field)) {
      const types=new Set<ValueType>()
      for (const feature of dataset.features) {
        const type=valueType(field.read(feature))
        if (type) types.add(type)
        if (types.size>1) break
      }
      fallback.set(field,types.size===1 ? [...types][0] : undefined)
    }
    return fallback.get(field)
  }
}

function convertCell(value:NonNullable<Cell>,type:ValueType|undefined):unknown {
  if (!type) return value
  const raw=String(value), trimmed=raw.trim()
  switch (type) {
    case 'number': {
      const numeric=Number(trimmed)
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed) || !Number.isFinite(numeric) ||
          (Number.isInteger(numeric) && !Number.isSafeInteger(numeric))) throw Error('请填写有效数值，整数必须在可精确表示的范围内')
      return numeric
    }
    case 'boolean': {
      if (['是','true','1'].includes(trimmed.toLowerCase())) return true
      if (['否','false','0'].includes(trimmed.toLowerCase())) return false
      throw Error('请填写「是」或「否」')
    }
    case 'array':
    case 'object': {
      try {
        const parsed=JSON.parse(raw)
        if (type==='array' ? Array.isArray(parsed) : isRecord(parsed)) return parsed
      } catch { /* The message below includes the expected JSON type. */ }
      throw Error(type==='array' ? '请填写有效的 JSON 数组' : '请填写有效的 JSON 对象')
    }
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || new Date(raw+'T00:00:00Z').toJSON()?.slice(0,10)!==raw) throw Error('日期格式应为 YYYY-MM-DD')
      return raw
    case 'month':
      if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(raw)) throw Error('月份格式应为 YYYY-MM')
      return raw
    case 'text': return raw
  }
}

// Keep literal DBF/GeoJSON keys (including "__proto__") as ordinary own properties.
function writeValue(properties:Record<string,unknown>, key:string, value:unknown) {
  if (value===undefined) delete properties[key]
  else Object.defineProperty(properties,key,{value,enumerable:true,configurable:true,writable:true})
}

export function planSpatialAttributeUpdate(dataset:Dataset,sheet:SpatialAttributeSheet,options:SpatialAttributeOptions={}):SpatialAttributePlan {
  if (sheet.error) throw Error(sheet.error)
  if (!sheet.rows.length) throw Error('工作表没有要替换的数据行')
  if (isPopulationRaster(dataset)) return planRasterAttributeUpdate(dataset,sheet,options)
  const {keyIndex,keyField,columns,ignored,propertyLabels}=importColumns(dataset,sheet,options.matchColumn)
  const index=new Map<string,CityFeature|null>()
  for (const feature of dataset.features) {
    const value=matchKey(keyField.read(feature))
    if (value) index.set(value,index.has(value) ? null : feature)
  }
  const seen=new Map<string,number>(), changed=new Map<string,CityFeature>()
  const resolveType=typeResolver(dataset), fields=new Set<string>()
  const samples:SpatialAttributePlan['samples']=[]
  let changeCount=0
  for (const {rowNumber,values} of sheet.rows) {
    const key=matchKey(values[keyIndex])
    const context='第 '+rowNumber+' 行「'+sheet.headers[keyIndex]+'」'
    if (typeof values[keyIndex]==='number' && Math.abs(Number(values[keyIndex]))>=1e15) {
      throw Error(context+'中的编号可能已被 Excel 舍入，请将它设为文本并重新填写原始编号')
    }
    if (!key) throw Error(context+'缺少匹配值')
    if (seen.has(key)) throw Error(context+'的值「'+key+'」与第 '+seen.get(key)+' 行重复')
    seen.set(key,rowNumber)
    const feature=index.get(key)
    if (feature===null) throw Error(context+'的值「'+key+'」在资源中对应多条要素，请改用唯一编号')
    if (!feature) throw Error(context+'的值「'+key+'」在当前资源中没有匹配的要素')
    const properties={...feature.properties}
    let source:Record<string,unknown>|undefined
    const changedKeys=new Set<string>()
    const differences=new Map<string,{before:unknown;after:unknown}>()
    function note(label:string,before:unknown,after:unknown) {
      const previous=differences.get(label)
      const original=previous ? previous.before : before
      if (original===after || (original==null && after==null)) differences.delete(label)
      else differences.set(label,{before:original,after})
    }
    for (const {field,index:column,header} of columns) {
      const target=field.target
      if (!('key' in target)) continue
      const cell=values[column], before=field.read(feature)
      if (cell===before || (typeof before==='number' && typeof cell==='string' && cell===String(before))) continue
      let after:unknown
      if (isBlank(cell)) {
        if (!options.clearBlank || isBlank(before)) continue
      } else {
        try { after=convertCell(cell!,resolveType(field,before)) }
        catch (error) { throw Error('第 '+rowNumber+' 行「'+header+'」'+(error instanceof Error ? error.message : '的格式有误')) }
        if (after===before || (typeof after==='object' && JSON.stringify(after)===JSON.stringify(before))) continue
      }
      if (target.kind==='source') {
        const original=feature.properties.sourceAttributes
        if ((original!=null && !isRecord(original)) || changedKeys.has('sourceAttributes')) throw Error('第 '+rowNumber+' 行「'+header+'」与原始属性的存储类型冲突')
        source ??= isRecord(original) ? {...original} : {}
        writeValue(source,target.key,after)
        properties.sourceAttributes=source
      } else {
        if (target.key==='sourceAttributes' && (source || isRecord(feature.properties.sourceAttributes))) throw Error('第 '+rowNumber+' 行的原始属性已拆分为多个字段，请使用对应列修改')
        if (['name','region','kind'].includes(target.key) && isBlank(after)) throw Error('第 '+rowNumber+' 行「'+header+'」为必填项')
        writeValue(properties,target.key,after)
        changedKeys.add(target.key)
      }
      note(field.label,before,after)
    }
    if (!differences.size) continue
    if (isCourtLedgerId(dataset.id)) {
      // A survey may have a blank ledger 名称 and a different, valid map display name.
      const nameField=courtSourceField(dataset.id,'名称')
      if (changedKeys.has(nameField)) {
        const display=dataset.id===surveyCourtLedgerId ? surveyCourtName(properties) : String(properties[nameField] || feature.id).trim()
        if (changedKeys.has('name') && properties.name!==display) throw Error('第 '+rowNumber+' 行显示名称与台账名称的修改不一致')
        if (properties.name!==display) {
          if (dataset.id!==surveyCourtLedgerId) note(propertyLabels.get('name')!,properties.name,display)
          properties.name=display
        }
      } else if (changedKeys.has('name') && feature.properties[nameField]) {
        note(nameField,properties[nameField],properties.name)
        properties[nameField]=properties.name
      }
    }
    if (feature.properties.locationReview && ['name','region','address'].some(key=>changedKeys.has(key)) &&
        (acceptsPendingLocation(dataset.id) || dataset.id==='charging')) {
      const updateLocation=(key:string,value:unknown)=>{
        const label=propertyLabels.get(key) ?? localFieldLabel(dataset.id,key) ?? key
        note(label,properties[key],value)
        writeValue(properties,key,value)
      }
      updateLocation('locationReview',undefined)
      updateLocation('locationRef',undefined)
      if (acceptsPendingLocation(dataset.id)) updateLocation('locationManuallyEdited',true)
      if (feature.geometry.type==='GeometryCollection') updateLocation('locationSource',undefined)
      else if (!changedKeys.has('locationSource')) updateLocation('locationSource','留用原点位，场所信息已修改')
    }
    const next={...feature,properties}
    checkFeature(next,'第 '+rowNumber+' 行',dataset.id,!!dataset.formSchema)
    changed.set(next.id,next)
    for (const [field,values] of differences) {
      changeCount++
      fields.add(field)
      if (samples.length<50) samples.push({row:rowNumber,id:feature.id,field,...values})
    }
  }
  const next=changed.size ? {...dataset,features:dataset.features.map(feature=>changed.get(feature.id) ?? feature)} : dataset
  if (changed.size) checkDataset(next)
  return {dataset:next,matched:seen.size,updated:changed.size,unchanged:seen.size-changed.size,
    changeCount,fields:[...fields],samples,ignored}
}
