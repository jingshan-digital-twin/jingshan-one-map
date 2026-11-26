import { buildEnterpriseRelationships, type EnterpriseRelationship } from './enterprise-relationships.ts'
import { buildEnterpriseProximity, type ProximityMatch } from './enterprise-proximity.ts'
import { buildEnterpriseSiteEvidence } from './enterprise-site-evidence.ts'
import type { CatalogEnterprise, Enterprise, RelationRecord } from './industry-panorama.ts'
import type { Dataset } from './types.ts'

type SiteEvidence = ReturnType<typeof buildEnterpriseSiteEvidence>[number]
type NetworkNode = {
  id: string
  target: string
  group: string
  label: string
  kind: 'business' | 'spatial'
  direction: EnterpriseRelationship['direction']
}
export type PartnerNode = NetworkNode & { type: 'partner'; relations: EnterpriseRelationship[] }
export type FacilityNode = NetworkNode & { type: 'facility'; evidence: SiteEvidence[]; measurement?: ProximityMatch; point?: Enterprise }

export const matterKey = (record: RelationRecord) => JSON.stringify([record.url || record.receipt, record.product, record.activity])

export function enterprisePartners(datasets: Dataset[], center: CatalogEnterprise) {
  const { edges, unlinked } = buildEnterpriseRelationships(datasets, center)
  const partners = new Map<string, PartnerNode>()
  const matters = new Map<string, Set<string>>()
  for (const edge of edges) {
    const id = 'partner:' + (edge.partnerKey ?? edge.partnerName)
    const key = matterKey(edge.record)
    const participants = matters.get(key) ?? new Set<string>()
    participants.add(id)
    matters.set(key, participants)
    const node = partners.get(id)
    if (node) {
      node.relations.push(edge)
      const labels = new Set(node.relations.map(item => item.label))
      node.label = labels.size > 1 ? [...labels][0] + '等' + labels.size + '类' : edge.label
      if (node.direction !== edge.direction) node.direction = 'none'
    } else {
      partners.set(id, { id, type: 'partner', target: edge.partnerName, group: edge.stages.join(' / ') || (edge.inDirectory ? '环节待核' : '名录外企业'),
        label: edge.label, direction: edge.direction, kind: 'business', relations: [edge] })
    }
  }
  const order = ['上游', '中游', '下游']
  const stageIndex = (node: PartnerNode) => {
    const index = order.indexOf(node.relations[0].stages[0])
    return index < 0 ? order.length : index
  }
  const nodes = [...partners.values()].sort((a, b) => stageIndex(a) - stageIndex(b))
  const stages = order.filter(stage => nodes.some(node => node.relations[0].stages.some(value => value === stage)))
  const shared = [...matters.values()].filter(ids => ids.size > 1).length
  const reading = nodes.length ? matters.size + ' 项具名事项' + (stages.length ? '涉及' + stages.join('、') + '企业' : '已有凭证')
    + (shared ? '，其中 ' + shared + ' 项关联多家企业。' : '。') : ''
  return { nodes, matters, reading, unlinked }
}

export function enterpriseFacilities(datasets: Dataset[], center: CatalogEnterprise, radiusKm: number) {
  const measured = buildEnterpriseProximity(datasets, center, radiusKm)
  const nodes: FacilityNode[] = []
  for (const item of buildEnterpriseSiteEvidence(center)) {
    if (item.kind === 'spatial' && !measured.policy.eligible) continue
    const node = nodes.find(node => node.target === item.name)
    if (node) { node.evidence.push(item); continue }
    const siteId = center.points.find(entry => entry.feature.properties.locationLabel === '运营场所 · ' + item.name)?.feature.properties.locationFeatureId
    let point: Enterprise | undefined
    if (siteId) {
      for (const dataset of datasets) {
        const feature = dataset.features.find(f => f.id === siteId && f.properties.name === item.name && f.properties.sample !== true)
        if (feature) { point = { feature, datasetId: dataset.id }; break }
      }
    }
    nodes.push({ id: 'site:' + item.name, type: 'facility', target: item.name, group: item.category, label: item.label,
      kind: item.kind, direction: item.kind === 'business' ? 'out' : 'none', evidence: [item], point })
  }
  for (const item of measured.matches) {
    const documented = nodes.find(node => node.evidence.length && node.target === item.name)
    if (documented && measured.matches.filter(match => match.name === item.name).length === 1) {
      documented.measurement = item
      continue
    }
    const shortDistance = item.label.split(' · ')[1]
    nodes.push({ id: 'near:' + item.key, type: 'facility', target: item.name, group: item.category,
      label: shortDistance ? '邻近 · ' + shortDistance : item.label, kind: 'spatial', direction: 'none', evidence: [], measurement: item })
  }
  return { nodes, located: measured.located, measuredCount: measured.matches.length, policy: measured.policy }
}
