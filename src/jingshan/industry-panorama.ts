import { type CityFeature, type Dataset, featureCenter } from './types.ts'
import { fusionDestinationsId } from './fusion-destinations.ts'
import { panoramaProviderGroup, panoramaProviderTopics, tourismProviderId } from './tourism-providers.ts'

import { chain, enterpriseDirectoryId, hasEnterpriseDirectory, type ChainStage, type ChainTopic } from './chain-taxonomy.ts'
export { chain, type ChainStage, type ChainTopic }
export type Enterprise = { feature: CityFeature; datasetId: string }
export type CatalogEnterprise = Enterprise & {
  key: string
  aboveThreshold: boolean
  memberships: { stage: ChainStage; topics: ChainTopic[] }[]
  points: Enterprise[]
  records: Enterprise[]
}
export type RelationRecord = { product: string; activity: string; quantity: string; receipt: string; url?: string; date?: string }

export const commerceChainTopics: Readonly<Partial<Record<string, ChainTopic>>> = {
  commerce_hotels:'住宿接待', commerce_food:'餐饮服务',
}

const topicPatterns: Record<ChainTopic, RegExp> = {
  器材制造:/器材制造|球拍制造|网球制造|球线生产|研发测试/,
  运动服饰:/运动服饰|服装鞋帽|运动鞋|球衣/,
  场地建设:/场地建设|场地材料|面层|场地设施材料/,
  场馆运营:/场馆运营|场馆经营/,
  俱乐部运营:/俱乐部/,
  培训陪练:/培训|陪练|训练服务/,
  赛事组织:/赛事运营|赛事组织/,
  住宿接待:/住宿|民宿|酒店/,
  餐饮服务:/餐饮|餐馆/,
  景区游览:/景区|旅游景点/,
  运动康养:/运动康复|运动康养|温泉康养/,
  购物展销:/购物|展销|伴手礼|用品零售/,
}
const text = (field: unknown) => Array.isArray(field)
  ? field.filter(value => typeof value === 'string').join('、')
  : typeof field === 'string' || typeof field === 'number' ? String(field).trim() : ''

export function field(record: Record<string,unknown>, keys: string[], fallback = '未记录') {
  return keys.map(key => text(record[key])).find(Boolean) || fallback
}

export function enterpriseBusiness({ feature }:Enterprise, fallback:string) {
  return field(feature.properties, ['mainBusiness','products','product','mainProduct','subtype','category'], fallback)
}

export function enterpriseChainLabel(row: CatalogEnterprise) {
  return row.memberships.map(({ stage, topics }) =>
    topics.length ? stage + ' · ' + topics.join('、') : stage
  ).join(' / ') || '待归类'
}

function membership(feature:CityFeature, datasetId:string): CatalogEnterprise['memberships'] {
  const commerceTopic = commerceChainTopics[datasetId]
  if (commerceTopic) return [{stage:'下游', topics:[commerceTopic]}]
  const properties = feature.properties
  if (Array.isArray(properties.chainTopics)) {
    const topics = new Set(properties.chainTopics)
    return chain.map(item => ({stage:item.id, topics:item.topics.filter(topic => topics.has(topic))}))
      .filter(item => item.topics.length > 0)
  }
  const declared = field(properties,['chainStage','stage','segment'],'')
  const detail = ['chainCategory','chainTopic','topic','products','product','mainProduct','mainBusiness','subtype','category']
    .map(key => text(properties[key])).filter(Boolean)
  const declaredStages = chain.filter(item => declared.includes(item.id))
  const stages = declaredStages.length || datasetId === 'businesses' ? declaredStages
    : chain.filter(item => item.id === (detail.some(term => /培训|俱乐部|场馆运营|赛事运营/.test(term)) ? '中游' : '下游'))
  return stages.map(item => ({
    stage:item.id,
    topics:item.topics.filter(topic => detail.some(term => topicPatterns[topic].test(term))),
  }))
}

function hasPosition(feature:CityFeature) {
  if (!feature.geometry) return false
  const center = featureCenter(feature)
  return Boolean(center && center.every(Number.isFinite) && Math.abs(center[0]) <= 180 && Math.abs(center[1]) <= 90)
}

