import {readFile} from 'node:fs/promises'
import pg from 'pg'
import polygonClipping from 'polygon-clipping'
import {publishWorkspace} from '../server/platform-publication.ts'
import {registerHostedLayer} from '../server/hosted-layers.ts'
import {planningArchive} from '../server/planning-layers.ts'
import {defaultRasterConfig} from '../src/jingshan/cim-types.ts'
import {controlLayers,controlServiceId,geometryStamp,reserveColor,reserveLayerId,surveyReferenceLayerId} from '../src/jingshan/investment-planning.ts'
import {createFacilityBoundaryIndex} from '../src/jingshan/facility-boundaries.ts'

const edition=process.argv[2]
if(!/^\d{8}(?:-\d{2})?$/.test(edition??''))throw Error('请传入已准备的八位日期版本')
const dir=new URL('../.local/planning/'+edition+'/',import.meta.url)
const json=async name=>JSON.parse(await readFile(new URL(name,dir),'utf8'))
const [manifest,screened]=await Promise.all([json('manifest.json'),json('reserves.json')])
const controlEdition=manifest.controlEdition??edition
if(!/^\d{8}(?:-\d{2})?$/.test(controlEdition))throw Error('控制图层版本无效')
if(screened.length!==manifest.eligible)throw Error('候选清单数量不匹配')
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL})
const db=await pool.connect()
try{
  await db.query('BEGIN')
  const {rows:[row]}=await db.query('select draft,revision,version,draft=published as clean from jingshan_workspace where id for update')
  if(!row?.clean)throw Error('后台有独立草稿，请先处理该修订，避免一起发布。')
  const layers=row.draft.datasets
  const featureList=id=>layers.find(d=>d.id===id)?.features??[]
  const boundaries=createFacilityBoundaryIndex(featureList('administration'),featureList('communities'))
  const towns=featureList('administration').filter(f=>f.properties.kind==='town-boundary')
  const townMasks=towns.map(f=>f.geometry.coordinates)
  if(!townMasks.length)throw Error('缺少业务镇街边界')
  for(const feature of screened){
    const p=feature.properties, {town,village}=boundaries.locate(p.center)
    p.inBusinessArea=!!town && (polygonClipping.difference(feature.geometry.coordinates,town.geometry.coordinates).length===0 || polygonClipping.difference(feature.geometry.coordinates,...townMasks).length===0)
    p.region=town?.properties.name??village?.properties.region??p.surveyTown??'调查归属待核实'
    p.screeningStatus=p.inBusinessArea?'拟储备·待核实':'业务范围外·备查'
    p.color=p.inBusinessArea?reserveColor:'#a8bbd0'
    p.screenedBoundary=geometryStamp(feature)
    p.screeningEdition=edition
  }
  const current=screened.filter(f=>f.properties.inBusinessArea || f.properties.landUseCode==='1201')
  const dataset={id:reserveLayerId,name:'项目拟储备地块',category:'招商选址',department:'自然资源和规划局',
    description:'京山业务镇街内的 2022 年国土变更调查图斑，避让生态保护红线和永久基本农田。逐块记录城镇开发边界内、跨界或界外关系，供招商初选和规划核实。',features:[]}
  const reference={id:surveyReferenceLayerId,name:'国土调查备查图斑',category:'调查来源',department:'自然资源和规划局',
    description:'保留选址筛查时识别的业务范围外空闲地及待复核的历史调查记录，供核对来源。',features:[]}
  for(const [order,{key,name}] of controlLayers.entries()){
    const id=controlServiceId(key), url='/api/jingshan/cim/services/'+id+'/raster/{z}/{x}/{y}?edition='+controlEdition
    const archive=planningArchive(url), meta=manifest.layers[key]
    const missingRoof=meta.roofs && (!archive.info.roofs || !archive.db.prepare('select 1 from roofs where district=?').get('京山市'))
    if(archive.info.count!==meta.count || !archive.db.prepare('select 1 from tiles limit 1').get() || missingRoof)throw Error(name+' 未完成转换')
    const desc=meta.filename+' · '+meta.crs+' · '+meta.count+' 个原始面。智能招商选址控制图层，可查询原始属性。'
    await db.query(`insert into jingshan_cim_services(id,name,category,kind,url,description,enabled,default_visible,sort_order,status,status_message,checked_at,raster)
      values($1,$2,'三区三线','xyz',$3,$4,true,false,$5,'online',$6,now(),$7)
      on conflict(id) do update set url=excluded.url,name=excluded.name,description=excluded.description,raster=excluded.raster,
        enabled=true,deleted=false,status='online',status_message=excluded.status_message,checked_at=now(),revision=jingshan_cim_services.revision+1
      where jingshan_cim_services.url<>excluded.url or jingshan_cim_services.deleted or not jingshan_cim_services.enabled`,
      [id,name,url,desc,150+order,'已发布 '+meta.count+' 个控制面',JSON.stringify({...defaultRasterConfig,maxLevel:meta.maxZoom})])
  }
  const original=new Map([...featureList(reserveLayerId),...featureList(surveyReferenceLayerId)].map(f=>[f.id,f]))
  for(const f of current){
    const old=original.get(f.id)
    let record=f
    if(old){
      if(geometryStamp(old)!==f.properties.screenedBoundary || old.properties.sourceFid!==f.properties.sourceFid)throw Error('调查边界已有独立编辑，请核对图斑 '+f.id)
      record={...old,properties:{...f.properties,...old.properties,region:f.properties.region,color:f.properties.color,
        landUse:f.properties.landUse,landUseCode:f.properties.landUseCode,screened:true,inBusinessArea:f.properties.inBusinessArea,
        urbanRelation:f.properties.urbanRelation,urbanInsidePercent:f.properties.urbanInsidePercent,
        ecologyIntersects:f.properties.ecologyIntersects,farmlandIntersects:f.properties.farmlandIntersects,
        screenedBoundary:f.properties.screenedBoundary,screeningStatus:f.properties.screeningStatus,screeningEdition:edition}}
      original.delete(f.id)
    }
    const target=record.properties.inBusinessArea ? dataset : reference
    target.features.push(record)
  }
  for(const old of original.values())reference.features.push({...old,properties:{...old.properties,screened:false,screeningStatus:'待重新筛查'}})
  const replacements=[dataset,reference]
  const same=(await db.query("select count(*)=jsonb_array_length($1::jsonb) as same from jingshan_workspace, lateral jsonb_array_elements(draft->'datasets') old join jsonb_array_elements($1::jsonb) updated on old=updated where id",[JSON.stringify(replacements)])).rows[0].same
  let version=row.version
  if(!same){
    const updated=layers.map(d=>replacements.find(r=>r.id===d.id)??d)
    updated.push(...replacements.filter(r=>!layers.some(d=>d.id===r.id)))
    const {rows:[next]}=await db.query("update jingshan_workspace set draft=jsonb_set(draft,'{datasets}',$1::jsonb), revision=revision+1,updated_at=now() where id and revision=$2 returning revision",[JSON.stringify(updated),row.revision])
    version=(await publishWorkspace(db,next.revision)).version
  }
  const hosted=await registerHostedLayer(db,dataset)
  await db.query('update jingshan_cim_services set description=$2,revision=revision+1 where id=$1 and description is distinct from $2',[hosted,dataset.description])
  await db.query('COMMIT')
  console.log(JSON.stringify({version,edition,layers:controlLayers.map(({key})=>[key,manifest.layers[key].count]),eligible:dataset.features.length,reference:reference.features.length}))
}catch(error){await db.query('ROLLBACK');throw error}
finally{db.release();await pool.end()}
