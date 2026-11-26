<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { spring, springValue } from 'motion'
import PortalIcon from './PortalIcon.vue'
import { platformLink, type platformSections } from './platform-navigation'
import { roleTitles, type PlatformSession } from './platform-roles'
import type { CatalogDomain } from './catalog-domain'

type Section = (typeof platformSections)[number]
const props = defineProps<{ section: Section; sections: Section[]; session?: PlatformSession }>()
const domain = defineModel<CatalogDomain>('domain', { required: true })
const terms = defineModel<string>('terms', { required: true })
const emit = defineEmits<{ search: [] }>()
const groups = computed(() => [...new Set(props.sections.map((item) => item.group))])
const drawer = ref(false),
  dark = ref(document.documentElement.dataset.platformTheme === 'dark')
const search = ref<HTMLInputElement>(),
  nav = ref<HTMLElement>(),
  marker = ref<HTMLElement>(),
  sidebar = ref<HTMLElement>(),
  menu = ref<HTMLButtonElement>()
const desktop = matchMedia('(min-width: 1025px)'),
  reduce = matchMedia('(prefers-reduced-motion: reduce)')
const shortcut = /mac|iphone|ipad/i.test(navigator.platform) ? '⌘ K' : 'Ctrl K'
const themeLabel = computed(() => (dark.value ? '切换浅色外观' : '切换深色外观'))
const userLabel = computed(() =>
  props.session?.authenticated ? roleTitles[props.session.role] : props.session?.name,
)
const physics = { stiffness: 460, damping: 37, mass: 0.85 }
const position = springValue<number>(0, physics)
let placed = false,
  resize: ResizeObserver | undefined

function placeMarker(instant = false) {
  const block = nav.value,
    bar = marker.value
  const active = block?.querySelector<HTMLElement>('[aria-current="page"]')
  if (!block || !bar || !active || !active.offsetHeight) return
  const y = active.getBoundingClientRect().top - block.getBoundingClientRect().top
  bar.style.height = active.offsetHeight + 'px'
  if (!placed || instant || reduce.matches) {
    position.jump(y)
    bar.style.transform = 'translate3d(0,' + y + 'px,0)'
  } else position.set(y)
  placed = true
  bar.style.opacity = '1'
}
function setTheme(isDark: boolean) {
  dark.value = isDark
  const value = isDark ? 'dark' : 'light'
  document.documentElement.dataset.platformTheme = value
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#28243d' : '#f4f5fa')
  try {
    localStorage.setItem('jingshan-admin-appearance', value)
  } catch {
    /* A tab without storage can still change its appearance. */
  }
}
function closeDrawer(restore = true) {
  if (!drawer.value) return
  drawer.value = false
  if (restore && !desktop.matches) void nextTick(() => menu.value?.focus())
}
function navClick() {
  closeDrawer()
}
async function openDrawer() {
  drawer.value = true
  await nextTick()
  sidebar.value?.querySelector<HTMLElement>('[aria-current="page"]')?.focus()
  placeMarker(true)
}
function applyMotionPreference() {
  if (reduce.matches) placeMarker(true)
}
function onWidth() {
  if (desktop.matches) closeDrawer(false)
  placeMarker(true)
}
function keyDown(event: KeyboardEvent) {
  if (drawer.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDrawer()
      return
    }
    if (event.key === 'Tab') {
      const focusable = [...sidebar.value!.querySelectorAll<HTMLElement>('a[href],button')].filter(
        (el) => el.offsetWidth && !el.hasAttribute('disabled'),
      )
      const first = focusable[0],
        last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    return
  }
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === 'k' &&
    !document.querySelector('dialog[open],.admin-overlay')
  ) {
    event.preventDefault()
    search.value?.focus()
    search.value?.select()
  }
}
watch(
  () => props.section.id,
  async () => {
    const wasOpen = drawer.value
    closeDrawer(false)
    await nextTick()
    placeMarker()
    if (wasOpen) menu.value?.focus()
    window.scrollTo({ top: 0, behavior: 'instant' })
  },
  { flush: 'post' },
)
watch(
  () => props.sections,
  () => void nextTick(() => placeMarker(true)),
  { flush: 'post' },
)
onMounted(() => {
  if (CSS.supports('transition-timing-function', 'linear(0, 1)')) {
    document.documentElement.style.setProperty(
      '--portal-spring',
      String(spring({ ...physics, keyframes: [0, 1] })),
    )
  }
  reduce.addEventListener('change', applyMotionPreference)
  position.on('change', (y) => {
    if (marker.value) marker.value.style.transform = 'translate3d(0,' + y + 'px,0)'
  })
  resize = new ResizeObserver(() => placeMarker(true))
  if (nav.value) resize.observe(nav.value)
  desktop.addEventListener('change', onWidth)
  document.addEventListener('keydown', keyDown)
  placeMarker(true)
})
onBeforeUnmount(() => {
  resize?.disconnect()
  position.destroy()
  reduce.removeEventListener('change', applyMotionPreference)
  desktop.removeEventListener('change', onWidth)
  document.removeEventListener('keydown', keyDown)
})
</script>

