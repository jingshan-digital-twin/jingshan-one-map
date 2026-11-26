import sourceRows from './event-sources/tourism-events-20261120.json' with { type: 'json' }
import { eventCategory, eventVenueNames, parseEventDate } from '../src/jingshan/event-plan-data.ts'
import { activeCourtSource, courtViews } from '../src/jingshan/court-ledger.ts'
import { eventPlanDatasetId } from '../src/jingshan/event-platform-data.ts'
import { featureCenter, type CityFeature, type Coordinate, type DataDocument, type Dataset, type FormField } from '../src/jingshan/types.ts'
import { checkDataset } from '../src/jingshan/validate.ts'

export const tourismCalendarRegisterId = 'form_tourism_event_check_2026'
const sourceFile = '11.20 （文旅）京山市网旅产业“一张图”数据.xlsx'
const sourceSheet = '网球赛事'
const year = 2026
const levels:Record<string,string> = {国家:'全国', '省中心':'省级', '省':'省级', 本地:'群众', 国际:'国际'}
type SourceRow = (typeof sourceRows)[number]
type VenueEvidence = { venue:string; title:string; url:string; note?:string }
const wenfeng = '文峰公园网球场'
const base = '京山网球训练基地'
const localReports = 'https://www.jswq.net/h-col-107.html'
const venueEvidence:Record<number,VenueEvidence> = {
  1:{venue:wenfeng,title:'京山网球 · 京山春节赛事现场直击（2月21日至23日）',url:'https://www.jswq.net/h-nd-535.html'},
  2:{venue:wenfeng,title:'湖北日报 · 2026年湖北省青少年网球巡回赛首站在京山圆满收官',url:'https://news.hubeidaily.net/mobile/c_5227672.html'},
  3:{venue:wenfeng,title:'京山网球 · 2026李宁京山杯青少年积分赛第一站收官',url:localReports},
  4:{venue:wenfeng,title:'京山网球 · 第二十八届华贝杯暨春季联赛收官',url:localReports},
  5:{venue:wenfeng,title:'京山网球 · 京山之星分站赛第一站收官',url:localReports},
  6:{venue:base,title:'京山网球 · 2026年全国体育单招网球专项考试考生须知',url:'https://jswq.net/h-nd-548.html'},
  7:{venue:wenfeng+'、'+base,title:'京山网球 · 2026年ITF国际网球大师赛MT400京山站补充通知',url:'https://jswq.net/h-nd-552.html'},
  13:{venue:base,title:'2026HEAD超新星网球冠军赛京山站圆满收拍',url:'https://news.sina.cn/sx/2026-06-01/detail-inhzwuht2479730.d.html?wm=3049_0015'},
  16:{venue:base,title:'2026 YONEX郑洁杯京山站竞赛规程',url:'https://www.zhengjiebei.com/leaguedetail?leagueid=89'},
  25:{venue:base,title:'京山市融媒体中心 · 中国青少年网球城市挑战赛中部大区赛开赛',url:'https://www.jrjingshan.com/m/a/sz/2026/0818/77536.html'},
  34:{venue:'京山国际网球赛事中心',title:'京山市融媒体中心 · 2026京网黄金赛季盛大启幕',url:'https://www.jrjingshan.com/m/a/baodao/2026/0929/78230.html'},
  41:{venue:base,title:'湖北日报 · 第五届世界青少年软式网球锦标赛开赛',url:'https://news.hubeidaily.net/pc/c_6121066.html'},
  42:{venue:wenfeng,title:'农村新报 · 京网黄金赛季系列活动9月启航',url:'https://ncxbepaper.hubeidaily.net/pc/content/202608/22/content_356466.html'},
  47:{venue:base,title:'中国新闻网 · 全国青少年网球排名总决赛湖北京山开赛',url:'https://www.chinanews.com.cn/ty/2026/11-21/10735744.shtml',note:'11月21日在京山网球训练基地开赛；原表申报开赛日为11月22日。'},
}
const fields:FormField[] = [
  {key:'reviewStatus',label:'核对状态',type:'select',options:['待核计划','待核差异','已核对'],required:true},
  {key:'differences',label:'核对项目',type:'text'},
  {key:'sequence',label:'原表序号',type:'number'},
  {key:'monthText',label:'原表月份',type:'text'},
  {key:'dateText',label:'原表申报赛期',type:'text'},
  {key:'category',label:'活动类型',type:'text'},
  {key:'sourcePeople',label:'文旅表规模（人）',type:'number'},
  {key:'calendarPeople',label:'比对时赛历规模（人）',type:'number'},
  {key:'sourceLevel',label:'文旅表级别',type:'text'},
  {key:'calendarLevel',label:'比对时赛历级别',type:'text'},
  {key:'venueText',label:'举办场馆',type:'text'},
  {key:'positionSource',label:'点位来源',type:'text'},
  {key:'venueSource',label:'场馆核实来源',type:'text'},
  {key:'venueSourceUrl',label:'场馆资料链接',type:'text'},
  {key:'host',label:'主办单位',type:'text'},
  {key:'planId',label:'年度赛历关联编号',type:'text'},
  {key:'reviewNotes',label:'核对备注',type:'textarea'},
  {key:'sourceRow',label:'原表行号',type:'number'},
]

