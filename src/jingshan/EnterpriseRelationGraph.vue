<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import { bundleOffsets, edgeCurve, graphBounds, layoutKnowledgeGraph, nodeLabel, nodeBounds, radius, shortName,
  type Bounds, type KnowledgeEdge, type KnowledgeNode, type PlacedNode, type Position } from './knowledge-graph-layout'

const props = defineProps<{
  nodes: readonly KnowledgeNode[]
  edges: readonly KnowledgeEdge[]
  selectedId: string | null
  selectedNodeId?: string | null
}>()
const emit = defineEmits<{ select: [id: string]; selectNode: [id: string] }>()
const svg = ref<SVGSVGElement>()
const size = ref({ width: 650, height: 430 })
const camera = ref({ x: 0, y: 0, scale: 1 })
const markerId = 'knowledge-arrow-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
const dragged = shallowRef(new Map<string, Position>())
const layout = computed(() => layoutKnowledgeGraph(props.nodes, props.edges, size.value.width / Math.max(1,size.value.height - 36)))
const nodes = computed(() => layout.value.placed.map(p => ({ ...p, ...dragged.value.get(p.id) })))
const byId = computed(() => new Map(nodes.value.map(node => [node.id, node])))
const bounds = computed(() => graphBounds(nodes.value, layout.value.bands))
const fitScale = computed(() => {
  const b = bounds.value
  return Math.max(.015, Math.min(1.35, (size.value.width - 24) / Math.max(1, b.right - b.left),
    (size.value.height - 50) / Math.max(1, b.bottom - b.top)))
})
function fit() {
  const b = bounds.value
  const scale = fitScale.value
  camera.value = { scale, x: size.value.width / 2 - (b.left+b.right)/2*scale,
    y: (size.value.height-36)/2 - (b.top+b.bottom)/2*scale }
}
function zoom(factor: number, anchor: Position = { x: size.value.width/2, y: (size.value.height-36)/2 }) {
  const old = camera.value
  const scale = Math.min(4, Math.max(fitScale.value * .6, old.scale * factor))
  camera.value = { scale, x: anchor.x - (anchor.x-old.x)*scale/old.scale, y: anchor.y - (anchor.y-old.y)*scale/old.scale }
}
function focusNode(id: string) {
  const node = byId.value.get(id)
  if (!node) return
  const scale = Math.max(camera.value.scale, 1)
  camera.value = { scale, x: size.value.width/2 - node.x * scale, y: (size.value.height-36)/2 - node.y * scale }
}
defineExpose({ fit, focusNode })
const signature = computed(() => JSON.stringify([props.nodes.map(n => [n.id,n.name,n.group,n.kind,!!n.center]),props.edges.map(e => [e.id,e.from,e.to])]))
watch(signature, () => { dragged.value = new Map(); fit() }, { flush: 'post' })
let localSelection: string | undefined
watch(() => props.selectedNodeId, id => {
  if (id && id !== localSelection) focusNode(id)
  localSelection = undefined
}, { flush: 'post' })
let resize: ResizeObserver | undefined
onMounted(() => {
  resize = new ResizeObserver(entries => {
    const { width,height } = entries[0].contentRect
    if (width <= 0 || height <= 0 || width === size.value.width && height === size.value.height) return
    size.value = { width, height }; fit()
  })
  if (svg.value) resize.observe(svg.value)
  fit()
})
onBeforeUnmount(() => resize?.disconnect())

