import test from 'node:test'
import assert from 'node:assert/strict'
import { checkDataset, checkDocument } from '../src/jingshan/validate.ts'
import { ledgerTemplates, ledgerEnterprises, ledgerRecordName, newLedgerFeature, outputBasisLabel, validateLedgerEdit } from '../src/jingshan/industry-ledgers.ts'
import { analyzeIndustryEconomy } from '../src/jingshan/industry-economy.ts'

function dataset(id, features) {
  return {id, name:id, department:'测试', category:'测试', description:'', features}
}
function record(id, fields = {}) {
  const feature = newLedgerFeature(id)
  Object.assign(feature.properties, {region:'京山市', name:'测试'}, fields)
  return feature
}
test('产值记录显示估算或实报，无口径的历史记录仍按实报读取', () => {
  const fields = {year:2025, outputWanYuan:100}
  const basis = newLedgerFeature('industry_output').properties.outputBasis
  assert.equal(basis, 'reported')
  for (const [value, label] of [[undefined,'实报'], ['reported','实报'], ['estimate','估算']]) {
    assert.equal(outputBasisLabel(value), label)
    validateLedgerEdit('industry_output', {...fields, outputBasis:value})
  }
  assert.equal(outputBasisLabel('unknown'), '待核对')
  assert.throws(() => validateLedgerEdit('industry_output', {...fields, outputBasis:'unknown'}), /产值口径/)
})
test('三类台账可通过服务端共用的文档校验，普通空间数据仍需定位', () => {
  const datasets = ledgerTemplates.map(({id}) => dataset(id, [record(id)]))
  assert.doesNotThrow(() => checkDocument({mode:'live',rules:{},datasets}))
  assert.throws(() => checkDataset(dataset('venues', [record('industry_output')])), /几何/)
  const withPoint = record('industry_output', {extra:'历史属性'})
  withPoint.geometry = {type:'Point', coordinates:[113, 31]}
  assert.doesNotThrow(() => checkDataset(dataset('industry_output',[withPoint])))
  const wrongGeometry = record('industry_output')
  wrongGeometry.geometry.geometries.push({type:'Point',coordinates:[113,31]})
  assert.throws(() => checkDataset(dataset('industry_output',[wrongGeometry])), /几何/)
})
test('新建记录的金额保持为空，采购默认待核；零元及历史合并环节均能保留', () => {
  const fresh = newLedgerFeature('industry_procurement')
  assert.equal(fresh.properties.verified, false)
  assert.equal(fresh.properties.amountYuan, undefined)
  const fields = {year:2025, outputWanYuan:0, chainStage:'中游', chainTopic:'培训健身'}
  validateLedgerEdit('industry_output',fields)
  assert.equal(ledgerRecordName(fields,'industry_output'), '2025 · 中游 · 培训健身')
  const report = analyzeIndustryEconomy([dataset('industry_output',[record('industry_output', fields)])], '京山市', 'live', 2025, 'scale')
  assert.equal(report.stages[1].nodes[1].combined, '培训健身')
  assert.equal(report.stages[1].nodes[1].current, null)
  assert.throws(() => validateLedgerEdit('industry_output',{...fields, outputWanYuan:''}), /金额/)
})
test('企业按实际名录 ID、环节和地区录入，未定位企业可选', () => {
  const business = {type:'Feature',id:'firm1',geometry:{type:'GeometryCollection',geometries:[]},
    properties:{name:'联调企业', kind:'business', region:'新市街道', chainTopics:['赛事组织']}}
  const choices = ledgerEnterprises([dataset('businesses',[business])])
  assert.deepEqual(choices.map(item => item.id), ['firm1'])
  const base = {year:2025, sourceStatus:'待核验', region:'新市街道', enterpriseId:'firm1', topic:'赛事组织', operating:false}
  validateLedgerEdit('industry_enterprise_annual', base, choices)
  validateLedgerEdit('industry_enterprise_annual', {...base, region:'京山市'}, choices)
  assert.throws(() => validateLedgerEdit('industry_enterprise_annual',{...base, region:'宋河镇'}, choices), /行政区/)
  assert.throws(() => validateLedgerEdit('industry_enterprise_annual',{...base, topic:'场地建设'}, choices), /环节/)
})
test('采购可暂缺金额和属地；已标注属地须识别供方、凭证日期与订单可核对', () => {
  const fields = {region:'京山市',purchasedAt:'2025-03-01',orderId:'TEST',buyer:'测试采购方',category:'球网',
    chainStage:'中游',chainTopic:'赛事组织',receipt:'TEST-1'}
  validateLedgerEdit('industry_procurement', fields)
  assert.throws(() => validateLedgerEdit('industry_procurement',{...fields, amountYuan:0.001}), /两位/)
  assert.throws(() => validateLedgerEdit('industry_procurement',{...fields, supplierLocality:'京山市外'}), /供应商/)
  assert.throws(() => validateLedgerEdit('industry_procurement',{...fields, purchasedAt:'2025-02-30'}), /日期/)
})
