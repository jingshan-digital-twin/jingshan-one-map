<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import IndustryModule from './IndustryModule.vue'
import IndustryEconomyAnalysis from './IndustryEconomyAnalysis.vue'
import IndustryEnterpriseCapacity from './IndustryEnterpriseCapacity.vue'
import IndustryProcurementAnalysis from './IndustryProcurementAnalysis.vue'
import EnterpriseNetworkPanel from './EnterpriseNetworkPanel.vue'
import { useSceneAssistant, type AssistantSelection } from './scene-assistant-context'
import { enterpriseFacilities, enterprisePartners } from './enterprise-network'
import { chain, enterpriseDirectoryId } from './chain-taxonomy'
import { fusionDestinationsId } from './fusion-destinations'
import { tourismProviderId } from './tourism-providers'
import { buildIndustryLinks } from './industry-links'
import { diagnoseStructure } from './industry-structure'
import { diagnoseIndustryConversion } from './industry-conversion'
import { cityOutputEstimate, formatIndustryOutput, type IndustryOutput } from './industry-output'
import { analyzeIndustryEconomy, growthFinding, scaleFinding } from './industry-economy'
import { diagnoseProcurement, procurementYears } from './industry-procurement'
import { enterpriseAnnualYears, enterpriseCapacity, formatCapacityCount } from './industry-enterprise-capacity'
import {
  buildPanoramaCatalog, enterpriseBusiness, enterpriseChainLabel, field, relationRecords, scopeDiagnoses,
  type CatalogEnterprise, type ChainStage, type ChainTopic, type Enterprise,
} from './industry-panorama'
import type { Dataset } from './types'

const props = defineProps<{
  view: 'diagnosis' | 'enterprise'
  stage: ChainStage | null
  topic: ChainTopic | null
  rows: CatalogEnterprise[]
  selected?: CatalogEnterprise | null
  datasets: Dataset[]
  mode: 'demo' | 'live'
  region: string
  output: IndustryOutput
}>()
const emit = defineEmits<{
  close: []; locate: [entry: Enterprise]; enterprise: [entry: CatalogEnterprise]; diagnosis: []
  scope: [stage: ChainStage | null, topic?: ChainTopic | null]
}>()
const analysisTabs = ['产业规模与结构', '增长来自哪里', '企业和经营能力', '本地配套与供需缺口'] as const
type Tab = typeof analysisTabs[number] | '主体档案' | '链上关系'
const panel = ref<HTMLElement>()
const closeButton = ref<HTMLButtonElement>()
const content = ref<HTMLElement>()
let trigger: HTMLElement | null = null
let compact: MediaQueryList | undefined
const tab = ref<Tab>(props.view === 'diagnosis' ? analysisTabs[0] : '主体档案')
const chosenYear = ref<number>()
const estimateYear = computed(() => props.region === cityOutputEstimate.region ? cityOutputEstimate.year : null)
const years = computed(() => [...new Set([
  ...props.output.years, ...enterpriseAnnualYears(props.datasets, props.region), ...procurementYears(props.datasets, props.region),
  ...(estimateYear.value === null ? [] : [estimateYear.value]),
])].sort((a, b) => b - a))
const year = computed(() => chosenYear.value !== undefined && years.value.includes(chosenYear.value)
  ? chosenYear.value : props.output.year ?? estimateYear.value ?? years.value[0] ?? null)
const analysisProps = computed(() => ({
  datasets: props.datasets, mode: props.mode, region: props.region, stage: props.stage, topic: props.topic, year: year.value,
}))
const scopeTopics = computed(() => chain.find(item => item.id === props.stage)?.topics ?? [])
const capacityTopic = ref<ChainTopic | null>(null)
const fromCapacity = ref(false)
const enterpriseTrail = ref<string[]>([])
const cityDirectory = computed(() => buildPanoramaCatalog(props.datasets, '京山市'))
const entry = computed(() => {
  const key = enterpriseTrail.value.at(-1)
  return key ? cityDirectory.value.find(row => row.key === key) ?? props.selected : props.selected
})
const business = computed(() => entry.value ? enterprisePartners(props.datasets, entry.value) : null)
const assistant = useSceneAssistant()
const graphContext = ref<AssistantSelection | null>(null)
const title = computed(() => props.view === 'diagnosis' ? '产业链诊断' : '产业主体档案')
const tabs = computed<readonly Tab[]>(() => props.view === 'diagnosis' ? analysisTabs : ['主体档案','链上关系'])
const scopeLabel = computed(() => [props.stage,props.topic].filter(Boolean).join(' / ') || '全产业链')
const structure = computed(() => diagnoseStructure(props.rows, props.stage, props.topic))
const links = computed(() => buildIndustryLinks(props.datasets, props.rows, props.topic))
const conversion = computed(() => !props.stage || props.stage === '下游'
  || (props.stage === '中游' && (!props.topic || ['赛事组织', '场馆运营'].includes(props.topic)))
  ? diagnoseIndustryConversion(props.datasets, props.rows, props.region, props.mode, props.topic) : null)
