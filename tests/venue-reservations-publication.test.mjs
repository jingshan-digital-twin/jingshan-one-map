import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { bookingsForPublishedCourts, originsForPublishedCourts } from '../server/venue-reservations.ts'

test('预约服务仅返回当前已发布且归属匹配的实体，其小时模板随之裁剪', async () => {
  const source = JSON.parse(await readFile(new URL('../server/resource-sources/venue-reservations.json',import.meta.url),'utf8'))
  const [keep, reassigned] = source.courts
  const filtered = bookingsForPublishedCourts(source, [
    {...keep, name:'后台更新的实体名称'},
    {...reassigned, venueId:'不同场馆'},
  ])
  assert.deepEqual(filtered.courts.map(c => c.id), [keep.id])
  const [court] = filtered.courts
  assert.equal(court.name, '后台更新的实体名称')
  assert.equal(filtered.hourProfiles.length, new Set(keep.dailyHourProfile).size)
  for (const [day, ref] of court.dailyHourProfile.entries()) {
    assert.deepEqual(filtered.hourProfiles[ref], source.hourProfiles[keep.dailyHourProfile[day]])
  }
  const empty = bookingsForPublishedCourts(source, [])
  assert.deepEqual(empty.courts, [])
  assert.deepEqual(empty.hourProfiles, [])
})

test('订场客源在全域独立去重，发布范围改变后仅返回资料完整的场馆',async () => {
  const [history, origins] = await Promise.all(['venue-reservations','venue-booking-origin'].map(async name =>
    JSON.parse(await readFile(new URL('../server/resource-sources/'+name+'.json',import.meta.url),'utf8'))))
  const published = originsForPublishedCourts(origins,history.courts)
  assert.deepEqual(published.overall, origins.overall)
  assert.equal(published.overall.members, published.overall.locatedMembers + published.overall.unknownMembers)
  assert.equal(published.overall.members <= published.venues.reduce((sum,v)=>sum+v.members,0), true)
  for(const counts of [published.overall,...published.venues]){
    assert.equal(counts.records,counts.mobileRecords + counts.nonMobileRecords)
    assert.equal(counts.locatedMembers,counts.regions.reduce((s,r)=>s+r.members,0))
    assert.ok(counts.regions.every(r=>Object.keys(r).sort().join(',')==='city,members,province'))
  }
  const removed=published.venues[0]
  const partial=originsForPublishedCourts(origins,history.courts.filter(c=>c.id!==removed.courtIds[0]))
  assert.equal(partial.overall,null)
  assert.deepEqual(partial.venues.map(v=>v.venueId),published.venues.filter(v=>v.venueId!==removed.venueId).map(v=>v.venueId))
})
