<script setup lang="ts">
import { computed } from 'vue'
import type { ChainStage, ChainTopic } from './chain-taxonomy'
import type { Dataset } from './types'
import { analyzeIndustryEconomy, formatChange, formatPercent, growthFinding, scaleFinding } from './industry-economy'
import { formatIndustryOutput } from './industry-output'

const props = defineProps<{
  datasets: Dataset[]
  mode: 'demo' | 'live'
  region: string
  year: number | null
  stage: ChainStage | null
  topic: ChainTopic | null
  section: 'scale' | 'growth'
}>()
const emit = defineEmits<{ drill: [stage: ChainStage | null, topic?: ChainTopic | null] }>()
const report = computed(() => analyzeIndustryEconomy(props.datasets, props.region, props.mode, props.year, props.section))
const stageGroup = computed(() => report.value.stages.find(group => group.stage === props.stage))
const selected = computed(() => stageGroup.value?.nodes.find(node => node.topic === props.topic)
  ?? stageGroup.value?.row ?? report.value.total)
const groups = computed(() => stageGroup.value ? [stageGroup.value] : report.value.stages)
const comparison = computed(() => stageGroup.value?.nodes ?? report.value.stages.map(group => group.row))
const finding = computed(() => props.section === 'scale' ? scaleFinding(comparison.value) : growthFinding(comparison.value))
const bothYears = computed(() => report.value.hasCurrent && report.value.hasPrevious)
const changeRows = computed(() => {
  if (props.topic) return [selected.value]
  return [selected.value, ...comparison.value]
})
const hasChange = computed(() => changeRows.value.some(row => row.delta !== null))
const missingYears = computed(() => [
  report.value.hasCurrent ? null : report.value.year,
  report.value.hasPrevious ? null : report.value.previousYear,
].filter(year => year !== null).join('、'))
const tableAmount = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const tablePercent = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
function amountCell(value: number | null) {
  if (value === null || (value > 0 && value < 0.0001)) return formatIndustryOutput(value)
  return tableAmount.format(value)
}
function percent(value: number | null) {
  if (value === null) return '—'
  return value > 0 && value < 0.1 ? '<0.1%' : tablePercent.format(value) + '%'
}
const yearLabel = computed(() => report.value.year === null ? '年度' : report.value.year + ' 年度')
</script>

