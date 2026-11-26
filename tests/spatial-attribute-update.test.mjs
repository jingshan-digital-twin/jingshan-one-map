import assert from 'node:assert/strict'
import test from 'node:test'
import { attributeWorkbook } from '../src/jingshan/platform-attribute-table.ts'
import { planSpatialAttributeUpdate, spatialMatchColumns } from '../src/jingshan/spatial-attribute-update.ts'
import { readSpatialAttributeWorkbook } from '../src/jingshan/spatial-attribute-workbook.ts'
import { courtViews } from '../src/jingshan/court-ledger.ts'

const layer=(features,id='places')=>({id,name:'设施',description:'',department:'本地',category:'空间数据',features})
const point=(id,attrs={})=>({type:'Feature',id,properties:{name:'设施'+id,kind:'place',region:'京山',...attrs},
  bbox:[113,31,113,31],geometry:{type:'Point',coordinates:[113,31]}})
const sheet=(headers,...rows)=>({name:'属性数据',headers,rows:rows.map((values,i)=>({rowNumber:4+i,values}))})

test('现有导出表全量回读后，以实体业务ID更新筛选行、冲突字段、原始属性和类型',async()=>{
  const first=point('001',{id:'外部001',数量:0,开放:false,其他:{省:'湖北'},原始编码:'000001',sourceAttributes:{数量:99,资料:['甲']}})
  const second=point('002',{数量:3,开放:true,其他:{省:'云南'},备注:'留存',sourceAttributes:{数量:3,资料:['乙']}})
  const original=layer([first,second])
  const book=await attributeWorkbook(original,[first])
  const [table]=await readSpatialAttributeWorkbook(new File([await book.xlsx.writeBuffer()],'设施.xlsx'))
  assert.equal(planSpatialAttributeUpdate(original,table).dataset,original)
  const row=table.rows[0]
  const set=(field,value)=>{const i=table.headers.indexOf(field); assert.ok(i>=0,field); row.values[i]=value}
  set('实体名称','甲设施')
  set('数量','12')
  set('开放','是')
  set('数量 [原始属性.数量]',45)
  set('资料','["甲","乙"]')
  set('其他','{"省":"湖北","市":"京山"}')
  set('原始编码','000002')
  set('id','外部002')
  set('经度',114)
  const plan=planSpatialAttributeUpdate(original,table)
  assert.equal(plan.updated,1)
  assert.equal(plan.matched,1)
  assert.equal(plan.unchanged,0)
  assert.equal(plan.changeCount,8)
  assert.deepEqual(plan.ignored,['经度','纬度'])
  const [next,untouched]=plan.dataset.features
  assert.equal(untouched,second)
  assert.equal(next.id,'001')
  assert.equal(next.geometry,first.geometry)
  assert.equal(next.bbox,first.bbox)
  assert.deepEqual(next.properties,{...first.properties,id:'外部002',name:'甲设施',数量:12,开放:true,原始编码:'000002',
    其他:{省:'湖北',市:'京山'},sourceAttributes:{数量:45,资料:['甲','乙']}})
  assert.deepEqual(first.properties.sourceAttributes,{数量:99,资料:['甲']})
})

