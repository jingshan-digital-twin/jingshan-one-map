import assert from 'node:assert/strict'
import test from 'node:test'
import {retireDemoCourts} from '../server/retire-demo-courts.ts'

test('清退原封不动的演示逐片场地，保留人工修改、排期和其他台账', async () => {
  const rows = Array.from({length:4},(_,i)=>({id:'retired-'+i,type:'Feature',properties:{sample:true},geometry:{type:'Polygon',coordinates:[[[i,1],[i,2],[i+1,1],[i,1]]]}}))
  const seeds = new Map(rows.map(row=>[row.id,[structuredClone(row)]]))
  rows[1].properties.operator = '更新后的权属单位'
  rows[3].geometry = {...rows[3].geometry, coordinates: rows[0].geometry.coordinates}
  const real = {...rows[0], id: 'maintained-court', properties: {...rows[0].properties, sample: false}}
  const reference = {id:'venues', features:[]}
  const other = {id:'court_footprints', features:[real]}
  const data = {datasets:[{id:'courts', features:[...rows,real]}, reference, other]}
  const cleanup = value => retireDemoCourts(value, seeds, new Set([rows[2].id]))
  const updated = cleanup(data)
  assert.deepEqual(updated.datasets[0].features.map(f=>f.id), [rows[1],rows[2],rows[3],real].map(f=>f.id))
  assert.equal(updated.datasets[1], reference)
  assert.equal(updated.datasets[2], other)
  assert.equal(data.datasets[0].features.length, 5)
  assert.equal(cleanup(updated), updated)
  const noSurvey = {datasets:data.datasets.slice(0,2)}
  assert.equal(cleanup(noSurvey), noSurvey)
})
