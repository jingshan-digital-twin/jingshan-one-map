import type { BookingCell, BookingSnapshot } from './venue-reservation-data.ts'

export type BookingMetrics = {
  booked: number
  locked: number
  lessons: number
  reserved: number
  occupied: number
  capacity: number
  overlap: number
  rate: number | null
  bookedRate: number | null
  occupiedRate: number | null
}
export type BookingPeriodRow = BookingMetrics & {label:string; hours:string}
export type BookingHourRow = BookingMetrics & {hour:number; label:string}
export type BookingDayRow = BookingMetrics & {date:string}
export type BookingCourtRow = BookingMetrics & {
  id:string; name:string; project:string; sourceName:string; periods:BookingPeriodRow[]; hourly:BookingHourRow[]
}
export type BookingOptions = {month?:string; date?:string; courtId?:string; project?:string}
type Court = BookingSnapshot['courts'][number]
type Period = BookingSnapshot['periods'][number]

// Source durations are retained for workbook reconciliation. All display rates
// use the union of occupied minutes for each individual court.
const empty = (): BookingCell => [0, 0, 0, 0, 0, 0]
function add(total: BookingCell, cell: BookingCell) {
  for (let i = 0; i < total.length; i++) total[i] += cell[i]
}
function metrics([booked, locked, lessons, reserved, occupied, capacity]: BookingCell): BookingMetrics {
  const percent = (hours: number) => capacity ? 100 * hours / capacity : null
  return {
    booked, locked, lessons, reserved, occupied, capacity,
    overlap: booked + locked - reserved,
    rate: percent(occupied),
    bookedRate: percent(booked),
    occupiedRate: percent(occupied),
  }
}
const clockHour=(hour:number)=>String(hour).padStart(2,'0')+':00'
const timeBand=(from:number,until:number)=>clockHour(from)+'–'+clockHour(until)
function periodRow(period:Period, cell:BookingCell):BookingPeriodRow {
  return {...metrics(cell),label:period.name,hours:timeBand(period.startHour,period.endHour)}
}
function hourRow(hour:number, cell:BookingCell):BookingHourRow {
  return {...metrics(cell),hour,label:timeBand(hour,hour+1)}
}
const fmtHours=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2})
const percent=(n:number)=>n.toFixed(1)+'%'

/** Each venue is listed once, including when the booking site splits it into projects. */
export function bookingVenueDirectory(history:BookingSnapshot) {
  const venues=new Map<string,{id:string;name:string;courtCount:number;projects:Set<string>}>()
  for(const court of history.courts){
    let venue=venues.get(court.venueId)
    if(!venue){
      venue={id:court.venueId,name:court.venueName,courtCount:0,projects:new Set()}
      venues.set(venue.id,venue)
    }
    venue.courtCount++
    venue.projects.add(court.project)
  }
  return [...venues.values()].map(venue=>({...venue,projects:[...venue.projects]}))
    .sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'))
}

const sameRate = (a: number, b: number) => Math.abs(a - b) < 1e-8
function hourRanges(rows: BookingHourRow[]) {
  const ranges: { from: number; until: number }[] = []
  for (const { hour } of rows) {
    const last = ranges.at(-1)
    if (last?.until === hour) last.until = hour + 1
    else ranges.push({ from: hour, until: hour + 1 })
  }
  return ranges.map(range => timeBand(range.from, range.until)).join('、')
}

function bookingInsights(totals: BookingMetrics, periods: BookingPeriodRow[], hourly: BookingHourRow[]): string[] {
  if (!totals.capacity) return ['所选期间缺少统计时长，无法计算占用率。']
  if (!totals.occupied) return [
    `所选期间共 ${fmtHours.format(totals.capacity)} 场地小时，均未记录占用。可先核对实际开放排期，再安排试用活动并观察占用变化。`,
  ]
  const statements: string[] = []
  const hours = hourly.filter(hour => hour.capacity > 0)
  const bands = periods.filter(band => band.capacity > 0)
  const candidates = hours.length ? hours : bands
  if (!candidates.length) return statements
  const highest = Math.max(...candidates.map(row => row.rate!))
  const lowest = Math.min(...candidates.map(row => row.rate!))
  if (candidates.length === 1) {
    return [`${candidates[0].label} 占用率为 ${percent(highest)}，其余时段缺少统计时长。`]
  }
  if (sameRate(highest, lowest)) {
    return [`各时段占用率均为 ${percent(highest)}，本期没有集中高峰。`]
  }
  const names = (rate: number) => hours.length
    ? hourRanges(hours.filter(hour => sameRate(hour.rate!, rate)))
    : bands.filter(band => sameRate(band.rate!, rate)).map(band => band.label + '（' + band.hours + '）').join('、')
  statements.push(`${names(highest)} 占用率最高，为 ${percent(highest)}。新增团体活动可优先安排在其他时段。`)
  const quiet = candidates.filter(row => sameRate(row.rate!, lowest))
  const unused = quiet.reduce((total, row) => total + row.capacity - row.occupied, 0)
  const action = lowest === 0
    ? '可对照场地时间表核实开放安排，评估是否具备增开场次的条件。'
    : '核对开放排期后，可在这些时段试办入门课或社群活动，并比较活动前后的占用率。'
  statements.push(`${names(lowest)} 占用率最低，为 ${percent(lowest)}，合计 ${fmtHours.format(unused)} 场地小时未记录占用。${action}`)
  return statements
}

