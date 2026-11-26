import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import express from 'express'
import pg from 'pg'
import { eventLiveRouter } from '../server/event-live.ts'
import { createLiveEvents } from '../src/jingshan/event-live-data.ts'
import { eventMonitoringDatasets } from '../server/event-monitor-seed.ts'
import { publishedLiveMonitors } from '../src/jingshan/event-monitor-records.ts'
import { checkDocument } from '../src/jingshan/validate.ts'
import { loadLiveRoads, loadVenueRoadMap } from '../src/jingshan/event-live-roads.ts'

const { events: catalog } = JSON.parse(await readFile(new URL('../server/event-sources/events.json', import.meta.url)))

test('监测点、预警、路线和可处置事件均属于选中的演练赛事', () => {
  const panels = createLiveEvents(catalog, [], new Date('2026-10-01T07:00:00Z'))
  assert.equal(panels.length, 3)
  for (const event of panels) {
    assert.equal(event.status, 'ongoing')
    assert.equal(event.demo, true)
    const ids = new Set(event.points.map(p => p.id))
    assert.equal(ids.size, event.points.length)
    assert.ok(event.points.every(p => p.eventId === event.id && p.position.every(Number.isFinite)))
    assert.ok(event.points.some(p => p.kind === 'camera' && p.camera.online && p.camera.source === 'simulation'))
    assert.ok(event.points.some(p => p.kind === 'camera' && !p.camera.online))
    assert.ok(event.points.some(p => p.kind === 'police' && p.contact.name && p.contact.phone))
    assert.ok(event.points.some(p => p.kind === 'parking' && p.metrics.some(metric => Number.isFinite(metric.percent))))
    assert.ok(event.routes.some(route => route.geometry.type === 'LineString'))
    assert.deepEqual(new Set(event.routes.map(road => road.properties.trafficStatus)), new Set(['closed','congested','slow','smooth']))
    assert.ok(event.incidents.every(i => i.eventId === event.id && i.resourceIds.every(id => ids.has(id))))
    assert.ok(event.alerts.every(a => ids.has(a.pointId) && event.incidents.some(i => i.id === a.incidentId)))
  }
})

test('旧演练快照不作为已发布的真实道路通行状况', async () => {
  const legacy={id:'legacy-event',demo:true,position:[113.1,31.0],routes:[{properties:{demo:true,kind:'event-live-route'}}]}
  assert.deepEqual(await loadLiveRoads(legacy),{source:'published',roads:[]})
  assert.equal(legacy.routes[0].properties.kind,'event-live-route')
})

test('场馆道路服务按赛事位置读取多段线及通行状态，空响应与服务故障保持独立', async t => {
  const event = createLiveEvents(catalog, [])[0]
  const road = { type: 'Feature', properties: { trafficStatus: 'slow', name: '北侧通道' },
    geometry: { type: 'MultiLineString', coordinates: [[[113,31],[113.01,31.01]],[[113.02,31],[113.03,31]]] } }
  let status = 200
  let features = [road]
  const controller = new AbortController()
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.searchParams.get('eventId'), event.id)
    assert.equal(url.searchParams.get('longitude'), String(event.position[0]))
    assert.equal(url.searchParams.get('latitude'), String(event.position[1]))
    assert.equal(url.searchParams.get('layer'), 'roads')
    assert.equal(options.signal, controller.signal)
    return Response.json({ type:'FeatureCollection', features }, { status })
  })
  const load = () => loadLiveRoads(event, 'https://road-service.example.test/network?layer=roads', controller.signal)
  const layer = await load()
  assert.equal(layer.source, 'service')
  assert.equal(layer.roads.length, 1)
  assert.deepEqual(layer.roads[0].geometry, road.geometry)
  assert.equal(layer.roads[0].properties.name, '北侧通道')
  assert.equal(layer.roads[0].properties.trafficStatus, 'slow')
  assert.equal(layer.roads[0].properties.demo, false)
  features = []
  assert.deepEqual(await load(), { source:'service', roads:[] })
  features = [{ ...road, properties:{trafficStatus:'unknown'} }]
  await assert.rejects(load, /路况/)
  features = [{ ...road, geometry:{type:'LineString', coordinates:[[999, 31],[113,31]]} }]
  await assert.rejects(load, /线形/)
  status = 503
  await assert.rejects(load, /503/)
})

