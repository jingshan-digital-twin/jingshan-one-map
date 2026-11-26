<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { featureCenter, type CityFeature, type Dataset } from './types'
import type { MapAddress } from './platform-address-search'
import EventMapRegion from './EventMapRegion.vue'
import MapLayerDirectory from './MapLayerDirectory.vue'
import { useMapDirectory, useEventCatalogMap } from './map-layer-directory'

type Menu='layers'|'locate'|'query'|'tools'
const props=defineProps<{features:CityFeature[];datasets:Dataset[];administration?:CityFeature[];scope?:string;dispatchLabel:string;dispatchDisabled?:boolean}>()
const emit=defineEmits<{
  action:[action:'home'|'in'|'out'|'tilt'|'measure'|'clear']; reset:[]; dispatch:[]
  resource:[feature:CityFeature]; area:[feature:CityFeature]; place:[place:MapAddress]; opening:[]
}>()
const menu=ref<Menu>(), query=ref(''), root=ref<HTMLElement>(), search=ref<HTMLInputElement>()
const catalog=useMapDirectory(), catalogMap=useEventCatalogMap()
const region=ref('京山市')
const regionDialogId=useId()
const titles:Record<Menu,string>={layers:'图层目录',locate:'定位标点',query:'数据查询',tools:'地图工具'}
const resources=computed(()=>props.features.filter(f=>f.properties.interactive!==false && featureCenter(f) && !f.id.endsWith('-flow') &&
  (f.properties.name+' '+f.properties.region).includes(query.value.trim())))
function openRegion(){if(menu.value!=='locate')toggle('locate')}
function chooseArea(f?:CityFeature){region.value=f?.properties.name??'京山市';close();if(f)emit('area',f);else emit('action','home')}
function choosePlace(place: MapAddress){region.value=place.region||'京山市';close();emit('place',place)}
function reset(){region.value='京山市';close();emit('reset')}
function toggle(next:Menu){
  menu.value=menu.value===next ? undefined : next
  if(menu.value==='layers'){catalog.mode='scene';catalog.identity='';catalog.refresh()}
  if(menu.value){emit('opening');if(next==='query')void nextTick(()=>search.value?.focus())}
}
function close(){menu.value=undefined;query.value=''}
function escape(e:KeyboardEvent){if(e.key==='Escape' && menu.value){const previous=menu.value;close();root.value?.querySelector<HTMLButtonElement>('[data-menu="'+previous+'"]')?.focus()}}
function outside(e:PointerEvent){if(menu.value && !root.value?.contains(e.target as Node))close()}
watch(()=>catalogMap.table,id=>{if(id)close()})
watch(()=>props.scope,(_,previous)=>{region.value='京山市';if(previous)close()})
onMounted(()=>{document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape)})
onBeforeUnmount(()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)})
</script>

<template>
  <div ref="root" class="event-map-controls">
    <EventMapRegion :open="menu==='locate'" :dialog-id="regionDialogId" :region="region" :datasets="datasets" :administration="administration"
      @open="openRegion" @close="close" @area="chooseArea" @place="choosePlace">
      <slot name="location" :close="close"/>
    </EventMapRegion>
  <div class="event-map-tools">
    <nav class="map-toolbar home-toolbar" aria-label="地图操作">
      <button type="button" data-menu="layers" aria-label="地图图层" data-tooltip="地图图层" :class="{on:menu==='layers'}" :aria-expanded="menu==='layers'" @click="toggle('layers')"></button>
      <button type="button" data-menu="locate" class="home-tool-locate" aria-label="定位标点" data-tooltip="定位标点" :aria-controls="regionDialogId" :class="{on:menu==='locate'}" :aria-expanded="menu==='locate'" @click="toggle('locate')"><img src="/jingshan/ui/location-ring.svg" alt=""></button>
      <button type="button" data-menu="query" aria-label="数据查询" data-tooltip="数据查询" :class="{on:menu==='query'}" :aria-expanded="menu==='query'" @click="toggle('query')"></button>
      <button type="button" data-menu="tools" aria-label="地图工具" data-tooltip="地图工具" :class="{on:menu==='tools'}" :aria-expanded="menu==='tools'" @click="toggle('tools')"></button>
      <button type="button" :aria-label="dispatchLabel" :data-tooltip="dispatchLabel" :disabled="dispatchDisabled" @click="close();emit('dispatch')"></button>
      <button type="button" class="home-tool-reset" aria-label="复位地图" data-tooltip="复位地图" @click="reset"><span class="home-tool-reset-icon" aria-hidden="true"></span></button>
    </nav>
    <section v-if="menu && menu!=='locate'" class="event-tool-menu" :class="{'map-popover popover-layers event-layer-directory':menu==='layers'}" :aria-label="titles[menu]">
      <header class="popover-header"><h3>{{titles[menu]}}</h3><button type="button" aria-label="关闭地图菜单" @click="close">×</button></header>
      <MapLayerDirectory v-if="menu==='layers'">
        <template #business><details v-if="catalog.mode==='scene'" open><summary>当前业务图层</summary><slot name="layers"/></details></template>
        <template #boundaries><label class="catalog-row"><input type="checkbox" :checked="catalog.enabled('townBoundaries')" @change="catalog.toggle('townBoundaries')"/>镇街行政区划</label></template>
      </MapLayerDirectory>
      <div v-else-if="menu==='query'" class="event-tool-content">
        <input ref="search" v-model="query" type="search" aria-label="搜索地图资源" placeholder="搜索当前场景资源">
        <button v-for="feature in resources" :key="feature.id" type="button" @click="close();emit('resource',feature)">{{feature.properties.name}}</button>
        <p v-if="!resources.length">未找到匹配资源。</p>
      </div>
      <div v-else class="event-tool-content">
        <button v-for="item in [['in','放大地图'],['out','缩小地图'],['tilt','切换立体／俯视'],['measure','测量距离'],['clear','清除测量']] as const"
          :key="item[0]" type="button" @click="emit('action',item[0]);if(item[0]==='measure')close()">{{item[1]}}</button>
        <slot name="tools"/>
      </div>
    </section>
  </div>
  </div>
