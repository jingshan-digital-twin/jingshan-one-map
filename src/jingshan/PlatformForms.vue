<script setup lang="ts">
import { workspaceEdition, workspaceArtwork } from './workspace-artwork'
import PlatformSelectionBar from './PlatformSelectionBar.vue'
import { useTableSelection } from './platform-selection'

import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import PlatformFieldDesigner from './PlatformFieldDesigner.vue'
import { downloadFormTable, readFormTable, tableFields } from './platform-form-table.ts'
import { formId } from './form-designer-id.ts'
import IndustryLedgerFields from './IndustryLedgerFields.vue'
import { ledgerEnterprises, ledgerRecordName, ledgerTemplate, newLedgerFeature, outputBasisLabel } from './industry-ledgers.ts'
import { checkFormSchema, checkPlatformRecord, formFieldTypes, formRecordKey, operationalForm, operationalRecordSources, platformFormTemplates } from './platform-forms.ts'
import { checkDataset } from './validate.ts'
import { overviewCourtStatsId } from './estimated-court-inventory.ts'
import { withVillageCourtField } from './overview-inventory-form.ts'
import { featureCenter, type CityFeature, type DataDocument, type Dataset, type FormField } from './types.ts'
import { downloadFile } from './api.ts'
import { localFileLimit, prepareGeoImport, type ImportMode } from './platform-local-data.ts'

const props = defineProps<{draft:DataDocument; initialId?:string; disabled?:boolean}>()
const emit = defineEmits<{batch:[ids:string[]];remove:[id:string]; change:[]; editing:[value:boolean]}>()
const workspaceTools = ref(false)
const id = ref(props.initialId || 'industry_output')
const view=ref<'data'|'schema'>('data')
const catalogue = computed(() => [...platformFormTemplates, ...props.draft.datasets.filter(d => d.formSchema)].map(item =>
  ({id:item.id, name:props.draft.datasets.find(d=>d.id===item.id)?.name ?? item.name, stored:props.draft.datasets.some(d=>d.id===item.id)})))
const manageForms=ref(false)
const formPick=useTableSelection(computed(()=>catalogue.value.filter(c=>c.stored).map(c=>c.id)),[manageForms])
const dataset = computed<Dataset>(() => {
  const existing = props.draft.datasets.find(item => item.id === id.value)
  if (existing) return withVillageCourtField(existing)
  const t = platformFormTemplates.find(item => item.id === id.value) ?? platformFormTemplates[0]
  return {id:t.id, name:t.name, category:t.category, department:t.department, description:t.description, features:[]}
})
const ledger = computed(() => ledgerTemplate(id.value))
const operational = computed(() => operationalForm(id.value))
const fields = computed(() => dataset.value.formSchema?.fields ?? operational.value?.fields ?? [])
const enterprises = computed(() => id.value === 'industry_enterprise_annual' ? ledgerEnterprises(props.draft.datasets) : [])
const links = computed(() => operationalRecordSources(props.draft.datasets,id.value))
const regions = computed(() => [...new Set(['京山市',...(props.draft.datasets.find(d=>d.id==='administration')?.features ?? [])
  .map(f=>f.properties.name),...dataset.value.features.map(f=>f.properties.region)])].filter(Boolean))
const keyword = ref(''), region = ref(''), page = ref(1), perPage = ref(10)
const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return dataset.value.features.filter(({id,properties:p}) => (!region.value || p.region===region.value) && (!q ||
    [id,...Object.values(p)].some(v => ['string','number'].includes(typeof v) && String(v).toLowerCase().includes(q))))
})
const selectedRows=useTableSelection(computed(()=>filtered.value.map(f=>f.id)),[id,keyword,region])
function deleteSelected(){
  const ids=new Set(selectedRows.selected.value)
  if(props.disabled || !ids.size || !confirm('从「'+dataset.value.name+'」删除选中的 '+ids.size+' 条记录？'))return
  storeDataset({...dataset.value,features:dataset.value.features.filter(f=>!ids.has(f.id))});selectedRows.clear()
}
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length/perPage.value)))
const rows = computed(() => filtered.value.slice((page.value-1)*perPage.value,page.value*perPage.value))
watch([keyword,region,perPage],()=>{page.value=1})
watch(pages,n=>{page.value=Math.min(n,page.value)})
watch(id,()=>{keyword.value='';region.value='';page.value=1;notice.value=''})
watch(catalogue,items=>{if (!items.some(x=>x.id===id.value)) id.value=items[0].id},{immediate:true})
watch(()=>props.initialId, next=>{if(next && catalogue.value.some(c=>c.id===next)) id.value=next})

