<script setup lang="ts">
import CimLayerCatalog from './CimLayerCatalog.vue'
import { useMapDirectory } from './map-layer-directory'
import { legacyPopulationGridId, populationGridId, worldPopSource } from './population-grid'
import { residentRasterUrl } from './population-raster'
const catalog=useMapDirectory()
</script>

<template>
  <div class="segments" aria-label="图层分组">
    <button v-for="[id,label] in [['scene','当前场景'],['category','按主题'],['department','按部门']] as const"
      :key="id" type="button" :class="{on:catalog.mode===id}" :aria-pressed="catalog.mode===id" @click="catalog.mode=id">{{ label }}</button>
  </div>
  <div class="catalog-scroll">
    <slot name="business"/>
    <details v-if="!catalog.overview" class="attribute-layer-menu"><summary>图层属性表</summary>
      <button v-for="d in catalog.sources" :key="d.id" type="button" class="mini" :title="d.service?.name" @click="catalog.openTable(d.id)">{{ d.name }}</button>
    </details>
    <CimLayerCatalog :services="catalog.services" :visible="catalog.visible" :states="catalog.states" :error="catalog.error"
      @toggle="catalog.toggleService" @reload="catalog.refresh"/>
    <slot v-if="catalog.mode==='scene'" name="scene"/>
    <details open><summary>基础底图</summary>
      <label class="catalog-row"><input :checked="catalog.imagery" type="checkbox" @change="catalog.toggleImagery"/>京山参考影像（离线备用）</label>
      <slot name="boundaries"><p class="catalog-row">行政区划 · {{ catalog.boundaries }} 个边界</p></slot>
    </details>
    <template v-if="catalog.mode!=='scene'">
      <details v-for="[group,layers] in catalog.groups" :key="group" :open="layers.some(item=>catalog.enabled(item.id))">
        <summary>{{ group }} <small>（{{ layers.length }}）</small></summary>
        <div v-for="item in layers" :key="item.id" class="catalog-row">
          <label><input type="checkbox" :checked="catalog.enabled(item.id)" @change="catalog.toggle(item.id)"/>{{ item.name }}</label>
          <button type="button" class="mini" :aria-label="'查看'+item.name+'图层身份'" @click="catalog.identity=item.id">{{ item.count }}</button>
        </div>
      </details>
    </template>
    <details><summary>协同回流成果</summary>
      <label class="catalog-row"><input :checked="catalog.results" type="checkbox" @change="catalog.toggleResults"/>已回流成果图层</label>
    </details>
  </div>
  <div v-if="catalog.currentIdentity" class="layer-identity">
    <strong>图层身份证 · {{ catalog.currentIdentity.name }}</strong>
    <p>{{ catalog.currentIdentity.department }} · {{ catalog.currentIdentity.count }} 条 · V{{ catalog.version }}</p>
    <p>{{ catalog.currentIdentity.description }}</p>
    <a v-if="catalog.currentIdentity.id===populationGridId" :href="residentRasterUrl" download="01_建筑归集人口_100米.tif">下载原始 GeoTIFF</a>
    <a v-else-if="catalog.currentIdentity.id===legacyPopulationGridId" :href="worldPopSource" target="_blank" rel="noopener">查看原始数据</a>
  </div>
</template>

<style scoped>
.attribute-layer-menu button { display:block; width:100%; text-align:left; margin-block:3px; }
</style>
