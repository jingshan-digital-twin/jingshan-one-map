<script setup lang="ts">
import { computed } from 'vue'
import type { Dataset } from './types'
import type { ChainStage, ChainTopic } from './chain-taxonomy'
import MidstreamProcurementComparison from './MidstreamProcurementComparison.vue'
import ProcurementComparisonExample from './ProcurementComparisonExample.vue'
import { scopeDiagnoses } from './industry-panorama'
import { diagnoseProcurement, formatProcurementAmount as money } from './industry-procurement'

const props = defineProps<{
  datasets: Dataset[]; mode: 'demo' | 'live'; region: string; year: number | null
  stage: ChainStage | null; topic: ChainTopic | null
}>()
const emit = defineEmits<{ drill: [topic: ChainTopic] }>()
const analysis = computed(() => diagnoseProcurement(props.datasets, props))
const comparingMidstream = computed(() => analysis.value.topicComparison.length > 0)
const missingTopics = computed(() => props.stage === '中游' && props.topic && !analysis.value.rows.length
  ? [props.topic] : analysis.value.topicComparison.filter(row => !row.orderCount).map(row => row.topic))
const publicCases = [
  { topic: '场馆运营', title: '公开赛场地维护', source: '湖北省体育局报道', url: 'https://www.sport.gov.cn/n14471/n14488/n14525/c29080967/content.html',
    description: '京山网球公开赛运营方确认赛前完成了场地检查和维修。报道未披露维修供应商、结算金额或订单次数。' },
  { topic: '培训陪练', title: '奥运梯队班集训', source: '湖北省政府采购网合同公告', url: 'http://www.ccgp-hubei.gov.cn/contract/202606/contract_8a8483f49ea6c926019f129bd6ac6ff6.html',
    description: '京山市文化和旅游局于 2025 年 9 月 2 日与京山市世杰体育培训有限公司签订 183.106 万元的集训服务合同，履约期跨至 2026 年。合同反映本地企业承接的培训业务，培训机构自身的采购支出另按实采订单统计。' },
  { topic: '赛事组织', title: '高校网球赛事配套', source: '湖北省体育局赛事记录', url: 'https://www.sport.gov.cn/n14471/n14488/n14525/c29012706/content.html',
    description: '高校网球赛事由长江场馆运营公司调试专业设备，京山市网球产业发展有限公司组织本地食宿和交通服务。报道披露了分工，采购金额和选择供应商的原因尚待订单核实。' },
] as const
const visibleCases = computed(() => props.stage === '中游' && props.region === '京山市' && analysis.value.year === 2025
  ? publicCases.filter(item => !props.topic || item.topic === props.topic) : [])
const scopeName = computed(() => [analysis.value.year && analysis.value.year + ' 年度', props.region, props.topic || props.stage || '全产业链'].filter(Boolean).join(' · '))
const collectFrom = computed(() => props.topic ? props.topic + '采购方' : !props.stage || props.stage === '中游'
  ? '场馆、俱乐部、培训机构和赛事主办方' : props.stage + '企业')
const specs = computed(() => {
  const year = analysis.value.year
  const datasets = props.datasets.filter(dataset => ['industry_diagnostics', 'chain_diagnostics'].includes(dataset.id))
    .map(dataset => ({ ...dataset, features: dataset.features.filter(({ properties: p }) => {
      if (p.verified !== true || p.sample === true || p.simulation === true || p.simulated === true) return false
      if (year === null) return true
      const period = String(p.period || p.observationPeriod || '')
      const years = period.match(/\d{4}/g) || []
      return years.length > 0 && years.every(value => Number(value) === year)
    }) }))
  return scopeDiagnoses(datasets, props.stage, props.topic, false, props.region)
    .filter(({ diagnosis: d }) => d.coverage !== undefined || d.supply !== undefined || d.demand !== undefined)
})
const decimal = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const share = (rate: number | null) => rate === null ? '待核算' : decimal.format(rate) + '%'
</script>

