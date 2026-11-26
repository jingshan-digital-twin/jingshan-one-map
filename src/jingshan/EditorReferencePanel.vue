<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import PortalIcon from './PortalIcon.vue'

type OptionGroup = '空间数据' | '地图服务'
type LayerOption = { key: string; name: string; group: OptionGroup }
type ReferenceLayer = {
  key: string
  name: string
  color: string
  visible: boolean
  opacity: number
  status: string
  error?: boolean
}
const props = defineProps<{ options: LayerOption[]; layers: ReferenceLayer[] }>()
const emit = defineEmits<{
  add: [key: string]
  remove: [key: string]
  visibility: [key: string, visible: boolean]
  opacity: [key: string, percent: number]
  retry: [key: string]
}>()
const panel = ref<HTMLElement>()
const toggle = ref<HTMLButtonElement>()
const search = ref<HTMLInputElement>()
const pickerOpen = ref(false)
const expanded = ref(true)
const terms = ref('')
const pickerId = useId(), listId = useId()
const selected = computed(() => new Set(props.layers.map(layer => layer.key)))
const groups: OptionGroup[] = ['空间数据', '地图服务']
const matches = computed(() => {
  const q = terms.value.trim().toLocaleLowerCase()
  return props.options.filter(option => !selected.value.has(option.key) &&
    (option.name.toLocaleLowerCase().includes(q) || option.group.includes(q)))
})
const visibleGroups = computed(() => groups.map(group => ({
  group, items: matches.value.filter(option => option.group === group),
})).filter(entry => entry.items.length))
const errors = computed(() => props.layers.filter(layer => layer.error).length)

