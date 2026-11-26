<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { chain, type ChainStage, type ChainTopic } from './chain-taxonomy'

const props = defineProps<{ weakTopics: ReadonlySet<ChainTopic>; stage: ChainStage | null; topic: ChainTopic | null }>()
const emit = defineEmits<{ select: [stage: ChainStage | null, topic?: ChainTopic | null]; 'return-map': [] }>()
const heading = ref<HTMLElement>()
const plane = ref<SVGSVGElement>()
const searchInput = ref<HTMLInputElement>()
const query = ref('')
const term = computed(() => query.value.trim())
const matches = (stage: ChainStage, topic: ChainTopic) => stage.includes(term.value) || topic.includes(term.value)
const results = computed(() => chain.flatMap(stage => stage.topics.filter(topic => matches(stage.id, topic))
  .map(topic => ({ stage: stage.id, topic }))))
function clearSearch() {
  query.value = ''
  searchInput.value?.focus()
}
function selectResult() {
  if (!term.value) return
  const stage = chain.find(group => group.id === term.value)
  if (stage) emit('select', stage.id)
  else if (results.value.length === 1) emit('select', results.value[0].stage, results.value[0].topic)
}

// Node centres are shared by the buttons and the connectors.
const rows: Record<ChainStage, readonly number[]> = {
  上游: [9, 37, 67], 中游: [9, 32, 55, 78], 下游: [9, 29.5, 50, 70.5, 91],
}
const size = ref({ width: 0, height: 0 })
let observer: ResizeObserver | undefined
function measure() {
  if (!plane.value) return
  const { width, height } = plane.value.getBoundingClientRect()
  if (width !== size.value.width || height !== size.value.height) size.value = { width, height }
}
onMounted(() => {
  heading.value?.focus({ preventScroll: true })
  if (window.matchMedia('(max-width: 960px) and (pointer: coarse)').matches)
    heading.value?.closest('section')?.scrollIntoView({ block: 'start' })
  if (plane.value) {
    measure()
    observer = new ResizeObserver(measure)
    observer.observe(plane.value)
  }
})
onBeforeUnmount(() => observer?.disconnect())

const nodeWidth = computed(() => Math.min(240, Math.max(94, size.value.width / 3 * 0.64)))
const connections = computed(() => {
  const { width, height } = size.value
  if (!width || !height) return []
  const column = width / 3
  return chain.slice(0, -1).map((left, index) => {
    const right = chain[index + 1]
    const start = (index + 0.5) * column + nodeWidth.value / 2
    const end = (index + 1.5) * column - nodeWidth.value / 2
    const gap = end - start
    const stem = start + gap / 2
    const radius = Math.min(22, gap * 0.2, height * 0.035)
    const arrow = Math.min(12, gap * 0.17)
    const joint = height / 2
    const branches = (incoming: boolean) => {
      const group = incoming ? right : left
      return group.topics.map((topic, row) => {
        const y = height * rows[group.id][row] / 100
        const bend = Math.sign(joint - y) * Math.min(radius, Math.abs(joint - y))
        const path = incoming
          ? `M ${stem} ${y + bend} Q ${stem} ${y} ${stem + radius} ${y} H ${end - arrow + 1}`
          : `M ${start} ${y} H ${stem - radius} Q ${stem} ${y} ${stem} ${y + bend}`
        return { topic, path, jointY: y + bend,
          tip: incoming ? `M ${end} ${y} l ${-arrow} ${-arrow * 0.44} v ${arrow * 0.88} Z` : '' }
      })
    }
    const arms = [...branches(false), ...branches(true)]
    const joins = arms.map(arm => arm.jointY)
    return { stage: left.id, spine: `M ${stem} ${Math.min(...joins)} V ${Math.max(...joins)}`, arms }
  })
})
</script>

