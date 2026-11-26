<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import EnterpriseRelationGraph from './EnterpriseRelationGraph.vue'
import { buildEnterpriseGraph, companyNodeId, type GraphEdge, type GraphNode } from './industry-knowledge-graph'
import { enterpriseBusiness, enterpriseChainLabel, type CatalogEnterprise, type Enterprise } from './industry-panorama'
import type { Dataset } from './types'
import type { AssistantSelection } from './scene-assistant-context'

const props = defineProps<{ center: CatalogEnterprise; datasets: Dataset[] }>()
const emit = defineEmits<{ explore: [key: string]; locate: [entry: Enterprise]; context: [value: AssistantSelection | null] }>()
const graph = computed(() => buildEnterpriseGraph(props.datasets, props.center))
const centerId = computed(() => companyNodeId(props.center.key))
const nodes = computed(() => [...graph.value.nodes.values()].map(node => ({ ...node, center: node.id === centerId.value })))
const edges = computed(() => [...graph.value.edges.values()])
const chosen = ref<{ node?: string; edge?: string }>({ node: centerId.value })
const selectedEdge = computed(() => chosen.value.edge ? graph.value.edges.get(chosen.value.edge) : undefined)
const selectedNode = computed(() => selectedEdge.value ? undefined : graph.value.nodes.get(chosen.value.node ?? '') ?? graph.value.nodes.get(centerId.value))
const adjacent = computed(() => graph.value.connections.get(selectedNode.value?.id ?? '') ?? [])
const peerCount = computed(() => graph.value.nodes.size - 1)
const nameOf = (id: string) => graph.value.nodes.get(id)?.name ?? ''
function peer(edge: GraphEdge, id: string) { return nameOf(edge.from === id ? edge.to : edge.from) }
const nodeDescription = computed(() => {
  const node = selectedNode.value
  if (!node) return ''
  if (node.row) return enterpriseBusiness(node.row, '主营业务待补充')
  return '凭证中列名的关联企业，尚无独立名录档案。'
})
const assistantSelection = computed<AssistantSelection | null>(() => {
  const edge = selectedEdge.value
  if (edge) return { id: edge.id, title: nameOf(edge.from) + ' · ' + edge.label + ' · ' + nameOf(edge.to),
    detail: edge.evidence.map(item => item.title + '。' + item.text + ' 依据为' + item.sources.map(s => s.title).join('、') + '。').join(' ') }
  const node = selectedNode.value
  if (!node) return null
  const related = adjacent.value.map(e => e.label + '（' + peer(e, node.id) + '）').join('、')
  return { id: node.id, title: node.name, enterpriseKey: node.row?.key,
    detail: related ? '图中关联有' + related + '。' : '当前资料尚未收录与这家企业直接关联的企业。' }
})
watch(assistantSelection, value => emit('context', value), { immediate: true })
onBeforeUnmount(() => emit('context', null))

const query = ref('')
const searching = ref(false)
const searchHits = computed(() => {
  const q = query.value.trim().toLocaleLowerCase()
  return q ? nodes.value.filter(n => (n.name + n.group).toLocaleLowerCase().includes(q)) : []
})
function selectNode(id: string) { chosen.value = { node: id }; searching.value = false }
function selectEdge(id: string) { chosen.value = { edge: id }; searching.value = false }
function submitSearch(node: GraphNode | undefined) { if (node) { selectNode(node.id); query.value = '' } }
function endSearch(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Node) || !(event.currentTarget as HTMLElement).contains(event.relatedTarget)) searching.value = false
}
</script>