const hover = ref<{ type: 'node' | 'edge'; id: string }>()
const activeEdge = computed(() => hover.value ? hover.value.type === 'edge' ? hover.value.id : null : props.selectedId)
const activeNode = computed(() => hover.value ? hover.value.type === 'node' ? hover.value.id : null : props.selectedNodeId)
const highlights = computed(() => {
  const nodeIds = new Set<string>(), edgeIds = new Set<string>()
  if (activeNode.value) nodeIds.add(activeNode.value)
  for (const e of props.edges) {
    if (e.id === activeEdge.value || e.from === activeNode.value || e.to === activeNode.value) {
      edgeIds.add(e.id); nodeIds.add(e.from); nodeIds.add(e.to)
    }
  }
  return { nodes: nodeIds, edges: edgeIds }
})
const geometry = computed(() => {
  const offsets = bundleOffsets(props.edges)
  return props.edges.flatMap(e => {
    const from = byId.value.get(e.from), to = byId.value.get(e.to)
    if (!from || !to || from.id === to.id) return []
    const curve = edgeCurve(from, to, offsets.get(e.id) ?? 0)
    return [{ ...e, curve, fromName: from.name, toName: to.name }]
  })
})
function overlap(a: Bounds,b: Bounds) {
  return Math.max(0, Math.min(a.right,b.right)-Math.max(a.left,b.left))
    * Math.max(0, Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))
}
const captions = computed(() => {
  const occupied = nodes.value.flatMap(node => {
    if (node.isolated) return [nodeBounds(node)]
    const r = radius(node) + 4
    const boxes: Bounds[] = [{ left:node.x-r, right:node.x+r, top:node.y-r, bottom:node.y+r }]
    nodeLabel(node).forEach((line,i) => {
      const half = [...line].reduce((n,c) => n + (/[\x00-\xff]/.test(c) ? 4.5 : 8), 0)
      const y = node.y + radius(node) + 21 + i*20
      boxes.push({ left:node.x-half, right:node.x+half, top:y-15, bottom:y+4 })
    })
    return boxes
  })
  // Reserve label space on the selected connections first. Every edge remains
  // interactive at overview scale, even when labels compete for the same space.
  const edges = [...geometry.value].sort((a,b) => Number(highlights.value.edges.has(b.id))-Number(highlights.value.edges.has(a.id))
    || Number(a.kind === 'spatial')-Number(b.kind === 'spatial'))
  return edges.map(edge => {
    const label = edge.label
    const width = 10 + [...label].reduce((n,char) => n + (/[\x00-\xff]/.test(char) ? 9 : 16), 0)
    let score = Infinity, pos = edge.curve.at(.51), onLine = pos, box: Bounds = { left: 0,top: 0,right: 0,bottom: 0 }
    for (const shift of [0, 10, -10, 18, -18]) {
      for (const t of [.5, .34, .67, .22, .79, .43, .58]) {
        const anchor = edge.curve.at(t), next = edge.curve.at(t+.01)
        const dx = next.x-anchor.x, dy = next.y-anchor.y, length = Math.hypot(dx,dy) || 1
        const candidate = { x: anchor.x - dy/length*shift, y: anchor.y + dx/length*shift }
        const rect = { left: candidate.x - width/2, top: candidate.y - 12, right: candidate.x + width/2, bottom: candidate.y + 12 }
        const cost = occupied.reduce((n,b) => n + overlap(rect,b), Math.abs(shift)*.2)
        if (cost < score) { score = cost; pos = candidate; onLine = anchor; box = rect }
        if (cost <= Math.abs(shift)*.2) break
      }
      if (score <= 4) break
    }
    const active = highlights.value.edges.has(edge.id)
    const show = active || camera.value.scale >= 1.35 ||
      (score < 46 && (camera.value.scale >= .54 || edge.kind === 'business' && camera.value.scale >= .37))
    if (show) occupied.push(box)
    return { edge, pos, onLine, width, show }
  })
})
function tone(node: KnowledgeNode) {
  if (node.kind === 'event') return 'event'
  if (node.kind === 'facility') return 'facility'
  if (node.group.includes('上游')) return 'up'
  if (node.group.includes('中游')) return 'mid'
  if (node.group.includes('下游')) return 'down'
  return 'external'
}
const legend = computed(() => {
  const colors = new Set(props.nodes.map(tone))
  const labels = { up:'上游', mid:'中游', down:'下游', external:'其他企业', facility:'场地', event:'事项' } as const
  return Object.entries(labels).filter(([color]) => colors.has(color as keyof typeof labels))
})
function isoName(node: KnowledgeNode) {
  const chars = Array.from(shortName(node))
  return chars.length > 10 ? chars.slice(0,9).join('') + '…' : chars.join('')
}
function choose(type:'node'|'edge',id:string) {
  if (type === 'node') { localSelection = id; emit('selectNode',id) }
  else { localSelection = undefined; emit('select',id) }
}
function localPoint(event: { clientX: number; clientY: number }): Position {
  const rect = svg.value!.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}