<template>
  <section class="recruit-map industry-rail" aria-label="产业链招商图谱">
    <header class="v14-overview-heading recruit-heading">
      <h2 ref="heading" tabindex="-1">产业链招商图谱</h2>
      <label class="map-search">
        <input ref="searchInput" v-model="query" type="search" aria-label="搜索产业链环节" placeholder="搜索环节"
          @keydown.enter="selectResult" />
      </label>
      <button type="button" class="industry-button back-to-map" @click="emit('return-map')">返回地图</button>
    </header>
    <div class="map-body">
      <p v-if="term" role="status" class="search-count">
        {{ results.length ? '找到 ' + results.length + ' 个环节' : '没有匹配的环节' }}
        <button class="clear-search" type="button" @click="clearSearch">清除搜索</button>
      </p>
      <div class="map-board" :style="{ '--node-width': nodeWidth + 'px' }">
        <svg ref="plane" class="stage-buses" aria-hidden="true" focusable="false">
          <g v-for="link in connections" :key="link.stage">
            <path class="flow-stroke" :d="link.spine" />
            <g v-for="arm in link.arms" :key="arm.topic" :class="{ 'weak-arm': weakTopics.has(arm.topic) }">
              <path class="flow-stroke" :d="arm.path" />
              <path v-if="arm.tip" class="arrow-tip" :d="arm.tip" />
            </g>
          </g>
        </svg>
        <section v-for="(group, index) in chain" :key="group.id" class="stage-column" :aria-label="group.id + group.title">
          <h3 class="map-stage" :class="{ onward: index < chain.length - 1 }">
            <button type="button" :aria-pressed="stage === group.id && !topic" :title="group.title"
              @click="emit('select', group.id)">{{ group.id }}</button>
          </h3>
          <ul class="stage-nodes">
            <li v-for="(name, row) in group.topics" :key="name" :style="{ top: rows[group.id][row] + '%' }">
              <button type="button" class="map-node" :data-status="weakTopics.has(name) ? 'weak' : undefined"
                :class="{ subdued: term && !matches(group.id, name) }" :aria-pressed="topic === name"
                :aria-label="weakTopics.has(name) ? name + '，弱链' : name" @click="emit('select', group.id, name)">
                <strong>{{ name }}</strong><span v-if="weakTopics.has(name)" class="node-status">弱链</span>
              </button>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.jt-body > .recruit-map {
  --flow: #64ebff; --flow-glow: rgb(28 209 255 / .68); --node-edge: #50d9f3; --node-fill: #145073;
  --weak: var(--panorama-weak, #ff945c); --weak-glow: rgb(255 109 52 / .7); --weak-fill: #653d3a; --tag-ink: #341400;
  grid-area: map; position: relative; z-index: 1; align-self: stretch; container-type: inline-size;
  display: flex; flex-direction: column; gap: 0; padding: 0; margin: 0; box-sizing: border-box;
  min-width: 0; min-height: 0; width: 100%; max-block-size: none; border: 1px solid var(--v14-edge);
  background: var(--v14-list), var(--panorama-map-field); color: var(--v14-ink); font: 400 16px/24px var(--v14-font);
}
.cockpit-light .jt-body > .recruit-map {
  --flow: #167ea3; --flow-glow: rgb(0 169 213 / .48); --node-edge: #218bad; --node-fill: #dcf3ff;
  --weak-glow: rgb(242 123 43 / .45); --weak-fill: #ffead7; --tag-ink: white;
}
.recruit-map .recruit-heading { display: flex; align-items: center; flex-shrink: 0; gap: 8px; padding: 6px 12px; }
.recruit-map .recruit-heading h2 { min-width: max-content; margin: 0; font: 700 20px/28px var(--v14-font); }
.recruit-map .back-to-map { flex: none; margin: 0; min-height: 34px; padding: 3px 8px; white-space: nowrap; font-size: 16px; }
.map-search { position: relative; min-width: 0; margin-inline-start: auto; width: min(42%, 230px); }
.map-search::before {
  content: ''; position: absolute; inset-inline-start: 8px; top: 50%; transform: translateY(-50%); width: 18px; height: 18px;
  pointer-events: none; background: var(--v14-icon); mask: url('/jingshan/ui/panorama-v14/search.svg') center / contain no-repeat;
}
.recruit-map .map-search input { width: 100%; min-height: 34px; padding: 4px 8px 4px 32px; box-sizing: border-box; font: inherit; }
.map-body { display: flex; flex: 1; flex-direction: column; min-height: 0; padding: 8px 4px 10px; overflow: auto; }
.search-count { margin: 0; padding: 0 8px 4px; color: var(--v14-muted); }
.clear-search { margin-inline-start: 8px; border: 0; background: none; padding: 0; color: var(--v14-ink); text-decoration: underline; font: inherit; }
.map-board {
  --stage-heading: 48px;
  flex: 1 0 auto; position: relative; min-width: 324px; min-height: 380px;
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
}
.stage-buses { position: absolute; inset: var(--stage-heading) 0 0; width: 100%; height: calc(100% - var(--stage-heading)); pointer-events: none; }
.stage-buses { color: var(--flow); }
.stage-buses > g > :is(path, g) { filter: drop-shadow(0 0 3px var(--flow-glow)) drop-shadow(0 0 7px var(--flow-glow)); }
.flow-stroke { fill: none; stroke: currentColor; stroke-width: 3px; stroke-linecap: round; stroke-linejoin: round; }
.stage-buses > g > .weak-arm { color: var(--weak); filter: drop-shadow(0 0 4px var(--weak-glow)); }
.weak-arm .flow-stroke { stroke-width: 2px; stroke-dasharray: 6 6; }
.arrow-tip { fill: currentColor; }
.stage-column { position: relative; min-width: 0; display: flex; flex-direction: column; }
.map-stage { flex: 0 0 var(--stage-heading); position: relative; display: grid; place-items: center; margin: 0; }
.recruit-map .map-stage button {
  border: 0; padding: 2px 6px; background: transparent; color: var(--flow); font: 700 24px/30px var(--v14-font); cursor: pointer;
}
.map-stage button[aria-pressed=true] { box-shadow: inset 0 -2px var(--v14-list-line); }
.map-stage.onward::after {
  content: ''; pointer-events: none; position: absolute; left: 100%; transform: translateX(-50%);
  width: min(18%, 38px); height: 16px; background: linear-gradient(90deg, transparent, var(--flow));
  clip-path: polygon(0 32%, 65% 32%, 65% 0, 100% 50%, 65% 100%, 65% 68%, 0 68%);
}
.stage-nodes { flex: 1; position: relative; list-style: none; margin: 0; padding: 0; }
.stage-nodes li { position: absolute; left: 50%; transform: translate(-50%, -50%); width: var(--node-width); }
.map-node {
  --edge: var(--node-edge); --fill: var(--node-fill);
  position: relative; width: 100%; min-height: 52px; display: grid; place-items: center; box-sizing: border-box;
  border: 2px solid var(--edge); border-radius: 6px; padding: 6px 2px; text-align: center; cursor: pointer;
  background: linear-gradient(155deg, color-mix(in srgb, var(--fill) 77%, var(--edge)), var(--fill) 46%, color-mix(in srgb, var(--fill) 85%, var(--edge)));
  box-shadow: inset 0 0 12px color-mix(in srgb, var(--edge) 24%, transparent), 0 0 9px color-mix(in srgb, var(--edge) 19%, transparent);
  color: var(--v14-ink); font: 700 20px/26px var(--v14-font);
}
.map-node strong { white-space: nowrap; }
.map-node[data-status=weak] { --edge: var(--weak); --fill: var(--weak-fill); border-style: dashed; }
.map-node .node-status {
  position: absolute; top: -13px; right: 3px; border-radius: 3px; padding: 0 5px;
  font: 700 16px/21px var(--v14-font); background: var(--weak); color: var(--tag-ink);
}
.map-node:hover, .map-node[aria-pressed=true] { outline: 2px solid var(--edge); outline-offset: 3px; }
.map-node.subdued:not(:focus-visible) { opacity: .45; }
.recruit-map button:focus-visible { outline: 2px solid var(--v14-ink); outline-offset: 3px; }
@container (max-width: 580px) {
  .recruit-map .map-stage button { font-size: 20px; }
  .map-node { min-height: 44px; font-size: 16px; }
}
@container (max-width: 470px) {
  .recruit-map .recruit-heading { flex-wrap: wrap; gap: 4px 8px; }
  .recruit-map .map-search { order: 1; width: 100%; }
  .recruit-map .back-to-map { margin-inline-start: auto; }
}
@media (max-width: 960px) and (pointer: coarse) {
  .jt-body > .recruit-map { height: clamp(390px, 72dvh, 740px); }
}
</style>
