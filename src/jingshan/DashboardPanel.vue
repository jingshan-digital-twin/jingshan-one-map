<script lang="ts">
export type Metric = {label:string; value:string|number; unit?:string}
export type Entry = {label:string; value?:string|number; detail?:string; tone?:'green'|'red'|'amber'|'cyan'; bar?:number; action?:()=>void; button?:string; selected?:boolean}
export type Section = {title:string; note?:string; rows:Entry[]; empty?:string; style?:'card'|'bar'|'funnel'}
</script>

<script setup lang="ts">
import DashboardPanelFrame from './DashboardPanelFrame.vue'
defineProps<{ title:string; source?:string; main?:Metric; metrics?:Metric[]; sections:Section[]; side:'left'|'right'; variant?:'industry' }>()
</script>

<template>
  <DashboardPanelFrame :title="title" :source="source" :side="side" :variant="variant">
      <slot name="before"></slot>
      <div v-if="main" class="big-stat"><span>{{ main.label }}</span><strong>{{ main.value }} <small>{{ main.unit }}</small></strong></div>
      <div v-if="metrics?.length" class="metrics">
        <div v-for="metric in metrics" :key="metric.label" class="metric">
          <span>{{ metric.label }}</span><strong>{{ metric.value }}<small v-if="metric.unit">{{ metric.unit }}</small></strong>
        </div>
      </div>
      <slot name="middle"></slot>
      <section v-for="section in sections" :key="section.title" class="panel-section" :class="section.style ? 'section-' + section.style : ''">
        <h3><span>{{ section.title }}</span><small v-if="section.note">{{ section.note }}</small></h3>
        <slot name="section-tools" :section="section"></slot>
        <div v-if="!section.rows.length" class="empty">{{ section.empty || '当前范围暂无数据' }}</div>
        <div v-for="(item,index) in section.rows" :key="item.label + index" class="entry" :class="{selected:item.selected}">
          <div class="entry-head">
            <strong :title="item.label">{{ item.label }}</strong>
            <span v-if="item.bar !== undefined" class="meter" aria-hidden="true"><i :style="{width: Math.max(0,Math.min(100,item.bar)) + '%'}"></i></span>
            <span v-if="item.value !== undefined" class="entry-value" :class="item.tone">{{ item.value }}</span>
            <button v-if="item.action" class="mini" type="button" @click="item.action">{{ item.button || '查看' }} ›</button>
          </div>
          <p v-if="item.detail" :title="item.detail">{{ item.detail }}</p>
        </div>
        <slot name="section-after" :section="section"></slot>
      </section>
      <slot name="after"></slot>
    <template v-if="$slots.actions" #actions><slot name="actions"/></template>
  </DashboardPanelFrame>
</template>