const pointers = new Map<number, Position>()
let gesture: { start: Position; last: Position; moved: boolean; target?: { type:'node'|'edge'; id:string } } | undefined
const moving = ref(false)
function targetOf(element: EventTarget | null) {
  const item = element instanceof Element ? element.closest('[data-node],[data-edge]') : null
  const node = item?.getAttribute('data-node'), edge = item?.getAttribute('data-edge')
  return node ? { type: 'node' as const, id: node } : edge ? { type: 'edge' as const, id: edge } : undefined
}
function start(event: PointerEvent) {
  if (event.button !== 0) return
  const p = localPoint(event)
  pointers.set(event.pointerId,p)
  svg.value?.setPointerCapture(event.pointerId)
  if (pointers.size === 1) gesture = { start:p,last:p,moved:false,target:targetOf(event.target) }
  else if (gesture) { gesture.moved = true; gesture.target = undefined; moving.value = true }
}
function move(event: PointerEvent) {
  if (!pointers.has(event.pointerId) || !gesture) return
  const prev = pointers.get(event.pointerId)!, p = localPoint(event)
  pointers.set(event.pointerId,p)
  if (pointers.size > 1) {
    const other = [...pointers].find(([id]) => id !== event.pointerId)![1]
    const oldDistance = Math.hypot(prev.x-other.x,prev.y-other.y)
    const newDistance = Math.hypot(p.x-other.x,p.y-other.y)
    if (oldDistance && newDistance) {
      zoom(newDistance/oldDistance,{x:(prev.x+other.x)/2,y:(prev.y+other.y)/2})
      camera.value.x += (p.x-prev.x)/2; camera.value.y += (p.y-prev.y)/2
    }
    return
  }
  if (!gesture.moved && Math.hypot(p.x-gesture.start.x,p.y-gesture.start.y)<4) return
  gesture.moved = true; moving.value = true; hover.value = undefined
  const dx = p.x-gesture.last.x, dy = p.y-gesture.last.y
  const node = gesture.target?.type === 'node' ? byId.value.get(gesture.target.id) : undefined
  if (node) {
    dragged.value = new Map(dragged.value).set(node.id,{x:node.x+dx/camera.value.scale,y:node.y+dy/camera.value.scale})
  } else { camera.value.x += dx; camera.value.y += dy }
  gesture.last = p
}
function end(event: PointerEvent) {
  if (!pointers.has(event.pointerId)) return
  pointers.delete(event.pointerId)
  if (svg.value?.hasPointerCapture(event.pointerId)) svg.value.releasePointerCapture(event.pointerId)
  if (pointers.size) {
    const p = [...pointers.values()][0]
    gesture = { start:p, last:p, moved:true }; return
  }
  if (event.type === 'pointerup' && gesture && !gesture.moved && gesture.target) choose(gesture.target.type,gesture.target.id)
  gesture = undefined; moving.value = false; hover.value = undefined
}
function wheel(event: WheelEvent) {
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.value.height : 1)
  zoom(Math.exp(-Math.max(-200,Math.min(200,delta))*.0025), localPoint(event))
}
function keydown(event: KeyboardEvent) {
  const target = targetOf(event.target)
  if ((event.key === 'Enter' || event.key === ' ') && target) { event.preventDefault(); choose(target.type,target.id); return }
  switch (event.key) {
    case '+': case '=': zoom(1.3); break
    case '-': zoom(1/1.3); break
    case '0': case 'Home': fit(); break
    case 'ArrowLeft': camera.value.x += 45; break
    case 'ArrowRight': camera.value.x -= 45; break
    case 'ArrowUp': camera.value.y += 45; break
    case 'ArrowDown': camera.value.y -= 45; break
    default: return
  }
  event.preventDefault()
}
function over(type:'node'|'edge',id:string,event: PointerEvent) {
  if (!moving.value && event.pointerType !== 'touch') hover.value = { type,id }
}
function focusItem(event: FocusEvent, pos: Position) {
  if (!(event.target instanceof Element) || !event.target.matches(':focus-visible')) return
  const { scale,x,y } = camera.value, px = x+pos.x*scale, py = y+pos.y*scale
  if (px < 25 || px > size.value.width-25 || py < 25 || py > size.value.height-45) {
    camera.value = { scale, x: size.value.width/2-pos.x*scale, y: (size.value.height-36)/2-pos.y*scale }
  }
}
</script>

