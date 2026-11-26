import type { ChainStage, ChainTopic } from './chain-taxonomy.ts'
import { buildChainCatalog, relationRecords, type CatalogEnterprise, type RelationRecord } from './industry-panorama.ts'
import type { Dataset } from './types.ts'

export type EnterpriseRelationship = {
  key: string
  partnerKey?: string
  partnerName: string
  stages: ChainStage[]
  topics: ChainTopic[]
  inDirectory: boolean
  label: string
  direction: 'in' | 'out' | 'both' | 'none'
  centerRole: string
  partnerRole: string
  record: RelationRecord
}

type Party = { name: string; normalizedName: string; row?: CatalogEnterprise }
const contractRoles = {
  供货: { fromRole: '供货方', toRole: '采购方', forwardLabel: '向其供货', reverseLabel: '向其采购' },
  服务合同: { fromRole: '服务提供方', toRole: '服务采购方', forwardLabel: '提供服务', reverseLabel: '采购服务' },
} as const

// On an inline relationRecords item or business_relations ledger item, from/to
// are exact legal names; from supplies goods or provides the contracted service.
export type RegisteredRelationship = {
  type: keyof typeof contractRoles
  from: string
  to: string
  status: '已核验'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function isSampleRelationshipData(value: Record<string, unknown>) {
  return value.sample === true || value.simulated === true || value.simulation === true
    || /演示|模拟|演练/.test(String(value.sourceStatus ?? ''))
}

type Claim = {
  from: Party
  to: Party
  fromRole: string
  toRole: string
  forwardLabel: string
  reverseLabel: string
  directed: boolean
}
const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, '')
const validReference = (value: unknown) => typeof value === 'string' && !!value.trim()
  && !/^(?:无|暂无|不详|未知|待补(?:充|录)?|未记录|未填写|待核验|待核实|[-—/]+)$/.test(value.trim())

// This exact legal name is listed in the training-base award notice. It has no
// local directory entry. Its role still has to be established by the activity.
const externalNames = ['北京华体创研工程设计咨询有限公司']

function partiesByName(rows: CatalogEnterprise[]) {
  const names = new Map<string, Party | null>()
  for (const row of rows) {
    const name = row.feature.properties.name
    const normalizedName = normalize(name)
    if (normalizedName) names.set(normalizedName, names.has(normalizedName) ? null : { name, normalizedName, row })
  }
  for (const name of externalNames) {
    const normalizedName = normalize(name)
    if (!names.has(normalizedName)) names.set(normalizedName, { name, normalizedName })
  }
  return [...names.values()].filter((party): party is Party => !!party)
    .sort((a, b) => b.normalizedName.length - a.normalizedName.length)
}

// Consume the complete subject. Extra people, qualifiers and partial names must
// never turn a list of attendees, prospective bidders, etc. into counterparties.
function namedGroup(subject: string, parties: Party[]): Party[] {
  const group: Party[] = []
  while (subject) {
    const party = parties.find(item => subject.startsWith(item.normalizedName))
    if (!party || group.includes(party)) return []
    group.push(party)
    subject = subject.slice(party.normalizedName.length)
    if (!subject) return group
    if (!/^[、与和及,]/.test(subject)) return []
    subject = subject.slice(1)
  }
  return []
}

