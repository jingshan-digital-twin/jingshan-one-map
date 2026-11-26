<script setup lang="ts">
import { workspaceEdition, workspaceArtwork } from './workspace-artwork'
import { computed, defineAsyncComponent, nextTick, ref, shallowRef, watch } from 'vue'
import { populationRaster, populationRecordCount, rasterPage, rasterGeoJsonChunks, residentRasterUrl, matchingRasterCells, populationCellId, withPixelPopulations, withPixelPopulation } from './population-raster'
import { activeCourtSourceId, isCourtLedgerId, surveyCourtLedgerId } from './court-ledger.ts'
import PlatformSelectionBar from './PlatformSelectionBar.vue'
import { useTableSelection } from './platform-selection'
import { downloadBlob, jsonRequest } from './api'
import PlatformFeatureEditor from './PlatformFeatureEditor.vue'
const SpatialGeometryEditor = defineAsyncComponent(() => import('./SpatialGeometryEditor.vue'))
const SpatialAttributeImport = defineAsyncComponent(() => import('./SpatialAttributeImport.vue'))
import PlatformAttributeExport from './PlatformAttributeExport.vue'
import { downloadFile } from './api.ts'
import { enterpriseDirectoryId } from './chain-taxonomy.ts'
import { isPlatformFormDataset } from './platform-forms.ts'
import { geometryLabels, prepareGeoImport, removeLocalFeature, withLocalDataset } from './platform-local-data.ts'
import { readSpatialFile, type DbfEncoding } from './platform-spatial-import.ts'
import type { FeatureCollection } from 'geojson'
import type { CimAdminService } from './cim-types.ts'
import { platformLink } from './platform-navigation.ts'
import type { ImportMode } from './platform-local-data.ts'
import type { CityFeature, DataDocument, Dataset } from './types.ts'
import { acceptsPendingLocation } from './validate.ts'

