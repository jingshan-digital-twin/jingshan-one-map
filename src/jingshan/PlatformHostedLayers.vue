<script setup lang="ts">
import { workspaceEdition, workspaceArtwork } from './workspace-artwork'
import { computed, ref, watch } from 'vue'
import { api, jsonRequest } from './api'
import type { CimAdminService } from './cim-types'
import { populationRecordCount } from './population-raster'
import { isPlatformFormDataset } from './platform-forms'
import { publishedLayerUrl } from './platform-resource-inspect'
import { platformLink } from './platform-navigation'
import type { DataDocument } from './types'
const props=defineProps<{published:DataDocument;draft?:DataDocument;services:CimAdminService[];initialDataset?:string}>()
const emit=defineEmits<{registered:[service:CimAdminService]}>()
const busy=ref(''),feedback=ref('')
const registered=computed(()=>new Map(props.services.filter(s=>s.hostedDatasetId).map(s=>[s.hostedDatasetId,s])))
async function publish(id:string){
  busy.value=id;feedback.value=''
  try {const service=await api<CimAdminService>('/cim/admin/hosted/'+encodeURIComponent(id),jsonRequest('POST',{}));emit('registered',service);feedback.value=service.name+'已发布为 GeoJSON 服务'}
  catch(e){feedback.value=e instanceof Error ? e.message : '发布失败'} finally {busy.value=''}
}
const search=ref(props.initialDataset ?? ''), page=ref(1), copied=ref('')
const resources=computed(()=>props.published.datasets.filter(d=>!isPlatformFormDataset(d) && !d.derivedFrom))
const rows=computed(()=>resources.value.filter(d=>(d.name+' '+d.id+' '+d.category+' '+d.department).includes(search.value.trim())))
const pages=computed(()=>Math.max(1,Math.ceil(rows.value.length/10)))
watch(()=>props.initialDataset,id=>{search.value=id ?? ''})
watch(search,()=>{page.value=1})
watch(pages,n=>{page.value=Math.min(page.value,n)})
function publicationState(id:string) {
  if (props.draft && !props.draft.datasets.some(d=>d.id===id)) return '源数据待删除'
  const service=registered.value.get(id)
  if (!service) return '尚未发布服务'
  if (props.draft?.serviceRemovals?.some(s=>s.id===service.id)) return '待下线'
  return service.enabled ? '已发布服务' : '服务已停用'
}
const newLayers=computed(()=>props.draft?.datasets.filter(d=>!isPlatformFormDataset(d) && !d.derivedFrom && !resources.value.some(r=>r.id===d.id)) ?? [])
async function copy(id:string){
  const url=new URL(registered.value.get(id)?.mapUrl ?? publishedLayerUrl(id), location.href).href
  try {await navigator.clipboard.writeText(url);copied.value=id}
  catch {copied.value=url}
}
</script>
<template>
  <section class="hosted-work">
    <div class="hosted-head"><div><h3>从空间源数据发布地图服务</h3><p>选择已发布版本中的数据集，为地图生成 GeoJSON 接口。</p></div><a :href="platformLink('local')">导入空间文件</a></div>
    <div v-if="newLayers.length" class="hosted-pending">草稿中新增的数据集需先发布版本 · {{newLayers.map(d=>d.name).join('、')}} <a :href="platformLink('versions')">前往发布</a></div>
    <input type="search" v-model="search" placeholder="搜索源数据集、分类或部门" aria-label="搜索源数据集">
    <aside v-if="workspaceEdition" class="workspace-hosted-list"><h3>已托管服务</h3>
      <a v-for="svc in [...registered.values()].slice(0,6)" :key="svc.id" :href="platformLink('services',svc.id)"><img :src="workspaceArtwork(svc.name)" alt=""><span>{{svc.name}}<small>{{svc.enabled?'已启用':'已停用'}}</small></span></a>
      <p v-if="!registered.size">暂无已托管服务</p></aside>
    <div class="table-scroll"><table><thead><tr><th>源数据集</th><th>服务状态</th><th>提供部门</th><th>要素数</th><th>服务操作</th></tr></thead><tbody>
      <tr v-for="row in rows.slice((page-1)*10,page*10)" :key="row.id">
        <td><b>{{row.name}}</b><small>{{row.id}}</small></td><td>{{publicationState(row.id)}}</td><td>{{row.department}}</td><td>{{populationRecordCount(row).toLocaleString()}}</td>
        <td class="hosted-links">
          <button v-if="publicationState(row.id)==='尚未发布服务'" type="button" :disabled="!!busy" @click="publish(row.id)">{{busy===row.id ? '发布中…' : '发布为地图服务'}}</button>
          <template v-if="registered.has(row.id) && !['源数据待删除','待下线'].includes(publicationState(row.id))">
            <a :href="platformLink('services',registered.get(row.id)!.id)">管理服务</a>
            <a v-if="registered.get(row.id)!.enabled" :href="registered.get(row.id)!.mapUrl" target="_blank" rel="noopener">读取接口</a>
            <button type="button" @click="copy(row.id)">{{copied===row.id ? '已复制' : '复制地址'}}</button>
          </template>
          <a v-if="publicationState(row.id)!=='源数据待删除'" :href="platformLink('local',row.id)">查看源数据</a>
        </td>
      </tr>
      <tr v-if="!rows.length"><td colspan="5">没有匹配的源数据集</td></tr>
    </tbody></table></div>
    <p v-if="feedback" role="status">{{feedback}}</p>
    <p v-if="copied.startsWith('http')" role="status">{{copied}}</p>
    <nav class="pagination" aria-label="托管图层分页"><span>共 {{rows.length}} 个数据集</span><button :disabled="page<=1" @click="page--">上一页</button><span>{{page}} / {{pages}}</span><button :disabled="page>=pages" @click="page++">下一页</button></nav>
  </section>
</template>
<style scoped>
.hosted-work{display:flex;flex-direction:column;gap:14px;min-height:0}.hosted-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.hosted-head p{color:var(--platform-muted)}.hosted-links{white-space:nowrap}.hosted-links>*{margin-right:8px}.hosted-work table{min-width:690px}.hosted-work td small{display:block;color:var(--platform-muted)}.hosted-pending{padding:10px;background:var(--platform-soft);border:1px solid var(--platform-line);border-radius:8px}.hosted-work>input{width:min(100%,430px)}
</style>