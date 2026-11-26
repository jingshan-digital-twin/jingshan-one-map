import assert from 'node:assert/strict'
import test from 'node:test'
import { rasterConfig, rasterUrl, rasterMime, sampleTile } from '../server/cim-raster.ts'

test('XYZ 和 TMS 的模板保留访问参数，裁剪至有效矩阵范围', () => {
  const url = 'https://tiles.example/tiles/{z}/{x}/{-y}?north={y}&key=a%2Bb'
  const raster = rasterConfig('xyz',{maxLevel:3},url)
  const service = {kind:'xyz',url,raster,layer:''}
  assert.equal(rasterUrl(service,3,2,1).href, 'https://tiles.example/tiles/3/2/6?north=1&key=a%2Bb')
  for (const tile of [[4,0,0],[3,0,8],[3,8,0],[-1,0,0],[1,0,.5]]) {
    assert.throws(() => rasterUrl(service,...tile), /超出范围/)
  }
  assert.throws(() => rasterConfig('xyz',{},'https://{x}.example/{z}/{y}'), /模板|XYZ/)
  assert.throws(() => rasterConfig('xyz',{},'https://example/{s}/{z}/{x}/{y}'), /模板|XYZ/)
  assert.throws(() => rasterConfig('xyz',{},'https://example/{z}/{x}.png'), /模板|XYZ/)
})

test('WMTS 读取有前缀的经纬度矩阵集并替换 GetCapabilities 参数', () => {
  const url = 'https://tiles.example/ogc?REQUEST=GetCapabilities&LAYER=old&token=key'
  const raster = rasterConfig('wmts',{ projection:'EPSG:4326',matrixSet:'c',matrixPrefix:'c:',matrixOffset:1,style:'',format:'image/jpeg' },url)
  const service = {kind:'wmts',layer:'towns',url,raster}
  const query = Object.fromEntries(rasterUrl(service,0,1,0).searchParams)
  assert.deepEqual(query,{token:'key',service:'WMTS',request:'GetTile',version:'1.0.0',layer:'towns',style:'',format:'image/jpeg',tilematrixset:'c',tilematrix:'c:1',tilerow:'0',tilecol:'1'})
  assert.throws(() => rasterUrl(service,0,2,0), /超出范围/)
  assert.throws(() => rasterConfig('wmts',{maxLevel:'5'},url), /最大瓦片/)
  assert.throws(() => rasterConfig('wmts',{matrixSet:''},url), /矩阵集/)
  const sample = sampleTile(service)
  assert.ok(rasterUrl(service,sample.z,sample.x,sample.y) instanceof URL)
})

test('异常服务返回的 HTML、XML 和截断数据不会作为影像送入地图', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ','base64')
  assert.equal(rasterMime(png),'image/png')
  for (const bad of [Buffer.from('<ServiceException/>'),png.subarray(0,12),Buffer.from('<html>error</html>')]) {
    assert.throws(() => rasterMime(bad), /图块/)
  }
})
