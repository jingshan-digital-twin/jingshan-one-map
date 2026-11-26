import assert from 'node:assert/strict'
import test from 'node:test'
import initSqlJs from 'sql.js'
import { readFeaturePackage } from '../src/jingshan/platform-geopackage.ts'
import { prepareGeoImport } from '../src/jingshan/platform-local-data.ts'

const SQL=await initSqlJs()
function fixture(srs,x,y) {
  const db=new SQL.Database(), bytes=new Uint8Array(29), view=new DataView(bytes.buffer)
  bytes.set([71,80,0,1]);view.setInt32(4,srs,true)
  bytes[8]=1;view.setUint32(9,1,true);view.setFloat64(13,x,true);view.setFloat64(21,y,true)
  db.run(`PRAGMA application_id=1196444487;
    CREATE TABLE gpkg_contents(table_name TEXT PRIMARY KEY,data_type TEXT,srs_id INTEGER);
    CREATE TABLE gpkg_geometry_columns(table_name TEXT,column_name TEXT,geometry_type_name TEXT,srs_id INTEGER,z TINYINT,m TINYINT);
    CREATE TABLE gpkg_spatial_ref_sys(srs_id INTEGER PRIMARY KEY, organization TEXT, organization_coordsys_id INTEGER);
    CREATE TABLE "场馆" (fid INTEGER PRIMARY KEY,name TEXT,geom BLOB)`)
  db.run("INSERT INTO gpkg_contents VALUES ('场馆','features',?)",[srs])
  db.run("INSERT INTO gpkg_geometry_columns VALUES ('场馆','geom','POINT',?,0,0)",[srs])
  db.run("INSERT INTO gpkg_spatial_ref_sys VALUES (?,'EPSG',?)",[srs,srs])
  db.run("INSERT INTO 场馆 VALUES (1,'地理样本',?)",[bytes])
  return db
}
test('GeoPackage 与现有空间草稿同口径，识别 WGS84 及 Web Mercator 并保留 ID 和属性',()=>{
  const lon=113.154423,lat=31.012923
  const meters=[lon*Math.PI/180*6378137,Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))*6378137]
  const target={id:'local_courts',name:'地图测试',category:'球场',department:'文旅局',description:'',features:[]}
  for(const [srs,x,y] of [[4326,lon,lat],[3857,...meters]]) {
    const db=fixture(srs,x,y)
    try{
      const collection=readFeaturePackage(db,target.id)
      const plan=prepareGeoImport({datasets:[target],rules:{},mode:'live'},target,collection,'merge')
      assert.equal(plan.added,1);assert.equal(plan.first[0].id,'local_courts-gpkg-场馆-1')
      assert.equal(plan.first[0].properties.name,'地理样本')
      const [lng,latitude]=plan.first[0].geometry.coordinates
      assert.ok(Math.abs(lng-lon)<0.0000001);assert.ok(Math.abs(latitude-lat)<0.0000001)
    }finally{db.close()}
  }
})
test('GeoPackage 对未知投影、多要素表和非标准几何拒绝导入',()=>{
  let db=fixture(4547,111,32)
  try{assert.throws(()=>readFeaturePackage(db,'test'),/重投影/)}finally{db.close()}
  db=fixture(4326,111,32)
  try{
    db.run("INSERT INTO gpkg_contents VALUES ('第二层','features',4326)")
    assert.throws(()=>readFeaturePackage(db,'test'),/一个矢量/)
  }finally{db.close()}
  db=fixture(4326,111,32)
  try{
    db.run('UPDATE 场馆 SET geom = zeroblob(32)')
    assert.throws(()=>readFeaturePackage(db,'test'),/几何头/)
  }finally{db.close()}
})

