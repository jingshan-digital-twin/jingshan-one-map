import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeVenueBookings, bookingVenueDirectory } from '../src/jingshan/venue-booking-analysis.ts'

const free = [0, 0, 0, 0, 0, 1]
const booked = [1, 0, 0, 1, 1, 1]
const locked = [0, 1, 0, 1, 1, 1]
const overlap = [1, 1, 0, 1, 1, 1]
const lesson = [0, 0, 1, 0, 1, 1]
const absent = [0, 0, 0, 0, 0, 0]
const sum = (a, b) => a.map((value, i) => value + b[i])
function court(id, venueId, project, first, second) {
  return { id, venueId, name: id, venueName: venueId, project, sourceName: id,
    daily: [first, second], hourly: first.map((cell, i) => sum(cell, second[i])), latest: second }
}
const history = {
  schema: 1, from: '2026-10-31', through: '2026-11-24', dates: ['2026-10-31', '2026-11-24'],
  periods: [{ name: '上午', startHour: 8, endHour: 9 }, { name: '下午', startHour: 13, endHour: 14 }],
  hours: [8, 13],
  courts: [
    court('C1', 'V1', '项目甲', [overlap, lesson], [booked, free]),
    court('C2', 'V1', '项目乙', [locked, absent], [free, free]),
    court('C3', 'V2', '项目丙', [locked, locked], [locked, locked]),
  ],
}

test('只列台账中有关联记录的场馆，跨网站项目按正式场馆 ID 去重', () => {
  assert.deepEqual(bookingVenueDirectory(history), [
    { id: 'V1', name: 'V1', courtCount: 2, projects: ['项目甲', '项目乙'] },
    { id: 'V2', name: 'V2', courtCount: 1, projects: ['项目丙'] },
  ])
  assert.equal(analyzeVenueBookings(history, '无记录'), undefined)
  assert.equal(analyzeVenueBookings(history, 'V2', { courtId: 'C1' }), undefined)
})

test('占用率包含所有占用类型，同场同时段去重，无统计容量留空', () => {
  const result = analyzeVenueBookings(history, 'V1')
  assert.deepEqual(result.totals, {
    booked: 2, locked: 2, lessons: 1, overlap: 1, reserved: 3, occupied: 4, capacity: 7,
    rate: 400 / 7, bookedRate: 200 / 7, occupiedRate: 400 / 7,
  })
  assert.deepEqual(result.periods.map(p => [p.label, p.hours, p.rate]), [
    ['上午', '08:00–09:00', 75], ['下午', '13:00–14:00', 100 / 3],
  ])
  assert.deepEqual(result.days.map(d => [d.date, d.occupied, d.capacity]), [
    ['2026-10-31', 3, 3], ['2026-11-24', 1, 4],
  ])
  assert.deepEqual(result.months, ['2026-10', '2026-11'])
  assert.deepEqual(result.monthly.map(d => [d.month, d.rate]), [['2026-10', 100], ['2026-11', 25]])
  assert.equal(result.weekdays.find(d => d.label === '周二').periods[0].rate, 50)
  assert.equal(result.weekdays.find(d => d.label === '周三').periods[0].rate, null)
  assert.deepEqual(result.hourly.map(h => [h.hour, h.rate]), [[8, 75], [13, 100 / 3]])
  assert.match(result.insights.join(' '), /08:00–09:00 占用率最高，为 75\.0%/)
  assert.doesNotMatch(result.insights.join(' '), /预订|订单|锁场|散客/)
})

test('筛选历史月份和网站项目后，仍能查看该项目真实截至日的逐场逐时状态', () => {
  const result = analyzeVenueBookings(history, 'V1', { month: '2026-10', project: '项目甲' })
  assert.equal(result.startDate, '2026-10-31')
  assert.equal(result.endDate, '2026-10-31')
  assert.deepEqual(result.projects, ['项目甲'])
  assert.equal(result.totals.rate, 100)
  assert.equal(result.totals.occupiedRate, 100)
  assert.deepEqual(result.hourly, [])
  assert.equal(result.latest.date, '2026-11-24')
  assert.equal(result.latest.courts.length, 1)
  assert.deepEqual(result.latest.courts[0].hourly.map(h => [h.booked, h.locked, h.lessons, h.capacity]), [
    [1, 0, 0, 1], [0, 0, 0, 1],
  ])
  const lastDay = analyzeVenueBookings(history, 'V1', { date: history.through })
  assert.deepEqual(lastDay.hourly, lastDay.latest.hourly)
  const early = analyzeVenueBookings(history, 'V1', { courtId: 'C2', date: '2026-10-31' })
  assert.equal(early.periods[1].rate, null)
  assert.equal(early.totals.rate, 100)
  assert.equal(early.courtCount, 1)
  const missing = analyzeVenueBookings(history, 'V1', { date: '2026-10-01' })
  assert.equal(missing.totals.rate, null)
  assert.deepEqual(missing.days, [])
  assert.deepEqual(missing.hourly, [])
  assert.equal(missing.latest.totals.rate, 25)
})

