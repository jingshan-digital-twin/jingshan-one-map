<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import OverviewPanelIcon from './OverviewPanelIcon.vue'
import type { ChainStage, ChainTopic } from './industry-panorama'

interface DirectoryStage {
  id: ChainStage
  title: string
  count: number
  nodes: readonly { name: ChainTopic; count: number; weak: boolean }[]
}

const props = defineProps<{
  directory: readonly DirectoryStage[]
  stage: ChainStage | null
  topic: ChainTopic | null
}>()
const emit = defineEmits<{ select: [stage: ChainStage | null, topic?: ChainTopic | null] }>()

const figure = ref<HTMLElement | null>(null)
const assets: Partial<Record<ChainTopic, string>> = {
  场地建设: 'court', 场馆运营: 'calendar', 俱乐部运营: 'club', 赛事组织: 'trophy',
  景区游览: 'travel', 运动康养: 'medical', 购物展销: 'private',
}
const columnStep = 96

const nodes = computed(() => {
  const stages = props.stage ? props.directory.filter(item => item.id === props.stage) : props.directory
  return stages.flatMap(stage => stage.nodes.map(node => ({ ...node, stage }))).map((node,index) => {
    const row = Math.floor(index / 3)
    const column = row % 2 === 0 ? index % 3 : 2 - index % 3
    return { ...node, row, column, x: 54 + column * columnStep, y: 32 + row * 100 }
  })
})

const rowCount = computed(() => Math.ceil(nodes.value.length / 3))
const hasWeakTopics = computed(() => nodes.value.some(node => node.weak))
const course = computed(() => {
  const segments = []
  const entries = new Map<ChainTopic, { left?: string; top?: string; transform?: string }>()
  const first = nodes.value[0]
  if (first) entries.set(first.name, {})
  let path = first ? 'M' + first.x + ' ' + first.y : ''
  for (let i = 1; i < nodes.value.length; i++) {
    const previous = nodes.value[i - 1]
    const node = nodes.value[i]
    const startsStage = previous.stage.id !== node.stage.id
    const horizontal = previous.row === node.row
    let step = ' H' + node.x
    let arrow = { x: (previous.x + node.x) / 2, y: node.y, angle: node.x > previous.x ? 0 : 180 }
    if (!horizontal) {
      const edge = node.column === 2 ? 294 : 6
      step = ' Q' + edge + ' ' + previous.y + ' ' + edge + ' ' + (previous.y + 22)
        + ' V' + (node.y - 22) + ' Q' + edge + ' ' + node.y + ' ' + node.x + ' ' + node.y
      arrow = { x: edge, y: previous.y + (startsStage ? 65 : 50), angle: 90 }
    }
    if (startsStage) {
      // The badge belongs to the arriving node. Position it on its incoming link.
      entries.set(node.name, {
        left: (50 + (arrow.x - node.x) / columnStep * 100) + '%',
        top: (arrow.y - node.row * 100) + '%',
        transform: horizontal ? undefined : node.column === 2
          ? 'translate(calc(-100% + 4px), -50%)' : 'translate(-4px, -50%)',
      })
    }
    segments.push({ key: node.name, stage: startsStage ? undefined : node.stage.id,
      path: 'M' + previous.x + ' ' + previous.y + step, arrow: startsStage ? null : arrow })
    path += step
  }
  return { path, segments, entries }
})

async function select(stage: ChainStage | null, topic?: ChainTopic) {
  const hadFocus = figure.value?.contains(document.activeElement)
  emit('select', stage, topic)
  await nextTick()
  if (hadFocus && document.activeElement === document.body) {
    figure.value?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }
}
</script>

