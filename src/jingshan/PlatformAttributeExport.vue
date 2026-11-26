<script setup lang="ts">
import { ref, watch } from 'vue'
import type { CityFeature, Dataset } from './types.ts'
import { downloadAttributeTable } from './platform-attribute-table.ts'

const props=defineProps<{dataset:Dataset; rows?:CityFeature[]; rasterIds?:string[]; query?:string; filtered?:boolean}>()
const busy=ref(false), error=ref('')
watch(()=>props.dataset.id,()=>{ error.value='' })
async function download() {
  if (busy.value) return
  const id=props.dataset.id
  busy.value=true
  error.value=''
  try { await downloadAttributeTable(props.dataset,props.rows,props.query,props.filtered,props.rasterIds) }
  catch (e) { if (props.dataset.id===id) error.value=e instanceof Error ? e.message : '属性表导出失败' }
  finally { busy.value=false }
}
</script>
<template>
  <button type="button" :disabled="busy" :aria-busy="busy" :title="filtered ? '导出全部符合筛选条件的记录' : '导出当前资源的全部属性记录'" @click="download">
    {{ busy ? '正在生成 Excel…' : filtered ? '导出筛选结果（Excel）' : '导出属性表（Excel）' }}
  </button>
  <span v-if="error" role="alert">{{ error }}</span>
</template>
