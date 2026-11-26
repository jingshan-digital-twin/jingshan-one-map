<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { eligibleReserve, reserveLayerId } from './investment-planning'
import { hasEnterpriseDirectory } from './chain-taxonomy.ts'
import { pages, type V3Page } from './v3-navigation'
import { featureCenter, type CityFeature, type Dataset } from './types'
import { useSceneAssistant } from './scene-assistant-context'
import { queryLedger, type LedgerHit, type LedgerLayer, type LedgerReply } from './assistant-ledger'

const props = withDefaults(defineProps<{
  page: V3Page
  area: string
  datasets?: Dataset[]
  ledgerLayers?: LedgerLayer[]
  contextId?: string
  loading?: boolean
  inScope?: (feature: CityFeature) => boolean
  showTrigger?: boolean
}>(), { showTrigger: true })
const emit = defineEmits<{ locate: [id: string, feature: CityFeature] }>()
const resources: Record<V3Page, string[]> = {
  overview: ['venues', 'businesses', 'events', 'court_footprints', 'charging', 'commerce_hotels', 'commerce_food'],
  industry: ['businesses', 'training', 'merchants'],
  venues: ['venues', 'court_footprints', 'schools', 'charging', 'parking', 'medical', 'commerce_hotels', 'commerce_food'],
  site: [reserveLayerId, 'venues'],
  investment: [reserveLayerId, 'investment_needs', 'projects'],
  events: ['events', 'parking', 'hotels'],
  liveEvent: ['parking', 'medical', 'security'],
  tourism: ['events', 'tourism', 'routes'],
  consumption: ['tourism', 'route_packages', 'merchants'],
  merchants: ['merchants', 'offers', 'route_packages'],
}
const assistant = useSceneAssistant()
const { opened, origin, scope } = assistant
const visible = computed(() => assistant.launcherVisible.value && props.showTrigger !== false)
const host = computed(() => origin.value?.closest('dialog[open]') ?? document.fullscreenElement)
const sources = computed(() => {
  if (props.ledgerLayers) return props.ledgerLayers
  const datasets = props.datasets ?? []
  const ids = props.page === 'industry' && hasEnterpriseDirectory(datasets) ? ['businesses'] : resources[props.page]
  return ids.flatMap(id => datasets.filter(layer => layer.id === id)).map(layer=>layer.id===reserveLayerId
    ? {...layer,features:layer.features.filter(eligibleReserve)} : layer)
})
const mode = ref('')
const draft = ref('')
const panel = ref<HTMLElement>()
const trigger = ref<HTMLElement>()
const input = ref<HTMLTextAreaElement>()
const log = ref<HTMLElement>()
const turns = shallowRef<(LedgerReply & { question: string; source: string; mode: string; shown: number })[]>([])
const contextMode = computed(() => mode.value === 'context' && !!scope.value)
const selectedPrompt = '解读图中选中项'
const prompts = computed(() => {
  if (contextMode.value && scope.value) return [...(scope.value.selection ? [selectedPrompt] : []), ...scope.value.prompts]
  const layers = sources.value.filter(layer => !mode.value || layer.id === mode.value)
  return ['台账概览', ...layers.slice(0, 2).map(layer => '查看' + layer.name)]
})
const position = ref({ left: '8px', bottom: '8px', height: 'min(600px, 75dvh)' })
function positionPanel() {
  if (!opened.value || !origin.value) return
  const bounds = origin.value.getBoundingClientRect()
  const drawer = origin.value.closest('dialog')?.getBoundingClientRect()
  const width = Math.min(440, innerWidth - 16)
  const left = drawer && drawer.left > width + 16 ? drawer.left - width - 8 : bounds.right - width
  // Keep the conversation usable even if the launcher sits halfway up a short screen.
  const bottom = !drawer && bounds.top > innerHeight * .75 ? innerHeight - bounds.top + 4 : 10
  position.value = { left: Math.max(8, Math.min(innerWidth - width - 8, left)) + 'px', bottom: bottom + 'px',
    height: Math.min(620, innerHeight - bottom - 8) + 'px' }
}
function outside(event: PointerEvent) {
  if (opened.value && event.target instanceof Node && !panel.value?.contains(event.target) && !origin.value?.contains(event.target) && !trigger.value?.contains(event.target)) assistant.close(false)
}
async function ask(raw: string) {
  const question = raw.trim()
  if (!question || props.loading) return
  const context = contextMode.value ? scope.value : null
  const previous = turns.value.at(-1)
  const reply: LedgerReply = context ? { text: context.selection && /图中选中项|这条(线|边|关系)|这个节点|选中(项|关系|节点)/.test(question)
    ? context.selection.detail : context.answer(question) } : queryLedger(question, sources.value, props.area, props.inScope ?? (() => true), mode.value, previous?.mode === mode.value ? previous : undefined)
  turns.value = [...turns.value, { question, mode: mode.value, source: context?.title ?? '场景台账', shown: 3, ...reply }]
  draft.value = ''
  await nextTick()
  const newest = log.value?.lastElementChild
  if (newest && log.value) {
    log.value.scrollTop += newest.getBoundingClientRect().top - log.value.getBoundingClientRect().top
  }
  input.value?.focus({ preventScroll: true })
}
function sendOnEnter(event: KeyboardEvent) {
  if (event.shiftKey || event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  ask(draft.value)
}
function showMore(index: number) {
  turns.value = turns.value.map((turn, i) => i === index ? { ...turn, shown: turn.shown + 5 } : turn)
}
function reset() {
  turns.value = []
  draft.value = ''
  mode.value = scope.value ? 'context' : ''
  if (opened.value) input.value?.focus({ preventScroll: true })
}
watch([() => props.area, () => scope.value?.key, () => scope.value?.selection?.id], reset, { immediate: true })
watch(() => props.contextId, (_, previous) => { if (previous) reset() })
watch(opened, async open => {
  if (!open) return
  await nextTick()
  if (!opened.value || !panel.value) return
  positionPanel()
  panel.value.showPopover()
  if (!turns.value.length && scope.value?.selection) await ask(selectedPrompt)
  else log.value?.scrollTo(0, log.value.scrollHeight)
  input.value?.focus({ preventScroll: true })
}, { flush: 'post' })
watch(visible, show => { if (!show && opened.value) assistant.close(false) })
function locate(hit: LedgerHit) {
  assistant.close(false)
  scope.value?.beforeLocate?.()
  emit('locate', hit.layer, hit.feature)
}
function canLocate(feature: CityFeature) {
  return Boolean(feature.geometry && featureCenter(feature))
}
onMounted(() => {
  document.addEventListener('pointerdown', outside)
  window.addEventListener('resize', positionPanel)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside)
  window.removeEventListener('resize', positionPanel)
  assistant.close(false)
})
</script>

