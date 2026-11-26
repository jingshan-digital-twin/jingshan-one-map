<script setup lang="ts">
import { workspaceEdition } from './workspace-artwork'
import { computed, onMounted, ref } from 'vue'
import { api, downloadFile, jsonRequest } from './api'
import { platformTime, type ActivityRow } from './platform-navigation'
import {
  roleTitles,
  capabilityTitles,
  allowed,
  type Capability,
  type PlatformRole,
  type PlatformSession,
} from './platform-roles'
import type { CimAdminService } from './cim-types'
import PortalIcon from './PortalIcon.vue'
type User = { name: string; role: PlatformRole; department: string; enabled: boolean }
type Review = {
  id: number
  revision: number
  note: string
  applicant: string
  created: string
  state: 'pending' | 'approved' | 'rejected'
  opinion: string
  reviewer: string
  version: number | null
  finished: string
}
const props = defineProps<{
  section: 'activity' | 'reviews' | 'accounts' | 'api'
  session: PlatformSession
  services: CimAdminService[]
  revision: number
  canSubmit: boolean
  activity: ActivityRow[]
  activityError: string
  loading: boolean
  moreActivity: boolean
}>()
const emit = defineEmits<{ published: []; loadActivity: [more?: boolean] }>()
const busy = ref(false),
  error = ref(''),
  notice = ref(''),
  terms = ref(''),
  users = ref<User[]>([]),
  reviews = ref<Review[]>([]),
  more = ref(false),
  selected = ref(0),
  note = ref(''),
  opinion = ref(''),
  selectedApi = ref(0),
  body = ref(''),
  http = ref(''),
  username = ref(''),
  password = ref(''),
  department = ref(''),
  role = ref<PlatformRole>('editor'),
  addUser = ref(false)
const ops = ref<{ bytes: number; changes: number; versions: number; pending: number }>()
const current = computed(() => reviews.value.find((r) => r.id === selected.value)),
  statuses = { pending: '待审批', approved: '已发布', rejected: '已退回' }
const roles = Object.keys(roleTitles) as PlatformRole[],
  actions = Object.keys(capabilityTitles) as Capability[]
const logRows = computed(() =>
  props.activity.filter((r) => [r.area, r.action, r.resource, r.detail].join(' ').includes(terms.value.trim())),
)
const serviceStatusLabels: Record<string, string> = {
  online: '可访问',
  offline: '无法连接',
  auth: '需要授权',
  invalid: '响应异常',
  unchecked: '尚未检测',
}
const apiQuery = ref(''),
  apiPage = ref(1),
  apiSize = ref(10)
