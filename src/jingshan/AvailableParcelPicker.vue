<script setup lang="ts">
import ServicePager from './ServicePager.vue'
import { reserveLandUses, urbanPlacement, urbanRelations } from './investment-planning.ts'
import type { useInvestmentSelection } from './use-investment-selection'
defineProps<{selection:ReturnType<typeof useInvestmentSelection>; types:string[]; radiusM?:number}>()
</script>
<template>
  <section class="industry-card available-sites" aria-label="可用地块">
    <header><h4>可用地块</h4><span>{{selection.filtered.length.toLocaleString('zh-CN')}} 块</span></header>
    <div class="target-types"><strong>招引企业类型</strong><span v-for="t in types" :key="t">{{t}}</span></div>
    <div class="selected-sites" aria-label="已选地块"><strong>已选地块（{{selection.selected.length}}）</strong>
      <span v-if="!selection.selected.length" class="industry-empty">勾选列表或点击地图上的地块可加入已选，再点一次可取消。</span>
      <ul v-else><li v-for="f in selection.selected" :key="f.id">
        <button type="button" class="parcel-name" @click="selection.locate(f.id)">{{f.properties.name}}</button>
        <button type="button" class="remove-site" :aria-label="'移除'+f.properties.name" @click="selection.toggle(f.id)">×</button>
      </li></ul>
    </div>
    <div class="parcel-filters">
      <input v-model.trim="selection.filters.search" type="search" aria-label="搜索可用地块" placeholder="搜索村名、地块名或图斑号">
      <select v-model="selection.filters.town" aria-label="可用地块镇街"><option value="">全部镇街</option><option v-for="t in selection.towns" :key="t">{{t}}</option></select>
      <select v-model="selection.filters.landUse" aria-label="可用地块调查地类"><option value="">全部地类</option><option v-for="(name,code) in reserveLandUses" :key="code" :value="code">{{name}}</option></select>
      <select v-model="selection.filters.urban" aria-label="可用地块边界关系"><option value="">全部边界关系</option><option v-for="(r,k) in urbanRelations" :key="k" :value="k">{{r.label}}</option></select>
      <select v-model="selection.filters.area" aria-label="可用地块面积"><option value="">全部面积</option><option value="small">小于 1 公顷</option><option value="medium">1 至不足 5 公顷</option><option value="large">5 公顷及以上</option></select>
    </div>
    <div v-if="selection.state" role="status">{{selection.state}} <button v-if="!selection.state.includes('正在')" class="industry-button" @click="selection.reload()">重试</button></div>
    <div v-else-if="!selection.filtered.length" class="industry-empty">当前条件下没有可用地块。<button v-if="selection.options.length" class="industry-row-action" @click="selection.resetFilters()">清除筛选</button></div>
    <ul v-else class="parcel-options">
      <li v-for="f in selection.page.rows" :key="f.id" :class="{checked:selection.checkedIds.includes(f.id)}">
        <input type="checkbox" :aria-label="'选择'+f.properties.name" :checked="selection.checkedIds.includes(f.id)" @change="selection.toggle(f.id)">
        <button class="parcel-name" type="button" :aria-label="'定位'+f.properties.name" @click="selection.locate(f.id)">
          <strong>{{f.properties.name}}</strong><small>{{f.properties.region}} · {{urbanPlacement(f).label}} · {{(Number(f.properties.area)/10000).toLocaleString('zh-CN',{maximumFractionDigits:2})}} 公顷</small>
        </button>
        <span v-if="selection.recommended.includes(f.id)" class="recommend-stamp">推荐地块</span>
      </li>
    </ul>
    <ServicePager v-if="selection.filtered.length" compact :pagination="selection.page" label="可用地块分页"/>
    <small v-if="radiusM" class="basis">按地块代表点距需求中心 {{radiusM/1000}} 公里筛选，优先列出界内且距离较近的地块。供地条件待核实。</small>
    <small v-else class="basis">优先推荐开发边界内、调查地类匹配的地块。制造建设类优先面积较大的图斑，服务类优先靠近需求参考点。供地条件待核实。</small>
  </section>
</template>
<style scoped>
.available-sites {display:grid;gap:8px;min-width:0;padding:9px 10px}
.available-sites header,.selected-sites li,.parcel-options li,.target-types {display:flex;align-items:center;gap:8px}
.available-sites header {justify-content:space-between}.available-sites h4 {margin:0;border-left:3px solid var(--v14-metric);padding-left:8px}
.available-sites header span,.basis,.parcel-name small {color:var(--v14-muted)}
.target-types {flex-wrap:wrap;gap:4px 6px}.target-types strong,.selected-sites>strong {font-size:15px}
.target-types span {padding:1px 5px;border:1px solid var(--v14-edge);color:var(--v14-ink);font-size:14px}
.parcel-filters {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}.parcel-filters input {grid-column:1/-1}
.parcel-filters :is(input,select) {min-width:0;width:100%;min-height:32px;box-sizing:border-box;font:inherit;color:var(--v14-ink);background:var(--v14-overlay);border:1px solid var(--v14-edge);border-radius:3px;padding:3px 6px}
.parcel-options,.selected-sites ul {display:grid;list-style:none;padding:0;margin:0;gap:3px}
.parcel-options li {padding:4px 6px;min-height:41px;box-sizing:border-box;border:1px solid var(--v14-edge);background:var(--v14-surface)}
.parcel-options li.checked {background:var(--industry-selected);border-color:var(--v14-list-line)}
.parcel-options input[type=checkbox] {flex:none;width:17px;height:17px;cursor:pointer;accent-color:#1879d5}
.parcel-name {min-width:0;flex:1;display:grid;gap:2px;padding:0;background:none;border:0;text-align:left;color:inherit;font:inherit;cursor:pointer}
.parcel-name strong {line-height:1.35}.parcel-name small {font-size:14px;line-height:1.4}.parcel-name:hover {text-decoration:underline}
.recommend-stamp {flex:none;color:var(--v14-metric);border:3px double currentColor;border-radius:3px;padding:1px 4px;transform:rotate(-6deg);font-size:13px;font-weight:700;white-space:nowrap}
.selected-sites {display:grid;gap:5px;border-top:1px solid var(--v14-edge);padding-top:7px}.selected-sites ul {max-height:88px;overflow:auto}
.selected-sites li {justify-content:space-between;background:var(--v14-chart-track);padding:3px 6px}
.remove-site {border:0;background:transparent;color:var(--v14-ink);font:700 20px/1 var(--v14-font);cursor:pointer;padding:3px 6px}
.basis {font-size:13px;line-height:1.4}
</style>