export function chainMapFeature(feature: CityFeature, datasetId: string): CityFeature {
  const address = feature.properties.locationReview?.chainLocation
  if (!commerceChainTopics[datasetId] || feature.geometry?.type !== 'GeometryCollection' || !address) return feature
  const coordinates = address.coordinates
  if (!Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(Number.isFinite) ||
      Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90) return feature
  return { ...feature, geometry: { type: 'Point', coordinates }, properties: { ...feature.properties, locationLabel: address.precision } }
}

// Each tourism record describes a service location. Group by the operating entity
// while preserving each location's own name, region and published feature ID.
function tourismChainFeature(feature: CityFeature, datasetId: string): CityFeature | undefined {
  const p = feature.properties
  let enterpriseName = p.name
  let topic: ChainTopic
  let service: string
  if (datasetId === fusionDestinationsId) {
    if (p.sample === true || p.scope !== '京山' || p.status === '暂停') return
    const operator = field(p, ['operator'], '')
    if (!operator || /^(?:村集体|村委会|集体|个人|私人|无|暂无|不详|未知|待核实|待确定|未填(?:写)?|[-—/]+)$/.test(operator)) return
    // The local register uses the group's short name (SSE disclosure 127760, 2024-06-26).
    enterpriseName = operator === '京诚集团' ? '京山市京诚投资开发集团有限公司' : operator
    topic = p.category === '温泉' ? '运动康养' : '景区游览'
    service = p.category === '温泉' ? '温泉运营' : '景区运营'
  } else {
    const group = panoramaProviderGroup(feature)
    if (!group) return
    topic = panoramaProviderTopics[group]
    if (group === '网球俱乐部') {
      service = '网球俱乐部运营'
    } else if (group === '旅行社') {
      service = field(p, ['classification'], '旅行社') + ' · 旅行服务'
    } else {
      const tennisTraining = text(p.name).includes('网球') || (p.venueRelation === '培训地点' && text(p.venueName).includes('网球'))
      service = field(p, ['mainBusiness'], tennisTraining ? '网球培训' : '体育培训')
    }
  }
  if (!enterpriseName?.trim()) return
  return { ...feature, properties: { ...p, kind: 'business', enterpriseName, chainTopics: [topic], mainBusiness: service } }
}

export function buildChainCatalog(datasets:Dataset[],region:string):CatalogEnterprise[] {
  return buildCatalog(datasets, region, false)
}

export function buildPanoramaCatalog(datasets:Dataset[],region:string):CatalogEnterprise[] {
  return buildCatalog(datasets, region, true)
}

