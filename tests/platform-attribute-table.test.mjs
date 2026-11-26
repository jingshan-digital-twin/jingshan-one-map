import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import Excel from 'exceljs'
import { attributeWorkbook } from '../src/jingshan/platform-attribute-table.ts'
import { exportPopulationAttributes } from '../server/population-attribute-export.ts'
import { populationRaster, rasterPage, residentGridId } from '../src/jingshan/population-raster.ts'

const dataset={id:'places',name:'点位',department:'本地',category:'空间数据',description:''}
const base={name:'甲',kind:'place',region:'京山'}
const point=(id,properties)=>({type:'Feature',id,properties:{...base,...properties},geometry:{type:'Point',coordinates:[113.117,31.02]}})
test('属性表按资源完整字段导出所选行，样式、原始属性、编码和空值均可回读',async()=>{
  const first=point('01',{仅首行:7})
  const last=point('00012345678901234567',{数量:0,开放:false,原始编码:'0000123',备注:'=1+1',实体名称:'另存名称',
    sourceAttributes:{数量:14,嵌套:{值:0}},数组:['甲','乙']})
  const layer={...dataset,features:[first,last]}
  const book=await attributeWorkbook(layer,[last])
  const saved=new Excel.Workbook()
  await saved.xlsx.load(await book.xlsx.writeBuffer())
  const sheet=saved.getWorksheet('属性数据'), titles=sheet.getRow(1).values
  const cell=title=>sheet.getCell(2,titles.indexOf(title))
  assert.equal(sheet.rowCount,2)
  assert.equal(cell('实体业务ID').value,last.id)
  assert.equal(cell('仅首行').value,null)
  assert.equal(cell('数量').value,0)
  assert.equal(cell('数量 [原始属性.数量]').value,14)
  assert.equal(cell('嵌套').value,'{"值":0}')
  assert.equal(cell('实体名称').value,'甲')
  assert.equal(cell('实体名称 [实体名称]').value,'另存名称')
  assert.equal(cell('开放').value,'否')
  assert.equal(cell('原始编码').value,'0000123')
  assert.equal(cell('备注').type,Excel.ValueType.String)
  assert.equal(cell('备注').value,'=1+1')
  assert.equal(cell('数组').value,'["甲","乙"]')
  assert.equal(cell('经度').value,113.117)
  assert.equal(cell('纬度').numFmt,'0.0000000000_ ')
  assert.equal(sheet.getCell('A1').font.name,'宋体')
  assert.equal(sheet.getCell('A1').font.bold,true)
  assert.equal(sheet.getRow(1).height,30)
  assert.equal(sheet.getCell('A2').fill.fgColor.argb,'FFEDEDED')
  assert.equal(cell('仅首行').border.bottom.style,'thin')
  assert.equal(sheet.pageSetup.orientation,'landscape')
  assert.equal((await attributeWorkbook(layer,[])).worksheets[0].rowCount,1)
})

test('流式网格属性与后台筛选、像元次序、坐标和零人口一致',async(t)=>{
  const tile={type:'Feature',id:'grid-block',geometry:{type:'Polygon',coordinates:[[[113,31.02],[113,31],[113.02,31],[113.02,31.02],[113,31.02]]]},
    properties:{...base,kind:'population-raster-block',row:0,col:0,width:2,height:2,regions:['甲镇','乙镇'],cellSizeM:100,
      controls:[[113.01,31.02],[113.02,31.01],[113.01,31],[113,31.01],[113.01,31.01]],runs:[1,0,0,1,-1,1,1,23,1,1,4,0],validCells:3}}
  const layer={...dataset,id:residentGridId,features:[tile]}
  const grid=populationRaster(layer)
  const app=express()
  app.use(express.json())
  app.post('/export',exportPopulationAttributes)
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))})
  t.after(()=>new Promise(resolve=>server.close(resolve)))
  for (const query of ['','甲镇','无匹配']) {
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/export',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({dataset:layer,query})})
    assert.equal(response.status,200)
    const file=new Excel.Workbook()
    await file.xlsx.load(await response.arrayBuffer())
    const sheet=file.worksheets[0], expected=rasterPage(grid,1,10,query).rows
    assert.equal(sheet.rowCount,expected.length+1)
    for (const [i,feature] of expected.entries()) {
      const p=feature.properties
      assert.deepEqual(sheet.getRow(i+2).values.slice(1),[feature.id,p.name,p.kind,p.region,p.population,p.densityPerKm2,...p.center])
    }
    assert.equal(sheet.getRow(1).height,30)
  }
})
