<script setup lang="ts">
import type { ChainTopic } from './chain-taxonomy'
import type { diagnoseProcurement } from './industry-procurement'

type TopicComparison = ReturnType<typeof diagnoseProcurement>['topicComparison'][number]
defineProps<{ topics: TopicComparison[] }>()
const emit = defineEmits<{ drill: [topic: ChainTopic] }>()
const percent = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })

function frequentCategories(row: TopicComparison) {
  if (!row.orderCount) return '待补录'
  const categories = row.externalCategories.filter(item => item.repeated)
  if (categories.length) return categories.map(item => item.category).join('、')
  return row.missingLocality ? '属地待核实' : '未见反复外采'
}
function reasonsText(reasons: string[], missing: boolean) {
  if (!reasons.length) return '原因待核实'
  return reasons.join('、') + (missing ? '（另有明细待补原因）' : '')
}
</script>

<template>
  <section class="midstream-comparison" aria-label="中游四个环节采购对比">
    <h3>中游四个环节采购对比</h3>
    <div class="diag-scroll">
      <table class="topic-table">
        <thead><tr><th scope="col">采购方环节</th><th scope="col">本地采购占比</th><th scope="col">反复外采品类</th></tr></thead>
        <tbody><tr v-for="row in topics" :key="row.topic">
          <th scope="row"><button type="button" class="diag-link" @click="emit('drill', row.topic)">{{ row.topic }} ›</button></th>
          <td class="local-share">{{ row.share === null ? '待核算' : percent.format(row.share) + '%' }}</td>
          <td>{{ frequentCategories(row) }}</td>
        </tr></tbody>
      </table>
    </div>
    <p class="diag-note">本地采购占比按金额计算，分母为该环节当年已核对的采购总额。供应商在京山市内计入本地。</p>
    <template v-if="topics.some(row => row.orderCount)">
      <h4>各环节外采原因</h4>
      <p class="diag-note">同一环节的同一采购方，在不同月份以独立订单外采同一品类，且本年有外采记录，计为反复外采。</p>
      <article v-for="row in topics" :key="row.topic" class="topic-reasons">
        <header><strong>{{ row.topic }}</strong><span>已核 {{ row.orderCount }} 笔订单</span></header>
        <p v-if="!row.orderCount" class="diag-note">本年度尚无已核实的采购订单。</p>
        <p v-else-if="!row.externalCategories.length" class="diag-note">{{ row.missingLocality ? '现有订单未确认外采，部分供应商属地待核实。' : '已核对的订单均为本地采购。' }}</p>
        <div v-for="item in row.externalCategories" :key="item.category" class="external-category">
          <p><strong>{{ item.category }}</strong> · 本年外采 {{ item.orderCount }} 笔</p>
          <p>本年记录的原因：{{ reasonsText(item.reasons, item.missingReason) }}</p>
          <details v-if="item.repeated" class="purchase-evidence">
            <summary>反复外采的采购方（{{ item.repeatedBuyers.length }} 家）</summary>
            <p v-for="buyer in item.repeatedBuyers" :key="buyer.buyer">
              {{ buyer.buyer }} · 截至本年共 {{ buyer.orders }} 笔，涉及 {{ buyer.months }} 个月。本年原因：{{ reasonsText(buyer.reasons, buyer.missingReason) }}。
            </p>
          </details>
        </div>
      </article>
    </template>
  </section>
</template>

<style scoped>
.midstream-comparison { display: grid; min-width: 0; gap: 8px; }
.midstream-comparison :is(h3,h4,p) { margin: 0; }
.midstream-comparison h4 { font-size: 16px; }
.topic-table { width: 100%; border-collapse: collapse; font-size: 16px; font-variant-numeric: tabular-nums; }
.topic-table :is(th,td) { padding: 6px; border-bottom: 1px solid var(--industry-table-line); text-align: start; }
.topic-table thead { background: var(--industry-table-heading); }
.topic-table th, .topic-table .local-share { white-space: nowrap; }
.topic-table td:last-child { overflow-wrap: anywhere; }
.topic-table :is(th,td):nth-child(2) { text-align: end; }
.local-share { color: var(--v14-metric); font-weight: 700; }
.topic-reasons { display: grid; min-width: 0; gap: 6px; padding: 8px 10px; background: var(--v14-list); }
.topic-reasons header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 8px; }
.topic-reasons header span { color: var(--v14-muted); }
.external-category { padding-top: 5px; border-top: 1px solid var(--industry-table-line); overflow-wrap: anywhere; }
.purchase-evidence summary { cursor: pointer; color: var(--v14-metric); }
</style>
