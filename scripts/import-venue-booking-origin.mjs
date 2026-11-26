// node scripts/import-venue-booking-origin.mjs <约场记录.xlsx> [本地离线号段库86.txt] [输出.json]
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'

const [input, prefixFile, outputArg] = process.argv.slice(2)
if (!input) throw Error('请指定网站约场记录工作簿。')
const sources = fileURLToPath(new URL('../server/resource-sources/',import.meta.url))
const output = outputArg ?? path.join(sources,'venue-booking-origin.json')
// The only network resource used is the public, pinned region dictionary. Member
// data and number prefixes from the workbook never leave the import process.
const version = 'v9.0.44'
const reference = 'https://raw.githubusercontent.com/google/libphonenumber/' + version + '/resources/geocoding/zh/86.txt'
const digest = '84f2a61d97fff3e7da010957c831837ce85c9a0a4fdba66fa422d1fde040d34b'
async function loadPrefixes() {
  const response = prefixFile ? null : await fetch(reference,{signal:AbortSignal.timeout(30000)})
  if (response && !response.ok) throw Error('公共号段库下载失败，可改用同版本的本地 86.txt')
  const bytes = prefixFile ? await readFile(prefixFile) : Buffer.from(await response.arrayBuffer())
  assert.equal(createHash('sha256').update(bytes).digest('hex'),digest,'号段库校验失败')
  const data = new Map()
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    if (!line.startsWith('861')) continue
    const [prefix, region] = line.split('|')
    data.set(prefix,region)
  }
  return data
}

function cityRegion(name) {
  const municipality = /^(北京|上海|天津|重庆)市?$/.exec(name)
  if (municipality) {
    const city = municipality[1] + '市'
    return {province:city,city}
  }
  const match = /^(.+?省|内蒙古|广西|宁夏|新疆|西藏)(.+)$/.exec(name)
  assert.ok(match,'无法拆分号段地名 ' + name)
  const [,province,city] = match
  // The upstream Zh table retains the previous name of Xiangyang, Hubei.
  return {province,city:province === '湖北省' && city === '襄樊市' ? '襄阳市' : city}
}

function mobileNumber(value) {
  const compact = String(value ?? '').normalize('NFKC').trim().replace(/[\s()-]/g,'')
  const number = compact.replace(/^(?:\+86|0086)(?=1[3-9]\d{9}$)/,'')
  return /^1[3-9]\d{9}$/.test(number) ? number : null
}

function group() {
  return {records:0,mobileRecords:0,phones:new Set(),courtIds:new Set()}
}
function record(counts, phone, courtId) {
  counts.records++
  counts.courtIds.add(courtId)
  if (phone) {
    counts.mobileRecords++
    counts.phones.add(phone)
  }
}
function totals(counts, lookup) {
  const cities = new Map()
  let unknownMembers = 0
  for (const phone of counts.phones) {
    const region = lookup.get(phone)
    if (!region) { unknownMembers++; continue }
    const key = region.province + '/' + region.city
    const row = cities.get(key) ?? {...region,members:0}
    row.members++
    cities.set(key,row)
  }
  const regions = [...cities.values()].sort((a,b) =>
    b.members-a.members || a.province.localeCompare(b.province,'zh-CN') || a.city.localeCompare(b.city,'zh-CN'))
  const locatedMembers = regions.reduce((n,row) => n + row.members,0)
  assert.equal(locatedMembers + unknownMembers,counts.phones.size)
  return {records:counts.records,mobileRecords:counts.mobileRecords,nonMobileRecords:counts.records-counts.mobileRecords,
    members:counts.phones.size,locatedMembers,unknownMembers,regions}
}
function bookingDate(value) {
  const iso = value instanceof Date ? value.toISOString().slice(0,10) : String(value).trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && Number.isFinite(Date.parse(iso))
    && new Date(iso).toISOString().slice(0,10) === iso ? iso : null
}

