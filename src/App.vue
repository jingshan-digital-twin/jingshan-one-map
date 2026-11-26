<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue'
import type { FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson'
import { industries, projects, statusColors, statusLabels, type MapProject } from './demo.ts'

const CesiumMap = defineAsyncComponent(() => import('./CesiumMap.vue'))
type MapAction = 'home' | 'in' | 'out' | 'north' | 'tilt'
type ApiProject = { id: number; name: string; longitude: number; latitude: number; status: 'draft' | 'published' }
type Panel = 'publish' | 'catalog' | 'overview' | 'enterprise' | 'service' | null
type Boundaries = FeatureCollection<Polygon | MultiPolygon, { name: string }>

const tabs = ['产业链总览', '产业全景', '产业空间', '重点企业', '重点项目', '科技攻关', '服务事项'] as const
type Tab = (typeof tabs)[number]
const cities = ['武汉市', '黄石市', '十堰市', '宜昌市', '襄阳市', '鄂州市', '荆门市', '孝感市', '荆州市', '黄冈市', '咸宁市', '随州市', '恩施州', '仙桃市', '潜江市', '天门市', '神农架林区']
const industryId = ref('opto')
const industry = computed(() => industries.find(item => item.id === industryId.value) ?? industries[0])
const currentTab = ref<Tab>('重点项目')
const selectedId = ref<string | null>(null)
const city = ref('')
const statusFilter = ref<MapProject['status'] | ''>('')
const projectGroup = ref<'active' | 'reserve' | null>(null)
const searchInput = ref('')
const keyword = ref('')
const dropdown = ref('')
const panel = ref<Panel>(null)
const legendOpen = ref(true)
const rightOpen = ref(true)
const leftOpen = ref(true)
const boundaries = ref(true)
const imagery = ref(true)
const showCities = ref(true)
const clock = ref(new Date())
const camera = ref({ longitude: 113.72, latitude: 30.68, height: 500000 })
const command = ref<{ action: MapAction; serial: number } | null>(null)
const localProjects = ref<MapProject[]>([])
const connected = ref(false)
const fullscreen = ref(false)
let timer: ReturnType<typeof setInterval> | undefined
let serial = 0
let boundaryData: Promise<Boundaries | null> | undefined

const draft = ref<ApiProject>()
const form = ref({ name: '', longitude: 113.119, latitude: 31.02 })
const saving = ref(false)
const publishError = ref('')
const notice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined

const dateFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
})
const weekdayFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'long' })
const dateText = computed(() => dateFormatter.format(clock.value) + ' ' + weekdayFormatter.format(clock.value))
const timeText = computed(() => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(clock.value))
const allProjects = computed(() => [...projects, ...localProjects.value])
const visibleProjects = computed(() => {
  const term = keyword.value.toLowerCase()
  const panorama = currentTab.value === '产业全景' || currentTab.value === '产业空间'
  return allProjects.value.filter(item =>
    (panorama || term || item.industryId === industryId.value) &&
    (!city.value || item.city === city.value) &&
    (!statusFilter.value || item.status === statusFilter.value) &&
    (projectGroup.value !== 'active' || ['new', 'ongoing'].includes(item.status)) &&
    (projectGroup.value !== 'reserve' || item.status === 'reserve') &&
    (currentTab.value !== '科技攻关' || /研发|攻关|技术|实验|测试|平台/.test(item.name)) &&
    (!term || (item.name + item.city + item.description).toLowerCase().includes(term)),
  )
})
const selected = computed(() => allProjects.value.find(item => item.id === selectedId.value))
const heading = computed(() => currentTab.value === '产业全景' || currentTab.value === '产业空间'
  ? '全省产业 · 重点项目'
  : industry.value.name + ' · ' + (currentTab.value === '科技攻关' ? '科技攻关' : '重点项目'))
const filtered = computed(() => Boolean(city.value || statusFilter.value || keyword.value || projectGroup.value))
const statusEntries = Object.entries(statusLabels) as [MapProject['status'], string][]
const activeCount = computed(() => filtered.value
  ? visibleProjects.value.filter(item => item.status === 'new' || item.status === 'ongoing').length
  : currentTab.value === '产业全景' || currentTab.value === '产业空间'
    ? industries.reduce((sum, item) => sum + item.active, 0)
    : industry.value.active + localProjects.value.filter(item => item.industryId === industryId.value && !item.name.includes('演示')).length)
