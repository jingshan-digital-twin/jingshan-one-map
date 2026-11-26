<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { catalogAssets, folderResources, type CatalogAsset, type PortalCatalog } from './portal-catalog'
import { activeCourtSourceId } from './court-ledger'
import { residentGridId } from './population-raster'
import { inCatalogDomain, parseCatalogSearch, type CatalogDomain } from './catalog-domain'
import { platformLink, platformTime, type ActivityRow } from './platform-navigation'
import type { ResourceTarget } from './resource-removal'
import type { DataDocument } from './types'
import type { CimAdminService } from './cim-types'
import PlatformOverview from './PlatformOverview.vue'
import CatalogOrganizer from './CatalogOrganizer.vue'
import PortalIcon from './PortalIcon.vue'
import './WorkspaceCatalog.css'

const props = defineProps<{
  draft: DataDocument; services: CimAdminService[]; serviceError: string
  activity: ActivityRow[]; activityError: string; version: number; publishedAt: string
  initialQuery: string; canEdit: boolean; viewerMode: boolean
}>()
const emit = defineEmits<{
  catalog: [PortalCatalog]; domain: [domain: CatalogDomain, query: string]; batch: [targets: ResourceTarget[]]
}>()
const tab = ref<'spatial' | 'folders' | 'favorites' | 'activity'>('spatial')
const organizing = ref(false)
const folderId = ref('')
const query = computed(() => parseCatalogSearch(props.initialQuery))
const allAssets = computed(() => catalogAssets(props.draft.datasets, props.services))
const spatial = computed(() => allAssets.value.filter(a => inCatalogDomain(a.type, 'spatial')))
const hosted = computed(() => allAssets.value.filter(a => a.service?.hostedDatasetId && a.service.enabled))
const folders = computed(() => props.draft.portalCatalog?.folders ?? [])
const currentFolder = computed(() => folders.value.find(f => f.id === folderId.value))
const featureIds = computed(() => ['administration',residentGridId,activeCourtSourceId(props.draft),'venues','charging'])
const featured = computed(() => {
  const datasets = spatial.value
  const chosen = featureIds.value.map(id => datasets.find(a => a.id === id)).filter((a): a is CatalogAsset => !!a)
  return [...new Set([...chosen, ...datasets])].slice(0,5)
})
const previews = computed(() => {
  const court = allAssets.value.find(a => a.id === activeCourtSourceId(props.draft))
  const models = allAssets.value.filter(a => a.style === 'model' && a.service?.enabled)
  const model = models.find(a => a.service?.mapUrl.includes('/local-tiles/central-white/')) ?? models[0]
  return [court,model].filter((a): a is CatalogAsset => !!a)
})
function imageFor(a: CatalogAsset) {
  const kind = (a.service?.hostedDatasetId ?? a.id) + ' ' + a.name
  if (/充电|charging/.test(kind)) return 'charging'
  if (/venues|场馆|stadium/.test(kind) && !/ledger/.test(kind)) return 'stadium'
  if (/court|网球|球场/.test(kind)) return 'court'
  if (/人口|population|建成区|城镇/.test(kind)) return 'city'
  if (/用地|地块|水域|parcels|景区|温泉/.test(kind)) return 'waterfront'
  return 'mountain'
}
const art = (a: CatalogAsset) => '/jingshan/workspace/' + imageFor(a) + '.webp'
function loadKeys(key: string): string[] {
  try { const ids = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(ids) ? ids.filter(v => typeof v === 'string') : [] }
  catch { return [] }
}
function persist(key: string, ids: string[]) {
  try { localStorage.setItem(key, JSON.stringify(ids)) } catch { /* preferences can stay in memory */ }
}
const favoriteKey = 'js-portal-favorites', recentKey = 'js-workspace-recent-assets'
const favorites = ref(loadKeys(favoriteKey)), visits = ref(loadKeys(recentKey))
const recent = computed(() => visits.value.map(key => allAssets.value.find(a => a.key === key)).filter((a): a is CatalogAsset => !!a).slice(0,4))
const saved = computed(() => allAssets.value.filter(a => favorites.value.includes(a.key)))
const folderAssets = computed(() => {
  const keys = folderResources(folders.value, folderId.value)
  return allAssets.value.filter(a => keys.has(a.key))
})
function bookmark(a: CatalogAsset) {
  favorites.value = favorites.value.includes(a.key) ? favorites.value.filter(id => id !== a.key) : [...favorites.value, a.key]
  persist(favoriteKey, favorites.value)
}
function recordVisit(a: CatalogAsset) {
  visits.value = [a.key, ...visits.value.filter(id => id !== a.key)].slice(0,10)
  persist(recentKey, visits.value)
}
function preview(a: CatalogAsset) {
  return platformLink(a.type === 'forms' && props.canEdit ? 'forms' : 'preview', a.type === 'forms' && props.canEdit ? a.id : a.key)
}
function manage(a: CatalogAsset) {
  return props.canEdit && a.type !== 'views' ? platformLink(a.type,a.id) : preview(a)
}
function browse(domain: CatalogDomain, terms = '') {
  organizing.value = false
  emit('domain', domain, terms)
}
function home() {
  organizing.value = false
  tab.value = 'spatial'
  location.hash = platformLink('overview')
}
function organize() {
  organizing.value = true
  window.scrollTo({top:0})
}
function showTab(next: typeof tab.value) {
  tab.value = next
  if (next === 'folders' && !currentFolder.value) folderId.value = folders.value[0]?.id ?? ''
}
watch(() => props.initialQuery, () => {
  organizing.value = false
  favorites.value = loadKeys(favoriteKey)
  if (!props.initialQuery) tab.value = 'spatial'
})
</script>

