<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { chain, type ChainStage, type ChainTopic } from './chain-taxonomy'
import type { diagnoseStructure } from './industry-structure'
import type { IndustryLink } from './industry-links'
import type { diagnoseIndustryConversion } from './industry-conversion'

const props = defineProps<{
  structure: ReturnType<typeof diagnoseStructure>
  links: IndustryLink[]
  conversion: ReturnType<typeof diagnoseIndustryConversion> | null
  stage: ChainStage | null
  topic: ChainTopic | null
}>()
const emit = defineEmits<{ related: [topic: ChainTopic] }>()
const chosen = ref<ChainTopic>()
const review = computed(() => props.structure.topics.find(row => row.topic === chosen.value)
  ?? props.structure.priorities[0] ?? props.structure.topics[0])
watch(() => props.structure, () => { chosen.value = undefined })
const singleTopics = computed(() => props.structure.topics.filter(row => row.count === 1).map(row => row.topic))
const crossLinks = computed(() => props.links.filter(link => link.crossStage))
const linkStages = (link: IndustryLink) => chain.filter(item => link.parties.some(p => p.stages.includes(item.id)))
  .map(item => item.id).join('、')
const handoffs = computed(() => {
  if (props.topic) return []
  const pairs = [
    { from: '上游', to: '中游', check: '对照场馆采购订单和供应商交付记录，核实本地器材实际供货情况。' },
    { from: '中游', to: '下游', check: '对照赛事名单和酒店入住、商户核销记录，核实客流去向。' },
  ] as const
  return pairs.filter(pair => !props.stage || props.stage === pair.from || props.stage === pair.to).map(pair => {
    const evidence = props.links.filter(link => link.parties.some(first => first.stages.includes(pair.from) &&
      link.parties.some(second => second.key !== first.key && second.stages.includes(pair.to))))
    return { ...pair, kinds: [...new Set(evidence.map(link => link.kind))] }
  })
})
</script>

<template>
  <div class="assessment">
    <section class="assessment-section" aria-label="环节覆盖与结构">
      <h3>环节覆盖与结构</h3>
      <dl class="structure-metrics">
        <div><dt>收录企业</dt><dd><strong>{{ structure.enterpriseCount }}</strong> 家</dd></div>
        <div><dt>有企业的环节</dt><dd><strong>{{ structure.coveredCount }}</strong> / {{ structure.topicCount }}</dd></div>
        <div><dt>仅一家企业</dt><dd><strong>{{ structure.singleCount }}</strong> 个环节</dd></div>
      </dl>
      <p v-if="structure.stages.length > 1" class="stage-counts">
        <span v-for="item in structure.stages" :key="item.stage">{{ item.stage }} <b>{{ item.count }}</b> 家</span>
      </p>
      <p v-if="singleTopics.length && !topic">{{ singleTopics.join('、') }}各收录一家企业。</p>
      <p v-else-if="!structure.enterpriseCount">当前选区缺少已收录的企业，需补查本地经营主体。</p>
    </section>

    <section v-if="review" class="assessment-section" aria-label="环节核查">
      <h3>环节核查</h3>
      <label v-if="structure.topics.length > 1" class="topic-picker">核查环节
        <select :value="review.topic" @change="chosen = ($event.target as HTMLSelectElement).value as ChainTopic">
          <option v-for="item in structure.topics" :value="item.topic" :key="item.topic">{{ item.stage }} · {{ item.topic }}</option>
        </select>
      </label>
      <div class="review-box">
        <div class="review-title"><strong>{{ review.topic }}</strong><span class="review-status">{{ review.status }}</span></div>
        <p>{{ review.reason }}</p>
        <p><b>下一步</b>　{{ review.nextCheck }}</p>
        <button v-if="review.count" type="button" class="assessment-action" @click="emit('related',review.topic)">查看{{ review.topic }}企业（{{ review.count }}）</button>
      </div>
    </section>

    <section class="assessment-section" aria-label="上下游协作">
      <h3>上下游协作</h3>
      <template v-if="links.length">
        <p>已核对 <b>{{ links.length }}</b> 项具名合作或股权事项，其中 <b>{{ crossLinks.length }}</b> 项涉及不同产业阶段。</p>
      </template>
      <div v-for="pair in handoffs" :key="pair.from" class="handoff">
        <strong>{{ pair.from }} → {{ pair.to }}</strong>
        <span>{{ pair.kinds.length ? '已核实' + pair.kinds.join('、') : '合作凭证待补' }}</span>
        <p>{{ pair.check }}</p>
      </div>
      <template v-if="links.length">
        <details v-for="link in links" :key="link.key" class="evidence-item">
          <summary><strong>{{ linkStages(link) }} · {{ link.kind }}</strong><span>{{ link.product }}</span></summary>
          <p>{{ link.activity }}</p>
          <a :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.receipt }}</a>
          <time v-if="link.date" :datetime="link.date">{{ link.date }}</time>
        </details>
      </template>
      <p v-else-if="!handoffs.length">当前范围尚无能从双方企业档案交叉核对的合作凭证。可从对应的采购、工程或服务合同补查交易双方。</p>
    </section>

    <section v-if="conversion" class="assessment-section" aria-label="赛事消费承接">
      <h3>赛事消费承接</h3>
      <p>{{ conversion.summary }}</p>
      <details v-if="conversion.evidence.length" class="evidence-item">
        <summary>查看承接记录（{{ conversion.evidence.length }}）</summary>
        <div v-for="item in conversion.evidence" :key="item.title + item.url" class="conversion-record">
          <a v-if="item.url" :href="item.url" target="_blank" rel="noopener noreferrer">{{ item.title }}</a>
          <strong v-else>{{ item.title }}</strong>
          <p>{{ item.detail }}</p>
        </div>
      </details>
      <p><b>下一步</b>　{{ conversion.nextStep }}</p>
    </section>

  </div>
