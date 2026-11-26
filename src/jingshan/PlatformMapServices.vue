<script setup lang="ts">
import { workspaceEdition, workspaceArtwork } from './workspace-artwork'
import { computed, onMounted, ref, watch } from 'vue'
import PlatformSelectionBar from './PlatformSelectionBar.vue'
import { useTableSelection } from './platform-selection'
import { draftServices } from './resource-removal.ts'
import { api, jsonRequest } from './api.ts'
import { cimProtocols as kinds, defaultRasterConfig, isRasterService, type CimAdminService, type CimKind, type CimRasterConfig, type GatewayStatus, type CimStatus } from './cim-types.ts'
import { cimBoundaryBindings, cimDatasetBindings } from './cim-datasets.ts'
import type { DataDocument, DataWorkspace } from './types.ts'
import { platformLink } from './platform-navigation'
import PlatformHostedLayers from './PlatformHostedLayers.vue'
import PlatformServiceUsage from './PlatformServiceUsage.vue'

const props = defineProps<{ revision: number; draftChanged: boolean; initialId?: string; published?:DataDocument; draft?:DataDocument; registry:CimAdminService[] }>()
const section=ref<'instances'|'hosted'>('instances')
const emit = defineEmits<{ batch:[services:CimAdminService[]]; remove:[service:CimAdminService]; changed: []; synced: [workspace: DataWorkspace, datasetId: string, message: string]; reloadDraft: []}>()
type ServiceFields = Pick<CimAdminService, 'name'|'url'|'category'|'kind'|'layer'|'version'|'enabled'|'defaultVisible'|'sortOrder'|'description'> & { raster: CimRasterConfig }
const base = '/cim/admin/services'
const versions: Record<CimKind,string[]> = { wms:['1.1.1','1.3.0'], wfs:['1.0.0','1.1.0','2.0.0'], geojson:[], arcgis:[], xyz:[], wmts:['1.0.0'], '3dtiles':[] }
const statusNames: Record<CimStatus,string> = { unchecked:'未检查', online:'可访问', offline:'无法连接', auth:'需要授权', invalid:'响应异常' }
const services = ref<CimAdminService[]>([])
const gateway=ref<GatewayStatus>()
const filter = ref('')
const category = ref('')
const kindFilter = ref('')
const page = ref(1)
const pageSize = 12
const busy = ref('')
const message = ref('')
const error = ref('')
const locationError = ref('')
const editor = ref<ServiceFields>()
const editing = ref<CimAdminService>()
const visibleServices = computed(()=>draftServices(services.value,props.draft))
watch(()=>props.registry, rows=>{services.value=[...rows]})
const syncing = ref<CimAdminService>()
const details = ref<CimAdminService>()
const editorError = ref('')
type SourcePage = {features:{id:string;properties:Record<string,unknown>}[]; total:number|null; page:number;pageSize:number;hasNext:boolean}
const detailTab=ref<'info'|'records'>('info')
const records=ref<SourcePage>()
const recordsBusy=ref(false)
const recordsError=ref('')
const requestedPage=ref(1)
let recordsRequest=0
const categories = computed(() => [...new Set(visibleServices.value.map(row => row.category))].sort((a,b) => a.localeCompare(b,'zh-CN')))
const filtered = computed(() => {
  const keyword = filter.value.trim().toLowerCase()
  return visibleServices.value.filter(row => (!category.value || row.category === category.value) && (!kindFilter.value || row.kind === kindFilter.value)
    && [row.name,row.category,row.layer,kinds[row.kind]].some(text => text.toLowerCase().includes(keyword)))
    .sort((a,b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name,'zh-CN'))
})
const enabledCount = computed(() => visibleServices.value.filter(row => row.enabled).length)
const selection=useTableSelection(computed(()=>filtered.value.map(s=>s.id)),[category,filter,kindFilter,section])
const pageCount = computed(() => Math.max(1,Math.ceil(filtered.value.length / pageSize)))
const rows = computed(() => filtered.value.slice((page.value - 1) * pageSize,page.value * pageSize))
watch([filter,category,kindFilter], () => { page.value = 1 }, {flush:'sync'})
watch(pageCount, count => { page.value = Math.min(page.value,count) })
function selectInitial(id: string | undefined) {
  if (busy.value === 'load') return
  details.value = undefined
  editor.value = undefined
  syncing.value = undefined
  locationError.value = ''
  if (!id) return
  if(id.startsWith('dataset:')){section.value='hosted';return}
  section.value='instances'
  const row = visibleServices.value.find(item => item.id === id)
  if (!row) {
    if (!error.value) locationError.value = '指定的地图服务已移除或尚未登记。'
    return
  }
  feedback()
  filter.value = ''; category.value = ''; kindFilter.value = ''
  page.value = Math.floor(filtered.value.indexOf(row) / pageSize) + 1
  openDetails(row)
}
watch(() => props.initialId, selectInitial)
function syncTarget(row:CimAdminService) {
  const bindings:Readonly<Record<string,{id:string;name:string}>> = row.kind==='wfs' ? cimDatasetBindings : row.kind==='wms' ? cimBoundaryBindings : {}
  return Object.hasOwn(bindings,row.id) ? bindings[row.id] : undefined
}
function failed(e:unknown) { return e instanceof Error ? e.message : String(e) }
function feedback() { error.value=''; locationError.value=''; message.value=''; editorError.value='' }
async function load() {
  busy.value='load'
  feedback()
  try {
    const catalog=await api<{services:CimAdminService[];gateway?:GatewayStatus}>(base)
    services.value=catalog.services
    gateway.value=catalog.gateway
  }
  catch (e) { error.value=failed(e) }
  finally { busy.value='' }
}
async function checkGateway() {
  if(busy.value)return
  busy.value='gateway'
  feedback()
  try {
    gateway.value=await api<GatewayStatus>('/cim/admin/jingmen-map/check',jsonRequest('POST',{}))
    emit('changed')
  }
  catch(e){error.value=failed(e)}
  finally {busy.value=''}
}
function replace(service:CimAdminService) {
  const index = services.value.findIndex(item => item.id === service.id)
  if (index < 0) services.value.push(service)
  else services.value[index]=service
  if (details.value?.id===service.id) details.value=service
}
function openDetails(service:CimAdminService) {
  details.value=service
  detailTab.value='info'
  records.value=undefined
  recordsError.value=''
  recordsBusy.value=false
  recordsRequest++
}
function openRecords(service:CimAdminService) {
  openDetails(service)
  void loadRecords(1)
}
async function loadRecords(page:number) {
  const service=details.value
  if (!service?.supportsRecords || page<1) return
  detailTab.value='records'
  if (recordsBusy.value) return
  requestedPage.value=page
  const request=++recordsRequest
  recordsBusy.value=true
  recordsError.value=''
  try {
    const value=await api<SourcePage>(base+'/'+encodeURIComponent(service.id)+'/records?page='+page)
    if (request===recordsRequest && details.value?.id===service.id) records.value=value
  } catch(e) { if(request===recordsRequest) recordsError.value=failed(e) }
  finally { if(request===recordsRequest) recordsBusy.value=false }
}
function recordTitle(record:SourcePage['features'][number]) {
  for(const key of ['gcmc','gymc','bjmc','sqjcwhmc','wgmc','dlmc','xzqmc','name','mc']) {
    const name=record.properties[key]
    if(typeof name==='string' && name.trim()) return name
  }
  return record.id
}
function propertyText(value:unknown) {
  if (value===null || value==='') return '（空）'
  return typeof value==='object' ? JSON.stringify(value) : String(value)
}
function openEditor(row?:CimAdminService) {
  feedback()
  details.value=undefined
  editing.value=row
  editor.value=row ? { name:row.name, url:row.url, category:row.category, kind:row.kind, layer:row.layer,
    version:row.version, enabled:row.enabled, defaultVisible:row.defaultVisible, sortOrder:row.sortOrder, description:row.description,
    raster:{ ...(row.raster ?? defaultRasterConfig) } }
    : { name:'', url:'', category:category.value || '', kind:'wms', layer:'', version:versions.wms[0], raster:{ ...defaultRasterConfig },
      enabled:true, defaultVisible:false, sortOrder:Math.max(0,...services.value.map(item => item.sortOrder))+1, description:'' }
}
function selectKind() {
  if (!editor.value) return
  editor.value.version=versions[editor.value.kind][0] || ''
  if (!editor.value.version) editor.value.layer=''
}
async function save() {
  if (!editor.value || busy.value) return
  busy.value='save'
  feedback()
  try {
    const current=editing.value
    const value=await api<CimAdminService>(current ? base+'/'+encodeURIComponent(current.id) : base,
      jsonRequest(current ? 'PUT':'POST',{...editor.value, revision:current?.revision}))
    replace(value)
    editor.value=undefined
    filter.value=''
    if (category.value && category.value !== value.category) category.value=''
    if (kindFilter.value && kindFilter.value !== value.kind) kindFilter.value=''
    page.value = Math.floor(filtered.value.findIndex(row => row.id === value.id) / pageSize) + 1
    message.value='已保存「'+value.name+'」的服务配置'
    emit('changed')
  } catch (e) { editorError.value=failed(e) }
  finally { busy.value='' }
}
async function check(row:CimAdminService) {
  if (busy.value) return
  busy.value='check:'+row.id
  feedback()
  try {
    const checked=await api<CimAdminService>(base+'/'+encodeURIComponent(row.id)+'/check',jsonRequest('POST',{}))
    replace(checked)
    message.value=checked.name+' · '+statusNames[checked.status]+(checked.statusMessage ? ' · '+checked.statusMessage : '')
    emit('changed')
  } catch (e) { error.value=failed(e) }
  finally { busy.value='' }
}
function removeService(row:CimAdminService) {
  details.value=undefined
  editor.value=undefined
  emit('remove',row)
}
function openSync(row:CimAdminService) {
  feedback()
  if (props.draftChanged) { error.value='业务数据有未保存的修改，请先在业务数据页保存草稿，再同步服务。'; return }
  syncing.value=row
}
async function sync() {
  const row=syncing.value
  if (!row || busy.value) return
  busy.value='sync:'+row.id
  feedback()
  try {
    const result=await api<{workspace:DataWorkspace;datasetId:string;count:number}>('/cim/sync/'+encodeURIComponent(row.id),jsonRequest('POST',{revision:props.revision}))
    message.value='已将「'+row.name+'」的 '+result.count+' 条记录保存到业务数据草稿'
    emit('synced',result.workspace,result.datasetId,message.value)
    syncing.value=undefined
  } catch (e) { editorError.value=failed(e) }
  finally { busy.value='' }
}
onMounted(async () => { await load(); selectInitial(props.initialId) })
</script>

