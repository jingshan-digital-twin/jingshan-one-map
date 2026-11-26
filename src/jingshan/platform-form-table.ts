import type { CityFeature, Dataset, FormField } from './types.ts'
import { operationalForm } from './platform-forms.ts'
import { downloadBlob } from './api.ts'
import { addAttributeRows, excelContentType } from './attribute-sheet.ts'

const field = (key:string, label:string, type:FormField['type']='text'):FormField => ({key,label,type})
const base = [field('id','记录ID'),field('name','记录名称'),field('region','行政区'),field('sample','演示数据','boolean')]
const scope = [field('chainStage','产业阶段'),field('chainTopic','产业环节')]
const year = field('year','统计年度','number')
const ledgerFields:Record<string,FormField[]> = {
  industry_output:[year,...scope,field('outputBasis','产值口径'),field('outputWanYuan','年度产值（万元）','number'),field('outputSource','填报依据')],
  industry_enterprise_annual:[year,field('enterpriseId','名录企业ID'),field('topic','经营环节'),field('sourceStatus','核验状态'),field('operating','实际经营','boolean'),field('aboveScale','规上企业','boolean'),field('topicRevenueWan','环节营收（万元）','number')],
  industry_procurement:[field('purchasedAt','采购日期','date'),field('orderId','订单编号'),field('buyer','采购方名称'),...scope,field('category','采购品类'),field('supplier','供应商名称'),field('supplierLocality','供应商属地'),field('amountYuan','采购金额（元）','number'),field('receipt','凭证编号'),field('verified','已核验','boolean'),field('externalReason','外采原因')],
}

export function tableFields(dataset:Dataset):FormField[] {
  const op=operationalForm(dataset.id)
  return [...base,...dataset.formSchema?.fields ?? (op ? [field(op.linkKey,op.linkLabel+'ID'), ...op.fields] : ledgerFields[dataset.id] ?? [])]
}