</template>

<style scoped>
.assessment { display: grid; gap: 14px; min-width: 0; color: var(--v14-ink); font: 400 15px/1.55 var(--v14-font); }
.assessment-section { display: grid; gap: 8px; min-width: 0; }
.assessment-section h3 {
  margin: 0; padding: 4px 8px; border-inline-start: 3px solid var(--v14-icon); background: var(--industry-table-heading);
  color: var(--v14-ink); font: 700 16px/24px var(--v14-font);
}
.assessment-section p, .assessment-section dl, .assessment-section dd { margin: 0; }
.structure-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
.structure-metrics > div { padding: 7px 3px; text-align: center; background: var(--v14-list); }
.structure-metrics dt, .structure-metrics dd { font-size: 14px; }
.structure-metrics strong { color: var(--v14-metric); font: 400 26px/32px "Cockpit Bebas",var(--v14-font); }
.stage-counts, .review-title, .topic-picker { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
.stage-counts { justify-content: space-between; font-size: 14px; }
.topic-picker { color: var(--v14-muted); font-size: 14px; }
.topic-picker select { min-width: 0; flex: 1; min-height: 32px; font: inherit; color: var(--v14-ink); }
.review-box { display: grid; gap: 6px; border: 1px solid var(--industry-table-line); background: var(--v14-list); padding: 8px 10px; }
.review-title { justify-content: space-between; }
.review-status { color: var(--v14-ink); font-size: 13px; border-bottom: 2px solid var(--v14-chart-track); }
.assessment-action { justify-self: start; text-align: start; border: 0; padding: 3px 0; background: transparent; cursor: pointer; }
.assessment-action, .evidence-item a { color: var(--v14-ink); font: 700 14px/22px var(--v14-font); text-decoration: underline; text-underline-offset: 3px; }
.evidence-item { min-width: 0; padding: 5px 8px; border-inline-start: 2px solid var(--v14-list-line); background: var(--v14-list); }
.evidence-item summary { cursor: pointer; overflow-wrap: anywhere; }
.evidence-item summary span { display: block; color: var(--v14-muted); font-size: 14px; }
.evidence-item[open] > :not(summary) { margin-block-start: 6px; }
.evidence-item time { display: block; color: var(--v14-muted); font-size: 13px; }
.handoff { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; padding: 4px 0; }
.handoff span { color: var(--v14-ink); text-align: end; }
.handoff p { grid-column: 1 / -1; }
</style>
