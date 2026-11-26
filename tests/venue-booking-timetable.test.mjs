import assert from 'node:assert/strict'
import test from 'node:test'
import { openingForDate, timetableSlot } from '../src/jingshan/booking-timetable.ts'

const court = {id:'court-1',properties:{facilityId:'venue', open:true, openMode:'全天开放', openingHours:'工作日 08:00–11:00|18:00–22:02'}}
const extra = {venueId:'venue', courtIds:['court-1'], startsOn:'2026-11-24', endsOn:'2026-11-24', days:[2], from:'10:30', until:'12:30', cancelled:false}
const noRecord = {occupied:0, capacity:1}

test('时间表合并台账与当日适用排期；窗口外和无占用统计分别显示', () => {
  const day = openingForDate(court,'2026-11-24',[extra])
  assert.deepEqual(day.spans,[[480,750],[1080,1322]])
  assert.deepEqual(timetableSlot(12,undefined,day), {hour:12, state:'partOpen', openingText:'12:00–12:30', occupiedMinutes:null})
  assert.deepEqual(timetableSlot(22,noRecord,day), {hour:22, state:'partOpen', openingText:'22:00–22:02', occupiedMinutes:0})
  assert.equal(timetableSlot(17,noRecord,day).state,'closed')
  assert.equal(timetableSlot(9,noRecord,day).state,'open')
  assert.deepEqual(openingForDate(court,'2026-11-28',[extra]).spans,[[1080,1322]])
  for (const plan of [{...extra,cancelled:true},{...extra,venueId:'other'},{...extra,courtIds:['other']},{...extra,days:[3]}]) {
    assert.equal(timetableSlot(12,undefined,openingForDate(court,'2026-11-24',[plan])).state,'closed')
  }
})

test('占用记录优先；未证实的开放状态保持未知', () => {
  const missing = openingForDate(undefined,'2026-11-24',[])
  assert.equal(timetableSlot(11,undefined,missing).state,'unknown')
  assert.equal(timetableSlot(11,noRecord,missing).state,'noOccupancy')
  const malformed = openingForDate({...court,properties:{...court.properties,openingHours:'随活动排期|08:71–09:50'}},'2026-11-24',[])
  assert.equal(malformed.known,false)
  assert.deepEqual(malformed.spans,[])
  const closed = {known:true,spans:[]}
  assert.equal(timetableSlot(17,{occupied:0.5,capacity:1},closed).state,'partOccupied')
  assert.equal(timetableSlot(17,{occupied:1,capacity:1},closed).state,'occupied')
})