const current = computed(() => scopeDiagnoses(props.datasets,props.stage,props.topic,props.mode === 'demo',props.region)[0])
const relations = computed(() => entry.value ? relationRecords(props.datasets,entry.value.feature) : [])
const enterpriseProps = computed(() => entry.value?.feature.properties)
function publicProfile(row: CatalogEnterprise | null | undefined) {
  const values = row?.feature.properties
  return Boolean(values && values.sample !== true
    && (values.sourceServiceId === enterpriseDirectoryId || (Array.isArray(values.sources) && values.sources.length)))
}
const hasPublicProfile = computed(() => publicProfile(entry.value))
const sources = computed(() => {
  const raw = enterpriseProps.value?.sources
  if (!hasPublicProfile.value || !Array.isArray(raw)) return []
  return raw.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const title = field(item, ['title'], '')
    const url = field(item, ['url'], '')
    if (!title || !/^https?:\/\//i.test(url)) return []
    return [{title, url, evidence: field(item, ['evidence'], ''), date: field(item, ['date'], '')}]
  })
})
function townLabel(region?: string) {
  return !region || region === '京山市' ? '镇街待核实' : region
}
const operatingSites = computed(() => {
  const row = entry.value
  if (!row) return []
  return row.records.filter(record => record.datasetId === fusionDestinationsId).map(record => ({
    feature: record.feature,
    point: row.points.find(point => point.datasetId === record.datasetId && point.feature.id === record.feature.id),
  }))
})
const profile = computed(() => {
  const row = entry.value
  if (!row) return []
  const values = row.feature.properties
  const membership = enterpriseChainLabel(row)
  const providers = row.records.filter(record => record.datasetId === tourismProviderId)
  const providerField = (key: string) => [...new Set(providers.map(({ feature }) => field(feature.properties, [key], '')).filter(Boolean))].join('、')
  const towns = [...new Set(row.records.map(record => record.feature.properties.region).filter(town => town && town !== '京山市'))].join('、')
  const providerFacts = [
    ['机构类型', providerField('providerType')], ['业务类别', providerField('classification')], ['机构分级', providerField('grade')],
    ['许可证号', providerField('permitNumber')], ['关联场馆', providerField('venueName')], ['场馆关系', providerField('venueRelation')],
    ['场地情况', providerField('reportedCourtInfo')], ['点位精度', providerField('locationPrecision')],
  ]
  if (row.aboveThreshold) {
    return [
      ['链条环节', membership], ['所在镇街', towns || townLabel(values.region)],
      ['填报地址', field(values, ['address'], '')], ['报送单位', field(values, ['recordSource'], '')],
      ['填报日期', field(values, ['reportedOn'], '')],
      ['地图位置', values.locationReview?.chainLocation?.label ?? values.locationReview?.poi?.name ?? ''],
      ['定位依据', values.locationReview?.chainLocation?.precision ?? field(values, ['locationSource'], '')],
      ...providerFacts,
    ].filter(([,value]) => value)
  }
  if (hasPublicProfile.value) {
    return [
      ['链条环节', membership],
      ['主营业务', enterpriseBusiness(row, '待核实')],
      ['所在镇街', towns || townLabel(values.region)],
      ['相关地址', field(values, ['address'], '')],
      ...providerFacts,
    ].filter(([,value]) => value)
  }
  return [
    ['链条环节', membership],
    ['主营业务', enterpriseBusiness(row,'')], ['所在镇街', towns],
    ['登记地址', providerField('address') || (!operatingSites.value.length ? field(values,['address'],'') : '')],
    ['主体类别', providers.length || operatingSites.value.length ? '' : field(values,['classification','type','category'],'')],
    ['参与角色', field(values,['participationRole','role'],'')], ['关联资产', field(values,['relatedAssets','venue','facilityName'],'')],
    ...providerFacts,
  ].filter(([,value]) => value)
})
const registration = computed(() => {
  const values = enterpriseProps.value
  if (!values || !hasPublicProfile.value) return []
  const scope = field(values, ['businessScope', 'businessScopeExcerpt'], '')
  const scopeExcerpt = Boolean(values.businessScopeExcerpt) || /(?:节选|摘录|所披露的相关范围)/.test(scope)
  return [
    ['注册资本', field(values, ['registeredCapital'], '待核实')],
    [scopeExcerpt ? '经营范围（摘录）' : '经营范围', scope.replace(/^登记范围(?:节选|摘录)[：:]\s*/, '') || '待核实'],
    ['统一社会信用代码', field(values, ['creditCode','unifiedSocialCreditCode'], '')],
    ['曾用名', field(values, ['formerNames', 'formerName'], '')],
    ['成立日期', field(values, ['established'], '')],
    ['登记状态', field(values, ['registrationStatus'], '')],
    ['法定代表人', field(values, ['legalRepresentative'], '')],
    ['注册地址', field(values, ['registeredAddress'], '')],
  ].filter(([,value]) => value)
})