test('赛中以登记编号关联正式路名，保留实况上报的局部线形，失败时仍能查看独立数据源', async t => {
  const surface={type:'Feature',id:'cim-04:a',geometry:{type:'MultiPolygon',coordinates:[[[[113,31],[113.01,31],[113.01,31.001],[113,31]]]]},
    properties:{name:'网球路',roadCode:'A-1',sourceServiceId:'cim-04',sourceFeatureId:'a'}}
  const section={type:'Feature',id:'section',geometry:{type:'LineString',coordinates:[[113.002,31],[113.003,31]]},
    properties:{name:'现场上报区段',trafficStatus:'closed',roadCode:'A-1'}}
  const event={id:'registered',position:[113,31],demo:false,routes:[section]}
  let missing=false
  t.mock.method(globalThis,'fetch',async url=>{
    const query=new URL(url,'http://localhost')
    assert.equal(query.pathname,'/api/jingshan/event-road-surfaces')
    assert.equal(query.searchParams.get('radius'),'1000')
    return missing ? new Response(null,{status:502}) : Response.json({type:'FeatureCollection',features:[surface]})
  })
  const layer=await loadVenueRoadMap(event)
  assert.equal(layer.roads[0].properties.name,'网球路')
  assert.deepEqual(layer.roads[0].geometry,section.geometry)
  assert.equal(layer.surfaces[0].properties.trafficStatus,undefined)
  assert.equal((await loadVenueRoadMap({...event,demo:true})).roads.length,0)
  missing=true
  const offline=await loadVenueRoadMap(event)
  assert.equal(offline.surfaces.length,0)
  assert.equal(offline.roads[0].properties.name,'现场上报区段')
  assert.equal(offline.warnings.length,1)
})

// Supply the project's PG settings to exercise the real row-version check against concurrent requests.
test('赛中协同接口隔离赛事并持久化处置过程，拒绝越级操作和过期更新', {
  skip: !process.env.PGDATABASE && '运行 node --env-file=.env --test tests/event-live.test.mjs 以连接测试数据库',
}, async t => {
  const schema = 'event_live_test_' + randomUUID().replaceAll('-', '')
  const admin = new pg.Pool({ connectionTimeoutMillis: 3000 })
  const pool = new pg.Pool({ connectionTimeoutMillis: 3000, options: '-c search_path=' + schema })
  let server
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve))
    await pool.end()
    try { await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE') }
    finally { await admin.end() }
  })
  await admin.query('CREATE SCHEMA ' + schema)
  await pool.query('CREATE TABLE jingshan_workspace (id boolean PRIMARY KEY, version integer NOT NULL, published jsonb NOT NULL)')
  const datasets=eventMonitoringDatasets(catalog,[])
  await pool.query('INSERT INTO jingshan_workspace VALUES (true,1,$1)', [{ datasets }])
  const app = express()
  app.use(express.json(), eventLiveRouter(pool))
  server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  const base = 'http://127.0.0.1:' + server.address().port
  const read = async () => (await (await fetch(base)).json()).events
  const post = async (url, body) => {
    const response = await fetch(base + url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({publicationVersion:1,...body}),
    })
    return { status: response.status, body: await response.json() }
  }
  const [original, other] = await read()
  const pending = original.incidents.find(i => i.status === 'pending')
  assert.ok(pending)
  const path = '/' + original.id + '/incidents/' + pending.id + '/transition'
  const transition = (revision, action, note) => post(path, {revision, action, note})
  let revision = original.revision
  assert.equal((await transition(revision, 'onsite', '提前到场')).status, 409)
  assert.equal((await transition(revision, '__proto__')).status, 400)
  assert.equal((await transition(revision, 'consult', ' ')).status, 400)
  const wrongEvent = '/' + other.id + '/incidents/' + pending.id + '/transition'
  assert.equal((await post(wrongEvent, {revision: other.revision, action: 'dispatch'})).status, 404)
  const concurrent = await Promise.all([transition(revision, 'dispatch'), transition(revision, 'dispatch')])
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200,409])
  revision++
  for (const [action, note, expected] of [
    ['consult', '演练会商意见', 'dispatched'], ['receive', '', 'received'], ['onsite', '现场核验', 'onsite'],
    ['resolve', '现场处置完成', 'resolved'],
  ]) {
    const response = await transition(revision, action, note)
    assert.equal(response.status, 200)
    const updated = response.body.incidents.find(i => i.id === pending.id)
    assert.equal(updated.status, expected)
    assert.equal(updated.history.at(-1).action, action)
    assert.equal(updated.history.at(-1).note, note)
    assert.equal(response.body.revision, ++revision)
  }
  assert.equal((await transition(revision, 'consult', '追加记录')).status, 409)
  const noticePath = '/' + original.id + '/notices'
  assert.equal((await post(noticePath, {revision, text: ' '})).status, 400)
  const notice = await post(noticePath, {revision, text: '  请按指引换乘接驳车。  '})
  assert.equal(notice.status, 200)
  assert.equal(notice.body.publicNotices.at(-1).text, '请按指引换乘接驳车。')
  const after = await read()
  assert.deepEqual(after.find(e => e.id === original.id), notice.body)
  assert.deepEqual(after.find(e => e.id === other.id), other)
  const source=datasets.find(d=>d.id==='event_live_monitors')
  source.features[0].properties.onsite=78
  await pool.query('UPDATE jingshan_workspace SET published=$1,version=2',[{datasets}])
  const published=(await read()).find(e=>e.id===original.id)
  assert.equal(published.metrics.onsite,78)
  assert.equal(published.incidents.find(i=>i.id===pending.id).status,'resolved')
  assert.deepEqual(published.publicNotices,notice.body.publicNotices)
  assert.equal((await post(noticePath,{revision:published.revision,text:'基于旧资料的通知'})).status,409)
  assert.equal((await post(noticePath,{publicationVersion:2,revision:published.revision,text:'基于新资料的通知'})).status,200)
  source.features.shift()
  await pool.query('UPDATE jingshan_workspace SET published=$1,version=3',[{datasets}])
  assert.ok(!(await read()).some(e=>e.id===original.id))
})

