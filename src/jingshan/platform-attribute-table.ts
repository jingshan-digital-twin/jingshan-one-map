import { downloadBlob, jsonRequest } from './api.ts'
import { addAttributeRows, excelContentType, type AttributeColumn, type AttributeValue } from './attribute-sheet.ts'
import { courtSourceField, isCourtLedgerId, ledgerFields, surveyCourtLedgerId } from './court-ledger.ts'
import { localFieldLabel } from './local-feature-fields.ts'
import { isPopulationRaster } from './population-raster.ts'
import type { CityFeature, Dataset } from './types.ts'

type AttributeTarget = {kind:'id'|'coordinate'} | {kind:'property'|'source';key:string}
export type SpatialAttributeField = AttributeColumn & {target:AttributeTarget;read:(feature:CityFeature)=>unknown}
const object = (value:unknown):value is Record<string,unknown> => value!==null && typeof value==='object' && !Array.isArray(value)
const property = (record:Record<string,unknown>,key:string) => Object.hasOwn(record,key) ? record[key] : null

function attributeValue(value:unknown):AttributeValue {
  if (value==null) return null
  if (typeof value==='boolean') return value?'是':'否'
  if (typeof value==='number') return Number.isInteger(value) && Math.abs(value)>=1e15 ? String(value) : value
  return typeof value==='string' ? value : JSON.stringify(value)
}

export function attributeFields(dataset:Dataset):SpatialAttributeField[] {
  const keys=new Set<string>()
  if (dataset.id===surveyCourtLedgerId) {
    // The source name is also the map name; show its one authoritative DBF column.
    for (const field of ledgerFields) keys.add(courtSourceField(dataset.id,field))
    keys.add('region');keys.add('kind')
  } else for (const key of isCourtLedgerId(dataset.id)
    ? ['name',...ledgerFields.filter(key=>key!=='名称'),'名称','region','kind'] : ['name','kind','region']) keys.add(key)
  const sourceKeys=new Set<string>()
  const formLabels = new Map(dataset.formSchema?.fields.map(f=>[f.key,f.label]))
  for (const key of formLabels.keys()) keys.add(key)
  let pointDimensions=0
  for (const feature of dataset.features) {
    for (const [key,value] of Object.entries(feature.properties)) {
      if (dataset.id===surveyCourtLedgerId && key==='name') continue
      if (key==='sourceAttributes' && object(value)) {
        for (const sourceKey of Object.keys(value)) sourceKeys.add(sourceKey)
      } else keys.add(key)
    }
    if (feature.geometry.type==='Point') pointDimensions=Math.max(pointDimensions,feature.geometry.coordinates.length)
  }
  const fields:SpatialAttributeField[]=[{label:'实体业务ID',width:26.78,text:true,target:{kind:'id'},read:f=>f.id}]
  const used=new Set(['实体业务ID'])
  function append(label:string,key:string,target:AttributeTarget,read:SpatialAttributeField['read'],width=12,coordinate=false) {
    let title=label
    if (used.has(title)) title=label+' ['+key+']'
    while (used.has(title)) title+=' ['+key+']'
    used.add(title)
    fields.push({label:title,width,coordinate,target,read})
  }
  const base=new Map([['name','实体名称'],['kind','资源类型'],['region','所属行政区'],['sourceAttributes','原始属性']])
  if (dataset.id===surveyCourtLedgerId) {
    base.set('region','地图所属镇街')
    base.set('实体业务ID','原台账业务ID')
  }
  for (const key of keys) {
    const label = base.get(key) ?? formLabels.get(key) ?? localFieldLabel(dataset.id,key) ?? key
    append(label,key,{kind:'property',key},f=>{
      const value=property(f.properties,key)
      return key==='sourceAttributes' && object(value) ? null : value
    },key==='name' ? 20.78 : 12,/^(经度|纬度|longitude|latitude)$/i.test(key))
  }
  for (const key of sourceKeys) {
    append(key,'原始属性.'+key,{kind:'source',key},f=>object(f.properties.sourceAttributes) ? property(f.properties.sourceAttributes,key) : null)
  }
  const pointLabels=['经度','纬度','高程'].slice(0,pointDimensions)
  pointLabels.forEach((label,i)=>{
    append(label,'点位'+label,{kind:'coordinate'},f=>f.geometry.type==='Point' ? f.geometry.coordinates[i] : null,i===2 ? 10 : 17.44,i<2)
  })
  return fields
}

export async function attributeWorkbook(dataset:Dataset, rows:CityFeature[]) {
  const {default:Excel}=await import('exceljs')
  const fields=attributeFields(dataset)
  const book=new Excel.Workbook()
  addAttributeRows(book,'属性数据',fields,rows.map(row=>fields.map(field=>attributeValue(field.read(row)))))
  return book
}

export async function downloadAttributeTable(dataset:Dataset, rows?:CityFeature[], query='', filtered=false, rasterIds?:string[]) {
  let blob:Blob
  if (isPopulationRaster(dataset)) {
    // Send the compact blocks from the displayed workspace, including any unsaved pixel edits.
    const result=await fetch('/api/jingshan/platform/population-attributes.xlsx',jsonRequest('POST',{dataset,query,ids:rasterIds}))
    if (!result.ok) throw Error((await result.json().catch(()=>null))?.error || '人口网格属性表导出失败')
    blob=await result.blob()
  } else {
    const book=await attributeWorkbook(dataset,rows ?? dataset.features)
    const buffer=await book.xlsx.writeBuffer()
    blob=new Blob([new Uint8Array(buffer)],{type:excelContentType})
  }
  const name=dataset.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_')
  downloadBlob(blob,name+(filtered?'_筛选结果':'')+'_属性表.xlsx')
}