<template>
  <button v-if="visible" ref="trigger" class="scene-assistant-trigger" type="button" aria-label="智能助手" title="智能助手"
    aria-haspopup="dialog" aria-controls="scene-assistant-panel" :aria-expanded="opened" @click="opened ? assistant.close() : assistant.openFrom($event)" @keydown.esc.stop="assistant.close()">
    <img src="/jingshan/ui/scene-assistant-light.png" alt="" />
    <span>智能助手</span>
  </button>
  <Teleport :to="host ?? 'body'" :disabled="!host">
    <section v-if="opened" id="scene-assistant-panel" ref="panel" popover="manual" :style="position" class="scene-assistant-panel"
      role="dialog" aria-labelledby="scene-assistant-title" @keydown.esc.stop.prevent="assistant.close()">
      <header class="chat-header">
        <img class="avatar" src="/jingshan/ui/scene-assistant-light.png" alt="" />
        <div class="identity"><h3 id="scene-assistant-title">智能助手</h3><small>{{ area }} · {{ pages[page].label }}</small></div>
        <button v-if="turns.length" class="reset" type="button" @click="reset">新对话</button>
        <button class="close-chat" type="button" aria-label="关闭智能助手" @click="assistant.close()">×</button>
      </header>
      <div ref="log" class="transcript" role="log" aria-label="对话记录" aria-live="polite">
        <div v-if="!turns.length" class="welcome">
          <div class="spark" aria-hidden="true">✦</div>
          <h4>{{ contextMode ? '想了解哪些细节？' : '想查询什么？' }}</h4>
          <p>{{ loading ? '正在读取当前场景台账…' : contextMode ? scope?.title : '输入名称或镇街，查找台账记录并在地图上定位。' }}</p>
          <div class="suggestions"><button v-for="prompt in prompts" :key="prompt" type="button" :disabled="loading" @click="ask(prompt)">{{ prompt }}<span aria-hidden="true">↗</span></button></div>
        </div>
        <article v-for="(turn, index) in turns" :key="index">
          <p class="question"><span class="sr">我：</span>{{ turn.question }}</p>
          <div class="byline"><b aria-hidden="true">✦</b> 智能助手 <small>{{ turn.source }}</small></div>
          <div class="reply">
            <p>{{ turn.text }}</p>
            <button v-for="hit in turn.hits?.slice(0, turn.shown)" :key="hit.layer + hit.feature.id" class="result" type="button"
              :disabled="!canLocate(hit.feature)" @click="locate(hit)">
              <span>{{ hit.feature.properties.name }}<small>{{ hit.feature.properties.region }} · {{ hit.category }}</small></span>
              <em>{{ canLocate(hit.feature) ? '地图定位' : '坐标待核实' }}</em>
            </button>
            <button v-if="turn.hits && turn.hits.length > turn.shown" type="button" class="more" @click="showMore(index)">查看更多记录 ↓</button>
          </div>
        </article>
      </div>
      <footer>
        <form class="composer" @submit.prevent="ask(draft)">
          <textarea ref="input" v-model="draft" rows="2" aria-label="输入问题" :placeholder="contextMode ? '询问当前内容…' : '输入名称、镇街，或问有哪些台账…'" @keydown.enter="sendOnEnter"></textarea>
          <div class="composer-tools">
            <select v-model="mode" aria-label="查询范围">
              <option v-if="scope" value="context">当前内容解读</option><option value="">全部场景台账</option>
              <option v-for="layer in sources" :key="layer.id" :value="layer.id">{{ layer.name }}</option>
            </select>
            <button class="send" type="submit" aria-label="发送消息" title="发送消息" :disabled="loading || !draft.trim()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5m-7 7 7-7 7 7"/></svg>
            </button>
          </div>
        </form>
        <div class="footnote"><small>Enter 发送 · Shift + Enter 换行</small><button v-if="visible" type="button" @click="assistant.close(false); assistant.setLauncherVisible(false)">隐藏悬浮图标</button></div>
      </footer>
    </section>
  </Teleport>