const findings = computed(() => {
  const data = current.value?.diagnosis
  if (!data) return ''
  return [
    data.demand === undefined ? '' : '登记需求 ' + data.demand + ' 种规格',
    data.supply === undefined ? '' : '本地可供 ' + data.supply + ' 种',
    data.coverage === undefined ? '' : '供需规格覆盖率为 ' + data.coverage + '%',
  ].filter(Boolean).join('，')
})
const selectedGraphItem = computed(() => tab.value === '链上关系' ? graphContext.value : null)
const consultEntry = computed(() => selectedGraphItem.value?.enterpriseKey
  ? cityDirectory.value.find(row => row.key === selectedGraphItem.value?.enterpriseKey)
  : selectedGraphItem.value ? undefined : entry.value)
const diagnosticPrompts = {
  产业规模与结构: '哪些环节支撑当前产值？',
  增长来自哪里: '哪个环节增量最大，哪个增速最快？',
  企业和经营能力: '有多少企业实际经营，其中多少家规上？',
  本地配套与供需缺口: '本地采购占多少，哪些品类反复外采？',
} as const
const questions = computed(() => props.view === 'enterprise'
  ? selectedGraphItem.value && !consultEntry.value ? []
  : publicProfile(consultEntry.value) ? ['有哪些链上企业？', ...(tab.value === '主体档案' ? ['与哪些场地有关？'] : []), '注册资本和经营范围是什么？','这家企业做什么业务？','业务依据有哪些？'] : ['这家企业做什么业务？','有哪些链上记录？']
  : tab.value in diagnosticPrompts ? [diagnosticPrompts[tab.value as keyof typeof diagnosticPrompts], '当前范围有哪些企业？']
  : ['当前范围有哪些企业？'])
