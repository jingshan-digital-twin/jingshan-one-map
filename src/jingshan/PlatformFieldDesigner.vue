<script setup lang="ts">
import { computed, ref } from 'vue'
import { formFieldTypes } from './platform-forms.ts'
import type { FormField } from './types.ts'
import { formId } from './form-designer-id.ts'

const props=defineProps<{ fields:FormField[]; locked:(key:string)=>boolean }>()
const active=ref(0), preview=ref(false)
const selected=computed(()=>props.fields[active.value])
const symbols:Record<FormField['type'],string>={text:'T',textarea:'¶',number:'#',date:'▦',select:'◉',boolean:'✓',multiselect:'☑'}
function add(type:FormField['type']){
  if(props.fields.length>=60)return
  props.fields.push({key:'field_'+formId().slice(0,12),label:'',type,...(['select','multiselect'].includes(type)?{options:['选项一','选项二']}: {})})
  active.value=props.fields.length-1
}
function move(delta:number) {
  const i=active.value,j=i+delta
  if(j<0||j>=props.fields.length)return
  const [current]=props.fields.splice(i,1)
  props.fields.splice(j,0,current)
  active.value=j
}
function remove(){
  if(props.fields.length===1||props.locked(selected.value.key))return
  props.fields.splice(active.value,1)
  active.value=Math.min(active.value,props.fields.length-1)
}
const read = (event:Event)=>(event.target as HTMLInputElement).value
function updateDefault(value:string) {
  const f=selected.value
  if(value===''){delete f.defaultValue;return}
  f.defaultValue=f.type==='number'?Number(value):f.type==='boolean'?value==='true':value
}
const transfer='application/x-jingshan-form-field'
function dropField(event:DragEvent) {
  const type=event.dataTransfer?.getData(transfer) as FormField['type']
  if(type && Object.hasOwn(formFieldTypes,type)) add(type)
}
</script>
<template>
 <div class="fd-tabs"><button type="button" :aria-pressed="!preview" @click="preview=false">表单设计</button><button type="button" :aria-pressed="preview" @click="preview=true">填报预览</button></div>
 <div v-if="!preview" class="fd-grid">
   <aside class="fd-panel"><h4>字段控件库</h4><div class="fd-controls">
     <button v-for="(label,type) in formFieldTypes" :key="type" type="button" draggable="true" :disabled="fields.length>=60" @dragstart="$event.dataTransfer?.setData(transfer,type)" @click="add(type)">
       <b>{{symbols[type]}}</b>{{label}}<span>＋</span>
     </button>
   </div></aside>
   <section class="fd-panel" @dragover.prevent @drop.prevent="dropField"><h4>表单画布 <small>{{fields.length}} 个字段</small></h4>
     <div class="fd-controls"><button v-for="(f,i) in fields" :key="f.key" type="button" :class="{chosen:i===active}" @click="active=i">
       <b>{{symbols[f.type]}}</b><strong>{{f.label||'未命名字段'}} <i v-if="f.required">*</i></strong><small>{{formFieldTypes[f.type]}}</small>
     </button></div>
     <div class="fd-tools"><button type="button" :disabled="active===0" @click="move(-1)">上移</button><button type="button" :disabled="active===fields.length-1" @click="move(1)">下移</button>
       <button type="button" :disabled="fields.length===1 || locked(selected.key)" @click="remove">移除</button></div>
   </section>
   <aside class="fd-panel fd-props"><h4>字段属性</h4>
     <label>字段名称<input v-model="selected.label" required maxlength="60" placeholder="输入字段名称"></label>
     <label>字段标识<input :value="selected.key" disabled></label>
     <label>提示文字<input v-model="selected.hint" maxlength="180" placeholder="选填"></label>
     <label v-if="selected.type==='select'||selected.type==='multiselect'">选项（每行一项）<textarea :value="selected.options?.join('\n')" rows="4" @change="selected.options=read($event).split(/\r?\n/).map(v=>v.trim()).filter(Boolean)"/></label>
     <label v-if="selected.type!=='multiselect'">默认值
       <select v-if="selected.type==='select'||selected.type==='boolean'" :value="String(selected.defaultValue??'')" @change="updateDefault(read($event))">
         <option value="">无默认值</option><template v-if="selected.type==='boolean'"><option value="true">是</option><option value="false">否</option></template>
         <template v-else><option v-for="opt in selected.options" :key="opt">{{opt}}</option></template></select>
       <input v-else :type="selected.type==='number'?'number':selected.type==='date'?'date':'text'" step="any" :value="selected.defaultValue??''" @input="updateDefault(read($event))">
     </label>
     <label class="fd-check"><input v-model="selected.required" type="checkbox">必填</label>
     <label class="fd-check"><input v-model="selected.unique" type="checkbox">值不可重复</label>
   </aside>
 </div>
 <div v-else class="fd-preview fd-panel"><h4>填报预览</h4><label v-for="f in fields" :key="f.key">{{f.label||'未命名字段'}} {{f.required?'*':''}}
   <select v-if="f.type==='select'||f.type==='multiselect'||f.type==='boolean'" :multiple="f.type==='multiselect'" :value="String(f.defaultValue??'')">
      <option value="">请选择</option><template v-if="f.type==='boolean'"><option value="true">是</option><option value="false">否</option></template><template v-else><option v-for="o in f.options" :key="o">{{o}}</option></template></select>
   <textarea v-else-if="f.type==='textarea'" :placeholder="f.hint" :value="String(f.defaultValue??'')"></textarea>
   <input v-else :type="f.type" :placeholder="f.hint" :value="f.defaultValue??''">
 </label></div>
