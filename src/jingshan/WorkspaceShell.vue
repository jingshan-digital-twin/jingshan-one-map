<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PortalIcon from './PortalIcon.vue'
import { platformLink, type platformSections } from './platform-navigation'
import { roleTitles, type PlatformSession } from './platform-roles'
import type { CatalogDomain } from './catalog-domain'
import './workspace-shell.css'

type Section = (typeof platformSections)[number]
const props = defineProps<{ section: Section; sections: Section[]; session?: PlatformSession; version?: number }>()
const domain = defineModel<CatalogDomain>('domain', { required: true })
const terms = defineModel<string>('terms', { required: true })
const emit = defineEmits<{ search: [] }>()
const groups = computed(() => [...new Set(props.sections.map(item => item.group))])
const canOpenActivity = computed(() => props.sections.some(item => item.id === 'activity'))
const role = computed(() => props.session ? roleTitles[props.session.role] : '')
const drawer = ref(false)
const accountOpen = ref(false)
const searchOpen = ref(false)
const dark = ref(document.documentElement.dataset.platformTheme === 'dark')
const desktop = matchMedia('(min-width: 981px)')
const sidebar = ref<HTMLElement>()
const menu = ref<HTMLButtonElement>()
const accountButton = ref<HTMLButtonElement>()
const account = ref<HTMLElement>()
const searchForm = ref<HTMLFormElement>()
const searchInput = ref<HTMLInputElement>()

function toggleTheme() {
  dark.value = !dark.value
  const value = dark.value ? 'dark' : 'light'
  document.documentElement.dataset.platformTheme = value
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark.value ? '#23222b' : '#f7f8fb')
  try { localStorage.setItem('jingshan-workspace-appearance', value) } catch { /* Storage is optional. */ }
}
function closeDrawer(restoreFocus = true) {
  if (!drawer.value) return
  drawer.value = false
  if (restoreFocus && !desktop.matches) void nextTick(() => menu.value?.focus())
}
async function openDrawer() {
  accountOpen.value = false
  searchOpen.value = false
  drawer.value = true
  await nextTick()
  sidebar.value?.querySelector<HTMLElement>('[aria-current="page"]')?.focus()
}
function closeAccount() {
  accountOpen.value = false
  accountButton.value?.focus()
}
function submitSearch() {
  emit('search')
  searchOpen.value = false
  searchInput.value?.blur()
}
function dismissOutside(event: Event) {
  const node = event.target
  if (!(node instanceof Node)) return
  if (!account.value?.contains(node)) accountOpen.value = false
  if (!searchForm.value?.contains(node)) searchOpen.value = false
}
function onKeyDown(event: KeyboardEvent) {
  if (drawer.value && event.key === 'Tab') {
    const links = [...sidebar.value!.querySelectorAll<HTMLElement>('a[href], button')].filter(el => el.getClientRects().length)
    const first = links[0], last = links.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    return
  }
  if (event.key === 'Escape') {
    if (drawer.value) closeDrawer()
    else if (accountOpen.value) closeAccount()
    else if (searchOpen.value) { searchOpen.value = false; searchInput.value?.blur() }
  } else if (!drawer.value && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' &&
      !document.querySelector('dialog[open],.admin-overlay')) {
    event.preventDefault()
    searchInput.value?.focus()
    searchInput.value?.select()
    searchOpen.value = true
  }
}
function resize() { if (desktop.matches) closeDrawer(false) }
watch(() => props.section.id, () => {
  closeDrawer()
  accountOpen.value = false
  searchOpen.value = false
  window.scrollTo({ top: 0, behavior: 'instant' })
})
onMounted(() => {
  desktop.addEventListener('change', resize)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('pointerdown', dismissOutside)
  document.addEventListener('focusin', dismissOutside)
})
onBeforeUnmount(() => {
  desktop.removeEventListener('change', resize)
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('pointerdown', dismissOutside)
  document.removeEventListener('focusin', dismissOutside)
})
</script>