</template>

<style scoped>
.event-map-controls { position:absolute; inset:0 0 auto; z-index:8; pointer-events:none; }
.event-map-tools { --map-toolbar-width:44px; position:absolute; z-index:8; inset:0 0 auto auto; width:var(--map-toolbar-width); pointer-events:auto; }
.event-map-tools .map-toolbar.home-toolbar { position:static; display:flex; flex-direction:column; width:var(--map-toolbar-width); gap:8px; margin:0; padding:0; background:none; border:0; box-shadow:none; }
.event-map-tools .home-toolbar button { flex:0 0 var(--map-toolbar-width); }
.event-map-tools .home-toolbar button::after { font-size:16px; }
.event-tool-menu { position:absolute; right:calc(100% + 8px); top:0; width:min(256px,calc(100vw - 76px)); border:1px solid var(--v14-edge); color:var(--v14-ink); background:var(--v14-overlay); box-shadow:0 4px 16px #00153138; border-radius:4px; }
.event-tool-menu header { display:flex; align-items:center; justify-content:space-between; padding:4px 8px 4px 12px; border-bottom:1px solid var(--v14-edge); }
.event-tool-menu h3,.event-tool-menu p { margin:0; }
.event-tool-menu h3 { font:600 18px/28px var(--v14-font);color:var(--v14-ink); }
.event-tool-content { padding:8px; display:grid; gap:4px; overflow:auto; max-height:min(50vh,400px); }
.event-tool-menu :is(button,input),.event-tool-content :deep(button) { min-height:32px; padding:4px 8px; border:1px solid var(--v14-list-line); color:var(--v14-ink); background:var(--v14-list); border-radius:2px; font:400 16px/24px var(--v14-font); text-align:left; }
.event-tool-menu header button { color:var(--v14-ink); font-size:22px; background:transparent; border-color:transparent; }
.event-tool-menu p { font:400 16px/24px var(--v14-font); }
.event-tool-content :is(button,input):focus-visible,.event-tool-content :deep(button:focus-visible) { outline:2px solid var(--v14-icon); outline-offset:-2px; }
.event-tool-content button:hover,.event-tool-content :deep(button:hover),.event-tool-content :deep(button[aria-pressed=true]) {color:#fff;border-color:var(--v14-icon);background:var(--v14-tab-active); }
.event-map-tools .event-layer-directory {
  position:absolute; left:auto; right:calc(100% + 8px); top:0;
  width:min(360px,calc(100vw - 76px)); max-height:min(74dvh,690px); box-sizing:border-box; padding:8px;
  color:var(--v14-ink); background:var(--v14-overlay); font:400 16px/24px var(--v14-font);
}
.event-layer-directory :deep(.segments) {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin:8px 0}
.event-layer-directory :deep(.segments button) {padding:4px;text-align:center;font:inherit}
.event-layer-directory :deep(.catalog-scroll) {max-height:min(52vh,480px);overflow:auto;overscroll-behavior:contain}
.event-layer-directory :deep(.catalog-row), .event-layer-directory :deep(.catalog-row label) {color:var(--v14-ink);min-height:30px}
.event-layer-directory :deep(input[type=checkbox]), .event-layer-directory :deep(input[type=radio]) {flex:none;width:16px;height:16px;min-height:0;padding:0;accent-color:var(--v14-metric)}
.event-layer-directory :deep(label.catalog-row) {justify-content:flex-start;gap:8px}
.event-layer-directory :deep(summary) {cursor:pointer;color:var(--v14-ink)}
</style>
