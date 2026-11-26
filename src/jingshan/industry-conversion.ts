import { chain, type ChainTopic } from './chain-taxonomy.ts'
import type { CatalogEnterprise } from './industry-panorama.ts'
import type { CityFeature, DataDocument, Dataset } from './types.ts'

type Evidence = { title: string; detail: string; url: string }
type ConversionFinding = { summary: string; evidence: Evidence[]; nextStep: string }
type Activity = { topic: ChainTopic; group: string; recordedAs: string; evidenceText: string }

// These sources document participation in a particular event. Match the proof held
// in each current enterprise file before counting it in the corresponding activity.
const eventNotices: { title: string; url: string; activities: Activity[] }[] = [
  {
    title: '2025 年京山网球公开赛嘉年华',
    url: 'https://hb.news.163.com/jingmen/25/0922/09/KA24DJTI04089BBL.html',
    activities: [
      { topic: '餐饮服务', group: '现场供餐企业', recordedAs: '列入现场供餐名单', evidenceText: '嘉年华供餐企业名单' },
      { topic: '购物展销', group: '现场展销企业', recordedAs: '现场展示农产品', evidenceText: '嘉年华现场展示京山农产品' },
    ],
  },
  {
    title: '2026 年 ITF 国际网球大师赛京山站',
    url: 'https://jswq.net/h-nd-552.html',
    activities: [{ topic: '住宿接待', group: '赛事推荐酒店', recordedAs: '列入赛事住宿指引', evidenceText: '住宿与抵达指引列出酒店名称' }],
  },
]

function participationEvidence(rows: CatalogEnterprise[], topic?: ChainTopic | null) {
  const groups = new Map<string, Set<string>>()
  const evidence = eventNotices.flatMap(notice => {
    const details: string[] = []
    for (const activity of notice.activities) {
      if (topic && activity.topic !== topic) continue
      const participants = rows.filter(row => row.feature.properties.sample !== true &&
        row.memberships.some(item => item.stage === '下游' && item.topics.includes(activity.topic)) &&
        Array.isArray(row.feature.properties.sources) && row.feature.properties.sources.some(source =>
          source?.url === notice.url && typeof source.evidence === 'string' && source.evidence.includes(activity.evidenceText)))
      if (!participants.length) continue
      const members = groups.get(activity.group) ?? new Set<string>()
      participants.forEach(row => members.add(row.key))
      groups.set(activity.group, members)
      details.push(participants.map(row => row.feature.properties.name).join('、') + activity.recordedAs)
    }
    return details.length ? [{ title: notice.title, detail: details.join('。') + '。', url: notice.url }] : []
  })
  const counts = [...groups].map(([group, members]) => members.size + ' 家' + group).join('、')
  return { evidence, counts }
}

