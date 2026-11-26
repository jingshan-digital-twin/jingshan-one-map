import assert from 'node:assert/strict'
import test from 'node:test'
import Excel from 'exceljs'
import { readCsv, readFormTable, tableCollection } from '../src/jingshan/platform-form-table.ts'
import { prepareGeoImport } from '../src/jingshan/platform-local-data.ts'
const table={id:'form_survey',name:'点位调查',department:'文旅局',category:'业务表单',description:'',features:[],formSchema:{fields:[
  {key:'seats',type:'number',label:'餐位',defaultValue:0},
  {key:'code',type:'text',label:'单位编号',unique:true,required:true},
  {key:'services',type:'multiselect',options:['住宿','餐饮'],label:'服务项目'},
]}}
const draft={datasets:[table],mode:'live',rules:{}}
test('表格数值、多选、中文列名与多行 CSV 记录按现有导入规则预检',()=>{
  const rows=readCsv('\uFEFF记录名称,单位编号,服务项目\r\n"食宿服务,点位\n一",A01,住宿、餐饮\r\n')
  const data=tableCollection(table,rows)
  const result=prepareGeoImport(draft,table,data,'append')
  assert.equal(result.added,1)
  const p=result.first[0].properties
  assert.equal(p.name,'食宿服务,点位\n一');assert.deepEqual(p.services,['住宿','餐饮']);assert.equal(p.seats,0)
  assert.throws(()=>tableCollection(table,[['单位编号','单位编号'],['A','B']]),/重复/)
  assert.throws(()=>prepareGeoImport(draft,table,tableCollection(table,[['单位编号'],['A'],['A']]),'append'),/不可重复/)
})
test('Excel 按当前表校验工作簿与公式，支持数值零',async()=>{
  const book=new Excel.Workbook(), data=book.addWorksheet('业务数据')
  data.addRows([['记录名称','餐位','单位编号'],['样本',0,'X']])
  const meta=book.addWorksheet('填表说明')
  meta.addRow(['表单标识',table.id])
  const file=async()=>new File([await book.xlsx.writeBuffer()],'样本.xlsx')
  const parsed=await readFormTable(await file(),table)
  assert.equal(parsed.features[0].properties.seats,0)
  await assert.rejects(readFormTable(await file(),{...table,id:'form_other'}),/另一张/)
  data.getCell('B2').value={formula:'2*2',result:4}
  await assert.rejects(readFormTable(await file(),table),/粘贴为值/)
})