const show = ref<'new-type'|'edit-type'|'record'|'import'>(), dialog = ref<HTMLDialogElement>()
const editor = ref<CityFeature>(), settings = ref<{id:string;name:string;department:string;description:string;fields:FormField[]}>()
const error = ref(''), notice = ref('')
const clone = <T,>(v:T):T => JSON.parse(JSON.stringify(v))
const err = (e:unknown) => {error.value=e instanceof Error?e.message:String(e)}
const fileMode = ref<ImportMode>('merge'), incoming = shallowRef<unknown>(), filename = ref(''), reading = ref(false)
let fileSequence = 0
const exportFormat=ref<'xlsx'|'csv'|'geojson'>('xlsx'), downloading=ref(false)
const positionEnabled=ref(false), longitude=ref<number>(), latitude=ref<number>()
async function exportTable(template=false) {
  downloading.value=true
  try {
    if(!template && exportFormat.value==='geojson') exportForm()
    else await downloadFormTable(dataset.value,template?[]:filtered.value,template||exportFormat.value==='xlsx'?'xlsx':'csv',template)
  } catch(e) { notice.value=e instanceof Error?e.message:'下载失败' }
  finally { downloading.value=false }
}
function exportForm() {
  const d=dataset.value
  downloadFile(d.id+'.geojson',JSON.stringify({type:'FeatureCollection',name:d.name,formDatasetId:d.id,
    formSchema:d.formSchema,source:d.source,features:filtered.value},null,2),'application/geo+json')
}
function openImport() {
  incoming.value=undefined;filename.value='';reading.value=false;fileMode.value='merge'
  void open('import')
}
async function readImport(event:Event) {
  const file=(event.target as HTMLInputElement).files?.[0]
  const seq=++fileSequence
  incoming.value=undefined;filename.value=file?.name ?? '';error.value='';reading.value=!!file
  if (!file) return
  try {
    if (file.size>localFileLimit) throw new Error('文件超过 18 MiB，请分批导入')
    const raw:unknown=await readFormTable(file,dataset.value)
    if (seq===fileSequence) {
      incoming.value=raw
      if (/\.(xlsx|csv)$/i.test(file.name) && raw && typeof raw==='object' && 'features' in raw && Array.isArray(raw.features) && raw.features.every(f=>f.id==null)) fileMode.value='append'
    }
  } catch(e) { if (seq===fileSequence) err(e) }
  finally { if (seq===fileSequence) reading.value=false }
}
const preview=computed(()=>{
  if (show.value!=='import' || incoming.value===undefined) return
  try {return {plan:prepareGeoImport(props.draft,dataset.value,incoming.value,fileMode.value)}}
  catch(e){return {error:e instanceof Error?e.message:'文件校验失败'}}
})
function applyImport() {
  const plan=preview.value?.plan
  if (!plan || reading.value || props.disabled) return
  props.draft.datasets=plan.data.datasets
  emit('change')
  close(true);keyword.value='';region.value='';page.value=1
  notice.value='已导入 '+filename.value+'，本表草稿共 '+plan.total+' 条记录'
}
let baseline = ''
function editState() { return JSON.stringify(show.value === 'record' ? [editor.value,positionEnabled.value,longitude.value,latitude.value] : settings.value) }
async function open(mode:typeof show.value) {
  show.value=mode; error.value=''; baseline=editState()
  await nextTick(); dialog.value?.showModal();emit('editing',true)
}
function close(force=false) {
  if (!force && editState()!==baseline && !window.confirm('放弃当前表单中尚未应用的修改？')) return
  fileSequence++;incoming.value=undefined
  dialog.value?.close();show.value=undefined;editor.value=undefined;settings.value=undefined;error.value='';emit('editing',false)
}
function write(key:string,value:unknown) {
  if (!editor.value) return
  if (value === '' || value === undefined) delete editor.value.properties[key]
  else editor.value.properties[key]=value
}
function openRecord(row?:CityFeature) {
  const op=operational.value
  editor.value=row ? clone(row) : ledger.value ? newLedgerFeature(ledger.value.id) : {
    type:'Feature', id:id.value+'-'+formId(), geometry:{type:'GeometryCollection',geometries:[]},
    properties:{name:'',kind:op?.kind ?? 'form_record',region:region.value || '京山市'},
  }
  positionEnabled.value=row?.geometry.type==='Point'
  longitude.value=row?.geometry.type==='Point'?row.geometry.coordinates[0]:undefined
  latitude.value=row?.geometry.type==='Point'?row.geometry.coordinates[1]:undefined
  if(!row) for(const f of fields.value) if(f.defaultValue!==undefined) editor.value.properties[f.key]=clone(f.defaultValue)
  if (!row) {editor.value.properties.region=region.value || '京山市';editor.value.properties.sample=false}
  void open('record')
}
function pickLink(value:string) {
  const op=operational.value, linked=links.value.find(f=>f.id===value)
  if (!op || !editor.value) return
  write(op.linkKey,value)
  if (linked) {
    write('region',linked.properties.region)
    const point=featureCenter(linked)
    editor.value.geometry=point ? {type:'Point',coordinates:point} : clone(linked.geometry)
  }
}
function storeDataset(next:Dataset) {
  const prior=props.draft.datasets.some(d=>d.id===next.id)
  if (!prior && props.draft.datasets.length>=100) throw new Error('当前工作区已达到 100 个数据集上限')
  checkDataset(next)
  props.draft.datasets=prior ? props.draft.datasets.map(d=>d.id===next.id?next:d) : [...props.draft.datasets,next]
  emit('change')
}
function saveRecord() {
  if (!editor.value || props.disabled) return
  try {
    const row=clone(editor.value), p=row.properties, d=dataset.value
    if(d.formSchema && (row.geometry.type==='Point'||row.geometry.type==='GeometryCollection')) {
      if(positionEnabled.value) {
        if(typeof longitude.value!=='number'||typeof latitude.value!=='number'||!Number.isFinite(longitude.value)||!Number.isFinite(latitude.value)||Math.abs(longitude.value)>180||Math.abs(latitude.value)>90)throw new Error('请填写有效的经纬度')
        row.geometry={type:'Point',coordinates:[longitude.value,latitude.value]}
      } else row.geometry={type:'GeometryCollection',geometries:[]}
    }
    checkPlatformRecord(d,row,props.draft.datasets,enterprises.value)
    if (ledger.value && !p.name.trim()) p.name=ledgerRecordName(p,ledger.value.id,enterprises.value.find(e=>e.id===p.enterpriseId)?.name)
    const op=operational.value
    if (op) {
      const entity=links.value.find(x=>x.id===p[op.linkKey])!
      p.name=(entity.properties.name+' · '+(op.id==='venue_operations' ? p.month : '赛后核验')).slice(0,120)
    }
    const key=formRecordKey(d.id,p), existing=d.features.find(f=>f.id===row.id)
    if (key && (!existing || formRecordKey(d.id,existing.properties)!==key) && d.features.some(f=>f.id!==row.id && formRecordKey(d.id,f.properties)===key))
      throw new Error('相同统计对象和周期已有记录，请编辑原记录')
    storeDataset({...d,features:existing?d.features.map(f=>f.id===row.id?row:f):[row,...d.features]})
    close(true);notice.value='记录已加入当前草稿'
    if(!existing){page.value=1;keyword.value='';region.value=''}
  }catch(e){err(e)}
}
function deleteRecord(row:CityFeature) {
  if (props.disabled || !confirm('删除这条记录「'+row.properties.name+'」？表单将从 '+dataset.value.features.length+' 条变为 '+(dataset.value.features.length-1)+' 条，发布后生效。')) return
  storeDataset({...dataset.value,features:dataset.value.features.filter(f=>f.id!==row.id)});notice.value='记录已从草稿移除'
}
function openType(edit=false){
  const d=dataset.value
  settings.value=edit ? {id:d.id,name:d.name,department:d.department,description:d.description,fields:clone(d.formSchema!.fields)}
    :{id:'form_'+formId().replaceAll('-',''),name:'',department:'',description:'',fields:[emptyField()]}
  void open(edit?'edit-type':'new-type')
}
function emptyField():FormField {return {key:'field_'+formId().slice(0,8),label:'',type:'text',required:false}}
function existingValue(key:string) {return show.value==='edit-type' && dataset.value.features.some(f=>f.properties[key]!=null)}
function saveType(){
  const s=settings.value
  if(!s || props.disabled)return
  try {
    const spec={fields:s.fields.map(f=>({...f,label:f.label.trim(),options:['select','multiselect'].includes(f.type)?f.options:undefined}))}
    checkFormSchema(spec)
    if(catalogue.value.some(c=>c.id!==s.id && c.name===s.name.trim())) throw new Error('已有同名表单')
    const existing=props.draft.datasets.find(d=>d.id===s.id)
    storeDataset({...existing,id:s.id,name:s.name.trim(),department:s.department.trim(),description:s.description.trim(),
      category:existing?.category ?? '业务表单',features:existing?.features ?? [],formSchema:spec})
    close(true);id.value=s.id
    void nextTick(()=>{notice.value='表单定义已加入当前草稿'})
  } catch(e){err(e)}
}
function cell(row:CityFeature,key:string) {
  const p=row.properties
  if(key==='outputBasis')return outputBasisLabel(p[key])
  if(key==='scope')return [p.chainStage,p.chainTopic].filter(Boolean).join(' · ')||'全链合计'
  const v=p[key]
  return v===true?'是':v===false?'否':v==null||v===''?'—':String(v)
}
const columns=computed(()=>{
  switch(id.value){
    case 'industry_output':return [['year','年度'],['scope','统计范围'],['outputWanYuan','产值（万元）'],['outputBasis','口径']]
    case 'industry_procurement':return [['purchasedAt','采购日期'],['buyer','采购方'],['category','品类'],['amountYuan','金额（元）']]
    case 'industry_enterprise_annual':return [['year','年度'],['topic','经营环节'],['topicRevenueWan','营收（万元）'],['sourceStatus','核验状态']]
    case 'venue_operations':return [['month','月份'],['bookings','预约笔数'],['utilization','使用率（%）']]
    case 'event_actuals':return [['confirmedAt','核对日期'],['attendance','参与人次'],['spend','消费（万元）']]
    default:return fields.value.map(f=>[f.key,f.label])
  }
})
const inline=ref<{id:string;field:FormField;value:string;error:string}>()
watch([id,view,page,keyword,region],()=>{inline.value=undefined})
function editCell(row:CityFeature,key:string) {
  const field=dataset.value.formSchema?.fields.find(f=>f.key===key)
  if(!field || props.disabled)return
  const value=row.properties[key]
  inline.value={id:row.id,field,value:Array.isArray(value)?value.join('、'):String(value??''),error:''}
}
function applyCell(row:CityFeature) {
  const edit=inline.value
  if(!edit || props.disabled || edit.id!==row.id)return
  try {
    const next=clone(row), key=edit.field.key, text=String(edit.value).trim()
    if(text==='')delete next.properties[key]
    else if(edit.field.type==='number')next.properties[key]=Number(text)
    else if(edit.field.type==='boolean')next.properties[key]=text==='true'
    else if(edit.field.type==='multiselect')next.properties[key]=text.split('、').map(s=>s.trim())
    else next.properties[key]=text
    const d=dataset.value
    storeDataset({...d,features:d.features.map(f=>f.id===next.id?next:f)})
    inline.value=undefined;notice.value='单元格已更新到草稿'
  } catch(e) {edit.error=e instanceof Error?e.message:'填写值有误'}
}
function hasChoice(key:string,option:string) {
  const values=editor.value?.properties[key]
  return Array.isArray(values) && values.includes(option)
}
function toggleChoice(key:string,option:string) {
  const existing=editor.value?.properties[key], values=Array.isArray(existing)?existing:[]
  write(key,hasChoice(key,option)?values.filter(v=>v!==option):[...values,option])
}
const fieldValue=(e:Event)=>(e.target as HTMLInputElement).value
</script>