<template>
  <div class="economy">
    <template v-if="section === 'scale'">
      <div class="amount-card">
        <div><h3>{{ stage ? selected.name : '全链' }}年度产值</h3><span>{{ region }} · {{ yearLabel }}</span></div>
        <div class="amount-value">
          <strong>{{ formatIndustryOutput(selected.current) }}</strong>
          <span v-if="selected.current !== null">亿元</span>
          <span v-if="report.estimated && selected.current !== null" class="estimate">估算</span>
          <span v-if="selected.current === null">待补录</span>
        </div>
      </div>
      <p v-if="selected.combined" class="note">{{ selected.name }}与其他环节合并报入“{{ selected.combined }}”，独立产值待补录。</p>
      <p v-if="finding" class="finding">{{ report.estimated ? '按本次估算，' : '' }}{{ finding }}</p>
      <p v-else-if="stage && comparison.every(row => row.current === null)" class="note">{{ stage }}各环节尚无单列产值，暂无法判断哪个环节贡献最大。</p>
      <section v-if="!stage" class="breakdown" aria-label="上中下游产值及占比">
        <h3>上中下游产值及占比</h3>
        <div class="table-wrap"><table class="scale-table">
          <thead><tr><th scope="col">产业阶段</th><th scope="col">产值（亿元）</th><th scope="col">占全链</th></tr></thead>
          <tbody><tr v-for="group in report.stages" :key="group.stage">
            <th scope="row"><button type="button" class="scope-link" @click="emit('drill', group.stage)">{{ group.stage }} ›</button></th>
            <td>{{ amountCell(group.row.current) }}</td>
            <td><div class="share-cell"><i v-if="group.row.share !== null" aria-hidden="true"><b :style="{width: group.row.share + '%'}"></b></i><span>{{ percent(group.row.share) }}</span></div></td>
          </tr></tbody>
        </table></div>
        <p v-if="report.inconsistent" class="note">阶段合计与全链产值待核对，占比暂缺。</p>
      </section>
      <section class="breakdown" aria-label="环节产值与阶段内占比">
        <h3>{{ stage ? stage + '环节对比' : '各环节产值及阶段内占比' }}</h3>
        <div v-for="group in groups" :key="group.stage" class="node-group">
          <h4 v-if="!stage">{{ group.stage }} · {{ group.title }}</h4>
          <div class="table-wrap"><table class="scale-table">
            <thead><tr><th scope="col">产业环节</th><th scope="col">产值（亿元）</th><th scope="col">占{{ group.stage }}</th></tr></thead>
            <tbody><tr v-for="node in group.nodes" :key="node.name" :class="{selected: topic === node.topic}">
              <th scope="row"><button type="button" class="scope-link" @click="emit('drill', group.stage, node.topic)">{{ node.name }} ›</button></th>
              <td><template v-if="node.combined"><span :title="'合并报入' + node.combined">合并报送</span></template><template v-else>{{ amountCell(node.current) }}</template></td>
              <td><div class="share-cell"><i v-if="node.share !== null" aria-hidden="true"><b :style="{width: node.share + '%'}"></b></i><span>{{ percent(node.share) }}</span></div></td>
            </tr></tbody>
          </table></div>
          <p v-if="group.inconsistent" class="note">环节合计与{{ group.stage }}产值待核对，占比暂缺。</p>
        </div>
        <p v-if="groups.some(group => group.nodes.some(node => node.share === null))" class="note">“—”表示该项尚缺可用数据，或占比的分母为零。</p>
      </section>
    </template>
    <template v-else>
      <div class="amount-card">
        <div><h3>{{ selected.name }}产值增量</h3><span>{{ region }} · {{ report.year !== null ? report.year + ' 年较 ' + report.previousYear + ' 年' : '年度对比' }}</span></div>
        <div class="amount-value"><strong>{{ selected.delta === null ? '—' : formatChange(selected.delta) }}</strong><span>{{ selected.delta === null ? '待补录' : '亿元' }}</span></div>
      </div>
      <template v-if="bothYears">
        <p v-if="finding && !topic" class="finding">{{ finding }}</p>
        <section class="breakdown" aria-label="连续年度增长对比">
          <h3>{{ topic ? topic + '年度对比' : stage ? stage + '各环节增长' : '全链与各阶段增长' }}</h3>
          <div class="table-wrap"><table class="growth-table">
            <thead><tr><th scope="col">统计范围</th><th scope="col">{{ report.previousYear }} 年</th><th scope="col">{{ report.year }} 年</th><th scope="col">增量</th><th scope="col">同比</th><th scope="col">占比变化</th></tr></thead>
            <tbody><tr v-for="row in changeRows" :key="row.name">
              <th scope="row"><button v-if="row !== selected" type="button" class="scope-link" @click="emit('drill', row.stage, row.topic)">{{ row.name }} ›</button><template v-else>{{ row.name }}</template></th>
              <td>{{ formatIndustryOutput(row.previous) }}</td><td>{{ formatIndustryOutput(row.current) }}</td>
              <td>{{ row.delta === null ? '—' : formatChange(row.delta) }}</td>
              <td>{{ row.previous === 0 ? '零基数' : row.rate === null ? '—' : formatPercent(row.rate, true) + '%' }}</td>
              <td>{{ row.shareChange === null ? '—' : formatPercent(row.shareChange, true) }}</td>
            </tr></tbody>
          </table></div>
          <p class="note">产值与增量单位为亿元。阶段占全链、环节占所属阶段，占比变化单位为百分点。</p>
          <p v-if="!hasChange" class="note">两个年度均有报表，但当前范围缺少可逐项对照的金额。</p>
        </section>
      </template>
      <section v-else class="breakdown">
        <h3>连续年度数据待补</h3>
        <p>{{ report.year === null ? region + '尚未收录年度产值报表。' : region + '缺少 ' + missingYears + ' 年产值报表。' }}录入相同统计范围的两年产值后，可对照增量、同比增速和占比变化。</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.economy { display: grid; align-content: start; gap: 14px; min-width: 0; color: var(--v14-ink); font: 400 16px/1.5 var(--v14-font); }
.economy h3,.economy h4,.economy p { margin: 0; }
.economy h3 { font-size: 18px; line-height: 1.4; }
.economy h4 { font-size: 16px; }
.amount-card { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 14px; background: var(--v14-list); border: 1px solid var(--industry-table-line); padding: 12px; }
.amount-card > div:first-child > span,.note { color: var(--v14-muted); }
.amount-value { display: inline-flex; align-items: baseline; gap: 6px; white-space: nowrap; }
.amount-value strong { color: var(--v14-metric); font: 700 28px/1.2 var(--v14-font); }
.estimate { color: var(--v14-muted); }
.breakdown,.node-group { display: grid; gap: 6px; min-width: 0; }
.node-group + .node-group { margin-top: 6px; }
.finding { padding-inline-start: 8px; border-inline-start: 3px solid var(--v14-icon); }
.table-wrap { min-width: 0; overflow-x: auto; }
.economy table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.scale-table { table-layout: fixed; min-width: 344px; }
.scale-table thead :is(th:first-child,th:nth-child(2)) { width: 32%; }
.economy th,.economy td { padding: 5px 8px; border-bottom: 1px solid var(--industry-table-line); text-align: end; white-space: nowrap; }
.economy th:first-child { text-align: start; }
.economy thead { background: var(--industry-table-heading); }
.economy .selected { background: var(--v14-list); }
.scope-link { padding: 2px 0; border: 0; background: transparent; color: var(--v14-ink); font: inherit; text-decoration: underline; text-decoration-color: var(--v14-list-line); text-underline-offset: 3px; cursor: pointer; }
.scope-link:hover,.scope-link:focus-visible { color: var(--v14-metric); }
.share-cell { display: grid; grid-template-columns: 36px 7ch; justify-content: end; align-items: center; gap: 6px; }
.share-cell span { grid-column: 2; text-align: end; }
.share-cell i,.share-cell b { display: block; border-radius: 3px; height: 5px; }
.share-cell i { width: 36px; background: var(--v14-chart-track); }
.share-cell b { background: var(--v14-metric); }
</style>
