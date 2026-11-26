import WKB from 'ol/format/WKB.js'
import GeoJSON from 'ol/format/GeoJSON.js'
import type { Database } from 'sql.js'

const supported = new Set(['Point','LineString','Polygon','MultiPolygon'])
const binary = new WKB()
const json = new GeoJSON()
const skippedNames = new Set(['__proto__','constructor','prototype'])

function geometry(blob:unknown, srs:number, epsg:number) {
  if (!(blob instanceof Uint8Array) || blob.length<13) throw new Error('几何为空或不完整')
  const view=new DataView(blob.buffer,blob.byteOffset,blob.byteLength)
  if(view.getUint16(0)!==0x4750 || blob[2]!==0) throw new Error('几何头不是标准 GeoPackageBinary')
  const flags=blob[3], envelope=(flags >> 1) & 7
  if(flags & 0xf0 || envelope>4) throw new Error('暂不支持空几何、扩展几何或未知的边界标志')
  if(view.getInt32(4,Boolean(flags&1))!==srs) throw new Error('几何坐标系与图层声明不一致')
  const offset=8+[0,32,48,48,64][envelope]
  if(offset+5>blob.byteLength) throw new Error('WKB 几何不完整')
  const wkb=blob.subarray(offset)
  if(wkb[0]!==0 && wkb[0]!==1) throw new Error('WKB 字节序无效')
  const type=new DataView(wkb.buffer,wkb.byteOffset,wkb.byteLength).getUint32(1,Boolean(wkb[0]))
  if(![1,2,3,6].includes(type)) throw new Error('支持二维点、线、面及多面，请先转换其他几何')
  const shape=binary.readGeometry(wkb,{dataProjection:'EPSG:'+epsg,featureProjection:'EPSG:4326'})
  if(!supported.has(shape.getType()))throw new Error('图层含不支持的几何类型')
  return json.writeGeometryObject(shape)
}

function ident(name:string) {
  if(!name || name.includes('\0'))throw new Error('要素表或字段名称无效')
  return '"'+name.replaceAll('"','""')+'"'
}

function physicalTable(db:Database,name:string) {
  const info=db.exec('SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?', ['table',name])
  const sql=info[0]?.values[0]?.[0]
  if(typeof sql!=='string' || !/^CREATE\s+TABLE\b/i.test(sql)) throw new Error('缺少标准数据表 '+name)
}

export function readFeaturePackage(db:Database, target:string) {
  db.run('PRAGMA trusted_schema=OFF')
  db.run('PRAGMA query_only=ON')
  const app=db.exec('PRAGMA application_id')[0]?.values[0]?.[0]
  if(app!==0x47504b47 && app!==0x47503130 && app!==0x47503131)throw new Error('文件未声明 GeoPackage 标识')
  for(const table of ['gpkg_contents','gpkg_geometry_columns','gpkg_spatial_ref_sys']) physicalTable(db,table)
  const featureTables=db.exec("SELECT table_name FROM gpkg_contents WHERE data_type = 'features' LIMIT 2")[0]?.values??[]
  if(featureTables.length!==1)throw new Error('请选择仅含一个矢量要素表的 GeoPackage')
  const table=String(featureTables[0][0]);physicalTable(db,table)
  const ref=db.exec('SELECT g.column_name,g.srs_id,s.organization,s.organization_coordsys_id FROM gpkg_geometry_columns g JOIN gpkg_spatial_ref_sys s ON s.srs_id=g.srs_id WHERE g.table_name=? LIMIT 2',[table])[0]?.values??[]
  if(ref.length!==1)throw new Error('要素表需声明一个几何字段及其坐标系')
  const [column,srs,authority,epsg]=ref[0]
  if(typeof column!=='string' || typeof srs!=='number' || String(authority).toUpperCase()!=='EPSG' || (epsg!==4326 && epsg!==3857))
    throw new Error('支持 EPSG:4326 和 EPSG:3857 的 GeoPackage，请将此图层重投影后导入')
  const fields=db.exec('SELECT name,pk FROM pragma_table_info(?)',[table])[0]?.values??[]
  const primary=fields.filter(f=>f[1]===1)
  if(primary.length!==1 || !fields.some(f=>f[0]===column))throw new Error('要素表缺少主键或几何列')
  if(fields.length>128)throw new Error('单个要素表最多支持 128 列')
  const attributes=fields.map(f=>String(f[0])).filter(k=>k!==column && !skippedNames.has(k))
  const select=['CAST('+ident(String(primary[0][0]))+' AS TEXT)',ident(column),...attributes.map(ident)].join(',')
  const stmt=db.prepare('SELECT '+select+' FROM '+ident(table)+' LIMIT 12001')
  const features=[]
  try {
    while(stmt.step()){
      if(features.length>=12000)throw new Error('单个图层最多支持 12,000 条要素')
      const [pk,blob,...values]=stmt.get()
      const name='要素 '+String(pk)
      try {
        if(values.some(v=>v instanceof Uint8Array))throw new Error('属性含二进制附件，请先移除该列')
        const properties=Object.fromEntries(attributes.map((key,i)=>[key,values[i]]))
        const id=(target ? target+'-' : '')+'gpkg-'+table+'-'+String(pk)
        if(id.length>150)throw new Error('表名和主键组合超出要素 ID 长度限制，请缩短源要素表名')
        features.push({type:'Feature',id,properties,geometry:geometry(blob,srs,epsg)})
      } catch(e){throw new Error(name+'：'+(e instanceof Error?e.message:'几何或属性无效'))}
    }
  } finally {stmt.free()}
  return {type:'FeatureCollection',name:table,features}
}