const endpoints = [
  {
    label: '已发布资源目录',
    path: '/api/jingshan/platform/catalog',
    desc: '按名称、编号、部门或协议检索已发布的数据集及已启用的服务。',
  },
  { label: '已发布业务数据', path: '/api/jingshan/data', desc: '读取驾驶舱当前版本及其数据集。' },
  {
    label: '地图服务目录',
    path: '/api/jingshan/cim/services',
    desc: '获取已启用服务的协议、图层和地图访问地址。',
  },
  {
    label: '行政区划要素',
    path: '/api/jingshan/layers/administration/features.geojson',
    desc: '以 GeoJSON 读取当前发布版本的京山市行政区划。',
  },
  {
    label: '数据变更记录',
    path: '/api/jingshan/admin/activity',
    desc: '读取最近的操作记录，可通过 before 游标翻页。',
  },
  { label: '工作区版本', path: '/api/jingshan/admin/versions?view=page', desc: '列出已发布版本与发布时间。' },
  { label: '服务健康检查', path: '/api/health', desc: '检查 API 和数据库连接。' },
]
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await action()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败'
  } finally {
    busy.value = false
  }
}
async function loadReviews(next = false) {
  const v = await api<{ items: Review[]; more: boolean }>(
    '/platform/reviews' + (next ? '?before=' + reviews.value.at(-1)?.id : ''),
  )
  reviews.value = next ? [...reviews.value, ...v.items] : v.items
  more.value = v.more
  if (!reviews.value.some((r) => r.id === selected.value)) selected.value = reviews.value[0]?.id ?? 0
}
async function loadUsers() {
  users.value = await api<User[]>('/platform/users')
}
async function submit() {
  await run(async () => {
    await api('/platform/reviews', jsonRequest('POST', { revision: props.revision, note: note.value }))
    note.value = ''
    await loadReviews()
    notice.value = '发布申请已提交'
  })
}
async function decide(state: 'approved' | 'rejected') {
  if (!current.value) return
  await run(async () => {
    const v = await api<{ version?: number }>(
      '/platform/reviews/' + selected.value + '/decision',
      jsonRequest('POST', { state, opinion: opinion.value }),
    )
    opinion.value = ''
    if (v.version) emit('published')
    await loadReviews()
    notice.value = v.version ? 'V' + v.version + ' 已发布到驾驶舱' : '申请已退回'
  })
}
async function create() {
  await run(async () => {
    await api(
      '/platform/users',
      jsonRequest('POST', {
        name: username.value,
        role: role.value,
        password: password.value,
        department: department.value,
      }),
    )
    password.value = ''
    username.value = ''
    department.value = ''
    addUser.value = false
    await loadUsers()
  })
}
async function edit(u: User, role: PlatformRole, enabled: boolean) {
  await run(async () => {
    await api('/platform/users/' + encodeURIComponent(u.name), jsonRequest('PATCH', { role, enabled }))
    await loadUsers()
  })
}
const requestPath = computed(() => {
  const path = endpoints[selectedApi.value].path
  return path.endsWith('/catalog')
    ? path +
        '?' +
        new URLSearchParams({ q: apiQuery.value, page: String(apiPage.value), pageSize: String(apiSize.value) })
    : path
})
async function request() {
  await run(async () => {
    const start = performance.now(),
      r = await fetch(requestPath.value)
    const value = await r.text()
    let summary = ''
    try {
      summary = JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      summary = value
    }
    body.value = summary.slice(0, 10000) + (summary.length > 10000 ? '\n…（预览前 10,000 字符）' : '')
    http.value = r.status + ' ' + r.statusText + ' · ' + Math.round(performance.now() - start) + ' ms'
  })
}
function exportLog() {
  void run(async () => {
    const all: ActivityRow[] = []
    let before = ''
    let next = true
    while (next) {
      const v = await api<{ items: ActivityRow[]; more: boolean }>('/admin/activity' + before)
      all.push(...v.items)
      next = v.more && !!v.items.length
      before = '?before=' + v.items.at(-1)?.id
    }
    const filtered = all.filter((r) =>
      [r.area, r.action, r.resource, r.detail].join(' ').includes(terms.value.trim()),
    )
    downloadFile('数据变更记录.json', JSON.stringify(filtered, null, 2))
    notice.value = '已导出 ' + filtered.length + ' 条变更记录'
  })
}
onMounted(
  () =>
    void run(async () => {
      if (props.section === 'reviews') await loadReviews()
      if (props.section === 'accounts' && props.session.role === 'admin') await loadUsers()
      if (props.section === 'activity') ops.value = await api('/platform/operations')
    }),
)
</script>
<template>
  <div class="govern" :data-section="section">
    <p v-if="error" class="message error" role="alert">{{ error }}</p>
    <p v-if="notice" class="message success" role="status">{{ notice }}</p>
    <template v-if="section === 'activity'">
      <div class="gov-metrics">
        <div
          v-for="x in [
            ['最近检测在线', services.filter((s) => s.enabled && s.status === 'online').length + ' 项'],
            ['数据库占用', ops ? (ops.bytes / 1048576).toFixed(1) + ' MB' : '—'],
            ['发布版本', ops?.versions ?? '—'],
            ['待审批', ops?.pending ?? '—'],
          ]"
          :key="x[0]"
        >
          <small>{{ x[0] }}</small
          ><strong>{{ x[1] }}</strong>
        </div>
      </div>
      <section class="platform-card gov-panel">
        <header>
          <h2>服务运行状态</h2>
          <a href="#services">管理与检测 ↗</a>
        </header>
        <div class="status-list">
          <span v-for="key in ['online', 'offline', 'auth', 'invalid', 'unchecked']" :key="key"
            ><i :data-status="key"></i>{{ serviceStatusLabels[key] }}
            <b>{{ services.filter((s) => s.enabled && s.status === key).length }}</b></span
          >
        </div>
      </section>
      <section class="platform-card gov-panel">
        <header>
          <h2>操作日志</h2>
          <div>
            <input type="search" v-model="terms" aria-label="筛选操作日志" placeholder="筛选当前记录" /><button
              @click="emit('loadActivity', false)"
              :disabled="loading"
            >
              刷新</button
            ><button @click="exportLog" :disabled="busy">导出记录</button>
          </div>
        </header>
        <p v-if="activityError" class="message error">{{ activityError }}</p>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>操作时间</th>
                <th>业务模块</th>
                <th>操作</th>
                <th>资源</th>
                <th>变更信息</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in logRows" :key="r.id">
                <td>{{ platformTime(r.recordedAt) }}</td>
                <td>{{ r.area }}</td>
                <td>{{ r.action }}</td>
                <td>{{ r.resource }}</td>
                <td>{{ r.detail }}</td>
              </tr>
              <tr v-if="!logRows.length">
                <td colspan="5">暂无匹配记录</td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer v-if="moreActivity">
          <button :disabled="loading" @click="emit('loadActivity', true)">加载更早记录</button>
        </footer>
      </section>
    </template>
    <template v-if="section === 'reviews'">
      <div class="gov-split">
        <section class="platform-card gov-panel">
          <header>
            <h2>发布申请</h2>
            <button @click="run(() => loadReviews())">刷新</button>
          </header>
          <p v-if="!reviews.length">暂无申请</p>
          <button
            v-for="r in reviews"
            :key="r.id"
            class="gov-item"
            :aria-pressed="selected === r.id"
            @click="selected = r.id; opinion = ''"
          >
            <b>草稿 R{{ r.revision }}</b
            ><span>{{ statuses[r.state] }}</span
            ><small>{{ r.note }}</small>
          </button>
          <footer v-if="more"><button @click="run(() => loadReviews(true))">加载更多</button></footer>
        </section>
        <section class="platform-card gov-panel">
          <header><h2>审批详情</h2></header>
          <div v-if="current" class="gov-fields">
            <b>R{{ current.revision }} · {{ statuses[current.state] }}</b>
            <p>{{ current.note }}</p>
            <small>{{ current.applicant }} 提交于 {{ platformTime(current.created) }}</small
            ><template v-if="current.finished"
              ><p>{{ current.opinion }}</p>
              <small
                >{{ current.reviewer }} · {{ platformTime(current.finished) }}
                {{ current.version ? '· V' + current.version : '' }}</small
              ></template
            >
            <template v-if="current.state === 'pending' && allowed(session.role, 'review')"
              ><label>审批意见<textarea v-model="opinion" maxlength="500" /></label>
              <div>
                <button @click="decide('rejected')" :disabled="busy || !opinion.trim()">退回</button>
                <button class="primary" @click="decide('approved')" :disabled="busy">同意并发布</button>
              </div></template
            >
          </div>
          <p v-else>提交申请后可在这里查看处理进度。</p>
        </section>
      </div>
      <form v-if="allowed(session.role, 'edit')" class="platform-card gov-panel" @submit.prevent="submit">
        <header>
          <h2>提交当前草稿</h2>
          <span>R{{ revision }}</span>
        </header>
        <div class="gov-fields">
          <label
            >发布说明<textarea
              v-model.trim="note"
              maxlength="500"
              required
              placeholder="本次更新了哪些数据或服务"
            />
          </label>
          <p v-if="!canSubmit">保存对草稿的修改后可以提交审批。</p>
          <button class="primary" :disabled="busy || !canSubmit || !note">提交发布申请</button>
        </div>
      </form>
    </template>
    <template v-if="section === 'accounts' && session.role === 'admin'"
      ><div v-if="workspaceEdition" class="workspace-account-role"><PortalIcon name="accounts"/><div><strong>{{roleTitles[session.role]}}</strong><small>{{session.name}}</small></div></div><section class="platform-card gov-panel">
        <header><h2>权限矩阵</h2></header>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>角色</th>
                <th v-for="a in actions" :key="a">{{ capabilityTitles[a] }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in roles" :key="r">
                <td>{{ roleTitles[r] }}</td>
                <td v-for="a in actions" :key="a" :class="{ granted: allowed(r, a) }">
                  {{ allowed(r, a) ? '✓' : '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="platform-card gov-panel">
        <header>
          <h2>平台账号</h2>
          <button v-if="session.authenticated" @click="addUser = !addUser">新增账号</button>
        </header>
        <p v-if="!session.authenticated">当前使用本机开发模式。启用账号认证后，可在此创建账号并分配角色。</p>
        <form v-if="addUser" class="account-form" @submit.prevent="create">
          <label>用户名<input v-model.trim="username" required /></label
          ><label>所属部门<input v-model.trim="department" /></label
          ><label
            >角色<select v-model="role">
              <option v-for="r in roles" :value="r">{{ roleTitles[r] }}</option>
            </select></label
          ><label
            >初始密码<input
              type="password"
              minlength="12"
              autocomplete="new-password"
              v-model="password"
              required /></label
          ><button class="primary" :disabled="busy">创建账号</button>
        </form>
        <div v-if="users.length" class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>用户名</th>
                <th>所属部门</th>
                <th>角色</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.name">
                <td>{{ u.name }}</td>
                <td>{{ u.department || '—' }}</td>
                <td>
                  <select
                    :value="u.role"
                    :disabled="busy || !session.authenticated || u.name === session.name"
                    @change="edit(u, ($event.target as HTMLSelectElement).value as PlatformRole, u.enabled)"
                  >
                    <option v-for="r in roles" :value="r">{{ roleTitles[r] }}</option>
                  </select>
                </td>
                <td>
                  <button
                    :disabled="busy || !session.authenticated || u.name === session.name"
                    @click="edit(u, u.role, !u.enabled)"
                  >
                    {{ u.enabled ? '停用' : '启用' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section></template
    >
    <template v-if="section === 'api'"
      ><div class="gov-split">
        <section class="platform-card gov-panel">
          <header><h2>只读接口</h2></header>
          <button
            v-for="(ep, i) in endpoints"
            :key="ep.path"
            class="gov-item"
            :aria-pressed="i === selectedApi"
            @click="selectedApi = i; http = ''; body = ''"
          >
            <b>{{ ep.label }}</b
            ><span>GET</span>
          </button>
        </section>
        <section class="platform-card gov-panel">
          <header>
            <h2>{{workspaceEdition ? endpoints[selectedApi].label : '在线调试'}}</h2>
            <PortalIcon name="api" />
          </header>
          <div class="gov-fields">
            <p>{{ endpoints[selectedApi].desc }}</p>
            <div class="api-query" v-if="endpoints[selectedApi].path.endsWith('/catalog')">
              <label>关键词<input v-model.trim="apiQuery" maxlength="150" placeholder="资源名称或部门" /></label
              ><label>页码<input v-model.number="apiPage" type="number" min="1" /></label
              ><label>每页数量<input v-model.number="apiSize" type="number" min="1" max="100" /></label>
            </div>
            <code>GET {{ requestPath }}</code
            ><button class="primary" @click="request" :disabled="busy">
              {{ busy ? '请求中…' : '发送请求' }}
            </button>
            <div v-if="http">
              <b>{{ http }}</b>
              <pre>{{ body }}</pre>
            </div>
          </div>
        </section>
      </div></template
    >
  </div>
</template>
<style scoped>
.govern {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.gov-panel {
  min-width: 0;
  overflow: hidden;
}
.gov-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.gov-panel header > div,
.status-list,
.gov-panel footer,
.account-form {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}
.gov-panel footer,
.status-list,
.account-form {
  padding: 12px 18px;
}
.status-list {
  padding-top: 0;
  gap: 20px;
}
.status-list span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.status-list i {
  width: 8px;
  height: 8px;
  background: #7a8da0;
  border-radius: 50%;
}
.status-list i[data-status='online'] {
  background: #5ed7a2;
}
.status-list i:is([data-status='invalid'], [data-status='offline']) {
  background: #fc907f;
}
.status-list i[data-status='auth'] {
  background: #eec579;
}
.gov-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 13px;
}
.gov-metrics > div {
  border: 1px solid var(--edge);
  border-radius: 9px;
  padding: 15px 18px;
  background: linear-gradient(125deg, #1b333c, #172531);
}
.gov-metrics small,
.gov-item small,
.gov-fields small {
  color: var(--muted);
}
.gov-metrics strong {
  display: block;
  font-size: 28px;
  margin-top: 4px;
}
.gov-split {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr);
  gap: 16px;
  align-items: start;
}
.gov-fields {
  display: grid;
  gap: 14px;
  padding: 0 18px 18px;
}
.gov-fields > button {
  justify-self: start;
}
.gov-fields label,
.account-form label {
  display: grid;
  gap: 6px;
}
.gov-item {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 8px;
  text-align: left;
  width: calc(100% - 28px);
  margin: 0 14px 8px;
}
.gov-item span {
  color: var(--platform-accent);
  font-size: 13px;
}
.gov-item small {
  grid-column: 1/-1;
}
.gov-item[aria-pressed='true'] {
  background: #20404b;
  border-color: #3c878b;
}
.gov-fields pre,
.gov-fields code {
  overflow: auto;
  background: #0d1923;
  border: 1px solid var(--edge);
  border-radius: 5px;
  padding: 11px;
  color: #a2e8de;
}
.gov-fields pre {
  max-height: 52vh;
  font-size: 13px;
}
.granted {
  color: #60dcbd;
}
.account-form {
  align-items: end;
}
@media (max-width: 800px) {
  .gov-split {
    grid-template-columns: 1fr;
  }
  .gov-metrics {
    grid-template-columns: 1fr 1fr;
  }
}
.api-query {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 8px;
}
.api-query input {
  width: 100%;
}
</style>