test('缺少、歧义或重复匹配值及错误字段均按整表拒绝',()=>{
  const original=layer([point('001',{code:'A',open:true,count:1,同名:'重复'}),point('002',{code:'B',同名:'重复'})])
  const update=(table,options)=>planSpatialAttributeUpdate(original,table,options)
  assert.throws(()=>update(sheet(['编号','数量'],['A',2])),/选择.*匹配/)
  assert.deepEqual(spatialMatchColumns(original,['编号','经度','自定义列']),['编号'])
  const plan=update(sheet(['code','数量'],['B','23']),{matchColumn:'code'})
  assert.equal(plan.dataset.features[1].properties.count,23)
  assert.equal(plan.samples[0].row,4)
  assert.equal(original.features[1].properties.count,undefined)
  assert.throws(()=>update(sheet(['同名','数量'],['重复',2]),{matchColumn:'同名'}),/对应多条要素/)
  assert.throws(()=>update(sheet(['ID','数量'],['001',2],['001',3])),/第 5 行.*第 4 行重复/)
  assert.throws(()=>update(sheet(['ID','数量'],['001',2],['003',9])),/第 5 行.*003.*没有匹配/)
  assert.throws(()=>update(sheet(['ID','数量'],['',2])),/第 4 行.*缺少匹配值/)
  assert.throws(()=>update(sheet(['ID','数量','count'],['001',3,3])),/重复匹配/)
  assert.throws(()=>update(sheet(['ID','计数数'],['001',2])),/无法识别.*计数数/)
  assert.throws(()=>update(sheet(['ID','数量'],['001','十']),{}),/第 4 行.*数量.*数值/)
  assert.throws(()=>update(sheet(['ID','对外开放'],['001','开业']),{}),/第 4 行.*对外开放.*否/)
  assert.equal(original.features[0].properties.count,1)
})

test('缺失行、缺失列、空单元格和显式清空的范围独立',()=>{
  const one=point('01',{备注:'旧',另存:'留存',sourceAttributes:{编码:'0002'}}), two=point('02',{备注:'不动'})
  const original=layer([one,two]), table=sheet(['要素编号','备注','编码'],['01',null,'0003'])
  const kept=planSpatialAttributeUpdate(original,table)
  assert.equal(kept.dataset.features[0].properties.备注,'旧')
  const cleared=planSpatialAttributeUpdate(original,table,{clearBlank:true})
  const props=cleared.dataset.features[0].properties
  assert.ok(!Object.hasOwn(props,'备注'))
  assert.equal(props.另存,'留存')
  assert.equal(props.sourceAttributes.编码,'0003')
  assert.equal(cleared.dataset.features[1],two)
  assert.throws(()=>planSpatialAttributeUpdate(original,sheet(['要素编号','实体名称'],['01',null]),{clearBlank:true}),/实体名称.*必填/)
})

test('自选业务编号拒绝 Excel 已舍入的长数字，文本编号可以精确匹配',()=>{
  const original=layer([point('A',{code:'1234567890123450'}),point('B',{code:'1234567890123451'})])
  const update=key=>planSpatialAttributeUpdate(original,sheet(['编号','实体名称'],[key,'修改后']),{matchColumn:'编号'})
  assert.throws(()=>update(1234567890123450),/第 4 行.*编号.*舍入.*文本/)
  const result=update('1234567890123451')
  assert.equal(result.dataset.features[0],original.features[0])
  assert.equal(result.dataset.features[1].properties.name,'修改后')
})

test('按真实网球台账字段更新名称和开放信息后，派生场馆场地沿用源几何',()=>{
  const ring=[[113,31],[113.01,31],[113.01,31.01],[113,31]]
  const record={...point('survey-01',{name:'实测网球场',名称:'实测网球场',所属场馆:'京山球馆',建设状态:'已建',开放方式:'不开放'}),
    geometry:{type:'Polygon',coordinates:[ring]}}
  const original=layer([record],'court_footprints_ledger_1123')
  const updated=planSpatialAttributeUpdate(original,sheet(['实体业务ID','名称','开放方式','是否可协调'],['survey-01','1号场','全天开放','是']))
  const next=updated.dataset.features[0]
  assert.equal(next.properties.name,'1号场')
  assert.equal(next.properties.是否可协调,'是')
  assert.equal(next.geometry,record.geometry)
  const court=courtViews(updated.dataset).find(ds=>ds.id==='courts').features[0]
  assert.equal(court.properties.name,'1号场')
  assert.equal(court.properties.open,true)
  assert.equal(court.properties.facilityName,'京山球馆')
  assert.throws(()=>planSpatialAttributeUpdate(original,sheet(['实体业务ID','名称','实体名称'],['survey-01','甲','乙'])),/名称.*不一致/)
})