function documentedClaims(activity: string, parties: Party[]): Claim[] {
  const text = normalize(activity)
  if (/尚未|并未|已撤销|已终止|已作废|更正|不实|未生效|取消中标/.test(text)) return []
  const claims: Claim[] = []
  let tenderer: Party | undefined
  for (let clause of text.split(/[。；;！？!?]/).filter(Boolean)) {
    clause = clause.replace(/^(?:公开工商资料列示,|赛后报道列明)/, '')
    const find = (name: string) => parties.find(party => party.normalizedName === name)
    const equity = clause.match(/^(.+?)持有(.+?)(\d+(?:\.\d+)?)%股权$/)
    if (equity) {
      const from = find(equity[1])
      const to = find(equity[2])
      const percent = Number(equity[3])
      if (from && to && from !== to && percent > 0 && percent <= 100) {
        claims.push({ from, to, fromRole: '股东', toRole: '被投资企业', directed: true,
          forwardLabel: '持股 ' + percent + '%', reverseLabel: '股东持股 ' + percent + '%' })
      }
    }
    const jointAward = clause.match(/^(.+?)(?:组成的联合体中标|联合中标(?:该项目的工程总承包)?)$/)
    const hosts = clause.match(/^(.+?)共同承办(?:.*(?:赛事|比赛|锦标赛|冠军赛|公开赛|邀请赛|联赛|训练营|站))?$/)
    const participants = namedGroup(jointAward?.[1] ?? hosts?.[1] ?? '', parties)
    if (participants.length >= 2) {
      const role = jointAward ? '联合中标方' : '赛事承办方'
      const label = jointAward ? '联合中标' : '共同承办'
      participants.forEach((from, index) => {
        for (const to of participants.slice(index + 1)) {
          claims.push({ from, to, fromRole: role, toRole: role, forwardLabel: label, reverseLabel: label, directed: false })
        }
        if (jointAward && tenderer && !participants.includes(tenderer)) {
          claims.push({ from: tenderer, to: from, fromRole: '招标人', toRole: role, directed: true,
            forwardLabel: '项目中标方', reverseLabel: '项目招标方' })
        }
      })
    }
    // Only associate an award with the immediately preceding, named tenderer.
    const tender = clause.match(/^(.+?)为招标人$/)
    tenderer = tender ? find(tender[1]) : undefined
  }
  return claims
}

function registeredClaim(value: unknown, parties: Party[], directoryNames: Set<string>): Claim | undefined {
  if (!isObject(value) || isSampleRelationshipData(value) || value.status !== '已核验'
    || (value.type !== '供货' && value.type !== '服务合同')) return
  const resolve = (value: unknown): Party | undefined => {
    if (typeof value !== 'string') return
    const name = value.trim()
    const normalizedName = normalize(name)
    const known = parties.find(p => p.normalizedName === normalizedName)
    if (known) return known
    // A duplicated name in the directory cannot be treated as an outside party.
    if (directoryNames.has(normalizedName) || normalizedName.length < 2
      || /^(?:未知|不详|未记录|待核实|待核验|供应商|采购方|甲方|乙方|未填写)$/.test(normalizedName)) return
    return { name, normalizedName }
  }
  const from = resolve(value.from)
  const to = resolve(value.to)
  if (!from || !to || from.normalizedName === to.normalizedName) return
  return { from, to, ...contractRoles[value.type], directed: true }
}

function safeRecord(record: RelationRecord): RelationRecord {
  if (!record.url) return record
  const url = URL.canParse(record.url) ? new URL(record.url) : undefined
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    const { url: _invalid, ...rest } = record
    return rest
  }
  url.hash = ''
  return { ...record, url: url.href }
}