function eventKey(name:string, date:string) {
  const normalized = name.normalize('NFKC').replace(/^2026年/u,'').replace(/[\s\p{P}]/gu,'')
  const {startDate,endDate} = parseEventDate(year,date)
  return JSON.stringify([normalized,startDate ?? date.trim(),endDate])
}
function empty(value:unknown) {
  return !String(value??'').trim() || value==='无' || value==='未填' || value==='待定'
}
function compare(row:SourceRow, plan:CityFeature|undefined, evidence:VenueEvidence|undefined) {
  const p = plan?.properties
  const differences:string[] = []
  if (p && p.participants !== row.people) differences.push('规模')
  if (p && !empty(p.level) && !String(p.level).startsWith(levels[row.level] ?? row.level)) differences.push('级别')
  if (evidence?.note) differences.push('赛期')
  return differences.join('、')
}

export function withTourismCalendar(doc:DataDocument):DataDocument {
  if (doc.datasets.some(d=>d.id===tourismCalendarRegisterId)) return doc
  const plans = doc.datasets.find(d=>d.id===eventPlanDatasetId)
  const courtSource = activeCourtSource(doc)
  const venues = (courtSource?.features.length ? courtViews(courtSource) : doc.datasets).find(d=>d.id==='venues')
  const positions = new Map<string,Coordinate>()
  for (const venue of venues?.features ?? []) {
    if (venue.properties.sample===true) continue
    const point = featureCenter(venue)
    if (point) positions.set(venue.properties.name,point)
  }
  const index = new Map<string,CityFeature[]>()
  for (const plan of plans?.features ?? []) {
    if (plan.properties.year!==year || plan.properties.sample===true) continue
    const key = eventKey(plan.properties.name,String(plan.properties.dateText ?? ''))
    const matches = index.get(key) ?? []
    matches.push(plan)
    index.set(key,matches)
  }
  const updates = new Map<string,CityFeature>()
  const records = sourceRows.map((row):CityFeature=>{
    const matches = index.get(eventKey(row.name,row.date)) ?? []
    const plan = matches.length===1 ? matches[0] : undefined
    const p = plan?.properties
    const evidence = venueEvidence[row.sequence]
    const differences = compare(row,plan,evidence)
    if (plan && p) {
      const patch:Record<string,unknown> = {}
      if (empty(p.level)) {
        patch.level = levels[row.level] ?? row.level
        patch.tourismLevelSource = sourceFile+' · '+sourceSheet+' 第'+(row.sequence+2)+'行'
      }
      if (evidence && empty(p.venueText)) {
        patch.venueText = evidence.venue
        const previousSources = Array.isArray(p.sources) ? p.sources : []
        patch.sources = [...previousSources,{title:evidence.title,url:evidence.url,fields:['举办场馆']}]
      }
      if (Object.keys(patch).length) updates.set(plan.id,{...plan,properties:{...p,...patch}})
    }
    const venueText = String(!empty(p?.venueText) ? p?.venueText : evidence?.venue ?? '')
    const points = venueText.split('、').flatMap(name=>{
      const point = eventVenueNames(name).map(alias=>positions.get(alias)).find(Boolean)
      return point ? [point] : []
    })
    const geometry:CityFeature['geometry'] = points.length===1 ? {type:'Point',coordinates:points[0]}
      : points.length>1 ? {type:'MultiPoint',coordinates:points} : {type:'GeometryCollection',geometries:[]}
    return {
      type:'Feature',id:'tourism-event-check-2026-'+row.sequence,
      geometry,
      properties:{name:row.name,region:'京山市',kind:'form_record',
        reviewStatus:!plan?'待核计划':differences?'待核差异':'已核对',
        differences, sequence:row.sequence, sourceRow:row.sequence+2, monthText:row.month, dateText:row.date,
        category:p?.category??eventCategory(row.name), sourcePeople:row.people, calendarPeople:p?.participants,
        sourceLevel:row.level, calendarLevel:p?.level, venueText, host:row.host,
        positionSource:points.length ? (courtSource?.name ?? venues?.name) : undefined,
        planId:plan?.id, venueSource:evidence?.title, venueSourceUrl:evidence?.url, reviewNotes:evidence?.note,
      },
    }
  })
  const register:Dataset = {
    id:tourismCalendarRegisterId, name:'文旅赛事计划核对', department:'文旅局', category:'赛事引流',
    description:sourceFile+' · '+sourceSheet, formSchema:{fields}, features:records,
  }
  checkDataset(register)
  return {...doc,datasets:[...doc.datasets.map(d=>d===plans && updates.size
    ? {...d,features:d.features.map(f=>updates.get(f.id)??f)} : d),register]}
}