<template>
  <div class="data-platform workspace-shell" :class="{ 'ws-drawer-open': drawer, 'ws-catalogue-route': section.id === 'overview' }">
    <button v-if="drawer" class="ws-scrim" type="button" tabindex="-1" aria-label="收起导航" @click="closeDrawer()"></button>
    <aside id="workspace-sidebar" ref="sidebar" class="ws-sidebar" :role="drawer ? 'dialog' : undefined" :aria-modal="drawer || undefined" aria-label="平台模块">
      <div class="ws-brand-row">
        <a class="ws-brand" href="#overview" @click="closeDrawer()"><i aria-hidden="true"></i>时空大数据</a>
        <button type="button" class="ws-quiet ws-drawer-close" aria-label="关闭模块导航" @click="closeDrawer()"><PortalIcon name="close" :size="17"/></button>
      </div>
      <nav class="ws-nav" aria-label="数据中台导航">
        <section v-for="group in groups" :key="group" :aria-label="group">
          <h2 v-if="group !== '平台门户'">{{ group }}</h2>
          <a v-for="item in sections.filter(s => s.group === group)" :key="item.id" :href="platformLink(item.id)"
             :aria-current="section.id === item.id ? 'page' : undefined" @click="closeDrawer()">
            <PortalIcon :name="item.icon" :size="16"/><span>{{ item.label }}</span>
          </a>
        </section>
      </nav>
      <footer class="ws-side-foot">
        <span v-if="version != null" class="ws-release"><i aria-hidden="true"></i>发布版 V{{ version }}</span>
        <a href="/" target="_blank" rel="noopener"><PortalIcon name="external" :size="14"/>打开驾驶舱</a>
      </footer>
    </aside>
    <main class="workspace-main" :inert="drawer">
      <header class="ws-topbar">
        <button ref="menu" type="button" class="ws-quiet ws-menu" aria-label="模块导航" aria-controls="workspace-sidebar" :aria-expanded="drawer" @click="openDrawer">
          <PortalIcon name="menu" :size="21"/>
        </button>
        <div class="ws-crumbs" aria-label="当前位置"><PortalIcon name="grid" :size="14"/><a href="#overview">工作区</a><i>/</i><b>{{ section.label }}</b></div>
        <form ref="searchForm" class="ws-search" role="search" @submit.prevent="submitSearch">
          <button type="submit" class="ws-search-button" aria-label="执行目录搜索"><PortalIcon name="search" :size="16"/></button>
          <input ref="searchInput" v-model="terms" type="search" aria-label="全平台搜索" :placeholder="section.id === 'overview' ? '搜索空间数据或服务' : '搜索资源'" @focus="searchOpen = true" @input="searchOpen = true"/>
          <div v-if="searchOpen" class="ws-search-tools">
            <select v-model="domain" aria-label="全局搜索资源类别"><option value="spatial">空间数据</option><option value="services">服务资源</option></select>
            <button type="submit">搜索</button>
          </div>
        </form>
        <div class="ws-user-tools">
          <a v-if="canOpenActivity" class="ws-quiet" href="#activity" title="运行与审计" aria-label="查看运行动态">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 16c1.5-2 2-4 2-7a5 5 0 0 1 10 0c0 3 .5 5 2 7l.7 1.5H4.3L5 16ZM10 20a2.4 2.4 0 0 0 4 0"/></svg>
          </a>
          <div ref="account" class="ws-account">
            <button ref="accountButton" type="button" class="ws-profile" :title="role || '工作区菜单'" aria-label="工作区账户菜单" aria-controls="workspace-profile-menu" :aria-expanded="accountOpen" @click="accountOpen = !accountOpen">
              <img src="/jingshan/ui/workspace-avatar.png" width="34" height="34" alt=""/><PortalIcon name="chevron" :size="12"/>
            </button>
            <div v-if="accountOpen" id="workspace-profile-menu" class="ws-pop">
              <div v-if="session" class="ws-identity"><strong>{{ session.name }}</strong><small v-if="session.name !== role">{{ role }}</small></div>
              <button type="button" :aria-label="dark ? '切换浅色外观' : '切换深色外观'" :aria-pressed="dark" @click="toggleTheme"><PortalIcon :name="dark ? 'sun' : 'moon'" :size="16"/>{{ dark ? '切换浅色外观' : '切换深色外观' }}</button>
              <a href="/admin/"><PortalIcon name="monitor" :size="16"/>原版后台</a>
            </div>
          </div>
        </div>
      </header>
      <slot />
    </main>
    <slot name="dialogs"/>
  </div>
</template>