const prefixes = await loadPrefixes()
const bookings = JSON.parse(await readFile(path.join(sources,'venue-reservations.json'),'utf8'))
const directory = new Map(bookings.courts.map(court => [court.project + '/' + court.sourceName,court]))
const workbook = new ExcelJS.Workbook()
await workbook.xlsx.readFile(input)
const required = ['会员手机号','预约日期','所属场馆','实体名称','预约状态']
const sheet = workbook.worksheets.find(s => required.every(name => s.getRow(1).values.includes(name)))
assert.ok(sheet,'缺少约场明细表或列名发生变化')
const headers = sheet.getRow(1).values
const all = group(), venues = new Map(), dates = new Set()
sheet.eachRow((row,index) => {
  if (index === 1 || !row.values.some(v => v != null && String(v).trim() !== '')) return
  const value = name => row.getCell(headers.indexOf(name)).value
  const state = String(value('预约状态') ?? '').trim()
  if (['已取消','待支付'].includes(state)) return
  assert.ok(['正常','已核销'].includes(state),'未识别的约场状态，第 ' + index + ' 行')
  const court = directory.get(String(value('所属场馆')).trim() + '/' + String(value('实体名称')).trim())
  assert.ok(court,'第 ' + index + ' 行无法匹配当前预约场馆及场地')
  const date = bookingDate(value('预约日期'))
  assert.ok(date,'第 ' + index + ' 行预约日期无效')
  dates.add(date)
  const phone = mobileNumber(value('会员手机号'))
  record(all,phone,court.id)
  let venue = venues.get(court.venueId)
  if (!venue) {
    venue = {venueId:court.venueId,venueName:court.venueName,counts:group()}
    venues.set(court.venueId,venue)
  }
  record(venue.counts,phone,court.id)
})
assert.ok(all.records > 0,'未找到有效订场记录')
const lookup = new Map()
for (const phone of all.phones) {
  const international = '86' + phone
  for (let length=international.length; length>=3; length--) {
    const region = prefixes.get(international.slice(0,length))
    if (region) { lookup.set(phone,cityRegion(region)); break }
  }
}
const range = [...dates].sort()
// Group by the exact set of visited venues. A union of these disjoint groups
// can answer any town selection without publishing numbers or identifiers.
const memberships = new Map()
for (const venue of venues.values()) {
  for (const phone of venue.counts.phones) {
    const ids = memberships.get(phone) ?? []
    ids.push(venue.venueId)
    memberships.set(phone,ids)
  }
}
const combinations = new Map()
for (const [phone,ids] of memberships) {
  const key = JSON.stringify(ids.sort())
  const combination = combinations.get(key) ?? {venueIds:ids,counts:group()}
  combination.counts.phones.add(phone)
  combinations.set(key,combination)
}
const snapshot = {
  schema:1,sourceFile:path.basename(input),from:range[0],through:range.at(-1),
  lookupSource:'Google libphonenumber ' + version + ' 中文号段库', lookupUrl:reference,
  overall:totals(all,lookup),
  cohorts:[...combinations.values()].map(({venueIds,counts}) => {
    const {members,locatedMembers,unknownMembers,regions} = totals(counts,lookup)
    return {venueIds,members,locatedMembers,unknownMembers,regions}
  }),
  venues:[...venues.values()].map(v => ({
    venueId:v.venueId,venueName:v.venueName,courtIds:[...v.counts.courtIds].sort(),...totals(v.counts,lookup),
  })).sort((a,b) => a.venueName.localeCompare(b.venueName,'zh-CN')),
}
const temporary = output + '.' + process.pid + '.tmp'
await writeFile(temporary, JSON.stringify(snapshot) + '\n', {flag:'wx'})
await rename(temporary,output)
console.log('已汇总 %d 个场次、%d 个去重手机号，%d 个匹配到归属城市。',all.records,all.phones.size,snapshot.overall.locatedMembers)
