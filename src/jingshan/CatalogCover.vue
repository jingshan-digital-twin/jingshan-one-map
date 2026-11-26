<script setup lang="ts">
import { onMounted, ref, watch, toRaw } from 'vue'
import type { Geometry, Position } from 'geojson'
import type { CatalogAsset } from './portal-catalog'
import type { Dataset } from './types'
import { isCourtLedgerId } from './court-ledger'
import PortalIcon from './PortalIcon.vue'
const props = defineProps<{ asset: CatalogAsset; boundary?: Dataset }>()
const canvas = ref<HTMLCanvasElement>()
function paths(g: Geometry): Position[][] {
  switch (g.type) {
    case 'Point':
      return [[g.coordinates]]
    case 'MultiPoint':
      return g.coordinates.map((p) => [p])
    case 'LineString':
      return [g.coordinates]
    case 'MultiLineString':
    case 'Polygon':
      return g.coordinates
    case 'MultiPolygon':
      return g.coordinates.flat()
    default:
      return g.geometries.flatMap(paths)
  }
}
function draw() {
  const ctx = canvas.value?.getContext('2d')
  const data = toRaw(props.asset.dataset)
  if (!ctx || !data) return
  const w = 520,
    h = 208
  ctx.clearRect(0, 0, w, h)
  const boundary = toRaw(props.boundary)?.features ?? []
  const blocks = data.features.some((f) => f.properties.kind === 'population-raster-block')
  const courts = data.id === 'court_footprints' || isCourtLedgerId(data.id)
  const admin = data.id === 'administration'
  let items = data.features.filter((feature) => feature.geometry.type !== 'GeometryCollection')
  if (admin) {
    const subdivisions = items.filter(
      (feature) => !['city', 'city-boundary'].includes(feature.properties.kind),
    )
    if (subdivisions.length) items = subdivisions
  }
  if (courts && items.length) {
    const venues = new Map<string, typeof items>()
    for (const f of items) {
      const key = String(f.properties.facilityId ?? f.properties['所属场馆'] ?? '')
      if (!key) continue
      let group = venues.get(key)
      if (!group) {
        group = []
        venues.set(key, group)
      }
      group.push(f)
    }
    items = [...venues.values()].sort((a, b) => b.length - a.length)[0] ?? items
  }
  const frame = (blocks || !items.length) && boundary.length ? boundary : items
  let west = Infinity,
    east = -Infinity,
    south = Infinity,
    north = -Infinity
  for (const f of frame)
    for (const line of paths(f.geometry))
      for (const [x, y] of line) {
        west = Math.min(west, x)
        east = Math.max(east, x)
        south = Math.min(south, y)
        north = Math.max(north, y)
      }
  if (!Number.isFinite(west)) return
  const scale = Math.min(
    (w - 80) / Math.max(0.00045, (east - west) * 0.86),
    (h - 23) / Math.max(0.00045, north - south),
  )
  const x = (lon: number) => w / 2 + (lon - (west + east) / 2) * scale * 0.86
  const y = (lat: number) => h / 2 + ((south + north) / 2 - lat) * scale
  function render(list: typeof items, context = false) {
    if (!ctx) return
    const palette = admin
      ? ['#9683dc', '#b29fe9', '#8170c6', '#beadeb', '#a590db']
      : courts
        ? ['#389e87', '#56b198', '#68bea7']
        : ['#578ccc', '#739fd9', '#9681d4', '#447fba']
    for (const [i, f] of list.entries()) {
      const poly = f.geometry.type.includes('Polygon'),
        point = f.geometry.type.includes('Point')
      ctx.fillStyle = context ? 'rgba(181,175,212,.15)' : palette[i % palette.length]
      ctx.strokeStyle = context ? 'rgba(155,147,179,.36)' : poly ? '#fff' : '#477fae'
      ctx.lineWidth = context ? 0.85 : poly ? 1.4 : 1.1
      ctx.beginPath()
      for (const line of paths(f.geometry)) {
        line.forEach(([lon, lat], j) => {
          if (point) {
            ctx.moveTo(x(lon) + 2.6, y(lat))
            ctx.arc(x(lon), y(lat), 2.6, 0, Math.PI * 2)
          } else if (j) ctx.lineTo(x(lon), y(lat))
          else ctx.moveTo(x(lon), y(lat))
        })
        if (poly) ctx.closePath()
      }
      if (poly || point) ctx.fill('evenodd')
      ctx.stroke()
    }
  }
  if (!courts && !admin) render(boundary, true)
  if (!blocks) {
    render(items)
    return
  }
  const tile = document.createElement('canvas'),
    pen = tile.getContext('2d')
  if (!pen) return
  ctx.save()
  ctx.imageSmoothingEnabled = false
  for (const f of data.features) {
    const { width, height, runs } = f.properties
    if (
      typeof width !== 'number' ||
      typeof height !== 'number' ||
      !Array.isArray(runs) ||
      f.geometry.type !== 'Polygon'
    )
      continue
    tile.width = width
    tile.height = height
    const rgba = pen.createImageData(width, height)
    let offset = 0
    for (let r = 0; r < runs.length; r += 3) {
      const end = offset + Number(runs[r]),
        people = Number(runs[r + 1])
      if (people > 0) {
        const level = Math.min(1, Math.log1p(people) / 4.4)
        for (let n = offset; n < end; n++) {
          const k = n * 4
          rgba.data[k] = 213 - 72 * level
          rgba.data[k + 1] = 148 - 76 * level
          rgba.data[k + 2] = 94 + 38 * level
          rgba.data[k + 3] = 165 + 90 * level
        }
      }
      offset = end
    }
    pen.putImageData(rgba, 0, 0)
    const [nw, sw, , ne] = f.geometry.coordinates[0]
    ctx.setTransform(
      (x(ne[0]) - x(nw[0])) / width,
      (y(ne[1]) - y(nw[1])) / width,
      (x(sw[0]) - x(nw[0])) / height,
      (y(sw[1]) - y(nw[1])) / height,
      x(nw[0]),
      y(nw[1]),
    )
    ctx.drawImage(tile, 0, 0)
  }
  ctx.restore()
}
onMounted(draw)
watch(() => [props.asset.key, props.asset.dataset?.features, props.boundary], draw, { flush: 'post' })
</script>
<template>
  <div
    class="asset-cover"
    :class="[
      'cover-' + asset.style,
      { 'cover-courts': asset.id === 'court_footprints' || isCourtLedgerId(asset.id) },
    ]"
    aria-hidden="true"
  >
    <img
      v-if="asset.service?.mapUrl.includes('/local-tiles/central-white/') || asset.id === 'cim-02'"
      src="/jingshan/ui/platform-city-model.webp"
      class="city-model-cover"
      alt=""
    />
    <div v-else-if="asset.style === 'model'" class="model-print"><PortalIcon name="box" :size="64" /></div>
    <div v-else-if="asset.style === 'form'" class="sheet-print">
      <template v-if="asset.id === 'venue_operations'"
        ><strong>月份</strong><strong>预约笔数</strong><strong>使用率</strong
        ><template v-for="row in asset.dataset?.features.slice(0, 3)" :key="row.id"
          ><span>{{ row.properties.month }}</span
          ><span>{{ row.properties.bookings }}</span
          ><span>{{ row.properties.utilization }}%</span></template
        ></template
      ><i v-else v-for="n in 15" :key="n"></i>
    </div>
    <div v-else-if="asset.style === 'service'" class="service-print">
      <PortalIcon name="network" :size="49" />
    </div>
    <canvas v-else-if="asset.style !== 'image'" ref="canvas" width="520" height="208" />
    <span class="cover-format">{{ asset.format }}</span>
  </div>
</template>
