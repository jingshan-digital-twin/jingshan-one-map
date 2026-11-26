import test from 'node:test'
import assert from 'node:assert/strict'
import { isOpeningActive,openingDate, openingTransition, openingVenue } from '../src/jingshan/venue-opening.ts'

const at = '2026-11-19T02:00:00Z'
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0')
const assigned = {id:uuid(0), venueId:'school-a', venueName:'校园场地', mode:'demo', department:'教育局', due:'2026-11-28',
  stage:'assigned', history:[{requestId:uuid(0), action:'assign', at, note:'核实周末开放安排'}]}
const update = (task, action, n, fields={}) => openingTransition(task,{action,requestId:uuid(n),revision:task.history.length,...fields},at)

test('权属场馆与仅有逐片记录的场馆使用同一分组编号', () => {
  const data = [{id:'venues',features:[{id:'group',properties:{name:'球场组',region:'新市街道'}}]},
    {id:'courts',features:[{id:'c1', properties:{name:'第一片', facilityId:'group', facilityName:'旧名'}},
      {id:'c2',properties:{name:'第二片', facilityId:'other',facilityName:'分组名称'}},{id:'c3',properties:{name:'独立场地'}}]}]
  assert.deepEqual(openingVenue(data,'group'),{name:'球场组',region:'新市街道'})
  assert.equal(openingVenue(data,'other').name,'分组名称')
  assert.equal(openingVenue(data,'c3').name,'独立场地')
  assert.throws(()=>openingVenue(data,'c1'),/没有该场馆/)
})

test('签收、反馈、退回和重新核验留痕，重试与过期写入不会重复推进', () => {
  const received = update(assigned,'receive',1)
  assert.equal(update(received,'receive',1,{revision:1}),received)
  const first = update(received,'feedback',2,{outcome:'unavailable',note:'期末考试占场'})
  const returned = update(first,'return',3,{note:'请核实周末开放档期'})
  assert.throws(()=> update(returned,'feedback',4,{revision:2,outcome:'unavailable',note:'旧反馈'}),/已更新/)
  const review = update(returned,'feedback',5,{outcome:'scheduled',startsOn:'2026-12-01',hours:'周六 9–12 时',note:'室外1、2号场面向居民开放'})
  const closed = update(review,'close',6,{note:'已向校方核验时段与开放范围'})
  assert.deepEqual(closed.history.map(e=>e.action),['assign','receive','feedback','return','feedback','close'])
  assert.equal(closed.stage,'closed')
  assert.equal(update(closed,'close',6,{revision:5,note:'已向校方核验时段与开放范围'}),closed)
  assert.throws(()=>update(closed,'close',6,{revision:5,note:'另一条意见'}),/同一请求/)
  assert.throws(()=>update(closed,'return',7,{note:'迟到的操作'}),/已更新/)
})

test('督办只追加记录，同阶段同日重复提醒去重，办结后禁用',()=>{
  const reminder={note:'请核实周六场地安排'}
  const noted=update(assigned,'remind',1,reminder)
  assert.equal(noted.stage,'assigned')
  assert.deepEqual(noted.history.at(-1),{requestId:uuid(1),action:'remind',at,note:reminder.note})
  assert.equal(update(noted,'remind',1,{...reminder,revision:1}),noted)
  assert.equal(update(noted,'remind',2,reminder),noted)
  assert.throws(()=>update(noted,'remind',1,{note:'改写请求'}),/同一请求/)
  assert.throws(()=>update(noted,'remind',3,{note:' ',revision:1}),/督办说明/)
  assert.throws(()=>update(noted,'remind',4,{note:'另一项',revision:1}),/已更新/)
  const nextDay=openingTransition(noted,{action:'remind',requestId:uuid(5),revision:2,...reminder},'2026-11-19T16:01:00Z')
  assert.equal(nextDay.history.length,3)
  const received=update(nextDay,'receive',6)
  const review=update(received,'feedback',7,{outcome:'unavailable',note:'场地检修'})
  const closed=update(review,'close',8,{note:'核验结果属实'})
  assert.throws(()=>update(closed,'remind',9,reminder),/已办结/)
})

test('开放排期、暂缓原因和核验意见逐阶段校验', () => {
  const received = update(assigned,'receive',1)
  assert.throws(()=>update(assigned,'close',6,{note:'反馈前办结'}),/已更新/)
  assert.throws(()=>update(received,'feedback',2,{outcome:'scheduled',note:'球场A',startsOn:'2026-02-30',hours:'上午'}),/日期/)
  assert.throws(()=>update(received,'feedback',2,{outcome:'scheduled',note:'球场A',startsOn:'2026-02-25',hours:''}),/时段/)
  assert.throws(()=>update(received,'feedback',2,{outcome:'unavailable',note:' '}),/原因/)
  const review = update(received,'feedback',2,{outcome:'unavailable',note:'场地改造'})
  assert.throws(()=>update(review,'close',3,{note:''}),/核验意见/)
  assert.equal(update(review,'close',3,{note:'已核实施工期'}).history[2].outcome,'unavailable')
  assert.throws(()=>openingDate('2026-02-29','办理期限'),/期限/)
})

test('待签收、办理中、待核验均可撤回，保留原记录并停止跟办',()=>{
  const received=update(assigned,'receive',1)
  const review=update(received,'feedback',2,{outcome:'unavailable',note:'本周占场'})
  for(const task of [assigned,received,review]){
    assert.equal(isOpeningActive(task.stage),true)
    assert.throws(()=>update(task,'withdraw',3,{revision:0}),/已更新/)
    const withdrawn=update(task,'withdraw',3)
    assert.equal(isOpeningActive(withdrawn.stage),false)
    assert.equal(withdrawn.stage,'withdrawn')
    assert.deepEqual(withdrawn.history.slice(0,-1),task.history)
    assert.equal(withdrawn.history.at(-1).action,'withdraw')
    assert.equal(update(withdrawn,'withdraw',3,{revision:task.history.length}),withdrawn)
    assert.throws(()=>update(withdrawn,'receive',4),/已更新/)
    assert.throws(()=>update(withdrawn,'remind',4,{note:'请联系'}),/已撤回/)
    assert.throws(()=>update(withdrawn,'close',4,{note:'已核验'}),/已更新/)
  }
  assert.throws(()=>update(update(review,'close',5,{note:'已核验'}),'withdraw',6),/已更新/)
})
