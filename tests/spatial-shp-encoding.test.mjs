import test from 'node:test'
import assert from 'node:assert/strict'
import mapshaper from 'mapshaper'
import { zipSync } from 'fflate'
import { readSpatialFile } from '../src/jingshan/platform-spatial-import.ts'
import { prepareGeoImport } from '../src/jingshan/platform-local-data.ts'
import { publishSourceDocument } from '../server/publish-spatial-source.ts'

const coordinates = [113.1, 31.1]
const attributes = { 名称: '京山网球中心', 行政区: '新市街道', COUNT: 12 }

// Generate an ordinary GIS shapefile, without the platform exporter's UTF-8 JSON sidecars.
async function shapefile({ encoding, cpg, ldid = 0, rows = [attributes] }) {
  const features = rows.map(properties => ({
    type: 'Feature', properties, geometry: { type: 'Point', coordinates },
  }))
  const output = await mapshaper.applyCommands('-i input.geojson -o points.shp format=shapefile encoding=' + encoding, {
    'input.geojson': JSON.stringify({ type: 'FeatureCollection', features }),
  })
  const files = {}
  for (const ext of ['shp', 'shx', 'dbf']) {
    const bytes = new Uint8Array(output['points.' + ext])
    if (ext === 'dbf') bytes[29] = ldid
    files['京山/场馆.' + ext.toUpperCase()] = bytes
  }
  if (cpg !== undefined) files['京山/场馆.cpG'] = new TextEncoder().encode(cpg)
  return new File([zipSync(files)], '京山场馆.zip')
}

for (const [label, options, target = ''] of [
  ['ArcGIS 936 声明优先于 DBF 语言标记', { encoding: 'gbk', cpg: 'ANSI 936', ldid: 0x78 }],
  ['UTF-8 数字声明（带 BOM 和换行）', { encoding: 'utf8', cpg: '\uFEFF65001\r\n' }],
  ['未声明编码的 UTF-8', { encoding: 'utf8' }],
  ['未声明编码的 GBK', { encoding: 'gbk' }],
  ['网球场地台账导入未声明编码的 GBK', { encoding: 'gbk' }, 'court_footprints_ledger'],
]) {
  test('SHP 中文字段名和属性值可以读回：' + label, async () => {
    const parsed = await readSpatialFile(await shapefile(options), target)
    assert.deepEqual(parsed.features[0].properties, attributes)
    assert.deepEqual(parsed.features[0].geometry.coordinates, coordinates)
    if (target) assert.equal(parsed.courtShape, true)
  })
}

test('只有属性值是中文时，也能从后面的记录识别无 CPG 的 GBK', async () => {
  const rows = [{ NAME: 'ASCII', CITY: 'JS' }, { NAME: '温泉路', CITY: '京山' }]
  const parsed = await readSpatialFile(await shapefile({ encoding: 'gbk', rows }))
  assert.deepEqual(parsed.features.map(feature => feature.properties), rows)
})

test('没有 CPG 的繁体属性遵循 DBF 语言标记', async () => {
  const rows = [{ 場館: '京山網球中心', 數量: 12 }]
  const parsed = await readSpatialFile(await shapefile({ encoding: 'big5', ldid: 0x78, rows }))
  assert.deepEqual(parsed.features[0].properties, rows[0])
})

test('GB18030 四字节的地名用字保持完整', async () => {
  const rows = [{ 地名: '𠮷家湾' }]
  const parsed = await readSpatialFile(await shapefile({ encoding: 'gb18030', cpg: 'GB18030', rows }))
  assert.deepEqual(parsed.features[0].properties, rows[0])
})

test('手动指定编码可纠正错误的 CPG，预览和发布保留中文', async () => {
  const file = await shapefile({ encoding: 'gbk', cpg: 'UTF-8' })
  await assert.rejects(readSpatialFile(file), /编码|重选/)
  await assert.rejects(readSpatialFile(file, '', 'utf-8'), /编码|重选/)
  const parsed = await readSpatialFile(file, '', 'gb18030')
  const dataset = { id: 'survey', name: '场馆测绘', department: '京山市', category: '测绘', description: '', features: [] }
  const published = { mode: 'live', datasets: [dataset], rules: {} }
  const preview = prepareGeoImport(published, dataset, parsed, 'append')
  const expected = { ...attributes, name: attributes.名称, region: attributes.行政区, kind: dataset.id }
  assert.deepEqual(preview.first[0].properties, expected)
  const result = publishSourceDocument(published, preview.data, dataset.id)
  assert.deepEqual(result.data.datasets[0].features[0].properties, expected)
})

test('即使字段名全为英文，后面记录中的坏字符也会阻止错误 UTF-8 预览', async () => {
  const rows = [{ NAME: 'Court 1' }, { NAME: '京山球馆' }]
  const file = await shapefile({ encoding: 'gbk', rows })
  await assert.rejects(readSpatialFile(file, '', 'utf-8'), /编码|重选/)
  const parsed = await readSpatialFile(file, '', 'gb18030')
  assert.deepEqual(parsed.features.map(feature => feature.properties), rows)
})