<template>
  <section class="enterprise-network" :class="{ 'no-peers': !peerCount }" aria-label="企业关系图谱">
    <header class="kg-header">
      <div><h3>企业关系图谱</h3>
        <span class="kg-count">直接关联 {{ peerCount }} 家企业 · {{ edges.length }} 条关系</span>
      </div>
      <form v-if="peerCount" role="search" class="kg-search" @submit.prevent="submitSearch(searchHits[0])" @focusout="endSearch">
        <input v-model="query" type="search" aria-label="查找图中企业" placeholder="查找图中企业" autocomplete="off"
          @input="searching = true" @focus="searching = true" @keydown.esc.stop.prevent="query = ''; searching = false">
        <ul v-if="searching && query.trim()" class="kg-results">
          <li v-for="hit in searchHits.slice(0, 8)" :key="hit.id"><button type="button" @click="submitSearch(hit)"><small>{{ hit.group }}</small>{{ hit.name }}</button></li>
          <li v-if="!searchHits.length">图中没有匹配的企业</li>
        </ul>
      </form>
    </header>
    <div class="kg-main">
      <div class="kg-plot">
        <EnterpriseRelationGraph :nodes="nodes" :edges="edges" :selected-id="selectedEdge?.id ?? null"
          :selected-node-id="selectedNode?.id ?? null" @select="selectEdge" @select-node="selectNode" />
      </div>
      <aside class="kg-inspector" aria-label="所选节点或关系详情" aria-live="polite">
        <template v-if="selectedNode">
          <span class="kg-kicker">{{ selectedNode.group }}<template v-if="selectedNode.id === centerId"> · 当前档案</template></span>
          <h4>{{ selectedNode.name }}</h4>
          <p v-if="selectedNode.row" class="kg-membership">{{ enterpriseChainLabel(selectedNode.row) }}</p>
          <p v-if="nodeDescription" class="kg-description">{{ nodeDescription }}</p>
          <div v-if="selectedNode.point || (selectedNode.row && selectedNode.id !== centerId)" class="kg-actions">
            <button v-if="selectedNode.row && selectedNode.id !== centerId" type="button" class="industry-button" @click="emit('explore', selectedNode.row.key)">以该企业为中心</button>
            <button v-if="selectedNode.point" type="button" class="industry-button" @click="emit('locate', selectedNode.point)">地图定位</button>
          </div>
          <h5 v-if="adjacent.length">相连关系 <b>{{ adjacent.length }}</b></h5>
          <ul v-if="adjacent.length" class="kg-adjacent"><li v-for="edge in adjacent" :key="edge.id">
            <button type="button" @click="selectEdge(edge.id)"><small>{{ edge.label }}</small>{{ peer(edge, selectedNode.id) }}</button>
          </li></ul>
          <p v-else class="kg-muted">当前资料尚未收录与这家企业直接关联的企业。</p>
        </template>
        <template v-else-if="selectedEdge">
          <span class="kg-kicker">企业关系</span>
          <h4>{{ selectedEdge.label }}</h4>
          <div class="kg-endpoints"><button type="button" @click="selectNode(selectedEdge.from)">{{ nameOf(selectedEdge.from) }}</button>
            <span>{{ selectedEdge.direction === 'out' ? '→' : '—' }}</span>
            <button type="button" @click="selectNode(selectedEdge.to)">{{ nameOf(selectedEdge.to) }}</button></div>
          <article v-for="(item, i) in selectedEdge.evidence" :key="i" class="kg-proof">
            <h5>{{ item.title }}</h5><time v-if="item.date">{{ item.date }}</time><p>{{ item.text }}</p>
            <template v-for="(s, j) in item.sources" :key="j">
              <a v-if="s.url" :href="s.url" target="_blank" rel="noopener noreferrer">{{ s.title }} ↗</a>
              <small v-else>{{ s.title }}</small>
            </template>
          </article>
        </template>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.enterprise-network {
  --knowledge-graph-height: clamp(260px, 42dvh, 400px);
  min-width: 0; display: grid; align-content: start; gap: 10px;
  color: var(--v14-ink); font: 400 16px/24px var(--v14-font);
}
.enterprise-network.no-peers { --knowledge-graph-height: 180px; }
.kg-header, .kg-actions, .kg-endpoints { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.kg-header { justify-content: space-between; }
.kg-header h3 { margin: 0; font-size: 20px; line-height: 28px; }
.kg-count, .kg-kicker, .kg-muted, .kg-membership, .kg-proof time { color: var(--v14-muted); }
.kg-search { position: relative; width: min(160px,100%); }
.kg-search input { width: 100%; min-height: 34px; padding: 4px 8px; font: inherit; }
.kg-results {
  position: absolute; z-index: 4; inset: 100% 0 auto; max-height: 220px; overflow: auto;
  margin: 1px 0 0; padding: 4px; list-style: none; background: var(--overlay-fill,#173456);
  border: 1px solid var(--v14-list-line); box-shadow: var(--side-shadow);
}
.kg-results button, .kg-adjacent button, .kg-endpoints button {
  width: 100%; padding: 5px 6px; background: transparent; color: var(--v14-ink); text-align: left;
  border: 0; cursor: pointer; overflow-wrap: anywhere; font: inherit;
}
.kg-results button:hover, .kg-adjacent button:hover, .kg-endpoints button:hover { background: var(--industry-selected); }
.kg-results small, .kg-adjacent small { color: var(--v14-muted); margin-inline-end: 6px; font-size: 16px; }
.kg-main { display: grid; grid-template-columns: minmax(0,1fr); gap: 10px; }
.kg-inspector {
  display: grid; align-content: start; gap: 8px; min-width: 0; padding: 10px 12px;
  border: 1px solid var(--v14-edge); background: var(--v14-list); border-radius: 4px;
}
.kg-kicker, .kg-inspector h4, .kg-inspector h5 { font-weight: 700; }
.kg-inspector h4, .kg-inspector h5, .kg-inspector p { margin: 0; overflow-wrap: anywhere; }
.kg-inspector h4 { font-size: 18px; line-height: 26px; }
.kg-inspector h5, .kg-proof small { font-size: 16px; }
.kg-adjacent { list-style: none; padding: 0; margin: 0; }
.kg-adjacent li + li { border-top: 1px solid var(--v14-edge); }
.kg-endpoints button { width: auto; padding: 0; text-decoration: underline; text-underline-offset: 3px; }
.kg-proof { display: grid; gap: 5px; padding-top: 8px; border-top: 1px solid var(--v14-edge); overflow-wrap: anywhere; }
.kg-proof a { color: inherit; text-underline-offset: 3px; }
</style>
