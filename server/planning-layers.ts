import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Response } from 'express'
import { CimError } from './cim-error.ts'

type Metadata={count:number; maxZoom:number; bounds:[number,number,number,number]; name:string; roofs?:boolean}
type Archive={db:DatabaseSync; info:Metadata}
const cache=new Map<string,Archive>()
const tilePattern=/^\/api\/jingshan\/cim\/services\/js-planning-(urban|ecology|farmland)\/raster\/\{z\}\/\{x\}\/\{y\}\?edition=(\d{8}(?:-\d{2})?)$/
const transparent=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQMAAABmvDolAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAB9JREFUeJztwQENAAAAwqD3T20ON6AAAAAAAAAAAL4NIQAAAfFnIe4AAAAASUVORK5CYII=','base64')

export const isPlanningArchive=(url:string)=>tilePattern.test(url)
export function planningArchive(url:string):Archive {
  const cached=cache.get(url)
  if(cached)return cached
  const match=tilePattern.exec(url)
  if(!match)throw new CimError('未知的规划服务来源',404)
  const path=fileURLToPath(new URL('../.local/planning/'+match[2]+'/'+match[1]+'.sqlite',import.meta.url))
  let db:DatabaseSync|undefined
  try{
    db=new DatabaseSync(path,{readOnly:true})
    const row=db.prepare('select json from metadata').get()
    if(!row)throw Error('Missing layer metadata')
    const archive={db,info:JSON.parse(String(row.json)) as Metadata}
    cache.set(url,archive)
    return archive
  }catch{
    db?.close()
    throw new CimError('本机规划图层文件不可用',503,'offline')
  }
}
export function planningRecords(archive:Archive,page:number){
  const pageSize=10, start=(page-1)*pageSize
  const rows=archive.db.prepare('select feature from features order by fid limit ? offset ?').all(pageSize,start)
  const features=rows.map(row=>{
    const {id,properties}=JSON.parse(gunzipSync(row.feature as Uint8Array).toString())
    return {id,properties}
  })
  return {features,total:archive.info.count,page,pageSize,hasNext:start+features.length<archive.info.count}
}
export async function sendPlanningFeatures(archive:Archive,res:Response){
  function* chunks(){
    yield '{"type":"FeatureCollection","features":['
    let first=true
    for(const row of archive.db.prepare('select feature from features order by fid').iterate()){
      if(!first)yield ','
      first=false
      yield gunzipSync(row.feature as Uint8Array)
    }
    yield ']}'
  }
  res.type('application/geo+json')
  await pipeline(Readable.from(chunks()),res)
}
export function planningRoof(archive:Archive,district:string){
  if(!archive.info.roofs)throw new CimError('此版本未发布立体贴图',404)
  const q=archive.db.prepare('select bounds,png from roofs where district=?')
  const row=q.get(district)??q.get('京山市')
  if(!row)throw new CimError('缺少规划贴图',404)
  return {bounds:String(row.bounds),data:Buffer.from(row.png as Uint8Array)}
}
export function planningTile(archive:Archive,z:number,x:number,y:number){
  if(![z,x,y].every(Number.isSafeInteger) || z<0 || z>archive.info.maxZoom || x<0 || y<0 || x>=2**z || y>=2**z)
    throw new CimError('瓦片超出服务范围',400)
  const tile=archive.db.prepare('select png from tiles where z=? and x=? and y=?').get(z,x,y)
  return tile ? Buffer.from(tile.png as Uint8Array) : transparent
}
