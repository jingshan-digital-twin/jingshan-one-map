import type { Cell, Row, Worksheet } from 'exceljs'
import { localFileLimit } from './platform-local-data.ts'

export type SpatialAttributeCell = string | number | boolean | null
export interface SpatialAttributeSheet {
  name: string
  headers: string[]
  rows: {rowNumber:number; values:SpatialAttributeCell[]}[]
  error?: string
}

const idHeaders = new Set(['实体业务id','要素id','要素编号','记录id','记录编号','业务id','featureid','id'])
export function isAttributeIdHeader(header:string) {
  return idHeaders.has(header.trim().toLowerCase())
}

function headerValues(row:Row):string[] | undefined {
  const headers:string[] = []
  let count = 0
  let valid = true
  row.eachCell((cell, col) => {
    if (cell.isMerged && cell.master !== cell) return
    const value = cell.value
    if (value === null || value === '') return
    if (typeof value !== 'string' && !(typeof value === 'object' && 'richText' in value)) {
      valid = false
      return
    }
    const label = cell.text.trim()
    if (label) {
      headers[col - 1] = label
      count++
    }
  })
  // A merged title or a one-cell note above the table is common in ledgers.
  if (!valid || count < 2) return
  return Array.from(headers, value => value ?? '')
}

function readCell(cell:Cell, idColumn:boolean):SpatialAttributeCell {
  const value = cell.value
  if (value === null || value === undefined) return null
  if (cell.isMerged) throw Error(cell.address+' 是合并单元格，请拆开后逐行填写')
  if (typeof value === 'number') {
    if (idColumn && (!Number.isSafeInteger(value) || Math.abs(value) >= 1e15)) {
      throw Error(cell.address+' 的编号可能已被 Excel 舍入，请将编号列设为文本后重新填写原编号')
    }
    // Excel often stores a business code as a number with a zero-padded display format.
    if (/^0{2,}$/.test(cell.numFmt) && Number.isSafeInteger(value) && value >= 0 && value < 1e15) {
      const digits = String(value)
      if (cell.numFmt.length > digits.length) return digits.padStart(cell.numFmt.length,'0')
    }
    return value
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString().replace(/T00:00:00\.000Z$/, '')
  if ('richText' in value) return value.richText.map(part => part.text).join('')
  if ('hyperlink' in value) return value.text
  if ('formula' in value || 'sharedFormula' in value) throw Error(cell.address+' 含公式，请在 Excel 中复制并粘贴为值后导入')
  throw Error(cell.address+' 含 Excel 错误或无法读取的值，请更正后导入')
}

function readSheet(sheet:Worksheet, known:Set<string>):SpatialAttributeSheet | undefined {
  let fallback: {number:number; headers:string[]} | undefined
  let header: typeof fallback
  sheet.eachRow(row => {
    if (header) return
    const labels = headerValues(row)
    if (!labels) return
    const candidate = {number:row.number, headers:labels}
    fallback ??= candidate
    if (labels.some(label => isAttributeIdHeader(label) || known.has(label.toLowerCase()))) {
      header = candidate
    }
  })
  header ??= fallback
  if (!header) return
  const {number, headers} = header
  const result:SpatialAttributeSheet = {name:sheet.name, headers, rows:[]}
  const canonical = headers.findIndex(label => label.toLowerCase() === '实体业务id')
  const idColumn = canonical >= 0 ? canonical : headers.findIndex(isAttributeIdHeader)
  try {
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber <= number) return
      const values:SpatialAttributeCell[] = []
      row.eachCell((cell, col) => {
        const value = readCell(cell,col === idColumn + 1)
        if (value === null || value === '') return
        if (!headers[col - 1]) throw Error(cell.address+' 有数据，该列缺少表头')
        values[col - 1] = value
      })
      if (values.length) result.rows.push({rowNumber, values:Array.from(values, value => value ?? null)})
    })
  } catch (error) {
    // An invalid worksheet must not prevent choosing a different one in the same file.
    result.rows = []
    result.error = '工作表「'+sheet.name+'」'+(error instanceof Error ? error.message : '无法读取')
  }
  return result
}

export async function readSpatialAttributeWorkbook(file:File, knownHeaders:readonly string[] = []):Promise<SpatialAttributeSheet[]> {
  if (!/\.xlsx$/i.test(file.name)) throw Error('请选择 .xlsx 格式的 Excel 工作簿')
  if (file.size > localFileLimit) throw Error('文件超过 18 MiB，请按筛选结果分批导入')
  const bytes = await file.arrayBuffer()
  const [{default:Excel},{unzipSync}] = await Promise.all([import('exceljs'),import('fflate')])
  const book = new Excel.Workbook()
  let expandedSize = 0
  try {
    // Inspect the ZIP directory without inflating worksheet XML into browser memory.
    unzipSync(new Uint8Array(bytes), {filter:entry => {
      expandedSize += entry.originalSize
      return false
    }})
  } catch {
    throw Error('无法读取 Excel 工作簿，请检查文件是否损坏或设有打开密码')
  }
  if (expandedSize > localFileLimit * 4) throw Error('工作簿解压后超过 72 MiB，请按筛选结果分批导入')
  try {
    await book.xlsx.load(bytes)
  } catch {
    throw Error('无法读取 Excel 工作簿，请检查文件是否损坏或设有打开密码')
  }
  const known = new Set(knownHeaders.map(label => label.trim().toLowerCase()).filter(Boolean))
  const sheets = book.worksheets
    .filter(sheet => sheet.state === 'visible' && !/^(填表说明|填写说明|使用说明|readme|instructions)$/i.test(sheet.name))
    .map(sheet => readSheet(sheet,known))
    .filter((sheet):sheet is SpatialAttributeSheet => !!sheet)
  if (!sheets.length) throw Error('未找到属性表，请在同一行填写匹配字段和待更新字段的表头')
  if (sheets.every(sheet => sheet.error)) throw Error(sheets[0]!.error)
  return sheets
}
