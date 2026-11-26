import { featureCenter, type CityFeature, type Coordinate, type DataDocument } from './types.ts'
import { eventReviewObservations } from './event-review-observations.ts'
import { resolveReviewMapVenue, reviewSupportSites, type ReviewSupportSite } from './event-review-map.ts'
export { resolveReviewMapVenue, reviewSupportSites, type ReviewSupportSite } from './event-review-map.ts'
import { fusionDestinationsId } from './fusion-destinations.ts'

export const flowGroups = [
  { id: 'scenic', label: '景区游览', color: '#54e0ee' },
  { id: 'dining', label: '餐饮休闲', color: '#ffc15c' },
  { id: 'lodging', label: '住宿度假', color: '#78aaff' },
  { id: 'other', label: '其他', color: '#9bb7c8' },
] as const
type Group = typeof flowGroups[number]['id']
export type ReviewMetric = { label: string; value: number | null; unit: string }
export type ReviewIssue = { id: string; title: string; evidence: string; action: string }
export type ReviewPoint = { id: string; name: string; group: Group; visits: number; position: Coordinate | null; sourceId?: string; datasetId?: string }
export type TrendDay = { date: string; event: number | null; tourism: number | null }
export type ReviewAsset = { title: string; rows: string[] }
export type EventReview = {
  formatVersion?: number
  id: string; name: string; start: string; end: string; venue: string; region: string; position: Coordinate | null
  sample: boolean; source: string; confirmedAt: string; metrics: ReviewMetric[]; funnel: ReviewMetric[]
  completion: number | null; completedTasks: number | null; totalTasks: number | null
  scores: ReviewMetric[]; score: number | null; points: ReviewPoint[]; trend: TrendDay[]
  supportSites?: ReviewSupportSite[]
  conclusions: string[]; issues: ReviewIssue[]; assets: ReviewAsset[]
}
export type ArchivedReview = { review: EventReview; version: number; revision: number; generatedAt: string; archivedAt: string | null; selectedIssues: string[] }
export type ReuseTarget = { id: string; name: string; start: string }
export type ReviewCatalog = { targets: ReuseTarget[]; archives: (ReuseTarget & { region: string })[] }
export type ReviewState = { report: ArchivedReview | null; reused: ReuseTarget[] }
export type ReusedExperience = { id: string; name: string; sample: boolean; issues: ReviewIssue[]; template: string[] }

type Row = Record<string, unknown>
const record = (value: unknown): Row => typeof value === 'object' && value && !Array.isArray(value) ? value as Row : {}
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(record) : []
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const pct = (value: unknown) => { const n = num(value); return n !== null && n <= 100 ? n : null }
const ratio = (n: number | null, d: number | null) => n !== null && d !== null && d > 0 && n <= d ? Math.round(n / d * 1000) / 10 : null
const str = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const metric = (label: string, value: number | null, unit: string): ReviewMetric => ({ label, value, unit })
export const reviewNumber = (value: number | null) => value === null ? '待采集' : value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
export const metricText = (m: ReviewMetric) => reviewNumber(m.value) + (m.value === null ? '' : ' ' + m.unit)

export const reviewFormatVersion = 2
const openExampleId = 'event-20261012-open'
type ReviewDocument = Pick<DataDocument, 'mode' | 'datasets'>

function isOpenExample(doc: ReviewDocument, event: CityFeature, actual?: CityFeature) {
  return doc.mode === 'demo' && event.id === openExampleId && event.properties.sample === true
    && actual?.id === 'actual-' + openExampleId && actual.properties.sample === true
}