// A custom field may use the display label of a system field. Keys keep that sheet unambiguous.
function headings(fields:FormField[]) {
  return fields.map(f=>fields.filter(other=>other.label===f.label).length>1 ? f.label+' ['+f.key+']' : f.label)
}
function sheetValue(value:unknown, f:FormField) {
  if(value==null) return ''
  if(f.key==='outputBasis') return value==='reported'?'实报':value==='estimate'?'估算':String(value)
  if(typeof value==='boolean') return value?'是':'否'
  if(Array.isArray(value)) return JSON.stringify(value)
  return typeof value==='number'?value:String(value)
}
function readValue(value:unknown,f:FormField) {
  if(value == null || value==='') return undefined
  if(value instanceof Date) return value.toISOString().slice(0,10)
  if(typeof value==='object') throw new Error('单元格应填写数值或文本')
  const text=String(value).trim()
  if(!text) return undefined
  if(f.key==='outputBasis') return text==='实报'?'reported':text==='估算'?'estimate':text
  if(f.type==='number') {
    const number=Number(text.replace(/,/g,''))
    if(!Number.isFinite(number)) throw new Error('需要有效数值')
    return number
  }
  if(f.type==='boolean') {
    if(['是','true','1'].includes(text.toLowerCase())) return true
    if(['否','false','0'].includes(text.toLowerCase())) return false
    throw new Error('请填写是或否')
  }
  if(f.type==='multiselect') return text.startsWith('[') ? JSON.parse(text) : text.split('、').map(s=>s.trim()).filter(Boolean)
  return text
}
function dataRows(fields:FormField[],rows:CityFeature[]) {
  return rows.map(row=>fields.map(f=>sheetValue(f.key==='id'?row.id:row.properties[f.key],f)))
}
export async function downloadFormTable(dataset:Dataset, rows:CityFeature[], format:'xlsx'|'csv',template=false) {
  const fields=tableFields(dataset), labels=headings(fields), values=dataRows(fields,rows)
  const name=dataset.name+(template?'_模板':'')+'.'+format
  if(format==='csv') {
    const quote=(v:unknown)=>'"'+(typeof v==='string'?v.replace(/^[=+@\-\t\r]/,m=>"'"+m):String(v)).replaceAll('"','""')+'"'
    downloadBlob(new Blob(['\uFEFF',[labels,...values].map(row=>row.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),name)
    return
  }
  const {default:Excel}=await import('exceljs')
  const book=new Excel.Workbook()
  addAttributeRows(book,'业务数据',fields.map((f,i)=>({label:labels[i],width:i===0?26.78:14,text:f.type!=='number'})),values,true)
  const info=book.addWorksheet('填表说明')
  info.addRows([['表单标识',dataset.id],['记录ID','更新记录时保留原ID；追加新记录可留空。'],['日期','填写 YYYY-MM-DD。'],['字段','填写要求'],...fields.map(f=>[f.label,[f.required?'必填':'选填',f.options?.join('、'),f.hint].filter(Boolean).join(' · ')])])
  info.columns=[{width:25},{width:75}]
  const buffer=await book.xlsx.writeBuffer()
  downloadBlob(new Blob([new Uint8Array(buffer)],{type:excelContentType}),name)
}
export function readCsv(text:string):string[][] {
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false
  text=text.replace(/^\uFEFF/,'')
  for(let i=0;i<text.length;i++) {
    const c=text[i]
    if(quoted) {
      if(c!=='"') cell+=c
      else if(text[i+1]==='"') {cell+='"';i++}
      else {quoted=false;closed=true}
    } else if(c===',') {row.push(cell);cell='';closed=false}
    else if(c==='\n'||c==='\r') {
      if(c==='\r' && text[i+1]==='\n') i++
      row.push(cell);rows.push(row);row=[];cell='';closed=false
    } else if(c==='"' && !cell && !closed) quoted=true
    else if(closed) throw new Error('CSV 引号后包含无效字符')
    else cell+=c
    if(row.length>128 || rows.length>12001) throw new Error('单表最多 128 列、12,000 条记录')
  }
  if(quoted) throw new Error('CSV 引号未闭合')
  if(row.length||cell||closed){row.push(cell);rows.push(row)}
  return rows
}
export function tableCollection(dataset:Dataset,matrix:unknown[][]) {
  const fields=tableFields(dataset), labels=headings(fields)
  const columns=(matrix[0]??[]).map(raw=>{
    const label=String(raw??'').trim(), index=labels.indexOf(label)
    if(!label)return
    const f=index>=0 ? fields[index] : fields.find(item=>item.key===label)
    if(!f) throw new Error('未识别表头「'+label+'」，请下载当前表单模板')
    return f
  })
  const keys=columns.filter(Boolean).map(f=>f!.key)
  if(!keys.length || new Set(keys).size!==keys.length) throw new Error('表头为空或有重复字段')
  const features=matrix.slice(1).flatMap((row,r)=>{
    if(!row.some(v=>v!==undefined && v!==null && v!==''))return []
    const properties:Record<string,unknown>={};let id:unknown
    row.forEach((v,i)=>{
      if(v==null||v==='')return
      const f=columns[i]
      if(!f)throw new Error('第 '+(r+2)+' 行第 '+(i+1)+' 列缺少表头')
      try{
        const parsed=readValue(v,f)
        if(f.key==='id')id=parsed
        else if(parsed!==undefined)properties[f.key]=parsed
      }catch(e){throw new Error('第 '+(r+2)+' 行「'+f.label+'」'+(e instanceof Error?e.message:'格式有误'))}
    })
    return [{type:'Feature',id,properties,geometry:null}]
  })
  if(!features.length)throw new Error('文件中没有数据行')
  return {type:'FeatureCollection',formDatasetId:dataset.id,features}
}
export async function readFormTable(file:File,dataset:Dataset) {
  if(/\.csv$/i.test(file.name))return tableCollection(dataset,readCsv(await file.text()))
  if(!/\.xlsx$/i.test(file.name))return JSON.parse((await file.text()).replace(/^\uFEFF/,''))
  const {default:Excel}=await import('exceljs'), book=new Excel.Workbook()
  await book.xlsx.load(await file.arrayBuffer())
  const meta=book.getWorksheet('填表说明')
  if(meta?.getCell('A1').text==='表单标识' && meta.getCell('B1').text!==dataset.id) throw new Error('工作簿属于另一张表单')
  const sheet=book.getWorksheet('业务数据')??book.worksheets[0]
  if(!sheet || sheet.rowCount>12001 || sheet.columnCount>128) throw new Error('单表最多 128 列、12,000 条记录')
  const matrix:unknown[][]=[]
  sheet.eachRow((row,rowNumber)=>{
    const values:unknown[]=[]
    row.eachCell((cell,col)=>{
      if(cell.type===6 || cell.formula)throw new Error(cell.address+' 含公式，请粘贴为值后导入')
      values[col-1]=typeof cell.value==='object' && !(cell.value instanceof Date) ? cell.text : cell.value
    })
    matrix[rowNumber-1]=values
  })
  return tableCollection(dataset,matrix)
}

