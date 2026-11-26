import assert from 'node:assert/strict'
import test from 'node:test'
import { withTourismPlaces } from '../server/tourism-places-supplement.ts'
import { fusionDestinationDataset } from '../src/jingshan/fusion-destinations.ts'
import { fusionItineraries } from '../src/jingshan/fusion-itinerary.ts'
import { withLocalTourismSites, isTourismReference } from '../src/jingshan/tourism-register.ts'
import { facilityKinds } from '../src/jingshan/venue-support.ts'

const oldRose={type:'Feature',id:'old-rose',geometry:{type:'Point',coordinates:[116.705615,39.919677]},
  properties:{name:'月季园',region:'石龙镇',kind:'tourism'}}
const doc={datasets:[fusionDestinationDataset(),{id:'tourism',features:[oldRose]}]}
const registered=withTourismPlaces(doc)
const layer=registered.datasets[0], native=registered.datasets[1]
const sites=layer.features.filter(f=>f.properties.registerSource)

test('imports 26 distinct register rows, resolves the legacy rose-garden location and keeps existing destination IDs',()=>{
  assert.equal(sites.length,26)
  assert.equal(new Set(sites.map(f=>f.properties.registerRow)).size,26)
  assert.equal(sites.find(f=>f.properties.name==='京山天沐温泉').id,'fusion-place-tianmu')
  assert.ok(native.features[0].geometry.coordinates[0]<114)
  assert.deepEqual(native.features[0].geometry,sites.find(f=>f.properties.name.includes('月季园')).geometry)
  assert.equal(withTourismPlaces(registered),registered)
})

test('routes use published visitor positions and venue attributes, preserve ticket aliases and omit village-reference mileage',()=>{
  const matched=sites.find(f=>f.properties.sourceId==='old-rose')
  const offers={id:'offers',features:[{id:'pass',properties:{name:'游览权益',status:'已上架',merchantId:'agency',destinationId:matched.id,validFrom:'2026-01-01',validTo:'2026-12-31'}}]}
  const merchants={id:'merchants',features:[{id:'agency',properties:{name:'接待单位',status:'已入驻'}}]}
  const map=withLocalTourismSites(registered.datasets)
  assert.deepEqual(withLocalTourismSites(map),map)
  const locations=map.find(d=>d.id==='tourism')
  assert.equal(locations.features.length,26)
  const itinerary=fusionItineraries([...map,merchants,offers],{name:'场馆',position:[113.14,30.97]},null,'2026-11-25',1800)
  const rose=itinerary.between.find(f=>f.id==='old-rose')
  assert.equal(rose.grade,'AA')
  assert.equal(rose.offers[0].id,'pass')
  for (const f of locations.features.filter(isTourismReference)) {
    assert.deepEqual(facilityKinds('tourism',f),[])
    assert.ok(!itinerary.between.some(s=>s.name===f.properties.name))
  }
  const paused={...layer,features:layer.features.map(f=>f===matched?{...f,properties:{...f.properties,status:'暂停'}}:f)}
  assert.ok(!withLocalTourismSites([paused,native])[1].features.some(f=>f.id==='old-rose'))
})
