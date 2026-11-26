import { chain, type ChainStage, type ChainTopic } from './chain-taxonomy.ts'
import { scopeEnterprises, type CatalogEnterprise } from './industry-panorama.ts'

const nextChecks: Record<ChainTopic, string> = {
  器材制造: '核对网球、球拍的生产线投产时间、可交付规格，以及本地场馆或俱乐部的采购订单。',
  运动服饰: '区分鞋面加工、成鞋生产和零售供货，核对本地俱乐部或赛事的实际采购品类及供应商。',
  场地建设: '对照项目中标、竣工验收和移交记录，确认施工完成后由谁负责场地运营。',
  场馆运营: '核对各场馆运营方、可预约场地和开放时段，再与赛事、培训排期比对。',
  俱乐部运营: '核对俱乐部的实际运营主体、常用球场和会员服务，并补查协会及社会组织的运营记录。',
  培训陪练: '对照招生、实际开班和场地使用记录，核实教练人数、班次及可承接学员数。',
  赛事组织: '核对近一赛季各场赛事的承办方、实际办赛日期及场馆，区分承办与赞助。',
  住宿接待: '向赛事接待酒店核对赛事日期、用房协议和实际入住房晚数。',
  餐饮服务: '按赛事核对团餐合同、就餐人数或票根核销笔数，区分日常客流与赛事客流。',
  景区游览: '核对赛事联票、球员观众凭证和实际入园记录，确认客流从赛场到景区的去向。',
  运动康养: '核对康养场所、可预约服务和运动人群实际订单，确认可提供的项目与容量。',
  购物展销: '核对参展订单、现场成交或票根核销记录，区分参展与实际销售。',
}

const statusOrder = ['待补名录', '投产待核', '经营待核', '仅收录一家', '已收录多家'] as const
type StructureStatus = typeof statusOrder[number]

function uniqueEnterprises(rows: CatalogEnterprise[]) {
  return Array.from(new Map(rows.map(row => [row.key, row])).values())
}

function isPreOperating(row: CatalogEnterprise) {
  return /^(在建|建设中|筹建|筹备中|拟建|规划中|待投产)/.test(String(row.feature.properties.businessPhase ?? ''))
}

function hasBusinessEvidence(row: CatalogEnterprise) {
  const p = row.feature.properties
  if (isPreOperating(row) || /^(注销|吊销|撤销|停业|歇业)/.test(String(p.registrationStatus ?? ''))) return false
  if (!p.mainBusiness || !Array.isArray(p.sources)) return false
  return p.sources.some(source => source && typeof source === 'object'
    && typeof source.title === 'string' && typeof source.evidence === 'string' && source.evidence.trim()
    && /^https?:\/\//i.test(String(source.url ?? '')) && !/工商信息|工商档案|工商登记|企业登记信息/.test(source.title))
}

function diagnoseTopic(stage: ChainStage, topic: ChainTopic, rows: CatalogEnterprise[]) {
  const enterprises = uniqueEnterprises(scopeEnterprises(rows, stage, topic))
  const count = enterprises.length
  const enterpriseNames = enterprises.map(row => row.feature.properties.name)
  const preOperatingCount = enterprises.filter(isPreOperating).length
  let status: StructureStatus
  let reason: string
  if (!count) {
    status = '待补名录'
    reason = '当前选区的名录尚未收录该环节主体，当地供给情况待调查。'
  } else if (preOperatingCount === count) {
    status = '投产待核'
    reason = count === 1
      ? enterpriseNames[0] + '的项目记为“' + enterprises[0].feature.properties.businessPhase + '”，实际供给能力待核实。'
      : '收录的 ' + count + ' 家主体均处于项目筹建或建设阶段，实际供给能力待核实。'
  } else if (!enterprises.some(hasBusinessEvidence)) {
    status = '经营待核'
    reason = '名录有 ' + count + ' 家主体，仍需补充当前开展该项业务的依据。'
  } else if (count === 1) {
    status = '仅收录一家'
    reason = '当前仅收录' + enterpriseNames[0] + '，需核对其承接能力并补查同环节主体。'
  } else {
    status = '已收录多家'
    reason = '该环节已收录 ' + count + ' 家主体。' + (preOperatingCount ? '其中 ' + preOperatingCount + ' 家的项目尚待投产核验。' : '')
  }
  return { stage, topic, count, preOperatingCount, enterpriseNames, status, reason, nextCheck: nextChecks[topic] }
}

/** Rows are the regional (optionally stage/topic-filtered) output of buildChainCatalog. */
export function diagnoseStructure(rows: CatalogEnterprise[], stage: ChainStage | null, topic: ChainTopic | null) {
  const scope = scopeEnterprises(rows.filter(row => row.feature.properties.sample !== true), stage, topic)
  const stagesInScope = chain.filter(item => (!stage || item.id === stage) && (!topic || item.topics.some(t => t === topic)))
  const topics = stagesInScope.flatMap(item => item.topics.filter(name => !topic || name === topic)
    .map(name => diagnoseTopic(item.id, name, scope)))
  const stages = stagesInScope.map(item => {
    const withinStage = topics.filter(node => node.stage === item.id)
    return {
      stage: item.id,
      count: uniqueEnterprises(scopeEnterprises(scope, item.id)).length,
      coveredCount: withinStage.filter(node => node.count > 0).length,
      topicCount: withinStage.length,
    }
  })
  const priorities = topics.filter(node => node.status !== '已收录多家')
    .sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status))
  return {
    enterpriseCount: uniqueEnterprises(scope).length,
    topicCount: topics.length,
    coveredCount: topics.filter(node => node.count > 0).length,
    singleCount: topics.filter(node => node.count === 1).length,
    stages, topics, priorities,
  }
}
