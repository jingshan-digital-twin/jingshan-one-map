<script setup lang="ts">
import { computed, inject, onBeforeUnmount, reactive, toRaw, watch } from 'vue'
import type LayerGroup from 'ol/layer/Group.js'
import type BaseLayer from 'ol/layer/Base.js'
import VectorLayer from 'ol/layer/Vector.js'
import EditorReferencePanel from './EditorReferencePanel.vue'
import { editorReferences, type EditorReferenceSetting } from './editor-reference-context'
import { canReferenceDataset, createDatasetReference } from './editor-reference-datasets'
import { canReferenceService, createServiceReferenceLayer } from './editor-reference-services'
import type { Dataset } from './types'
import type { CimService } from './cim-types'

const props = defineProps<{ group: LayerGroup; datasetId: string }>()
const context = inject(editorReferences)!
type Option = {key:string; name:string} & (
  {group:'空间数据'; source:Dataset} | {group:'地图服务'; source:CimService}
)
const catalog = computed(() => {
  const options = new Map<string,Option>()
  for (const item of context.datasets.value) {
    if (item.id === props.datasetId || !canReferenceDataset(toRaw(item))) continue
    const key = 'dataset:' + item.id
    options.set(key, {key, name:item.name, group:'空间数据', source:toRaw(item)})
  }
  for (const item of context.services.value) {
    if (!canReferenceService(item)) continue
    const key = 'service:' + item.id
    options.set(key, {key, name:item.name, group:'地图服务', source:toRaw(item)})
  }
  return options
})
const options = computed(() => [...catalog.value.values()])
const chosen = computed(() => context.selected.value.flatMap(setting => {
  const option = catalog.value.get(setting.key)
  return option ? [{setting, option}] : []
}))
const statuses = reactive<Record<string,{status:string;error?:boolean}>>({})
const rows = computed(() => chosen.value.map(({setting,option}) => ({
  ...setting, name:option.name, ...(statuses[setting.key] ?? {status:'正在加载'}),
})))
const palette = ['#167f82','#cb7333','#447cc4','#bf5879','#608831','#9262ba']
function add(key:string) {
  if (!catalog.value.has(key) || context.selected.value.some(item => item.key === key)) return
  const color = palette.find(c => !context.selected.value.some(s => s.color === c))
    ?? palette[context.selected.value.length % palette.length]
  context.selected.value = [...context.selected.value, {key,color,visible:true,opacity:80}]
}
function remove(key:string) {
  context.selected.value = context.selected.value.filter(s => s.key !== key)
}
function update(key:string, values:Partial<Pick<EditorReferenceSetting,'opacity'|'visible'>>) {
  context.selected.value = context.selected.value.map(s => s.key === key ? {...s,...values} : s)
}

type Loaded = {source:Dataset | CimService; controller:AbortController; layer?:BaseLayer}
const loaded = new Map<string,Loaded>()
function unload(key:string) {
  const current = loaded.get(key)
  if (!current) return
  loaded.delete(key)
  current.controller.abort()
  if (current.layer) {
    props.group.getLayers().remove(current.layer)
    current.layer.dispose()
  }
  delete statuses[key]
}
function display(layer:BaseLayer, setting:EditorReferenceSetting) {
  layer.setVisible(setting.visible)
  layer.setOpacity(setting.opacity / 100)
}
async function load(option:Option, color:string) {
  const {key} = option
  const current:Loaded = {source:option.source, controller:new AbortController()}
  loaded.set(key,current)
  const {signal} = current.controller
  statuses[key] = {status:'正在加载'}
  const fail = (message:string) => {
    if (!signal.aborted) statuses[key] = {status:message, error:true}
  }
  try {
    const layer = option.group === '空间数据'
      ? await createDatasetReference(option.source,color,signal)
      : await createServiceReferenceLayer(option.source,color,signal,fail)
    const setting = context.selected.value.find(s => s.key === key)
    if (signal.aborted || !setting) { layer.dispose(); return }
    current.layer = layer
    display(layer,setting)
    // Raster imagery sits below reference features. Draw and Modify use only the editor's own vector source.
    layer.setZIndex(layer instanceof VectorLayer ? 2 : 1)
    props.group.getLayers().push(layer)
    if (!statuses[key]?.error) statuses[key] = {status:'已加载'}
  } catch (err) {
    fail(err instanceof Error ? err.message : '图层加载失败')
  }
}
function reconcile() {
  const keys = new Set(chosen.value.map(({option}) => option.key))
  for (const key of loaded.keys()) if (!keys.has(key)) unload(key)
  for (const {setting,option} of chosen.value) {
    const current = loaded.get(option.key)
    if (current?.source !== option.source) {
      unload(option.key)
      void load(option, setting.color)
    } else if (current.layer) display(current.layer,setting)
  }
}
function retry(key:string) {
  unload(key)
  reconcile()
}
watch(chosen, reconcile, {immediate:true})
onBeforeUnmount(() => { for (const key of loaded.keys()) unload(key) })
</script>
<template>
  <EditorReferencePanel :options="options" :layers="rows" @add="add" @remove="remove" @retry="retry"
    @visibility="(key, visible) => update(key, {visible})"
    @opacity="(key, opacity) => update(key, {opacity})" />
</template>
