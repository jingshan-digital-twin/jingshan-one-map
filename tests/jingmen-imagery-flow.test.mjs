import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { crc32, deflateSync } from 'node:zlib'
import express from 'express'
import { cimRouter } from '../server/cim.ts'

const key = 'sample-key'
const secret = 'sample-secret'
const resource = '/prod-api/jmdsj/JMS2026N05MYX/1'
const layer = 'jingmen2026_0d5m'
const matrixSet = 'GoogleMapsCompatible'

function makeTile() {
  function chunk(type, data) {
    const chunk = Buffer.alloc(data.length + 12)
    chunk.writeUInt32BE(data.length)
    chunk.write(type, 4, 'ascii')
    data.copy(chunk, 8)
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4)
    return chunk
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(256, 0)
  ihdr.writeUInt32BE(256, 4)
  ihdr[8] = 8 // 8-bit greyscale
  const pixels = Buffer.alloc(256 * 257)
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) pixels[y * 257 + 1 + x] = (x + y) % 256
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}

function capabilities(endpoint) {
  const levels = [0, 1, 2].map(z => `<TileMatrix>
    <ows:Identifier>${z}</ows:Identifier><ScaleDenominator>${559082264.0287178 / 2**z}</ScaleDenominator>
    <TopLeftCorner>-20037508.342789244 20037508.342789244</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight>
    <MatrixWidth>${2**z}</MatrixWidth><MatrixHeight>${2**z}</MatrixHeight></TileMatrix>`).join('')
  return `<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1"
    xmlns:xlink="http://www.w3.org/1999/xlink" version="1.0.0">
    <ows:OperationsMetadata><ows:Operation name="GetTile"><ows:DCP><ows:HTTP><ows:Get xlink:href="${endpoint}">
      <ows:Constraint name="GetEncoding"><ows:AllowedValues><ows:Value>KVP</ows:Value></ows:AllowedValues></ows:Constraint>
    </ows:Get></ows:HTTP></ows:DCP></ows:Operation></ows:OperationsMetadata>
    <Contents><Layer><ows:Title>荆门市2026年0.5米影像</ows:Title><ows:Identifier>${layer}</ows:Identifier>
    <Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style><Format>image/png</Format>
    <TileMatrixSetLink><TileMatrixSet>${matrixSet}</TileMatrixSet></TileMatrixSetLink></Layer>
    <TileMatrixSet><ows:Identifier>${matrixSet}</ows:Identifier>
    <ows:SupportedCRS>urn:ogc:def:crs:EPSG::3857</ows:SupportedCRS>${levels}</TileMatrixSet></Contents></Capabilities>`
}

async function start(server, t) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => {
    server.close(resolve)
    server.closeAllConnections()
  }))
  return 'http://127.0.0.1:' + server.address().port
}