// Observations from the original event module's Jingshan Open demonstration.
function openExample(doc: ReviewDocument) {
  const scenicSites = doc.datasets.find(d => d.id === fusionDestinationsId)?.features
    .filter(f => f.properties.name === '空山洞景区' && f.properties.scope === '京山')
  const legacySite = (dataset: string, id: string, name: string) =>
    doc.datasets.find(d => d.id === dataset)?.features.some(f => f.id === id && f.properties.name === name)
      ? { dataset, id, name } : { name }
  const scenic = scenicSites?.length === 1 ? { dataset: fusionDestinationsId, id: scenicSites[0].id, name: '空山洞景区' }
    : legacySite('tourism', 'tourism-2', '空山洞景区')
  return {
    satisfaction: 94.2, diningVisits: 980, returnIntent: 460,
    scores: { traffic: 90, medical: 96, volunteers: 93, emergency: 89 },
    destinations: [
      { ...scenic, group: 'scenic', visits: 351 },
      { ...legacySite('tourism', 'tourism-3', '温泉度假区'), group: 'scenic', visits: 333 },
      { ...legacySite('food', 'food-12', '新市街道特色餐饮 12'), group: 'dining', visits: 522 },
      { ...legacySite('hotels', 'hotel-8', '温泉运动民宿'), group: 'lodging', visits: 396 },
      { name: '其他去向', group: 'other', visits: 198 },
    ],
    trend: [
      { date: '2026-10-16', event: 645, tourism: 188 }, { date: '2026-10-17', event: 830, tourism: 279 },
      { date: '2026-10-18', event: 910, tourism: 415 }, { date: '2026-10-19', event: 0, tourism: 1020 },
      { date: '2026-10-20', event: 0, tourism: 780 },
    ],
  }
}

export function defaultReviewId(doc: ReviewDocument | undefined, candidates: string[]) {
  const fallback = candidates[0] ?? ''
  if (!doc || candidates.length < 2) return fallback
  const events = new Map(doc.datasets.find(d => d.id === 'events')?.features.map(e => [e.id,e]))
  const actuals = new Map<string,CityFeature>()
  for (const row of doc.datasets.find(d => d.id === 'event_actuals')?.features ?? []) {
    const id = str(row.properties.eventId)
    const previous = actuals.get(id)
    if (!previous || str(previous.properties.confirmedAt) < str(row.properties.confirmedAt)) actuals.set(id,row)
  }
  let best = fallback, bestRank = 0
  for (const id of candidates) {
    const event = events.get(id), actual = actuals.get(id)
    if (!event || !actual) continue
    const rank = !event.properties.sample && !actual.properties.sample && !actual.properties.simulation ? 3
      : isOpenExample(doc,event,actual) ? 2 : 1
    if (rank > bestRank) { best = id; bestRank = rank }
  }
  return best
}

