import { buildChainCatalog, relationRecords, type CatalogEnterprise, type RelationRecord } from './industry-panorama.ts'
import type { ChainStage, ChainTopic } from './chain-taxonomy.ts'
import type { Dataset } from './types.ts'

type Party = { key: string; name: string; stages: ChainStage[]; inScope: boolean }
export type IndustryLink = {
  key: string
  product: string
  activity: string
  receipt: string
  url: string
  date?: string
  kind: '工程建设' | '赛事承办' | '股权关联' | '其他关联'
  parties: Party[]
  crossStage: boolean
}

const topicEvidence: Record<ChainTopic, RegExp> = {
  器材制造: /器材制造|球拍生产|球拍制造|球线生产|网球生产/,
  运动服饰: /运动服饰|运动服装|运动鞋|球衣|球鞋/,
  场地建设: /场地建设|工程总承包|EPC|施工|场地改造/i,
  场馆运营: /场馆运营|场馆经营|场地运营|场馆管理|场地开放/,
  俱乐部运营: /俱乐部运营|俱乐部管理|会员服务/,
  培训陪练: /培训|陪练|集训|训练营|教练服务/,
  赛事组织: /赛事组织|主办|承办|办赛/,
  住宿接待: /住宿|酒店|民宿|客房/,
  餐饮服务: /餐饮|供餐|配餐|团餐/,
  景区游览: /景区|游览|门票/,
  运动康养: /康养|运动康复|疗养/,
  购物展销: /展销|伴手礼|购物|零售/,
}

const normalized = (s: string) => s.normalize('NFKC').replace(/\s+/g, '')

function linkKind(evidence: string): IndustryLink['kind'] {
  if (/股权|持股|持有.*股份/.test(evidence)) return '股权关联'
  if (topicEvidence.场地建设.test(evidence)) return '工程建设'
  if (/赛事|网球赛|冠军赛|锦标赛|公开赛/.test(evidence) && /承办/.test(evidence)) return '赛事承办'
  return '其他关联'
}

// A link needs the same cited activity in at least two named companies' records.
// Retain counterparties elsewhere in the city when one party is in the selected area.
export function buildIndustryLinks(datasets: Dataset[], scopedRows: CatalogEnterprise[], topic?: ChainTopic | null): IndustryLink[] {
  if (!scopedRows.length) return []
  const scope = new Set(scopedRows.map(row => row.key))
  const shared = new Map<string, { record: RelationRecord; url: string; parties: Map<string, Party> }>()
  const ledgers = datasets.filter(dataset => ['industry_chain_records', 'business_relations'].includes(dataset.id))
    .map(dataset => ({ ...dataset, features: dataset.features.filter(f => f.properties.sample !== true) }))

  for (const row of buildChainCatalog(datasets, '京山市')) {
    const p = row.feature.properties
    if (p.sample === true) continue
    const records = Array.isArray(p.relationRecords) ? p.relationRecords.filter(item => item?.sample !== true) : []
    const feature = { ...row.feature, properties: { ...p, relationRecords: records } }
    for (const record of relationRecords(ledgers, feature)) {
      if (!record.url || !URL.canParse(record.url) || !record.receipt || record.product === '未记录') continue
      if (!normalized(record.activity).includes(normalized(p.name))) continue
      const url = new URL(record.url)
      if (url.username || url.password) continue
      url.hash = ''
      const key = JSON.stringify([url.href, normalized(record.product), normalized(record.activity)])
      const project = shared.get(key) ?? { record, url: url.href, parties: new Map<string, Party>() }
      project.parties.set(row.key, { key: row.key, name: p.name, stages: row.memberships.map(m => m.stage), inScope: scope.has(row.key) })
      shared.set(key, project)
    }
  }

  const links: IndustryLink[] = []
  for (const [key, { record, url, parties: participants }] of shared) {
    const parties = [...participants.values()]
    if (!parties.some(p => p.inScope) || new Set(parties.map(p => normalized(p.name))).size < 2) continue
    // A participant's registered name (e.g. 体育培训) does not establish the purpose of the activity.
    let evidence = normalized(record.product + ' ' + record.activity)
    for (const party of parties) evidence = evidence.replaceAll(normalized(party.name), '')
    if (topic && !topicEvidence[topic].test(evidence)) continue
    const crossStage = parties.some((left, i) => left.stages.length > 0 && parties.slice(i + 1).some(right =>
      right.stages.length > 0 && left.stages.every(stage => !right.stages.includes(stage))))
    links.push({ key, product: record.product, activity: record.activity, receipt: record.receipt, date: record.date,
      url, kind: linkKind(evidence), parties, crossStage })
  }
  return links.sort((a, b) => Number(b.crossStage) - Number(a.crossStage) || (b.date ?? '').localeCompare(a.date ?? '') || a.product.localeCompare(b.product, 'zh-CN'))
}
