<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import type { Dataset } from './types'
import { findMapAddresses, indexMapAddresses, type MapAddress } from './platform-address-search'

const props = defineProps<{
  datasets: Dataset[]
  activeId?: string
  resources?: { key: string; name: string; group?: string }[]
  placesOnly?: boolean
  readOnly?: boolean
}>()
const query = defineModel<string>({ required: true })
const emit = defineEmits<{ locate: [place: MapAddress]; pick: [name: string]; resource: [key: string] }>()
const input = ref<HTMLInputElement>(), panel = ref<HTMLElement>(), open = ref(false)
const resultsId = useId()
const searchLabel = computed(() => props.placesOnly ? '搜索地址、地点或经纬度' : '搜索地址、地点或图层')
const index = computed(() => indexMapAddresses(props.datasets))
const places = computed(() => findMapAddresses(index.value, query.value, props.activeId))
const layers = computed(() => props.placesOnly ? [] : (props.resources ?? []).filter(row =>
  row.name.toLowerCase().includes(query.value.trim().toLowerCase())).slice(0, 4))
const expanded = computed(() => open.value && !!query.value.trim())

function locate(place: MapAddress) {
  if (props.placesOnly) input.value?.focus({ preventScroll: true })
  open.value = false
  emit('locate', place)
}
function resource(key: string) {
  open.value = false
  emit('resource', key)
}
function pick() {
  open.value = false
  emit('pick', query.value.trim())
}
function submit(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  if (!query.value.trim()) return
  if (places.value.length) locate(places.value[0])
  else if (layers.value.length) resource(layers.value[0].key)
  else open.value = true
}
async function move(event: KeyboardEvent, direction: number) {
  if (event.isComposing || !query.value.trim()) return
  event.preventDefault()
  open.value = true
  await nextTick()
  const buttons = Array.from(panel.value?.querySelectorAll('button') ?? [])
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (direction < 0 && current <= 0) input.value?.focus()
  else buttons[Math.min(buttons.length - 1, current + direction)]?.focus()
}
function leave(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) open.value = false
}
function dismiss(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229 || !open.value) return
  event.preventDefault()
  event.stopPropagation()
  input.value?.focus()
  open.value = false
}
</script>

<template>
  <div class="place-search" role="search" aria-label="地图搜索" @focusout="leave"
    @keydown.esc="dismiss" @keydown.down="move($event, 1)" @keydown.up="move($event, -1)">
    <input ref="input" v-model="query" type="search" maxlength="120" autocomplete="off"
      :placeholder="searchLabel" :aria-label="searchLabel" :aria-controls="resultsId"
      :aria-expanded="expanded" @input="open = true" @focus="open = true" @click="open = true" @keydown.enter="submit">
    <div v-if="expanded" :id="resultsId" ref="panel" class="place-results">
      <template v-if="places.length"><h3>地址与地点</h3>
        <button v-for="place in places" :key="place.sourceKey || place.name + place.position" type="button"
          class="place-row" :aria-label="'定位到' + place.name" @click="locate(place)">
          <span><strong>{{ place.name }}</strong>
            <small>{{ [place.region, place.address, place.source].filter(Boolean).join(' · ') }}</small></span>
          <b aria-hidden="true">定位</b>
        </button>
      </template>
      <p v-else class="place-empty">本地地名地址库中未找到匹配位置。</p>
      <template v-if="layers.length"><h3>预览资源</h3>
        <button v-for="layer in layers" :key="layer.key" class="place-row" type="button" @click="resource(layer.key)">
          <span>{{ layer.name }}<small v-if="layer.group">{{ layer.group }}</small></span><b aria-hidden="true">打开</b>
        </button>
      </template>
      <button v-if="!readOnly && !placesOnly" class="place-pick" type="button" @click="pick">在地图上选点添加此地址</button>
    </div>
  </div>
</template>

<style scoped>
.place-search{position:relative;flex:1 1 240px;min-width:0;max-width:430px}
.place-search input{width:100%;min-width:0}
.place-results{position:absolute;z-index:12;left:0;top:calc(100% + 4px);width:100%;min-width:min(275px,100%);max-height:min(430px,54dvh);overflow:auto;border:1px solid var(--platform-line);border-radius:9px;background:var(--platform-paper);color:var(--platform-ink);box-shadow:0 8px 24px #08141d33}
.place-results h3,.place-empty{padding:8px 12px;color:var(--platform-muted);font-size:14px}
.place-results h3{background:var(--platform-soft);font-weight:600}
.place-results button{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;text-align:left;border:0;border-radius:0;box-shadow:none;background:transparent;color:var(--platform-ink);padding:8px 12px}
.place-results button:hover,.place-results button:focus-visible{background:var(--platform-soft)}
.place-row span{min-width:0;overflow-wrap:anywhere}.place-row strong,.place-row small{display:block}.place-row small{margin-top:2px;color:var(--platform-muted);font-size:13px}
.place-row b,.place-results .place-pick{color:var(--platform-accent);font-size:14px}.place-row b{white-space:nowrap;font-weight:500}
.place-results .place-pick{border-top:1px solid var(--platform-line);min-height:39px}
</style>