export function buildEventReview(doc: Pick<DataDocument, 'mode' | 'datasets'>, id: string): EventReview | null {
  const layer = (key: string) => doc.datasets.find(d => d.id === key)?.features ?? []
  const event = layer('events').find(f => f.id === id && f.properties.status === '已办结')
  if (!event) return null
  const p = event.properties
  const forEvent = (key: string) => layer(key).filter(f => f.properties.eventId === id)
  const actualRow = forEvent('event_actuals').sort((a,b) => str(b.properties.confirmedAt).localeCompare(str(a.properties.confirmedAt)))[0]
  const actual = actualRow?.properties
  const monitoring = forEvent('event_live').sort((a,b) => str(b.properties.asOf).localeCompare(str(a.properties.asOf)))
  const live = monitoring[0]?.properties
  const example = isOpenExample(doc,event,actualRow)
  const observed = eventReviewObservations(actual,example ? openExample(doc) : undefined)
  const sample = [p, actual, live].some(x => x?.sample === true || x?.simulation === true)
  const attendance = num(actual?.attendance) ?? num(p.attendance), visitors = num(actual?.visitors) ?? num(p.visitors)
  const spend = num(actual?.spend) ?? num(p.spend), visitorsPct = ratio(visitors, attendance)
  const spectators = num(actual?.spectators) ?? num(p.spectators), scenic = num(actual?.scenicVisitors) ?? num(p.scenicVisitors)
  const occupancy = (Array.isArray(p.occupancy) ? p.occupancy : []).map(pct).filter((n): n is number => n !== null)
  const done = num(actual?.tasksCompleted), total = num(actual?.tasksTotal), completion = ratio(done, total)
  const metrics = [
    metric('累计参赛', num(actual?.players) ?? num(p.players), '人'), metric('累计观众', spectators, '人'),
    metric('外地客群', visitorsPct, '%'), metric('酒店入住峰值', pct(actual?.occupancyPeak) ?? (occupancy.length ? Math.max(...occupancy) : null), '%'),
    metric('文旅消费', spend, '万元'), metric('综合满意度', pct(observed.satisfaction), '%'),
  ]
  const funnel = [
    metric('观赛客流', spectators, '人'), metric('景区到访', scenic, '人次'),
    metric('餐饮消费', num(observed.diningVisits), '人次'), metric('住宿消费', num(actual?.nights) ?? num(p.nights), '间夜'),
    metric('二次出游意向', num(observed.returnIntent), '人'),
  ]
  const points: ReviewPoint[] = []
  for (const [index, dest] of rows(observed.destinations).entries()) {
    const group = flowGroups.find(g => g.id === dest.group)
    const visits = num(dest.visits)
    if (!group || visits === null) continue
    const place = layer(str(dest.dataset)).find(f => f.id === dest.id)
    points.push({ id: 'destination-' + index, group: group.id, visits, name: place?.properties.name || str(dest.name) || group.label,
      position: place ? featureCenter(place) : null, sourceId: str(dest.id) || undefined, datasetId: str(dest.dataset) || undefined })
  }
  const trend: TrendDay[] = rows(observed.trend).map(r => ({ date: str(r.date), event: num(r.event), tourism: num(r.tourism) }))
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && Number.isFinite(Date.parse(d.date)) && (d.event !== null || d.tourism !== null))
    .sort((a,b) => a.date.localeCompare(b.date))
  const ratings = record(observed.scores)
  const scores = Object.entries({ traffic: '交通组织', medical: '医疗保障', volunteers: '志愿服务', emergency: '应急处置' })
    .map(([key,label]) => metric(label, pct(ratings[key]), '分'))
  const score = scores.every(x => x.value !== null) ? Math.round(scores.reduce((sum,x) => sum + x.value!, 0) / scores.length) : null
  const issues: ReviewIssue[] = []
  for (const [key, title, label, unit, action] of [
    ['parkingGap','停车高峰衔接不足','核验停车缺口','个车位','赛前核对备用停车场容量，设置分流标识和临时接驳。'],
    ['bedGap','住宿接待供给不足','核验住宿缺口','张床位','提前锁定协议酒店床位，并公布周边住宿接驳安排。'],
  ]) {
    const gap = num(actual?.[key])
    if (gap !== null && gap > 0) issues.push({ id: key, title, evidence: label + ' ' + reviewNumber(gap) + ' ' + unit, action })
  }
  if (done !== null && total !== null && done < total) issues.push({ id: 'tasks', title: '保障任务尚有未结项',
    evidence: '保障任务完成 ' + done + ' / ' + total + ' 项', action: '明确剩余任务责任人和反馈时限，纳入下届赛前核查清单。' })
  const conclusions: string[] = []
  if (visitorsPct !== null) conclusions.push('外地客群占到场人数的 ' + visitorsPct + '%。')
  if (scenic !== null && spend !== null) conclusions.push('赛事带来景区到访 ' + reviewNumber(scenic) + ' 人次，文旅消费 ' + reviewNumber(spend) + ' 万元。')
  const origins = forEvent('origins').sort((a,b) => (num(b.properties.share) ?? 0) - (num(a.properties.share) ?? 0))
  const assets: ReviewAsset[] = [
    { title: '保障方案模板', rows: rows(live?.tasks).filter(t => str(t.title)).map(t => str(t.title) + (str(t.department) ? ' · ' + str(t.department) : '')) },
    { title: '事件处置案例库', rows: monitoring.filter(f => (num(f.properties.incidentCount) ?? 0) > 0 && str(f.properties.incidentSummary))
      .map(f => [str(f.properties.date), str(f.properties.incidentSummary)].filter(Boolean).join(' · ')).sort() },
    { title: '赛事客群画像', rows: origins.filter(f => str(f.properties.from) && pct(f.properties.share) !== null)
      .map(f => str(f.properties.from) + ' · ' + metricText(metric('', pct(f.properties.share), '%'))) },
    { title: '文旅消费分析', rows: [metrics[4], ...funnel.slice(1)].filter(m => m.value !== null).map(m => m.label + ' · ' + metricText(m)) },
  ]
  const review = resolveReviewMapVenue({ formatVersion: reviewFormatVersion, id, name: p.name, start: str(p.date), end: str(p.endDate) || str(p.date),
    venue: str(p.venue) || (example ? '京山国际网球中心' : ''), region: p.region,
    position: featureCenter(event), sample, source: str(actual?.sourceStatus) || (actual ? '赛后核验记录' : '已发布赛事记录'),
    confirmedAt: str(actual?.confirmedAt), metrics, funnel, scores, score, completedTasks: done, totalTasks: total, completion,
    issues, conclusions, points, trend, assets }, doc.datasets)
  return { ...review, supportSites: reviewSupportSites(doc.datasets, review) }
}