<template>
  <div class="enterprise-graph" :class="{ moving }">
    <svg ref="svg" class="knowledge-viewport" tabindex="0" role="group" aria-label="企业关系图谱，方向键移动，加减号缩放，Home 键适配画布"
      @wheel.prevent="wheel" @keydown="keydown" @pointerdown="start" @pointermove="move" @pointerup="end" @pointercancel="end"
      @pointerleave="hover = undefined" @click="e => { const target = targetOf(e.target); if (e.detail === 0 && target) choose(target.type,target.id) }">
      <defs>
        <marker v-for="kind in ['business','spatial']" :id="markerId + kind" :key="kind" viewBox="0 0 8 8" markerWidth="7" markerHeight="7"
          markerUnits="userSpaceOnUse" refX="7" refY="4" orient="auto-start-reverse">
          <path d="M0.6 0.8 L7 4 L0.6 7.2" fill="none" :class="['arrowhead',kind]" stroke-width="1.5" />
        </marker>
      </defs>
      <g :transform="'translate('+camera.x+' '+camera.y+') scale('+camera.scale+')'">
        <g v-for="band in layout.bands" :key="band.title" class="isolate-band" aria-hidden="true">
          <rect :x="band.left" :y="band.top" :width="band.right-band.left" :height="band.bottom-band.top" rx="7" />
          <text :x="band.left+9" :y="band.top+17">{{ band.title }}</text>
        </g>
        <g v-for="edge in geometry" :key="edge.id" :data-edge="edge.id" class="graph-link" :class="[edge.kind,{ active:highlights.edges.has(edge.id) }]"
          tabindex="0" role="button" :aria-label="edge.fromName+'、'+edge.toName+'，'+edge.label" :aria-pressed="selectedId === edge.id"
          @pointerenter="over('edge',edge.id,$event)" @pointerleave="hover = undefined" @focus="focusItem($event, edge.curve.at(.5))">
          <title>{{ edge.fromName }} · {{ edge.label }} · {{ edge.toName }}</title>
          <path class="edge-hit" :d="edge.curve.path" />
          <path class="edge-stroke" :d="edge.curve.path"
            :marker-start="['in','both'].includes(edge.direction) ? 'url(#'+markerId+edge.kind+')' : undefined"
            :marker-end="['out','both'].includes(edge.direction) ? 'url(#'+markerId+edge.kind+')' : undefined" />
        </g>
        <g v-for="caption in captions" v-show="caption.show" :key="caption.edge.id" :data-edge="caption.edge.id" class="graph-caption"
          :class="[caption.edge.kind, { active:highlights.edges.has(caption.edge.id) }]" :transform="'translate('+caption.pos.x+' '+caption.pos.y+')'"
          aria-hidden="true" @pointerenter="over('edge',caption.edge.id,$event)" @pointerleave="hover = undefined">
          <line v-if="caption.onLine !== caption.pos" :x1="caption.onLine.x-caption.pos.x" :y1="caption.onLine.y-caption.pos.y" x2="0" y2="0" />
          <rect :x="-caption.width/2" y="-12" :width="caption.width" height="24" rx="5" />
          <text text-anchor="middle" y="6">{{ caption.edge.label }}</text>
        </g>
        <g v-for="node in nodes" :key="node.id" class="graph-node" :class="[tone(node), { hub:node.center, isolated:node.isolated, active:highlights.nodes.has(node.id), chosen:selectedNodeId === node.id }]"
          :transform="'translate('+node.x+' '+node.y+')'" :data-node="node.id" tabindex="0" role="button"
          :aria-pressed="selectedNodeId === node.id" :aria-label="node.group+'，'+node.name" @focus="focusItem($event,node)"
          @pointerenter="over('node',node.id,$event)" @pointerleave="hover = undefined">
          <title>{{ node.name }} · {{ node.group }}</title>
          <rect v-if="node.isolated && (node.center || node.id === selectedNodeId)" class="isolated-selection" x="-9" y="-10.5" width="140" height="21" rx="5" />
          <circle v-if="!node.isolated" :r="radius(node) + (node.center ? 6 : 3)" class="node-halo" />
          <circle :r="radius(node)" class="node-mark" />
          <g v-if="!node.isolated" class="node-icon" :transform="'scale('+(node.center ? 1.48 : .9)+')'" aria-hidden="true">
            <path v-if="node.kind==='facility'" d="M-4.5 -1.5a4.5 4.5 0 1 1 9 0C4.5 2 0 6.4 0 6.4S-4.5 2 -4.5 -1.5Z M-1.3 -1.5a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 0 0 -2.6 0Z"/>
            <path v-else-if="node.kind==='event'" d="M-3.8 6V-5.8 M-3.8 -4.7Q-1 -6.3 1 -4.9Q3.1 -3.8 5 -5V1.4Q3.2 2.4 1 1Q-1 -.4 -3.8 1Z"/>
            <path v-else d="M-5 5.6H5 M-3.7 5.4V-5.2H2.2V5.4 M2.3 -1.4H4.7V5.4 M-1.6 -3H.2 M-1.6 -.7H.2 M-1.6 1.6H.2"/>
          </g>
          <text v-if="node.isolated" class="node-text" x="12" y="4">{{ isoName(node) }}</text>
          <text v-else class="node-text" text-anchor="middle" :y="radius(node)+21">
            <tspan v-for="(line,i) in nodeLabel(node)" :key="i" x="0" :dy="i ? 20 : 0">{{ line }}</tspan>
          </text>
        </g>
      </g>
    </svg>
    <div v-if="legend.length" class="graph-key" aria-label="节点颜色">
      <span v-for="[color,label] in legend" :key="color" :class="color">{{ label }}</span>
    </div>
    <div class="graph-tools" role="group" aria-label="图谱视图">
      <button type="button" aria-label="缩小图谱" title="缩小" :disabled="camera.scale <= fitScale*.601" @click="zoom(1/1.35)">−</button>
      <button type="button" aria-label="放大图谱" title="放大" :disabled="camera.scale >= 3.99" @click="zoom(1.35)">+</button>
      <button type="button" class="fit" aria-label="适配画布" title="在画布内显示全部节点" @click="fit">适配</button>
    </div>
  </div>
