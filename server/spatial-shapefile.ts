import type { RequestHandler } from 'express'
import { zipSync, strToU8 } from 'fflate'
import { checkDataset } from '../src/jingshan/validate.ts'
import type { Dataset } from '../src/jingshan/types.ts'
import { isPopulationRaster } from '../src/jingshan/population-raster.ts'

const wgs84='GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'
function hasElevation(coordinates:unknown):boolean {
  if(!Array.isArray(coordinates) || !coordinates.length)return false
  return typeof coordinates[0]==='number' ? coordinates.length>2 : coordinates.some(hasElevation)
}
export async function exportShapefile(dataset:Dataset){
  if(isPopulationRaster(dataset))throw Error('栅格请导出 GeoTIFF 或网格 GeoJSON。')
  if(!dataset.features.length)throw Error('当前没有可导出的记录。')
  const {default:mapshaper}=await import('mapshaper')
  const keys=new Set<string>(),originalKeys=new Set<string>()
  for(const {properties} of dataset.features)for(const [key,value] of Object.entries(properties)){
    if(key==='sourceAttributes' && value!==null && typeof value==='object' && !Array.isArray(value)){
      for(const rawKey of Object.keys(value))originalKeys.add(rawKey)
    }else keys.add(key)
  }
  const columns=[...Array.from(keys,key=>({key,original:false})),...Array.from(originalKeys,key=>({key,original:true}))]
  const native=/^[a-zA-Z][a-zA-Z0-9_]{0,9}$/
  const reserved=new Set(columns.map(c=>c.key).filter(k=>native.test(k)).map(k=>k.toUpperCase())),usedNames=new Set(['SOURCE_ID'])
  let serial=0
  const aliases=columns.map(({key,original})=>{
    let dbf=key
    if(!native.test(dbf) || usedNames.has(dbf.toUpperCase())){
      do{dbf='F'+String(++serial).padStart(5,'0')}while(reserved.has(dbf)||usedNames.has(dbf))
    }
    usedNames.add(dbf.toUpperCase());return {key,dbf,original}
  })
  const groups=new Map<string,Dataset['features']>()
  for(const f of dataset.features){
    const type=f.geometry.type.replace(/^Multi/,'')
    const group=type==='GeometryCollection'?'unlocated':type
    if(!groups.has(group))groups.set(group,[])
    groups.get(group)!.push(f)
  }
  const files:Record<string,Uint8Array>={}
  const originals=dataset.features.map(f=>({id:f.id,geometryType:f.geometry.type,properties:f.properties}))
  const elevated=dataset.features.filter(f=>'coordinates' in f.geometry && hasElevation(f.geometry.coordinates))
  if(elevated.length)files['geometry-z.geojson']=strToU8(JSON.stringify({type:'FeatureCollection',features:elevated.map(f=>({type:'Feature',id:f.id,geometry:f.geometry,properties:{}}))}))
  files['fields.json']=strToU8(JSON.stringify({format:'jingshan-spatial/v1',crs:'EPSG:4326',id:'SOURCE_ID',fields:aliases},null,2))
  files['attributes.json']=strToU8(JSON.stringify(originals))
  for(const [group,rows] of groups){
    const features=rows.map(f=>{
      const properties:Record<string,string|number|boolean|null>={SOURCE_ID:f.id}
      // Keep frequently used attributes in DBF. The UTF-8 sidecars preserve every original key and value.
      for(const {key,dbf,original} of aliases.slice(0,250)){
        const record=original?f.properties.sourceAttributes as Record<string,unknown>|undefined:f.properties
        const v=record?.[key]
        properties[dbf]=v==null?null:typeof v==='object'?JSON.stringify(v):typeof v==='number'||typeof v==='boolean'?v:String(v)
      }
      return {type:'Feature',geometry:group==='unlocated'?null:f.geometry,properties}
    })
    const output=await mapshaper.applyCommands('-i input.geojson no-topology -o '+(group==='unlocated'?'output.dbf format=dbf':'output.shp format=shapefile')+' encoding=utf8',
      {'input.geojson':JSON.stringify({type:'FeatureCollection',features})})
    for(const [name,data] of Object.entries(output)){
      const ext=name.slice(name.lastIndexOf('.'))
      files[group+ext]=typeof data==='string'?strToU8(data):new Uint8Array(data as Uint8Array)
    }
    files[group+'.cpg']=strToU8('UTF-8')
    if(group!=='unlocated')files[group+'.prj']=strToU8(wgs84)
  }
  return Buffer.from(zipSync(files,{level:3}))
}
export const sendShapefile:RequestHandler=async(req,res)=>{
  try{
    const dataset=req.body?.dataset
    checkDataset(dataset)
    const bytes=await exportShapefile(dataset)
    res.type('application/zip').attachment(dataset.id+'.zip').send(bytes)
  }catch(e){res.status(400).json({error:e instanceof Error?e.message:'SHP 导出失败'})}
}