<template>
  <div v-if="organizing" class="workspace-catalog-organize wkc-subpage">
    <button type="button" class="wkc-back" @click="organizing=false">资源目录 <PortalIcon name="chevron" :size="13"/> 专题目录</button>
    <h1>编辑专题目录</h1>
    <CatalogOrganizer inline :initial="folderId" :catalog="draft.portalCatalog" :assets="allAssets"
      @apply="emit('catalog', $event)" @close="organizing=false"/>
  </div>
  <div v-else-if="initialQuery" class="workspace-catalog-results wkc-subpage">
    <button type="button" class="wkc-back" @click="home">资源目录 <PortalIcon name="chevron" :size="13"/> {{ query.domain==='services' ? '服务资源' : '空间数据' }}</button>
    <h1>{{ query.query ? '搜索结果' : query.domain==='services' ? '服务资源目录' : '空间数据目录' }}</h1>
    <PlatformOverview v-bind="props" workspace-layout
      @organize="organize" @visit="recordVisit" @catalog="emit('catalog',$event)" @batch="emit('batch',$event)" @domain="browse">
      <template #directory-footer>
        <section v-if="query.domain==='services' && hosted.length" class="wkc-result-hosted">
          <h2>本地发布</h2>
          <ul class="wkc-services"><li v-for="a in hosted.slice(0,2)" :key="a.key">
            <img :src="art(a)" alt=""/><div><strong :title="a.name">{{ a.name }}</strong><small>{{ a.format }}</small></div>
            <a :href="manage(a)" :aria-label="'查看'+a.name" @click="recordVisit(a)">查看</a>
          </li></ul>
        </section>
      </template>
    </PlatformOverview>
  </div>
  <div v-else class="workspace-catalog-landing">
    <header class="wkc-hero">
      <img class="wkc-team" src="/jingshan/workspace/team.webp" alt="" fetchpriority="high"/>
      <div class="wkc-hero-copy">
        <small>平台门户 <i>/</i> 京山</small>
        <h1>资源目录</h1>
        <div class="wkc-hero-actions">
          <button type="button" @click="browse('spatial')">浏览空间数据</button>
          <button type="button" v-if="canEdit" @click="organize">管理专题</button>
          <button type="button" v-else @click="showTab('folders')">查看专题</button>
        </div>
      </div>
    </header>
    <div class="wkc-surface">
      <nav class="wkc-tabs" aria-label="资源目录分类">
        <button type="button" :aria-pressed="tab==='spatial'" @click="showTab('spatial')">空间数据</button>
        <button type="button" @click="browse('services')">服务资源</button>
        <button type="button" :aria-pressed="tab==='folders'" @click="showTab('folders')">专题目录</button>
        <button type="button" :aria-pressed="tab==='favorites'" @click="showTab('favorites')">本机收藏</button>
        <button type="button" v-if="!viewerMode" :aria-pressed="tab==='activity'" @click="showTab('activity')">最近动态</button>
      </nav>
      <p v-if="serviceError" class="message error" role="alert">{{ serviceError }}</p>
      <div class="wkc-columns">
        <div class="wkc-major">
          <section v-if="tab==='spatial'">
            <div class="wkc-heading"><h2>空间数据</h2><button type="button" @click="browse('spatial')">查看全部 <span>{{ spatial.length }}</span></button></div>
            <ol class="wkc-list">
              <li v-for="(a,i) in featured" :key="a.key">
                <a class="wkc-resource" :href="manage(a)" @click="recordVisit(a)">
                  <i v-if="a.id==='administration'" class="wkc-map-icon"><PortalIcon name="preview"/></i>
                  <img v-else :src="art(a)" alt=""/><small>{{ i+1 }}</small>
                  <strong :title="a.name">{{ a.name }}</strong><span>{{ a.format }}</span><em>{{ a.info }}</em>
                </a>
                <button type="button" class="wkc-heart" :aria-pressed="favorites.includes(a.key)" :aria-label="(favorites.includes(a.key)?'取消收藏':'收藏')+a.name" @click="bookmark(a)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.7a5.4 5.4 0 0 0-7.6 0L12 5.9l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6l8.8 8.3 8.8-8.3a5.4 5.4 0 0 0 0-7.6Z"/></svg>
                </button>
              </li>
            </ol>
            <p v-if="!featured.length" class="wkc-empty">尚无空间数据。</p>
          </section>
          <section v-if="tab==='spatial'">
            <div class="wkc-heading"><h2>资源图册</h2><button type="button" @click="browse('spatial')">全部资源 <PortalIcon name="chevron" :size="14"/></button></div>
            <div class="wkc-gallery">
              <a v-for="a in featured" :key="a.key" :href="preview(a)" @click="recordVisit(a)">
                <img :src="art(a)" alt=""/><strong :title="a.name">{{ a.name }}</strong><small>{{ a.info }}</small>
              </a>
            </div>
          </section>
          <section v-if="tab==='folders'">
            <div class="wkc-heading"><h2>专题目录</h2><button v-if="canEdit" type="button" @click="organize">编排专题 <PortalIcon name="chevron" :size="14"/></button></div>
            <div class="wkc-folders">
              <button v-for="f in folders" :key="f.id" :aria-pressed="f.id===folderId" @click="folderId=f.id"><PortalIcon name="folder" :size="16"/>{{ f.name }}</button>
            </div>
            <ul v-if="folderAssets.length" class="wkc-topic-list"><li v-for="a in folderAssets" :key="a.key"><a :href="manage(a)" @click="recordVisit(a)"><img :src="art(a)" alt=""/><b>{{ a.name }}</b><small>{{ a.format }}</small></a></li></ul>
            <p v-else class="wkc-empty">{{ currentFolder ? '当前专题尚未纳入资源。' : '暂无专题目录。' }}</p>
          </section>
          <section v-if="tab==='favorites'">
            <div class="wkc-heading"><h2>本机收藏</h2><small>{{ saved.length }} 项</small></div>
            <ul class="wkc-topic-list"><li v-for="a in saved" :key="a.key"><a :href="manage(a)" @click="recordVisit(a)"><img :src="art(a)" alt=""/><b>{{ a.name }}</b></a><button @click="bookmark(a)">取消收藏</button></li></ul>
            <p v-if="!saved.length" class="wkc-empty">点击资源旁的收藏按钮，即可在这里找到它。</p>
          </section>
          <section v-if="tab==='activity' && !viewerMode">
            <div class="wkc-heading"><h2>最近动态</h2><a href="#activity">运行与审计 <PortalIcon name="chevron" :size="14"/></a></div>
            <p v-if="activityError || !activity.length" class="wkc-empty">{{ activityError || '暂无变更记录。' }}</p>
            <ol v-else class="wkc-activity"><li v-for="r in activity.slice(0,8)" :key="r.id"><b>{{ r.action }}</b><span>{{ r.resource }}</span><time>{{ platformTime(r.recordedAt) }}</time></li></ol>
          </section>
        </div>
        <aside class="wkc-aside">
          <section>
            <div class="wkc-heading"><h2>图层预览</h2><a href="#preview">打开地图 <PortalIcon name="chevron" :size="14"/></a></div>
            <div class="wkc-previews">
              <a v-for="a in previews" :key="a.key" :href="preview(a)" @click="recordVisit(a)">
                <img :src="a.style==='model' ? '/jingshan/ui/platform-city-model.webp' : '/jingshan/ui/overview-venue.webp'" alt=""/>
                <strong :title="a.name">{{ a.name }}</strong><small>{{ a.style==='model' ? '三维模型 · '+a.format : a.info }}</small>
              </a>
            </div>
            <p v-if="!previews.length" class="wkc-empty">暂无可预览图层。</p>
          </section>
          <section>
            <div class="wkc-heading"><h2>本地发布服务</h2><button type="button" @click="browse('services')">服务目录 <PortalIcon name="chevron" :size="14"/></button></div>
            <ul class="wkc-services"><li v-for="a in hosted.slice(0,3)" :key="a.key">
              <img :src="art(a)" alt=""/><div><strong :title="a.name">{{ a.name }}</strong><small>{{ a.format }}</small></div><a :href="manage(a)" :aria-label="'查看'+a.name" @click="recordVisit(a)">查看</a>
            </li></ul>
            <p v-if="!hosted.length" class="wkc-empty">尚无已启用的本地发布服务。</p>
          </section>
        </aside>
      </div>
      <footer class="wkc-recent"><b><PortalIcon name="folder" :size="16"/>最近访问</b>
        <a v-for="a in recent" :key="a.key" :href="manage(a)" @click="recordVisit(a)"><img :src="art(a)" alt=""/><span>{{ a.name }}</span><PortalIcon name="chevron" :size="12"/></a>
        <small v-if="!recent.length">暂无访问记录</small>
      </footer>
    </div>
  </div>
</template>
