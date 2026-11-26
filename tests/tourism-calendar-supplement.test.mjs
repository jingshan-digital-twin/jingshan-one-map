import test from 'node:test'
import assert from 'node:assert/strict'
import source from '../server/event-sources/events.json' with {type:'json'}
import {withTourismCalendar, tourismCalendarRegisterId} from '../server/tourism-calendar-supplement.ts'
import {makeEventPlanDataset, publishedCompetitions} from '../src/jingshan/event-platform-data.ts'

test('文旅原表逐场匹配同名赛事、保留规模差异和正式赛事数量',()=>{
  const original = makeEventPlanDataset(source)
  const result = withTourismCalendar({datasets:[original]})
  const checked = result.datasets.find(d=>d.id===tourismCalendarRegisterId).features
  const plans = result.datasets.find(d=>d.id===original.id)
  assert.equal(checked.length,54)
  assert.deepEqual(checked.filter(f=>!f.properties.planId).map(f=>f.properties.sequence),[28,44,46,47,49,52,53,54])
  assert.equal(checked.filter(f=>f.properties.differences.includes('规模')).length,18)
  assert.equal(plans.features.filter((f,i)=>f.properties.level!==original.features[i].properties.level).length,14)
  assert.deepEqual(plans.features.map(f=>f.properties.participants),original.features.map(f=>f.properties.participants))
  assert.deepEqual(publishedCompetitions(result.datasets).map(e=>e.id),publishedCompetitions([original]).map(e=>e.id))
  assert.equal(withTourismCalendar(result),result)
})

test('已核明的场馆使用已发布场馆坐标，保留来源赛期供核对',()=>{
  const original = makeEventPlanDataset(source)
  const location = [113.123,31.02]
  const venues = {id:'venues',name:'场馆台账',features:[{
    type:'Feature',id:'base',geometry:{type:'Point',coordinates:location},properties:{name:'京山网球训练基地'},
  }]}
  const result = withTourismCalendar({datasets:[original,venues]})
  const checks = result.datasets.find(d=>d.id===tourismCalendarRegisterId).features
  const verified = checks.find(f=>f.properties.sequence===47)
  assert.equal(verified.properties.reviewStatus,'待核计划')
  assert.equal(verified.properties.dateText,'11月22-30日')
  assert.match(verified.properties.reviewNotes,/11月21日/)
  assert.match(verified.properties.venueSourceUrl,/chinanews\.com\.cn/)
  assert.deepEqual(verified.geometry,{type:'Point',coordinates:location})
  const unlocated = checks.find(f=>f.properties.sequence===54)
  assert.deepEqual(unlocated.geometry,{type:'GeometryCollection',geometries:[]})
})