function answerAnalysis(value: string): string | undefined {
  const period = year.value ? year.value + ' 年' : '当前年度'
  const middleComparison = props.stage === '中游' && !props.topic
  if (/采购|外采/.test(value) ||
      (middleComparison && tab.value === '本地配套与供需缺口' && /品类|原因|外购/.test(value))) {
    const report = diagnoseProcurement(props.datasets, analysisProps.value)
    if (middleComparison) {
      if (!report.rows.length) {
        const topics = report.topicComparison.map(row => row.topic).join('、')
        return period + props.region + '的' + topics + '均无已核验的采购明细，四个环节的本地采购占比、反复外采品类和原因均待核实。'
      }
      const lines = report.topicComparison.map(row => {
        if (!row.orderCount) return row.topic + '尚无已核验的采购订单。'
        const share = row.share === null ? '待核算' : '为 ' + row.share + '%'
        const repeats = row.externalCategories.filter(category => category.repeated).map(category => {
          const reasons = [...new Set(category.repeatedBuyers.flatMap(buyer => buyer.reasons))]
          if (category.repeatedBuyers.some(buyer => buyer.missingReason)) reasons.push('外采原因待补')
          return category.category + '（' + (reasons.join('、') || '外采原因待补') + '）'
        })
        return row.topic + '的本地采购金额占比' + share + '，已核对 ' + row.orderCount + ' 笔订单。' +
          (repeats.length ? '反复外采涉及' + repeats.join('、') + '。' : '尚未发现同一采购方跨月反复外采同一品类。')
      })
      return [period + props.region + '中游采购情况', ...lines].join('\n')
    }
    if (!report.rows.length) return period + scopeLabel.value + '尚无已核验的采购明细。请先汇集采购方的订单、实采金额、供应商属地和外采原因。'
    const share = report.share === null ? '本地采购金额占比待核算。' : '本地采购占已核对采购金额的 ' + Number(report.share.toFixed(1)) + '%。'
    const repeats = report.review.filter(item => item.repeated).map(item => item.buyer + '采购的' + item.category)
    return period + '已核对 ' + report.orderCount + ' 笔订单。' + share +
      (repeats.length ? '反复外采包括' + repeats.join('、') + '。可在采购凭证中核查外采原因。' : '已核对的订单中未见同一采购方跨月重复外采同一品类。')
  }
  if (/实际经营|规上/.test(value)) {
    const report = enterpriseCapacity(props.datasets, props.rows, props.region, props.mode, year.value, props.stage, props.topic)
    return period + scopeLabel.value + '名录有 ' + report.count + ' 家企业，实际经营家数 ' + formatCapacityCount(report.actual) +
      '，其中规上家数 ' + formatCapacityCount(report.scaled) + '。企业年度台账已核实 ' + report.actual.verified + ' 家的经营状态。'
  }
  if (/产值|增量|增速|同比/.test(value)) {
    const growth = /增长|增量|增速|同比/.test(value)
    const report = analyzeIndustryEconomy(props.datasets, props.region, props.mode, year.value, growth ? 'growth' : 'scale')
    const group = report.stages.find(item => item.stage === props.stage)
    const selected = group?.nodes.find(node => node.topic === props.topic) ?? group?.row ?? report.total
    const parts = group?.nodes ?? report.stages.map(item => item.row)
    if (growth) return growthFinding(parts) || period + scopeLabel.value + '缺少同一口径的连续两年产值，暂无法比较增长。'
    const total = selected.current
    return period + scopeLabel.value + (total === null ? '产值待补录。' :
      (report.estimated ? '产值估算为 ' : '产值为 ') + formatIndustryOutput(total) + ' 亿元。') +
      (props.topic ? '' : scaleFinding(parts) || '分项产值待补录，暂无法判断主要支撑环节。')
  }
}
function answer(value: string) {
  if (props.view === 'enterprise' && selectedGraphItem.value && !consultEntry.value) {
    if (/依据|来源|凭证|关系|距离|场地|业务|关联|参与|说明|事项/.test(value)) return selectedGraphItem.value.detail
    return '当前选中项可查询关联事实及依据。选择图中的企业后，还可以查询它的工商档案。'
  }
  if (props.view === 'enterprise' && consultEntry.value) {
    const subject = consultEntry.value
    const hasProfile = publicProfile(subject)
    const same = subject.key === entry.value?.key
    if (selectedGraphItem.value && /合作|股东|股权|持股|链上|伙伴|关系/.test(value)) return selectedGraphItem.value.detail
    if (hasProfile && /工商|登记|注册资本|经营范围/.test(value)) {
      const values = subject.feature.properties
      const capital = field(values,['registeredCapital'],'')
      const scope = field(values,['businessScope','businessScopeExcerpt'],'').replace(/^登记范围(?:节选|摘录)[：:]\s*/, '').replace(/[。；;]$/, '')
      return (capital ? '注册资本为' + capital : '注册资本待核实') + '。' + (scope ? '已披露的经营范围包括' + scope : '经营范围待核实') + '。'
    }
    if (hasProfile && /依据|来源/.test(value)) {
      const refs = subject.feature.properties.sources
      const note = Array.isArray(refs) ? refs.find(item => item && typeof item.evidence === 'string')?.evidence : ''
      return note ? note + ' 可在该企业的「主体档案」中查看公开资料。' : '公开资料链接待补充。'
    }
    if (subject.feature.properties.sample !== true && /附近|邻近|周边|场地|球场|场馆/.test(value)) {
      const radiusKm = 3
      const { nodes, located, policy } = enterpriseFacilities(props.datasets, subject, radiusKm)
      if (!policy.eligible) {
        const known = nodes.filter(node => node.evidence.length).map(node => node.target + '（' + node.label + '）')
        return policy.reason + (known.length ? ' 已有资料记录了' + known.join('、') + '。' : '')
      }
      const names = nodes.slice(0, 4).map(node => node.target + '（' + node.label + '）')
      if (!names.length) return located
        ? radiusKm + ' 公里内暂未匹配到有定位依据的相关设施。'
        : '当前档案缺少具名场地记录，企业经营场所的坐标也待核实。'
      return names.join('、') + '。' + (located ? '' : '经营场所坐标待核实，暂无法测距。')
    }
    if (subject.feature.properties.sample !== true && /合作|股东|股权|持股|链上|伙伴|关系/.test(value)) {
      const peers = same && business.value ? business.value : enterprisePartners(props.datasets, subject)
      return peers.nodes.length ? peers.nodes.map(node => node.target + '（' + node.label + '）').join('、') + '。可在「链上关系」查看每项凭证。'
        : '当前档案尚无可核对双方名称和角色的企业关系凭证。'
    }
    if (/凭证|记录|关系|活动/.test(value)) {
      const count = same ? relations.value.length : relationRecords(props.datasets, subject.feature).length
      return '台账中共有 ' + count + ' 条关联记录。' + (count ? '有具名企业关系的记录可在图中点击连线查看凭证。' : '可补充该主体的实际合作活动及凭证。')
    }
    if (/业务|产品|主体|企业|乡镇|位置/.test(value)) return subject.feature.properties.name + '：' +
      enterpriseBusiness(subject,'未记录') + '（' + townLabel(subject.feature.properties.region) + '）'
  } else {
    const analysis = answerAnalysis(value)
    if (analysis) return analysis
    if (/消费|承接|转化|票根/.test(value) && conversion.value) return conversion.value.summary + ' ' + conversion.value.nextStep
    if (/合作|凭证|股权|链路|关联/.test(value)) {
      return links.value.length
        ? links.value.length + ' 项合作有具名记录。' + links.value.map(link => link.product + '（' + link.kind + '）').join('、') + '。在企业档案的「链上关系」中点击连线可查看凭证。'
        : '当前范围尚未收录能核对双方企业的合作凭证。可先核对采购合同、联合承办名单或运营协议。'
    }
    if (/核查|核实|下一步|建议|薄弱/.test(value)) {
      const first = structure.value.priorities[0] ?? structure.value.topics[0]
      return first ? first.topic + '。' + first.reason + ' ' + first.nextCheck : '当前范围缺少可核查的产业环节。'
    }
    if (/规格|供需/.test(value)) return current.value
      ? current.value.stage + ' · ' + current.value.topic + '：' + (findings.value || current.value.diagnosis.status) + '。' +
        (current.value.diagnosis.sample ? '数据来自演示样本。' : '')
      : '当前范围尚无已发布的供需诊断记录。'
    if (/结构|依据|环节|覆盖/.test(value)) return '当前范围涉及 ' + structure.value.topicCount + ' 个环节，'
      + structure.value.coveredCount + ' 个有企业记录，' + structure.value.singleCount + ' 个仅收录一家企业。'
    if (/企业|主体|名录/.test(value)) return scopeLabel.value + '收录 ' + structure.value.enterpriseCount + ' 家企业。' +
      (structure.value.enterpriseCount ? '可在「企业和经营能力」按环节查看名单。' : '')
  }
  return '当前台账暂无法回答这个问题。可选择上方问题查阅已有记录。'
}
assistant.register(computed(() => ({
  key: props.view === 'enterprise' ? 'enterprise:' + entry.value?.key : ['diagnosis', props.region, scopeLabel.value, year.value, tab.value].join(':'),
  title: props.view === 'enterprise' ? selectedGraphItem.value?.title ?? entry.value?.feature.properties.name ?? '产业主体档案' : props.region + ' · ' + scopeLabel.value + '诊断',
  prompts: questions.value,
  selection: selectedGraphItem.value,
  beforeLocate: () => emit('close'),
  answer,
})))