const props = defineProps<{draft:DataDocument; services:CimAdminService[]; initialId?:string; canPublish?:boolean}>()
const emit = defineEmits<{ batch:[ids:string[]]; 'publish-source':[id:string]; remove:[id:string]; 'record-removed':[data:DataDocument,label:string]; update:[data:DataDocument]; 'edit-enterprise':[datasetId:string,row?:CityFeature]; editing:[value:boolean] }>()
const layers = computed(() => props.draft.datasets.filter(item => !isPlatformFormDataset(item) && !item.derivedFrom))
const selection = ref('')
const missingSelection = ref('')
const layerMenu = ref<HTMLElement>()
function scrollDatasetDirectory(event: WheelEvent) {
  if (!event.cancelable || event.ctrlKey || event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
  const page = document.scrollingElement
  if (!page) return
  const remaining = event.deltaY > 0 ? page.scrollHeight - page.clientHeight - page.scrollTop : page.scrollTop
  if (remaining < 1) return
  const pixels = event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? page.clientHeight
    : event.deltaMode === WheelEvent.DOM_DELTA_LINE ? parseFloat(getComputedStyle(page).lineHeight) || 16 : 1
  event.preventDefault()
  page.scrollBy({top: event.deltaY * pixels, behavior: 'instant'})
}
const filter = ref('')
const query = ref('')
const locationFilter = ref<'all'|'located'|'pending'>('all')
const page = ref(1)
const pageSize = ref(10)
const notice = ref('')
const active = computed(() => layers.value.find(item => item.id === selection.value))
const raster=computed(()=>populationRaster(active.value))
const totalRecords=computed(()=>active.value ? populationRecordCount(active.value) : 0)
const pixelValue=ref<number>()
const isCourtLedger = computed(() => isCourtLedgerId(active.value?.id))
function recordName(feature:CityFeature) {
  return active.value?.id===surveyCourtLedgerId ? String(feature.properties['实体名称'] ?? '') : feature.properties.name
}
const unit = computed(() => isCourtLedger.value ? '片' : raster.value ? '格' : '条')
const activeService = computed(() => props.services.find(s=>s.hostedDatasetId === active.value?.id))
const generatedLayers = computed(() => active.value ? props.draft.datasets.filter(d=>d.derivedFrom===active.value!.id) : [])
const servicePending = computed(() => activeService.value && props.draft.serviceRemovals?.some(s=>s.id===activeService.value!.id))
const filteredRecords = computed(() => !!query.value.trim() || locationFilter.value !== 'all')
const pendingLocations = computed(() => active.value?.features.filter(row => row.geometry.type === 'GeometryCollection').length ?? 0)
const directory = computed(() => {
  const key = filter.value.trim().toLowerCase()
  return layers.value.filter(item => [item.name,item.id,item.department,item.category].some(field => field.toLowerCase().includes(key)))
})
const records = computed(() => {
  if (!active.value || raster.value) return []
  const key = query.value.trim().toLowerCase()
  const rows = locationFilter.value === 'all' ? active.value.features : active.value.features.filter(row =>
    (row.geometry.type === 'GeometryCollection') === (locationFilter.value === 'pending'))
  if (!key) return rows
  return rows.filter(f=>(f.id+' '+JSON.stringify(f.properties)).toLocaleLowerCase().includes(key))
})
const manageSources=ref(false)
const sourcePick=useTableSelection(computed(()=>directory.value.map(d=>d.id)),[filter,manageSources])
const managePixels=ref(false)
const recordIds=computed(()=>{
  const grid=raster.value
  if(!grid)return records.value.map(f=>f.id)
  return managePixels.value?Array.from(matchingRasterCells(grid,query.value),cell=>populationCellId(cell.block,cell.index)):[]
})
const recordPick=useTableSelection(recordIds,[selection,query,locationFilter,managePixels])
const attributeExportScope = computed(() => {
  const ids = recordPick.selected.value
  return {
    rows: ids.length ? records.value.filter(row => recordPick.checked.value.has(row.id)) : records.value,
    rasterIds: raster.value && ids.length ? ids : undefined,
    query: query.value,
    filtered: filteredRecords.value || ids.length > 0,
  }
})
const exporting=ref(false)
async function exportSHP(dataset:Dataset){
  if(exporting.value)return
  exporting.value=true
  try{
    const ids=recordPick.checked.value
    const rows=ids.size?records.value.filter(f=>ids.has(f.id)):records.value
    const result=await fetch('/api/jingshan/platform/spatial-export.zip',jsonRequest('POST',{dataset:{...dataset,features:rows}}))
    if(!result.ok)throw Error((await result.json()).error||'SHP 导出失败')
    downloadBlob(await result.blob(),dataset.name.replace(/[<>:"/\\|?*]/g,'_')+'_SHP.zip')
  }catch(e){notice.value=message(e)}finally{exporting.value=false}
}
function removePicked(){
  const d=active.value, ids=new Set(recordPick.selected.value)
  if(!d || !ids.size || !window.confirm('从「'+d.name+'」移除选中的 '+ids.size+' 条记录？整份数据集将保留。'))return
  try{
    const data=raster.value?withPixelPopulations(d,ids,null):{...d,features:d.features.filter(f=>!ids.has(f.id))}
    const next=withLocalDataset(props.draft,data)
    recordPick.clear();emit('record-removed',next,'批量删除 '+ids.size+' 条记录')
  }catch(e){notice.value=message(e)}
}
const pixelPage=computed(()=>raster.value && rasterPage(raster.value,page.value,pageSize.value,query.value))
const matchCount=computed(()=>pixelPage.value?.total ?? records.value.length)
const pageCount = computed(() => Math.max(1,Math.ceil(matchCount.value/pageSize.value)))
const pageRows = computed(() => pixelPage.value?.rows ?? records.value.slice((page.value-1)*pageSize.value,page.value*pageSize.value))
watch(pageCount,count => { if (page.value > count) page.value = count })
watch([query,pageSize,locationFilter],() => {page.value = 1})
function select(id:string) {
  missingSelection.value=''
  managePixels.value=false
  selection.value = id; page.value = 1; query.value = ''; locationFilter.value = 'all'; notice.value = ''
}
watch([layers,() => props.initialId],([items,requested],[,previous] = [[],undefined]) => {
  if (requested && (previous !== requested || missingSelection.value === requested)) {
    const target=props.draft.datasets.find(d=>d.id===requested)
    if (target?.derivedFrom) { location.replace(platformLink('preview','dataset:'+requested)); return }
    if (target && isPlatformFormDataset(target)) { location.replace(platformLink('forms',requested)); return }
    if (target) { filter.value=''; select(target.id); return }
    select(''); missingSelection.value=requested; return
  }
  if (selection.value && !items.some(item=>item.id===selection.value)) {
    const prior=selection.value
    select(''); missingSelection.value=prior
  } else if (!selection.value && items.some(item=>item.id===missingSelection.value)) select(missingSelection.value)
  else if (!selection.value && (!missingSelection.value || previous!==requested)) select(items[0]?.id ?? '')
},{immediate:true})
watch([selection,filter,layerMenu],() => {
  const menu = layerMenu.value
  const item = menu?.querySelector('[aria-current=true]')
  if (!menu || !item) return
  const bounds = menu.getBoundingClientRect()
  const selected = item.getBoundingClientRect()
  if (selected.top < bounds.top) menu.scrollTop += selected.top - bounds.top
  else if (selected.bottom > bounds.bottom) menu.scrollTop += selected.bottom - bounds.bottom
},{flush:'post'})

type Modal = 'new-layer' | 'metadata' | 'feature' | 'import' | 'attribute-import' | 'remove-feature'
const modal = ref<Modal>()
const dialog = ref<HTMLDialogElement>()
const focusBefore = shallowRef<HTMLElement>()
const editing = shallowRef<CityFeature>()
const selectedDatasetId = ref('')
const attributeImportSource = shallowRef<Dataset>()
const venueImpact = computed(() => {
  if (modal.value!=='remove-feature' || !isCourtLedger.value || active.value?.id!==activeCourtSourceId(props.draft)) return
  const venue=String(editing.value?.properties['所属场馆'] ?? '').trim()
  if (!venue || !active.value) return
  const count=active.value.features.filter(row=>String(row.properties['所属场馆'] ?? '').trim()===venue).length
  return {name:venue,count}
})
const meta = ref({id:'',name:'',department:'',category:'',description:''})
const error = ref('')
const reading = ref(false)
const importMode = ref<ImportMode>('append')
const importFile = shallowRef<File>()
const fileName = computed(() => importFile.value?.name ?? '')
const isShapeZip = computed(() => /\.zip$/i.test(fileName.value))
const dbfEncoding = ref<DbfEncoding>('auto')
const fileData = shallowRef<unknown>()
const shapeAttributes = computed(() => {
  if (!isShapeZip.value || !fileData.value) return
  const source = fileData.value as FeatureCollection & { dbfEncodingUsed?:string }
  if (!source.dbfEncodingUsed) return
  const sample = new Map<string,string>()
  for (const row of source.features.slice(0, 8)) {
    for (const [key,value] of Object.entries(row.properties ?? {})) {
      if (!sample.get(key)) sample.set(key, value == null ? '' : String(value))
    }
  }
  return { encoding:source.dbfEncodingUsed.toUpperCase(), fields:[...sample] }
})
let readKey = 0
const preview = computed(() => {
  if (modal.value !== 'import' || fileData.value === undefined || !active.value) return
  try { return {plan:prepareGeoImport(props.draft,active.value,fileData.value,importMode.value)} }
  catch (e) { return {error:message(e)} }
})
function message(e:unknown) {return e instanceof Error ? e.message : String(e)}
const titles:Record<Modal,string> = {'new-layer':'新建空间数据集',metadata:'数据集设置',feature:'编辑空间要素',import:'导入空间文件','attribute-import':'从 Excel 批量更新属性','remove-feature':'删除此记录'}
async function open(which:Modal,row?:CityFeature) {
  if (which === 'feature' && active.value?.id === 'businesses' && active.value.source?.serviceId === enterpriseDirectoryId) {
    emit('edit-enterprise',active.value.id,row); return
  }
  focusBefore.value = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  const dataset = which === 'metadata' ? active.value : undefined
  meta.value = {id:dataset?.id ?? '',name:dataset?.name ?? '',category:dataset?.category ?? '本地空间数据',department:dataset?.department ?? '',description:dataset?.description ?? ''}
  pixelValue.value=typeof row?.properties.population==='number' ? row.properties.population : undefined
  selectedDatasetId.value=active.value?.id ?? ''
  attributeImportSource.value = which === 'attribute-import' ? active.value : undefined
  editing.value = row; error.value = ''; notice.value = ''
  fileData.value = undefined; importFile.value = undefined; dbfEncoding.value = 'auto'
  importMode.value = active.value?.id === 'court_footprints' ? 'merge' : 'append'
  modal.value = which; emit('editing',true); await nextTick(); dialog.value?.showModal()
}
function close() {
  attributeImportSource.value = undefined
  importFile.value = undefined; fileData.value = undefined
  readKey++; reading.value=false; dialog.value?.close(); modal.value = undefined; emit('editing',false)
  void nextTick(() => { if (focusBefore.value?.isConnected) focusBefore.value.focus() })
}
function applied(data:DataDocument,text:string) {
  emit('update',data); close(); notice.value = text + '，请保存草稿。'
}
function applyAttributeImport(updated:Dataset) {
  if (!active.value || active.value !== attributeImportSource.value || updated.id !== active.value.id) {
    error.value = '当前数据集已变更，请重新打开导入窗口并核对。'
    return
  }
  try {
    applied(withLocalDataset(props.draft,updated),'已批量更新「' + updated.name + '」的属性')
  } catch (e) { error.value = message(e) }
}
function saveLayer() {
  try {
    const metadata = Object.fromEntries(Object.entries(meta.value).map(([key,value]) => [key,value.trim()])) as typeof meta.value
    const isNew = modal.value === 'new-layer'
    if (isNew && props.draft.datasets.some(item => item.id === metadata.id)) throw new Error('此图层编号已经存在')
    const dataset:Dataset = {...(isNew ? undefined : active.value),features:isNew ? [] : active.value!.features,...metadata}
    if (isPlatformFormDataset(dataset)) throw new Error('该编号属于业务表单，请选择其他图层编号')
    const data = withLocalDataset(props.draft,dataset)
    filter.value = ''; select(dataset.id); applied(data,isNew ? '已新增图层' : '已更新图层信息')
  } catch(e) { error.value = message(e) }
}
function saveFeature(feature:CityFeature) {
  const dataset = active.value
  if (!dataset) return
  try {
    const features = editing.value ? dataset.features.map(item => item.id === editing.value!.id ? feature : item) : [feature,...dataset.features]
    const data = withLocalDataset(props.draft,{...dataset,features})
    if (!editing.value) {query.value=''; page.value=1}
    applied(data,editing.value ? '已更新要素' : '已新增要素')
  } catch(e) { error.value = message(e) }
}
function savePixel(){
  if(!active.value || !editing.value || pixelValue.value===undefined)return
  try{applied(withLocalDataset(props.draft,withPixelPopulation(active.value,editing.value.id,pixelValue.value)),'已更新格内人口')}
  catch(e){error.value=message(e)}
}
function remove() {
  const dataset = active.value
  const row=editing.value
  if (!dataset || !row || selectedDatasetId.value!==dataset.id) {
    error.value='当前数据集已切换，请重新选择记录。'
    return
  }
  try {
    const data=removeLocalFeature(props.draft,dataset.id,row.id)
    close()
    emit('record-removed',data,'删除'+(isCourtLedger.value ? '一片场地' : '一条记录')+'「'+row.properties.name+'」')
  } catch(e) {error.value = message(e)}
}
function removeLayer(dataset:Dataset) {
  if (modal.value) close()
  emit('remove',dataset.id)
}
function selectFile(event:Event) {
  importFile.value = (event.target as HTMLInputElement).files?.[0]
  dbfEncoding.value = 'auto'
  void readFile()
}
async function readFile() {
  const file = importFile.value
  const key = ++readKey
  fileData.value = undefined; error.value = ''; reading.value = Boolean(file)
  if (!file) return
  try {
    const data = await readSpatialFile(file,active.value?.id,dbfEncoding.value)
    if (key === readKey) fileData.value = data
  } catch(e) { if (key === readKey) error.value = e instanceof SyntaxError ? '文件内容不是有效的 JSON' : message(e) }
  finally { if (key === readKey) reading.value = false }
}
function acceptImport() {
  const plan = preview.value?.plan
  if (!plan) return
  query.value=''; page.value=1
  applied(plan.data,'已导入 ' + fileName.value + '（新增 ' + plan.added + '、更新 ' + plan.updated + '、移除 ' + plan.removed + '）')
}
function exportLayer(dataset:Dataset) {
  const grid=populationRaster(dataset)
  if(grid){
    const blob=new Blob([...rasterGeoJsonChunks(grid,dataset.name,query.value,recordPick.selected.value.length?recordPick.checked.value:undefined)],{type:'application/geo+json'})
    const url=URL.createObjectURL(blob),link=document.createElement('a')
    link.href=url;link.download=dataset.id+'.geojson';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000)
    return
  }
  downloadFile(dataset.id + '.geojson',JSON.stringify({type:'FeatureCollection',name:dataset.name,features:recordPick.selected.value.length?records.value.filter(f=>recordPick.checked.value.has(f.id)):records.value}), 'application/geo+json')
}
</script>

<template>
  <div class="local-workbench">
    <aside class="local-directory" aria-label="空间源数据目录">
      <div class="local-title"><h3>源数据集</h3><span>{{ layers.length }}</span></div>
      <input v-model="filter" aria-label="查找数据集" type="search" placeholder="搜索数据集或部门">
      <button class="local-primary" type="button" @click="open('new-layer')">新建数据集</button>
      <button type="button" :aria-pressed="manageSources" @click="manageSources=!manageSources">{{manageSources?'结束多选':'批量管理数据集'}}</button>
      <PlatformSelectionBar v-if="manageSources" :total="directory.length" :selected="sourcePick.selected.value.length" label="数据集" @all="sourcePick.toggleAll" @clear="sourcePick.clear"><button :disabled="!sourcePick.selected.value.length" @click="emit('batch',sourcePick.selected.value)">删除所选数据集</button></PlatformSelectionBar>
      <div ref="layerMenu" class="local-items" @wheel="scrollDatasetDirectory">
        <div v-for="item in directory" :key="item.id" class="source-directory-row">
          <input v-if="manageSources" type="checkbox" :aria-label="'选择'+item.name" :checked="sourcePick.checked.value.has(item.id)" @change="sourcePick.toggle(item.id)">
          <button type="button" :aria-current="item.id === selection ? 'true' : undefined" @click="select(item.id)"><span>{{item.name}}<small>{{item.department}}</small></span><b>{{populationRecordCount(item).toLocaleString('zh-CN')}}</b></button>
        </div>
        <p v-if="!directory.length" class="local-help">没有匹配的数据集</p>
      </div>
    </aside>
    <section v-if="active" class="local-assets" aria-label="本地图层要素">
      <header><div class="local-dataset-heading"><img v-if="workspaceEdition" class="dataset-cover" :src="workspaceArtwork(active.name+' '+active.id)" alt=""><span class="local-kicker">空间源数据 · {{ active.category }}</span><h3>{{ active.name }}</h3></div>
        <div class="local-tools">
          <span v-if="servicePending">地图服务待下线</span>
          <button v-else-if="canPublish" class="local-primary" @click="emit('publish-source',active.id)">{{activeService?'更新已发布服务':'发布为地图服务'}}</button>
          <a v-if="activeService" :href="platformLink('services',activeService.id)">管理服务</a>
          <a v-if="activeService" :href="platformLink('bindings','dataset:'+active.id)">绑定一张图</a>
          <a v-if="raster" :href="residentRasterUrl" download="01_建筑归集人口_100米.tif">下载原始 GeoTIFF</a>
          <a :href="platformLink('preview','dataset:'+active.id)">地图预览</a>
          <button type="button" @click="open('metadata')">数据集设置</button><button type="button" @click="exportLayer(active)">导出 GeoJSON</button><button v-if="!raster" type="button" :disabled="exporting || !records.length" @click="exportSHP(active)">{{exporting?'正在打包…':'导出 SHP'}}</button>
        </div>
      </header>
      <p v-if="active.description" class="local-description">{{ active.description }}</p>
      <dl class="local-meta"><div><dt>数据集编号</dt><dd>{{ active.id }}</dd></div><div><dt>提供部门</dt><dd>{{ active.department }}</dd></div>
        <div><dt>数据来源</dt><dd>{{ active.source?.serviceName ?? '本地数据集' }}</dd></div>
        <div v-if="active.source"><dt>来源更新</dt><dd>{{ new Date(active.source.syncedAt).toLocaleDateString('zh-CN') }}</dd></div>
        <div v-if="generatedLayers.length" class="local-views"><dt>由此生成的展示图层</dt><dd>
          <a v-for="layer in generatedLayers" :key="layer.id" :href="platformLink('preview','dataset:'+layer.id)">{{ layer.name }}</a>
        </dd></div>
      </dl>
      <p v-if="notice" role="status" class="local-notice">{{ notice }}</p>
      <div class="local-record-heading"><h4>{{ isCourtLedger ? '逐片场地台账' : '数据记录' }}</h4><span>共 {{ totalRecords.toLocaleString('zh-CN') }} {{ unit }}</span></div>
      <div class="local-controls"><input v-model="query" aria-label="筛选空间要素" type="search" :placeholder="isCourtLedger ? '查找场地、所属场馆、行政区或编号' : '查找名称、行政区或编号'">
        <select v-if="acceptsPendingLocation(active.id)" v-model="locationFilter" aria-label="定位状态">
          <option value="all">全部定位状态</option><option value="pending">待定位（{{ pendingLocations }}）</option>
          <option value="located">已定位（{{ active.features.length - pendingLocations }}）</option>
        </select>
        <div class="local-tools">
          <button v-if="raster" type="button" :aria-pressed="managePixels" @click="managePixels=!managePixels">{{managePixels?'结束多选':'批量管理像元'}}</button>
          <PlatformAttributeExport :dataset="active" v-bind="attributeExportScope"/>
          <button type="button" :disabled="!totalRecords" @click="open('attribute-import')">导入 Excel 更新属性</button>
          <template v-if="!raster"><button type="button" @click="open('import')">导入空间文件</button><button class="local-primary" type="button" @click="open('feature')">{{ isCourtLedger ? '新增场地' : '新增记录' }}</button></template>
        </div>
      </div>
      <PlatformSelectionBar v-if="!raster || managePixels" :total="recordIds.length" :selected="recordPick.selected.value.length" :label="raster?'网格像元':'要素记录'" @all="recordPick.toggleAll" @clear="recordPick.clear"><button class="local-danger" :disabled="!recordPick.selected.value.length" @click="removePicked">删除所选记录</button></PlatformSelectionBar>
      <div class="local-table-scroll">
        <table><thead><tr><th v-if="!raster || managePixels">选择</th><th>{{ isCourtLedger ? '场地名称' : '记录名称' }}</th><th>{{ isCourtLedger ? '所属场馆' : '行政区' }}</th><th>{{ isCourtLedger ? '所属镇街' : raster ? '格内人口' : '几何' }}</th><th>操作</th></tr></thead>
          <tbody><tr v-for="feature in pageRows" :key="feature.id"><td v-if="!raster || managePixels"><input type="checkbox" :aria-label="'选择记录'+recordName(feature)" :checked="recordPick.checked.value.has(feature.id)" @change="recordPick.toggle(feature.id)"/></td><td>{{ recordName(feature) }}<small>{{ feature.id }}</small></td>
            <td>{{ isCourtLedger ? feature.properties['所属场馆'] || '未填' : feature.properties.region }}</td>
            <td>{{ isCourtLedger ? feature.properties.region : raster ? feature.properties.population+' 人' : geometryLabels[feature.geometry.type] }}</td>
            <td><div class="local-tools"><button type="button" @click="open('feature',feature)">编辑</button><button class="local-danger" type="button" @click="open('remove-feature',feature)">{{ isCourtLedger ? '删除这片场地' : '删除此记录' }}</button></div></td>
          </tr><tr v-if="!pageRows.length"><td :colspan="!raster || managePixels?5:4">{{ filteredRecords ? '没有符合筛选条件的记录' : '暂无记录，可新增或导入。' }}</td></tr></tbody>
        </table>
      </div>
      <nav class="local-pagination" aria-label="空间要素分页"><span>{{ filteredRecords ? '筛选命中 '+matchCount.toLocaleString('zh-CN')+' '+unit+' / ' : '' }}总计 {{ totalRecords.toLocaleString('zh-CN') }} {{ unit }}</span>
        <button v-if="filteredRecords" type="button" @click="query=''; locationFilter='all'">清除筛选</button>
        <select v-model.number="pageSize" aria-label="每页要素数"><option v-for="size in [10,25,50]" :key="size" :value="size">{{ size }} 条 / 页</option></select>
        <button type="button" :disabled="page <= 1" @click="page--">上一页</button><span>{{ page }} / {{ pageCount }}</span><button type="button" :disabled="page >= pageCount" @click="page++">下一页</button>
      </nav>
    </section>
    <section v-else-if="missingSelection" class="local-assets"><h3>当前草稿中找不到该数据集</h3><p>可从左侧选择其他源数据集。</p></section>
    <section v-else class="local-assets"><h3>暂无空间数据集</h3><button type="button" class="local-primary" @click="open('new-layer')">新建数据集</button></section>
    <dialog v-if="modal" ref="dialog" class="local-dialog" :data-workspace-view="workspaceEdition ? modal : undefined" aria-labelledby="local-dialog-title" @cancel.prevent="close">
      <header><h3 id="local-dialog-title">{{ modal === 'remove-feature' && isCourtLedger ? '删除这片场地' : modal === 'feature' && !editing ? '新增空间要素' : titles[modal] }}</h3><button type="button" aria-label="关闭编辑窗口" @click="close">×</button></header>
      <p v-if="error" class="local-error" role="alert">{{ error }}</p>
      <SpatialAttributeImport v-if="modal==='attribute-import' && attributeImportSource" :dataset="attributeImportSource" v-bind="attributeExportScope"
        :template-scope="recordPick.selected.value.length ? 'selected' : filteredRecords ? 'filtered' : 'all'" @apply="applyAttributeImport" @close="close" />
      <form v-else-if="modal==='feature' && raster && editing" class="local-form" @submit.prevent="savePixel">
        <SpatialGeometryEditor v-if="active" :dataset-id="active.id" :type="editing.geometry.type" :geometry="editing.geometry" read-only />
        <strong>{{ editing.properties.name }}</strong><label>格内人口（人）<input v-model.number="pixelValue" type="number" min="0" max="2147483647" step="1" required autofocus></label>
        <p>面积 10,000 平方米 · 密度 {{ typeof pixelValue==='number' ? (pixelValue*100).toLocaleString('zh-CN') : '—' }} 人/km²</p>
        <footer><button type="button" @click="close">取消</button><button class="local-primary">应用到草稿</button></footer>
      </form>
      <PlatformFeatureEditor v-else-if="modal === 'feature' && active" :dataset="active" :feature="editing" @apply="saveFeature" @cancel="close" />
      <form v-else-if="modal === 'new-layer' || modal === 'metadata'" class="local-form workspace-dataset-form" @submit.prevent="saveLayer">
        <aside v-if="workspaceEdition" class="workspace-dataset-aside"><img :src="workspaceArtwork(meta.name || active?.name || '场地')" alt="">
          <h4>空间源数据</h4><ul><li v-for="item in layers.slice(0,5)" :key="item.id"><img :src="workspaceArtwork(item.name)" alt=""><span>{{item.name}}</span></li></ul></aside>
        <div class="local-form-grid">
          <label>数据集名称<input v-model="meta.name" maxlength="120" required autofocus></label>
          <label>数据集编号<input v-model="meta.id" pattern="[a-z][a-z0-9_\-]*" maxlength="72" :readonly="modal === 'metadata'" required placeholder="如 local_venues"></label>
          <label>提供部门<input v-model="meta.department" maxlength="120" required></label>
          <label>分类<input v-model="meta.category" maxlength="120" required></label>
        </div>
        <label>数据集说明<textarea v-model="meta.description" maxlength="800" rows="3"></textarea></label>
        <footer><button v-if="modal === 'metadata'" class="local-danger local-remove" type="button" @click="active && removeLayer(active)">删除整份数据集</button>
          <button type="button" @click="close">取消</button><button class="local-primary" type="submit">应用到草稿</button></footer>
      </form>
      <form v-else-if="modal === 'import' && active" class="local-form workspace-import-form" @submit.prevent="acceptImport">
        <p class="local-help">导入到「{{ active.name }}」。支持 GeoJSON、CSV、单图层 Shapefile ZIP 和单要素表 GeoPackage。</p>
        <label class="workspace-upload">空间文件<input type="file" accept=".geojson,.json,.csv,.zip,.gpkg" @change="selectFile"></label>
        <template v-if="isShapeZip && (shapeAttributes || !fileData)">
          <label>属性表编码<select v-model="dbfEncoding" @change="readFile">
            <option value="auto">自动识别</option><option value="utf-8">UTF-8</option>
            <option value="gb18030">简体中文（GBK / GB18030）</option><option value="big5">繁体中文（Big5）</option>
          </select></label>
          <section v-if="shapeAttributes" class="shp-attribute-sample" aria-label="SHP 原始属性预览">
            <h4>原始属性预览 <small>{{ shapeAttributes.encoding }}</small></h4>
            <div v-if="shapeAttributes.fields.length" class="shp-attribute-scroll" tabindex="0" aria-label="浏览字段名和样例值">
              <table><thead><tr><th scope="col">字段名</th><th scope="col">样例值</th></tr></thead>
                <tbody><tr v-for="[field,value] in shapeAttributes.fields" :key="field"><th scope="row">{{field}}</th><td>{{value || '—'}}</td></tr></tbody>
              </table>
            </div>
          </section>
        </template>
        <aside v-if="workspaceEdition" class="workspace-import-notes"><h4>文件要求</h4>
          <ul><li><strong>GeoJSON</strong><small>WGS84 经纬度</small></li><li><strong>CSV</strong><small>经纬度列</small></li><li><strong>Shapefile ZIP</strong><small>单图层 · 投影坐标须附 PRJ</small></li><li><strong>GeoPackage</strong><small>EPSG:4326 / 3857</small></li></ul>
          <h4>导入字段说明</h4><p>使用要素 ID 识别记录。未填写行政区时，默认使用京山市。</p></aside>
        <template v-else>
        <p class="local-help">CSV 使用 WGS84 经度、纬度列。投影坐标的 SHP 需包含 PRJ，中文属性可附 CPG 编码文件。</p>
        <p class="local-help">GeoPackage 支持 EPSG:4326 或 EPSG:3857 的二维点、线、面及多面，导入时统一转换为 WGS84 经纬度。</p>
        </template>
        <label>导入方式<select v-model="importMode"><option value="append">追加新要素</option><option value="merge">按 ID 更新或新增</option><option value="replace">替换整个图层的要素</option></select></label>
        <p v-if="active.id === 'court_footprints' && importMode === 'merge' && (!fileName || /\.zip$/i.test(fileName))" class="local-help">SHP 补录按原场地边界或登记编码更新属性，保留场地编号和边界。支持普通 DBF 字段和带登记坐标的奥维备注。</p>
        <p v-else class="local-help">{{ importMode === 'append' ? '已有要素保留；遇到重复 ID 时会提示。' : importMode === 'merge' ? '每条记录都需有 ID。已有要素更新几何和文件中的属性，其他属性保留。' : '图层信息和来源关联保留。文件中缺少的原有要素将从此图层移除。' }}</p>
        <details><summary>导入字段说明</summary>
          <p class="local-help">使用 Feature 的 id 识别要素。导入 SHP 时优先采用「实体名称」，其他名称字段可使用 name 或「名称」。</p>
          <p class="local-help">{{ isCourtLedger ? '网球场地按实测边界确定地图所属镇街，原表中的行政区字段一并保留。' : '行政区读取 region、「所属乡镇」或「行政区」。新记录缺少行政区时填入京山市。' }}</p>
        </details>
        <p v-if="reading" role="status">正在读取文件…</p>
        <p v-if="preview?.error" class="local-error" role="alert">{{ preview.error }}</p>
        <section v-if="preview?.plan" class="local-preview" aria-label="导入预览">
          <h4>导入预览</h4><p>新增 {{ preview.plan.added }} 条 · 更新 {{ preview.plan.updated }} 条 · 移除 {{ preview.plan.removed }} 条</p>
          <ul><li v-for="item in preview.plan.first" :key="item.id">{{ item.properties.name }} · {{ geometryLabels[item.geometry.type] }}</li></ul>
          <small>应用后本图层共 {{ preview.plan.total }} 条要素</small>
        </section>
        <footer><button type="button" @click="close">取消</button><button class="local-primary" type="submit" :disabled="!preview?.plan || reading">确认导入草稿</button></footer>
      </form>
      <form v-else-if="active" class="local-form" @submit.prevent="remove">
        <div v-if="editing" class="local-remove-details"><strong>{{ editing.properties.name }}</strong>
          <span v-if="isCourtLedger">所属场馆　{{ venueImpact?.name || '未填' }}<template v-if="venueImpact">（{{ venueImpact.count }} 片 → {{ venueImpact.count - 1 }} 片）</template></span>
          <span>记录编号　{{ editing.id }}</span>
        </div>
        <p>「{{ active.name }}」将从 {{ totalRecords }} {{ unit }}变为 {{ totalRecords - 1 }} {{ unit }}。发布后地图同步更新。</p>
        <p v-if="venueImpact?.count===1">这是该场馆的最后一片场地。发布后，该场馆也会从场馆图层中移除。</p>
        <footer><button autofocus type="button" @click="close">取消</button><button type="submit" class="local-danger">{{ isCourtLedger ? '确认删除这片场地' : '确认删除此记录' }}</button></footer>
      </form>
    </dialog>
  </div>
</template>

<style src="./platform-local-data.css"></style>