test('0.5 米影像通过签名网关实取瓦片后才上架，网关和瓦片错误会撤下图层', async t => {
  let mode = 'auth'
  const tile = makeTile()
  const requestedTiles = []
  const upstream = await start(createServer((req, res) => {
    const url = new URL(req.url, 'http://' + req.headers.host)
    const timestamp = req.headers['dsc-app-timestamp']
    const params = new URLSearchParams(url.search)
    params.set('dscAppKey', key)
    params.sort()
    const fields = Array.from(params).filter(([,value]) => value.trim()).map(([k,v]) => k+'='+v)
    const expected = createHash('md5').update(fields.join('&')+'&time='+timestamp+'&key='+secret).digest('hex').toUpperCase()
    if (url.pathname !== resource || req.method !== 'GET' || req.headers['dsc-app-key'] !== key ||
        !/^\d{10}$/.test(timestamp) || req.headers['dsc-app-sign'] !== expected) {
      res.writeHead(403).end()
      return
    }
    const wmts = Object.fromEntries(Array.from(url.searchParams, ([k,v]) => [k.toLowerCase(), v]))
    if (mode === 'auth') {
      res.setHeader('Content-Type', 'application/xml')
      res.end('<BusinessMessage><code>100107</code><success>false</success><data/></BusinessMessage>')
    } else if (!url.search || wmts.request?.toLowerCase() === 'getcapabilities') {
      res.setHeader('Content-Type', 'application/xml')
      const xml=capabilities(url.origin + resource)
      res.end('<ISSTECH><code>200</code><success>true</success><data>'+xml.replaceAll('&','&amp;').replaceAll('<','&lt;')+'</data></ISSTECH>')
    } else if (wmts.request?.toLowerCase() === 'gettile' && wmts.layer === layer &&
        wmts.tilematrixset === matrixSet && wmts.style === 'default' && wmts.format === 'image/png') {
      requestedTiles.push([wmts.tilematrix, wmts.tilecol, wmts.tilerow])
      if (mode === 'xml') {
        res.setHeader('Content-Type', 'application/xml')
        res.end('<ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/1.1"/>')
      } else if (mode === 'description') {
        res.setHeader('Content-Type', 'application/xml')
        res.end('<ISSTECH><code>200</code><success>true</success><data><![CDATA['+capabilities(url.origin + resource)+']]></data></ISSTECH>')
      } else if (mode === 'missing') {
        res.setHeader('Content-Type', 'application/xml')
        res.end('<ISSTECH><code>200</code><data><code>404</code><success>false</success></data><success>true</success></ISSTECH>')
      } else {
        res.setHeader('Content-Type', 'image/png')
        res.end(tile)
      }
    } else {
      res.writeHead(400).end()
    }
  }), t)

  const config = { JINGMEN_DSC_SERVICE_URL: upstream + resource, JINGMEN_DSC_APP_KEY: key, JINGMEN_DSC_APP_SECRET: secret }
  for (const [name, value] of Object.entries(config)) {
    const original = process.env[name]
    process.env[name] = value
    t.after(() => { if (original === undefined) delete process.env[name]; else process.env[name] = original })
  }
  const pool = { async query(sql) {
    assert.match(sql, /^SELECT .*FROM jingshan_cim_services/s)
    return {rows: []}
  } }
  const app = express()
  const prefix = '/api/jingshan/cim'
  app.use(prefix, cimRouter(pool))
  const local = await start(createServer(app), t)
  const check = async () => {
    const res = await fetch(local + prefix + '/admin/jingmen-map/check', {method:'POST'})
    assert.equal(res.status, 200)
    return res.json()
  }
  const catalog = async () => {
    const res = await fetch(local + prefix + '/services')
    assert.equal(res.status, 200)
    return (await res.json()).services
  }

  const denied = await check()
  assert.equal(denied.status, 'auth')
  assert.match(denied.statusMessage, /100107/)
  assert.deepEqual(await catalog(), [])
  assert.equal(requestedTiles.length, 0)

  mode = 'ok'
  const verified = await check()
  assert.equal(verified.status, 'online', verified.statusMessage)
  assert.ok(requestedTiles.length > 0)
  const [service] = await catalog()
  assert.equal(service.id, 'jingmen-2026-05m')
  assert.equal(service.mapUrl, prefix + '/jingmen-map/raster/{z}/{x}/{y}')
  assert.equal(service.defaultVisible, false)
  assert.ok(!JSON.stringify(service).includes(upstream))
  assert.ok(!JSON.stringify(service).includes(secret))
  const path = service.mapUrl.replace('{z}', '2').replace('{x}', '3').replace('{y}', '1')
  const image = await fetch(local + path)
  assert.equal(image.status, 200)
  assert.match(image.headers.get('content-type'), /^image\/png/)
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), tile)
  assert.deepEqual(requestedTiles.at(-1), ['2','3','1'])

  mode = 'xml'
  const invalid = await check()
  assert.equal(invalid.status, 'invalid')
  assert.deepEqual(await catalog(), [])
  assert.equal((await fetch(local + path)).ok, false)
  for(const [reply,message] of [['description',/GetTile 返回了服务说明/],['missing',/404/]]){
    mode=reply
    const result=await check()
    assert.equal(result.status,'invalid')
    assert.match(result.statusMessage,message)
    assert.deepEqual(await catalog(),[])
  }
})
