// node scripts/import-venue-reservations.mjs <网站历史分场地分时段使用统计.xlsx> [输出.json]
import assert from 'node:assert/strict'
import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { courtViews } from '../src/jingshan/court-ledger.ts'

const input = process.argv[2]
if (!input) throw Error('请指定网站历史分场地分时段使用统计工作簿。')
const sources = fileURLToPath(new URL('../server/resource-sources/', import.meta.url))
const output = process.argv[3] ?? path.join(sources, 'venue-reservations.json')
const book = new ExcelJS.Workbook()
// Open XML SDK writes qualified <x:worksheet> tags. ExcelJS expects the same
// SpreadsheetML elements in the default namespace. Normalize an in-memory copy.
const entries = unzipSync(await readFile(input))
const mainNamespace = 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
for (const [file, bytes] of Object.entries(entries)) {
  if (!file.endsWith('.xml') || !file.startsWith('xl/')) continue
  const xml = strFromU8(bytes)
  if (xml.includes(mainNamespace)) {
    entries[file] = strToU8(xml.replaceAll(mainNamespace,mainNamespace.replace('xmlns:x','xmlns')).replace(/<(\/?)x:/g,'<$1'))
  }
}
await book.xlsx.load(zipSync(entries, {level:0}), {ignoreNodes:['tableParts']})
const ledger = JSON.parse(await readFile(path.join(sources, 'tennis1124.json'), 'utf8'))
const published = courtViews(ledger).find(dataset => dataset.id === 'courts').features

function rows(name, headers) {
  const sheet = book.getWorksheet(name)
  assert.ok(sheet, '工作簿缺少 ' + name)
  assert.deepEqual(sheet.getRow(5).values.slice(1, 1 + headers.length), headers, name + ' 表头变化')
  const values = []
  sheet.eachRow((row, index) => {
    if (index > 5) values.push(row.values.slice(1))
  })
  return values
}
function dateKey(value) {
  const iso = value instanceof Date ? value.toISOString().slice(0,10) : value
  assert.match(iso, /^\d{4}-\d{2}-\d{2}$/)
  return iso
}
const dailyRows = rows('每日分场地时段', ['日期','项目','场地','时段','预约小时','锁场小时','排课小时','跨业务重复小时','合并占用小时','固定容量小时'])
const dates = [...new Set(dailyRows.map(row => dateKey(row[0])))].sort()
assert.ok(dates.length, '缺少逐日统计')
const dayIndex = new Map(dates.map((date, i) => [date,i]))
const dayMs = 86400000
const firstMs = Date.parse(dates[0])
assert.ok(dates.every((date, i) => Date.parse(date) === firstMs + i * dayMs), '逐日统计日期不连续')
const periods = [
  {name:'上午场',startHour:8,endHour:12},
  {name:'下午场',startHour:13,endHour:18},
  {name:'晚上场',startHour:18,endHour:22},
]
const hours = periods.flatMap(p => Array.from({length:p.endHour-p.startHour}, (_,i) => p.startHour+i))
const periodIndex = new Map(periods.map((p,i) => [p.name,i]))

