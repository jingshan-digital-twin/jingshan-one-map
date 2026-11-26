<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  catalogAssets,
  catalogTypes,
  folderResources,
  type PortalCatalog,
  type CatalogAsset,
} from './portal-catalog'
import { platformLink, platformTime, type ActivityRow } from './platform-navigation'
import { isCourtLedgerId } from './court-ledger'
import type { CimAdminService } from './cim-types'
import type { DataDocument } from './types'
import { catalogDomainNames, inCatalogDomain, parseCatalogSearch, type CatalogDomain } from './catalog-domain'
import { useTableSelection } from './platform-selection'
import PlatformSelectionBar from './PlatformSelectionBar.vue'
import type { ResourceTarget } from './resource-removal'
import PortalIcon from './PortalIcon.vue'
import CatalogCover from './CatalogCover.vue'
import PublishedMapGraphic from './PublishedMapGraphic.vue'
import CatalogOrganizer from './CatalogOrganizer.vue'
const props = defineProps<{
  draft: DataDocument
  services: CimAdminService[]
  serviceError: string
  activity: ActivityRow[]
  activityError: string
  version: number
  publishedAt: string
  initialQuery: string
  canEdit: boolean
  viewerMode: boolean
  workspaceLayout?: boolean
}>()
const emit = defineEmits<{
  catalog: [PortalCatalog]
  domain: [domain: CatalogDomain, query: string]
  batch: [targets: ResourceTarget[]]
  organize: []
  visit: [CatalogAsset]
}>()
const domain = ref<CatalogDomain>(parseCatalogSearch(props.initialQuery).domain)
const catalog = computed(() => catalogAssets(props.draft.datasets, props.services))
const assets = computed(() => catalog.value.filter((a) => inCatalogDomain(a.type, domain.value)))
function openAsset(a: CatalogAsset, preview = false) {
  if (!props.canEdit || a.type === 'views' || (preview && a.type !== 'forms'))
    return platformLink('preview', a.key)
  return platformLink(a.type, a.id)
}
function assetAction(a: CatalogAsset) {
  if (!props.canEdit || a.type === 'views') return '预览' + (a.type === 'views' ? '图层' : '资源')
  if (a.type === 'services') return '管理服务'
  if (a.type === 'forms') return '管理表单'
  return isCourtLedgerId(a.id) ? '管理场地' : '管理记录'
}
function relationship(a: CatalogAsset) {
  if (a.type === 'views') return '源数据集 · ' + a.sourceName
  if (a.type === 'services')
    return a.service?.hostedDatasetId ? '本地发布 · ' + a.sourceName : '外部接入 · ' + a.format
  return a.sourceName ? '数据来源 · ' + a.sourceName : a.group
}
const boundary = computed(() => props.draft.datasets.find((d) => d.id === 'administration'))
const mode = ref<'cards' | 'table'>(props.workspaceLayout ? 'table' : 'cards'),
  selection = ref('all'),
  format = ref(''),
  terms = ref(parseCatalogSearch(props.initialQuery).query),
  page = ref(1),
  sort = ref('default')
const serviceOrigin = ref(''),
  treeExpanded = ref(false)
const folded = ref<string[]>(props.workspaceLayout ? Object.keys(catalogTypes) : []),
  organizing = ref(false)