function openAnalysisEnterprise(entry: CatalogEnterprise) {
  fromCapacity.value = true
  emit('enterprise',entry)
}
function explore(key: string) {
  if (!cityDirectory.value.some(row => row.key === key)) return
  const route = [props.selected?.key, ...enterpriseTrail.value]
  const previous = route.indexOf(key)
  enterpriseTrail.value = previous < 0 ? [...enterpriseTrail.value, key] : enterpriseTrail.value.slice(0, previous)
}
watch(() => entry.value?.key, () => {
  graphContext.value = null
  if (content.value) content.value.scrollTop = 0
})
function locate(row: CatalogEnterprise | null | undefined) {
  if (!row?.points.length) return
  emit('close')
  emit('locate',row.points[0])
}
watch([tab,() => props.stage,() => props.topic,year], () => { if (content.value) content.value.scrollTop = 0 }, {flush:'post'})
watch([() => props.stage,() => props.topic], () => {
  capacityTopic.value = null
})
watch([() => props.view,() => props.selected?.key,() => props.region], () => {
  enterpriseTrail.value = []
  if (props.view === 'enterprise') tab.value = '主体档案'
  if (props.view === 'diagnosis' && fromCapacity.value) {
    tab.value = '企业和经营能力'
    fromCapacity.value = false
  } else if (props.view === 'diagnosis' && (tab.value === '主体档案' || tab.value === '链上关系')) {
    tab.value = analysisTabs[0]
  }
  graphContext.value = null
})
function openForViewport() {
  const dialog = panel.value
  if (!(dialog instanceof HTMLDialogElement)) return
  if (dialog.open) dialog.close()
  if (compact?.matches) dialog.showModal()
  else dialog.show()
  closeButton.value?.focus({preventScroll:true})
}
onMounted(() => {
  trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  compact = window.matchMedia('(max-width: 960px)')
  compact.addEventListener('change', openForViewport)
  openForViewport()
})
watch(() => props.view, openForViewport, { flush: 'post' })
onBeforeUnmount(() => {
  compact?.removeEventListener('change', openForViewport)
  const restoreFocus = panel.value?.contains(document.activeElement)
  if (panel.value instanceof HTMLDialogElement) panel.value.close()
  if (restoreFocus && trigger?.isConnected) trigger.focus({preventScroll:true})
})
</script>