const reserveCount = computed(() => filtered.value
  ? visibleProjects.value.filter(item => item.status === 'reserve').length
  : currentTab.value === '产业全景' || currentTab.value === '产业空间'
    ? industries.reduce((sum, item) => sum + item.reserve, 0)
    : industry.value.reserve)

function mapAction(action: MapAction) {
  command.value = { action, serial: ++serial }
}
function chooseIndustry(id: string) {
  industryId.value = id
  currentTab.value = '重点项目'
  selectedId.value = null
  resetFilters()
}
function resetFilters() {
  city.value = ''
  statusFilter.value = ''
  projectGroup.value = null
  searchInput.value = ''
  keyword.value = ''
}
function setRegion(region: string) {
  city.value = region
  selectedId.value = null
  dropdown.value = ''
}
function setStatus(status: MapProject['status'] | '') {
  statusFilter.value = statusFilter.value === status ? '' : status
  projectGroup.value = null
  selectedId.value = null
  dropdown.value = ''
}
function setGroup(group: 'active' | 'reserve') {
  projectGroup.value = projectGroup.value === group ? null : group
  statusFilter.value = ''
  selectedId.value = null
  rightOpen.value = true
}
function search() {
  keyword.value = searchInput.value.trim()
  selectedId.value = visibleProjects.value.length === 1 ? visibleProjects.value[0].id : null
}
function selectProject(id: string) {
  selectedId.value = id
}
function openPanel(value: Panel) {
  dropdown.value = ''
  panel.value = value
}
function changeTab(tab: Tab) {
  dropdown.value = ''
  if (tab === '产业链总览') { openPanel('overview'); return }
  if (tab === '重点企业') { openPanel('enterprise'); return }
  if (tab === '服务事项') { openPanel('service'); return }
  panel.value = null
  currentTab.value = tab
  selectedId.value = null
  resetFilters()
  if (tab === '产业空间') boundaries.value = true
  if (tab === '产业全景') mapAction('home')
}
function toggleMenu(menu: string) {
  dropdown.value = dropdown.value === menu ? '' : menu
}
function goHome() {
  chooseIndustry('opto')
  panel.value = null
  dropdown.value = ''
  leftOpen.value = true
  rightOpen.value = true
  mapAction('home')
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch {
    flash('浏览器未允许全屏')
  }
}
function syncFullscreen() { fullscreen.value = Boolean(document.fullscreenElement) }
function flash(message: string) {
  notice.value = message
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { notice.value = '' }, 3500)
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (panel.value) panel.value = null
    else if (dropdown.value) dropdown.value = ''
    else selectedId.value = null
  }
}
async function request<T>(path: string, options?: RequestInit) {
  const response = await fetch(path, options)
  if (!response.ok) throw new Error('请求失败（HTTP ' + response.status + '）')
  return await response.json() as T
}
function inRing(longitude: number, latitude: number, ring: Position[]) {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x, y] = ring[index]
    const [previousX, previousY] = ring[previous]
    if ((y > latitude) !== (previousY > latitude) &&
        longitude < x + (previousX - x) * (latitude - y) / (previousY - y)) inside = !inside
  }
  return inside
}
function fromApi(item: ApiProject, boundaries: Boundaries | null): MapProject {
  const region = boundaries?.features.find(({ geometry }) => {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    return polygons.some(([outer, ...holes]) => inRing(item.longitude, item.latitude, outer) &&
      !holes.some(hole => inRing(item.longitude, item.latitude, hole)))
  })
  return {
    id: 'published-' + item.id, name: item.name, longitude: item.longitude, latitude: item.latitude,
    industryId: 'opto', city: region?.properties.name ?? '其他地区', status: 'new',
    description: '通过本地数据发布录入的项目。', date: '',
  }
}
async function refresh() {
  try {
    boundaryData ??= request<Boundaries>('/imagery/hubei-boundaries.json').catch(() => null)
    const [result, boundaries] = await Promise.all([request<ApiProject[]>('/api/projects'), boundaryData])
    localProjects.value = result.map(item => fromApi(item, boundaries))
    connected.value = true
  } catch {
    connected.value = false
  }
}
async function saveDraft() {
  saving.value = true
  publishError.value = ''
  try {
    draft.value = await request<ApiProject>('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form.value),
    })
  } catch {
    publishError.value = '保存草稿失败，请检查项目名称、经纬度和后端连接。'
  } finally {
    saving.value = false
  }
}
async function publish() {
  if (!draft.value) return
  saving.value = true
  publishError.value = ''
  try {
    const item = await request<ApiProject>('/api/projects/' + draft.value.id + '/publish', { method: 'POST' })
    await refresh()
    goHome()
    selectProject('published-' + item.id)
    draft.value = undefined
    form.value.name = ''
    flash('项目已发布到大屏')
  } catch {
    publishError.value = '发布失败，请重试。'
  } finally {
    saving.value = false
  }
}
onMounted(() => {
  void refresh()
  timer = setInterval(() => { clock.value = new Date() }, 1000)
  window.addEventListener('keydown', onKey)
  document.addEventListener('fullscreenchange', syncFullscreen)
})
onUnmounted(() => {
  clearInterval(timer)
  clearTimeout(noticeTimer)
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', syncFullscreen)
})
</script>