// Website projects use their own names and court numbering; the GIS ledger groups
// Wenfeng Village's courts 24–31 under the training base, and Wenfeng Park separately.
const trainingProjects = new Set(['京山网球训练基地-室内网球馆','京山网球训练基地-室外网球场','京山文峰村网球场'])
function mapCourt(project, sourceName) {
  let name, venue
  if (project === '京山国际网球中心' && sourceName === project) {
    venue = project
    name = '京山国际网球中心室内球场'
  } else {
    const number = /(\d+)号$/.exec(sourceName)?.[1]
    assert.ok(number, '缺少场号 ' + sourceName)
    if (trainingProjects.has(project)) {
      venue = '京山网球训练基地'
      name = venue + number + '号场'
    } else {
      assert.equal(project, '京山文峰公园网球场', '未建立项目与场馆的对应关系')
      venue = '文峰公园网球场'
      name = '文峰公园' + number + '号场'
    }
  }
  const matches = published.filter(c => c.properties.facilityName === venue && c.properties['名称'] === name)
  assert.equal(matches.length, 1, '台账场地缺失或重名 ' + project + ' / ' + sourceName)
  const {id,properties} = matches[0]
  return {id,name,venueId:properties.facilityId,venueName:venue,project,sourceName}
}
const courtKey = (project, name) => project + '/' + name
const courtList = rows('场地清单', ['项目','场地']).map(([project,name]) => mapCourt(project,name))
assert.equal(new Set(courtList.map(c => c.id)).size, courtList.length, '多个网站场地关联到同一场地')
const courts = new Map(courtList.map(c => [courtKey(c.project,c.sourceName),c]))
function lookup(project, name) {
  const court = courts.get(courtKey(project,name))
  assert.ok(court, '场地清单中未登记 ' + project + '/' + name)
  return court
}
const minutesPerDay = 1440
const minutes = new Map(courtList.map(c => [c.id, new Uint8Array(dates.length * minutesPerDay)]))
const booked = 1, locked = 2, lesson = 4
function mark(court, day, session, bit) {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(session)
  assert.ok(match, '场次格式有误 ' + session)
  const [h1,m1,h2,m2] = match.slice(1).map(Number)
  assert.ok(m1 < 60 && m2 < 60 && h1 < 24 && h2 <= 24, '无效场次 ' + session)
  const start = h1*60 + m1
  // Website slots end at :59 or :29 inclusive. Lesson end times are exclusive.
  const end = h2*60 + m2 + Number(bit !== lesson)
  assert.ok(start < end && end <= minutesPerDay, '场次跨日或时长无效 ' + session)
  const mask = minutes.get(court.id)
  const offset = day * minutesPerDay
  for (let m=start; m<end; m++) mask[offset+m] |= bit
}
for (const [date, project, name, session,, state, decision] of rows('历史预约明细', ['场次日期','项目','场地','场次','归属时段','最终状态','统计处理'])) {
  const valid = ['正常','已核销'].includes(state)
  assert.equal(decision, valid ? '计入，按分钟去重' : '不计入', '预约状态与统计口径不符')
  if (!valid) continue
  const day = dayIndex.get(dateKey(date))
  assert.notEqual(day, undefined, '预约日期超出统计范围')
  mark(lookup(project,name), day, session, booked)
}
function expandRule(rule) {
  const match = /^(\d{4}-\d{2}-\d{2})(?: 至 (\d{4}-\d{2}-\d{2}))?(?: 每周([一二三四五六日](?:、[一二三四五六日])*))?$/.exec(rule)
  assert.ok(match, '日期重复规则无法识别 ' + rule)
  const start = Math.max(0, (Date.parse(match[1])-firstMs)/dayMs)
  const end = Math.min(dates.length-1, (Date.parse(match[2] ?? match[1])-firstMs)/dayMs)
  const days = []
  for (let day=start; day<=end; day++) {
    const weekday = new Date(firstMs + day*dayMs).getUTCDay()
    if (!match[3] || match[3].includes('日一二三四五六'[weekday])) days.push(day)
  }
  return days
}
// The normalized worksheet already resolves canceled lessons and expands "all courts".
for (const [,rule,project,name,session,business,state,count] of rows('锁场排课统计明细', ['流水序号','日期及重复规则','项目','场地','场次','业务','操作状态','计入日期数'])) {
  const court = lookup(project,name)
  if (business === '排课' && count === 0) continue
  assert.ok(business === '锁场' || (business === '排课' && state === '员工排课'), '未识别业务 ' + business + '/' + state)
  const days = expandRule(rule)
  assert.equal(days.length, count, '计入日期数不符 ' + rule)
  for (const day of days) mark(court, day, session, business === '锁场' ? locked : lesson)
}