<template>
  <component :is="view === 'diagnosis' ? 'aside' : 'dialog'" ref="panel" class="panorama-drawer panorama-v14 industry-rail right-panel"
    :id="view === 'diagnosis' ? 'dashboard-right' : undefined" :class="{ 'inline-diagnosis': view === 'diagnosis' }"
    :closedby="view === 'enterprise' ? 'closerequest' : undefined" :aria-label="title"
    @cancel.prevent="emit('close')" @keydown.esc.stop.prevent="emit('close')">
    <IndustryModule :title="title" fill>
      <template #heading-actions><div class="drawer-actions">
        <button type="button" class="industry-button drawer-consult" aria-haspopup="dialog" aria-controls="scene-assistant-panel"
          @click="assistant.openFrom($event)">{{ view === 'diagnosis' ? '解读诊断' : tab === '链上关系' ? '解读图谱' : '解读档案' }}</button>
        <button ref="closeButton" type="button" class="industry-button drawer-close" :aria-label="'关闭'+title" @click="emit('close')"><span aria-hidden="true">×</span></button>
      </div></template>
      <div class="drawer-context drawer-scope"><h3>{{ view === 'enterprise' ? entry?.feature.properties.name : scopeLabel }}</h3>
        <span v-if="view === 'enterprise' && entry?.aboveThreshold" class="industry-status">限上企业</span>
        <span v-if="view === 'enterprise' && enterpriseProps?.aboveScale === true" class="industry-status">规上企业</span>
        <button v-if="view === 'enterprise' && enterpriseTrail.length" type="button" class="industry-button" @click="enterpriseTrail.pop()">返回上一家</button>
        <button v-if="view === 'enterprise' && fromCapacity" type="button" class="industry-button" @click="emit('diagnosis')">返回企业和经营能力</button>
        <div class="diagnosis-period"><span>{{ view === 'enterprise' && enterpriseTrail.length ? entry?.feature.properties.region || '京山市' : region }}</span>
          <select v-if="view === 'diagnosis' && years.length > 1" aria-label="诊断年度" :value="year" @change="chosenYear = Number(($event.target as HTMLSelectElement).value)">
            <option v-for="item in years" :key="item" :value="item">{{ item }} 年度</option>
          </select>
          <span v-else-if="view === 'diagnosis' && year">{{ year }} 年度</span>
        </div></div>
      <div class="drawer-workspace" :class="{ 'diagnosis-workspace': view === 'diagnosis' }">
      <nav class="industry-tabs" :aria-label="title+'内容'">
        <button v-for="item in tabs" :key="item" type="button" :aria-pressed="tab === item" @click="tab = item">{{ item }}</button>
      </nav>
      <div ref="content" class="drawer-content">
      <div v-if="view === 'diagnosis'" class="diagnosis-scope" role="group" aria-label="诊断范围">
        <button type="button" :aria-pressed="!stage" @click="emit('scope',null)">全产业链</button>
        <button v-for="item in chain" :key="item.id" type="button" :aria-pressed="stage === item.id" @click="emit('scope',item.id)">{{ item.id }}</button>
        <select v-if="stage" aria-label="诊断环节" :value="topic ?? ''" @change="emit('scope',stage,($event.target as HTMLSelectElement).value as ChainTopic || null)">
          <option value="">全部环节</option><option v-for="item in scopeTopics" :key="item" :value="item">{{ item }}</option>
        </select>
      </div>
      <IndustryEconomyAnalysis v-if="tab === '产业规模与结构' || tab === '增长来自哪里'" v-bind="analysisProps"
        :section="tab === '产业规模与结构' ? 'scale' : 'growth'" @drill="(stage, topic) => emit('scope', stage, topic)" />
      <IndustryEnterpriseCapacity v-else-if="tab === '企业和经营能力'" v-bind="analysisProps" v-model:focus-topic="capacityTopic" :rows="rows" @enterprise="openAnalysisEnterprise" />
      <IndustryProcurementAnalysis v-else-if="tab === '本地配套与供需缺口'" v-bind="analysisProps" @drill="topic => emit('scope', '中游', topic)" />
      <template v-else-if="tab === '主体档案' && entry">
        <section v-if="hasPublicProfile && enterpriseProps?.businessPhase" class="drawer-context section-heading">
          <h3>项目进展</h3><span class="industry-status" data-tone="amber">{{ enterpriseProps.businessPhase }}</span>
        </section>
        <dl class="industry-kv drawer-facts"><div v-for="[name,value] in profile" :key="name"><dt>{{ name }}</dt><dd>{{ value }}</dd></div></dl>
        <section v-if="operatingSites.length" class="drawer-section">
          <h3 class="section-heading">运营点位</h3>
          <ul class="drawer-sources">
            <li v-for="site in operatingSites" :key="site.feature.id">
              <button v-if="site.point" type="button" class="industry-row-action" @click="emit('locate',site.point)">{{ site.feature.properties.name }} ›</button>
              <strong v-else>{{ site.feature.properties.name }}</strong>
              <p v-if="site.feature.properties.address">{{ site.feature.properties.address }}</p>
            </li>
          </ul>
        </section>
        <section v-if="hasPublicProfile" class="drawer-section">
          <h3 class="section-heading">工商登记信息</h3>
          <dl class="industry-kv drawer-facts"><div v-for="[name,value] in registration" :key="name"><dt>{{ name }}</dt><dd>{{ value }}</dd></div></dl>
        </section>
        <section v-if="hasPublicProfile" class="drawer-section">
          <h3 class="section-heading">公开资料</h3>
          <ul v-if="sources.length" class="drawer-sources">
            <li v-for="source in sources" :key="source.url">
              <a :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }}</a>
              <time v-if="source.date" :datetime="source.date">{{ source.date }}</time>
              <p v-if="source.evidence">{{ source.evidence }}</p>
            </li>
          </ul>
          <p v-else class="drawer-empty">公开资料链接待补充。</p>
        </section>
        <button v-if="entry.points.length" class="industry-button primary drawer-action" type="button" @click="locate(entry)">地图定位<span v-if="enterpriseProps?.locationLabel"> · {{ enterpriseProps.locationLabel }}</span></button>
        <p v-else-if="entry.aboveThreshold || hasPublicProfile" class="drawer-empty">地图位置待核实</p>
      </template>
      <template v-else-if="tab === '链上关系'">
        <EnterpriseNetworkPanel v-if="entry" :key="entry.key" :center="entry" :datasets="datasets"
          @context="graphContext = $event" @locate="emit('locate', $event)" @explore="explore" />
      </template>
      </div>
      </div>
    </IndustryModule>
  </component>
