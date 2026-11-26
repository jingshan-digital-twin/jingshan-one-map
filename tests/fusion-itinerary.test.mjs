import assert from 'node:assert/strict'
import test from 'node:test'
import { fusionDestinationDataset } from '../src/jingshan/fusion-destinations.ts'
import { fusionItineraries, fusionTripMap, fusionReturnCities } from '../src/jingshan/fusion-itinerary.ts'
import { layoutPromotionFlow } from '../src/jingshan/visitor-flows.ts'

const venue = {name:'比赛场馆', position:[113.15, 30.98]}
const wuhan = fusionReturnCities.find(city => city.name === '武汉市')
const poi = (id, properties, coordinates = [113.14, 30.98]) => ({
  id, type:'Feature', geometry:{type:'Point', coordinates}, properties:{name:id, region:'京山', ...properties},
})
const dataset = (id, features) => ({id, features})
const registered = fusionDestinationDataset()
const date = '2026-11-24'

test('uses published sites, local travel time and city direction independently', () => {
  const grid = [registered, dataset('tourism', [poi('异常点', {}, [116.7, 39.9])])]
  const short = fusionItineraries(grid, venue, wuhan, date, 30)
  assert.equal(short.between.length, 0)
  const long = fusionItineraries(grid, venue, wuhan, date, 120)
  assert.deepEqual(long.between.map(s => s.name), ['京山天沐温泉'])
  assert.deepEqual(long.returnStops.map(s => s.id), short.returnStops.map(s => s.id))
  assert.ok(long.returnStops.some(v => v.name === '金银湖国家城市湿地公园'))
  assert.ok(long.returnStops.every(v => v.name !== '明显陵' && v.detourKm >= 0))
  const jingmen = fusionReturnCities.find(city => city.name === '荆门市')
  assert.ok(fusionItineraries(grid, venue, jingmen, date, 120).returnStops.some(v => v.name === '明显陵'))
  assert.equal(fusionItineraries(grid, venue, null, date, 120).returnStops.length, 0)
  assert.deepEqual(fusionItineraries([], venue, wuhan, date, 120).between, [])
})

test('returns an offer for the registered site, event and active date only', () => {
  const destinationId = 'fusion-place-jinyinhu'
  const merchant = poi('商户', {status:'已入驻', sourceId:destinationId})
  const active = {merchantId:merchant.id, status:'已上架', validFrom:date, validTo:date, rule:'登记权益'}
  const offers = dataset('offers', [
    poi('通用', active), poi('单场', {...active, eventId:'event-a', sample:true}),
    poi('下架', {...active, status:'已下架'}), poi('过期', {...active, validTo:'2026-11-23'}),
    poi('未入驻', {...active, merchantId:'其他商户'}), poi('指定其他游览地', {...active, destinationId:'fusion-place-donghu'}),
  ])
  const layers = [registered, dataset('merchants', [merchant, poi('其他商户',{status:'待审核'})]), offers]
  const standard = fusionItineraries(layers, venue, wuhan, date, 120)
  assert.equal(standard.offers.length, 2)
  const byVenue = fusionItineraries(layers, venue, wuhan, date, 120, 'event-a')
  assert.equal(byVenue.returnStops.find(p => p.id === destinationId).offers.length, 2)
  assert.equal(byVenue.offers.find(p => p.id === '单场').sample, true)
  assert.deepEqual(byVenue.returnStops.find(p => p.id === 'fusion-place-donghu').offers.map(o => o.id), ['指定其他游览地'])
})

test('camera and direction distinguish coming to Jingshan and stopping along the return', () => {
  const {returnStops, between} = fusionItineraries([registered], venue, wuhan, date, 120)
  const first = returnStops[0]
  const outbound = fusionTripMap('return', venue, wuhan, returnStops, first.id)
  assert.deepEqual(outbound.flow.via, {position:first.position, label:first.name})
  assert.deepEqual(outbound.flow.to, wuhan.position)
  assert.ok(outbound.features.find(f => f.id === first.id).properties.selected)
  assert.equal(outbound.regional, true)
  const inbound = fusionTripMap('origin', venue, wuhan, returnStops)
  assert.deepEqual(inbound.flow.from, wuhan.position)
  assert.equal(inbound.features.length, 2)
  assert.equal(fusionTripMap('between', venue, wuhan, between).regional, false)
  assert.equal(fusionTripMap('return', venue, null, [], first.id).flow, null)
  const drawn = layoutPromotionFlow({x:0,y:25},{x:210,y:110},480,320,0,['起点','终点'],{x:90,y:60})
  assert.equal((drawn.d.match(/C /g) ?? []).length, 2)
  assert.match(drawn.d, /90 60 C /)
  assert.equal(drawn.d.startsWith('M 0 25'), true)
  assert.equal(drawn.d.endsWith('210 110'), true)
  const name = '京山网球训练基地'
  const caption = layoutPromotionFlow({x:108,y:100},{x:366,y:210},720,320,0,[name,'武汉市'],undefined,true)
  assert.ok(caption.endpoints[0].width >= Array.from(name).length * 16 + 20)
})

