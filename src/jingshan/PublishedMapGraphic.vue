<script setup lang="ts">
import { onMounted, ref, toRaw, watch } from 'vue'
import type { Dataset } from './types'
const props = defineProps<{ boundary?: Dataset }>()
const canvas = ref<HTMLCanvasElement>()
function draw() {
  const ctx = canvas.value?.getContext('2d')
  if (!ctx) return
  const features = toRaw(props.boundary)?.features ?? []
  const polygons = features.filter((feature) => ['Polygon', 'MultiPolygon'].includes(feature.geometry.type))
  const towns = polygons.filter((feature) => !['city', 'city-boundary'].includes(feature.properties.kind))
  const shapes = (towns.length ? towns : polygons).flatMap(({ geometry }) =>
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [],
  )
  ctx.clearRect(0, 0, 200, 170)
  if (!shapes.length) return
  let west = Infinity,
    east = -Infinity,
    south = Infinity,
    north = -Infinity
  for (const polygon of shapes)
    for (const [x, y] of polygon[0]) {
      west = Math.min(west, x)
      east = Math.max(east, x)
      south = Math.min(south, y)
      north = Math.max(north, y)
    }
  const scale = Math.min(172 / ((east - west) * 0.86 || 1), 146 / (north - south || 1))
  const colors = ['#baa4fb', '#a389ed', '#d6c7ff', '#b39af3', '#c7b4ff']
  shapes.forEach((polygon, i) => {
    ctx.beginPath()
    for (const ring of polygon) {
      ring.forEach(([x, y], j) => {
        const px = 100 + (x - (east + west) / 2) * 0.86 * scale,
          py = 85 + ((north + south) / 2 - y) * scale
        if (j) ctx.lineTo(px, py)
        else ctx.moveTo(px, py)
      })
      ctx.closePath()
    }
    ctx.fillStyle = colors[i % colors.length]
    ctx.fill('evenodd')
    ctx.strokeStyle = '#f8f3ff'
    ctx.lineWidth = 1.25
    ctx.stroke()
  })
}
onMounted(draw)
watch(() => props.boundary?.features, draw, { flush: 'post' })
</script>
<template>
  <div class="release-art" aria-hidden="true">
    <div class="release-art-shadow"></div>
    <div class="release-sheet sheet-bottom"></div>
    <div class="release-sheet sheet-middle"></div>
    <div class="release-sheet sheet-map"><canvas ref="canvas" width="200" height="170"></canvas></div>
    <i class="release-pin-shadow"></i><i class="release-map-pin"></i>
  </div>
</template>
