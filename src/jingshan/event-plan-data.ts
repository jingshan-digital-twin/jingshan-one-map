import type { PlannedEvent } from './event-plan-types.ts'

export function eventVenueNames(name:string) {
  const aliases:Record<string,string>={'京山国际网球赛事中心':'京山国际网球中心','文峰网球主题公园':'文峰公园网球场'}
  const registered=name.trim()
  return [registered,aliases[registered]].filter(Boolean)
}

export function parseEventDate(year: number, value: string) {
  const text = value.replace(/\s/g, '').replace(/[—–－~至]/g, '-')
  const match = /^(\d{1,2})月(\d{1,2})日?(?:-(?:(\d{1,2})月)?(\d{1,2})日?)?$/.exec(text)
  if (match) {
    const m = Number(match[1]), d = Number(match[2]), em = Number(match[3] || m), ed = Number(match[4] || d)
    const iso = (month: number, day: number) => `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
    const startDate = iso(m,d), endDate = iso(em,ed)
    if (m >= 1 && em <= 12 && endDate >= startDate && [startDate,endDate].every(s =>
      Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s)) {
      return {startDate,endDate,months:Array.from({length:em-m+1},(_,i)=>m+i),datePrecision:'day' as const}
    }
  }
  const month = /^(\d{1,2})月(?:-(\d{1,2})月)?$/.exec(text)
  if (month && Number(month[1])>=1 && Number(month[2]||month[1])<=12 && Number(month[2]||month[1])>=Number(month[1])) {
    return {startDate:null,endDate:null,months:Array.from({length:Number(month[2]||month[1])-Number(month[1])+1},(_,i)=>Number(month[1])+i),datePrecision:'month' as const}
  }
  return {startDate:null,endDate:null,months:[],datePrecision:'unknown' as const}
}
export function eventCategory(name: string) {
  return /培训|训练营/.test(name) ? '培训' : /考试/.test(name) ? '考试' : /推广活动|趣味|小健将/.test(name) ? '活动' : '赛事'
}
export function eventLevel(name: string) {
  return /ITF|WTA|ATP|世界/.test(name) ? '国际' : /中国|全国/.test(name) ? '全国' : /湖北省/.test(name) ? '省级' : /京山市|华贝杯|绿林/.test(name) ? '群众' : '无'
}
export function isRegisteredCompetition(event:PlannedEvent) {
  return event.category === '赛事' && !event.sample && !event.cancelled
}

export function eventYearSummary(events: PlannedEvent[], year: number, today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})) {
  const rows = events.filter(e=>e.year===year).sort((a,b)=>a.sequence-b.sequence || a.sourceRow-b.sourceRow)
  const competitions = rows.filter(isRegisteredCompetition)
  return { events:rows, count:rows.length, competitionCount:competitions.length,
    completedCompetitionCount:competitions.filter(event => eventCalendarStatus(event,today) === '已完结').length,
    participantTotal: rows.reduce((s,e)=>s+(e.participants??0),0), missingParticipants:rows.filter(e=>e.participants===null).length,
    monthly:Array.from({length:12},(_,i)=>({month:i+1,events:rows.filter(e=>e.months.includes(i+1))})) }
}

export function eventCalendarStatus(event: PlannedEvent, today: string) {
  if (event.reportedStatus === '已办结') return '已完结'
  if (event.reportedStatus === '进行中') return '进行中'
  if (event.endDate && event.endDate < today) return '已完结'
  if (event.startDate && event.startDate > today) return '待开赛'
  if (event.startDate && event.endDate) return '进行中'

  const year = Number(today.slice(0,4)), month = Number(today.slice(5,7))
  if (event.year < year || (event.year === year && event.months.length && Math.max(...event.months) < month)) return '已完结'
  if (event.year > year || (event.year === year && event.months.length && Math.min(...event.months) > month)) return '待开赛'
  return '赛期待定'
}

export function eventIntroduction(event: PlannedEvent) {
  if (event.introduction) return event.introduction
  const venue = event.venueNames.length ? '，计划场馆为' + event.venueNames.join('、') : ''
  const scale = event.participants === null ? '' : '，计划规模' + event.participants + '人'
  return `本项${event.category}列入${event.year}年京山网球赛事活动计划${venue}${scale}。`
}
