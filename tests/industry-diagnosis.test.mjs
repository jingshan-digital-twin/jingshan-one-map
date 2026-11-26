import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chainDiagnosis } from '../src/jingshan/industry-panorama.ts'
import { diagnoseIndustryConversion } from '../src/jingshan/industry-conversion.ts'

test('规格覆盖率按匹配的需求计算，只有数量时保留未知', () => {
  function diagnose(demandSpecifications, supplySpecifications) {
    const properties = { region: '京山市', stage: '上游', topic: '器材制造', demandSpecifications, supplySpecifications }
    return chainDiagnosis([{ id: 'industry_diagnostics', features: [{ properties }] }], '上游', '器材制造', false)
  }
  assert.equal(diagnose(['球拍', '球线', '球线'], ['球拍', '网球']).coverage, 50)
  assert.equal(diagnose(['球拍'], ['球线']).coverage, 0)
  assert.equal(diagnose([], []).coverage, undefined)
  assert.equal(diagnose(2, 2).coverage, undefined)
})

test('赛事承接使用同份回报的分子分母，保留真实零值并排除模拟核验', () => {
  const event = {
    id: 'open', properties: { name: '公开赛', region: '新市街道', status: '已办结', date: '2024-09-01',
      endDate: '2024-09-03', attendance: 100, overnightGuests: 20 },
  }
  const confirmed = { region: '新市街道', eventId: 'open', confirmedAt: '2024-09-04', sourceStatus: '已核验' }
  function summary(fields) {
    return diagnoseIndustryConversion([
      { id: 'events', features: [event] },
      { id: 'event_actuals', features: [{ properties: { ...confirmed, ...fields } }] },
    ], [], '京山市', 'live', '住宿接待').summary
  }
  assert.match(summary({ attendance: 80, overnightGuests: 20 }), /25\.0%/)
  assert.doesNotMatch(summary({ attendance: 80 }), /%/)
  assert.match(summary({ attendance: 80, overnightGuests: 0 }), /过夜 0 人/)
  assert.match(summary({ attendance: 80, overnightGuests: 40, sample: true }), /20\.0%/)
})
