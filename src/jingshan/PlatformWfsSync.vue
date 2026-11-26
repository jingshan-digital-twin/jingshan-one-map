<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import type { FeatureCollection } from 'geojson'
import type { CimService } from './cim-types.ts'
import type { DataDocument, Dataset } from './types.ts'
import { api } from './api.ts'
import { prepareWfsSync } from './platform-wfs-sync.ts'
const props=defineProps<{document:DataDocument; dataset:Dataset; service:CimService}>()
const emit=defineEmits<{close:[];update:[value:DataDocument]}>()
const dialog=ref<HTMLDialogElement>()
const collection=shallowRef<FeatureCollection>()
const fields=reactive({identifier:'',name:'',region:''})
const review=shallowRef<ReturnType<typeof prepareWfsSync>>()
const feedback=ref('')
const loading=ref(true)
const abort=new AbortController()
const keys=computed(()=>[...new Set(collection.value?.features.flatMap(f=>Object.keys(f.properties??{})) ?? [])].sort())
watch(fields,()=>{review.value=undefined;feedback.value=''})
watch(()=>props.document,()=>emit('close'))
async function load() {
  loading.value=true
  feedback.value=''
  try {
    collection.value=await api<FeatureCollection>('/cim/services/'+encodeURIComponent(props.service.id)+'/features',{signal:abort.signal})
    fields.name=['name','名称','gcmc','gymc','mc'].find(key=>keys.value.includes(key))??''
    fields.region=['region','所属乡镇','xzjxzqhmc','xzmc','town'].find(key=>keys.value.includes(key))??''
  } catch(error) {if(!abort.signal.aborted) feedback.value=error instanceof Error ? error.message : '要素服务读取失败'}
  finally { loading.value=false }
}
function inspect() {
  if(!collection.value) return
  try {review.value=prepareWfsSync(props.document,props.dataset,props.service,collection.value,fields);feedback.value=''}
  catch(error){feedback.value=error instanceof Error?error.message:'无法同步';review.value=undefined}
}
onMounted(()=>{dialog.value?.showModal();void load()})
onBeforeUnmount(()=>abort.abort())
</script>
<template>
  <dialog ref="dialog" aria-labelledby="wfs-sync-heading" @cancel.prevent="emit('close')">
    <header><h2 id="wfs-sync-heading">同步服务要素</h2><button @click="emit('close')" aria-label="关闭同步窗口">×</button></header>
    <p>{{ service.name }} → {{ dataset.name }}</p>
    <p v-if="loading" role="status">正在读取服务要素…</p>
    <template v-else-if="collection?.features.length">
      <div class="field-list">
        <label>来源编号<select v-model="fields.identifier"><option value="">要素 ID</option><option v-for="key in keys" :key="key">{{key}}</option></select></label>
        <label>名称字段<select v-model="fields.name"><option value="">请选择</option><option v-for="key in keys" :key="key">{{key}}</option></select></label>
        <label>所属区域<select v-model="fields.region"><option value="">保留原区域，新增记录归入京山市</option><option v-for="key in keys" :key="key">{{key}}</option></select></label>
      </div>
      <p>{{ collection.features.length }} 条来源记录。按来源编号合并，其余业务记录保留。</p>
      <div v-if="review" class="wfs-review" role="status"><strong>新增 {{review.added}} 条　更新 {{review.updated}} 条</strong>
        <p>合并后共 {{review.total}} 条</p><ul><li v-for="row in review.first" :key="row.id">{{row.properties.name}} · {{row.properties.region}}</li></ul></div>
    </template>
    <p v-else-if="collection">此服务没有要素</p>
    <p v-if="feedback" role="alert">{{feedback}}</p>
    <footer><button @click="emit('close')">取消</button><button v-if="!loading && !collection" @click="load">重新读取</button>
      <button v-else-if="!review" class="primary" :disabled="!collection?.features.length || !fields.name" @click="inspect">预览合并</button>
      <button v-else class="primary" @click="emit('update',review.data);emit('close')">合并到草稿</button>
    </footer>
  </dialog>
</template>
<style scoped>
dialog{color:var(--platform-ink);background:var(--platform-paper);border:1px solid var(--platform-line);width:min(490px,94vw);padding:22px;border-radius:12px}
dialog::backdrop{background:#050b15b8}
header,footer{display:flex;align-items:center;justify-content:space-between;gap:12px}
h2{margin:0;font-size:21px}p{color:var(--platform-muted)}.field-list{display:grid;gap:12px}.field-list label{display:grid;gap:4px}
.wfs-review{border-left:3px solid var(--cyan);padding:10px 14px;background:var(--platform-soft)}.wfs-review p,.wfs-review ul{margin:4px 0}
footer{justify-content:flex-end;margin-top:18px}
</style>