<template>
  <figure ref="figure" class="chain-diagram" :class="{ 'full-chain': !stage }" aria-label="网旅产业链业务流程图">
    <div v-if="stage" class="chain-navigation"><button class="chain-return" type="button" @click="select(null)">全链条</button></div>
    <div class="chain-course">
      <svg class="chain-ribbon" :viewBox="'0 0 300 ' + Math.max(1, rowCount) * 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path class="ribbon-edge" :d="course.path" />
        <g v-for="segment in course.segments" :key="segment.key" :data-stage="segment.stage">
          <path class="ribbon-fill" :d="segment.path" />
          <path v-if="segment.arrow" class="ribbon-arrow" d="m-3 -3.6 5 3.6 -5 3.6"
            :transform="'translate(' + segment.arrow.x + ' ' + segment.arrow.y + ') rotate(' + segment.arrow.angle + ')'" />
        </g>
        <path class="ribbon-current" :d="course.path" pathLength="100" />
      </svg>
      <ol class="chain-nodes">
        <li v-for="node in nodes" :key="node.name" class="chain-node" :data-stage="node.stage.id"
          :style="{ gridRow: node.row + 1, gridColumn: node.column + 1 }">
          <button v-if="course.entries.has(node.name)" class="chain-stage-trigger" type="button"
            :class="{ 'chain-start': node === nodes[0] }" :style="course.entries.get(node.name)"
            :aria-label="node.stage.id + '，' + node.stage.title + '，' + node.stage.count + '家主体'"
            :aria-pressed="stage === node.stage.id && !topic" @click="select(node.stage.id)">{{ node.stage.id }}</button>
          <button class="chain-topic" type="button" :aria-label="[node.name, node.count + '家主体', node.weak ? '弱链' : ''].filter(Boolean).join('，')"
            :aria-pressed="topic === node.name" :title="node.weak ? node.name + ' · 弱链' : node.name" @click="select(node.stage.id, node.name)">
            <span class="chain-medallion">
              <i v-if="node.weak" class="risk-mark" aria-hidden="true"></i>
              <svg v-if="node.name === '器材制造'" class="chain-symbol" viewBox="0 0 24 24" aria-hidden="true">
                <ellipse cx="14.5" cy="8.5" rx="5.1" ry="7" transform="rotate(40 14.5 8.5)" />
                <path d="m10.4 14-6 7-1.7-1.4 6.1-7m3-6.9 5.8 4.7M10.5 8l5.3 4.3m1.7-8.6-6.7 8.2" /><circle cx="19.5" cy="18.8" r="2" />
              </svg>
              <svg v-else-if="node.name === '运动服饰'" class="chain-symbol" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m8.2 3.8-5.8 3.8 2.8 4.1 2.2-1.3V21h9.2V10.4l2.2 1.3 2.8-4.1-5.8-3.8a4 4 0 0 1-7.6 0Z" />
              </svg>
              <svg v-else-if="node.name === '培训陪练'" class="chain-symbol" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="15.4" cy="4.5" r="2.1" /><path d="m5 11.5 4-3 4.2.8-2.7 5.4 4 2.5-1.1 4.5m.2-11.6 2.6 2.1 4-2M10 15l-3.2 3.3H3" />
              </svg>
              <svg v-else-if="node.name === '住宿接待'" class="chain-symbol" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.5 5v15m19-6v6m-19-4h19v-3.4a2.6 2.6 0 0 0-2.6-2.6H12v4H3" /><circle cx="7.8" cy="9.8" r="2.4" />
              </svg>
              <svg v-else-if="node.name === '餐饮服务'" class="chain-symbol" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 3v4.5a3 3 0 0 0 6 0V3M7 3v18m11-18c-3 2.5-4 6-4 9h4m0-9v18" />
              </svg>
              <OverviewPanelIcon v-else :name="assets[node.name] ?? 'court'" />
            </span>
            <span class="node-name"><span>{{ node.name.slice(0, -2) }}</span><span>{{ node.name.slice(-2) }}</span></span>
          </button>
        </li>
      </ol>
    </div>
    <figcaption v-if="hasWeakTopics" class="risk-legend">
      <span><i class="risk-mark" aria-hidden="true"></i>弱链</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.chain-diagram {
  --row-height: 58px;
  --medallion: 28px;
  --upstream: #64dbc4;
  --midstream: #bbaaff;
  --downstream: #ffc37b;
  --label-ink: #10223d;
  margin: 0;
  padding: 4px;
  min-width: 0;
  container-type: inline-size;
  color: var(--v14-ink);
  font: 400 16px/1.2 var(--v14-font);
  border: 1px solid var(--industry-table-line);
  border-radius: 4px;
  background: var(--v14-list);
}
.cockpit-light .chain-diagram {
  --upstream: #087369;
  --midstream: #5948aa;
  --downstream: #984910;
  --label-ink: white;
}
[data-stage="上游"] { --stage-color: var(--upstream); }
[data-stage="中游"] { --stage-color: var(--midstream); }
[data-stage="下游"] { --stage-color: var(--downstream); }
.chain-course { position: relative; }
.full-chain { --row-height: 72px; }
.chain-ribbon { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.chain-ribbon path { fill: none; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.ribbon-edge { stroke: var(--v14-chart-track); stroke-width: 6; }
.ribbon-fill { stroke: var(--stage-color, var(--v14-muted)); stroke-width: 3; }
.ribbon-current { stroke: var(--v14-ink); stroke-width: 1.5; stroke-dasharray: 2 98; animation: chain-travel 6s linear infinite; opacity: .7; }
.ribbon-arrow { stroke-width: 2; stroke: var(--stage-color, var(--v14-muted)); }
@keyframes chain-travel { to { stroke-dashoffset: -100; } }
@media (prefers-reduced-motion: reduce) { .ribbon-current { display: none; } }
.chain-nodes { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); grid-auto-rows: var(--row-height); list-style: none; margin: 0; padding: 0 2%; }
.chain-node { position: relative; min-width: 0; }
.chain-diagram button { font: inherit; color: inherit; border: 0; padding: 0; background: none; cursor: pointer; }
.chain-diagram .chain-course .chain-stage-trigger {
  position: absolute; z-index: 1; transform: translate(-50%, -50%);
  padding: 1px 4px; border-radius: 4px; background: var(--stage-color); color: var(--label-ink);
  font-size: 13px; line-height: 18px; font-weight: 700; white-space: nowrap;
}
.chain-diagram .chain-course .chain-start {
  top: 32%;
  right: calc(50% + var(--medallion) / 2 + 5px);
  transform: translateY(-50%);
}
.chain-stage-trigger::before { content: ""; position: absolute; inset: -3px 0; }
.chain-stage-trigger:hover, .chain-stage-trigger[aria-pressed=true] { text-decoration: underline; text-underline-offset: 2px; }
.chain-topic {
  position: absolute; top: calc(32% - var(--medallion) / 2); inset-inline: 0; width: 100%;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
}
.chain-medallion {
  position: relative;
  display: grid; place-items: center; flex: none; width: var(--medallion); height: var(--medallion); box-sizing: border-box;
  border-radius: 50%; border: 2px solid var(--stage-color); background: var(--v14-tab), var(--v14-overlay);
}
.risk-legend { display: flex; justify-content: flex-end; gap: 10px; padding: 0 6px 2px; font: 400 16px/20px var(--v14-font); color: var(--v14-muted); }
.risk-legend span { display: inline-flex; align-items: center; gap: 6px; }
.risk-mark { display: inline-block; width: 9px; height: 9px; box-sizing: border-box; transform: rotate(45deg); background: var(--panorama-weak); }
.chain-medallion .risk-mark { position: absolute; top: -3px; right: -3px; }
.chain-medallion svg { width: 89%; height: 89%; }
.chain-medallion .chain-symbol {
  width: 72%; height: 72%; fill: none; color: var(--stage-color);
  stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;
}
.node-name { font-weight: 700; max-width: 100%; line-height: 1.15; }
.node-name > span { display: inline-block; white-space: nowrap; }
.chain-topic:is(:hover,[aria-pressed=true]) .chain-medallion { outline: 2px solid var(--stage-color); outline-offset: 1px; }
.chain-topic:is(:hover,[aria-pressed=true]) .node-name { color: var(--stage-color); text-decoration: underline; }
.chain-diagram button:focus-visible { outline: 2px solid var(--v14-icon); outline-offset: 1px; border-radius: 3px; }
.chain-navigation { display: flex; justify-content: flex-end; }
.chain-diagram .chain-return {
  padding: 2px 3px;
  font-size: 14px; line-height: 16px;
  color: var(--v14-icon); text-decoration: underline; text-underline-offset: 3px;
}
@container (max-width: 260px) {
  .chain-nodes { --row-height: 74px; --medallion: 26px; }
  .full-chain .chain-nodes { --row-height: 78px; }
  .node-name { font-size: 15px; }
}
@container (max-width: 300px) {
  .chain-course { margin-top: 22px; }
  .chain-diagram .chain-course .chain-start {
    top: -21px; left: 50%; right: auto; transform: translateX(-50%);
  }
}
</style>
