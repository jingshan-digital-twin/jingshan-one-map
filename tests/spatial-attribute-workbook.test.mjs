import test from 'node:test'
import assert from 'node:assert/strict'
import Excel from 'exceljs'
import { attributeWorkbook } from '../src/jingshan/platform-attribute-table.ts'
import { isAttributeIdHeader, readSpatialAttributeWorkbook } from '../src/jingshan/spatial-attribute-workbook.ts'

async function xlsxFile(book) {
  return new File([await book.xlsx.writeBuffer()],'场地属性.xlsx')
}

test('后台属性导出可回读，完整保留长文本编号、重名属性和字面公式文本',async()=>{
  const id='0012345678901234567'
  const row={type:'Feature',id,geometry:{type:'Point',coordinates:[113.12,31.02]},properties:{
    name:'网球公园',kind:'场馆',region:'京山市',数量:0,开放:false,备注:'=1+1',sourceAttributes:{数量:3},
  }}
  const book=await attributeWorkbook({id:'test-places',features:[row]},[row])
  const [sheet]=await readSpatialAttributeWorkbook(await xlsxFile(book))
  assert.equal(sheet.name,'属性数据')
  assert.equal(sheet.rows[0].rowNumber,2)
  const cell=label=>sheet.rows[0].values[sheet.headers.indexOf(label)]
  assert.equal(cell('实体业务ID'),id)
  assert.equal(cell('实体名称'),'网球公园')
  assert.equal(cell('数量'),0)
  assert.equal(cell('数量 [原始属性.数量]'),3)
  assert.equal(cell('开放'),'否')
  assert.equal(cell('备注'),'=1+1')
  assert.equal(cell('经度'),113.12)
})

test('按工作表区分业务属性，跳过标题、说明与隐藏页，定位到原始行号',async()=>{
  const book=new Excel.Workbook()
  book.addWorksheet('填表说明').addRows([['编号','填写方法'],['123','文字']])
  book.addWorksheet('历史数据',{state:'hidden'}).addRows([['实体业务ID','名称'],['123','历史']])
  const places=book.addWorksheet('新台账')
  places.mergeCells('A1:D1')
  places.getCell('A1').value='2026 年度场馆资料'
  places.getRow(2).values=['编制单位','京山']
  places.getRow(4).values=['场地编码','开放','名称','日期','片数']
  places.getRow(7).values=['00123',false,{richText:[{text:'网球'},{text:'公园'}]},new Date('2026-11-24T00:00:00Z'),0]
  const alternate=book.addWorksheet('旧台账')
  alternate.addRows([['要素ID','标题'],[12,'甲']])
  alternate.getCell('A2').numFmt='00000'
  const sheets=await readSpatialAttributeWorkbook(await xlsxFile(book),['场地编码','名称'])
  assert.deepEqual(sheets.map(s=>s.name),['新台账','旧台账'])
  assert.deepEqual(sheets[0].rows,[{rowNumber:7,values:['00123',false,'网球公园','2026-11-24',0]}])
  assert.equal(sheets[1].rows[0].values[0],'00012')
  assert.equal(isAttributeIdHeader(' FeatureID '),true)
  assert.equal(isAttributeIdHeader('编号'),false)
})

test('识别非系统编号普通表头，支持其他工作表含无效公式并给出精确位置',async()=>{
  const book=new Excel.Workbook()
  const bad=book.addWorksheet('有公式')
  bad.addRows([['要素编号','新名称'],['A',{formula:'1+1',result:2}]])
  await assert.rejects(async()=>readSpatialAttributeWorkbook(await xlsxFile(book)),/有公式.*B2.*粘贴为值/)
  const ok=book.addWorksheet('普通属性')
  ok.addRows([['业务编码','名称'],['A','新名称']])
  const [first,second]=await readSpatialAttributeWorkbook(await xlsxFile(book))
  assert.match(first.error,/B2/)
  assert.deepEqual(second.rows,[{rowNumber:2,values:['A','新名称']}])
})

test('普通业务列保留纯零格式实际补出的前导零，其他数字保持数值类型',async()=>{
  const book=new Excel.Workbook()
  const sheet=book.addWorksheet('新台账')
  sheet.addRows([['场地编码','片数'],[1,19],[12345,123],[0,-1],[3.25,4],[1234567890123456,10]])
  sheet.getColumn(1).numFmt='00000'
  sheet.getColumn(2).numFmt='00'
  sheet.getCell('A6').numFmt='000000000000000000'
  const [result]=await readSpatialAttributeWorkbook(await xlsxFile(book),['场地编码','片数'])
  assert.deepEqual(result.rows.map(row=>row.values),[['00001',19],[12345,123],['00000',-1],[3.25,'04'],[1234567890123456,10]])
})

test('无表头数据、错误编号及不支持的文件都明确报错',async()=>{
  const book=new Excel.Workbook()
  const sheet=book.addWorksheet('属性')
  sheet.addRows([['实体业务ID','名称'],[1234567890123456,'甲']])
  await assert.rejects(async()=>readSpatialAttributeWorkbook(await xlsxFile(book)),/A2.*文本/)
  sheet.getCell('A2').value='01'
  sheet.getCell('D2').value='漏标题'
  await assert.rejects(async()=>readSpatialAttributeWorkbook(await xlsxFile(book)),/D2.*缺少表头/)
  await assert.rejects(readSpatialAttributeWorkbook(new File(['123'],'未转换.xls')),/xlsx/)
  await assert.rejects(readSpatialAttributeWorkbook(new File(['123'],'损坏.xlsx')),/损坏/)
})