function buildCatalog(datasets:Dataset[],region:string,includeTourism:boolean):CatalogEnterprise[] {
  const groups = new Map<string,Enterprise[]>()
  const byIdentifier = new Map<string,string>()
  const byName = new Map<string,string>()
  const creditCodes = new Map<string,string>()
  const namesInConflict = new Set<string>()
  const sourcedDirectory = hasEnterpriseDirectory(datasets)
  // An empty published register also replaces the old membership of that topic.
  const replacedTopics = new Set(datasets.flatMap(dataset => commerceChainTopics[dataset.id] ?? []))
  const sources = ['businesses','merchants',...Object.keys(commerceChainTopics)]
  if (includeTourism) sources.push(tourismProviderId, fusionDestinationsId)
  for (const datasetId of sources) {
    for (const raw of datasets.find(dataset => dataset.id === datasetId)?.features ?? []) {
      const feature = datasetId === tourismProviderId || datasetId === fusionDestinationsId
        ? tourismChainFeature(raw, datasetId) : raw
      if (!feature) continue
      const properties = feature.properties
      if ((sourcedDirectory || commerceChainTopics[datasetId]) && properties.sample === true) continue
      const enterpriseName = field(properties,['enterpriseName','companyName','legalName'],'')
      const name = (enterpriseName || properties.name || '').normalize('NFKC').replace(/\s+/g,'')
      const credit = field(properties,['unifiedSocialCreditCode','socialCreditCode','creditCode','uscc'],'').toUpperCase()
      const entityId = field(properties,['enterpriseId','businessId'],'')
      const sourceId = datasetId === 'merchants' ? field(properties,['sourceId'],'') : ''
      const identifiers = [credit && 'credit:'+credit,entityId && 'entity:'+entityId]
      if (datasetId === 'businesses') identifiers.push('entity:'+feature.id)
      const referenced = identifiers.map(id => byIdentifier.get(id)).find(Boolean)
        ?? (sourceId ? byIdentifier.get('entity:'+sourceId) : undefined)
      const sameName = !namesInConflict.has(name) && byName.get(name)
      const compatible = sameName && (!credit || !creditCodes.has(sameName) || creditCodes.get(sameName) === credit)
      const known = referenced || (compatible ? sameName : undefined)
      if (datasetId === 'merchants' && !known && !enterpriseName && !credit && !entityId) continue
      const key = known || identifiers.find(Boolean) || datasetId+':'+(datasetId === fusionDestinationsId ? name : feature.id)
      if (name) {
        if (sameName && sameName !== key) namesInConflict.add(name)
        byName.set(name,key)
      }
      for (const identifier of identifiers.filter(Boolean)) byIdentifier.set(identifier,key)
      if (credit) creditCodes.set(key,credit)
      const entry = { datasetId,feature }
      const group = groups.get(key)
      if (group) group.push(entry)
      else groups.set(key,[entry])
    }
  }
  const catalog:CatalogEnterprise[] = []
  for (const [key,group] of groups) {
    const local = group.filter(row => !region || region === '京山市' || row.feature.properties.region === region)
    if (!local.length) continue
    const stages = new Map<ChainStage,Set<ChainTopic>>()
    let removedTopic = false
    for (const row of local) {
      for (const {stage,topics} of membership(row.feature,row.datasetId)) {
        const included = commerceChainTopics[row.datasetId] ? topics : topics.filter(topic => !replacedTopics.has(topic))
        if (included.length !== topics.length) {
          removedTopic = true
          if (!included.length) continue
        }
        const existing = stages.get(stage) ?? new Set<ChainTopic>()
        included.forEach(topic => existing.add(topic))
        stages.set(stage,existing)
      }
    }
    if (!stages.size && (sourcedDirectory || removedTopic)) continue
    const register = local.filter(row => commerceChainTopics[row.datasetId])
    const representative = register[0] ?? local[0]
    const name = field(representative.feature.properties,['enterpriseName','companyName','legalName'],representative.feature.properties.name)
    let feature = name === representative.feature.properties.name ? representative.feature
      : { ...representative.feature,properties:{ ...representative.feature.properties,name } }
    if (register.length) {
      // Preserve verified corporate facts and links by ID, while keeping the register's site and address.
      const profile = group.find(row => row.datasetId === 'businesses' && row.feature.properties.sample !== true)?.feature
      if (profile) {
        const facts = Object.fromEntries(['creditCode','unifiedSocialCreditCode','socialCreditCode','uscc','registeredCapital',
          'legalRepresentative','established','registrationStatus','registeredAddress','businessScopeExcerpt','mainBusiness',
          'relationRecords','sources','siteNames'].filter(key => profile.properties[key] != null).map(key => [key,profile.properties[key]]))
        feature = {...feature, properties:{...facts,...feature.properties,businessId:profile.id}}
      }
    }
    if (includeTourism && group.some(row => row.datasetId === fusionDestinationsId
        && row.feature.properties.scaleEnterprise === '是')) {
      feature = { ...feature, properties: { ...feature.properties, aboveScale: true } }
    }
    const locations = register.length ? local.filter(row => commerceChainTopics[row.datasetId]
      || row.datasetId === tourismProviderId || row.datasetId === fusionDestinationsId) : local
    catalog.push({
      ...representative,feature,key,records:local,aboveThreshold:register.length > 0,
      memberships:chain.filter(item => stages.has(item.id)).map(item => ({stage:item.id,topics:[...stages.get(item.id)!]})),
      points:locations.flatMap(row => {
        const feature = chainMapFeature(row.feature, row.datasetId)
        if (!hasPosition(feature)) return []
        return [{ ...row, feature: includeTourism
          ? { ...feature, properties: { ...feature.properties, panoramaEntityKey: key } } : feature }]
      }),
    })
  }
  return catalog
}

export function scopeEnterprises(rows:CatalogEnterprise[],stage?:ChainStage|null,topic?:ChainTopic|null) {
  if (!stage && !topic) return rows
  return rows.filter(row => row.memberships.some(item => (!stage || item.stage === stage) && (!topic || item.topics.includes(topic))))
}

