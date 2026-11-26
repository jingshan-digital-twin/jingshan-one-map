<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, shallowRef, toRaw, watch } from 'vue'
import { readServiceAttributes } from './map-service-attributes'
import SpatialAttributeTable from './SpatialAttributeTable.vue'
import { isFeatureService } from './cim-types'
import type { CityFeature, Coordinate, Dataset, DataDocument } from './types'
import { cimProtocols, type CimAdminService } from './cim-types'
import { inspectDataset, publishedLayerUrl } from './platform-resource-inspect'
import { platformLink } from './platform-navigation'
import { populationRaster, populationRecordCount, rasterPage } from './population-raster'
import { catalogTypes, datasetCatalogType } from './portal-catalog'
import { isPlatformFormDataset } from './platform-forms'
import type { PreviewLayer } from './platform-preview-layers'
import PlatformAddressSearch from './PlatformAddressSearch.vue'
import PlatformAttributeExport from './PlatformAttributeExport.vue'
import { addAddressMark, addressLayerId, addressLayerName, hasAddressMark, type MapAddress } from './platform-address-search'
import { createFacilityBoundaryIndex } from './facility-boundaries'
const PlatformPreviewMap=defineAsyncComponent(()=>import('./PlatformPreviewMap.vue'))
const props=defineProps<{draft:DataDocument; published?:DataDocument; services:CimAdminService[]; initialId?:string;readOnly?:boolean;dirty:boolean}>()
const emit=defineEmits<{ update: [document: DataDocument] }>()
const selection=ref(''),tab=ref<'info'|'fields'|'records'>('info'), page=ref(1), fieldPage=ref(1), keyword=ref(''), retry=ref(0)
const choices=computed(()=>[
  ...props.draft.datasets.map(data=>({key:'dataset:'+data.id,name:data.name,group:catalogTypes[datasetCatalogType(data)]})),
  ...props.services.map(service=>({key:'service:'+service.id,name:service.name,group:'地图服务'})),
])
const filtered=computed(()=>choices.value.filter(row=>row.key===selection.value || row.name.toLowerCase().includes(keyword.value.toLowerCase().trim())))
const active=computed(()=>choices.value.find(row=>row.key===selection.value))
const dataset=computed(()=>props.draft.datasets.find(row=>'dataset:'+row.id===selection.value))
const service=computed(()=>props.services.find(row=>'service:'+row.id===selection.value))
const tableOpen=ref(false), tableError=ref(''), selectedRows=shallowRef<string[]>([]), picked=ref<{id:string;serial:number}>(),focusRow=shallowRef<{feature:CityFeature;serial:number}>()
const external=shallowRef<Dataset>(),tableRetry=ref(0)
const hosted=computed(()=>service.value?.hostedDatasetId ? props.published?.datasets.find(d=>d.id===service.value?.hostedDatasetId):undefined)
const tableDataset=computed(()=>dataset.value??hosted.value??external.value)
watch([tableOpen,service,tableRetry],async([open,s],_,onCleanup)=>{
  external.value=undefined;tableError.value=''
  if(!open || !s || hosted.value || !isFeatureService(s.kind))return
  const controller=new AbortController();onCleanup(()=>controller.abort())
  try{
    const dataset=await readServiceAttributes(s,controller.signal)
    if(!controller.signal.aborted)external.value=dataset
  }catch(e){if(!controller.signal.aborted)tableError.value=e instanceof Error?e.message:'属性读取失败'}
})
function closeTable(){tableOpen.value=false;picked.value=undefined;selectedRows.value=[];focusRow.value=undefined}
function locateRow(f:CityFeature){focusRow.value={feature:f,serial:(focusRow.value?.serial??0)+1}}
function pickedRow(id:string){picked.value={id,serial:(picked.value?.serial??0)+1}}
watch(selection,closeTable)
const sourceId=computed(()=>dataset.value?.derivedFrom || service.value?.hostedDatasetId)
const sourceName=computed(()=>props.draft.datasets.find(d=>d.id===sourceId.value)?.name ?? sourceId.value)
const mainVisible=ref(true), mainAlpha=ref(100), toAdd=ref('')
const settings=ref<{key:string;visible:boolean;opacity:number;color:string}[]>([])
const statuses=ref<Record<string,string>>({})
const overlayPalette=['#ffc05c','#ab9bf2','#6ddcab','#ff9593','#64a9fc']
const available=computed(()=>choices.value.filter(row=>row.key!==selection.value && !settings.value.some(o=>o.key===row.key) &&
  (row.group==='地图服务' ? props.services.some(s=>'service:'+s.id===row.key && s.enabled)
    : props.draft.datasets.some(d=>'dataset:'+d.id===row.key && d.features.some(f=>f.geometry.type!=='GeometryCollection')))))