function closePicker(restoreFocus = false) {
  pickerOpen.value = false
  if (restoreFocus) toggle.value?.focus()
}
async function togglePicker() {
  if (pickerOpen.value) return closePicker(true)
  terms.value = ''
  pickerOpen.value = true
  await nextTick()
  search.value?.focus()
}
function choose(key: string) {
  emit('add', key)
  expanded.value = true
  closePicker(true)
}
function dismissOutside(event: Event) {
  if (event.target instanceof Node && !panel.value?.contains(event.target)) closePicker()
}
function onFocusOut(event: FocusEvent) {
  if (event.relatedTarget instanceof Node && !panel.value?.contains(event.relatedTarget)) closePicker()
}
watch(pickerOpen, open => {
  if (open) document.addEventListener('pointerdown', dismissOutside)
  else document.removeEventListener('pointerdown', dismissOutside)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', dismissOutside))
</script>

<template>
  <div ref="panel" class="ref-panel" @focusout="onFocusOut">
    <div class="ref-strip">
      <button v-if="layers.length" type="button" class="ref-summary" :aria-expanded="expanded" :aria-controls="listId"
        @click="expanded = !expanded; closePicker()">
        <PortalIcon name="layers" :size="15" />参考图层 <b>{{ layers.length }}</b>
        <span v-if="errors && !expanded" class="ref-error-count">{{errors}} 个异常</span>
        <PortalIcon class="ref-chevron" name="chevron" :size="12" />
      </button>
      <span v-else class="ref-summary"><PortalIcon name="layers" :size="15" />参考图层</span>
      <button ref="toggle" type="button" class="ref-add" :aria-expanded="pickerOpen" :aria-controls="pickerId"
        @click="togglePicker"><PortalIcon name="plus" :size="14" />添加图层</button>
    </div>
    <section v-if="pickerOpen" :id="pickerId" class="ref-picker" aria-label="添加参考图层"
      @keydown.esc.stop.prevent="closePicker(true)">
      <div class="ref-search-row">
        <label class="ref-search"><PortalIcon name="search" :size="16"/>
          <input ref="search" v-model="terms" type="search" aria-label="搜索参考图层" placeholder="搜索图层名称" @keydown.enter.prevent />
        </label>
        <button class="ref-icon" type="button" aria-label="关闭图层选择" title="关闭图层选择" @click="closePicker(true)"><PortalIcon name="close" :size="15"/></button>
      </div>
      <div class="ref-options">
        <div v-for="entry in visibleGroups" :key="entry.group" role="group" :aria-label="entry.group" class="ref-group">
          <div class="ref-group-title">{{ entry.group }}</div>
          <button v-for="item in entry.items" :key="item.key" class="ref-option" type="button"
            :aria-label="'添加' + entry.group + '：' + item.name" @click="choose(item.key)">
            <PortalIcon :name="entry.group === '地图服务' ? 'services' : 'preview'" :size="15"/>
            <span>{{ item.name }}</span><PortalIcon name="plus" :size="13"/>
          </button>
        </div>
        <p v-if="!matches.length" class="ref-empty" role="status">{{ terms.trim() ? '没有匹配的图层' : '暂无可添加的图层' }}</p>
      </div>
    </section>
    <ul v-show="layers.length && expanded" :id="listId" class="ref-list" aria-label="已添加的参考图层">
      <li v-for="layer in layers" :key="layer.key" class="ref-item">
        <button type="button" class="ref-icon ref-eye" :class="{off: !layer.visible}" :aria-pressed="layer.visible"
          :aria-label="'显示' + layer.name" :title="layer.visible ? '隐藏图层' : '显示图层'"
          @click="emit('visibility', layer.key, !layer.visible)"><PortalIcon name="eye" :size="15"/></button>
        <i class="ref-swatch" aria-hidden="true" :style="{backgroundColor: layer.color}"/>
        <div class="ref-name"><b :title="layer.name">{{layer.name}}</b>
          <small v-if="layer.status" role="status" :class="{ 'ref-error': layer.error }">{{layer.status}}</small>
        </div>
        <div class="ref-alpha">
          <input type="range" min="0" max="100" step="1" :value="layer.opacity" :aria-label="layer.name + '不透明度'"
            :aria-valuetext="'不透明度 ' + layer.opacity + '%'" :title="'不透明度 ' + layer.opacity + '%'"
            @input="emit('opacity', layer.key, ($event.target as HTMLInputElement).valueAsNumber)" />
          <span>{{layer.opacity}}%</span>
        </div>
        <button type="button" class="ref-icon" :aria-label="'移除' + layer.name" title="移除图层"
          @click="emit('remove',layer.key)"><PortalIcon name="close" :size="14"/></button>
        <button v-if="layer.error" class="ref-retry" type="button" :aria-label="'重新加载' + layer.name"
          @click="emit('retry',layer.key)">重新加载</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ref-panel{min-width:0;position:relative;color:var(--platform-ink);font-size:13px}
.ref-strip,.ref-search-row,.ref-summary,.ref-add,.ref-search,.ref-icon,.ref-option,.ref-alpha{display:flex;align-items:center}
.ref-strip{min-height:36px;padding:4px 6px 4px 9px;gap:5px;justify-content:space-between;border:1px solid var(--platform-line);border-radius:8px;background:var(--platform-soft)}
.ref-panel .ref-summary{gap:6px;padding:0;border:0;background:none;font-size:13px;font-weight:650;color:var(--platform-ink)}
.ref-summary>svg:first-child,.ref-panel .ref-add,.ref-group-title{color:var(--platform-accent)}
.ref-summary b{font-size:11px;font-weight:600;color:var(--platform-muted)}
.ref-summary[aria-expanded="true"] .ref-chevron{transform:rotate(90deg)}
.ref-panel .ref-add{gap:4px;padding:3px 9px;min-height:26px;border-radius:6px;background:var(--platform-paper);font-size:12px;white-space:nowrap}
.ref-panel .ref-add:hover,.ref-panel .ref-option:hover,.ref-panel .ref-icon:hover{background:var(--portal-selected)}
.ref-picker{position:absolute;inset:38px 0 auto auto;z-index:15;width:min(340px,100%);padding:8px;border:1px solid var(--platform-line);border-radius:10px;background:var(--platform-paper);box-shadow:0 6px 18px rgb(24 27 45 / .16)}
.ref-search-row{gap:5px}
.ref-panel .ref-search{flex:1;min-width:0;flex-direction:row;gap:6px;padding-inline:8px;border:1px solid var(--platform-line);border-radius:6px;background:var(--platform-soft);color:var(--platform-muted)}
.ref-panel .ref-search:focus-within{outline:2px solid var(--platform-accent)}
.ref-panel .ref-search input[type="search"]{min-width:0;width:100%;border:0;outline:none;box-shadow:none;background:transparent;padding:5px 0;font-size:13px}
.ref-options{max-height:min(220px,32dvh);overflow:auto;margin-top:5px}
.ref-group-title{padding:6px;color:var(--platform-muted);font-size:11px;font-weight:650}
.ref-panel .ref-option{width:100%;gap:7px;padding:6px 7px;font-size:13px;line-height:1.35;text-align:start;background:transparent;border:0;border-radius:5px}
.ref-option span{flex:1;overflow-wrap:anywhere}
.ref-option svg{flex:none;color:var(--platform-accent)}
.ref-empty{padding:14px 8px;text-align:center;color:var(--platform-muted)}
.ref-list{list-style:none;margin:4px 0 0;padding:0;max-height:145px;overflow:auto;border:1px solid var(--platform-line);border-radius:8px;background:var(--platform-paper)}
.ref-item{min-width:0;display:grid;grid-template-columns:24px 8px minmax(55px,1fr) minmax(58px,94px) 23px;align-items:center;gap:5px;padding:4px 6px;font-size:12px}
.ref-item + .ref-item{border-top:1px solid var(--platform-line)}
.ref-panel .ref-icon{width:24px;height:26px;justify-content:center;padding:0;background:transparent;border:0;border-radius:4px;color:var(--platform-muted)}
.ref-panel .ref-eye[aria-pressed="true"]{color:var(--platform-accent)}
.ref-eye.off{position:relative;opacity:.65}
.ref-eye.off:after{position:absolute;content:"";width:17px;height:1.5px;transform:rotate(-45deg);background:currentColor}
.ref-swatch{width:8px;height:8px;border-radius:3px}
.ref-name{min-width:0;display:grid}
.ref-name b{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ref-name small{font-size:11px;color:var(--platform-muted);line-height:1.35;overflow-wrap:anywhere}
.ref-alpha{gap:3px;color:var(--platform-muted);min-width:0;font-size:10px}
.ref-panel .ref-alpha input[type="range"]{flex:1;width:100%;min-width:0;padding:0;height:18px;margin:0;accent-color:var(--platform-accent);border:0;background:none;cursor:pointer}
.ref-alpha span{min-width:29px;text-align:end;font-variant-numeric:tabular-nums}
.ref-name .ref-error,.ref-error-count{color:var(--red)}
.ref-error-count{font-size:11px}
.ref-panel .ref-retry{grid-column:3/-1;justify-self:start;padding:0;border:0;background:transparent;color:var(--platform-accent);font-size:12px}
</style>