test('监测总表与监测点、实际路况按编号关联；未填指标保留缺值',async()=>{
  const datasets=eventMonitoringDatasets(catalog,[])
  const layer=id=>datasets.find(d=>d.id===id)
  const row=structuredClone(layer('event_live_monitors').features[0])
  row.id='official-monitor';row.properties.monitorCode='actual-01';row.properties.exercise=false;delete row.properties.onsite
  layer('event_live_monitors').features.push(row)
  const point=structuredClone(layer('event_live_points').features[0]);point.id='real-p1';point.properties.monitorCode='actual-01'
  layer('event_live_points').features.push(point)
  const road=structuredClone(layer('event_live_roads').features[0]);road.id='real-r1';road.properties.monitorCode='actual-01';road.properties.demo=false
  layer('event_live_roads').features.push(road)
  const doc={mode:'live',rules:{},datasets};checkDocument(doc)
  const [m]=publishedLiveMonitors(datasets)
  assert.equal(m.id,'actual-01');assert.equal(m.demo,false);assert.equal(m.metrics.onsite,null)
  assert.deepEqual(m.points.map(p=>p.id),['real-p1']);assert.deepEqual(m.incidents,[])
  assert.equal((await loadLiveRoads(m)).source,'published')
  assert.deepEqual(m.routes.map(r=>r.id),['real-r1'])
  point.properties.metrics='错误格式'
  assert.throws(()=>checkDocument(doc),/点位指标/)
})

test('赛中场馆和待补录赛历随实测场馆更新，独立监测点保留登记位置',()=>{
  const datasets=eventMonitoringDatasets(catalog,[])
  const monitor=publishedLiveMonitors(datasets).find(e=>e.venueName==='京山国际网球赛事中心')
  const parking=monitor.points.find(p=>p.kind==='parking')
  const venue={type:'Feature',id:'ledger-venue:京山国际网球中心',geometry:{type:'Point',coordinates:[113.14,30.99]},
    properties:{name:'京山国际网球中心',ledgerVenue:true}}
  const plan={type:'Feature',id:'current-tournament',geometry:{type:'GeometryCollection',geometries:[]},
    properties:{name:'公开赛',status:'进行中',venueText:monitor.venueName+'、文峰网球主题公园'}}
  datasets.push({id:'venues',features:[venue]},{id:'event_plans',features:[plan]})
  const next=publishedLiveMonitors(datasets)
  const event=next.find(e=>e.id===monitor.id)
  assert.deepEqual(event.position,venue.geometry.coordinates)
  assert.deepEqual(event.points.find(p=>p.kind==='venue').position,venue.geometry.coordinates)
  assert.deepEqual(event.points.find(p=>p.id===parking.id).position,parking.position)
  assert.deepEqual(next.find(e=>e.planId===plan.id).position,venue.geometry.coordinates)
})

test('已发布赛历进入赛中、补录监测和办结后，列表按同一赛事切换',()=>{
  const datasets=eventMonitoringDatasets(catalog,[])
  const plan={type:'Feature',id:'scheduled-event',geometry:{type:'GeometryCollection',geometries:[]},
    properties:{kind:'event_plan',name:'新赛事',region:'京山市',status:'进行中'}}
  datasets.push({id:'event_plans',features:[plan]})
  const read=()=>publishedLiveMonitors(datasets).filter(m=>!m.demo)
  assert.deepEqual(read().map(m=>[m.planId,m.awaitingMonitor,m.metrics.onsite]),[[plan.id,true,null]])
  const source=datasets.find(d=>d.id==='event_live_monitors')
  const monitor=structuredClone(source.features[0])
  monitor.id='new-monitor';Object.assign(monitor.properties,{planId:plan.id,monitorCode:'current',exercise:false,onsite:0})
  source.features.push(monitor)
  assert.deepEqual(read().map(m=>[m.id,m.metrics.onsite]),[['current',0]])
  plan.properties.status='已办结'
  assert.deepEqual(read(),[])
})