function zero() { return [0,0,0,0,0,0] }
function add(sum, cell) {
  for (let i=0; i<sum.length; i++) sum[i] += cell[i]
  return sum
}
function measureHour(mask, offset) {
  const cell = zero()
  for (let i=offset; i<offset+60; i++) {
    const value = mask[i]
    if (value & booked) cell[0]++
    if (value & locked) cell[1]++
    if (value & lesson) cell[2]++
    if (value & (booked|locked)) cell[3]++
    if (value) cell[4]++
  }
  cell[5] = 60
  return cell
}
const toHours = cell => cell.map(minutes => minutes/60)
const hourProfiles = []
const profileIndex = new Map()
function internHours(cells) {
  const key = JSON.stringify(cells)
  const existing = profileIndex.get(key)
  if (existing !== undefined) return existing
  const index = hourProfiles.push(cells) - 1
  profileIndex.set(key,index)
  return index
}
for (const court of courtList) {
  const mask = minutes.get(court.id)
  const hourly = hours.map(zero)
  court.dailyHourProfile = []
  court.daily = dates.map((_,day) => {
    const bands = periods.map(zero)
    const slots = hours.map((hour,index) => {
      const cell = measureHour(mask, day * minutesPerDay + hour*60)
      add(hourly[index], cell)
      add(bands[periods.findIndex(p => hour >= p.startHour && hour < p.endHour)],cell)
      return cell
    })
    const profile = slots.map(toHours)
    court.dailyHourProfile.push(internHours(profile))
    if (day === dates.length-1) court.latest = profile
    return bands.map(toHours)
  })
  court.hourly = hourly.map(toHours)
}

// Validate at the finest published resolutions; a matching citywide total alone
// would not reveal a court, date or time band being assigned incorrectly.
function verify(actual, expected, location) {
  assert.ok(expected.every((v,i) => Number.isFinite(v) && Math.abs(v-actual[i]) < 0.00001),
    location + ' 对账不符，计算值 ' + actual + '，原表 ' + expected)
}
const seen = new Set()
for (const [date,project,name,period,b,l,c,overlap,occupied,capacity] of dailyRows) {
  const court = lookup(project,name)
  const key = [court.id,dateKey(date),period].join('/')
  assert.ok(!seen.has(key) && periodIndex.has(period), '重复或未识别的日时段 ' + key)
  seen.add(key)
  const day = dayIndex.get(dateKey(date))
  const band = periodIndex.get(period)
  const cell = court.daily[day][band]
  const profile = hourProfiles[court.dailyHourProfile[day]]
  const {startHour,endHour} = periods[band]
  verify(profile.filter((_,i) => hours[i] >= startHour && hours[i] < endHour).reduce(add,zero()), cell,key)
  verify([cell[0],cell[1],cell[2],cell[0]+cell[1]+cell[2]-cell[4],cell[4],cell[5]],
    [b,l,c,overlap,occupied,capacity],key)
}
assert.equal(seen.size, courtList.length*dates.length*periods.length, '逐日时段不完整')
seen.clear()
for (const [project,name,slot,occupied,capacity] of rows('逐小时历史汇总', ['项目','场地','小时段','合并占用小时','固定容量小时'])) {
  const court = lookup(project,name)
  const h = Number(slot.slice(0,2))
  const key = court.id + '/' + slot
  assert.ok(!seen.has(key) && hours.includes(h), '重复或未识别的小时段 ' + key)
  seen.add(key)
  const cell = court.hourly[hours.indexOf(h)]
  verify(court.dailyHourProfile.map(i => hourProfiles[i][hours.indexOf(h)]).reduce(add,zero()),cell,key)
  verify([cell[4],cell[5]], [occupied,capacity],key)
}
assert.equal(seen.size, courtList.length * hours.length, '逐小时统计不完整')
const snapshot = {schema:1,sourceFile:path.basename(input),from:dates[0],through:dates.at(-1),dates,periods,hours,hourProfiles,courts:courtList}
const temp = output + '.' + process.pid + '.tmp'
await writeFile(temp, JSON.stringify(snapshot) + '\n', {flag:'wx'})
await rename(temp, output)
const total = courtList.flatMap(c => c.hourly).reduce(add, zero())
console.log('已核对并导入', courtList.length, '片，', dates.length, '日。预约、锁场、排课、预约含锁场、全部占用、容量（片时）', total)
