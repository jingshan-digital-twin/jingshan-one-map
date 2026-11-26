<script setup lang="ts">
import { catalogTypes } from './portal-catalog'
import { computed, ref } from 'vue'
import {
  validatePortalCatalog,
  type CatalogFolder,
  type CatalogAsset,
  type PortalCatalog,
} from './portal-catalog'
const props = defineProps<{ catalog?: PortalCatalog; assets: CatalogAsset[]; initial?: string; inline?: boolean }>()
const emit = defineEmits<{ apply: [PortalCatalog]; close: [] }>()
const folders = ref<CatalogFolder[]>(JSON.parse(JSON.stringify(props.catalog?.folders ?? [])))
const id = ref(props.initial ?? ''),
  terms = ref(''),
  error = ref('')
const folder = computed(() => folders.value.find((f) => f.id === id.value))
const matches = computed(() =>
  props.assets.filter((a) => (a.name + ' ' + a.format + ' ' + catalogTypes[a.type]).includes(terms.value.trim())),
)
function add() {
  const item = {
    id: 'folder-' + Array.from(crypto.getRandomValues(new Uint32Array(3)), (v) => v.toString(36)).join(''),
    name: '新专题',
    parent: '',
    resources: [],
  }
  folders.value.push(item)
  id.value = item.id
}
function remove() {
  const current = folder.value
  if (!current) return
  folders.value = folders.value.filter((f) => f !== current)
  for (const f of folders.value) if (f.parent === current.id) f.parent = current.parent
  id.value = folders.value[0]?.id ?? ''
}
function move(step: number) {
  const i = folders.value.findIndex((f) => f.id === id.value)
  if (i < 0 || i + step < 0 || i + step >= folders.value.length) return
  const [f] = folders.value.splice(i, 1)
  folders.value.splice(i + step, 0, f)
}
function mountEditor(el: unknown) {
  if (!props.inline && el instanceof HTMLDialogElement && !el.open) el.showModal()
}
function apply() {
  try {
    const value = { folders: folders.value }
    validatePortalCatalog(value)
    emit('apply', value)
    emit('close')
  } catch (e) {
    error.value = (e as Error).message
  }
}
if (!id.value) id.value = folders.value[0]?.id ?? ''
</script>
<template>
  <component
    :is="inline ? 'section' : 'dialog'"
    class="platform-dialog catalog-editor"
    :class="{ 'wkc-inline-editor': inline }"
    :ref="mountEditor"
    @cancel.prevent="emit('close')"
  >
    <header v-if="!inline">
      <h2>编排专题目录</h2>
      <button @click="emit('close')" aria-label="关闭">×</button>
    </header>
    <div class="edit-workspace">
      <aside>
        <h3 v-if="inline">目录树</h3>
        <button @click="add">＋ 新建专题</button
        ><button v-for="f in folders" :key="f.id" :class="{ picked: id === f.id }" @click="id = f.id">
          {{ f.name }}
        </button>
      </aside>
      <div v-if="folder" class="edit-folder">
        <div v-if="inline" class="wkc-edit-intro">
          <img src="/jingshan/workspace/court.webp" alt="" />
          <div><small>专题目录草稿</small><h3>{{ folder.name }}</h3></div>
        </div>
        <label>专题名称<input v-model.trim="folder.name" maxlength="60" /></label
        ><label
          >上级目录<select v-model="folder.parent">
            <option value="">根目录</option>
            <option v-for="f in folders.filter((v) => v.id !== id)" :key="f.id" :value="f.id">
              {{ f.name }}
            </option>
          </select></label
        >
        <label
          >发布后目录可见范围<select
            :value="folder.workspaceOnly ? 'workspace' : 'all'"
            @change="folder.workspaceOnly = ($event.target as HTMLSelectElement).value === 'workspace'"
          >
            <option value="all">工作区及驾驶舱访客</option>
            <option value="workspace">仅工作区成员</option>
          </select></label
        >
        <div class="folder-order">
          <button @click="move(-1)">上移</button><button @click="move(1)">下移</button
          ><button @click="remove">移除专题</button>
        </div>
        <label
          >纳入资源（{{ folder.resources.length }}）<input
            type="search"
            v-model="terms"
            placeholder="搜索资源名称"
        /></label>
        <div class="folder-resources">
          <label v-for="a in matches" :key="a.key"
            ><input type="checkbox" v-model="folder.resources" :value="a.key" />{{ a.name }} · {{ catalogTypes[a.type] }}</label
          >
        </div>
      </div>
      <p v-else>新建专题后即可选择资源。</p>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <footer>
      <button @click="emit('close')">取消</button><button class="primary" @click="apply">应用到草稿</button>
    </footer>
  </component>
</template>