const introductions:Record<ChainStage|ChainTopic,string> = {
  上游:'为网球运动提供器材、运动服饰及场地建设服务。',
  中游:'通过场馆和俱乐部运营、培训陪练及赛事组织，吸引球员和观众来到京山。',
  下游:'承接本地及来访人群的住宿、餐饮、游览、康养和购物需求。',
  器材制造:'生产网球运动器材及配件，并区分已投产企业和在建项目。',
  运动服饰:'生产或供应运动服装、鞋类及相关配件。',
  场地建设:'建设、改造网球场地及场馆配套设施。',
  场馆运营:'经营网球场馆，提供场地开放、预订和使用服务。',
  俱乐部运营:'通过网球俱乐部、会员活动及队伍管理组织日常参与。',
  培训陪练:'提供网球教学、集训、陪练及其他体育培训服务。',
  赛事组织:'承担网球赛事的组织、执行或运营。',
  住宿接待:'在京山提供酒店、民宿等住宿接待服务。',
  餐饮服务:'在京山面向居民和来访人群提供餐饮服务。',
  景区游览:'涵盖景区运营、旅游体验和旅行社的线路组织、游客接待服务。',
  运动康养:'提供与当地文体旅游衔接的康复、疗养或温泉康养服务。',
  购物展销:'通过门店、展销活动或文旅渠道销售当地特色商品和体育用品。',
}
export function scopeIntroduction(stage?:ChainStage|null,topic?:ChainTopic|null) {
  const node = topic ?? stage
  return node ? introductions[node] : '上游供应装备与材料，中游组织场馆、赛事和培训，下游承接餐饮住宿、景区游览与延伸消费。'
}

export function scopeAnalysis(rows:CatalogEnterprise[],stage?:ChainStage|null,topic?:ChainTopic|null) {
  if (!rows.length) return '当前公开资料名录尚未收录该环节的本地企业。'
  if (topic) {
    const towns = new Map<string,number>()
    for (const {feature} of rows) {
      const town = feature.properties.region
      if (town && town !== '京山市') towns.set(town,(towns.get(town) ?? 0)+1)
    }
    const leading = [...towns.entries()].sort((left,right) => right[1]-left[1] || left[0].localeCompare(right[0],'zh-CN'))[0]
    return leading ? '已收录 '+rows.length+' 家企业，已记录 '+towns.size+' 个镇街，其中'+leading[0]+'收录 '+leading[1]+' 家。'
      : '已收录 '+rows.length+' 家企业，具体镇街分布待核实。'
  }
  if (stage) {
    const topics = chain.find(item => item.id === stage)!.topics
    const mapped = rows.filter(row => row.memberships.some(item => item.stage === stage && item.topics.length)).length
    const populated = topics.filter(kind => scopeEnterprises(rows,stage,kind).length).length
    return '已收录 '+rows.length+' 家企业，涉及 '+populated+' 个二级环节。'+(mapped < rows.length ? '其中 '+(rows.length-mapped)+' 家尚待细分。' : '')
  }
  const counts = chain.map(item => ({ stage:item.id, count:scopeEnterprises(rows,item.id).length }))
  const largest = Math.max(...counts.map(item => item.count))
  const leaders = counts.filter(item => item.count === largest).map(item => item.stage)
  const unclassified = rows.filter(row => !row.memberships.length).length
  if (!largest) return '已收录 '+rows.length+' 家企业，产业链环节归属待补充。'
  const share = Number((largest * 100 / rows.length).toFixed(1))
  return leaders.join('、') + (leaders.length === 1 ? '收录企业最多，占' : '收录企业数并列，各占') +
    '全链 '+rows.length+' 家企业的 '+share+'%。'+(unclassified ? '另有 '+unclassified+' 家尚待归类。' : '')
}

export function findEnterprises(datasets:Dataset[], stage:ChainStage, topic:ChainTopic) {
  return scopeEnterprises(buildChainCatalog(datasets,'京山市'),stage,topic)
}

export function sampleEnterprises(datasets:Dataset[], stage:ChainStage, topic:ChainTopic): Enterprise[] {
  return findEnterprises(datasets,stage,topic).filter(row => row.feature.properties.sample === true)
}

