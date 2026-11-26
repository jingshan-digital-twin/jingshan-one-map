<script setup lang="ts">
import { computed } from 'vue'
import type { TrendDay } from './event-post-review.ts'

const props = defineProps<{ days: TrendDay[] }>()
defineEmits<{ detail: [] }>()
const series = [{ key: 'event', label: '赛事客流', color: '#58e7ed' }, { key: 'tourism', label: '文旅客流', color: '#ffbf58' }] as const
const chart = computed(() => {
  const max = Math.max(1, ...props.days.flatMap(d => [d.event ?? 0, d.tourism ?? 0]))
  const step = Math.max(1, 10 ** Math.floor(Math.log10(max)) / 5)
  const ceiling = Math.ceil(max / step) * step
  const dates = props.days.map(d => Date.parse(d.date)), first = dates[0], range = dates.at(-1)! - first
  const xs = dates.map(time => range > 0 ? 4 + (time - first) / range * 252 : 130)
  return { ceiling, xs, lines: series.map(s => {
    let join = false, path = ''
    const points = props.days.flatMap((day,i) => {
      const value = day[s.key]
      if (value === null) { join = false; return [] }
      const x = xs[i], y = 96 - value / ceiling * 92
      path += (join ? ' L' : ' M') + x + ' ' + y
      join = true
      return [{ x, y, value, date: day.date }]
    })
    return { ...s, path, points }
  }) }
})
</script>
<template>
  <section class="er-block er-trend" aria-label="客流变化趋势">
    <header><h3>客流变化趋势</h3><button type="button" :disabled="!days.length" @click="$emit('detail')">明细 ›</button></header>
    <div v-if="days.length" class="er-chart-body">
      <div class="er-series"><small>人次</small><span v-for="s in series" :key="s.key"><i :style="{background:s.color}"></i>{{ s.label }}</span></div>
      <div class="er-chart">
        <div class="er-axis-values" aria-hidden="true"><span>{{chart.ceiling}}</span><span>{{Math.round(chart.ceiling/2)}}</span><span>0</span></div>
        <svg viewBox="0 0 260 100" preserveAspectRatio="none" role="img" aria-label="赛事客流与文旅客流按日对比">
        <line v-for="y in [4,50,96]" :key="y" x1="4" x2="256" :y1="y" :y2="y"/>
        <g v-for="s in chart.lines" :key="s.key"><path :d="s.path" fill="none" :stroke="s.color" stroke-width="2.6" stroke-linejoin="round" />
          <circle v-for="p in s.points" :key="p.date" :cx="p.x" :cy="p.y" r="3" :fill="s.color"><title>{{ p.date }} · {{ s.label }} {{ p.value }} 人次</title></circle>
        </g>
      </svg>
        <div class="er-axis-dates"><span>{{ days[0].date.slice(5) }}</span><span v-if="days.length>1">{{ days[days.length-1].date.slice(5) }}</span></div>
      </div>
    </div>
    <p v-else class="er-empty">暂无逐日客流记录</p>
  </section>
</template>