</template>

<style scoped>
.enterprise-graph {
  --canvas: #102847; --dot: #41658366; --wire: #74a8e0; --space-wire: #61bca1; --caption: #dceaff; --band: #152f4c;
  --up: #63caba; --mid: #a999e9; --down: #edb46f; --place: #82b8d0; --event: #71a5f0; --outer: #acc0d4; --glyph: #112540;
  min-width: 0; position: relative; isolation: isolate; container-type: inline-size; border: 1px solid var(--v14-edge); border-radius: 6px; color: var(--v14-ink);
  background-color: var(--canvas); background-image: radial-gradient(var(--dot) .8px, transparent .8px); background-size: 15px 15px;
}
.cockpit-light .enterprise-graph {
  --canvas: #f2f8fe; --dot: #8aaac256; --wire: #7098bc; --space-wire: #42967d; --caption: #34546e; --band: #e8f1fa;
  --up: #167b72; --mid: #6954b2; --down: #a65815; --place: #41789a; --event: #326aad; --outer: #5b6f86; --glyph: #fff;
}
.knowledge-viewport { display: block; width: 100%; height: var(--knowledge-graph-height,clamp(340px,51dvh,570px)); touch-action: none; user-select: none; cursor: grab; border-radius: inherit; overflow: hidden; }
.moving .knowledge-viewport, .moving .knowledge-viewport * { cursor: grabbing; }
.knowledge-viewport:focus-visible { outline: 2px solid var(--v14-icon); outline-offset: -3px; }
.graph-tools { position: absolute; right: 7px; bottom: 6px; display: flex; background: var(--canvas); border: 1px solid var(--v14-edge); border-radius: 4px; }
.graph-tools button { font: 700 17px/24px var(--v14-font,sans-serif); width: 32px; height: 29px; min-height: 0; padding: 0; border: 0; color: var(--v14-ink); background: transparent; cursor: pointer; }
.graph-tools button + button { border-inline-start: 1px solid var(--v14-edge); }
.graph-tools .fit { width: 46px; font-size: 16px; }
.graph-tools button:hover, .graph-tools button:focus-visible { background: var(--industry-selected); }
.graph-tools button:disabled { opacity: .4; }
.graph-key { position: absolute; left: 7px; bottom: 7px; display: flex; flex-wrap: wrap; gap: 2px 8px; max-width: calc(100% - 130px); color: var(--caption); background: var(--canvas); font: 500 16px/20px var(--v14-font,sans-serif); }
.graph-key span { display: inline-flex; align-items: center; gap: 3px; }
.graph-key span::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--tint); }
.graph-key .up { --tint: var(--up); } .graph-key .mid { --tint: var(--mid); } .graph-key .down { --tint: var(--down); }
.graph-key .external { --tint: var(--outer); } .graph-key .facility { --tint: var(--place); } .graph-key .event { --tint: var(--event); }
@container (max-width: 350px) { .graph-key { gap: 2px 4px; } }
.graph-node { cursor: pointer; outline: none; }
.graph-node.up { --tint: var(--up); } .graph-node.mid { --tint: var(--mid); } .graph-node.down { --tint: var(--down); }
.graph-node.facility { --tint: var(--place); } .graph-node.event { --tint: var(--event); } .graph-node.external { --tint: var(--outer); }
.node-mark { fill: var(--tint); stroke: var(--canvas); stroke-width: 1.2px; }
.node-halo { fill: color-mix(in srgb,var(--tint) 15%,var(--canvas)); stroke: color-mix(in srgb,var(--tint) 42%,var(--canvas)); stroke-width: 1px; }
.hub .node-halo, .graph-node.active .node-halo, .graph-node:focus-visible .node-halo { stroke: var(--tint); stroke-width: 2px; }
.graph-node.chosen .node-mark, .isolated.active .node-mark { stroke: var(--v14-ink); stroke-width: 1.8px; }
.isolated-selection { fill: color-mix(in srgb,var(--tint) 10%,var(--canvas)); stroke: var(--tint); stroke-width: 1px; }
.node-icon { fill: none; stroke: var(--glyph); stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.node-text { fill: var(--v14-ink); font: 600 16px var(--v14-font,sans-serif); paint-order: stroke; stroke: var(--canvas); stroke-width: 3px; stroke-linejoin: round; }
.hub .node-text, .chosen .node-text { font-weight: 700; }
.isolated .node-text { font-size: 11.5px; }
.isolate-band rect { fill: var(--band); fill-opacity: .65; stroke: var(--dot); stroke-dasharray: 3 4; }
.isolate-band text { fill: var(--caption); font: 600 11px var(--v14-font,sans-serif); }
.graph-link, .graph-caption { cursor: pointer; outline: none; }
.business { --line: var(--wire); } .spatial { --line: var(--space-wire); }
.arrowhead { stroke: var(--line); }
.edge-hit { fill: none; stroke: transparent; stroke-width: 10px; }
.edge-stroke { fill: none; stroke: var(--line); stroke-width: 1.4px; pointer-events: none; }
.spatial .edge-stroke { stroke-dasharray: 4 4; }
.graph-link.active .edge-stroke, .graph-link:focus-visible .edge-stroke { stroke-width: 2.7px; }
.graph-caption rect { fill: var(--canvas); fill-opacity: .94; }
.graph-caption line { stroke: var(--line); stroke-width: .8px; }
.graph-caption.active rect { stroke: var(--line); }
.graph-caption text { fill: var(--caption); font: 500 16px var(--v14-font,sans-serif); }
.graph-caption.active text { fill: var(--v14-ink); font-weight: 700; }
@media (max-width: 600px) { .graph-tools button { width: 36px; height: 33px; } }
</style>
