<script setup lang="ts">
import { computed } from 'vue'
import type { Metric, Section } from './DashboardPanel.vue'

type LayerControl = { label:string; enabled:boolean; setEnabled:(enabled:boolean) => void }
const props = defineProps<{
  side:'left'|'right'
  main?:Metric
  additionalSupply?:Metric
  metrics:Metric[]
  sections:Section[]
  layerControls?:LayerControl[]
}>()
const cards = computed(() => (props.side === 'left' ? [
  { title:'网球场地', metrics:[...(props.main ? [props.main] : []),...props.metrics.slice(0,3),...(props.additionalSupply ? [props.additionalSupply] : [])] },
  { title:'网球产业', metrics:props.metrics.slice(3) },
  { title:'系统发现', sections:props.sections },
] : [
  { title:'近期赛事', sections:props.sections.slice(0,1) },
  { title:'运行态势', metrics:props.metrics, sections:props.sections.slice(1,2) },
  { title:'场地利用率', sections:props.sections.slice(2) },
]).map((card, index) => ({...card,layerControl:props.layerControls?.[index]})))

function metricIcon(label:string) {
  if (/场地|覆盖|订场|自营/.test(label)) return 'court'
  if (/俱乐部|机构|参赛|到访/.test(label)) return 'people'
  if (/办赛|赛事/.test(label)) return 'calendar'
  return 'industry'
}
</script>

<template>
  <aside class="overview-rail" :class="side + '-panel'" :aria-label="side === 'left' ? '网球产业概况' : '运行态势'">
    <section v-for="(card, index) in cards" :key="card.title" class="overview-module" :class="'overview-module-' + (index + 1)">
      <header class="panel-header">
        <span class="chevrons" aria-hidden="true"></span><h2>{{ card.title }}</h2>
        <label v-if="card.layerControl" class="toggle-line overview-layer-toggle" :title="card.layerControl.label">
          数据上图
          <input type="checkbox" role="switch" :aria-label="card.title + '数据上图'" :checked="card.layerControl.enabled"
            @change="card.layerControl.setEnabled(($event.target as HTMLInputElement).checked)" />
          <span class="switch-ui" aria-hidden="true"></span>
        </label>
        <small v-else-if="card.sections?.[0]?.note">{{ card.sections[0].note }}</small>
      </header>
      <div class="overview-module-body">
        <div v-if="card.metrics?.length" class="overview-metrics" :class="{'overview-metrics-tight':props.side === 'left' && index === 1}">
          <div v-for="item in card.metrics" :key="item.label" class="overview-metric">
            <img v-if="metricIcon(item.label) === 'industry'" class="overview-pictogram native-pictogram"
              src="/jingshan/ui/light-metric-industry.png" alt="" />
            <span v-else class="overview-pictogram" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">
                <g v-if="metricIcon(item.label) === 'court'"><path d="m5 7 20-2 3 20-22 2L5 7Z"/><path d="m6 17 20-2M12 11l9-1 1 10-10 1-1-10Zm3-1 1 11"/><circle cx="9" cy="25" r="1"/></g>
                <g v-else-if="metricIcon(item.label) === 'people'"><circle cx="15" cy="10" r="4"/><path d="M7 26v-5a8 8 0 0 1 16 0v5M23 8a3 3 0 1 1 0 6m2 3c3 1 4 4 4 8"/></g>
                <g v-else><path d="M5 8h22v18H5zM5 13h22M10 5v5m12-5v5"/><path d="m12 20 3 3 5-6"/></g>
              </svg>
            </span>
            <span><span class="overview-metric-label">{{ item.label }}</span><strong>{{ item.value }} <small>{{ item.unit }}</small></strong></span>
          </div>
        </div>
        <section v-for="section in card.sections" :key="section.title" class="overview-rows" :aria-label="section.title">
          <p v-if="!section.rows.length" class="empty">{{ section.empty ?? '当前范围暂无数据' }}</p>
          <div v-for="(row, rowIndex) in section.rows" :key="row.label + rowIndex" class="overview-row">
            <span v-if="section.style !== 'bar'" class="overview-row-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linejoin="round" stroke-linecap="round">
                <path v-if="row.tone === 'red'" d="M12 3 2 20h20L12 3Zm0 6v5m0 3v.2"/>
                <path v-else-if="section.title === '近期赛事'" d="M4 6h16v14H4zM4 10h16M8 4v5m8-5v5m-7 6h5"/>
                <path v-else d="M4 6h16v12H4zM8 10h8m-8 4h5"/>
              </svg>
            </span>
            <div class="overview-row-content">
              <div class="overview-row-title">
                <strong :title="row.label">{{ row.label }}</strong>
                <span v-if="row.bar !== undefined" class="meter" aria-hidden="true"><i :style="{width:Math.min(100,Math.max(0,row.bar)) + '%'}"></i></span>
                <span v-if="row.value !== undefined" class="overview-row-value" :class="row.tone">{{ row.value }}</span>
                <button v-if="row.action" type="button" class="mini" @click="row.action">{{ row.button || '查看' }} ›</button>
              </div>
              <p v-if="row.detail">{{ row.detail }}</p>
            </div>
          </div>
        </section>
      </div>
      <footer v-if="index === cards.length - 1 && $slots.actions" class="panel-actions"><slot name="actions" /></footer>
    </section>
  </aside>
</template>
