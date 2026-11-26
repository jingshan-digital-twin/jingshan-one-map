<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ChainStage, ChainTopic } from './chain-taxonomy'
import type { CatalogEnterprise } from './industry-panorama'
import type { DataDocument, Dataset } from './types'
import { enterpriseCapacity, formatCapacityCount } from './industry-enterprise-capacity'

const props = defineProps<{
  datasets: Dataset[]
  mode: DataDocument['mode']
  region: string
  year: number | null
  stage: ChainStage | null
  topic: ChainTopic | null
  rows: CatalogEnterprise[]
}>()
const emit = defineEmits<{ enterprise: [entry: CatalogEnterprise] }>()
const report = computed(() => enterpriseCapacity(props.datasets, props.rows, props.region, props.mode,
  props.year, props.stage, props.topic))
const chosen = defineModel<ChainTopic | null>('focusTopic', { default: null })
const selected = computed(() => report.value.nodes.find(node => node.topic === chosen.value)
  ?? report.value.nodes.find(node => node.reported.length)
  ?? report.value.nodes.find(node => node.members.length) ?? report.value.nodes[0])
const currentMembers = computed(() => {
  const node = selected.value
  if (!node) return []
  const reported = new Set(node.reported.map(member => member.entry.key))
  return [...node.reported, ...node.members.filter(member => !reported.has(member.entry.key))]
})
const showAll = ref(false)
watch(selected, () => { showAll.value = false })
const percent = (value: number | null) => value === null ? '待核' : Number(value.toFixed(1)) + '%'
const amount = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
</script>

<template>
  <section class="diag-section">
    <h3>各环节经营企业</h3>
    <p class="diag-note">当前名录共 {{ report.count }} 家企业，已去重。{{ year ? year + ' 年' : '所选范围' }}已核实 {{ report.actual.verified }} 家的经营状态。</p>
    <div class="diag-scroll" tabindex="0" aria-label="各环节企业经营对比">
      <table class="diag-table capacity-table">
        <thead><tr><th scope="col">产业环节</th><th scope="col">名录</th><th scope="col">实际经营</th><th scope="col">其中规上</th><th scope="col">第一大企业营收占比</th></tr></thead>
        <tbody>
          <tr v-for="node in report.nodes" :key="node.topic">
            <th scope="row"><button type="button" class="diag-link" :aria-pressed="selected?.topic === node.topic"
              @click="chosen = node.topic">{{ node.topic }}</button></th>
            <td>{{ node.members.length }}</td>
            <td>{{ formatCapacityCount(node.actual) }}</td>
            <td>{{ formatCapacityCount(node.scaled) }}</td>
            <td>{{ node.complete && node.sum === 0 ? '无营收' : percent(node.firstShare) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="diag-note">企业数单位为家。跨环节企业在各自环节列示。≥ 表示已核实的最低家数。营收占比以本环节已核名录的合计营收为分母。</p>
  </section>

  <section v-if="selected" class="diag-section">
    <h3>{{ selected.topic }} · 企业与营收</h3>
    <p class="diag-note">经营状态已核 {{ selected.actual.verified }}/{{ selected.actual.total }} 家。已确认经营的 {{ selected.actual.yes }} 家中，{{ selected.reported.length }} 家有本环节营收。</p>
    <template v-if="selected.firstShare !== null">
      <p>已核名录在本环节合计营收 <b>{{ amount.format(selected.sum) }} 万元</b>。首家占 <b>{{ percent(selected.firstShare) }}</b><template v-if="selected.reported.length > 3">，前三家合计占 <b>{{ percent(selected.threeShare) }}</b></template>。</p>
      <p v-if="selected.firstShare > 50">过半营收集中在一家企业，优先走访其订单和交付情况，并核查其他企业的承接能力。</p>
      <p v-else-if="selected.reported.length > 3 && selected.threeShare !== null && selected.threeShare > 50">前三家合计贡献过半营收，可对照走访其主要客户和其余企业的订单来源。</p>
      <p v-else>可对照各家营收和规上认定情况，了解成长企业的经营规模与培育需求。</p>
    </template>
    <p v-else-if="selected.complete" class="diag-note">本环节已核名录合计营收为零，无法计算首家占比。</p>
    <p v-else-if="selected.members.length" class="diag-note">需补齐名录企业的年度经营状态和分环节营收，才能判断头部企业占比。</p>
    <p v-else class="diag-note">当前名录尚未收录该环节企业，需补查经营主体。</p>
    <ul v-if="currentMembers.length" class="capacity-members">
      <li v-for="member in showAll ? currentMembers : currentMembers.slice(0, 4)" :key="member.entry.key">
        <button type="button" class="diag-link capacity-name" @click="emit('enterprise', member.entry)">{{ member.entry.feature.properties.name }}</button>
        <span v-if="member.operating === true">{{ member.aboveScale === true ? '经营中 · 规上' : member.aboveScale === false ? '经营中 · 非规上' : '经营中 · 规上待核' }}</span>
        <span v-else>{{ member.operating === false ? '当年未经营' : '经营待核' }}</span>
        <strong v-if="member.operating === true && member.revenue !== null">{{ amount.format(member.revenue) }} 万元</strong>
      </li>
    </ul>
    <button v-if="currentMembers.length > 4" type="button" class="diag-link" :aria-expanded="showAll"
      @click="showAll = !showAll">{{ showAll ? '收起企业名单' : '查看全部 ' + currentMembers.length + ' 家企业' }}</button>
  </section>
</template>

<style scoped>
.capacity-table { width: 100%; }
.capacity-table :is(td, th) { white-space: nowrap; }
.capacity-table .diag-link[aria-pressed="true"] { font-weight: 700; text-decoration: underline; text-underline-offset: 4px; }
.capacity-members { display: grid; margin: 0; padding: 0; list-style: none; }
.capacity-members li { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 12px; padding: 8px 0; border-bottom: 1px solid var(--industry-table-line); }
.capacity-members span, .capacity-members strong { white-space: nowrap; }
.capacity-members span { color: var(--v14-muted); }
.capacity-members strong { color: var(--v14-metric); }
.capacity-name { min-width: 0; text-align: start; overflow-wrap: anywhere; }
</style>
