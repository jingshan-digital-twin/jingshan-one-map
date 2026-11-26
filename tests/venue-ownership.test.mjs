import assert from 'node:assert/strict'
import test from 'node:test'
import { venueOwnershipGroup, venueOwnershipGroups } from '../src/jingshan/venue-ownership.ts'
import { sceneLegend } from '../src/jingshan/scene-map.ts'
import { venuePin } from '../src/jingshan/service-scene-map.ts'

test('五个分类按约定顺序显示简称，旧台账的权属仍可筛选', () => {
  assert.deepEqual(venueOwnershipGroups.map(group => group.shortLabel), ['国有', '学校', '机关', '民营', '村镇'])
  for (const group of venueOwnershipGroups) {
    for (const raw of [group.label, group.shortLabel, ...group.aliases]) {
      assert.equal(venueOwnershipGroup(raw), group)
    }
  }
  assert.equal(venueOwnershipGroup(' 社会 ')?.shortLabel, '民营')
  assert.equal(venueOwnershipGroup(' 村集体 ')?.shortLabel, '村镇')
  assert.equal(venueOwnershipGroup('权属不明'), undefined)
  assert.equal(venueOwnershipGroup(null), undefined)
})

test('场馆地图图例与筛选同序同色，选中场馆后保留原分类', () => {
  const pins = ['乡镇场馆', '社会', '机关单位', '学校场馆', '国有'].map((ownership, i) => venuePin({
    name: ownership, position: [113, 31],
    feature: { id: String(i), properties: { name: ownership, ownership, kind: 'venue' } },
  }, i === 0, 'ownership'))
  assert.notEqual(pins[0].properties.color, pins[0].properties.legendColor)
  assert.deepEqual(sceneLegend(pins).map(({label, color}) => [label, color]),
    venueOwnershipGroups.map(({shortLabel, color}) => [shortLabel, color]))
})
