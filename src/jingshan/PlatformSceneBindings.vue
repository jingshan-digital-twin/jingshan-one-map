<script setup lang="ts">
import { computed, defineAsyncComponent, ref, shallowRef, watch } from 'vue'
import { cimProtocols, isFeatureService, type CimAdminService } from './cim-types.ts'
import { acceptsMapService, bindingProtocolNames, mapSlots, resolveMapBindings, type MapBinding, type MapScope } from './map-bindings.ts'
import PlatformSelectionBar from './PlatformSelectionBar.vue'
import { useTableSelection } from './platform-selection'
import { groups, pages, sceneAllowsLayer } from './v3-navigation.ts'
import type { DataDocument, Dataset } from './types.ts'
const PlatformWfsSync=defineAsyncComponent(()=>import('./PlatformWfsSync.vue'))
const syncing=shallowRef<{dataset:Dataset;service:CimAdminService}>()

const props = defineProps<{document:DataDocument; services:CimAdminService[]; initialScope?:string; readOnly?:boolean}>()
const emit = defineEmits<{update:[value:DataDocument]}>()
const scope = ref<MapScope>('all')
const branch=ref('')
const query = ref('')
const onlyBound = ref(false)
const page = ref(1)
const size = 8
const scopes = [{id:'all' as MapScope,name:'全图默认'},...Object.entries(pages).map(([id,item]) => ({id:id as MapScope,name:item.label}))]
const sceneBranches:{id:string;label:string;pages:readonly MapScope[]}[]=[{id:'defaults',label:'全图默认',pages:['all']},...groups]
const slots = computed(() => mapSlots(props.document.datasets).filter(slot =>
  !slot.id.startsWith('dataset:') || sceneAllowsLayer(scope.value, slot.id.slice(8))))
const syncableSlots = computed(() => new Set(props.document.datasets.filter(d=>!d.derivedFrom).map(d=>'dataset:'+d.id)))
const bindings = computed(() => props.document.mapBindings ?? [])
const effective = computed(() => resolveMapBindings(bindings.value,scope.value))
const explicit = computed(() => new Map(bindings.value.filter(item=>item.scope===scope.value).map(item=>[item.slot,item.serviceId])))
const catalog = computed(() => new Map(props.services.map(item=>[item.id,item])))
const scopeTitle = computed(() => scopes.find(item=>item.id===scope.value)?.name)
const filtered = computed(() => slots.value.filter(item => {
  const source = catalog.value.get(effective.value.get(item.id) ?? '')
  return (!branch.value || item.group===branch.value) && (!onlyBound.value || explicit.value.has(item.id)) && [item.name,item.group,source?.name].join(' ').includes(query.value.trim())
}))
const selectedLinks=useTableSelection(computed(()=>filtered.value.filter(s=>explicit.value.has(s.id)).map(s=>s.id)),[scope,query,onlyBound,branch])
const slotTree=computed(()=>[...new Set(slots.value.map(s=>s.group))].map(group=>({group,slots:slots.value.filter(s=>s.group===group)})))
watch(()=>props.initialScope,value=>{
  scope.value=value && Object.hasOwn(pages,value)?value as MapScope:'all'
  query.value='';branch.value=''
  if(value?.startsWith('dataset:')){
    const id=value==='dataset:administration'?'townBoundaries':value==='dataset:road_network'?'roadNetwork':value
    const target=slots.value.find(s=>s.id===id)
    if(target){branch.value=target.group;query.value=target.name}
  }
},{immediate:true})
function clearBindings(){
  const ids=new Set(selectedLinks.selected.value)
  if(!ids.size || props.readOnly || !confirm('解除「'+scopeTitle.value+'」选中的 '+ids.size+' 项本级绑定？'))return
  emit('update',{...props.document,mapBindings:bindings.value.filter(b=>b.scope!==scope.value||!ids.has(b.slot))});selectedLinks.clear()
}
function selectScope(id:MapScope){scope.value=id;branch.value='';query.value='';onlyBound.value=false;page.value=1}
const pageCount = computed(() => Math.max(1,Math.ceil(filtered.value.length/size)))
const rows = computed(() => filtered.value.slice((page.value-1)*size,page.value*size))
watch([scope,query,onlyBound,branch],() => {page.value=1})
watch(pageCount,count => {page.value=Math.min(page.value,count)})