</template>
<style scoped>
.fd-grid{display:grid;grid-template-columns:minmax(140px,.8fr) minmax(210px,1.5fr) minmax(170px,1fr);gap:14px;align-items:start}
.fd-panel{padding:16px;background:var(--platform-soft,#192733);border:1px solid var(--platform-line,#30444d);border-radius:9px;min-width:0}
.fd-panel h4{display:flex;align-items:center;justify-content:space-between;margin:0 0 14px;font-size:17px}
.fd-panel small{font-size:16px;color:var(--platform-muted,#a7b8c2);font-weight:400}
.fd-controls,.fd-props{display:grid;gap:8px}.fd-props label,.fd-preview label{display:grid;gap:4px}
.fd-tabs,.fd-tools{display:flex;gap:6px;margin:10px 0 14px}
.fd-tools{margin:16px 0 0;flex-wrap:wrap}.fd-tabs button[aria-pressed=true],.fd-controls button.chosen{border-color:#47cdd2;background:var(--platform-soft,#253f4a);color:var(--platform-ink,#e4f4f5)}
.fd-controls button{display:flex;align-items:center;gap:10px;text-align:left;width:100%;min-height:43px}
.fd-controls b{color:var(--platform-accent,#62d9df);width:20px;text-align:center}.fd-controls strong{font-weight:500;overflow-wrap:anywhere}
.fd-controls span,.fd-controls small{margin-left:auto}.fd-controls i{color:#f79b90}
.fd-props .fd-check{display:flex;align-items:center;gap:8px}.fd-check input{width:auto}
.fd-preview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}.fd-preview h4{grid-column:1/-1}
@media(max-width:820px){.fd-grid{grid-template-columns:1fr 1fr}.fd-props{grid-column:1/-1;grid-template-columns:repeat(2,minmax(0,1fr))}.fd-props h4{grid-column:1/-1}}
@media(max-width:480px){.fd-grid,.fd-props,.fd-preview{grid-template-columns:1fr}.fd-grid>aside:first-child .fd-controls{grid-template-columns:1fr 1fr}.fd-grid>aside:first-child .fd-controls button{gap:5px}.fd-grid>aside:first-child .fd-controls span{display:none}}
</style>