<template>
  <section class="service-admin data-table" aria-label="图层服务管理">
    <header v-if="workspaceEdition && section==='instances'" class="workspace-service-hero"><div><span>服务资源管理</span><h1>地图服务</h1></div>
      <dl><div><dt>登记服务</dt><dd>{{visibleServices.length}}</dd></div><div><dt>已启用</dt><dd>{{enabledCount}}</dd></div><div><dt>服务协议</dt><dd>{{new Set(visibleServices.map(s=>s.kind)).size}}</dd></div></dl>
    </header>
    <nav class="service-tabs" aria-label="服务发布管理">
      <button type="button" :aria-current="section==='instances'" @click="section='instances'">已登记服务</button>
      <button v-if="published" type="button" :aria-current="section==='hosted'" @click="section='hosted'">从数据集发布</button>
      <button type="button" :disabled="!!busy" @click="section='instances';openEditor()">接入外部服务</button>
    </nav>
    <PlatformHostedLayers v-if="section==='hosted' && published" :published="published" :draft="draft" :services="services" :initial-dataset="initialId?.startsWith('dataset:') ? initialId.slice(8) : undefined" @registered="service=>{replace(service);emit('changed')}"/>
    <template v-else>
    <div class="service-head">
      <div><h3>{{workspaceEdition ? '已登记服务' : '地图服务目录'}}</h3><p v-if="!workspaceEdition">{{ visibleServices.length }} 个服务 · 已启用 {{ enabledCount }} 个</p></div>
      <div class="modal-actions"><button type="button" :disabled="!!busy" @click="load">刷新列表</button>
      </div>
    </div>
    <section v-if="gateway" class="gateway-connection" aria-label="市大数据能力平台接口">
      <div><strong>{{ gateway.resource }}</strong><small>市大数据能力平台 · {{ gateway.resourceId }} · WMTS 影像</small></div>
      <div role="status"><span class="status-dot" :data-status="gateway.status"></span>{{ statusNames[gateway.status] }}
        <small v-if="gateway.checkedAt">{{ gateway.statusMessage }} · {{ new Date(gateway.checkedAt).toLocaleString('zh-CN') }}</small></div>
      <div class="modal-actions"><button type="button" :disabled="!!busy" @click="checkGateway">{{ busy==='gateway'?'正在调用…':'复测接口' }}</button>
        <a v-if="gateway.status==='online'" href="/" target="_blank" rel="noopener">打开驾驶舱</a></div>
    </section>
    <div class="service-filters">
      <input v-model="filter" type="search" aria-label="搜索图层服务" placeholder="搜索服务名称、图层或分类" />
      <select v-model="category" aria-label="按分类筛选"><option value="">全部分类</option><option v-for="c in categories" :key="c">{{ c }}</option></select>
      <select v-model="kindFilter" aria-label="按协议筛选"><option value="">全部协议</option><option v-for="(label,value) in kinds" :key="value" :value="value">{{ label }}</option></select>
    </div>
    <p v-if="error || locationError" class="message error" role="alert">{{ error || locationError }}</p>
    <p v-if="message" class="message success" role="status">{{ message }}</p>
    <PlatformSelectionBar :total="filtered.length" :selected="selection.selected.value.length" label="服务资源" @all="selection.toggleAll" @clear="selection.clear"><button :disabled="!selection.selected.value.length" @click="emit('batch',filtered.filter(s=>selection.checked.value.has(s.id)))">下线所选服务</button></PlatformSelectionBar>
    <div class="table-scroll service-scroll"><table aria-label="已登记的图层服务"><thead><tr><th>选择</th><th>服务名称</th><th>分类 / 协议</th><th>地图显示</th><th>连接状态</th><th>顺序</th><th>操作</th></tr></thead>
      <tbody><tr v-for="row in rows" :key="row.id"><td><input type="checkbox" :aria-label="'选择服务'+row.name" :checked="selection.checked.value.has(row.id)" @change="selection.toggle(row.id)"/></td>
        <td><button type="button" class="service-name" @click="openDetails(row)">{{ row.name }}</button><small>{{ row.hostedDatasetId ? '本地发布' : '外部接入' }} · {{ row.layer || row.id }}</small></td>
        <td data-label="分类 / 协议">{{ row.category }}<small>{{ kinds[row.kind] }}</small></td>
        <td data-label="地图显示">{{ row.enabled ? (row.defaultVisible ? '默认显示' : '按需显示') : '已停用' }}</td>
        <td data-label="连接状态"><span class="status-dot" :data-status="row.status"></span>{{ statusNames[row.status] }}<small v-if="row.checkedAt">{{ new Date(row.checkedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) }}</small></td>
        <td data-label="顺序">{{ row.sortOrder }}</td>
        <td class="service-actions"><button type="button" :disabled="!!busy" @click="openEditor(row)">编辑</button><button v-if="row.supportsRecords" type="button" @click="openRecords(row)">源记录</button><button type="button" :disabled="!!busy" @click="check(row)">{{ busy==='check:'+row.id ? '检查中…' : '检查连接' }}</button>
          <a :href="'#preview/'+encodeURIComponent('service:'+row.id)">地图预览</a>
          <button v-if="syncTarget(row)" type="button" :disabled="!!busy || !row.enabled" :title="row.enabled ? undefined : '启用服务后可同步'" @click="openSync(row)">同步到草稿</button>
          <button type="button" class="remove-service" :disabled="!!busy" @click="removeService(row)">下线服务</button></td>
      </tr><tr v-if="!filtered.length"><td colspan="6">{{ busy==='load' ? '正在读取图层服务…' : error ? '未能读取服务，请刷新重试。' : '没有匹配的图层服务' }}</td></tr></tbody>
    </table></div>
    <nav v-if="filtered.length" class="pagination" aria-label="服务目录分页"><span>共 {{ filtered.length }} 项</span>
      <button type="button" :disabled="page <= 1" @click="page--">上一页</button>
      <span>{{ page }} / {{ pageCount }}</span><button type="button" :disabled="page >= pageCount" @click="page++">下一页</button></nav>
    </template>
    <div v-if="editor || details || syncing" class="admin-overlay">
      <form v-if="editor" class="admin-form modal-box" role="dialog" aria-modal="true" aria-label="配置图层服务" @submit.prevent="save">
        <aside v-if="workspaceEdition" class="workspace-protocol-card"><img :src="workspaceArtwork('山地')" alt=""><h4>服务协议</h4><ul><li v-for="(name,key) in kinds" :key="key" :class="{active:editor.kind===key}">{{name}}</li></ul></aside>
        <h3>{{ editing ? '编辑图层服务' : workspaceEdition ? '接入外部服务' : '新增图层服务' }}</h3>
        <p v-if="editorError" class="message error" role="alert">{{ editorError }}</p>
        <div class="form-grid"><label>服务名称<input v-model.trim="editor.name" required /></label><label>分类<input v-model.trim="editor.category" list="service-categories" required /></label></div>
        <datalist id="service-categories"><option v-for="c in categories" :key="c" :value="c"></option></datalist>
        <div class="form-grid"><label>服务协议<select v-model="editor.kind" :disabled="!!editing?.hostedDatasetId" @change="selectKind"><option v-for="(label,value) in kinds" :key="value" :value="value">{{ label }}</option></select></label>
          <label v-if="versions[editor.kind].length">协议版本<select v-model="editor.version"><option v-for="version in versions[editor.kind]" :key="version">{{ version }}</option></select></label>
          <label>显示顺序<input v-model.number="editor.sortOrder" type="number" step="1" min="-1000000" max="1000000" required /></label></div>
        <label>服务地址<input v-model.trim="editor.url" :readonly="!!editing?.hostedDatasetId" :type="editor.kind==='3dtiles' || editing?.hostedDatasetId ? 'text' : 'url'" inputmode="url" :placeholder="editor.kind==='xyz' ? 'https://host/tiles/{z}/{x}/{y}.png' : editor.kind==='3dtiles' ? 'https://host/model/tileset.json' : editor.kind==='arcgis' ? 'https://host/arcgis/rest/services/name/FeatureServer/0' : editor.kind==='geojson' ? 'https://host/data/venues.geojson' : 'https://…'" required /></label>
        <small v-if="editor.kind==='arcgis'">填写单个空间图层地址。图层须支持 Query 查询、数字对象编号和 GeoJSON 输出。</small>
        <small v-if="editor.kind==='geojson'">填写 WGS84 经纬度 GeoJSON 要素集合地址。</small>
        <p v-if="editor.kind==='3dtiles'" class="protocol-note">本机模型可填写 /api/jingshan/cim/local-tiles/模型标识/tileset.json。</p>
        <p v-if="editor.kind==='xyz'" class="protocol-note">填入图块地址模板，使用 {z}、{x}、{y}。从南向北编号的 TMS 图块可使用 {-y}。</p>
        <p v-if="editor.kind==='wmts'" class="protocol-note">使用支持 GetTile 的 KVP 服务地址，矩阵参数可在该服务的 GetCapabilities 文档中查看。</p>
        <label v-if="versions[editor.kind].length">图层标识<input v-model.trim="editor.layer" placeholder="例如 workspace:layer" required /></label>
        <div v-if="isRasterService(editor.kind)" class="form-grid">
          <label>瓦片坐标系<select v-model="editor.raster.projection"><option value="EPSG:3857">Web Mercator（3857）</option><option value="EPSG:4326">经纬度（4326，根级 2 × 1）</option></select></label>
          <label>最大级别<input v-model.number="editor.raster.maxLevel" type="number" min="0" max="24" step="1" required /></label>
        </div>
        <template v-if="editor.kind==='wmts'">
          <div class="form-grid"><label>矩阵集标识<input v-model.trim="editor.raster.matrixSet" required /></label>
            <label>矩阵级别前缀<input v-model.trim="editor.raster.matrixPrefix" placeholder="例如 EPSG:3857: 或留空" /></label></div>
          <div class="form-grid"><label>矩阵级别偏移<input v-model.number="editor.raster.matrixOffset" type="number" min="-24" max="24" step="1" required /></label>
            <label>瓦片格式<select v-model="editor.raster.format"><option>image/png</option><option>image/jpeg</option><option>image/webp</option></select></label>
            <label>样式标识<input v-model.trim="editor.raster.style" placeholder="default" /></label></div>
        </template>
        <label>说明<textarea v-model.trim="editor.description" rows="2"></textarea></label>
        <div class="service-switches"><label class="checkbox"><input v-model="editor.enabled" type="checkbox" />在地图目录中启用</label>
          <label class="checkbox"><input v-model="editor.defaultVisible" type="checkbox" :disabled="!editor.enabled" />进入地图时默认显示</label></div>
        <PlatformServiceUsage v-if="editing && !editor.enabled" :service-id="editing.id" :published="published" :draft="draft" changing/>
        <div class="modal-actions">
          <button v-if="editing" type="button" class="remove-service" :disabled="!!busy" @click="removeService(editing)">下线服务</button>
          <button type="button" :disabled="!!busy" @click="editor=undefined">取消</button><button type="submit" class="primary" :disabled="!!busy">{{ busy==='save' ? '正在保存…' : '保存服务' }}</button></div>
      </form>
      <section v-else-if="details" class="admin-form modal-box service-details-dialog" role="dialog" aria-modal="true" :aria-label="details.name">
        <h3>{{ details.name }}</h3>
        <nav v-if="details.supportsRecords" class="segments record-tabs" aria-label="服务详情">
          <button type="button" :class="{on:detailTab==='info'}" @click="detailTab='info'">服务信息</button>
          <button type="button" :class="{on:detailTab==='records'}" @click="records ? detailTab='records' : loadRecords(1)">源记录</button>
        </nav>
        <dl v-if="detailTab==='info'" class="service-detail"><dt>分类 / 协议</dt><dd>{{ details.category }} · {{ kinds[details.kind] }} {{ details.version }}</dd>
          <dt>服务地址</dt><dd><a v-if="details.hostedDatasetId" :href="details.mapUrl" target="_blank" rel="noopener">{{details.mapUrl}}</a><template v-else>{{details.url}}</template></dd><template v-if="details.hostedDatasetId"><dt>源数据集</dt><dd><a :href="platformLink('local',details.hostedDatasetId)">{{ (draft ?? published)?.datasets.find(d=>d.id===details?.hostedDatasetId)?.name ?? details.hostedDatasetId }}</a></dd></template><template v-if="details.layer"><dt>图层标识</dt><dd>{{ details.layer }}</dd></template>
          <template v-if="details.raster">
            <dt>瓦片坐标系</dt><dd>{{ details.raster.projection }} · 0–{{ details.raster.maxLevel }} 级</dd>
            <template v-if="details.kind==='wmts'"><dt>矩阵集</dt><dd>{{ details.raster.matrixSet }} · {{ details.raster.format }}</dd></template>
          </template>
          <dt>来源</dt><dd>{{ details.sourceRow ? (details.sourceSheet || '服务清单')+' · 第 '+details.sourceRow+' 行' : '后台登记' }}</dd>
          <dt>上次检查</dt><dd>{{ details.checkedAt ? new Date(details.checkedAt).toLocaleString('zh-CN') : '尚未检查' }}</dd>
          <dt>连接状态</dt><dd>{{ statusNames[details.status] }} {{ details.statusMessage }}</dd>
          <template v-if="details.description"><dt>说明</dt><dd>{{ details.description }}</dd></template>
        </dl>
        <template v-else>
          <p v-if="recordsError" class="message error" role="alert">{{ recordsError }} <button type="button" :disabled="recordsBusy" @click="loadRecords(requestedPage)">重试</button></p>
          <p v-if="recordsBusy" class="message" role="status">正在读取源记录…</p>
          <div v-if="records" class="source-list" :aria-busy="recordsBusy">
            <details v-for="(record,i) in records.features" :key="records.page+'-'+record.id+'-'+i" class="source-entry">
              <summary>{{ recordTitle(record) }} <small v-if="recordTitle(record)!==record.id">{{ record.id }}</small></summary>
              <dl class="service-detail source-fields"><template v-for="(value,key) in record.properties" :key="key"><dt>{{ key }}</dt><dd>{{ propertyText(value) }}</dd></template></dl>
            </details>
            <p v-if="!records.features.length">该页暂无源记录</p>
          </div>
          <div v-if="records" class="pagination"><span>{{ records.total===null ? '每页 '+records.pageSize+' 条' : '共 '+records.total+' 条' }}</span>
            <button type="button" :disabled="recordsBusy || records.page<=1" @click="loadRecords(records.page-1)">上一页</button>
            <span>第 {{ records.page }} 页</span><button type="button" :disabled="recordsBusy || !records.hasNext" @click="loadRecords(records.page+1)">下一页</button></div>
        </template>
        <PlatformServiceUsage v-if="detailTab==='info'" :service-id="details.id" :published="published" :draft="draft"/>
        <div class="modal-actions"><button type="button" class="remove-service" @click="removeService(details)">下线服务</button><a :href="'#preview/'+encodeURIComponent('service:'+details.id)">地图预览</a><button type="button" @click="details=undefined">关闭</button><button type="button" class="primary" @click="openEditor(details)">编辑配置</button></div>
      </section>
      <section v-else class="admin-form modal-box" role="dialog" aria-modal="true" aria-label="同步业务数据">
        <h3>同步业务数据</h3>
        <template v-if="syncing"><p v-if="syncTarget(syncing)?.id==='administration'">从县级、乡镇级行政区划服务共同读取京山市和各镇街的边界，替换「{{ syncTarget(syncing)?.name }}」当前的草稿记录。发布后生效。</p>
          <p v-else-if="syncing.kind==='wms'">从「{{ syncing.name }}」读取村、社区边界，更新「{{ syncTarget(syncing)?.name }}」草稿。发布后生效。</p>
          <p v-else>从「{{ syncing.name }}」更新「{{ syncTarget(syncing)?.name }}」的机构记录和源属性，替换该服务对应的演示记录。发布后生效。</p></template>
        <p v-if="editorError" class="message error" role="alert">{{ editorError }}</p>
        <div class="modal-actions"><button v-if="syncing && editorError.includes('草稿已更新')" type="button" :disabled="!!busy" @click="syncing=undefined; emit('reloadDraft')">重新读取草稿</button>
          <button type="button" :disabled="!!busy" @click="syncing=undefined">取消</button>
          <button type="button" class="primary" :disabled="!!busy" @click="sync">{{ busy ? '处理中…' : '同步到草稿' }}</button></div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.service-tabs{display:flex;align-items:center;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--platform-line);padding-bottom:12px}.service-tabs button[aria-current=true]{color:var(--platform-accent);border-color:var(--platform-accent);background:var(--platform-soft)}.service-tabs button:last-child{margin-left:auto}
