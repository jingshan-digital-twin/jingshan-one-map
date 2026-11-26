<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {attributeFields} from './platform-attribute-table'
import {matchingRasterCells,populationCell,populationCellAttributes,populationCellId,populationRaster,rasterCellById} from './population-raster'
import type {CityFeature,Dataset} from './types'
import PlatformSelectionBar from './PlatformSelectionBar.vue'
import {useTableSelection} from './platform-selection'
const props=defineProps<{dataset:Dataset; picked?:{id:string;serial:number}}>()
const emit=defineEmits<{locate:[row:CityFeature];selection:[ids:string[]];close:[]}>()
const text=(v:unknown)=>v==null?'':typeof v==='object'?JSON.stringify(v):String(v)
const search=ref(''),field=ref(''),page=ref(1),size=25
const grid=computed(()=>populationRaster(props.dataset))
const sample=computed(()=>{
  const g=grid.value
  if(!g)return props.dataset
  const cell=matchingRasterCells(g).next().value
  return {...props.dataset,features:cell?[populationCell(cell.block,cell.index)]:[]}
})
const fields=computed(()=>attributeFields(sample.value))
const byId=computed(()=>new Map(props.dataset.features.map(f=>[f.id,f])))
const ids=computed(()=>{
  const key=search.value.trim().toLocaleLowerCase(), f=fields.value.find(c=>c.label===field.value)
  const g=grid.value
  if(!g)return props.dataset.features.filter(row=>!key || (f?text(f.read(row)):row.id+' '+JSON.stringify(row.properties)+' '+(row.geometry.type==='Point'?row.geometry.coordinates.join(' '):'')).toLocaleLowerCase().includes(key)).map(row=>row.id)
  const result:string[]=[]
  for(const {block,index} of matchingRasterCells(g)){
    const id=populationCellId(block,index)
    if(key){
      const val=f?f.read(populationCell(block,index)):id+' '+JSON.stringify(populationCellAttributes(block,index))
      if(!text(val).toLocaleLowerCase().includes(key))continue
    }
    result.push(id)
  }
  return result
})
const selection=useTableSelection(ids,[()=>props.dataset.id,search,field])
const pages=computed(()=>Math.max(1,Math.ceil(ids.value.length/size)))
function rowAt(id:string){
  const g=grid.value
  if(!g)return byId.value.get(id)
  const hit=rasterCellById(g,id);return hit?populationCell(hit.block,hit.index):undefined
}
const rows=computed(()=>ids.value.slice((page.value-1)*size,page.value*size).flatMap(id=>rowAt(id)??[]))
watch([search,field,()=>props.dataset.id],()=>page.value=1,{flush:'sync'})
watch(pages,n=>page.value=Math.min(n,page.value))
watch(selection.selected,keys=>emit('selection',keys))
watch(()=>props.picked,p=>{
  if(!p || !rowAt(p.id))return
  if(!ids.value.includes(p.id)){search.value='';field.value=''}
  const i=ids.value.indexOf(p.id);if(i<0)return
  page.value=Math.floor(i/size)+1
  if(!selection.checked.value.has(p.id))selection.toggle(p.id)
},{immediate:true})
</script>
<template><section class="spatial-table" aria-label="图层属性表">
<header><h3>{{dataset.name}} · 属性表</h3><button type="button" aria-label="关闭属性表" @click="emit('close')">×</button></header>
<div class="table-search"><select v-model="field" aria-label="查询字段"><option value="">全部字段</option><option v-for="c in fields" :key="c.label">{{c.label}}</option></select>
<input v-model.trim="search" type="search" aria-label="搜索属性值" placeholder="搜索属性值或编号"></div>
<PlatformSelectionBar :total="ids.length" :selected="selection.selected.value.length" label="属性记录" @all="selection.toggleAll" @clear="selection.clear"/>
<div class="grid-scroll"><table><thead><tr><th>选择</th><th>地图</th><th v-for="c in fields" :key="c.label">{{c.label}}</th></tr></thead>
<tbody><tr v-for="r in rows" :key="r.id" :class="{chosen:selection.checked.value.has(r.id)}"><td><input type="checkbox" :aria-label="'选择属性记录'+r.id" :checked="selection.checked.value.has(r.id)" @change="selection.toggle(r.id)"></td><td><button :disabled="r.geometry.type==='GeometryCollection'" @click="emit('locate',r)">定位</button></td>
<td v-for="c in fields" :key="c.label"><details v-if="text(c.read(r)).length>55"><summary>{{text(c.read(r)).slice(0,35)}}…</summary>{{text(c.read(r))}}</details><span v-else>{{text(c.read(r))||'—'}}</span></td></tr></tbody></table></div>
<footer><span>{{ids.length.toLocaleString()}} 条 · {{fields.length}} 个字段</span><button :disabled="page<=1" @click="page--">上一页</button>{{page}} / {{pages}}<button :disabled="page>=pages" @click="page++">下一页</button></footer></section></template>
<style scoped>.spatial-table{background:var(--platform-paper,#fff);color:var(--platform-ink,#143941);border:1px solid var(--platform-line,#b8d3d6);border-radius:10px;padding:12px;min-width:0;display:grid;gap:6px}.spatial-table header,.spatial-table footer,.table-search{display:flex;align-items:center;gap:10px}.spatial-table header h3{margin:0;flex:1;font-size:17px}.table-search input{flex:1;min-width:0}.table-search select{max-width:38%}.grid-scroll{max-height:34vh;overflow:auto}.spatial-table table{border-collapse:collapse;width:max-content;min-width:100%}.spatial-table td,.spatial-table th{max-width:370px;padding:5px 9px;text-align:left;border:1px solid var(--platform-line,#d3e2e2);overflow-wrap:anywhere}.spatial-table th{background:var(--platform-soft,#eaf3f4);color:var(--platform-ink,#23434b);position:sticky;top:0;white-space:nowrap}.spatial-table .chosen{background:var(--platform-soft,#e0f3ee);color:var(--platform-accent,#103b39);box-shadow:inset 3px 0 var(--platform-accent,#127f72)}.spatial-table footer{justify-content:flex-end}.spatial-table footer span{margin-right:auto}.spatial-table input[type=checkbox]{width:16px;height:16px}.spatial-table button{cursor:pointer}</style>