<template>
  <section class="platform-forms" aria-label="业务表单管理">
    <nav v-if="workspaceEdition" class="workspace-form-nav" aria-label="表单类型"><h3>表单类型</h3>
      <button v-for="t in catalogue" type="button" :key="t.id" :aria-pressed="id===t.id" @click="id=t.id">
        <img :src="workspaceArtwork(t.name)" alt=""><span>{{t.name}}<small v-if="!t.stored">模板</small></span>
      </button>
      <footer class="workspace-form-create"><button :disabled="disabled" @click="openType()">新建表单类型</button></footer>
    </nav>
    <header v-if="!workspaceEdition" class="pf-bar"><label v-if="!workspaceEdition">表单类型<select v-model="id" aria-label="表单类型"><option v-for="t in catalogue" :key="t.id" :value="t.id">{{t.name}}{{t.stored ? '' : '（模板）'}}</option></select></label>
      <button type="button" :disabled="disabled" @click="openType()">新建表单类型</button>
      <button v-if="dataset.formSchema" type="button" :disabled="disabled" @click="openType(true)">编辑表单结构</button>
      <button v-if="view==='schema' && draft.datasets.some(d=>d.id===id)" class="resource-delete" type="button" :disabled="disabled" @click="emit('remove',id)">删除整张表单</button>
    </header>
    <div class="pf-head"><div><h3>{{dataset.name}}</h3><p v-if="!workspaceEdition">{{dataset.description}}</p>
      <details v-else-if="dataset.description" class="workspace-form-description"><summary>表单说明</summary><p>{{dataset.description}}</p></details></div>
      <span class="pf-owner">{{dataset.department}}</span></div>
    <div v-if="workspaceEdition" class="workspace-form-view">
      <nav class="pf-views" aria-label="表单视图"><button type="button" :aria-pressed="view==='data'" @click="view='data'">数据视图</button><button type="button" :aria-pressed="view==='schema'" @click="view='schema'">表单设置</button></nav>
      <button type="button" :aria-expanded="workspaceTools" @click="workspaceTools=!workspaceTools">表单工具</button>
    </div>
    <div v-else class="pf-bar pf-viewbar"><nav class="pf-views" aria-label="表单视图"><button type="button" :aria-pressed="view==='data'" @click="view='data'">数据视图</button><button type="button" :aria-pressed="view==='schema'" @click="view='schema'">表单设置</button></nav>
      <span>{{dataset.features.length}} 条记录 · {{tableFields(dataset).length}} 个字段</span></div>
    <div v-if="workspaceEdition && (workspaceTools || view==='schema')" class="pf-bar">
      <button v-if="dataset.formSchema" type="button" :disabled="disabled" @click="openType(true)">编辑表单结构</button>
      <button v-if="view==='schema' && draft.datasets.some(d=>d.id===id)" class="resource-delete" type="button" :disabled="disabled" @click="emit('remove',id)">删除整张表单</button>
    </div>
    <details v-if="!disabled && (!workspaceEdition || workspaceTools)" class="form-batch" @toggle="manageForms=($event.target as HTMLDetailsElement).open"><summary>批量管理表单</summary>
      <PlatformSelectionBar v-if="manageForms" :selected="formPick.selected.value.length" :total="catalogue.filter(c=>c.stored).length" label="已建表单" @all="formPick.toggleAll" @clear="formPick.clear"><button :disabled="!formPick.selected.value.length" @click="emit('batch',formPick.selected.value)">删除所选表单</button></PlatformSelectionBar>
      <div v-if="manageForms" class="local-tools"><label v-for="f in catalogue.filter(c=>c.stored)" :key="f.id"><input type="checkbox" :aria-label="'选择表单'+f.name" :checked="formPick.checked.value.has(f.id)" @change="formPick.toggle(f.id)">{{f.name}}</label></div></details>
    <div v-if="view==='schema'" class="pf-scroll"><table><thead><tr><th>字段名称</th><th>字段标识</th><th>类型</th><th>填写提示</th></tr></thead><tbody><tr v-for="f in tableFields(dataset)" :key="f.key"><td>{{f.label}}</td><td>{{f.key}}</td><td>{{formFieldTypes[f.type]}}</td><td>{{[f.required?'必填':'',f.unique?'值不可重复':'',f.hint].filter(Boolean).join(' · ')||'—'}}</td></tr></tbody></table></div>
    <template v-else>
    <div v-if="!workspaceEdition || workspaceTools" class="pf-bar pf-manage"><button type="button" :disabled="downloading" @click="exportTable(true)">Excel 模板</button>
      <button type="button" :disabled="disabled" @click="openImport">批量导入</button><select v-model="exportFormat" aria-label="导出格式"><option value="xlsx">Excel</option><option value="csv">CSV</option><option value="geojson">GeoJSON</option></select>
      <button type="button" :disabled="downloading" @click="exportTable()">导出当前结果</button>
      <button v-if="!workspaceEdition" type="button" class="pf-primary" :disabled="disabled" @click="openRecord()">新增记录</button></div>
    <div class="pf-bar workspace-form-search"><input v-model="keyword" type="search" aria-label="搜索表单记录" placeholder="搜索名称、编号或填报内容">
      <select v-model="region" aria-label="按行政区筛选"><option value="">全部行政区</option><option v-for="s in regions" :key="s">{{s}}</option></select>
      <button v-if="workspaceEdition" type="button" class="pf-primary" :disabled="disabled" @click="openRecord()">新增记录</button>
    </div>
    <p v-if="notice" role="status" class="pf-notice">{{notice}}</p>
    <PlatformSelectionBar v-if="!disabled && (!workspaceEdition || workspaceTools || selectedRows.selected.value.length)" :selected="selectedRows.selected.value.length" :total="filtered.length" label="表单记录" @all="selectedRows.toggleAll" @clear="selectedRows.clear"><button :disabled="!selectedRows.selected.value.length" @click="deleteSelected">删除所选记录</button></PlatformSelectionBar>
    <div class="pf-scroll"><table><thead><tr><th v-if="!disabled">选择</th><th>记录名称</th><th>行政区</th><th v-for="[key,label] in columns" :key="key">{{label}}</th><th>操作</th></tr></thead>
      <tbody><tr v-for="row in rows" :key="row.id"><td v-if="!disabled"><input type="checkbox" :aria-label="'选择记录'+row.properties.name" :checked="selectedRows.checked.value.has(row.id)" @change="selectedRows.toggle(row.id)"/></td><td>{{row.properties.name}}<small v-if="row.properties.sample===true">演示记录</small></td><td>{{row.properties.region}}</td>
        <td v-for="[key,label] in columns" :key="key">
          <form v-if="inline?.id===row.id && inline.field.key===key" class="pf-inline" @submit.prevent="applyCell(row)" @keydown.esc.prevent="inline=undefined">
            <select v-if="inline.field.type==='select'||inline.field.type==='boolean'" v-model="inline.value" :aria-label="label"><option value="">请选择</option><template v-if="inline.field.type==='boolean'"><option value="true">是</option><option value="false">否</option></template><template v-else><option v-for="o in inline.field.options" :key="o">{{o}}</option></template></select>
            <textarea v-else-if="inline.field.type==='textarea'" v-model="inline.value" :aria-label="label"/>
            <input v-else v-model="inline.value" :aria-label="label" :placeholder="inline.field.type==='multiselect'?'多个选项以顿号分隔':inline.field.hint" :type="inline.field.type==='date'?'date':inline.field.type==='number'?'number':'text'" step="any">
            <div class="pf-actions"><button>应用</button><button type="button" @click="inline=undefined">取消</button></div><small v-if="inline.error" role="alert">{{inline.error}}</small>
          </form>
          <button v-else-if="dataset.formSchema && !disabled" type="button" class="pf-cell" :aria-label="'编辑'+row.properties.name+'的'+label" @click="editCell(row,key)">{{cell(row,key)}}</button>
          <template v-else>{{cell(row,key)}}</template>
        </td>
        <td><div class="pf-actions"><button type="button" :disabled="disabled" @click="openRecord(row)">编辑</button><button type="button" :disabled="disabled" @click="deleteRecord(row)">删除此记录</button></div></td></tr>
        <tr v-if="!rows.length"><td :colspan="columns.length+3">{{dataset.features.length?'没有符合筛选条件的记录':'暂无记录，可新增第一条填报。'}}</td></tr></tbody></table></div>
    <nav class="pf-pager" aria-label="表单分页"><span>共 {{filtered.length}} 条</span><select v-model.number="perPage" aria-label="每页记录数"><option v-for="n in [10,20,50]" :key="n" :value="n">{{n}} 条 / 页</option></select>
      <button type="button" :disabled="page<=1" @click="page--">上一页</button><span>{{page}} / {{pages}}</span><button type="button" :disabled="page>=pages" @click="page++">下一页</button></nav>
    </template>
    <dialog :class="{designing:settings}" ref="dialog" aria-labelledby="pf-title" @cancel.prevent="close()">
      <template v-if="show"><header class="pf-head"><h3 id="pf-title">{{show==='record'? dataset.name : show==='import'?'导入'+dataset.name:show==='edit-type'?'编辑表单结构':'新建表单类型'}}</h3><button type="button" @click="close()">关闭</button></header>
        <p v-if="error" class="pf-error" role="alert">{{error}}</p>
        <form v-if="show==='import'" @submit.prevent="applyImport"><div class="pf-fields">
          <label class="pf-wide">Excel、CSV 或 GeoJSON 文件<input type="file" aria-label="业务表单导入文件" accept=".xlsx,.csv,.geojson,.json" @change="readImport"></label>
          <label class="pf-wide">导入方式<select v-model="fileMode" aria-label="表单导入方式"><option value="merge">按记录 ID 更新或新增</option><option value="append">仅追加新记录</option><option value="replace">替换本表记录</option></select></label>
        </div>
          <p>{{fileMode==='merge'?'每条记录需提供 ID。同 ID 更新文件中提供的字段，其余记录和字段保留。':fileMode==='append'?'已有 ID 会提示冲突。缺少 ID 的记录将生成新编号。':'文件外的记录将从本表草稿移除。同 ID 记录会保留文件中未提供的历史字段。'}}</p>
          <p v-if="reading" role="status">正在读取文件…</p><p v-if="preview?.error" role="alert" class="pf-error">{{preview.error}}</p>
          <section v-if="preview?.plan" class="pf-preview" aria-label="表单导入预览">
            <h4>导入预览</h4><p>新增 {{preview.plan.added}} 条 · 匹配已有 {{preview.plan.updated}} 条 · 移除 {{preview.plan.removed}} 条</p>
            <p>导入后本表共 {{preview.plan.total}} 条记录</p>
            <ul v-if="preview.plan.first.length"><li v-for="item in preview.plan.first" :key="item.id">{{item.properties.name}} · {{item.properties.region}}</li></ul>
          </section>
          <footer><button type="button" @click="close()">取消</button><button class="pf-primary" :disabled="disabled || reading || !preview?.plan">确认导入草稿</button></footer>
        </form>
        <form v-else-if="show==='record' && editor" @submit.prevent="saveRecord"><div class="pf-fields">
          <label v-if="dataset.formSchema">记录名称<input v-model.trim="editor.properties.name" maxlength="120" required></label>
          <label v-if="operational">{{operational.linkLabel}}<select :aria-label="operational.linkLabel" :value="editor.properties[operational.linkKey]" required @change="pickLink(fieldValue($event))"><option value="">请选择</option>
            <option v-for="link in links" :key="link.id" :value="link.id">{{link.properties.name}}</option></select></label>
          <label>行政区<input v-model.trim="editor.properties.region" :readonly="!!operational" required maxlength="120" list="pf-regions"></label>
          <label v-if="dataset.id !== overviewCourtStatsId">数据性质<select aria-label="数据性质" :value="editor.properties.sample===true?'sample':'actual'" @change="write('sample',fieldValue($event)==='sample')"><option value="actual">正式填报</option><option value="sample">演示数据</option></select></label>
          <datalist id="pf-regions"><option v-for="r in regions" :key="r" :value="r"/></datalist>
        </div>
          <IndustryLedgerFields v-if="ledger" :ledger="ledger.id" :values="editor.properties" :enterprises="enterprises" @field="write"/>
          <div v-else class="pf-fields"><label v-for="f in fields" :key="f.key" :class="{'pf-wide':f.type==='textarea'}">{{f.label}}
            <select v-if="f.type==='select'" :aria-label="f.label" :required="f.required" :value="editor.properties[f.key]??''" @change="write(f.key,fieldValue($event))"><option value="">请选择</option><option v-for="o in f.options" :key="o">{{o}}</option></select>
            <div v-else-if="f.type==='multiselect'" class="pf-many"><label v-for="option in f.options" :key="option"><input type="checkbox" :checked="hasChoice(f.key,option)" @change="toggleChoice(f.key,option)">{{option}}</label></div>
            <select v-else-if="f.type==='boolean'" :aria-label="f.label" :required="f.required" :value="String(editor.properties[f.key]??'')" @change="write(f.key,fieldValue($event)===''?undefined:fieldValue($event)==='true')"><option value="">待填写</option><option value="true">是</option><option value="false">否</option></select>
            <textarea v-else-if="f.type==='textarea'" rows="3" maxlength="10000" :placeholder="f.hint" :required="f.required" :value="String(editor.properties[f.key]??'')" @input="write(f.key,fieldValue($event))"/>
            <input v-else :placeholder="f.hint" :type="f.type==='text'&&operational&&f.key==='month'?'month':f.type" :required="f.required" :step="f.type==='number'?'any':undefined" :value="editor.properties[f.key]??''" @input="write(f.key,f.type==='number'&&fieldValue($event)!==''?Number(fieldValue($event)):fieldValue($event))">
          </label></div>
          <div v-if="dataset.id !== overviewCourtStatsId && dataset.formSchema && ['Point','GeometryCollection'].includes(editor.geometry.type)" class="pf-fields"><label class="pf-flag pf-wide"><input v-model="positionEnabled" type="checkbox">附带地图点位</label><template v-if="positionEnabled"><label>经度<input v-model.number="longitude" required type="number" min="-180" max="180" step="any"></label><label>纬度<input v-model.number="latitude" required type="number" min="-90" max="90" step="any"></label></template></div>
          <footer><button type="button" @click="close()">取消</button><button class="pf-primary" :disabled="disabled">应用到草稿</button></footer>
        </form>
        <form v-else-if="settings" @submit.prevent="saveType"><div class="pf-fields">
          <label>表单名称<input v-model.trim="settings.name" required maxlength="120"></label><label>负责单位<input v-model.trim="settings.department" required maxlength="120"></label>
          <label class="pf-wide">表单说明<textarea v-model="settings.description" maxlength="800" rows="2"/></label></div>
          <PlatformFieldDesigner :fields="settings.fields" :locked="existingValue"/>
          <footer><button type="button" @click="close()">取消</button><button class="pf-primary" :disabled="disabled">应用到草稿</button></footer>
        </form>
      </template>
    </dialog>
  </section>