<template>
  <main class="screen" @click.self="dropdown = ''">
    <header class="topbar">
      <button class="brand" type="button" title="返回首页" @click="goHome">
        <span class="brand-icon" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>
          <span class="brand-title">湖北省先进制造业重点产业链一张图</span>
          <span class="brand-subtitle">一图总览 {{ industries.length }}条重点产业链</span>
        </span>
      </button>

      <div class="top-tools">
        <form class="search" role="search" @submit.prevent="search">
          <input v-model="searchInput" aria-label="搜索企业、项目或机构" placeholder="搜索企业/项目/机构" @input="!searchInput && search()" />
          <button type="submit" aria-label="搜索"><span class="search-icon"></span></button>
        </form>
        <div class="tool-wrap">
          <button class="tool-button" type="button" :class="{ 'is-active': city }" :aria-expanded="dropdown === 'region'" @click="toggleMenu('region')">
            <span aria-hidden="true">♧</span> {{ city || '行政区' }} <small>▾</small>
          </button>
          <div v-if="dropdown === 'region'" class="dropdown">
            <button type="button" @click="setRegion('')">全省</button>
            <button v-for="item in cities" :key="item" type="button" @click="setRegion(item)">{{ item }}</button>
          </div>
        </div>
        <div class="tool-wrap">
          <button class="tool-button" type="button" :class="{ 'is-active': statusFilter }" :aria-expanded="dropdown === 'filter'" @click="toggleMenu('filter')">
            <span aria-hidden="true">≡</span> 筛选 <small>▾</small>
          </button>
          <div v-if="dropdown === 'filter'" class="dropdown">
            <button type="button" @click="setStatus('')">全部状态</button>
            <button v-for="[value, label] in statusEntries" :key="value" type="button" @click="setStatus(value)">{{ label }}</button>
          </div>
        </div>
        <button class="tool-button bureau-button" type="button" @click="openPanel('service')"><span aria-hidden="true">▣</span> 经信通办</button>
        <div class="tool-wrap">
          <button class="tool-button" type="button" :aria-expanded="dropdown === 'data'" @click="toggleMenu('data')"><span aria-hidden="true">▤</span> 数据采集 <small>▾</small></button>
          <div v-if="dropdown === 'data'" class="dropdown">
            <button type="button" @click="openPanel('publish')">数据发布</button>
            <button type="button" @click="openPanel('catalog')">数据目录</button>
          </div>
        </div>
        <button class="tool-button theme-button" type="button" @click="openPanel('overview')"><span aria-hidden="true">▦</span> 产业专题</button>
        <div class="top-actions">
          <button class="tool-button icon-button" type="button" aria-label="数据目录" title="数据目录" @click="openPanel('catalog')">▣</button>
          <button class="tool-button icon-button" type="button" aria-label="返回首页" title="返回首页" @click="goHome">⌂</button>
          <button class="tool-button icon-button" type="button" :aria-label="fullscreen ? '退出全屏' : '全屏'" :title="fullscreen ? '退出全屏' : '全屏'" @click="toggleFullscreen">⛶</button>
        </div>
      </div>
      <div class="clock"><span>{{ dateText }}</span><strong>{{ timeText }}</strong></div>
      <div class="account"><span>欢迎您：</span><strong>演示管理员</strong></div>
    </header>

    <section class="stage" aria-label="湖北产业链地图" @click="dropdown = ''">
      <div class="map-background">
        <CesiumMap
          :projects="visibleProjects" :selected-id="selectedId" :show-boundaries="boundaries" :show-imagery="imagery" :show-cities="showCities" :command="command"
          @select="selectProject" @camera="camera = $event"
        />
      </div>
      <div class="map-vignette"></div>

      <aside v-show="leftOpen" class="side-panel left-panel" aria-label="产业链导航">
        <h2 class="panel-title"><span class="panel-title-accent"></span>产业链导航</h2>
        <div class="industry-list">
          <button
            v-for="(item, index) in industries" :key="item.id" class="industry-card" type="button"
            :class="{ 'is-active': item.id === industryId }" :style="{ '--industry-color': item.color }"
            :aria-pressed="item.id === industryId" @click="chooseIndustry(item.id)"
          >
            <span class="industry-name"><span class="industry-number">{{ index + 1 }}</span><span>{{ item.name }}</span></span>
            <span class="industry-metrics">
              <strong class="industry-value">{{ item.scale }}</strong>
              <span class="industry-progress"><i :style="{ width: item.percentage + '%' }"></i></span>
              <strong class="industry-percent">{{ item.percentage.toFixed(2) }}%</strong>
            </span>
            <span class="industry-meta"><span>链长：<b>{{ item.leader }}</b></span><span>牵头单位：<b>{{ item.agency }}</b></span></span>
          </button>
        </div>
      </aside>

      <nav class="panel-rail" :class="{ 'rail-collapsed': !leftOpen }" aria-label="项目状态">
        <button class="rail-button" type="button" :class="{ 'is-active': projectGroup === 'active' }" @click="setGroup('active')">在建项目列表</button>
        <button class="rail-button" type="button" :class="{ 'is-active': projectGroup === 'reserve' }" @click="setGroup('reserve')">储备项目列表</button>
        <button class="rail-button rail-collapse" type="button" :aria-label="leftOpen ? '收起产业链导航' : '展开产业链导航'" @click="leftOpen = !leftOpen">{{ leftOpen ? '‹' : '›' }}</button>
      </nav>

      <button type="button" class="map-catalog" :class="{ 'catalog-expanded': !rightOpen }" @click="openPanel('catalog')"><span aria-hidden="true">▱</span>数据目录</button>
      <button type="button" class="right-collapse" :class="{ 'right-collapsed': !rightOpen }" :aria-label="rightOpen ? '收起项目列表' : '展开项目列表'" @click="rightOpen = !rightOpen">{{ rightOpen ? '‹' : '›' }}</button>
      <aside v-show="rightOpen" class="side-panel right-panel" aria-label="重点项目列表">
        <h2 class="right-heading">{{ heading }}</h2>
        <div class="totals">
          <button class="total-card" type="button" :class="{ 'is-active': projectGroup === 'active' }" @click="setGroup('active')">
            <span class="total-icon total-active-icon" aria-hidden="true">▤</span><span><strong class="total-number">{{ activeCount }}</strong><span class="total-label">在建项目</span></span>
          </button>
          <button class="total-card" type="button" :class="{ 'is-active': projectGroup === 'reserve' }" @click="setGroup('reserve')">
            <span class="total-icon total-reserve-icon" aria-hidden="true">◈</span><span><strong class="total-number">{{ reserveCount }}</strong><span class="total-label">储备项目</span></span>
          </button>
        </div>
        <div v-if="filtered" class="filter-summary"><span>{{ city || '全省' }} · {{ visibleProjects.length }} 个匹配项目</span><button type="button" @click="resetFilters">清除筛选</button></div>
        <div class="project-list">
          <div v-if="!visibleProjects.length" class="empty-list">当前筛选条件下暂无项目</div>
          <button
            v-for="item in visibleProjects" :key="item.id" class="project-card" type="button"
            :class="{ 'is-active': item.id === selectedId }" :style="{ '--status-color': statusColors[item.status] }" @click="selectProject(item.id)"
          >
            <span class="project-heading"><strong class="project-name" :title="item.name">{{ item.name }}</strong><b class="project-status">{{ statusLabels[item.status].replace('项目', '') }}</b></span>
            <span class="project-description">{{ item.description }}</span>
            <span class="project-footer"><span class="project-chip">市县办理</span><span class="project-chip chip-wait">{{ item.status === 'reserve' ? '已储备' : '办理中' }}</span><time v-if="item.date" class="project-date">{{ item.date }}</time><span v-else class="project-date">本地发布</span></span>
          </button>
        </div>
      </aside>

      <section v-if="legendOpen" class="legend-panel" :class="{ 'legend-left': !leftOpen }" aria-label="地图图例">
        <div class="legend-heading"><span class="legend-grid" aria-hidden="true"><i></i><i></i><i></i><i></i></span><strong>图例 · 在线重点项目</strong><button type="button" aria-label="关闭图例" @click="legendOpen = false">×</button></div>
        <button v-for="[value, label] in statusEntries" :key="value" class="legend-item" type="button" :class="{ 'is-active': statusFilter === value }" @click="setStatus(value)">
          <i class="legend-dot" :style="{ backgroundColor: statusColors[value] }"></i>{{ label }}
        </button>
        <div class="legend-divider"></div>
        <button type="button" class="legend-item layer-option" @click="boundaries = !boundaries"><i class="legend-dot legend-outline" :class="{ 'layer-on': boundaries }"></i>行政区边界<span class="legend-list-button">{{ boundaries ? '显示' : '隐藏' }}</span></button>
        <button type="button" class="legend-item layer-option" @click="imagery = !imagery"><i class="legend-dot legend-outline legend-imagery" :class="{ 'layer-on': imagery }"></i>卫星影像<span class="legend-list-button">{{ imagery ? '显示' : '隐藏' }}</span></button>
        <button type="button" class="legend-item layer-option" @click="showCities = !showCities"><i class="legend-dot legend-outline" :class="{ 'layer-on': showCities }"></i>城市标注<span class="legend-list-button">{{ showCities ? '显示' : '隐藏' }}</span></button>
        <button type="button" class="legend-item layer-option" @click="openPanel('catalog')"><i class="legend-dot legend-outline legend-catalog"></i>本地发布项目<span class="legend-list-button">列表</span></button>
      </section>

      <footer class="bottom-bar" :class="{ 'bottom-left': !leftOpen, 'bottom-right': !rightOpen }">
        <button class="legend-toggle" type="button" :aria-pressed="legendOpen" @click="legendOpen = !legendOpen">图例</button>
        <nav class="bottom-tabs" aria-label="产业地图专题">
          <button v-for="tab in tabs" :key="tab" type="button" class="bottom-tab" :class="{ 'is-active': tab === currentTab }" @click="changeTab(tab)">{{ tab }}</button>
        </nav>
      </footer>

      <nav class="map-tools" :class="{ 'tools-expanded': !rightOpen }" aria-label="地图操作">
        <button type="button" aria-label="回到正北" title="回到正北" @click="mapAction('north')">◈</button>
        <button type="button" aria-label="切换俯视角度" title="切换俯视角度" @click="mapAction('tilt')">⌁</button>
        <button type="button" aria-label="放大" title="放大" @click="mapAction('in')">＋</button>
        <button type="button" aria-label="缩小" title="缩小" @click="mapAction('out')">－</button>
        <button type="button" aria-label="复位地图" title="复位地图" @click="mapAction('home')">⌖</button>
      </nav>
      <div class="coordinates">经度：{{ camera.longitude.toFixed(4) }}°　纬度：{{ camera.latitude.toFixed(4) }}°　高度：{{ (camera.height / 1000).toFixed(1) }} km</div>

      <aside v-if="selected" class="detail-drawer overlay-sheet" aria-label="项目详情">
        <header><h2>{{ selected.name }}</h2><button type="button" aria-label="关闭项目详情" @click="selectedId = null">×</button></header>
        <p>{{ selected.city }} · {{ statusLabels[selected.status] }}</p>
        <p>{{ selected.description }}</p>
        <small>{{ selected.longitude.toFixed(4) }}°E / {{ selected.latitude.toFixed(4) }}°N</small>
      </aside>
    </section>

    <div v-if="panel" class="modal-backdrop" @click.self="panel = null">
      <section class="publish-modal overlay-sheet" role="dialog" aria-modal="true" aria-labelledby="dialog-heading">
        <header>
          <h2 id="dialog-heading">{{ { publish: '数据发布', catalog: '数据目录', overview: '产业链总览', enterprise: '重点企业', service: '经信通办 · 服务事项' }[panel] }}</h2>
          <button type="button" aria-label="关闭窗口" @click="panel = null">×</button>
        </header>
        <template v-if="panel === 'publish'">
          <form class="publish-form" @submit.prevent="draft ? publish() : saveDraft()">
            <label>项目名称<input v-model.trim="form.name" :disabled="!!draft" required maxlength="120" placeholder="请输入项目名称" /></label>
            <div class="form-row">
              <label>经度<input v-model.number="form.longitude" :disabled="!!draft" required type="number" min="-180" max="180" step="any" /></label>
              <label>纬度<input v-model.number="form.latitude" :disabled="!!draft" required type="number" min="-90" max="90" step="any" /></label>
            </div>
            <p v-if="draft">草稿 #{{ draft.id }} 已保存，确认后将在光电子信息产业链中显示。</p>
            <p v-if="publishError" class="publish-error" role="alert">{{ publishError }}</p>
            <button class="primary-button" type="submit" :disabled="saving">{{ saving ? '处理中…' : draft ? '发布到大屏' : '保存草稿' }}</button>
            <button v-if="draft" class="secondary-button" type="button" @click="draft = undefined">新建另一条</button>
          </form>
        </template>
        <template v-else-if="panel === 'catalog'">
          <p>演示项目 {{ projects.length }} 条 · 本地发布 {{ localProjects.length }} 条 · {{ connected ? '数据库已连接' : '数据库离线' }}</p>
          <div class="modal-list">
            <button v-for="item in localProjects" :key="item.id" type="button" @click="goHome(); selectProject(item.id)">{{ item.name }} <span>定位 →</span></button>
            <p v-if="!localProjects.length">暂无本地发布项目</p>
          </div>
          <button class="primary-button" type="button" @click="openPanel('publish')">新增项目</button>
        </template>
        <template v-else-if="panel === 'overview'">
          <div class="modal-list">
            <button v-for="item in industries" :key="item.id" type="button" @click="chooseIndustry(item.id); panel = null">{{ item.name }} <span>{{ item.scale }} · {{ item.percentage.toFixed(2) }}%</span></button>
          </div>
        </template>
        <template v-else-if="panel === 'enterprise'">
          <p>{{ industry.name }}产业链牵头单位为{{ industry.agency }}。以下为演示项目中的企业相关记录。</p>
          <div class="modal-list">
            <button v-for="item in visibleProjects.filter(item => /公司|集团|园区|基地/.test(item.name)).slice(0, 10)" :key="item.id" type="button" @click="panel = null; selectProject(item.id)">{{ item.name }} <span>{{ item.city }}</span></button>
            <p v-if="!visibleProjects.some(item => /公司|集团|园区|基地/.test(item.name))">当前产业暂无相关演示记录</p>
          </div>
        </template>
        <template v-else>
          <p>从重点项目列表查看项目办理事项和当前状态。</p>
          <div class="modal-list">
            <button v-for="item in visibleProjects.filter(item => item.status === 'new' || item.status === 'ongoing').slice(0, 7)" :key="item.id" type="button" @click="panel = null; selectProject(item.id)">{{ item.name }} <span>办理中</span></button>
            <p v-if="!visibleProjects.some(item => item.status === 'new' || item.status === 'ongoing')">当前范围暂无在办项目</p>
          </div>
        </template>
      </section>
    </div>
    <div v-if="notice" class="toast" role="status">{{ notice }}</div>
  </main>
</template>
