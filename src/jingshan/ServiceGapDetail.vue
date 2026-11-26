<script setup lang="ts">
import {computed} from 'vue'
import type {ServiceGap,GapCandidate} from './service-gaps'
import {gapLabels,periods} from './service-gaps'
import ServicePager from './ServicePager.vue'
import {useServicePage} from './service-pagination'
const props=defineProps<{gap:ServiceGap;radius:number;peoplePerCourt:number}>()
defineEmits<{assign:[candidate:GapCandidate]}>()
const list=useServicePage(computed(()=>props.gap.candidates),[()=>props.gap.source.id,()=>props.gap.source.period])
const count=(n:number)=>n.toLocaleString('zh-CN')
</script>
<template>
  <div class="service-identity"><h3>{{ gap.source.name }}</h3><div class="svc-tag-line"><span v-for="kind in gap.source.kinds" :key="kind" class="svc-tag" :data-type="'补'+gapLabels[kind]">{{ gapLabels[kind] }}缺口</span></div><span>{{ gap.cell.feature.properties.region }} · {{ count(gap.cell.population) }} 人{{ gap.cell.feature.properties.sample ? ' · 演示人口网格' : '' }}</span></div>
  <dl class="industry-kv">
    <div><dt>覆盖</dt><dd>{{ gap.cell.outsidePopulation ? count(gap.cell.outsidePopulation)+' 人在服务圈外' : '有开放场馆可达' }}。以网格中心到场馆的直线距离、{{ count(radius) }} 米服务半径估算。</dd></div>
    <div><dt>容量</dt><dd>{{ gap.cell.capacityShortfallPopulation ? '圈内估算有 '+count(gap.cell.capacityShortfallPopulation)+' 人超出服务容量' : gap.cell.outsidePopulation ? '圈内无开放供给' : '圈内规划容量可覆盖' }}。按每片服务 {{ count(peoplePerCourt) }} 人测算。</dd></div>
    <div><dt>时段</dt><dd>{{ periods[gap.source.period].label }} · {{ gap.openVenues===0 ? '无可达开放场馆可比较' : gap.hoursGap ? '圈内场馆登记的开放时间均与该时段错开' : !gap.pressure.sufficient ? '逐时预约记录不足，待核实' : gap.pressure.high>=3 ? '持续预约紧张' : '已报时段未达到持续紧张条件' }}<template v-if="gap.pressure.days">。可比较 {{ gap.pressure.days }} 天，其中 {{ gap.pressure.high }} 天预约率达到 90%</template>。</dd></div>
  </dl>
  <p>覆盖和容量按当前开放台账估算。时段缺口有两种依据：登记时间均错开，或近 28 个完整日内至少 3 天的同类时段预约率达到 90%。仅比较各可服务场馆均有三个小时记录的日期。</p>
  <h3 class="service-section-title">可协调场馆 <span>{{ gap.candidates.length }} 处</span></h3>
  <ul class="industry-list" v-if="list.total"><li v-for="c in list.rows" :key="c.venue.id" class="industry-card">
    <div class="service-line"><strong>{{ c.venue.name }}</strong><span>{{ Math.round(c.distance) }} 米</span></div>
    <p>{{ c.reason }}</p><div class="service-line"><span>建议承办 · {{ c.department }}</span><button type="button" class="industry-button primary" @click="$emit('assign',c)">{{ c.action }}</button></div>
  </li></ul>
  <p v-else class="industry-card">服务半径内暂无符合所选时段条件的存量场馆。可核查开放台账、照明条件或评估新增场地。</p>
  <ServicePager v-if="list.pageCount>1" :pagination="list" label="候选场馆分页" unit="处"/>
</template>