</template>

<style scoped>
.platform-forms { color:var(--platform-ink,#142e35);display:flex;flex-direction:column;gap:14px;min-width:0;min-height:0;overflow:auto;background:var(--platform-paper,#fff);padding:18px;border:1px solid var(--platform-line,#d8e4e3);border-radius:10px; }
.pf-bar,.pf-head,.pf-pager,.pf-actions,footer { display:flex;align-items:center;gap:8px;flex-wrap:wrap; }
.pf-head { justify-content:space-between; }.pf-head p { color:var(--platform-muted,#516d73);margin:4px 0 0; }
.pf-head h3,.platform-forms h4 {margin:0;color:inherit;}.pf-bar>label {display:flex;align-items:center;gap:8px}
.pf-preview {background:var(--platform-soft,#f1f7f5);padding:12px;border-radius:6px}.pf-preview :is(p,ul) {margin:6px 0}
.platform-forms :is(input,select,textarea,button),dialog :deep(:is(input,select,textarea)) {color:inherit;border:1px solid var(--platform-line,#d8e4e3);border-radius:5px;background:var(--platform-paper,#fff);padding:7px 10px;min-width:0;font:inherit}
.platform-forms button {cursor:pointer}.platform-forms button:disabled {opacity:.5;cursor:default}.platform-forms button.pf-primary {background:var(--platform-accent,#09675f);border-color:var(--platform-accent,#09675f);color:white}
.pf-bar input[type=search] {width:min(100%,320px)}.pf-scroll {overflow:auto;min-height:100px}.pf-scroll table {border-collapse:collapse;width:100%;font-size:inherit}
.pf-scroll :is(th,td) {text-align:left;padding:10px 8px;border-bottom:1px solid var(--platform-line,#d8e4e3);overflow-wrap:anywhere}.pf-scroll th {background:var(--platform-soft,#f1f7f5);white-space:nowrap;position:sticky;top:0;color:inherit}
.pf-scroll small {display:block;color:var(--platform-muted,#516d73)}.pf-actions {flex-wrap:nowrap}.pf-actions button {white-space:nowrap}
.pf-pager,footer {justify-content:flex-end}.pf-notice {color:var(--platform-accent,#09675f);margin:0}.pf-error {color:#f7a998;border-left:3px solid;padding:7px 10px;background:#39282b}
dialog {width:min(720px,calc(100vw - 24px));max-height:85dvh;overflow:auto;border:1px solid var(--platform-line,#d8e4e3);border-radius:10px;background:var(--platform-paper,#fff);color:var(--platform-ink,#142e35);padding:20px;box-sizing:border-box;}
dialog::backdrop {background:rgba(16,40,44,.46)} dialog>:first-child {margin-bottom:16px}
.pf-fields,.pf-fieldrow,dialog :deep(.ledger-fields) {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:14px}
.pf-fields label,.pf-fieldrow label,dialog :deep(.ledger-fields label) {display:grid;gap:5px;min-width:0}.pf-wide {grid-column:1/-1}
.pf-fieldrow {grid-template-columns:minmax(100px,1fr) minmax(100px,1fr) auto auto;align-items:end;background:var(--platform-soft,#f1f7f5);padding:10px;border-radius:6px}
label.pf-flag {display:flex;align-items:center;align-self:center}.pf-flag input {width:auto} footer {margin-top:16px}
@media(max-width:700px){.platform-forms {padding:12px}.pf-fields,.pf-fieldrow,dialog :deep(.ledger-fields) {grid-template-columns:1fr 1fr}.pf-scroll td:first-child {min-width:120px}}
@media(max-width:460px){.pf-fields,dialog :deep(.ledger-fields) {grid-template-columns:1fr}.pf-head {align-items:flex-start}.pf-pager {justify-content:flex-start}}
.pf-viewbar{justify-content:space-between;border-bottom:1px solid var(--platform-line);padding-bottom:10px}
.pf-viewbar>span,.pf-owner{color:var(--platform-muted);font-size:16px}.pf-views{display:flex;gap:4px}
.pf-views button[aria-pressed=true]{color:var(--platform-accent);background:var(--platform-soft);border-color:var(--platform-accent)}
.pf-manage select{max-width:140px}.pf-many{display:flex;align-items:center;flex-wrap:wrap;gap:10px}.pf-many label{display:flex;gap:4px}
.pf-inline{display:grid;gap:5px;min-width:145px}.platform-forms .pf-cell{padding:3px 0;border:none;background:transparent;text-align:left}.pf-cell:hover,.pf-cell:focus-visible{text-decoration:underline;color:var(--platform-accent)}
.pf-pager{flex-wrap:nowrap;white-space:nowrap;overflow-x:auto;justify-content:safe flex-end}
dialog.designing{width:min(1080px,calc(100vw - 30px))}
.platform-forms button.pf-primary{background:#176f72;border-color:#318f91;color:#f2ffff}
.platform-forms button.pf-primary:hover:not(:disabled){background:#1b7477}
dialog :deep(.fd-panel :is(input,select,textarea,button)),dialog :deep(.fd-tabs button){font:inherit;color:inherit;background:var(--platform-paper,#fff);border:1px solid var(--platform-line,#d8e4e3);border-radius:5px;padding:7px 9px;min-width:0}
dialog :deep(.fd-controls button.chosen),dialog :deep(.fd-tabs button[aria-pressed=true]){border-color:var(--platform-accent);color:var(--platform-accent)}
</style>
