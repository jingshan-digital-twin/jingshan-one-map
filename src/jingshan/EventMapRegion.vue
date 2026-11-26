<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { findMapAddresses, indexMapAddresses, type MapAddress } from './platform-address-search'
import type { CityFeature, Dataset } from './types'

const props = defineProps<{ open:boolean; dialogId:string; region:string; administration?:CityFeature[]; datasets:Dataset[] }>()
const emit = defineEmits<{ open:[]; close:[]; area:[feature?: CityFeature]; place:[place:MapAddress] }>()
const query = ref(''), limit = ref(30), trigger = ref<HTMLButtonElement>()
const towns = computed(() => (props.administration ?? []).filter(f => f.properties.kind === 'town-boundary'))
const villages = computed(() => props.datasets.find(d => d.id === 'communities')?.features ?? [])
const filteredTowns = computed(() => towns.value.filter(f => f.properties.name.includes(query.value)))
const filteredVillages = computed(() => villages.value.filter(f => (f.properties.name + f.properties.region).includes(query.value)))
// District polygons already have their own drill-down results.
const index = computed(() => indexMapAddresses(props.datasets.filter(d => !['administration','communities'].includes(d.id))))
const places = computed(() => props.open && query.value ? findMapAddresses(index.value, query.value) : [])
const city = computed(() => !query.value || '京山市全市'.includes(query.value))
watch(() => props.open, open => { if (!open) { query.value=''; limit.value=30 } })
watch(query, () => { limit.value=30 })
function dismiss() { emit('close');trigger.value?.focus({preventScroll:true}) }
function selectArea(f?:CityFeature) { emit('area',f);trigger.value?.focus({preventScroll:true}) }
function selectPlace(p:MapAddress) { emit('place',p);trigger.value?.focus({preventScroll:true}) }
function submit(e:KeyboardEvent) {
  if (e.isComposing || !query.value) return
  const area = filteredTowns.value[0] ?? filteredVillages.value[0]
  if (city.value || area) selectArea(city.value ? undefined : area)
  else if (places.value[0]) selectPlace(places.value[0])
}
</script>
<template>
  <div class="map-top-controls event-region-control" @keydown.esc.stop="dismiss">
    <div class="home-region-picker">
      <div class="home-region-bar">
        <button ref="trigger" class="home-region-trigger" type="button" aria-haspopup="dialog" :aria-controls="dialogId" :aria-expanded="open"
          :title="region" @click="open ? emit('close') : emit('open')">
          <span>{{region}}</span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
        </button>
        <label class="home-region-keyword">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15 15 4 4"/></svg>
          <input v-model.trim="query" type="search" maxlength="120" placeholder="请输入关键字" aria-label="搜索区划、地址或经纬度" autocomplete="off"
            :aria-expanded="open" :aria-controls="dialogId" @focus="emit('open')" @input="emit('open')" @keydown.enter.prevent="submit"/>
        </label>
      </div>
      <section v-if="open" :id="dialogId" class="home-region-popover" role="dialog" aria-label="区划选择">
        <header class="home-region-popover-header"><h3>区划选择</h3><button type="button" aria-label="关闭区划选择" @click="dismiss">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
        <p class="home-region-breadcrumb"><span>荆门市</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg><span>京山市</span></p>
        <div v-if="city || filteredTowns.length" class="home-region-options" role="group" aria-label="京山市区划">
          <button v-if="city" type="button" :aria-pressed="region==='京山市'" @click="selectArea()">全市</button>
          <button v-for="f in filteredTowns" :key="f.id" type="button" :aria-pressed="region===f.properties.name" @click="selectArea(f)">{{f.properties.name}}</button>
        </div>
        <details v-if="filteredVillages.length" class="home-region-communities" :open="Boolean(query)">
          <summary>村与社区（{{ filteredVillages.length }}）</summary>
          <div class="home-region-options">
            <button v-for="f in filteredVillages.slice(0,limit)" :key="f.id" type="button" :aria-pressed="region===f.properties.name" @click="selectArea(f)">{{f.properties.name}} · {{f.properties.region}}</button>
            <button v-if="limit<filteredVillages.length" type="button" @click="limit+=30">显示更多</button>
          </div>
        </details>
        <div v-if="places.length" class="event-region-places" role="group" aria-label="地址与地点"><h4>地址与地点</h4>
          <button v-for="p in places" type="button" :key="p.sourceKey || p.name" :aria-label="'定位到'+p.name" @click="selectPlace(p)"><strong>{{p.name}}</strong><span>{{p.address || p.region || p.source}}</span></button>
        </div>
        <p v-if="!city && !filteredTowns.length && !filteredVillages.length && !places.length" class="home-region-empty">未找到匹配区划或地址</p>
        <div v-if="!query" class="event-region-location"><slot/></div>
      </section>
    </div>
  </div>
</template>
<style scoped>
.event-region-control { --map-toolbar-width:44px; --panorama-map-surface:var(--event-mid); left:0; top:0; right:52px; }
.home-region-trigger { max-width:52%; }
.home-region-trigger span { overflow:hidden; text-overflow:ellipsis; }
.home-region-trigger svg { flex:none; }
.event-region-control input { border:0; font:400 16px/24px var(--v14-font); padding:0; background:transparent; }
.home-region-popover :is(h3,h4,p) { margin:0; }
.home-region-popover h4 { font:700 16px/24px var(--v14-font); }
.event-region-places { display:grid; gap:4px; }
.event-region-places button { display:grid; text-align:left; padding:4px 8px; }
.jt-screen .event-region-control :is(.event-region-places,.home-region-options) button { white-space:normal; overflow-wrap:anywhere; line-height:24px; }
.event-region-places span { color:var(--v14-muted); }
.event-region-location :deep(button) { padding:4px 8px; }
</style>
