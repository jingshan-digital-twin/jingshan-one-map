import assert from 'node:assert/strict'
import test from 'node:test'
import { fromLonLat } from 'ol/proj.js'
import { canReferenceDataset, createDatasetReference } from '../src/jingshan/editor-reference-datasets.ts'

const point = { id: 'p1', geometry: { type: 'Point', coordinates: [113.12, 31.03] } }
const unlocated = { id: 'p2', geometry: { type: 'GeometryCollection', geometries: [] } }
const dataset = { id: 'test_venues', features: [point, unlocated] }

test('only spatial datasets with located geometry can be reference layers', () => {
  assert.equal(canReferenceDataset(dataset), true)
  assert.equal(canReferenceDataset({ ...dataset, formSchema: { fields: [] } }), false)
  assert.equal(canReferenceDataset({ ...dataset, features: [unlocated] }), false)
  assert.equal(canReferenceDataset({ ...dataset, features: [{ geometry: { type: 'Polygon', coordinates: [[]] } }] }), false)
})

test('the reference projects a separate copy of each located geometry', async () => {
  const layer = await createDatasetReference(dataset, '#336699', new AbortController().signal)
  try {
    const source = layer.getSource()
    assert.deepEqual(source.getFeatures().map(feature => feature.getId()), [point.id])
    const geometry = source.getFeatureById(point.id).getGeometry()
    assert.deepEqual(geometry.getCoordinates(), fromLonLat(point.geometry.coordinates))
    geometry.setCoordinates([0, 0])
    assert.deepEqual(point.geometry.coordinates, [113.12, 31.03])
  } finally {
    layer.dispose()
  }
})