<template>
  <div class="data-platform" :class="{ 'has-nav-drawer': drawer }">
    <button
      v-if="drawer"
      class="platform-nav-scrim"
      type="button"
      tabindex="-1"
      aria-label="收起导航"
      @click="closeDrawer()"
    ></button>
    <aside
      ref="sidebar"
      id="platform-sidebar"
      class="platform-sidebar"
      :class="{ expanded: drawer }"
      :role="drawer ? 'dialog' : undefined"
      :aria-modal="drawer || undefined"
      aria-label="平台模块"
    >
      <div class="brand-row">
        <a class="platform-brand" href="#overview" @click="navClick()">
          <span class="portal-brand-mark" aria-hidden="true"></span>
          <span><b>时空大数据</b><small>管理平台</small></span>
        </a>
        <button class="portal-icon-button drawer-close" aria-label="关闭模块导航" @click="closeDrawer()">
          <PortalIcon name="close" />
        </button>
      </div>
      <div class="portal-nav-scroll">
        <nav ref="nav" aria-label="数据中台导航">
          <i ref="marker" class="portal-nav-marker" aria-hidden="true"></i>
          <section v-for="group in groups" :key="group">
            <h2>{{ group }}</h2>
            <a
              v-for="s in sections.filter((s) => s.group === group)"
              :key="s.id"
              :href="platformLink(s.id)"
              :aria-current="section.id === s.id ? 'page' : undefined"
              @click="navClick()"
            >
              <PortalIcon :name="s.icon" :size="20" /><span>{{ s.label }}</span>
            </a>
          </section>
        </nav>
      </div>
      <a class="platform-cockpit" href="/workspace/"><PortalIcon name="catalog" :size="19" />工作区版后台<PortalIcon name="chevron" :size="15" /></a>
      <a class="platform-cockpit" href="/" target="_blank" rel="noopener"
        ><PortalIcon name="monitor" :size="19" />打开驾驶舱<PortalIcon name="external" :size="15"
      /></a>
    </aside>
    <main class="platform-main" :inert="drawer">
      <header class="platform-top">
        <button
          ref="menu"
          type="button"
          class="portal-icon-button platform-mobile-menu"
          aria-label="模块导航"
          aria-controls="platform-sidebar"
          :aria-expanded="drawer"
          @click="openDrawer"
        >
          <PortalIcon name="menu" :size="22" />
        </button>
        <form class="portal-global-search" role="search" @submit.prevent="emit('search')">
          <button type="submit" class="portal-search-submit" aria-label="执行目录搜索">
            <PortalIcon name="search" :size="21" />
          </button>
          <select v-model="domain" aria-label="全局搜索资源类别">
            <option value="spatial">空间数据</option>
            <option value="services">服务资源</option>
          </select>
          <input
            ref="search"
            v-model="terms"
            type="search"
            aria-label="全平台搜索"
            :placeholder="domain === 'spatial' ? '搜索数据集或部门' : '搜索服务名称或协议'"
          />
          <kbd aria-hidden="true">{{ shortcut }}</kbd>
        </form>
        <div class="portal-session">
          <button
            type="button"
            class="portal-icon-button"
            :title="themeLabel"
            :aria-label="themeLabel"
            :aria-pressed="dark"
            @click="setTheme(!dark)"
          >
            <PortalIcon :name="dark ? 'sun' : 'moon'" :size="21" />
          </button>
          <span v-if="userLabel" class="portal-user"
            ><span class="portal-avatar" aria-hidden="true"><PortalIcon name="user" :size="20" /><i></i></span
            ><span>{{ userLabel }}</span></span
          >
        </div>
      </header>
      <slot />
    </main>
    <slot name="dialogs" />
  </div>
</template>
