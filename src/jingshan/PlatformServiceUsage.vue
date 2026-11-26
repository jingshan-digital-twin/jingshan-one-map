<script setup lang="ts">
import { computed } from 'vue'
import {mapSlots} from './map-bindings'
import {pages} from './v3-navigation'
import {platformLink} from './platform-navigation'
import type {DataDocument} from './types'

const props=defineProps<{serviceId:string;published?:DataDocument;draft?:DataDocument;changing?:boolean}>()
function references(data:DataDocument) {
  const slots=new Map(mapSlots(data.datasets).map(s=>[s.id,s.name]))
  return (data.mapBindings ?? []).filter(b=>b.serviceId===props.serviceId).map(b=>({
    key:b.scope+'/'+b.slot,
    name:b.scope==='all' ? '全图默认' : pages[b.scope].label,
    slot:slots.get(b.slot) ?? b.slot,
    href:platformLink('bindings',b.scope),
  }))
}
const versions=computed(()=>[
  {name:'已发布版',items:props.published ? references(props.published) : []},
  {name:'当前草稿',items:props.draft ? references(props.draft) : []}
])
</script>
<template>
  <section class="service-references" aria-label="一张图引用">
    <header><h4>一张图引用</h4><small>显式绑定</small></header>
    <p v-if="changing && versions[0].items.length" class="usage-warning">此服务正在已发布场景中使用，请先替换对应图层来源并发布。</p>
    <div v-for="v in versions" :key="v.name" class="usage-version">
      <strong>{{v.name}}</strong>
      <div v-if="v.items.length"><a v-for="item in v.items" :key="item.key" :href="item.href">{{item.name}} · {{item.slot}} ↗</a></div>
      <span v-else>暂无绑定</span>
    </div>
  </section>
</template>
<style scoped>
.service-references{margin:12px 0;padding:12px 14px;border:1px solid var(--platform-line);border-radius:8px;background:var(--platform-soft)}.service-references header,.usage-version{display:flex;align-items:baseline;gap:12px}.service-references header{justify-content:space-between}.service-references h4{margin:0}.service-references small,.usage-version>span{color:var(--platform-muted)}.usage-version{margin-top:8px}.usage-version>strong{min-width:64px}.usage-version div{display:flex;gap:6px 12px;flex-wrap:wrap}.usage-warning{margin:8px 0;color:var(--gold,#d2994c)}
</style>