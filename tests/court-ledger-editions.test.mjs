import assert from 'node:assert/strict'
import test from 'node:test'
import { activeCourtSource, courtLedgerId, courtMapSlot, withCourtLedger } from '../src/jingshan/court-ledger.ts'
import { withLocalDataset } from '../src/jingshan/platform-local-data.ts'
import { publicResourceData } from '../server/collected-resources.ts'
import { checkDocument } from '../src/jingshan/validate.ts'
import { importLedgerPolygons } from '../src/jingshan/court-shape-import.ts'
import { localFields } from '../src/jingshan/local-feature-fields.ts'
import { attributeFields } from '../src/jingshan/platform-attribute-table.ts'
import { planSpatialAttributeUpdate } from '../src/jingshan/spatial-attribute-update.ts'
import { prepareGeoImport } from '../src/jingshan/platform-local-data.ts'

const geometry={type:'Polygon',coordinates:[[[113,31],[113.01,31],[113.01,31.01],[113,31]]]}
function ledger(id,key,venue) {
  return {id,name:venue,department:'体育',category:'场地',description:'',features:[{type:'Feature',id:key,geometry,
    properties:{name:'一号场',kind:'court-footprint',region:'京山市','名称':'一号场','所属场馆':venue,'联系人':'管理字段','联系电话':'管理字段'}}]}
}
test('切换场地服务后，编辑旧台账不影响当前图层，同一边界的排期仍关联原场地编号',()=>{
  const old=ledger(courtLedgerId,'survey-1','原场馆')
  const editionId=courtLedgerId+'_1123', next=ledger(editionId,editionId+':survey-1','新场馆')
  const binding=id=>[{scope:'all',slot:courtMapSlot,serviceId:'hosted-'+id}]
  const initial=withCourtLedger({mode:'live',rules:{},mapBindings:binding(old.id),datasets:[old,next]})
  const active=withCourtLedger({...initial,mapBindings:binding(next.id)})
  checkDocument(active)
  const features=(doc,id)=>doc.datasets.find(d=>d.id===id).features
  assert.deepEqual(activeCourtSource(active),next)
  assert.equal(features(active,'courts')[0].id,features(initial,'courts')[0].id)
  assert.equal(features(active,'court_footprints')[0].id,features(initial,'court_footprints')[0].id)
  assert.equal(features(active,'courts')[0].properties.ledgerId,next.features[0].id)
  assert.equal(features(active,'venues')[0].properties.name,'新场馆')
  assert.deepEqual(features(active,old.id),old.features)
  const edited=withLocalDataset(active,{...old,features:[]})
  assert.deepEqual(features(edited,'courts'),features(active,'courts'))
  for (const id of [old.id,next.id]) {
    const p=features(publicResourceData(active),id)[0].properties
    assert.ok(!Object.hasOwn(p,'联系人') && !Object.hasOwn(p,'联系电话'))
  }
  const updated=withLocalDataset(active,{...next,features:[]})
  assert.equal(features(updated,'courts').length,0)
  assert.deepEqual(features(updated,old.id),old.features)
  const restored=withCourtLedger({...active,mapBindings:binding(old.id)})
  assert.deepEqual(features(restored,'courts'),features(initial,'courts'))
  assert.deepEqual(features(restored,next.id),next.features)
})

test('1124 源行和17个测绘列保持原样，业务图层继续使用原场地 ID，新片使用源 ID',()=>{
  const source=ledger('tennis1124','tennis1124-abc','新场馆')
  const survey={'实体业务ID':'court_footprints_ledger_1123:ledger-club-0','实体名称':'京彩1号场','所属行政区':'某路口',
    '所属场馆':'京彩网球俱乐部','权属':'民营或社会','协调日期类':'节假日','建设状态':'已建','是否可协调':'是',
    '场地形式':'室内球场','地面类型':'硬地','管理单位':'文旅局','运营单位':'京彩','开放方式':'全天开放','开放条件':'',
    '开放时段':'','可协调时段':'','协调限制':''}
  source.features[0].properties={...survey,name:'旧显示名',region:'京山市',kind:'tennis1124'}
  const importRow=properties=>({type:'Feature',geometry,properties})
  const first=importLedgerPolygons([],source,[importRow(survey)])[0]
  assert.equal(first.id,source.features[0].id)
  for(const [key,value] of Object.entries(survey)) assert.equal(first.properties[key],value)
  assert.equal(first.properties.name,survey['实体名称'])
  assert.equal(first.properties['名称'],undefined)
  assert.equal(first.properties['镇街或片区'],undefined)
  const second={...first,id:'tennis1124-def',properties:{...first.properties,'实体业务ID':''}}
  const doc=withCourtLedger({mode:'live',rules:{},datasets:[{...source,features:[first,second]}]})
  const views=id=>doc.datasets.find(d=>d.id===id).features
  assert.equal(activeCourtSource(doc).id,source.id)
  assert.equal(views('venues')[0].properties.count,2)
  assert.deepEqual(views('courts').map(f=>f.id),['court:ledger-club-0','court:tennis1124-def'])
  assert.deepEqual(views('court_footprints').map(f=>f.id),['boundary:ledger-club-0','boundary:tennis1124-def'])
  const p=views('courts')[0].properties
  assert.equal(p.ledgerId,first.id)
  assert.equal(p['名称'],survey['实体名称'])
  assert.equal(p['镇街或片区'],survey['所属行政区'])
  assert.equal(p['可协调日期类型'],survey['协调日期类'])
  const changed=structuredClone(geometry);changed.coordinates[0][1][0]+=0.00005
  assert.equal(importLedgerPolygons([],source,[{...importRow(survey),geometry:changed}])[0].id,first.id)
  const withoutId={...survey}; delete withoutId['实体业务ID']
  assert.equal(importLedgerPolygons([],source,[importRow(withoutId)])[0].properties['实体业务ID'],survey['实体业务ID'])
  assert.throws(()=>importLedgerPolygons([],source,[importRow(survey),{...importRow(survey),geometry:changed}]),/业务ID重复/)
  assert.throws(()=>importLedgerPolygons([],source,[importRow({...survey,'实体业务ID':'court_footprints_ledger_1123:wrong'})]),/不一致/)
})