function actualRows(datasets: Dataset[], id: string, region: string, mode: DataDocument['mode']) {
  const layer = datasets.find(item => item.id === id)
  return layer?.features.filter(({ properties: p }) =>
    p.sample !== true && p.simulation !== true && (region === '京山市' || p.region === region) &&
    !/演示|模拟|演练/.test(String(p.sourceStatus ?? '')) &&
    (mode === 'live' || p.sample === false || Boolean(layer.source || p.sourceServiceId))) ?? []
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function amount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function confirmedReport(datasets: Dataset[], event: CityFeature, mode: DataDocument['mode']) {
  const ends = String(event.properties.endDate || event.properties.date).slice(0, 10)
  const today = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai'}).format(new Date())
  const matches = actualRows(datasets, 'event_actuals', event.properties.region, mode)
    .map(row => row.properties)
    .filter(p => {
      if (p.eventId !== event.id || p.region !== event.properties.region || typeof p.confirmedAt !== 'string') return false
      const status = String(p.sourceStatus ?? p.status ?? '')
      if (/待|未|退回|作废|撤回|预测|预估|草稿/.test(status)) return false
      const day = p.confirmedAt.slice(0, 10)
      const stamp = Date.parse(p.confirmedAt)
      return /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= ends && day <= today && Number.isFinite(stamp) &&
        (!status || /核实|核验|确认|实绩|核定|已发布|复核/.test(status)) &&
        (count(p.attendance) !== undefined || count(p.overnightGuests) !== undefined ||
          count(p.scenicVisitors) !== undefined || amount(p.spend) !== undefined)
    })
    .sort((a, b) => Date.parse(String(b.confirmedAt)) - Date.parse(String(a.confirmedAt)))
  if (matches.length > 1 && Date.parse(String(matches[0].confirmedAt)) === Date.parse(String(matches[1].confirmedAt))) return undefined
  return matches[0]
}

// Event-keyed volumes are already scoped to that event. Never substitute a
// month total, overall sales or a different event's volume.
function eventVolume(rows: CityFeature[], eventId: string, kind: 'orders' | 'redemptions') {
  const direct = kind === 'orders' ? 'eventOrders' : 'eventRedemptions'
  let total: number | undefined
  for (const { properties: p } of rows) {
    const byEvent = p[kind + 'ByEvent']
    const value = byEvent && typeof byEvent === 'object' && Object.hasOwn(byEvent, eventId)
      ? count((byEvent as Record<string, unknown>)[eventId])
      : p.eventId === eventId ? count(p[direct]) : undefined
    if (value !== undefined) total = (total ?? 0) + value
  }
  return total
}

const offerCategories: Record<string, ChainTopic> = {
  酒店民宿: '住宿接待', 餐饮: '餐饮服务', 购物: '购物展销',
  运动康养: '运动康养', 景区游览: '景区游览',
}
const followUp: Partial<Record<ChainTopic, string>> = {
  住宿接待: '向赛事推荐酒店核对赛事订单、实际入住人数和间夜数，以赛事编号关联入住回报。',
  餐饮服务: '向现场供餐和票根合作餐饮企业核对核销笔数、消费金额及去重消费人数。',
  购物展销: '向参展企业核对活动期间的实付订单与销售额，区分参展名册和已成交订单。',
  景区游览: '将同一赛事的到场人数与景区验票记录对齐，按去重游客数核算赛后游览比例。',
  运动康养: '按赛事编号核对康养项目预约、到店履约人数和实付金额。',
}

export function diagnoseIndustryConversion(datasets: Dataset[], rows: CatalogEnterprise[], region: string,
  mode: DataDocument['mode'], topic?: ChainTopic | null): ConversionFinding {
  const downstreamTopic = chain[2].topics.find(item => item === topic)
  const { evidence, counts } = participationEvidence(rows, downstreamTopic)
  const nextStep = (downstreamTopic && followUp[downstreamTopic]) ||
    '用同一赛事编号归集到场人数、酒店入住、景区验票和商户票根核销，分别记录人数、订单和实付金额。'
  const events = actualRows(datasets, 'events', region, mode).filter(({ properties: p }) =>
    p.status === '已办结' && typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date))
  const latest = events.sort((a, b) => String(b.properties.date).localeCompare(String(a.properties.date)))[0]
  if (!latest) {
    const pending: Partial<Record<ChainTopic, string>> = {
      住宿接待: '实际入住人数和间夜数待核。',
      餐饮服务: '用餐人数和实付金额待核。',
      购物展销: '成交笔数和销售额待核。',
    }
    const summary = evidence.length
      ? '公开记录涉及 ' + counts + '。' + ((downstreamTopic && pending[downstreamTopic]) || '实际消费人数和金额待核。')
      : '当前范围缺少可核对的已办赛事' + (downstreamTopic || '消费') + '回报。'
    return { summary, evidence, nextStep }
  }

  const p = latest.properties
  const actual = confirmedReport(datasets, latest, mode)
  const summary: string[] = []
  const auditedAttendance = count(actual?.attendance)
  const attendance = auditedAttendance ?? count(p.attendance)
  if (attendance !== undefined) summary.push((auditedAttendance === undefined ? '到场 ' : '核验到场 ') + attendance.toLocaleString('zh-CN') + ' 人')
  if (region === '京山市') {
    for (const metric of [
      { topic: '住宿接待', label: '过夜', key: 'overnightGuests' },
      { topic: '景区游览', label: '游览景区', key: 'scenicVisitors' },
    ]) {
      if (downstreamTopic && metric.topic !== downstreamTopic) continue
      const auditedPeople = count(actual?.[metric.key])
      const people = auditedPeople ?? count(p[metric.key])
      if (people === undefined) continue
      const sameReturn = (auditedPeople !== undefined) === (auditedAttendance !== undefined)
      const share = sameReturn && attendance && people <= attendance ? '（占到场人数 ' + (people * 100 / attendance).toFixed(1) + '%）' : ''
      summary.push(metric.label + ' ' + people.toLocaleString('zh-CN') + ' 人' + share)
    }
  }
  const vouchers = actualRows(datasets, 'offers', region, mode).filter(({ properties: p }) => {
    const category = String(p.category)
    return downstreamTopic ? offerCategories[category] === downstreamTopic : Boolean(offerCategories[category]) || category === '景区温泉'
  })
  const redeemed = eventVolume(vouchers, latest.id, 'redemptions')
  if (redeemed !== undefined) summary.push('已报票根核销 ' + redeemed.toLocaleString('zh-CN') + ' 笔')
  if (region === '京山市' && !downstreamTopic) {
    const auditedSpend = amount(actual?.spend)
    const spend = auditedSpend ?? amount(p.spend)
    if (spend !== undefined) {
      summary.push((auditedSpend === undefined ? '赛事回报带动消费 ' : '核验消费 ') + spend.toLocaleString('zh-CN') + ' 万元')
    }
    const routes = actualRows(datasets, 'route_packages', region, mode).filter(item => item.properties.scope === '京山')
    const orders = eventVolume(routes, latest.id, 'orders')
    if (orders !== undefined) summary.push('已报本地线路订单 ' + orders.toLocaleString('zh-CN') + ' 单')
  }
  if (summary.length === (attendance === undefined ? 0 : 1)) summary.push('消费承接实绩待补报')
  const scope = String(p.date) + ' ' + p.name + (actual ? '（赛后核验于 ' + String(actual.confirmedAt).slice(0, 10) + '）' : '')
  return { summary: scope + '。' + summary.join('，') + '。', evidence, nextStep }
}