const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
type HourSource = 'hourly' | 'latest' | 'dailyProfiles' | null
function aggregate(history: BookingSnapshot, courts: Court[], indices: number[], hourSource: HourSource) {
  const total = empty()
  const periods = history.periods.map(empty)
  const hours = history.hours.map(empty)
  const dayCells = indices.map(empty)
  const months = new Map<string, BookingCell>()
  const weekdays = weekdayNames.map(() => history.periods.map(empty))
  const weekdayHours = weekdayNames.map(() => history.hours.map(empty))
  const incompleteWeekdays = new Set<number>()
  const weekdayForDay = indices.map(i => new Date(history.dates[i] + 'T00:00:00Z').getUTCDay())
  const monthForDay = indices.map(i => {
    const month = history.dates[i].slice(0, 7)
    if (!months.has(month)) months.set(month, empty())
    return months.get(month)!
  })
  const courtRows: BookingCourtRow[] = courts.map(court => {
    const sum = empty()
    const bands = history.periods.map(empty)
    const selectedHours = hourSource === 'dailyProfiles' ? history.hours.map(empty) : []
    indices.forEach((day, selectedIndex) => {
      const weekday = weekdayForDay[selectedIndex]
      for (const [periodIndex, cell] of court.daily[day].entries()) {
        add(dayCells[selectedIndex], cell)
        add(monthForDay[selectedIndex], cell)
        add(weekdays[weekday][periodIndex], cell)
        add(bands[periodIndex], cell)
        add(sum, cell)
      }
      const profileId = court.dailyHourProfile?.[day]
      const dayHours = profileId === undefined ? undefined : history.hourProfiles?.[profileId]
      const cells = dayHours ?? (history.dates[day] === history.through ? court.latest : undefined)
      if (!cells || cells.length !== history.hours.length) {
        incompleteWeekdays.add(weekday)
        return
      }
      cells.forEach((cell, i) => {
        add(weekdayHours[weekday][i], cell)
        if (selectedHours.length) add(selectedHours[i], cell)
      })
    })
    add(total, sum)
    bands.forEach((band, i) => add(periods[i], band))
    const hourlyCells = hourSource === 'hourly' || hourSource === 'latest' ? court[hourSource] : selectedHours
    const hourly = hourlyCells.map((cell, i) => {
      add(hours[i], cell)
      return hourRow(history.hours[i], cell)
    })
    return {
      id: court.id, name: court.name, project: court.project, sourceName: court.sourceName,
      ...metrics(sum), periods: bands.map((band, i) => periodRow(history.periods[i], band)), hourly,
    }
  })
  return {
    totals: metrics(total),
    periods: periods.map((cell, i) => periodRow(history.periods[i], cell)),
    courts: courtRows,
    hourly: hourSource ? hours.map((cell, i) => hourRow(history.hours[i], cell)) : [],
    days: dayCells.map((cell, i) => ({ date: history.dates[indices[i]], ...metrics(cell) })),
    monthly: [...months].map(([month, cell]) => ({ month, ...metrics(cell) })),
    weekdays: [1, 2, 3, 4, 5, 6, 0].map(i => ({
      label: weekdayNames[i],
      periods: weekdays[i].map((cell, p) => periodRow(history.periods[p], cell)),
      hourly: weekdayHours[i].map((cell, h) => hourRow(history.hours[h], incompleteWeekdays.has(i) ? empty() : cell)),
    })),
  }
}

export function analyzeVenueBookings(history: BookingSnapshot, venueId: string, options: BookingOptions = {}) {
  const courts = history.courts.filter(court => court.venueId === venueId
    && (!options.courtId || court.id === options.courtId)
    && (!options.project || court.project === options.project))
  if (!courts.length || !history.dates.length) return
  const latestIndex = history.dates.indexOf(history.through)
  if (latestIndex < 0) return

  const indices = history.dates.flatMap((date, i) => {
    if (options.date && date !== options.date) return []
    if (options.month && date.slice(0, 7) !== options.month) return []
    return [i]
  })
  let hourSource: HourSource = null
  if (indices.length === history.dates.length) hourSource = 'hourly'
  else if (indices.length === 1 && indices[0] === latestIndex) hourSource = 'latest'
  else if (indices.length && history.hourProfiles && courts.every(court => court.dailyHourProfile)) hourSource = 'dailyProfiles'
  const result = aggregate(history, courts, indices, hourSource)
  const latest = hourSource === 'latest' ? result : aggregate(history, courts, [latestIndex], 'latest')
  return {
    ...result,
    startDate: indices.length ? history.dates[indices[0]] : '',
    endDate: indices.length ? history.dates[indices.at(-1)!] : '',
    months: [...new Set(history.dates.map(date => date.slice(0, 7)))],
    snapshotDate: history.through,
    projects: [...new Set(courts.map(court => court.project))],
    courtCount: courts.length,
    latest: { date: history.through, totals: latest.totals, periods: latest.periods, courts: latest.courts, hourly: latest.hourly },
    insights: bookingInsights(result.totals, result.periods, result.hourly),
  }
}

export type VenueBookingAnalysis = NonNullable<ReturnType<typeof analyzeVenueBookings>>