function builtin(slot:string) {
  if (slot==='basemap') return '本地参考影像'
  if (slot==='model') return '关闭默认三维模型'
  return '本地数据集'
}
function fallbackLabel(slot:string) {
  if (scope.value==='all') return '使用项目默认'
  const base = bindings.value.find(item=>item.scope==='all' && item.slot===slot)
  return '继承全图 · ' + (base?.serviceId ? catalog.value.get(base.serviceId)?.name ?? '服务已移除' : base ? builtin(slot) : '项目默认')
}
function selectValue(slot:string) {
  return explicit.value.has(slot) ? explicit.value.get(slot) ?? '@local' : ''
}
function invalidSource(slot:string) {
  const id=explicit.value.get(slot)
  if (!id) return false
  const service=catalog.value.get(id)
  return !service || !acceptsMapService(slot,service)
}
function change(slot:string,event:Event) {
  const value = (event.target as HTMLSelectElement).value
  const next = bindings.value.filter(item=>item.scope!==scope.value || item.slot!==slot)
  if (value) next.push({scope:scope.value,slot,serviceId:value==='@local' ? null : value} satisfies MapBinding)
  emit('update',{...props.document,mapBindings:next})
}
function description(slot:string) {
  if (slot==='basemap') return 'WMS / WMTS / XYZ'
  if (slot==='model') return '3D Tiles'
  return 'WMS / WFS / GeoJSON / ArcGIS / WMTS / XYZ'
}
function sync(slot:string) {
  const service=catalog.value.get(effective.value.get(slot)??'')
  const dataset=props.document.datasets.find(item=>'dataset:'+item.id===slot)
  if(service?.enabled && isFeatureService(service.kind) && dataset && !dataset.derivedFrom) syncing.value={service,dataset}
}
function choices(slot:string) {
  const kind = slot==='basemap' || slot==='model' ? slot : 'overlay'
  return bindingProtocolNames[kind].map(protocol=>({
    name:cimProtocols[protocol],items:props.services.filter(service=>service.kind===protocol && acceptsMapService(slot,service)),
  })).filter(group=>group.items.length)
}
</script>

<template>
  <div class="binding-workbench">
    <nav class="binding-scopes" aria-label="配置场景">
      <h2>一张图目录</h2>
      <details v-for="group in sceneBranches" :key="group.id" :open="group.pages.includes(scope)" class="binding-branch">
        <summary>{{group.label}}</summary>
        <div v-for="id in group.pages" :key="id" class="binding-scene">
          <button type="button" :aria-current="scope===id?'page':undefined" @click="selectScope(id)">{{id==='all'?'默认图层':pages[id].label}}</button>
          <details v-if="scope===id" :open="!!branch" class="binding-layers" aria-label="当前场景的图层"><summary>图层目录</summary>
            <button type="button" :aria-pressed="!branch" @click="branch='';query=''">全部图层</button>
            <details v-for="node in slotTree" :key="node.group" :open="branch===node.group" class="binding-layer-branch">
              <summary>{{node.group}}（{{node.slots.length}}）</summary>
              <button type="button" @click="branch=node.group;query=''">查看本类图层</button>
              <button v-for="slot in node.slots" :key="slot.id" type="button" :aria-current="query===slot.name?'page':undefined" @click="branch=node.group;query=slot.name;onlyBound=false">{{slot.name}}</button>
            </details>
          </details>
        </div>
      </details>
    </nav>
    <section class="binding-content">
      <header><div><h2>{{ scopeTitle }} · 图层来源</h2><p>服务控制地图显示，业务统计读取已发布的数据集。</p></div>
        <a :href="'/?scene='+(scope==='all'?'overview':scope)" target="_blank" rel="noopener">查看已发布地图 ↗</a>
      </header>
      <div class="binding-tools"><input v-model="query" type="search" placeholder="搜索图层或服务" aria-label="搜索图层或服务"/>
        <label><input type="checkbox" v-model="onlyBound"/>只看本级配置</label></div>
      <PlatformSelectionBar v-if="!readOnly" :selected="selectedLinks.selected.value.length" :total="filtered.filter(s=>explicit.has(s.id)).length" label="本级绑定" @all="selectedLinks.toggleAll" @clear="selectedLinks.clear"><button :disabled="!selectedLinks.selected.value.length" @click="clearBindings">解除所选绑定</button></PlatformSelectionBar>
      <div class="binding-table">
        <table>
          <thead><tr><th v-if="!readOnly">选择</th><th>数据图层</th><th>地图来源</th><th>配置范围</th></tr></thead>
          <tbody><tr v-for="item in rows" :key="item.id"><td v-if="!readOnly"><input type="checkbox" :disabled="!explicit.has(item.id)" :aria-label="'选择绑定'+item.name" :checked="selectedLinks.checked.value.has(item.id)" @change="selectedLinks.toggle(item.id)"/></td>
            <td><strong>{{ item.name }}</strong><small>{{ item.group }}</small></td>
            <td><select :disabled="readOnly" :aria-label="item.name+'的地图来源'" :value="selectValue(item.id)" @change="change(item.id,$event)">
              <option value="">{{ fallbackLabel(item.id) }}</option>
              <option value="@local">{{ builtin(item.id) }}</option>
              <option v-if="invalidSource(item.id)" :value="selectValue(item.id)" disabled>服务不可用，请重新选择</option>
              <optgroup v-for="group in choices(item.id)" :key="group.name" :label="group.name"><option v-for="service in group.items" :key="service.id" :value="service.id">{{ service.name }}</option></optgroup>
            </select><small>{{ description(item.id) }}</small></td>
            <td><span class="binding-badge" :class="{own:explicit.has(item.id)}">{{ explicit.has(item.id) ? '本级指定' : scope==='all'?'项目默认':'继承全图' }}</span>
              <button v-if="!readOnly && syncableSlots.has(item.id) && isFeatureService(catalog.get(effective.get(item.id)??'')?.kind)" :disabled="!catalog.get(effective.get(item.id)??'')?.enabled" type="button" class="sync-link" @click="sync(item.id)">同步要素</button></td>
          </tr></tbody>
        </table>
        <p v-if="!rows.length" class="binding-empty">没有符合条件的图层</p>
      </div>
      <footer><span>共 {{ filtered.length }} 个图层</span><button :disabled="page<=1" @click="page--">上一页</button><b>{{ page }} / {{ pageCount }}</b><button :disabled="page>=pageCount" @click="page++">下一页</button></footer>
    </section>
    <PlatformWfsSync v-if="syncing" v-bind="syncing" :document="document" @update="emit('update',$event)" @close="syncing=undefined"/>
  </div>