test('全历史逐小时等于各天相加，月份筛选和日期、项目筛选均按真实模板累计', () => {
  const hourProfiles = []
  const enriched = {
    ...history,
    dates: ['2026-10-30', '2026-10-31', '2026-11-24'],
    hourProfiles,
    courts: history.courts.map(court => {
      const newDay = [free, booked]
      const daily = [newDay, ...court.daily]
      const dailyHourProfile = daily.map(cells => hourProfiles.push(cells) - 1)
      return { ...court, daily, dailyHourProfile, hourly: court.hourly.map((cell, i) => sum(cell, newDay[i])) }
    }),
  }
  const venue = analyzeVenueBookings(enriched, 'V1')
  const days = enriched.dates.map(date => analyzeVenueBookings(enriched, 'V1', { date }))
  for (const [i, hour] of venue.hourly.entries()) {
    for (const key of ['booked', 'locked', 'lessons', 'reserved', 'occupied', 'capacity']) {
      assert.equal(hour[key], days.reduce((total, day) => total + day.hourly[i][key], 0))
    }
  }
  const october = analyzeVenueBookings(enriched, 'V1', { month: '2026-10' })
  assert.deepEqual(october.hourly.map(h => [h.occupied, h.capacity]), [[2, 4], [3, 3]])
  assert.equal(october.hourly.reduce((total, row) => total + row.occupied, 0), october.totals.occupied)
  const first = analyzeVenueBookings(enriched, 'V1', { month: '2026-10', date: '2026-10-31', project: '项目甲' })
  assert.deepEqual(first.courts[0].hourly.map(h => [h.booked, h.locked, h.lessons]), [[1, 1, 0], [0, 0, 1]])
  assert.deepEqual(first.courts[0].hourly, first.hourly)
  assert.deepEqual(analyzeVenueBookings(enriched, 'V1', { date: '2026-10-01' }).hourly, [])
})

test('并列占用高峰合并连续小时，平坦或未占用时不虚构高低峰', () => {
  const halfBooked = [0.5, 0, 0, 0.5, 0.5, 1]
  const halfLocked = [0, 0.5, 0, 0.5, 0.5, 1]
  const hours = [8, 9, 10, 13, 14]
  const snapshot = (cells) => {
    const single = court('C1', 'V1', '项目甲', cells, cells)
    return {
      ...history, hours,
      periods: hours.map(h => ({ name: h + '时', startHour: h, endHour: h + 1 })),
      courts: [single],
    }
  }
  const tied = analyzeVenueBookings(snapshot([booked, lesson, halfLocked, locked, halfBooked]), 'V1')
  assert.match(tied.insights[0], /08:00–10:00、13:00–14:00/)
  const offPeak = tied.insights.find(line => line.includes('试办入门课'))
  assert.match(offPeak, /10:00–11:00、14:00–15:00/)
  assert.doesNotMatch(offPeak, /08:00–10:00|13:00–14:00/)
  const flat = analyzeVenueBookings(snapshot(hours.map(() => halfBooked)), 'V1')
  assert.match(flat.insights[0], /各时段占用率均为 50\.0%/)
  assert.doesNotMatch(flat.insights.join(' '), /最高|最低/)
  const vacant = analyzeVenueBookings(snapshot(hours.map(() => free)), 'V1')
  assert.match(vacant.insights[0], /均未记录占用/)
  const fullLessons = analyzeVenueBookings(snapshot(hours.map(() => lesson)), 'V1')
  assert.equal(fullLessons.totals.occupiedRate, 100)
  assert.doesNotMatch(fullLessons.insights.join(' '), /试办/)
})

test('星期和小时交叉以时长加权汇总，同一星期含不完整日的旧历史留空', () => {
  const dates = ['2026-10-24', '2026-10-31', '2026-11-24'] // two Saturdays, then Tuesday
  const oldCourt = court('C1', 'V1', '项目甲', [booked, lesson], [free, locked])
  const a = {...oldCourt, daily:[[booked, lesson],[free, absent],[free, locked]], dailyHourProfile:[0,1,2]}
  const b = {...a, id:'C2', daily:[[absent, booked],[free, absent],[lesson, free]], dailyHourProfile:[3,1,4], latest:[lesson, free]}
  const historyWithHours = {...history, dates, courts:[a,b],
    hourProfiles:[a.daily[0], a.daily[1], a.daily[2], b.daily[0], b.daily[2]]}
  const report = analyzeVenueBookings(historyWithHours, 'V1', {month:'2026-10'})
  const saturday = report.weekdays.find(w => w.label === '周六')
  assert.deepEqual(saturday.hourly.map(h => [h.hour, h.occupied, h.capacity, h.rate]), [[8,1,3,100/3],[13,2,2,100]])
  assert.ok(report.weekdays.filter(w => w.label !== '周六').every(w => w.hourly.every(h => h.rate === null)))
  const subset = analyzeVenueBookings(historyWithHours, 'V1', {date:dates[2], courtId:'C1'})
  assert.deepEqual(subset.weekdays.find(w => w.label === '周二').hourly.map(h => h.rate), [0,100])
  const partial = {...history, dates:['2026-11-17', '2026-11-24']} // both Tuesdays, latest only
  const unknown = analyzeVenueBookings(partial, 'V1')
  assert.ok(unknown.weekdays.every(w => w.hourly.every(h => h.rate === null)))
})