.service-admin { flex: 1; overflow: hidden; }
.service-head, .service-switches { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.gateway-connection { display:flex; align-items:center; flex-wrap:wrap; justify-content:space-between; gap:8px 16px; padding:10px 12px; border:1px solid var(--v14-list-line,#7fabc8); }
.gateway-connection small { display:block; color:var(--muted); }
.service-head h3 { font-size:1.2em; color:var(--ink); }
.service-head p { margin-top:4px; color:var(--muted); font-size:.88em; }
.protocol-note { margin: 0; color: var(--platform-muted,var(--muted)); font-size: .9em; }
.service-filters { display:grid; grid-template-columns:minmax(140px,2fr) repeat(2,minmax(88px,1fr)); gap:8px; }
.service-scroll table { min-width:650px; }
.service-scroll td { vertical-align:middle; }
.service-scroll td:first-child { width:24%; }
.service-admin .service-scroll td button.service-name { padding:0; border:0; background:none; box-shadow:none; color:var(--ink); font-weight:700; text-align:left; }
.service-scroll .service-name:hover { text-decoration:underline; }
.service-actions button { margin:2px 5px 2px 0; padding:4px 8px; font-size:.88em; white-space:nowrap; }
.status-dot { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:6px; background:#8794a3; }
.status-dot[data-status=online] { background:#238d6b; }
.status-dot:is([data-status=offline],[data-status=invalid]) { background:#cc6255; }
.status-dot[data-status=auth] { background:#cc8b29; }
.service-detail { display:grid; grid-template-columns:auto minmax(0,1fr); gap:0; margin:0; }
.service-detail :is(dt,dd) { margin:0; padding:8px; border-bottom:1px solid var(--v14-edge,#395f84); overflow-wrap:anywhere; }
.service-detail dt { color:var(--muted); }
.service-details-dialog { width:min(100%,54em); }
.record-tabs { justify-content:flex-start; }
.record-tabs button { flex:0 0 auto; }
.source-list { min-height:0; max-height:52dvh; overflow:auto; border:1px solid var(--v14-list-line,#6693bc); }
.source-entry { border-bottom:1px solid var(--v14-edge,#395f84); }
.source-entry summary { padding:9px 12px; color:var(--ink); cursor:pointer; font-weight:600; overflow-wrap:anywhere; }
.source-entry summary small { color:var(--muted); font-weight:400; }
.source-fields { grid-template-columns:minmax(6em,30%) minmax(0,1fr); font-size:.88em; }
.source-fields dt { font-family:Consolas,monospace; }
.service-switches { justify-content:flex-start; flex-wrap:wrap; }
.remove-service { margin-right:auto; }
.service-admin button.primary {background:#176f72;color:#f2ffff;border-color:#318f91}
.service-admin button.primary:hover:not(:disabled) {background:#1b7477}
.service-admin .remove-service {color:var(--red)}
@media(max-width:600px) {
  .service-filters { grid-template-columns:1fr 1fr; }
  .service-filters input { grid-column:1/-1; }
  .service-scroll thead { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
  .service-scroll table, .service-scroll tbody { display:block; min-width:0; }
  .service-scroll tbody tr { display:grid; grid-template-columns:1.2fr 1fr 1.2fr .55fr; padding:9px; gap:7px; border-bottom:1px solid var(--v14-list-line,#7fabc8); }
  .service-scroll tbody td { border:0; padding:0; min-width:0; overflow-wrap:anywhere; }
  .service-scroll tbody td:first-child, .service-scroll .service-actions { grid-column:1/-1; width:auto; }
  .service-scroll td[data-label]::before { content:attr(data-label); display:block; font-size:.78em; color:var(--muted); margin-bottom:2px; }
  .service-scroll .service-actions button { min-height:30px; }
  .service-head { gap:6px; }
}
</style>