type Kind = keyof typeof catalogTypes
const types = Object.keys(catalogTypes) as Kind[]
const tree = computed(() =>
  types
    .filter((k) => inCatalogDomain(k, domain.value))
    .map((k) => {
      const group = assets.value.filter((a) => a.type === k)
      return {
        id: k,
        name: catalogTypes[k],
        count: group.length,
        children: [...new Set(group.map((a) => a.group).filter(Boolean))]
          .sort()
          .map((name) => ({ id: k + ':' + name, name, count: group.filter((a) => a.group === name).length })),
      }
    }),
)
const folders = computed(() => props.draft.portalCatalog?.folders ?? [])
const folderTree = computed(() => {
  const out: { id: string; name: string; depth: number }[] = []
  function visit(parent: string, depth: number) {
    for (const f of folders.value.filter((f) => f.parent === parent)) {
      out.push({ id: f.id, name: f.name, depth })
      visit(f.id, depth + 1)
    }
  }
  visit('', 0)
  return out
})
const pinned = ref<string[]>([])
try {
  const saved = JSON.parse(localStorage.getItem('js-portal-favorites') ?? '[]')
  if (Array.isArray(saved)) pinned.value = saved.filter((v: unknown) => typeof v === 'string')
} catch {
  /* unavailable storage */
}
function bookmark(a: CatalogAsset) {
  pinned.value = pinned.value.includes(a.key)
    ? pinned.value.filter((k) => k !== a.key)
    : [...pinned.value, a.key]
  try {
    localStorage.setItem('js-portal-favorites', JSON.stringify(pinned.value))
  } catch {
    /* session-only favorites */
  }
}
const filtered = computed(() => {
  const s = selection.value,
    q = terms.value.trim().toLowerCase(),
    f = s.startsWith('folder:') ? folderResources(folders.value, s.slice(7)) : null
  const list = assets.value.filter(
    (a) =>
      (f
        ? f.has(a.key)
        : s === 'all' ||
          (s === 'favorites' && pinned.value.includes(a.key)) ||
          a.type === s ||
          a.type + ':' + a.group === s) &&
      (!serviceOrigin.value ||
        domain.value !== 'services' ||
        (a.service?.hostedDatasetId ? 'hosted' : 'external') === serviceOrigin.value) &&
      (!format.value || a.format === format.value) &&
      (!q ||
        [a.name, a.id, a.group, a.format, a.detail, a.sourceName, a.dataset?.department]
          .join(' ')
          .toLowerCase()
          .includes(q)),
  )
  return sort.value === 'name' ? list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')) : list
})
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 6)))
const visible = computed(() => filtered.value.slice((page.value - 1) * 6, page.value * 6))
const kindIcons = { local: 'local', views: 'preview', services: 'services', forms: 'forms' } as const
const summary = computed(() =>
  (['spatial', 'services'] as const).map((key) => {
    const rows = catalog.value.filter((a) => inCatalogDomain(a.type, key))
    const first = rows.filter((a) =>
      key === 'spatial' ? a.type === 'local' : !!a.service?.hostedDatasetId,
    ).length
    return {
      filter: key,
      label: catalogDomainNames[key],
      icon: key === 'spatial' ? 'local' : 'services',
      value: rows.length,
      first,
      second: rows.length - first,
      firstLabel: key === 'spatial' ? '源数据集' : '本地发布',
      secondLabel: key === 'spatial' ? '展示图层' : '外部接入',
    }
  }),
)
function switchDomain(key: CatalogDomain) {
  domain.value = key
  serviceOrigin.value = ''
  choose('all')
  emit('domain', key, terms.value)
}
const selectable = computed(() => filtered.value.filter((a) => a.type !== 'views').map((a) => a.key))
const pick = useTableSelection(selectable, [domain, selection, terms, format, serviceOrigin])
function removeChecked() {
  const targets: ResourceTarget[] = []
  for (const a of filtered.value)
    if (pick.checked.value.has(a.key)) {
      if (a.service) targets.push({ kind: 'service', service: a.service })
      else if (a.dataset && a.type === 'local') targets.push({ kind: 'dataset', id: a.id })
    }
  if (targets.length) emit('batch', targets)
}
function choose(v: string) {
  selection.value = v
  format.value = ''
  page.value = 1
}
function editFolders() {
  if (props.workspaceLayout) emit('organize')
  else organizing.value = true
}
function showAllResources() {
  terms.value = ''
  switchDomain(domain.value)
}
function toggle(id: string) {
  folded.value = folded.value.includes(id) ? folded.value.filter((x) => x !== id) : [...folded.value, id]
}
watch(
  () => props.initialQuery,
  (v) => {
    const input = parseCatalogSearch(v)
    domain.value = input.domain
    terms.value = input.query
    serviceOrigin.value = ''
    choose('all')
  },
)
watch([terms, format, sort, serviceOrigin], () => (page.value = 1))
watch(pages, (v) => (page.value = Math.min(page.value, v)))
</script>
<template>
  <div class="portal-catalog">
    <div v-if="!workspaceLayout" class="catalog-summary">
      <section class="atlas-panel publication-card">
        <div class="release-copy">
          <h2>一张图发布版本</h2>
          <strong>V{{ version }}</strong>
          <time :datetime="publishedAt">{{ platformTime(publishedAt) }}</time>
          <a v-if="!viewerMode" href="#versions">查看版本 <PortalIcon name="arrow" :size="15" /></a>
        </div>
        <PublishedMapGraphic :boundary="boundary" />
      </section>
      <section class="atlas-panel stats-card">
        <header>
          <h2>资源概况</h2>
          <span
            >共 <b>{{ summary.reduce((n, s) => n + s.value, 0) }}</b> 项</span
          >
        </header>
        <div class="atlas-metrics">
          <button
            v-for="item in summary"
            :key="item.filter"
            :aria-pressed="domain === item.filter"
            :data-tone="item.filter"
            @click="switchDomain(item.filter)"
          >
            <span class="metric-pict"><PortalIcon :name="item.icon" :size="21" /></span>
            <span class="metric-copy"
              ><small>{{ item.label }}</small
              ><strong>{{ item.value }}</strong></span
            >
            <span class="metric-flag" aria-hidden="true"><PortalIcon name="check" :size="13" /></span>
            <span class="metric-split"
              ><span
                >{{ item.firstLabel }} <b>{{ item.first }}</b></span
              ><i></i
              ><span
                >{{ item.secondLabel }} <b>{{ item.second }}</b></span
              ></span
            >
          </button>
        </div>
      </section>
    </div>
    <p v-if="serviceError" class="message error" role="alert">{{ serviceError }}</p>
    <div class="atlas-columns">
      <div class="atlas-directory">
        <aside class="atlas-tree atlas-panel" :class="{ expanded: treeExpanded }">
          <header>
            <PortalIcon name="folder" />
            <h2>目录导航</h2>
            <button
              class="tree-mobile-toggle"
              type="button"
              :aria-expanded="treeExpanded"
              aria-controls="catalog-tree-body"
              @click="treeExpanded = !treeExpanded"
            >
              {{ treeExpanded ? '收起' : '展开' }} <PortalIcon name="chevron" :size="15" />
            </button>
          </header>
          <div id="catalog-tree-body">
            <div v-if="workspaceLayout" class="tree-roots">
              <button v-for="item in summary" :key="item.filter" :class="{ picked: domain === item.filter }" @click="switchDomain(item.filter)">
                <PortalIcon :name="item.icon" />{{ item.label }}<small>{{ item.value }}</small>
              </button>
            </div>
            <div class="tree-roots">
              <button :class="{ picked: selection === 'all' }" @click="choose('all')">
                <PortalIcon name="catalog" />全部{{ catalogDomainNames[domain] }}
                <small>{{ assets.length }}</small>
              </button>
              <button :class="{ picked: selection === 'favorites' }" @click="choose('favorites')">
                <PortalIcon name="star" />本机收藏
                <small>{{ assets.filter((a) => pinned.includes(a.key)).length }}</small>
              </button>
            </div>
            <div class="tree-groups">
              <div v-for="g in tree" :key="g.id" class="tree-group">
                <div class="tree-row" :class="{ picked: selection === g.id }">
                  <button
                    class="disclose"
                    :aria-label="(folded.includes(g.id) ? '展开' : '收起') + g.name"
                    :aria-expanded="!folded.includes(g.id)"
                    @click="toggle(g.id)"
                  >
                    <PortalIcon name="chevron" :size="13" /></button
                  ><button @click="choose(g.id)">
                    <PortalIcon :name="kindIcons[g.id]" :size="16" />{{ g.name }}<small>{{ g.count }}</small>
                  </button>
                </div>
                <div v-if="!folded.includes(g.id)" class="tree-branches">
                  <button
                    v-for="c in g.children"
                    :key="c.id"
                    :class="{ picked: selection === c.id }"
                    :title="c.name"
                    @click="choose(c.id)"
                  >
                    <span>{{ c.name }}</span
                    ><small>{{ c.count }}</small>
                  </button>
                </div>
              </div>
            </div>
            <div class="atlas-folders">
              <header>
                <b>专题目录</b
                ><button
                  v-if="canEdit"
                  @click="editFolders"
                  title="编排专题目录"
                  aria-label="编排专题目录"
                >
                  <PortalIcon name="settings" :size="17" />
                </button>
              </header>
              <button
                v-for="f in folderTree"
                :key="f.id"
                :class="{ picked: selection === 'folder:' + f.id }"
                :style="{ paddingLeft: Math.min(5, f.depth) * 10 + 8 + 'px' }"
                @click="choose('folder:' + f.id)"
              >
                <PortalIcon name="folder" :size="15" />{{ f.name }}
              </button>
              <button v-if="!folders.length && canEdit" @click="editFolders">＋ 新建专题</button>
            </div>
          </div>
        </aside>
        <slot v-if="workspaceLayout" name="directory-footer" />
        <section v-if="!viewerMode && !workspaceLayout" class="atlas-panel recent-card">
          <header>
            <PortalIcon name="clock" :size="18" />
            <h2>最近动态</h2>
            <a href="#activity" aria-label="查看全部动态"><PortalIcon name="arrow" :size="17" /></a>
          </header>
          <p v-if="activityError">{{ activityError }}</p>
          <p v-else-if="!activity.length">暂无变更记录</p>
          <ol v-else>
            <li v-for="r in activity.slice(0, 4)" :key="r.id">
              <i></i><b>{{ r.action }}</b
              ><span :title="r.resource">{{ r.resource }}</span
              ><time>{{ platformTime(r.recordedAt) }}</time>
            </li>
          </ol>
        </section>
      </div>
      <section class="atlas-shelf" aria-label="资源列表">
        <div class="shelf-heading">
          <h2>
            <PortalIcon v-if="workspaceLayout && terms" name="search" :size="20" />
            {{ workspaceLayout && terms ? terms : catalogDomainNames[domain] }} <small>{{ filtered.length }}</small>
          </h2>
          <div class="mode-switch">
            <button :aria-pressed="mode === 'cards'" aria-label="卡片视图" @click="mode = 'cards'">
              <PortalIcon name="grid" :size="16" /></button
            ><button :aria-pressed="mode === 'table'" aria-label="列表视图" @click="mode = 'table'">
              <PortalIcon name="list" :size="18" />
            </button>
          </div>
        </div>
        <div class="atlas-filters">
          <label
            ><PortalIcon name="search" :size="16" /><input
              type="search"
              aria-label="搜索目录"
              v-model="terms"
              placeholder="搜索资源名称"
          /></label>
          <select v-if="domain === 'services'" v-model="serviceOrigin" aria-label="服务来源">
            <option value="">全部服务来源</option>
            <option value="hosted">本地数据发布</option>
            <option value="external">外部服务接入</option>
          </select>
          <select v-model="format" aria-label="资源格式">
            <option value="">全部格式</option>
            <option v-for="f in [...new Set(assets.map((a) => a.format))]" :key="f">{{ f }}</option>
          </select>
          <select v-model="sort" aria-label="排序">
            <option value="default">默认排序</option>
            <option value="name">名称排序</option>
          </select>
        </div>
        <PlatformSelectionBar
          v-if="canEdit"
          :total="selectable.length"
          :selected="pick.selected.value.length"
          :label="catalogDomainNames[domain]"
          @all="pick.toggleAll"
          @clear="pick.clear"
          ><button type="button" :disabled="!pick.selected.value.length" @click="removeChecked">
            {{ domain === 'services' ? '批量下线' : '批量删除数据集' }}
          </button></PlatformSelectionBar
        >
        <div v-if="mode === 'cards'" class="atlas-cards">
          <article v-for="a in visible" :key="a.key">
            <a class="cover-link" :href="openAsset(a, true)" :aria-label="'预览' + a.name" @click="emit('visit',a)"
              ><CatalogCover :asset="a" :boundary="boundary"
            /></a>
            <button
              class="star-asset"
              :aria-pressed="pinned.includes(a.key)"
              :aria-label="(pinned.includes(a.key) ? '取消收藏' : '收藏') + a.name"
              @click="bookmark(a)"
            >
              <PortalIcon name="star" :size="15" />
            </button>
            <label v-if="canEdit && a.type !== 'views'" class="catalog-pick" :title="'选择' + a.name"
              ><input
                type="checkbox"
                :aria-label="'选择' + a.name"
                :checked="pick.checked.value.has(a.key)"
                @change="pick.toggle(a.key)"
            /></label>
            <div class="asset-caption">
              <a :href="openAsset(a)" :title="a.name" @click="emit('visit',a)">{{ a.name }}</a
              ><span class="atlas-label" :data-kind="a.type">{{ catalogTypes[a.type] }}</span
              ><small :title="relationship(a)">{{ relationship(a) }}</small>
            </div>
            <footer>
              <span>{{ a.info }}</span>
              <div class="asset-actions">
                <a :href="openAsset(a)" @click="emit('visit',a)">{{ assetAction(a) }} <PortalIcon name="chevron" :size="13" /></a>
              </div>
            </footer>
          </article>
        </div>
        <div v-else class="atlas-panel table-scroll">
          <table>
            <thead>
              <tr>
                <th v-if="canEdit">选择</th>
                <th>资源名称</th>
                <th>资源类型</th>
                <th>来源 / 分类</th>
                <th>记录 / 状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in visible" :key="a.key">
                <td v-if="canEdit">
                  <input
                    v-if="a.type !== 'views'"
                    type="checkbox"
                    :aria-label="'选择' + a.name"
                    :checked="pick.checked.value.has(a.key)"
                    @change="pick.toggle(a.key)"
                  />
                </td>
                <td>
                  <a :href="openAsset(a)" @click="emit('visit',a)">{{ a.name }}</a>
                </td>
                <td>
                  <span class="atlas-label" :data-kind="a.type">{{ catalogTypes[a.type] }}</span>
                </td>
                <td>{{ relationship(a) }}</td>
                <td>{{ a.info }}</td>
                <td>
                  <div class="asset-actions">
                    <a :href="openAsset(a)" @click="emit('visit',a)">{{ assetAction(a) }}</a>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!visible.length" class="catalog-empty">
          当前条件下没有资源
          <button @click="showAllResources">查看全部资源</button>
        </div>
        <footer class="shelf-pager">
          <span>共 {{ filtered.length }} 项资源</span
          ><button :disabled="page <= 1" @click="page--" aria-label="上一页">‹</button><b>{{ page }}</b
          ><span>/ {{ pages }}</span
          ><button :disabled="page >= pages" @click="page++" aria-label="下一页">›</button>
        </footer>
      </section>
    </div>
    <CatalogOrganizer
      v-if="organizing"
      :catalog="draft.portalCatalog"
      :assets="catalog"
      @apply="emit('catalog', $event)"
      @close="organizing = false"
    />
  </div>
</template>
