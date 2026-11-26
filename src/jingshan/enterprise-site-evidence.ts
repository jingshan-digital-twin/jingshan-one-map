import type { CatalogEnterprise } from './industry-panorama.ts'

type Citation = { receipt: string; url: string; date?: string }
type SiteRelation = { name: string; category: string; kind: 'business' | 'spatial'; label: string; evidence: string }
export type EnterpriseSiteEvidence = SiteRelation & Citation & { supportingSources?: Citation[] }
type ProfileSource = Citation & { siteRelations?: unknown; evidence: string }

const operationsNotice = 'https://www.jrjingshan.com/m/a/wzgg/2026/0715/77027.html'
const hotelOpening = 'https://www.jrjingshan.com/m/a/sz/2026/0914/77944.html'
const hotelFiling = 'https://m.zhaobiao.cn/rlxm/approved_v_c78e705b32120516b09fa5bc66f07b5b_new.html'

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function profileSources(value: unknown): Map<string, ProfileSource> {
  const sources = new Map<string, ProfileSource>()
  for (const raw of Array.isArray(value) ? value : []) {
    if (!raw || raw.sample === true) continue
    const receipt = text(raw.title)
    const url = URL.canParse(text(raw.url)) ? new URL(raw.url) : undefined
    if (!receipt || !url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue
    url.hash = ''
    sources.set(url.href, { receipt, url: url.href, date: text(raw.date) || undefined,
      evidence: text(raw.evidence), siteRelations: raw.siteRelations })
  }
  return sources
}

function citation(source: ProfileSource): Citation {
  return { receipt: source.receipt, url: source.url, date: source.date }
}

// Desk-checked annotations for existing profiles. Each one is conditional on
// the exact source still being present; staff can override it in that source.
function archivedRelations(center: CatalogEnterprise, source: ProfileSource, sources: Map<string, ProfileSource>): EnterpriseSiteEvidence[] {
  const p = center.feature.properties
  if (p.name === '京山市网球产业发展有限公司' && source.url === operationsNotice && Array.isArray(p.siteNames)) {
    const siteNames = p.siteNames
    return ['京山网球训练基地', '京山市国际网球赛事中心', '文峰公园'].filter(name => siteNames.includes(name)).map(name => ({
      name, category: name === '文峰公园' ? '公园' : '网球场馆', kind: 'business', label: '统筹运营',
      evidence: '公开选聘公告将' + name + '的日常运营列入公司职业经理人的岗位职责。', ...citation(source),
    }))
  }
  const filing = sources.get(hotelFiling)
  if (p.name === '湖北众拓酒店管理有限公司' && source.url === hotelOpening && filing) {
    return [{ name: '京山市国际网球赛事中心', category: '网球场馆', kind: 'spatial', label: '场地邻近',
      evidence: '美豪酒店·京山店备案列湖北众拓为项目单位。开业报道中，酒店负责人黄远波说明酒店选址在网球赛事中心旁。',
      ...citation(source), supportingSources: [citation(filing)] }]
  }
  return []
}

export function buildEnterpriseSiteEvidence(center: CatalogEnterprise): EnterpriseSiteEvidence[] {
  const p = center.feature.properties
  if (p.sample === true) return []
  const sources = profileSources(p.sources)
  const relations = new Map<string, EnterpriseSiteEvidence>()
  const add = (item: EnterpriseSiteEvidence) => relations.set(JSON.stringify([item.name, item.label, item.kind, item.url]), item)
  for (const source of sources.values()) {
    if (source.siteRelations === undefined) {
      archivedRelations(center, source, sources).forEach(add)
      continue
    }
    // A source's siteRelations array is authoritative, including an empty array.
    if (!Array.isArray(source.siteRelations)) continue
    for (const raw of source.siteRelations) {
      if (!raw || raw.sample === true || !['business', 'spatial'].includes(raw.kind)) continue
      const name = text(raw.name)
      const category = text(raw.category)
      const label = text(raw.label)
      const evidence = text(raw.evidence) || source.evidence
      if (name && name !== p.name && category && label && evidence) {
        add({ name, category, kind: raw.kind, label, evidence, ...citation(source) })
      }
    }
  }
  return [...relations.values()]
}