export function directionStats(points: ReviewPoint[]) {
  const total = points.reduce((sum, p) => sum + p.visits, 0)
  return flowGroups.map(g => {
    const matching = points.filter(p => p.group === g.id)
    const visits = matching.reduce((sum,p) => sum + p.visits, 0)
    return { ...g, visits, share: matching.length ? ratio(visits, total) : null }
  })
}

export function reviewMapFeatures(review: EventReview, group: Group | '', sites: ReviewSupportSite[] = []): CityFeature[] {
  const origin = review.position
  if (!origin) return []
  const make = (id: string, name: string, geometry: CityFeature['geometry'], props: Record<string,unknown>): CityFeature =>
    ({ id, type: 'Feature', geometry, properties: { name, region: '京山市', kind: 'review-flow', ...props } })
  const all = [make('review-venue', review.venue || review.name, { type: 'Point', coordinates: origin },
    { mapRole: 'venue', kind: 'review-source', color: '#63edff' })]
  for (const p of review.points) {
    if (!p.position || p.visits <= 0 || group && p.group !== group) continue
    const [x,y] = origin, [endX,endY] = p.position, dx = endX - x, dy = endY - y
    const color = flowGroups.find(g => g.id === p.group)!.color
    if (Math.abs(dx) + Math.abs(dy) > 1e-6) {
      const path = Array.from({length: 33}, (_,i) => {
        const t = i / 32, curve = .38 * t * (1-t)
        return [x + dx*t - dy*curve, y + dy*t + dx*curve]
      })
      const [tipX,tipY] = path[27], [prevX,prevY] = path[25], ax = tipX-prevX, ay = tipY-prevY
      all.push(make(p.id + '-flow', p.name, { type: 'MultiLineString', coordinates: [path,
        [[prevX-ay*.55,prevY+ax*.55],[tipX,tipY],[prevX+ay*.55,prevY-ax*.55]]] },
        { mapRole: 'link', color, showLabel: false, interactive: true }))
    }
    const captionSide = Math.abs(dx) > Math.abs(dy) * 1.5 ? (dx > 0 ? 'east' : 'west') : 'above'
    all.push(make(p.id, p.name, { type: 'Point', coordinates: p.position }, { mapRole: 'support', kind: 'review-stop', color, captionSide }))
  }
  for (const site of sites) {
    if (site.observedPointId && all.some(point => point.id === site.observedPointId)) continue
    const category = site.kind === 'food' ? 'dining' : site.kind === 'hotels' ? 'lodging'
      : site.kind === 'tourism' || site.kind === 'springs' ? 'scenic' : undefined
    if (group && category !== group) continue
    all.push(make(site.id, site.name, { type:'Point', coordinates:site.position }, {
      mapRole:'support', kind:'review-support', supportKind:site.kind, color:site.color, labelMaxDistance:6500,
      legendLabel:'周边' + site.label, distanceLabel:site.distanceLabel, capacityLabel:site.capacityLabel,
      address:site.address, interactive:true,
    }))
  }
  return all
}

