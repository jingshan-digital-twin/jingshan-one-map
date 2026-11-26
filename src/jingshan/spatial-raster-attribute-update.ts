import { populationAttributeColumns } from './population-attribute-fields.ts'
import { populationCellId, populationRaster, rasterCellById, withPixelValues } from './population-raster.ts'
import { isAttributeIdHeader, type SpatialAttributeSheet } from './spatial-attribute-workbook.ts'
import type { SpatialAttributeOptions, SpatialAttributePlan } from './spatial-attribute-update.ts'
import type { Dataset } from './types.ts'

export function planRasterAttributeUpdate(dataset:Dataset, sheet:SpatialAttributeSheet, options:SpatialAttributeOptions={}):SpatialAttributePlan {
  const grid = populationRaster(dataset)
  if (!grid) throw Error('未找到人口栅格')
  const keys = sheet.headers.map((header,index) => {
    const name = header.trim()
    if (isAttributeIdHeader(name)) return 'id'
    const field = populationAttributeColumns.find(col => col.key === name || col.label === name)
    if (field) return field.key
    if (!name && sheet.rows.every(row => row.values[index] == null || row.values[index] === '')) return undefined
    throw Error('无法识别第 ' + (index+1) + ' 列「' + name + '」，请使用人口网格属性表的表头')
  })
  const used = keys.filter(key => key !== undefined)
  if (new Set(used).size !== used.length) throw Error('人口网格属性表存在重复列，请检查表头')
  const idColumn = keys.indexOf('id'), valueColumn = keys.indexOf('population')
  if (idColumn < 0 || valueColumn < 0) throw Error('人口网格需要「实体业务ID」和「格内人口（人）」两列')
  if (!sheet.rows.length) throw Error('工作表没有属性记录')
  const ignored = sheet.headers.filter((_,i) => keys[i] && i !== idColumn && i !== valueColumn)
  const changes = new Map<string,number>(), seen = new Set<string>()
  const samples:SpatialAttributePlan['samples'] = []
  const field = sheet.headers[valueColumn]
  for (const {rowNumber,values} of sheet.rows) {
    const id = String(values[idColumn] ?? '').trim(), prefix = '第 ' + rowNumber + ' 行'
    const hit = rasterCellById(grid,id)
    if (!hit || populationCellId(hit.block,hit.index) !== id) throw Error(prefix + '找不到人口网格「' + id + '」')
    if (seen.has(id)) throw Error(prefix + '的网格编号「' + id + '」重复')
    seen.add(id)
    const raw = values[valueColumn]
    if (raw == null || String(raw).trim() === '') {
      if (options.clearBlank) throw Error(prefix + '的格内人口不能为空，零人口请填 0')
      continue
    }
    const value = Number(raw)
    if (typeof raw === 'boolean' || !Number.isSafeInteger(value) || value < 0 || value > 2147483647 ||
        (typeof raw === 'string' && !/^\d+$/.test(raw.trim()))) throw Error(prefix + '的格内人口需为 0 到 2147483647 之间的整数')
    const before = hit.block.people[hit.index]
    if (before === value) continue
    changes.set(id,value)
    if (samples.length < 50) samples.push({row:rowNumber,id,field,before,after:value})
  }
  return {
    dataset:changes.size ? withPixelValues(dataset,changes) : dataset,
    matched:seen.size, updated:changes.size, unchanged:seen.size-changes.size,
    fields:changes.size ? [field] : [], changeCount:changes.size, samples, ignored,
  }
}