</template>

<style scoped>
.panorama-drawer.industry-rail {
  position: relative;
  z-index: 4;
  inset: auto;
  margin: 0 0 calc(var(--rail-bottom-inset) - var(--scene-footer-height));
  width: 100%;
  max-width: none;
  min-height: 0;
  height: auto;
  max-height: none;
  max-block-size: none;
  padding: 0;
  border: 1px solid var(--v14-edge);
  background: var(--v14-overlay);
  color: var(--v14-ink);
  box-shadow: var(--side-shadow);
  backdrop-filter: blur(12px);
  overflow: hidden;
}
dialog.panorama-drawer:not([open]) { display: none; }
.panorama-drawer::backdrop { background: rgb(8 23 45 / .58); }
.cockpit-light .panorama-drawer::backdrop { background: rgb(18 58 89 / .42); }
.panorama-drawer > :deep(.industry-module) { height: 100%; min-height: 0; flex: 1; }
.panorama-drawer :deep(.v14-overview-heading) { min-height: 46px; gap: 8px; padding: 0 12px; flex-wrap: nowrap; }
.panorama-drawer :deep(.v14-overview-heading h2) { font: 700 20px/28px var(--v14-font); }
.panorama-drawer > :deep(.industry-module > .industry-module-body) { display: flex; flex-direction: column; flex: 1; gap: 12px; min-height: 0; padding: 12px; }
.panorama-drawer .drawer-close { flex: none; min-width: 32px; width: 32px; min-height: 30px; padding: 0; font-size: 22px; line-height: 24px; }
.drawer-workspace { flex: 1; min-height: 0; display: grid; grid-template-rows: auto minmax(0,1fr); gap: 12px; }
.diagnosis-workspace .industry-tabs button { white-space: nowrap; }
.diagnosis-period, .diagnosis-scope { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.diagnosis-period { color: var(--v14-muted); font: 400 16px/24px var(--v14-font); }
.diagnosis-period select, .diagnosis-scope select { width: auto; min-height: 32px; padding: 2px 6px; font: inherit; }
.diagnosis-scope button {
  border: 1px solid var(--industry-table-line); background: var(--v14-list); color: var(--v14-ink);
  padding: 3px 10px; font: 400 16px/24px var(--v14-font); white-space: nowrap; cursor: pointer;
}
.diagnosis-scope button[aria-pressed=true] {
  border-color: var(--v14-list-line); font-weight: 700; box-shadow: inset 0 -2px var(--v14-list-line);
}
.diagnosis-workspace :deep(.diag-section) { display: grid; align-content: start; gap: 8px; min-width: 0; color: var(--v14-ink); font: 400 16px/24px var(--v14-font); }
.diagnosis-workspace :deep(.diag-section h3) { margin: 0; font: 700 18px/26px var(--v14-font); }
.diagnosis-workspace :deep(.diag-note) { color: var(--v14-muted); }
.diagnosis-workspace :deep(.diag-scroll) { overflow-x: auto; min-width: 0; max-width: 100%; }
.diagnosis-workspace :deep(.diag-table) { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.diagnosis-workspace :deep(.diag-table :is(td,th)) { padding: 6px 8px; border-bottom: 1px solid var(--industry-table-line); text-align: start; white-space: nowrap; }
.diagnosis-workspace :deep(.diag-table thead) { background: var(--industry-table-heading); }
.diagnosis-workspace :deep(.diag-link) { justify-self: start; border: 0; background: transparent; color: var(--v14-ink); padding: 2px 0; font: inherit; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.drawer-actions { margin-inline-start: auto; display: flex; flex: none; align-items: center; gap: 6px; }
.drawer-actions .drawer-consult { font-size: 16px; min-height: 30px; padding: 2px 8px; white-space: nowrap; }
.drawer-workspace .industry-tabs { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 4px; }
.drawer-workspace .industry-tabs button {
  min-width: 0; min-height: 34px; padding: 4px 2px; border-radius: 0;
  color: var(--v14-ink); font: 700 16px/24px var(--v14-font);
}
.drawer-workspace .industry-tabs button[aria-pressed="true"] { color: #fff; }
.drawer-content {
  min-width: 0; min-height: 0; display: grid; align-content: start; gap: 12px; grid-auto-rows: max-content;
  overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--v14-scroll-thumb) transparent;
}
.drawer-content p, .drawer-content dd { margin: 0; overflow-wrap: anywhere; }
.drawer-section { display: grid; align-content: start; gap: 8px; }
.drawer-content .section-heading {
  position: relative; margin: 0; min-height: 32px; padding: 4px 8px 4px 16px;
  color: var(--v14-ink); background: var(--industry-table-heading); font: 700 16px/24px var(--v14-font);
}
.section-heading::before { position: absolute; content: ''; top: 9px; left: 6px; height: 14px; width: 3px; background: var(--v14-list-line); border-radius: 2px; }
.drawer-context { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px 8px; }
.drawer-context h3 { min-width: 0; margin: 0; overflow-wrap: anywhere; font: 700 16px/24px var(--v14-font); }
.drawer-scope h3 { font-size: 18px; line-height: 26px; }
.drawer-context > span:not(.industry-status) { color: var(--v14-muted); font: 400 14px/22px var(--v14-font); }
.drawer-context .industry-status { padding: 0 6px; border-radius: 2px; font: 400 14px/20px var(--v14-font); }
.drawer-facts { grid-template-columns: minmax(82px,.75fr) minmax(0,1.6fr); border-radius: 2px; }
.drawer-content .drawer-facts :is(dt,dd) { min-height: 36px; padding: 7px 8px; font: 400 14px/22px var(--v14-font); }
.drawer-content .drawer-facts dd { font-weight: 700; }
.drawer-facts > div:last-child :is(dt,dd) { border-block-end: 0; }
.drawer-section p { font: 400 16px/24px var(--v14-font); }
.drawer-empty { padding: 12px; color: var(--v14-muted); background: var(--v14-list); font: 400 14px/22px var(--v14-font); }
.drawer-sources { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.drawer-sources li { display: grid; gap: 4px; padding: 8px; background: var(--v14-list); }
.drawer-sources a { color: var(--v14-ink); text-decoration: underline; text-underline-offset: 3px; overflow-wrap: anywhere; font: 700 14px/22px var(--v14-font); }
.drawer-sources p { font: 400 14px/22px var(--v14-font); }
.drawer-sources time { color: var(--v14-muted); font: 400 13px/20px var(--v14-font); }
.drawer-content .industry-button { min-height: 34px; border-radius: 2px; padding: 4px 12px; font: 700 16px/24px var(--v14-font); }
.drawer-action { justify-self: end; }
.panorama-drawer :where(button, input, select, a):focus-visible { outline: 2px solid var(--v14-list-line); outline-offset: -2px; }
@media (max-width: 960px) {
  dialog.panorama-drawer.industry-rail { position: fixed; inset: 12px 8px 12px auto; margin: 0; width: min(540px, calc(100% - 16px)); }
}
.inline-diagnosis { box-sizing: border-box; min-width: 0; container-type: inline-size; }
@container (max-width: 280px) {
  .diagnosis-workspace > .industry-tabs { display: flex; flex-wrap: nowrap; overflow-x: auto; }
  .diagnosis-workspace > .industry-tabs button { flex: 0 0 auto; padding-inline: 8px; }
}
@media (prefers-reduced-motion: no-preference) {
  .panorama-drawer[open] { animation: panorama-drawer-in .18s ease-out; }
  @keyframes panorama-drawer-in { from { transform: translateX(24px); opacity: 0; } }
}
</style>