export function relationRecords(datasets:Dataset[], feature:CityFeature):RelationRecord[] {
  const rows = feature.properties.relationRecords
  const ownerIds = new Set([feature.id])
  if (typeof feature.properties.businessId === 'string') ownerIds.add(feature.properties.businessId)
  const related = datasets.filter(item => ['industry_chain_records','business_relations'].includes(item.id))
    .flatMap(item => item.features.filter(record => [record.properties.enterpriseId,record.properties.businessId].some(id => typeof id === 'string' && ownerIds.has(id)))
      .map(record => record.properties))
  const source = [...(Array.isArray(rows) ? rows : []), ...related]
  return source.filter((row):row is Record<string,unknown> => Boolean(row && typeof row === 'object' && !Array.isArray(row)))
    .filter(row => feature.properties.sourceServiceId !== enterpriseDirectoryId || row.sample !== true)
    .map(row => {
      const record: RelationRecord = {
        product:field(row,['product','goods']), activity:field(row,['activity','event']), quantity:field(row,['quantity','count']),
        receipt:field(row,['receipt','evidence','receiptNo'],''),
      }
      const url = field(row,['url'],'')
      const date = field(row,['date'],'')
      if (/^https?:\/\//i.test(url)) record.url = url
      if (date) record.date = date
      return record
    })
}

const numberValue = (value:unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value
  : Array.isArray(value) ? value.length : undefined
const percentValue = (value:unknown) => typeof value === 'number' && value >= 0 && value <= 100 ? value : undefined

function specificationIds(value: unknown) {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string' && item.trim())) return undefined
  return new Set(value.map(item => item.trim()))
}

export function chainDiagnosis(datasets:Dataset[], stage:ChainStage, topic:ChainTopic, demo:boolean, region='京山市') {
  const includeSample = demo && !hasEnterpriseDirectory(datasets)
  const illustration = (record: Record<string, unknown>) => record.sample === true || record.simulation === true ||
    record.simulated === true || record.outputBasis === 'estimate'
  const matches = datasets.filter(item => ['industry_diagnostics','chain_diagnostics'].includes(item.id))
    .flatMap(item => item.features.map(feature => feature.properties))
    .filter(record => (includeSample || !illustration(record)) && field(record,['chainStage','stage','segment'],'') === stage &&
      field(record,['chainTopic','topic','chainCategory','subtype'],'') === topic &&
      field(record,['region','township'],'京山市') === region)
    .sort((left,right) => field(right,['updatedAt','observationEnd'],'').localeCompare(field(left,['updatedAt','observationEnd'],'')))
  const record = matches[0]
  const requested = specificationIds(record?.demandSpecifications)
  const available = specificationIds(record?.supplySpecifications)
  const demand = requested?.size ?? numberValue(record?.demandSpecifications)
  const supply = available?.size ?? numberValue(record?.supplySpecifications)
  const matched = requested && available ? [...requested].filter(id => available.has(id)).length : undefined
  const coverage = percentValue(record?.coverageRate) ?? (demand && matched !== undefined
    ? Math.round(matched / demand * 100) : undefined)
  const threshold = percentValue(record?.threshold)
  const weak = coverage !== undefined && threshold !== undefined && coverage < threshold
  const period = field(record ?? {},['period','observationPeriod'])
  const verified = record?.verified === true
  const status = field(record ?? {},['status'], weak ? (verified ? '规格供给偏弱' : '规格供给偏弱 · 待复核')
    : stage === '中游' ? '运营记录待核实' : '关联记录待核实')
  const isSample = Boolean(record && illustration(record))
  const source = field(record ?? {},['source','evidenceSource','documentName'],isSample ? '演示规格供需样本' : record ? '已发布诊断台账' : '')
  return { period,demand,supply,coverage,threshold,weak,status,sample:isSample,verified,hasRecord:Boolean(record),source }
}

export function scopeDiagnoses(datasets:Dataset[],stage:ChainStage|null|undefined,topic:ChainTopic|null|undefined,demo:boolean,region='京山市') {
  return chain.filter(item => !stage || item.id === stage).flatMap(item =>
    item.topics.filter(kind => !topic || kind === topic).flatMap(kind => {
      const diagnosis = chainDiagnosis(datasets,item.id,kind,demo,region)
      return diagnosis.hasRecord ? [{stage:item.id,topic:kind,diagnosis}] : []
    }))
}