<template>
  <section class="diag-section procurement" aria-label="本地配套与供需缺口">
    <MidstreamProcurementComparison v-if="comparingMidstream" :topics="analysis.topicComparison" @drill="emit('drill', $event)" />
    <h3 v-else>本地配套与供需缺口</h3>
    <ProcurementComparisonExample v-if="missingTopics.length" :key="missingTopics.join('/')" :topics="missingTopics" />
    <details v-if="visibleCases.length" class="purchase-evidence public-cases">
      <summary>2025 年京山公开案例（{{ visibleCases.length }} 项）</summary>
      <article v-for="item in visibleCases" :key="item.url" class="purchase-review">
        <strong>{{ item.topic }} · {{ item.title }}</strong>
        <p>{{ item.description }}</p>
        <a :href="item.url" target="_blank" rel="noopener noreferrer">{{ item.source }}</a>
      </article>
    </details>
    <h4 v-if="comparingMidstream && analysis.rows.length">中游采购合计</h4>
    <dl v-if="!comparingMidstream || analysis.rows.length" class="spend-metrics">
      <div><dt>本地采购金额占比</dt><dd>{{ share(analysis.share) }}</dd></div>
      <div><dt>已知本地金额</dt><dd>{{ analysis.rows.length ? money(analysis.localFen) + ' 元' : '待补录' }}</dd></div>
      <div><dt>已知外采金额</dt><dd>{{ analysis.rows.length ? money(analysis.externalFen) + ' 元' : '待补录' }}</dd></div>
    </dl>
    <template v-if="analysis.rows.length">
      <p class="diag-note">{{ scopeName }}，已核对 {{ analysis.orderCount }} 笔采购订单、{{ analysis.rows.length }} 条明细。按采购方所在镇街统计，京山市内供应商计入本地采购。</p>
      <p v-if="analysis.missingAmount || analysis.missingLocality" class="diag-note">
        金额待补 {{ analysis.missingAmount }} 条，供应商属地待核 {{ analysis.missingLocality }} 条（已知金额 {{ money(analysis.unknownFen) }} 元）。
      </p>
      <p v-if="analysis.share !== null">本地实采 {{ money(analysis.localFen) }} 元，占本期已核对采购总额 {{ money(analysis.knownFen) }} 元的 {{ share(analysis.share) }}。</p>
      <p v-else-if="!analysis.missingAmount && !analysis.knownFen">本期已核对订单的采购金额合计为零，无法计算金额占比。</p>

      <template v-if="!comparingMidstream">
      <h4>采购方买了什么</h4>
      <div class="diag-scroll"><table class="diag-table">
        <thead><tr><th>采购方环节</th><th>品类</th><th>明细数</th><th>已知本地金额（元）</th><th>已知外采金额（元）</th><th>本地金额占比</th></tr></thead>
        <tbody><tr v-for="row in analysis.categories" :key="JSON.stringify([row.topic, row.category])">
          <td>{{ row.topic }}</td><td>{{ row.category }}</td><td>{{ row.count }}</td><td>{{ money(row.localFen) }}</td><td>{{ money(row.externalFen) }}</td><td>{{ share(row.share) }}</td>
        </tr></tbody>
      </table></div>

      <h4>外采原因</h4>
      <ul v-if="analysis.reasons.length" class="reason-list">
        <li v-for="row in analysis.reasons" :key="row.reason"><span>{{ row.reason || '原因待核实' }}</span><span>{{ row.count }} 条 · 已知 {{ money(row.knownFen) }} 元</span></li>
      </ul>
      <p v-else class="diag-note">本期台账中暂无已确认供应商在京山市外的采购明细。</p>

      <h4>反复外采与跟进事项</h4>
      <p v-if="analysis.review.length" class="diag-note">按同一采购方、同一品类追溯至所选年度。不同订单跨月发生，计为反复外采。</p>
      <article v-for="item in analysis.review" :key="JSON.stringify([item.topic, item.buyer, item.category])" class="purchase-review">
        <strong>{{ topic ? '' : item.topic + ' · ' }}{{ item.buyer }} · {{ item.category }}</strong>
        <p>{{ item.repeated ? '反复外采' : '本期外采' }} · {{ item.first }} 至 {{ item.last }}，{{ item.orders }} 笔独立订单，涉及 {{ item.months }} 个月。</p>
        <p>本期记录的原因{{ item.reasons.length ? '为' + item.reasons.join('、') : '待经办人核实' }}。</p>
        <p v-for="action in item.actions" :key="action">{{ action }}</p>
        <p v-if="!item.actions.length">与采购方复核外采原因、规格及本地供应商报价，再确定是否需要对接或补充供给。</p>
      </article>
      <p v-if="!analysis.review.length" class="diag-note">尚无同一采购方跨月重复外采同一品类的记录，也无已记录的对接或扩产需求。</p>
      </template>

      <details class="purchase-evidence"><summary>核对采购凭证（{{ analysis.rows.length }} 条）</summary>
        <div class="diag-scroll"><table class="diag-table">
          <thead><tr><th>成交日期</th><th>采购方</th><th>品类</th><th>供应商</th><th>供应商属地</th><th>金额（元）</th><th>订单号</th><th>凭证编号</th><th>外采原因</th></tr></thead>
          <tbody><tr v-for="row in analysis.rows" :key="row.id">
            <td>{{ row.date }}</td><td>{{ row.buyer }}</td><td>{{ row.category }}</td><td>{{ row.supplier || '待补' }}</td><td>{{ row.locality }}</td>
            <td>{{ row.amountFen === null ? '待补' : money(row.amountFen) }}</td><td>{{ row.order }}</td><td>{{ row.receipt }}</td><td>{{ row.locality === '京山市外' ? row.reason || '待核实' : '—' }}</td>
          </tr></tbody>
        </table></div>
      </details>
    </template>
    <template v-else>
      <p>{{ scopeName }}尚无已核实的实采订单，本地采购金额占比和反复外采品类待核算。</p>
      <p class="diag-note">向{{ collectFrom }}收集订单与验收凭证，逐笔核实成交日期、品类、金额及供应商属地，即可比较哪些需求由京山企业承接。</p>
      <p v-if="!comparingMidstream" class="diag-note">跨月重复外采时，向经办人追问原因。未联系本地供货商的，可组织对接。本地供应商排期已满的，可核实扩产意愿。持续缺少合格供货商的，可调查需求规模，研判招商机会。</p>
      <p v-else class="diag-note">可在数据中台的「实际采购明细」录入订单，为外采品类填写经办人记录的原因。</p>
    </template>
    <details v-if="specs.length" class="purchase-evidence"><summary>已核实的规格供需记录（{{ specs.length }} 个环节）</summary>
      <div v-for="item in specs" :key="item.topic" class="purchase-review"><strong>{{ item.topic }} · {{ item.diagnosis.period }}</strong>
        <p>需求规格 {{ item.diagnosis.demand ?? '待补' }} 种，供应规格 {{ item.diagnosis.supply ?? '待补' }} 种，规格覆盖率 {{ share(item.diagnosis.coverage ?? null) }}。</p>
        <p>{{ item.diagnosis.source }}</p>
      </div>
    </details>
  </section>