const overlays=computed<PreviewLayer[]>(()=>settings.value.flatMap(o=>{
  const data=props.draft.datasets.find(d=>'dataset:'+d.id===o.key), s=props.services.find(s=>'service:'+s.id===o.key)
  const item=data ?? s
  return item ? [{key:o.key,name:item.name,dataset:data,service:s,visible:o.visible,alpha:o.opacity/100,color:o.color}] : []
}))
function addOverlay() {
  if(!toAdd.value || !available.value.some(a=>a.key===toAdd.value))return
  settings.value.push({key:toAdd.value,visible:true,opacity:85,color:overlayPalette[settings.value.length%overlayPalette.length]})
  toAdd.value=''
}
const located = shallowRef<MapAddress>(), picking = ref(''), addressNotice = ref('')
const addressBar = ref<HTMLElement>()
const marks = computed(() => props.draft.datasets.find(row => row.id === addressLayerId))
const alreadyAdded = computed(() => !!located.value && hasAddressMark(marks.value, located.value))
const towns = computed(() => createFacilityBoundaryIndex(props.draft.datasets.find(d => d.id === 'administration')?.features ?? [], []))
watch(() => props.dirty, dirty => { if (!dirty) addressNotice.value = '' })

function clearLocation() {
  located.value = undefined
  picking.value = ''
  addressNotice.value = ''
}
async function revealAddress() {
  await nextTick()
  const bar = addressBar.value
  if (bar && window.innerHeight - bar.getBoundingClientRect().bottom < 140) bar.scrollIntoView({block:'start'})
}
function locateAddress(place: MapAddress) {
  clearLocation()
  located.value = { ...place, region: place.region || towns.value.locate(place.position).town?.properties.name || '' }
  void revealAddress()
}
function startPicking(name: string) {
  if (props.readOnly) return
  clearLocation()
  picking.value = name
  void revealAddress()
}
function pickAddress(position: Coordinate) {
  if (!picking.value || props.readOnly) return
  locateAddress({ name: picking.value, address: picking.value, region: '', source: '地图选点', position })
}
function addLocation() {
  const place = located.value
  if (!place || props.readOnly || alreadyAdded.value) return
  try {
    emit('update', addAddressMark(toRaw(props.draft), place))
    if (dataset.value?.id === addressLayerId) {
      mainVisible.value = true
      if (!mainAlpha.value) mainAlpha.value = 100
    } else {
      const key = 'dataset:' + addressLayerId
      const overlay = settings.value.find(row => row.key === key)
      if (overlay) {
        overlay.visible = true
        if (!overlay.opacity) overlay.opacity = 100
      } else settings.value.push({ key, visible: true, opacity: 100, color: overlayPalette[0] })
    }
    addressNotice.value = '已加入地址标注，请保存草稿。'
  } catch (error) {
    addressNotice.value = error instanceof Error ? error.message : '地址标注添加失败'
  }
}
const audit=computed(()=>dataset.value && inspectDataset(dataset.value))
const endpoint=computed(()=>dataset.value ? publishedLayerUrl(dataset.value.id) : service.value?.mapUrl)
const grid=computed(()=>populationRaster(dataset.value))
const recordCount=computed(()=>dataset.value ? populationRecordCount(dataset.value) : 0)
const recordRows=computed(()=>grid.value ? rasterPage(grid.value,page.value,10).rows : dataset.value?.features.slice((page.value-1)*10,page.value*10))
const attrs=computed(()=>audit.value?.fields ?? [])
const checks=computed(()=>audit.value ? [
  {label:'缺少空间位置',count:audit.value.unlocated},
  {label:'重复要素编号',count:audit.value.duplicateIds},
  {label:'缺少要素名称',count:audit.value.missingNames},
] : [])
const copyResult=ref('')
const extentLabel=computed(()=> audit.value?.extent?.map(v=>v.toFixed(4)+'°').join(' / ') ?? '—')
watch([choices,()=>props.initialId],([items,id])=>{
  selection.value=id || (items.find(row=>row.key==='dataset:administration') ?? items[0])?.key || ''
},{immediate:true})
watch(selection,()=>{tab.value='info';page.value=1;fieldPage.value=1;copyResult.value='';settings.value=[];statuses.value={};mainVisible.value=true;mainAlpha.value=100;toAdd.value=''})
watch(selection, clearLocation)
function choose(key:string) {
  location.hash='preview/'+encodeURIComponent(key)
}
function refresh() {retry.value++}
async function copyEndpoint() {
  if (!endpoint.value) return
  const url=new URL(endpoint.value,location.href).href.replace(/%7B/gi,'{').replace(/%7D/gi,'}')
  try {await navigator.clipboard.writeText(url);copyResult.value='已复制'}
  catch {copyResult.value=url}
}
function display(v:unknown) {return v==null || v==='' ? '—' : typeof v==='object' ? JSON.stringify(v) : String(v)}
</script>
<template>
  <section class="gis-workspace" :class="{'with-attributes':tableOpen}" aria-label="地图预览">
    <div class="gis-selection">
      <label>预览资源<select aria-label="预览资源" :value="selection" @change="choose(($event.target as HTMLSelectElement).value)"><option v-if="!active" value="">请选择资源</option>
        <optgroup v-for="grp in Object.values(catalogTypes)" :key="grp" :label="grp"><option v-for="r in filtered.filter(x=>x.group===grp)" :key="r.key" :value="r.key">{{r.name}}</option></optgroup>
      </select></label>
      <PlatformAddressSearch v-model="keyword" :datasets="draft.datasets" :resources="choices"
        :active-id="dataset?.id" :read-only="readOnly || !active" @locate="locateAddress" @pick="startPicking" @resource="choose"/>
      <button type="button" @click="refresh">重新加载</button>
    </div>
    <div v-if="active && (picking || located)" ref="addressBar" class="gis-address-bar" aria-label="地址定位">
      <template v-if="located">
        <div class="gis-address-info"><strong>{{ located.name }}</strong>
          <span>{{ [located.address === located.name ? '' : located.address, located.region, located.source].filter(Boolean).join(' · ') }}</span>
          <small>WGS84 · {{ located.position.map(n => n.toFixed(5)).join(', ') }}</small>
        </div>
        <button v-if="!readOnly" type="button" class="gis-mark-add" :disabled="alreadyAdded" @click="addLocation">{{ alreadyAdded ? '已添加' : '添加到' + addressLayerName }}</button>
      </template>
      <span v-else>在地图上点击「{{ picking }}」的位置</span>
      <button type="button" class="gis-address-close" :aria-label="picking ? '取消地图选点' : '清除地址定位'" @click="clearLocation">×</button>
      <p v-if="addressNotice" role="status">{{ addressNotice }}</p>
    </div>
    <div v-if="active" class="gis-main">
      <PlatformPreviewMap :key="active.key+'-'+retry" :service="tableOpen && tableDataset?undefined:service" :dataset="tableOpen?tableDataset:dataset"
        :highlighted="selectedRows" :focus-row="focusRow" @row-picked="pickedRow"
        :address="located" :picking-address="!!picking" @address-picked="pickAddress"
        :overlays="overlays" :visible="mainVisible" :alpha="mainAlpha/100" @layer-status="(key,message)=>statuses[key]=message"/>
      <aside class="gis-inspector">
        <div class="gis-resource-head"><span>{{active.group}} · {{dataset?'当前草稿':hosted?'已发布版本':'接入服务'}}</span><h2>{{active.name}}</h2><small v-if="sourceId">源数据集 · {{sourceName}}</small></div>
        <button v-if="dataset || hosted || service && isFeatureService(service.kind)" type="button" class="gis-attribute-toggle" :aria-pressed="tableOpen" @click="tableOpen?closeTable():tableOpen=true">{{tableOpen?'收起属性表':'打开属性表'}}</button>
        <section class="gis-layer-control"><h3>图层控制</h3>
          <div class="gis-add"><select v-model="toAdd" aria-label="选择叠加资源"><option value="">选择叠加资源</option><option v-for="r in available" :key="r.key" :value="r.key">{{r.name}} · {{r.group}}</option></select><button type="button" :disabled="!toAdd" @click="addOverlay">叠加</button></div>
          <div class="gis-layer-row"><label><input type="checkbox" v-model="mainVisible">{{active.name}}</label>
            <div><input v-model.number="mainAlpha" type="range" min="0" max="100" :aria-label="active.name+'透明度'"><span>{{mainAlpha}}%</span></div>
          </div>
          <div v-for="(layer,i) in settings" :key="layer.key" class="gis-layer-row"><label><input v-model="layer.visible" type="checkbox">{{overlays[i]?.name}}</label>
            <button type="button" class="gis-remove" :aria-label="'移除'+overlays[i]?.name" @click="settings.splice(i,1)">移除</button>
            <div><input type="range" min="0" max="100" v-model.number="layer.opacity" :style="{accentColor:layer.color}" :aria-label="overlays[i]?.name+'透明度'"><span>{{layer.opacity}}%</span></div>
            <small>{{statuses[layer.key] || '正在载入…'}}</small>
          </div>
        </section>
        <nav v-if="dataset" class="gis-tabs"><button type="button" :aria-current="tab==='info'" @click="tab='info'">概况</button><button type="button" :aria-current="tab==='fields'" @click="tab='fields'">字段</button><button type="button" :aria-current="tab==='records'" @click="tab='records'">记录</button></nav>
        <section v-if="dataset && audit && tab==='info'">
          <h3>{{dataset.derivedFrom ? '展示图层概况' : '数据集概况'}}</h3>
          <div class="gis-metrics"><div><small>要素总数</small><b>{{recordCount.toLocaleString()}}</b></div><div><small>属性字段</small><b>{{attrs.length}}</b></div></div>
          <dl class="gis-props"><dt>坐标系</dt><dd>WGS 84</dd><dt>分类</dt><dd>{{dataset.category}}</dd><dt>提供部门</dt><dd>{{dataset.department}}</dd><dt>西 / 南 / 东 / 北</dt><dd>{{extentLabel}}</dd></dl>
          <h3>数据质检</h3><div v-for="check in checks" :key="check.label" class="gis-check"><span>{{check.label}}</span><b :class="{warn:check.count>0}">{{check.count}} 条</b></div>
        </section>
        <section v-if="dataset && tab==='fields'"><h3>属性字段</h3>
          <table><thead><tr><th>字段名</th><th>类型</th><th>有值</th></tr></thead><tbody><tr v-for="f in attrs.slice((fieldPage-1)*10,fieldPage*10)" :key="f.key"><td>{{f.key}}</td><td>{{f.type}}</td><td>{{f.filled}}</td></tr></tbody></table>
          <div v-if="attrs.length>10" class="gis-pages"><button :disabled="fieldPage===1" @click="fieldPage--">上一页</button><span>{{fieldPage}} / {{Math.ceil(attrs.length/10)}}</span><button :disabled="fieldPage*10>=attrs.length" @click="fieldPage++">下一页</button></div></section>
        <section v-if="dataset && tab==='records'"><h3>数据记录</h3>
          <details v-for="row in recordRows" :key="row.id"><summary>{{row.properties.name}}</summary><dl class="gis-props"><template v-for="(v,k) in row.properties" :key="k"><dt>{{k}}</dt><dd>{{display(v)}}</dd></template></dl></details>
          <p v-if="!recordCount">暂无数据记录</p>
          <div v-if="recordCount>10" class="gis-pages"><button :disabled="page===1" @click="page--">上一页</button><span>{{page}} / {{Math.ceil(recordCount/10)}}</span><button :disabled="page*10>=recordCount" @click="page++">下一页</button></div>
        </section>
        <section v-if="service"><h3>服务信息</h3><dl class="gis-props"><dt>协议</dt><dd>{{cimProtocols[service.kind]}} {{service.version}}</dd><dt>分类</dt><dd>{{service.category}}</dd><dt>服务状态</dt><dd>{{service.enabled ? '已启用' : '已停用'}}</dd><template v-if="service.layer"><dt>服务图层</dt><dd>{{service.layer}}</dd></template><template v-if="service.raster"><dt>坐标系</dt><dd>{{service.raster.projection}}</dd><dt>可用级别</dt><dd>0–{{service.raster.maxLevel}}</dd></template></dl>
          <p v-if="service.description">{{service.description}}</p></section>
        <footer><a v-if="!readOnly && dataset?.derivedFrom" :href="platformLink('local',dataset.derivedFrom)">查看源数据集 →</a>
          <a v-else-if="!readOnly" :href="dataset ? platformLink(isPlatformFormDataset(dataset) ? 'forms' : 'local',dataset.id) : platformLink('services',service?.id)">{{service ? '管理该服务' : '管理记录'}} →</a>
          <PlatformAttributeExport v-if="dataset" :dataset="dataset"/>
          <button type="button" @click="copyEndpoint">{{dataset ? '复制发布版 GeoJSON 地址' : '复制服务访问地址'}}</button>
          <output v-if="copyResult">{{copyResult}}</output>
        </footer>
      </aside>
    </div><p v-else class="gis-empty">找不到该资源，请从列表中重新选择。</p>
    <SpatialAttributeTable v-if="tableOpen && tableDataset" :key="selection" :dataset="tableDataset" :picked="picked" @selection="selectedRows=$event" @locate="locateRow" @close="closeTable"/>
    <p v-else-if="tableOpen" role="status">{{tableError || '正在读取服务属性…'}} <button v-if="tableError" @click="tableRetry++">重试</button></p>
  </section>
