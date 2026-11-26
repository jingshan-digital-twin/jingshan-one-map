import { buildChainCatalog, type CatalogEnterprise, type Enterprise } from './industry-panorama.ts'
import { buildEnterpriseRelationshipIndex, isSampleRelationshipData, type EnterpriseRelationship } from './enterprise-relationships.ts'
import type { Dataset } from './types.ts'

export type GraphNode = {
  id: string
  name: string
  group: string
  kind: 'enterprise'
  row?: CatalogEnterprise
  point?: Enterprise
}
export type GraphEvidence = {
  title: string
  text: string
  date?: string
  sources: { title: string; url?: string }[]
}
export type GraphEdge = {
  id: string
  from: string
  to: string
  label: string
  kind: 'business'
  direction: 'out' | 'none'
  evidence: GraphEvidence[]
}
export const companyNodeId = (key: string) => 'enterprise:' + key
const normalizeName = (name: string) => name.normalize('NFKC').replace(/\s+/g, '')
const outsideId = (name: string) => 'external:' + normalizeName(name)

function directoryNode(row: CatalogEnterprise): GraphNode {
  return { id: companyNodeId(row.key), kind: 'enterprise', name: row.feature.properties.name, row,
    group: row.memberships.map(item => item.stage).join(' / ') || '环节待核', point: row.points[0] }
}

// The contract ledger also accepts people, public bodies and venue names.
// Without a directory match, only a recognisable business name identifies a company.
function isExternalEnterprise(name: string) {
  return /(?:公司|合伙企业|独资企业|合作社|合作联社|总厂|分厂)(?:\([^()]+\))?$/.test(normalizeName(name))
    || /\b(?:ltd|limited|inc|llc|llp|gmbh|plc|corp|corporation)\.?$/i.test(name.trim())
}

// The arrow always reads from the actual provider, shareholder or tenderer to its counterparty.
function predicate(edge: EnterpriseRelationship) {
  if (edge.centerRole === '股东' || edge.partnerRole === '股东') return edge.label.replace(/^股东持股/, '持股')
  if ([edge.centerRole, edge.partnerRole].includes('招标人')) return '招标与中标'
  if ([edge.centerRole, edge.partnerRole].includes('供货方')) return '供货'
  if ([edge.centerRole, edge.partnerRole].includes('服务提供方')) return '提供服务'
  return edge.label
}

export function buildEnterpriseGraph(datasets: Dataset[], center: CatalogEnterprise) {
  const subject = directoryNode(center)
  const nodes = new Map<string, GraphNode>([[subject.id, subject]])
  const edges = new Map<string, GraphEdge>()
  const connections = new Map<string, GraphEdge[]>([[subject.id, []]])
  if (isSampleRelationshipData(center.feature.properties)) return { nodes, edges, connections }

  const catalog = buildChainCatalog(datasets, '京山市')
  const directory = new Map(catalog.map(row => [row.key, row]))
  const simulatedNames = new Set(catalog.filter(row => isSampleRelationshipData(row.feature.properties))
    .map(row => normalizeName(row.feature.properties.name)))
  const records = buildEnterpriseRelationshipIndex(datasets, catalog).get(center.key)
  for (const relation of records?.edges ?? []) {
    const row = relation.partnerKey ? directory.get(relation.partnerKey) : undefined
    if (!row && (simulatedNames.has(normalizeName(relation.partnerName)) || !isExternalEnterprise(relation.partnerName))) continue
    const partner: GraphNode = row ? directoryNode(row) : {
      id: outsideId(relation.partnerName), name: relation.partnerName, group: '名录外企业', kind: 'enterprise',
    }
    if (partner.id === subject.id) continue
    if (!nodes.has(partner.id)) {
      nodes.set(partner.id, partner)
      connections.set(partner.id, [])
    }
    let from = subject.id, to = partner.id
    if (relation.direction === 'in' || (relation.direction === 'none' && from > to)) [from, to] = [to, from]
    const label = predicate(relation)
    const id = JSON.stringify([from, to, label])
    const record = relation.record
    const evidence: GraphEvidence = { title: record.product, text: record.activity, date: record.date,
      sources: [{ title: record.receipt, url: record.url }] }
    const existing = edges.get(id)
    if (existing) {
      if (!existing.evidence.some(item => item.title === evidence.title && item.text === evidence.text
        && item.date === evidence.date && item.sources[0].title === record.receipt && item.sources[0].url === record.url)) {
        existing.evidence.push(evidence)
      }
    } else {
      const edge: GraphEdge = { id, from, to, label, kind: 'business',
        direction: relation.direction === 'none' ? 'none' : 'out', evidence: [evidence] }
      edges.set(id, edge)
      connections.get(from)!.push(edge)
      connections.get(to)!.push(edge)
    }
  }
  return { nodes, edges, connections }
}
