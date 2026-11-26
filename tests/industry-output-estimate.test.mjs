import assert from 'node:assert/strict'
import test from 'node:test'
import { createCityOutputEstimateDataset } from '../server/industry-output-estimate.ts'
import { checkDataset } from '../src/jingshan/validate.ts'
import { chain } from '../src/jingshan/chain-taxonomy.ts'

test('京山市 2025 年估算仅含十二个环节，各阶段金额和显示占比可加回总数', () => {
  const dataset = createCityOutputEstimateDataset()
  checkDataset(dataset)
  assert.equal(dataset.features.length, 12)
  const stageAmounts = chain.map(({id, topics}) => {
    const rows = dataset.features.filter(row => row.properties.chainStage === id).map(row => row.properties)
    assert.deepEqual(rows.map(row => row.chainTopic), topics)
    assert.ok(rows.every(row => row.outputBasis === 'estimate' && row.region === '京山市' && row.year === 2025))
    const total = rows.reduce((sum, row) => sum + row.outputWanYuan, 0)
    assert.equal(rows.reduce((sum, row) => sum + Math.round(row.outputWanYuan / total * 1000), 0), 1000)
    return total
  })
  assert.deepEqual(stageAmounts, [49_500, 172_400, 128_100])
  assert.equal(stageAmounts.reduce((sum, amount) => sum + amount, 0), 350_000)
})
