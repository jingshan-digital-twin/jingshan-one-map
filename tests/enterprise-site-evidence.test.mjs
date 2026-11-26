import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { buildEnterpriseSiteEvidence } from '../src/jingshan/enterprise-site-evidence.ts'

function profile(file, name) {
  const data = JSON.parse(readFileSync(new URL('../server/industry-sources/' + file + '.json', import.meta.url), 'utf8'))
  return data.find(row => row.name === name)
}
const sites = properties => buildEnterpriseSiteEvidence({ feature: { properties } })

test('岗位公告与名录场所共同限定三个统筹运营点，可随来源或场所编辑撤回', () => {
  const company = profile('middle', '京山市网球产业发展有限公司')
  const results = sites(company)
  assert.deepEqual(results.map(s => s.name), company.siteNames)
  assert.ok(results.every(s => s.kind === 'business' && s.label === '统筹运营' && s.date === '2026-07-15'))
  assert.equal(sites({ ...company, sources: [] }).length, 0)
  assert.equal(sites({ ...company, siteNames: company.siteNames.slice(0, 1) }).length, 1)
  assert.equal(sites({ ...company, sample: true }).length, 0)
})

test('酒店邻近是文字证据，仅在公司项目备案和开业报道同时存在时展示', () => {
  const hotel = profile('downstream', '湖北众拓酒店管理有限公司')
  const [item] = sites(hotel)
  assert.equal(item.kind, 'spatial')
  assert.equal(item.label, '场地邻近')
  assert.equal(item.supportingSources.length, 1)
  assert.deepEqual(sites({ ...hotel, sources: hotel.sources.filter(s => s.url !== item.supportingSources[0].url) }), [])
  assert.deepEqual(sites({ ...hotel, name: '另一公司' }), [])
})

test('编辑档案来源可替换或撤回已有关系，新主体可通过相同的来源字段登记', () => {
  const company = profile('middle', '京山市网球产业发展有限公司')
  const [source] = company.sources
  assert.deepEqual(sites({ ...company, sources: [{ ...source, siteRelations: [] }] }), [])
  const record = { name: '示例场馆', category: '网球场馆', kind: 'business', label: '管理场地' }
  const changed = sites({ name: '另一个企业', sources: [{ ...source, siteRelations: [record, record] }] })
  assert.equal(changed.length, 1)
  assert.equal(changed[0].evidence, source.evidence)
  assert.equal(changed[0].receipt, source.title)
})