</template>
<style scoped>
.gis-layer-control{border-bottom:1px solid var(--platform-line)}.gis-add{display:flex;gap:6px;margin:10px 0}.gis-add select{flex:1;min-width:0}.gis-add button{white-space:nowrap}.gis-layer-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 8px;align-items:center;padding:8px 0}.gis-layer-row label{display:flex;gap:6px;align-items:center;font-weight:600}.gis-layer-row input[type=checkbox]{width:16px;height:16px;flex:none}.gis-layer-row div{display:flex;align-items:center;gap:8px;grid-column:1/-1}.gis-layer-row div input{padding:0;width:100%;min-width:0;height:12px;accent-color:var(--platform-accent)}.gis-layer-row div span{min-width:40px;font-size:14px;text-align:right}.gis-layer-row small{color:var(--platform-muted);grid-column:1/-1}.gis-remove{padding:2px 7px}
.gis-workspace{display:flex;flex-direction:column;gap:14px;flex:1;min-height:0}.gis-selection{display:flex;flex-wrap:wrap;align-items:center;gap:10px;color:var(--platform-muted)}.gis-selection label{display:flex;align-items:center;gap:8px}.gis-selection select{max-width: min(320px,65vw)}.gis-selection input{width:180px}.gis-selection button{margin-left:auto}
.gis-address-bar{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;padding:9px 12px;border:1px solid var(--platform-line);border-left:3px solid var(--platform-accent);border-radius:8px;background:var(--platform-paper)}
.gis-address-info,.gis-address-bar>span{min-width:0;flex:1 1 180px;overflow-wrap:anywhere}.gis-address-info span,.gis-address-info small{display:block;font-size:14px;color:var(--platform-muted)}
.gis-mark-add{color:var(--platform-accent);white-space:nowrap}.gis-address-close{margin-left:auto;min-width:34px;padding:2px 8px;font-size:21px;line-height:1}.gis-address-bar p{flex-basis:100%;font-size:14px;color:var(--platform-muted)}
.gis-main{display:grid;grid-template-columns:minmax(280px,1fr) minmax(290px,30%);flex:1;gap:16px;min-height:530px;height:min(68dvh,780px)}
.gis-inspector{border:1px solid var(--platform-line);border-radius:14px;background:var(--platform-paper);overflow:auto;scrollbar-width:thin;display:flex;flex-direction:column}.gis-resource-head,.gis-inspector section,.gis-inspector footer{padding:18px}.gis-resource-head{border-bottom:1px solid var(--platform-line)}.gis-resource-head span{color:var(--platform-accent);font-size:14px}.gis-resource-head h2{margin-top:4px}.gis-tabs{display:flex;gap:5px;padding:10px 15px 0}.gis-tabs [aria-current=true]{color:var(--platform-accent);border-color:var(--platform-accent)}.gis-metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}.gis-metrics div{background:var(--platform-soft);border:1px solid var(--platform-line);border-radius:8px;padding:10px}.gis-metrics b{display:block;color:var(--platform-accent);font-size:22px}.gis-props{display:grid;grid-template-columns:minmax(70px,34%) 1fr;gap:8px;padding:8px 0 16px}.gis-props dt,.gis-metrics small{color:var(--platform-muted)}.gis-props dd,.gis-props dt,.gis-inspector td,.gis-inspector summary,.gis-inspector output{overflow-wrap:anywhere}.gis-inspector th,.gis-inspector td{text-align:left;padding:6px;font-size:14px}.gis-inspector table{width:100%;border-collapse:collapse}.gis-inspector details,.gis-check{border-bottom:1px solid var(--platform-line);padding:8px 0}.gis-inspector summary{cursor:pointer}.gis-check,.gis-pages{display:flex;align-items:center;justify-content:space-between;gap:6px}.gis-check b{color:var(--platform-accent)}.gis-check b.warn{color:#eea859}.gis-inspector footer{display:grid;gap:8px;margin-top:auto}.gis-pages{margin-top:8px}.gis-empty{padding:32px;color:var(--platform-muted)}
.with-attributes .gis-main{flex:none;height:clamp(240px,36dvh,450px);min-height:0}
.with-attributes .gis-viewport{min-height:0}.with-attributes .gis-inspector{min-height:0}
.with-attributes :deep(.grid-scroll){max-height:clamp(150px,23dvh,300px)}
@media(max-width:1000px){.with-attributes .gis-main{height:auto;grid-template-columns:minmax(0,1fr) minmax(220px,38%)}.with-attributes .gis-viewport,.with-attributes .gis-inspector{height:260px}}
@media(max-width:650px){.with-attributes .gis-main{grid-template-columns:1fr}.with-attributes .gis-inspector{height:120px}}
@media(max-width:1000px){.gis-main{grid-template-columns:1fr;height:auto}.gis-inspector{max-height:450px}.gis-viewport{height:450px}}
</style>