test('1124 编辑器和 Excel 操作原台账字段，派生名称同步，空间镇街与台账区划独立',()=>{
  const source=ledger('tennis1124','tennis1124-abc','新场馆')
  const props=source.features[0].properties
  delete props['名称']
  Object.assign(props,{'实体名称':'一号场','所属行政区':'某路口','协调日期类':'周末','实体业务ID':'court_footprints_ledger_1123:old'})
  const fields=localFields(source).map(f=>f.key)
  assert.ok(['实体名称','所属行政区','协调日期类'].every(k=>fields.includes(k)))
  assert.ok(['名称','镇街或片区','可协调日期类型'].every(k=>!fields.includes(k)))
  const exported=attributeFields(source)
  assert.equal(exported.filter(field=>field.label.includes('名称') || field.label==='地图显示名').length,1)
  const read=label=>exported.find(f=>f.label===label).read(source.features[0])
  assert.equal(read('实体业务ID'),source.features[0].id)
  assert.equal(read('原台账业务ID'),props['实体业务ID'])
  assert.equal(read('地图所属镇街'),'京山市')
  assert.equal(read('所属行政区'),'某路口')
  const headers=['实体业务ID','实体名称','所属行政区','协调日期类']
  const change=planSpatialAttributeUpdate(source,{headers,rows:[{rowNumber:2,values:['tennis1124-abc','新1号场','新路口','工作日']}]})
  const edited=change.dataset.features[0]
  assert.equal(edited.properties.name,'新1号场')
  assert.equal(edited.properties['实体名称'],'新1号场')
  assert.equal(edited.properties.region,'京山市')
  const {datasets}=withCourtLedger({mode:'live',rules:{},datasets:[change.dataset]})
  const court=datasets.find(d=>d.id==='courts').features[0]
  assert.equal(court.id,'court:old')
  assert.equal(court.properties['镇街或片区'],'新路口')
  assert.equal(court.properties['可协调日期类型'],'工作日')
  const earlier=planSpatialAttributeUpdate(source,{headers:['实体业务ID','实体名称','所属行政区','实体名称 [实体名称]','所属行政区 [所属行政区]'],
    rows:[{rowNumber:2,values:[source.features[0].id,'原导入数据集 1','京山市','旧表中修订名称','台账区划']}]})
  assert.equal(earlier.dataset.features[0].properties.name,'旧表中修订名称')
  assert.equal(earlier.dataset.features[0].properties['所属行政区'],'台账区划')
  assert.equal(earlier.dataset.features[0].properties.region,props.region)
  const fc={type:'FeatureCollection',features:[{...source.features[0],properties:{...props,name:'旧地图名','实体名称':'直接读回的场地'}}]}
  const imported=prepareGeoImport({mode:'live',rules:{},datasets:[source]},source,fc,'replace')
  assert.equal(imported.first[0].properties.name,'直接读回的场地')
  assert.throws(()=>planSpatialAttributeUpdate(source,{headers:['实体业务ID','实体名称'],rows:[{rowNumber:2,values:[source.features[0].id,'']}]},{clearBlank:true}),/实体名称/)
})

test('新建普通空间数据集首次导入 SHP 时优先采用实体名称，其他格式和未填字段沿用原口径',()=>{
  const ds={...ledger('ordinary','row','场馆'),features:[]}
  const doc={mode:'live',rules:{},datasets:[ds]}
  const plan=(dbfEncodingUsed,properties)=>prepareGeoImport(doc,ds,{type:'FeatureCollection',dbfEncodingUsed,
    features:[{type:'Feature',geometry,properties}]},'append').first[0].properties.name
  assert.equal(plan('gbk',{'实体名称':'京彩1号场',name:'旧显示名'}),'京彩1号场')
  assert.equal(plan('gbk',{'实体名称':'  ',name:'现场名'}),'现场名')
  assert.equal(plan(undefined,{'实体名称':'对照列',name:'GeoJSON名称'}),'GeoJSON名称')
})
