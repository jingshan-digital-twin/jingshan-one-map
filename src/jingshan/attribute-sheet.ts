import type { Style, Workbook } from 'exceljs'

export type AttributeColumn = {label:string; width:number; coordinate?:boolean; text?:boolean}
export type AttributeValue = string | number | boolean | null
export const excelContentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const font = {name:'宋体', size:12, charset:134, color:{argb:'FF000000'}}
const line = {style:'thin' as const, color:{argb:'FF000000'}}
const border = {top:line, bottom:line, left:line, right:line}
const alignment = {horizontal:'center', vertical:'middle'} as const
const fill = (argb:string) => ({type:'pattern', pattern:'solid', fgColor:{argb}} as const)
const headerStyle:Partial<Style> = {font:{...font,bold:true}, border, alignment:{...alignment,wrapText:true}, fill:fill('FFFFFFFF')}

// The populated sheet in 20社区沟渠坑塘编码数据表 uses 30 pt headers, 17.4 pt
// data rows and accent 3 (#A5A5A5) with an 80% tint on the identifier column.
export function addAttributeSheet(book:Workbook, name:string, columns:AttributeColumn[], freezeHeader=false) {
  if (columns.length > 16384) throw Error('属性超过 Excel 单表的 16,384 列上限')
  const sheet = book.addWorksheet(name, {
    properties:{defaultRowHeight:17.4},
    views:[freezeHeader ? {state:'frozen',ySplit:1,zoomScale:85} : {state:'normal',zoomScale:85}],
    pageSetup:{paperSize:9,orientation:'landscape',horizontalDpi:300,verticalDpi:300,
      margins:{left:0.23622,right:0.23622,top:0.74803,bottom:0.74803,header:0.31496,footer:0.31496}},
  })
  sheet.columns = columns.map((col,i) => ({
    width:col.width,
    style:{font:col.coordinate ? {...font,size:11} : font, border, alignment:{...alignment,wrapText:true},
      ...(i===0 ? {fill:fill('FFEDEDED')} : {}),
      ...(col.coordinate ? {numFmt:'0.0000000000_ '} : col.text ? {numFmt:'@'} : {})},
  }))
  const header = sheet.addRow(columns.map(col => col.label))
  header.height = 30
  header.eachCell(cell => {cell.style = headerStyle})
  header.commit()
  return sheet
}

export function cellTextWidth(text:string) {
  let width=0
  for (const char of text) width += char.codePointAt(0)! > 255 ? 2 : 1
  return width
}

export function addAttributeRows(book:Workbook, name:string, columns:AttributeColumn[], rows:AttributeValue[][], freezeHeader=false) {
  // Use the real values to size each field. Long notes wrap inside a bounded column.
  const fitted = columns.map(col => ({...col, width:Math.min(48,Math.max(col.width,cellTextWidth(col.label)+3))}))
  for (const values of rows) values.forEach((value,i) => {
    if (typeof value !== 'string') return
    if (value.length > 32767) throw Error('「'+columns[i].label+'」的内容超过 Excel 单元格的 32,767 字符上限')
    if (fitted[i].width < 48) {
      for (const line of value.split(/\r\n|\r|\n/)) fitted[i].width = Math.min(48,Math.max(fitted[i].width,cellTextWidth(line)+3))
    }
  })
  const sheet=addAttributeSheet(book,name,fitted,freezeHeader)
  for (const values of rows) {
    const row=sheet.addRow(values)
    let lines=1
    values.forEach((value,i) => {
      if (typeof value!=='string') return
      const available = fitted[i].width-2
      const required = value.split(/\r\n|\r|\n/).reduce((n,line) => n+Math.max(1,Math.ceil(cellTextWidth(line)/available)),0)
      lines=Math.max(lines,required)
    })
    if (lines>1) row.height=Math.min(409,17.4*lines)
    row.commit()
  }
  return sheet
}
