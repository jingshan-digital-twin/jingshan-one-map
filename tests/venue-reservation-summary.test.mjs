import assert from 'node:assert/strict'
import test from 'node:test'
import { originsForPublishedCourts } from '../server/venue-reservations.ts'
import { summarizeVenueReservations } from '../src/jingshan/venue-reservation-summary.ts'

const period = {name:'上午',startHour:8,endHour:10}
const hours = (occupied,capacity) => [0,0,0,0,occupied,capacity]
const court = (id,all,latest) => ({id,venueId:id,venueName:id,hourly:[all],daily:[[],[latest]]})
const history = {
  dates:['2026-11-23','2026-11-24'],from:'2026-11-23',through:'2026-11-24',periods:[period],
  courts:[court('A',hours(1,1),hours(0,0)),court('B',hours(3,9),hours(1,3)),court('C',hours(4,6),hours(4,4))],
}
function members(venueIds,local,away) {
  return {venueIds, members:local+away, locatedMembers:local+away, unknownMembers:0, regions:[
    {province:'湖北省',city:'荆门市',members:local},{province:'湖南省',city:'长沙市',members:away},
  ].filter(region=>region.members)}
}
function venue(id,memberCounts) {
  return {venueId:id,courtIds:[id],records:9,mobileRecords:8,nonMobileRecords:1,...memberCounts}
}
const cohorts = [members(['A'],1,0), members(['A','B'],0,2), members(['B','C'],1,0)]
const origins = {venues:[venue('A',members(['A'],1,2)),venue('B',members(['B'],1,2)),venue('C',members(['C'],1,0))],
  overall:{...members(['A','B','C'],2,2),records:27,mobileRecords:24,nonMobileRecords:3},cohorts}

test('汇总只计关联场馆，按有效场地小时加权，区分尚无容量和零占用', () => {
  const report = summarizeVenueReservations(history,['A','B','B','无数据'])
  assert.equal(report.courtCount,2)
  assert.deepEqual(report.overall,{occupied:4,capacity:10,rate:40})
  assert.deepEqual(report.today,{occupied:1,capacity:3,rate:100/3})
  assert.deepEqual(report.periods,[{...period,...report.today}])
  assert.deepEqual(report.venues.map(v=>[v.id,v.today.rate]),[['B',100/3],['A',null]])
  assert.equal(summarizeVenueReservations(history,[]).overall.rate,null)
  const vacant = {...history,courts:[court('A',hours(0,2),hours(0,1))]}
  assert.equal(summarizeVenueReservations(vacant,['A']).today.rate,0)
})

test('跨馆客源来自互斥用户分组，历史数据缺少分组时不推算局部客源', () => {
  const report = summarizeVenueReservations({...history,origins},['A','B'])
  assert.equal(report.origins.records,18)
  assert.equal(report.origins.locatedMembers,4)
  assert.deepEqual(report.originShares,[{label:'荆门',rate:50},{label:'湖北其他地区',rate:0},{label:'省外',rate:50}])
  const old = {...history,origins:{...origins,cohorts:undefined}}
  assert.equal(summarizeVenueReservations(old,['A','B','C']).origins,origins.overall)
  assert.equal(summarizeVenueReservations(old,['B']).origins,origins.venues[1])
  assert.equal(summarizeVenueReservations(old,['A','B']).origins,null)
  assert.deepEqual(summarizeVenueReservations(old,['无数据']).originShares,[])
})

test('发布范围减少后移除隐藏场馆的归属并保留其余场馆的交叉去重', () => {
  const visible = history.courts.filter(c => c.id !== 'C')
  const published = originsForPublishedCourts(origins,visible)
  assert.ok(published.cohorts.every(row => !row.venueIds.includes('C')))
  assert.equal(published.overall,null)
  const report = summarizeVenueReservations({...history,courts:visible,origins:published},['A','B'])
  assert.equal(report.origins.locatedMembers,4)
  assert.deepEqual(report.originShares.map(row => row.rate),[50,0,50])
})