</template>

<style scoped>
.binding-branch{padding:5px 12px}.binding-branch summary{cursor:pointer;font-weight:650;color:var(--platform-ink)}.binding-branch>button{padding-left:22px;border-left:1px solid var(--platform-line)}.binding-scopes{max-height:70vh;overflow:auto}.binding-content>.platform-selection-bar{padding-inline:18px}
.binding-workbench{display:grid;grid-template-columns:minmax(210px,250px) minmax(0,1fr);gap:18px;align-items:start}
.binding-scopes,.binding-content{border:1px solid var(--platform-line);border-radius:12px;background:var(--platform-paper);overflow:hidden;min-width:0}
.binding-workbench h2{font-size:20px;margin:0}.binding-scopes h2{padding:18px}
.binding-scopes{padding:0 0 10px}.binding-scopes button{display:flex;align-items:center;justify-content:space-between;text-align:left;width:100%;padding:10px 18px;background:transparent;color:var(--platform-ink);border:0;border-left:3px solid transparent;border-radius:0}
.binding-scopes button[aria-current]{border-left-color:var(--cyan);background:var(--platform-soft);color:var(--cyan)}
.binding-scopes{overflow:auto}.binding-scene{border-left:1px solid var(--platform-line);margin:5px 0 5px 6px}.binding-layers{margin-left:14px;padding-left:4px;border-left:1px solid var(--platform-line)}.binding-layers button,.binding-layer-branch summary{font-size:14px;line-height:1.35;padding:6px 9px}.binding-layers>summary{font-size:14px;padding:6px 9px}.binding-layer-branch summary{font-weight:500}.binding-layer-branch button{padding-left:16px}
.binding-scopes small,.binding-badge{font-size:14px;padding:2px 8px;border-radius:5px;background:var(--platform-soft)}
.binding-content header,.binding-tools,.binding-content footer{padding:18px 22px;display:flex;align-items:center;gap:14px;justify-content:space-between}
.binding-content header p,.binding-content small,.binding-content footer>span{color:var(--platform-muted)}.binding-content header p{margin:4px 0 0}
.binding-content header a{color:var(--cyan);white-space:nowrap}.binding-tools{border-top:1px solid var(--platform-line);padding-block:12px;justify-content:flex-start}
.binding-tools input[type=search]{width:min(320px,55%)}.binding-tools label{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.binding-table{overflow-x:auto}.binding-table table{width:100%;border-collapse:collapse}.binding-table th,.binding-table td{padding:10px 20px;text-align:left;border-bottom:1px solid var(--platform-line)}.binding-table th{white-space:nowrap;background:var(--platform-soft)}
.binding-table td:has(input[type=checkbox]){width:1%}.binding-table td:has(strong){width:28%}.binding-table td:last-child{width:110px}.binding-table small{display:block;font-size:14px;margin-top:4px}.binding-table select{width:100%;min-width:170px;max-width:100%}
.binding-badge{white-space:nowrap;color:var(--platform-muted)}.binding-badge.own{color:var(--cyan)}.binding-empty{padding:24px;text-align:center}
.sync-link{display:block;margin-top:5px;padding:0;background:none;color:var(--cyan);border:0;white-space:nowrap}
.binding-content footer{justify-content:flex-end;padding-block:14px}.binding-content footer>span{margin-right:auto}.binding-content footer b{font-weight:500;white-space:nowrap}
@media(max-width:960px){.binding-workbench{grid-template-columns:1fr}.binding-scopes{display:flex;overflow-x:auto;padding:6px}.binding-scopes h2{display:none}.binding-scopes button{width:auto;white-space:nowrap;gap:4px}.binding-content header,.binding-tools,.binding-content footer{padding:12px}.binding-table th,.binding-table td{padding:8px}}
</style>
