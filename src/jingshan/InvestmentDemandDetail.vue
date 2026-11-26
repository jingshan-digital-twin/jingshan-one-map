<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { demandFacts, matchedEnterprises, type Demand } from './investment-demand'
import { stadiumStandardTitle, stadiumStandardUrl, venueStandardTitle, venueStandardUrl } from './venue-support-demand'
import { field } from './industry-panorama'
import { useServicePage } from './service-pagination'
import ServicePager from './ServicePager.vue'
import type { Dataset } from './types'

const props = defineProps<{
  lead: Demand
  data: Dataset[]
  region: string
  mode: 'live' | 'demo'
  reviewed: boolean
}>()
const emit = defineEmits<{review: []}>()
const enterpriseId = ref('')
const facts = computed(() => demandFacts(props.lead, props.data, props.region, props.mode))
const matches = computed(() => matchedEnterprises(props.lead, props.data))
const page = useServicePage(matches, [() => props.lead.id])
const business = computed(() => matches.value.find(f => f.id === enterpriseId.value))
const tags = computed(() => [...new Set([props.lead.group, props.lead.topic, props.lead.basis, props.lead.status].filter(Boolean))])
const businessFacts = computed(() => {
  const p = business.value?.properties
  return p ? [
    [props.lead.support?'机构名称':'企业名称', p.name],
    ['统一社会信用代码', field(p, ['creditCode'], '待补录')],
    ['经营范围', field(p, ['businessScopeExcerpt', 'mainBusiness'], '待补录')],
    ['联系电话', field(p, ['businessPhone', 'publicPhone', 'phone'], '待补录')],
    ['登记地址', field(p, ['registeredAddress', 'address'], '待补录')],
  ] : []
})
const targetConditions: Record<string, string> = {
  上游: '研发生产能力、供货渠道及建设用地条件',
  中游: '专业团队、场馆合作条件和运营计划',
  下游: '接待能力、服务半径及场馆合作条件',
}
watch(() => props.lead.id, () => { enterpriseId.value = '' })
</script>
<template>
  <header class="investment-detail-heading">
    <h3 :title="lead.name">{{ lead.name }}</h3>
    <button type="button" class="industry-button review-action" :disabled="reviewed" @click="emit('review')">{{ reviewed ? '研判已保存' : '保存研判' }}</button>
    <div class="detail-tags"><span v-for="tag in tags" :key="tag" class="industry-status" :data-tone="tag===lead.status?'amber':'blue'">{{ tag }}</span></div>
  </header>
  <slot />
  <section class="industry-card">
    <h4>{{ lead.category === 'chain' ? '产业链缺口分析' : lead.category === 'venue' ? '场馆缺口信息' : '配套缺口信息' }}</h4>
    <dl class="industry-kv">
      <div v-for="[label,value] in facts" :key="label"><dt :title="label">{{ label }}</dt><dd :title="value">{{ value }}</dd></div>
      <div v-if="lead.category === 'support'"><dt>招引方向</dt><dd :title="lead.direction">{{ lead.direction }}</dd></div>
      <div><dt>研判依据</dt><dd :title="lead.evidence">{{ lead.evidence }}</dd></div>
    </dl>
    <p v-if="lead.support" class="method-note">参照标准的停车及观众服务功能，按场馆周边 1 公里筛查每类已登记设施。已接入医疗机构和限上餐饮等台账，圈内零记录的类别列为核查线索。点位数量用于招商初筛，赛事容量需结合座席、泊位和场内保障台账核实。 <a :href="stadiumStandardUrl" target="_blank" rel="noopener noreferrer">{{ stadiumStandardTitle }} · 建标 201—2024</a> <a :href="venueStandardUrl" target="_blank" rel="noopener noreferrer">{{ venueStandardTitle }} · 第十三条、附录一</a></p>
  </section>
  <section v-if="lead.category === 'chain'" class="industry-card">
    <h4>招商目标</h4>
    <dl class="industry-kv">
      <div><dt>招引方向</dt><dd :title="lead.direction">{{ lead.direction }}</dd></div>
      <div><dt>落地条件</dt><dd :title="targetConditions[lead.group]">{{ targetConditions[lead.group] }}</dd></div>
    </dl>
  </section>
  <section class="industry-card">
    <h4>{{ lead.category === 'support' ? '可对接机构' : lead.category === 'venue' ? '推荐建设运营企业' : '推荐对接企业' }}</h4>
    <div v-if="matches.length" class="detail-table-wrap">
      <table class="industry-table enterprise-table">
        <thead><tr><th>{{lead.support?'机构名称':'企业名称'}}</th><th>所在区域</th><th>操作</th></tr></thead>
        <tbody><tr v-for="item in page.rows" :key="item.id" :class="{selected:item.id===enterpriseId}">
          <td :title="item.properties.name">{{ item.properties.name }}</td><td :title="item.properties.region">{{ item.properties.region }}</td>
          <td><button type="button" class="industry-row-action" :aria-expanded="item.id===enterpriseId" @click="enterpriseId=enterpriseId===item.id?'':item.id">{{ item.id===enterpriseId?'收起详情':'查看详情' }}</button></td>
        </tr></tbody>
      </table>
    </div>
    <p v-else class="industry-empty">当前台账暂无匹配主体</p>
    <ServicePager v-if="page.pageCount>1" :pagination="page" label="匹配企业分页"/>
    <dl v-if="business" class="industry-kv investment-business"><div v-for="[label,value] in businessFacts" :key="label"><dt :title="label">{{ label }}</dt><dd :title="value">{{ value }}</dd></div></dl>
  </section>
</template>
<style scoped>
.investment-detail-heading { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:6px 8px; }
.investment-detail-heading h3 { overflow:hidden; margin:0; font-size:20px; line-height:28px; text-overflow:ellipsis; white-space:nowrap; }
.review-action { min-height:32px; padding:3px 8px; white-space:nowrap; }
.detail-tags { display:flex; grid-column:1/-1; align-items:center; gap:5px; overflow-x:auto; }
.detail-tags .industry-status { flex:none; font-size:16px; padding:1px 6px; white-space:nowrap; }
.industry-card { min-width:0; padding:9px 10px; gap:6px; }
.industry-card h4 { margin:0; padding-inline-start:8px; border-inline-start:3px solid var(--v14-metric); font-size:18px; line-height:24px; }
.industry-card .industry-empty { margin:0; font-size:16px; line-height:24px; }
.industry-kv { margin:0; grid-template-columns:max-content minmax(0,1fr); }
.industry-kv dt,.industry-kv dd,.industry-table th,.industry-table td { min-width:0; padding:5px 8px; font-size:16px; line-height:24px; }
.industry-kv dt { max-width:15em; white-space:nowrap; }
.industry-kv dd { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.detail-table-wrap { min-width:0; max-width:100%; overflow-x:auto; }
.industry-table th,.industry-table td,.industry-row-action { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.investment-options { min-width:365px; font-variant-numeric:tabular-nums; }
.investment-options th:first-child { width:44%; }
.method-note { margin:8px 0 0; line-height:1.5; font-size:15px; color:var(--v14-muted); }
.method-note a { color:var(--v14-icon); text-decoration:underline; }

.enterprise-table { min-width:320px; }
.enterprise-table th:first-child { width:52%; }
.enterprise-table th:last-child { width:84px; }
</style>