export function reviewReportSections(report: ArchivedReview, reused: ReuseTarget[]) {
  const r = report.review
  const section = (title: string, lines: string[]) => ({title, lines: lines.length ? lines : ['暂无记录']})
  const list = (ms: ReviewMetric[]) => ms.map(m => m.label + '　' + metricText(m))
  const directions = r.points.length ? directionStats(r.points).filter(g => r.points.some(p => p.group === g.id))
    .map(g => g.label + '　' + reviewNumber(g.visits) + ' 人次' + (g.share === null ? '' : '（' + g.share + '%）')) : []
  return [
    section('赛事与数据来源', [
      [r.start, r.end, r.venue].filter(Boolean).join(' / '),
      (r.sample ? '演示数据 · ' : '') + r.source + ' · 已发布数据 V' + report.version,
      ...(r.confirmedAt ? ['核验日期　' + r.confirmedAt] : []),
      '生成时间　' + reviewTime(report.generatedAt), '归档时间　' + (report.archivedAt ? reviewTime(report.archivedAt) : '尚未归档'),
    ]),
    section('核心指标', list(r.metrics)), section('赛事引流转化', list(r.funnel)),
    section('赛后 48 小时客流方向', directions),
    section('目的地到访', r.points.map(p => p.name + '　' + reviewNumber(p.visits) + ' 人次')),
    ...(r.supportSites?.length ? [section('场馆 1 公里内配套点位', r.supportSites.map(site =>
      [site.name, site.label, '距场馆 ' + site.distanceLabel, site.capacityLabel, site.address].filter(Boolean).join(' · ')))] : []),
    section('客流变化趋势（人次）', r.trend.map(d => d.date + '　赛事 ' + reviewNumber(d.event) + ' / 文旅 ' + reviewNumber(d.tourism))),
    section('保障评估', list([metric('综合保障评分', r.score, '分'), metric('保障任务完成率', r.completion, '%'), ...r.scores])),
    section('重点结论', r.conclusions),
    section('问题与改进', r.issues.map(i => i.title + '　' + i.evidence + '。' + i.action + (report.selectedIssues.includes(i.id) ? '（纳入复用）' : ''))),
    ...r.assets.map(a => section(a.title, a.rows)), section('已复用赛事', reused.map(t => t.start + '　' + t.name)),
  ]
}

export const reviewTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai', hour12:false})

export function reviewReportHtml(report: ArchivedReview, reused: ReuseTarget[]) {
  const escape = (text: string) => text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
  const title = escape(report.review.name) + ' · 赛后复盘报告'
  const sections = reviewReportSections(report,reused).map(s => '<section><h2>' + escape(s.title) + '</h2><ul>' +
    s.lines.map(line => '<li>' + escape(line) + '</li>').join('') + '</ul></section>').join('\n')
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><style>
*{box-sizing:border-box}body{max-width:860px;margin:auto;padding:32px;color:#173653;font:16px/1.65 "Microsoft YaHei",sans-serif}
header{border-bottom:3px solid #167f9e;padding-bottom:12px}h1{font-size:28px}h2{font-size:19px;color:#12617a;break-after:avoid}
section{border-bottom:1px solid #cbdae3;padding:5px 0}ul{padding-left:1.5em}li{margin:3px 0;overflow-wrap:anywhere;break-inside:avoid}
@page{size:A4;margin:17mm}@media print{body{padding:0;max-width:none;font-size:11pt}h1{font-size:21pt}h2{font-size:14pt}}
</style><body><header><div>数智京山网旅产业一张图</div><h1>${title}</h1></header><main>${sections}</main></body></html>`
}
