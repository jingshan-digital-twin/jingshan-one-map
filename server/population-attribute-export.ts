import { setImmediate } from 'node:timers/promises'
import type { RequestHandler } from 'express'
import { addAttributeSheet, excelContentType } from '../src/jingshan/attribute-sheet.ts'
import { matchingRasterCells, populationCellAttributes, populationCellId, populationRaster, residentGridId } from '../src/jingshan/population-raster.ts'
import { checkDataset } from '../src/jingshan/validate.ts'
import { populationAttributeColumns } from '../src/jingshan/population-attribute-fields.ts'
const columns = [...populationAttributeColumns]

export const exportPopulationAttributes:RequestHandler = async (req,res) => {
  const {dataset,query='',ids}=req.body ?? {}
  let grid, included:Set<string>|undefined
  try {
    if (dataset?.id!==residentGridId || typeof query!=='string') throw Error('请选择人口网格数据集')
    if(ids!==undefined){
      if(!Array.isArray(ids) || !ids.every(id=>typeof id==='string'))throw Error('所选像元编号无效')
      included=new Set(ids)
    }
    checkDataset(dataset)
    grid=populationRaster(dataset)
    if (!grid) throw Error('人口网格分块无效')
  } catch (e) {
    res.status(400).json({error:e instanceof Error ? e.message : '人口网格格式无效'})
    return
  }
  const {default:Excel}=await import('exceljs')
  res.attachment('population-attributes.xlsx').type(excelContentType)
  const book=new Excel.stream.xlsx.WorkbookWriter({stream:res,useStyles:true,zip:{zlib:{level:1}}})
  let sheet=addAttributeSheet(book,'属性数据',columns), rowCount=0, sheetNumber=1
  for (const {block,index} of matchingRasterCells(grid,query)) {
    const id=populationCellId(block,index)
    if (included && !included.has(id)) continue
    if (rowCount===1048575) {
      sheet.commit()
      sheet=addAttributeSheet(book,'属性数据 '+(++sheetNumber),columns)
      rowCount=0
    }
    const cell=populationCellAttributes(block,index)
    sheet.addRow([id,cell.name,cell.kind,cell.region,cell.population,cell.densityPerKm2,...cell.center]).commit()
    if (++rowCount%512===0) {
      await setImmediate()
      if (res.destroyed) {sheet.commit(); return}
    }
  }
  sheet.commit()
  await book.commit()
}
