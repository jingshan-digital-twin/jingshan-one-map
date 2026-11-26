<script setup lang="ts">
import { workspaceEdition, workspaceArtwork } from './workspace-artwork'
import './workspace-ledgers.css'
import { onMounted, ref } from 'vue'
import { api, jsonRequest } from './api.ts'
import { pages } from './v3-navigation.ts'
import type { Result } from './types.ts'

type Row = Omit<Result, 'features'> & {featureCount:number}
const statuses = {pending:'待接收',received:'办理中',completed:'已回流'}
const cardTime = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})
const emit = defineEmits<{ updated: [item:Result] }>()
const rows=ref<Row[]>([])
const query=ref('')
const keyword=ref('')
const status=ref('')
const busy=ref(false)
const hasMore=ref(false)
const error=ref('')
const details=ref<Row>()
function sceneName(row:Row) { return row.scene==='talent' ? '人才服务' : pages[row.scene].label }
function message(e:unknown) { return e instanceof Error ? e.message : String(e) }
async function load(more=false) {
  if (busy.value) return
  busy.value=true
  error.value=''
  if (!more) keyword.value=query.value.trim()
  const params=new URLSearchParams({view:'list',q:keyword.value,status:status.value})
  if (more && rows.value.length) params.set('before',String(rows.value[rows.value.length-1].id))
  try {
    const result=await api<{items:Row[];more:boolean}>('/results?'+params)
    rows.value=more ? [...rows.value,...result.items] : result.items
    hasMore.value=result.more
  } catch(e) { error.value=message(e) }
  finally { busy.value=false }
}
async function advance(row:Row) {
  if (busy.value || row.status==='completed') return
  busy.value=true
  error.value=''
  try {
    const updated=await api<Result>('/results/'+row.id,jsonRequest('PATCH',{status:row.status==='pending'?'received':'completed'}))
    row.status=updated.status
    if (status.value && status.value!==updated.status) rows.value=rows.value.filter(item=>item.id!==row.id)
    if (details.value?.id===row.id) details.value=row
    emit('updated',updated)
  } catch(e) { error.value=message(e) }
  finally { busy.value=false }
}
onMounted(()=>load())
</script>

<template>
  <section class="data-table admin-results" aria-label="成果台账">
    <div class="data-table-head"><h3 v-if="!workspaceEdition">成果台账</h3><button type="button" :disabled="busy" @click="load()">刷新台账</button></div>
    <form class="table-tools" @submit.prevent="load()"><input v-model="query" type="search" aria-label="搜索成果" placeholder="搜索标题、承办部门或摘要" maxlength="120" />
      <select v-model="status" aria-label="办理状态" :disabled="busy" @change="load()"><option value="">全部状态</option><option v-for="(name,key) in statuses" :key="key" :value="key">{{ name }}</option></select>
      <button type="submit" :disabled="busy">查询</button></form>
    <p v-if="error" class="message error" role="alert">{{ error }}</p>
    <div v-if="workspaceEdition" class="workspace-results-board">
      <section v-for="(label, key) in statuses" :key="key" :data-status="key" :aria-label="label">
        <header><i aria-hidden="true"></i><h3>{{label}}</h3><span :title="hasMore ? '当前已加载的成果数' : '成果数'">{{rows.filter(row=>row.status===key).length}}</span></header>
        <article v-for="row in rows.filter(item=>item.status===key)" :key="row.id">
          <small><img :src="workspaceArtwork(row.title+' '+sceneName(row))" alt="">{{sceneName(row)}} · V{{row.version}}</small>
          <button type="button" class="result-title" @click="details=row">{{row.title}}</button>
          <p>{{row.department}}</p>
          <footer><time :datetime="row.createdAt" :title="new Date(row.createdAt).toLocaleString('zh-CN')">{{cardTime.format(new Date(row.createdAt))}}</time>
            <button v-if="row.status!=='completed'" type="button" :disabled="busy" @click="advance(row)">{{row.status==='pending'?'接收':'完成回流'}}</button>
            <button v-else type="button" @click="details=row">查看</button></footer>
        </article>
        <p v-if="!rows.some(row=>row.status===key)" class="result-empty">{{busy ? '正在读取…' : '暂无成果'}}</p>
      </section>
    </div>
    <div v-else class="table-scroll"><table><thead><tr><th>成果名称</th><th>承办部门</th><th>登记时间</th><th>状态</th><th>操作</th></tr></thead>
      <tbody><tr v-for="row in rows" :key="row.id"><td>{{ row.title }}<small>{{ sceneName(row) }} · V{{ row.version }}</small></td>
        <td>{{ row.department }}</td><td>{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</td><td>{{ statuses[row.status] }}</td><td class="table-actions">
          <button type="button" @click="details=row">查看</button>
          <button v-if="row.status!=='completed'" type="button" :disabled="busy" @click="advance(row)">{{ row.status==='pending' ? '接收' : '完成回流' }}</button></td></tr>
        <tr v-if="!rows.length"><td colspan="5">{{ busy ? '正在读取成果…' : '没有匹配的成果' }}</td></tr></tbody></table></div>
    <div v-if="hasMore" class="pagination"><span>已显示 {{ rows.length }} 条</span><button type="button" :disabled="busy" @click="load(true)">加载更多</button></div>
    <div v-if="details" class="admin-overlay"><section class="admin-form modal-box" role="dialog" aria-modal="true" :aria-label="details.title">
      <h3>{{ details.title }}</h3><p>{{ details.summary }}</p><p>{{ details.department }} · {{ statuses[details.status] }} · {{ details.featureCount }} 个空间要素</p>
      <div class="modal-actions"><button type="button" @click="details=undefined">关闭</button></div></section></div>
  </section>
</template>

<style scoped>
.admin-results { flex: 1; }
.admin-results .table-tools { flex-wrap: wrap; }
.admin-results .table-tools select { width: auto; }
.admin-results table { min-width: 550px; }
.admin-results :is(td,th){white-space:nowrap}.admin-results td:first-child{white-space:normal;min-width:165px}
@media(max-width:560px){.admin-results .table-tools{display:grid;grid-template-columns:minmax(0,1fr) auto}.admin-results .table-tools input{grid-column:1/-1;width:100%;min-width:0}.admin-results .table-tools select{width:100%}}
</style>