type Relationships = {
  edges: EnterpriseRelationship[]
  unlinked: RelationRecord[]
}
export function buildEnterpriseRelationshipIndex(datasets: Dataset[], catalog = buildChainCatalog(datasets, '京山市')) {
  const rows = catalog.filter(row => !isSampleRelationshipData(row.feature.properties))
  const index = new Map<string, Relationships>()
  if (!rows.length) return index
  const pending = new Map(rows.map(row => [row.key, {
    edges: new Map<string, EnterpriseRelationship>(), unlinked: new Map<string, RelationRecord>(), linked: new Set<string>(),
  }]))
  const parties = partiesByName(rows)
  const directoryNames = new Set(catalog.map(r => normalize(r.feature.properties.name)))
  const owners = new Map(rows.map(r => [r.feature.id, r]))
  for (const row of rows) {
    const businessId = row.feature.properties.businessId
    if (row.aboveThreshold && typeof businessId === 'string') owners.set(businessId, row)
  }

  function read(raw: unknown, owner?: CatalogEnterprise) {
    if (!isObject(raw) || isSampleRelationshipData(raw)) return
    const feature = (owner ?? rows[0]).feature
    const [original] = relationRecords([], { ...feature, properties: { ...feature.properties, relationRecords: [raw] } })
    if (!original) return
    const record = safeRecord(original)
    if (raw.relationship && !record.url && typeof raw.receiptNo === 'string') {
      const number = raw.receiptNo.trim()
      if (number && !record.receipt.includes(number)) record.receipt += ' · ' + number
    }
    const explicit = raw.relationship !== undefined
    const relation = isObject(raw.relationship) ? raw.relationship : undefined
    const endpoints = [relation?.from, relation?.to].filter((x): x is string => typeof x === 'string').map(normalize)
    const id = JSON.stringify([record.url || record.receipt, normalize(record.product), normalize(record.activity),
      record.date ?? '', record.quantity, relation?.type, endpoints])
    if (owner && relation) {
      // Ignore a misfiled entry even if its free text happens to mention the owner.
      if (!endpoints.includes(normalize(owner.feature.properties.name))) return
    }
    if (owner) pending.get(owner.key)?.unlinked.set(id, record)
    else for (const party of parties) {
      if (party.row && endpoints.includes(party.normalizedName)) pending.get(party.row.key)?.unlinked.set(id, record)
    }
    const fileReference = explicit && !raw.url && validReference(raw.receiptNo)
    if ((!record.url && !fileReference) || !validReference(record.receipt) || record.product === '未记录'
      || /待核|未核|未确认|已作废|已撤销|未生效|已终止/.test([raw.status, raw.sourceStatus].join(' '))) return
    const registered = explicit ? registeredClaim(raw.relationship, parties, directoryNames) : undefined
    const claims = explicit ? (registered ? [registered] : []) : documentedClaims(record.activity, parties)
    for (const claim of claims) {
      if (owner && claim.from.row?.key !== owner.key && claim.to.row?.key !== owner.key) continue
      const description = registered && record.activity === '未记录'
        ? { ...record, activity: registered.from.name + '（' + registered.fromRole + '）与' + registered.to.name + '（' + registered.toRole + '）' }
        : record
      for (const forward of [true, false]) {
        const subject = forward ? claim.from : claim.to
        if (!subject.row) continue
        const result = pending.get(subject.row.key)!
        const partner = forward ? claim.to : claim.from
        const label = forward ? claim.forwardLabel : claim.reverseLabel
        const key = JSON.stringify([id, partner.normalizedName, label])
        const memberships = partner.row?.memberships ?? []
        result.edges.set(key, { key, partnerKey: partner.row?.key, partnerName: partner.name, inDirectory: !!partner.row,
          stages: memberships.map(m => m.stage), topics: memberships.flatMap(m => m.topics),
          label, direction: claim.directed ? (forward ? 'out' : 'in') : 'none',
          centerRole: forward ? claim.fromRole : claim.toRole, partnerRole: forward ? claim.toRole : claim.fromRole,
          record: description })
        result.linked.add(id)
      }
    }
  }
  for (const row of rows) {
    const inline = row.feature.properties.relationRecords
    if (Array.isArray(inline)) inline.forEach(r => read(r, row))
  }
  for (const ledger of datasets.filter(d => ['business_relations', 'industry_chain_records'].includes(d.id))) {
    for (const { properties: raw } of ledger.features) {
      const id = raw.enterpriseId ?? raw.businessId
      if (id === undefined && raw.relationship !== undefined) read(raw)
      else if (typeof id === 'string' && owners.has(id)) read(raw, owners.get(id))
    }
  }
  for (const [key, { edges, unlinked, linked }] of pending) {
    index.set(key, { edges: [...edges.values()].sort((a, b) => (b.record.date ?? '').localeCompare(a.record.date ?? '')
      || a.partnerName.localeCompare(b.partnerName, 'zh-CN')),
      unlinked: [...unlinked].filter(([id]) => !linked.has(id)).map(([, record]) => record) })
  }
  return index
}

export function buildEnterpriseRelationships(datasets: Dataset[], center: CatalogEnterprise): Relationships {
  return buildEnterpriseRelationshipIndex(datasets).get(center.key) ?? { edges: [], unlinked: [] }
}