</template>

<style scoped>
.scene-assistant-trigger { position:absolute; right:8px; bottom:8px; width:clamp(64px,calc(106 * var(--v14-unit)),106px); aspect-ratio:1; z-index:4; pointer-events:auto; padding:0; border:0; background:transparent; display:grid; grid-template:minmax(0,1fr) auto / minmax(0,1fr); justify-items:center; }
.scene-assistant-trigger img { display:block; width:106%; height:100%; min-height:0; object-fit:cover; pointer-events:none; }
.scene-assistant-trigger span { padding:0 4px; border:1px solid var(--v14-list-line); border-radius:4px; background:var(--v14-overlay); color:var(--v14-ink); white-space:nowrap; font:600 clamp(14px,calc(16 * var(--v14-unit)),16px)/1.25 var(--v14-font); }
.scene-assistant-panel {
  --chat-bg:#10233e; --chat-surface:#19314e; --chat-accent:#86d1ff; --chat-line:#365370;
  box-sizing:border-box; position:fixed; inset:auto; margin:0; padding:0; width:min(440px,calc(100vw - 16px)); max-height:none;
  display:grid; grid-template-rows:auto minmax(0,1fr) auto; overflow:hidden; pointer-events:auto;
  background:var(--chat-bg); color:var(--v14-ink); border:1px solid var(--chat-line); border-radius:16px;
  box-shadow:0 12px 48px #07193342; font:400 16px/1.5 var(--v14-font);
}
:global(.jt-screen.cockpit-light .scene-assistant-panel) { --chat-bg:#f3f8fe; --chat-surface:#fff; --chat-accent:#205fa7; --chat-line:#bfd4ea; }
.scene-assistant-panel :is(button,select,textarea) { font:inherit; color:inherit; }
.scene-assistant-panel button { cursor:pointer; border:0; background:transparent; padding:0; }
.scene-assistant-panel button:disabled { cursor:default; }
.scene-assistant-panel :focus-visible { outline:2px solid var(--chat-accent); outline-offset:2px; }
.chat-header,.composer-tools,.footnote,.byline,.result,.suggestions button { display:flex; align-items:center; }
.chat-header { padding:13px 16px; gap:10px; background:var(--chat-surface); border-bottom:1px solid var(--chat-line); }
.avatar { display:block; width:44px; height:40px; flex:none; object-fit:cover; }
.identity { flex:1; min-width:0; }
.chat-header h3,.welcome h4 { margin:0; color:inherit; font:600 22px/30px var(--v14-font); }
.scene-assistant-panel small,.footnote,.byline { font-size:14px; color:var(--v14-muted); }
.scene-assistant-panel .reset,.footnote button { font-size:14px; color:var(--chat-accent); }
.scene-assistant-panel .close-chat { width:30px; font:24px/32px sans-serif; }
.transcript { min-height:0; overflow:auto; overscroll-behavior:contain; padding:18px; scrollbar-color:var(--v14-scroll-thumb) transparent; }
.transcript::-webkit-scrollbar { width:2px; }
.transcript::-webkit-scrollbar-thumb { background:var(--v14-scroll-thumb); }
.welcome { margin:12px 0; }
.spark { color:var(--chat-accent); font-size:32px; line-height:1.2; margin-bottom:8px; }
.welcome p { margin:6px 0 18px; color:var(--v14-muted); }
.suggestions { display:grid; gap:8px; }
.scene-assistant-panel .suggestions button,.scene-assistant-panel .result { justify-content:space-between; gap:10px; padding:9px 12px; border-radius:8px; text-align:left; background:var(--chat-surface); border:1px solid var(--chat-line); }
.suggestions span,.result em { color:var(--chat-accent); }
.scene-assistant-panel button:not(:disabled):hover { filter:brightness(1.08); color:var(--chat-accent); }
.transcript article + article { margin-top:22px; }
.question,.reply { white-space:pre-wrap; overflow-wrap:anywhere; }
.question { width:fit-content; max-width:85%; margin:0 0 14px auto; padding:9px 13px; background:#2163aa; color:white; border-radius:12px 12px 3px 12px; }
.byline { gap:6px; margin-bottom:5px; font-weight:600; }
.byline b { color:var(--chat-accent); }
.byline small { margin-left:3px; font-weight:400; }
.reply { padding:11px 13px; background:var(--chat-surface); border:1px solid var(--chat-line); border-radius:3px 12px 12px; }
.reply p { margin:0; }
.scene-assistant-panel .result { width:100%; margin-top:7px; background:var(--chat-bg); }
.result small { display:block; }
.result em { font:normal 14px/24px var(--v14-font); flex:none; }
.scene-assistant-panel .more { margin-top:9px; font-size:14px; color:var(--chat-accent); }
.scene-assistant-panel footer { padding:10px 14px; border-top:1px solid var(--chat-line); }
.composer { background:var(--chat-surface); padding:9px 11px; border:1px solid var(--chat-line); border-radius:12px; }
.composer:focus-within { border-color:var(--chat-accent); }
.composer textarea { display:block; width:100%; box-sizing:border-box; resize:none; background:transparent; border:0; padding:0; line-height:24px; }
.composer textarea:focus { outline:0; }
.composer textarea::placeholder { color:var(--v14-muted); }
.composer-tools,.footnote { justify-content:space-between; gap:8px; }
.composer-tools select { max-width:78%; background:var(--chat-bg); border:1px solid var(--chat-line); border-radius:6px; padding:3px; font-size:14px; }
.scene-assistant-panel .send { display:grid; place-items:center; width:32px; height:32px; border-radius:9px; background:#2163aa; color:white; }
.send:disabled { opacity:.45; }
.footnote { margin:5px 2px 0; }
.sr { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
@media (max-width:380px) {
  .footnote small { display:none; }
  .footnote { justify-content:flex-end; }
  .chat-header { padding:10px 12px; }
  .transcript { padding:12px; }
}
</style>