</template>

<style scoped>
.procurement { display: grid; gap: 10px; min-width: 0; font: 400 16px/1.5 var(--v14-font); color: var(--v14-ink); }
.procurement :is(p,h3,h4,dl,dd,ul) { margin: 0; }
.procurement h3 { font-size: 20px; }
.procurement h4 { font-size: 16px; }
.spend-metrics { display: flex; flex-wrap: wrap; gap: 6px; }
.spend-metrics > div { flex: 1 1 max-content; padding: 8px 10px; background: var(--v14-list); }
.spend-metrics dt, .procurement th { white-space: nowrap; }
.spend-metrics dd { color: var(--v14-metric); font-size: 20px; font-weight: 700; }
.procurement .diag-scroll { overflow-x: auto; max-width: 100%; min-width: 0; }
.procurement .diag-table { width: 100%; border-collapse: collapse; font-size: 16px; }
.procurement :is(td,th) { text-align: start; padding: 6px 8px; border-bottom: 1px solid var(--industry-table-line); }
.procurement td { white-space: nowrap; }
.procurement th { background: var(--industry-table-heading); }
.reason-list { list-style: none; padding: 0; }
.reason-list li { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 2px 8px; padding: 4px 0; }
.purchase-review { display: grid; gap: 4px; padding: 8px 10px; background: var(--v14-list); }
.purchase-evidence { min-width: 0; }
.purchase-evidence summary { cursor: pointer; color: var(--v14-ink); font-weight: 700; }
.purchase-evidence[open] > :not(summary) { margin-top: 6px; }
.public-cases a { justify-self: start; color: var(--v14-metric); text-underline-offset: 3px; }
</style>
