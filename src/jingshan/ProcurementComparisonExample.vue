<script setup lang="ts">
import { computed } from 'vue'
import type { ChainTopic } from './chain-taxonomy'

const props = defineProps<{ topics: readonly ChainTopic[] }>()

// Amounts are illustrative annual totals in 万元.
const examples = [
  { topic: '场馆运营', local: 60, total: 80, category: '场地照明驱动配件', orders: 3, months: '3、6、9 月', reason: '现有灯具需匹配特定型号，本地经销商当期无现货。' },
  { topic: '俱乐部运营', local: 18, total: 30, category: '定制队服', orders: 2, months: '4、8 月', reason: '每批只需补订少量尺码，本地报价要求的起订量高于实际需求。' },
  { topic: '培训陪练', local: 14, total: 25, category: '发球机维修服务', orders: 2, months: '2、7 月', reason: '设备仍在保修期内，维修须由外地的品牌授权服务点承接。' },
  { topic: '赛事组织', local: 32, total: 80, category: '比赛直播制作', orders: 3, months: '5、8、10 月', reason: '转播需要多机位同步和即时回放，本地团队在比赛日无法同时配齐设备。' },
] as const

const visible = computed(() => examples.filter(item => props.topics.includes(item.topic)))
const percentage = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 })
</script>

<template>
  <details v-if="visible.length" class="procurement-example">
    <summary>查看采购示例</summary>
    <div class="example-content">
      <p class="example-note"><strong>虚构示例</strong> · 以下金额、订单和原因仅用于说明计算方式。</p>
      <article v-for="row in visible" :key="row.topic" class="example-topic">
        <header><strong>{{ row.topic }}</strong><span>本地采购占比 <b>{{ percentage.format(row.local / row.total) }}</b></span></header>
        <p>本地采购 {{ row.local }} 万元，全年采购 {{ row.total }} 万元。</p>
        <p><strong>反复外采</strong>　{{ row.category }}。同一采购方在 {{ row.months }}分别下单，共 {{ row.orders }} 笔。</p>
        <p><strong>原因</strong>　{{ row.reason }}</p>
      </article>
    </div>
  </details>
</template>

<style scoped>
.procurement-example { min-width: 0; font-size: 16px; }
.procurement-example summary { width: fit-content; cursor: pointer; font-weight: 700; color: var(--v14-metric); }
.example-content, .example-topic { display: grid; min-width: 0; gap: 4px; }
.example-content { gap: 8px; margin-top: 6px; }
.example-note { color: var(--v14-muted); }
.example-content p { margin: 0; overflow-wrap: anywhere; }
.example-topic { padding: 8px 10px; background: var(--v14-list); border-inline-start: 2px solid var(--industry-table-line); }
.example-topic header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 8px; }
.example-topic header span { white-space: nowrap; }
.example-topic b { color: var(--v14-metric); font-variant-numeric: tabular-nums; }
</style>
