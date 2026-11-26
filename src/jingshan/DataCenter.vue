<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch, type Component } from 'vue'
import PortalIcon from './PortalIcon.vue'
import PlatformShell from './PlatformShell.vue'
import { allowed, type PlatformSession } from './platform-roles'
const PlatformResourcePreview = defineAsyncComponent(() => import('./PlatformResourcePreview.vue'))
const PlatformSceneBindings = defineAsyncComponent(() => import('./PlatformSceneBindings.vue'))
const PlatformGovernance = defineAsyncComponent(() => import('./PlatformGovernance.vue'))
import PlatformOverview from './PlatformOverview.vue'
import { api, downloadFile, jsonRequest } from './api'
import { checkDocument } from './validate'
import { defaultRules } from './analytics'
import {
  platformLink,
  platformRoute,
  platformSections,
  platformTime,
  type ActivityRow,
  type PlatformSection,
} from './platform-navigation'
import type { CityFeature, DataDocument, Dataset, DataWorkspace, PublishedData } from './types'
import type { CimAdminService } from './cim-types'
import { catalogSearchKey, parseCatalogSearch, type CatalogDomain } from './catalog-domain'
import { planBulkRemoval, draftServices, missingSourceDatasets, planResourceRemoval, type ResourceTarget } from './resource-removal'
import { populationRecordCount } from './population-raster'
import { isPlatformFormDataset } from './platform-forms'
import { workspaceArtwork } from './workspace-artwork'
import { editorReferences, type EditorReferenceSetting } from './editor-reference-context'

const props = defineProps<{ workspaceShell?: Component; workspaceCatalog?: Component }>()
const workspaceEdition = !!props.workspaceShell

const PlatformLocalData = defineAsyncComponent(() => import('./PlatformLocalData.vue'))
const PlatformForms = defineAsyncComponent(() => import('./PlatformForms.vue'))
const PlatformMapServices = defineAsyncComponent(() => import('./PlatformMapServices.vue'))
const ResultsAdmin = defineAsyncComponent(() => import('./ResultsAdmin.vue'))
const PlatformOpening = defineAsyncComponent(() => import('./PlatformOpening.vue'))
const PlatformEvents = defineAsyncComponent(() => import('./PlatformEvents.vue'))
const PlatformEnterpriseEditor = defineAsyncComponent(() => import('./PlatformEnterpriseEditor.vue'))
const route = ref(platformRoute())
const session = ref<PlatformSession>()
const viewerMode = computed(() => session.value?.role === 'viewer')
const tab = computed(() =>
  availableSections.value.some((s) => s.id === route.value.tab) ? route.value.tab : 'overview',
)
const section = computed(() => platformSections.find((s) => s.id === tab.value)!)
const pageTitle = computed(() => section.value.label + (workspaceEdition ? ' · 京山时空大数据工作区' : ' · 时空大数据管理平台'))
const availableSections = computed(() =>
  platformSections.filter((s) => {
    if (s.id === 'events') return !!session.value && allowed(session.value.role,'edit')
    if (viewerMode.value) return s.id === 'overview' || s.id === 'preview'
    if (session.value?.role === 'reviewer')
      return ['overview', 'preview', 'bindings', 'reviews', 'activity', 'versions', 'api'].includes(s.id)
    return s.id !== 'accounts' || session.value?.role === 'admin'
  }),
)
const initialSearch = route.value.tab === 'overview' ? parseCatalogSearch(route.value.key) : parseCatalogSearch('')
const searchDomain = ref<CatalogDomain>(initialSearch.domain)
const globalTerms = ref(initialSearch.query)
function searchCatalog() {
  location.hash = platformLink('overview', catalogSearchKey(searchDomain.value, globalTerms.value))
  onHash()
}
const workspace = shallowRef<DataWorkspace>()
const draft = ref<DataDocument>()
const dirty = ref(false),
  savedChanges = ref(false),
  busy = ref(false),
  editing = ref(false)
const error = ref(''),
  notice = ref('')
const services = shallowRef<CimAdminService[]>([]),
  serviceError = ref('')
const activity = shallowRef<ActivityRow[]>([]),
  moreActivity = ref(false),
  activityError = ref(''),
  activityBusy = ref(false)
type VersionRow = { version: number; publishedAt: string }
const versions = ref<VersionRow[]>([]),
  versionError = ref(''),
  moreVersions = ref(false),
  versionsBusy = ref(false)
const confirmBox = ref<HTMLDialogElement>(),
  file = ref<HTMLInputElement>()
const enterprise = ref<{ dataset: Dataset; record?: CityFeature }>()
const importing = shallowRef<DataDocument>(),
  targetVersion = ref(0)
type Operation = 'publish' | 'restore' | 'demo' | 'import' | 'reload'
const operation = ref<Operation>('publish')
const labels: Record<Operation, string> = {
  publish: '发布到驾驶舱',
  restore: '载入历史版本',
  demo: '载入演示数据',
  import: '导入工作区备份',
  reload: '重新载入草稿',
}
const instructions = computed(
  () =>
    ({
      publish: '发布后，驾驶舱将使用当前草稿中的数据、分析参数和地图设置。',
      restore: 'V' + targetVersion.value + ' 将替换当前草稿，发布后驾驶舱才会更新。',
      demo: 'V3 演示数据将替换当前编辑区的内容，保存草稿后可以发布。',
      import:
        '这份备份含 ' +
        (importing.value?.datasets.length ?? 0) +
        ' 个数据集，将替换当前编辑区。保存并发布后驾驶舱才会更新。',
      reload: '当前编辑区中尚未保存的修改将被数据库里的草稿替换。',
    })[operation.value],
)
const ruleLabels: Record<string, string> = {
  walkM: '步行服务半径（米）',
  cycleM: '骑行服务半径（米）',
  driveM: '驾车服务半径（米）',
  courtAreaM2: '每片新建场地最低用地（㎡）',
  carShare: '自驾比例（0–1）',
  carOccupancy: '车均载客（人）',
  lodgingShare: '外地人员住宿比例（0–1）',
  medicalPointPeople: '每处医疗点服务人数',
  ambulancePeople: '每辆救护车服务人数',
  peoplePerCourt: '每片场地服务人口',
  hotelRadiusM: '住宿匹配半径（米）',
  parkingRadiusM: '停车匹配半径（米）',
}
const rules = computed(() => ({ ...defaultRules, ...draft.value?.rules }) as Record<string, number>)
const ruleGroups = computed(() => {
  if (!workspaceEdition) return [{ title: '分析参数', icon: '', keys: Object.keys(rules.value) }]
  const groups = [
    { title: '服务半径', icon: 'preview', keys: ['walkM', 'cycleM', 'driveM', 'hotelRadiusM', 'parkingRadiusM'] },
    { title: '场地与人口', icon: 'layers', keys: ['courtAreaM2', 'peoplePerCourt'] },
    { title: '交通与赛事保障', icon: 'opening', keys: ['carShare', 'carOccupancy', 'lodgingShare', 'medicalPointPeople', 'ambulancePeople'] },
  ]
  const extra = Object.keys(rules.value).filter(k => !groups.some(g => g.keys.includes(k)))
  if (extra.length) groups.push({ title: '其他参数', icon: 'settings', keys: extra })
  return groups
})
const draftSection = computed(() => ['local', 'forms', 'settings', 'bindings', 'versions'].includes(tab.value))
function message(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}
const removalDialog = ref<HTMLDialogElement>()
const removal = shallowRef<ResourceTarget>()
const removalError = ref('')
const typedRemovalName = ref('')
const confirmedDatasetIds = new Set<string>()
const undoRemoval = shallowRef<{data:DataDocument; dirty:boolean; confirmed:string[]; label:string}>()
const removalAction = computed(() => removal.value?.kind === 'service' ? '下线地图服务'
  : removalPlan.value?.source && isPlatformFormDataset(removalPlan.value.source) ? '删除整张表单' : '删除整份数据集')
const directoryServices = computed(() => draftServices(services.value,draft.value))
const editingReferences = ref<EditorReferenceSetting[]>([])
provide(editorReferences, {
  datasets: computed(() => draft.value?.datasets ?? []),
  services: directoryServices,
  selected: editingReferences,
})
const staleRemovals = computed(() => services.value.filter(s => draft.value?.serviceRemovals?.some(r=>r.id===s.id && r.revision!==s.revision)))
const removalPlan = computed(() => draft.value && removal.value ? planResourceRemoval(draft.value,removal.value) : undefined)
const removalName = computed(() => removal.value?.kind === 'service' ? removal.value.service.name : removalPlan.value?.source?.name)
const hostedRemovals = computed(() => services.value.filter(s => s.hostedDatasetId && removalPlan.value?.services.has(s.id)))
function askRemoval(target:ResourceTarget) {
  if (!draft.value || busy.value || !session.value || !allowed(session.value.role,target.kind==='service'?'services':'edit')) return
  if (target.kind === 'dataset') {
    const source=draft.value.datasets.find(row=>row.id===target.id)
    if (!source || source.derivedFrom) { error.value='请在空间源数据或表单设置中选择整份数据。'; return }
  }
  typedRemovalName.value=''
  removalError.value=''
  removal.value=target
  editing.value=true
  nextTick(()=>removalDialog.value?.showModal())
}
function closeRemoval() {
  removalDialog.value?.close()
  removal.value=undefined
  typedRemovalName.value=''
  editing.value=false
}
async function confirmRemoval() {
  const target=removal.value, plan=removalPlan.value
  if (!target || !plan || busy.value || (target.kind==='dataset' && typedRemovalName.value !== plan.source?.name)) return
  removalError.value=''
  busy.value=true
  try {
    checkDocument(plan.next)
    const label=removalAction.value+'「'+removalName.value+'」'
    closeRemoval()
    applyDraftRemoval(plan.next,label,target.kind==='dataset'?target.id:undefined)
  } catch (e) {
    removalError.value=message(e)
    if (target.kind==='service') void readServices()
  } finally { busy.value=false }
}

function applyDraftRemoval(next:DataDocument, label:string, datasetId?:string) {
  if (!draft.value) return
  const before={data:draft.value,dirty:dirty.value,confirmed:[...confirmedDatasetIds],label}
  replaceDraft(next)
  if (datasetId) confirmedDatasetIds.add(datasetId)
  undoRemoval.value=before
  notice.value=label+'已计入草稿，发布后生效。'
}
function undoLastRemoval() {
  const before=undoRemoval.value
  if (!before || busy.value || editing.value) return
  replaceDraft(before.data)
  confirmedDatasetIds.clear()
  before.confirmed.forEach(id=>confirmedDatasetIds.add(id))
  dirty.value=before.dirty
  notice.value='已撤销「'+before.label+'」。'
}
const batchTargets=shallowRef<ResourceTarget[]>([])
const batchDialog=ref<HTMLDialogElement>(),batchError=ref('')
const batchNames=computed(()=>batchTargets.value.map(t=>t.kind==='service'?t.service.name:draft.value?.datasets.find(d=>d.id===t.id)?.name??t.id))
const batchPlan=computed(()=>batchTargets.value.length&&draft.value?planBulkRemoval(draft.value,batchTargets.value):undefined)
function askBatch(targets:ResourceTarget[]){
  if(!targets.length || !draft.value || busy.value || !session.value || targets.some(t=>!allowed(session.value!.role,t.kind==='service'?'services':'edit')))return
  batchError.value='';batchTargets.value=targets;editing.value=true
  nextTick(()=>batchDialog.value?.showModal())
}
function closeBatch(){batchDialog.value?.close();batchTargets.value=[];editing.value=false}
function stageBatch(){
  const plan=batchPlan.value
  if(!plan)return
  try{
    checkDocument(plan.next)
    const text=batchTargets.value[0].kind==='service'?'批量下线服务':'批量删除数据资源'
    applyDraftRemoval(plan.next,text+'（'+batchNames.value.length+' 项）')
    plan.sources.forEach(id=>confirmedDatasetIds.add(id));closeBatch()
  }catch(e){batchError.value=message(e)}
}
const sourcePublishId=ref(''),sourcePublishDialog=ref<HTMLDialogElement>()
const publishDataset = computed(() => draft.value?.datasets.find(d => d.id === sourcePublishId.value))
const publishLayers = computed(() => draft.value?.datasets.filter(d => d.derivedFrom === sourcePublishId.value) ?? [])
function askSourcePublish(id:string){
  if(!draft.value?.datasets.some(d=>d.id===id)||!session.value||!allowed(session.value.role,'review'))return
  sourcePublishId.value=id;nextTick(()=>sourcePublishDialog.value?.showModal())
}
async function publishSource(){
  if(busy.value||!workspace.value||!sourcePublishId.value)return
  sourcePublishDialog.value?.close();busy.value=true;error.value=''
  try{
    const id=sourcePublishId.value
    if(dirty.value)await writeDraft()
    const result=await api<{workspace:DataWorkspace;serviceId:string}>('/admin/publish-layer',jsonRequest('POST',{datasetId:id,revision:workspace.value.revision}))
    accept(result.workspace);signal('publication');signal('catalog');await readServices();void readVersions()
    notice.value='当前数据集已发布为服务，版本 V'+result.workspace.version+'。'
  }catch(e){error.value=message(e)}finally{busy.value=false;sourcePublishId.value=''}
}
function applyCatalog(catalog: NonNullable<DataDocument['portalCatalog']>) {
  if (!draft.value) return
  draft.value.portalCatalog = catalog
  changed()
}
function changed() {
  undoRemoval.value=undefined
  dirty.value = true
  notice.value = ''
  error.value = ''
}
function updateRule(key: string, event: Event) {
  if (!draft.value) return
  draft.value.rules[key] = (event.target as HTMLInputElement).valueAsNumber
  changed()
}
function onServiceChange() {
  signal('catalog')
  void readServices()
  void readActivity()
}
function onResultChange() {
  signal('results')
  void readActivity()
}
function replaceDraft(value: DataDocument) {
  draft.value = value
  changed()
}
function accept(value: DataWorkspace) {
  undoRemoval.value=undefined
  confirmedDatasetIds.clear()
  workspace.value = value
  draft.value = value.draft
  dirty.value = false
  savedChanges.value = JSON.stringify(value.data) !== JSON.stringify(value.draft)
}
function signal(kind: 'catalog' | 'publication' | 'results') {
  try {
    localStorage.setItem(
      'jingshan-' + kind + '-changed',
      Array.from(crypto.getRandomValues(new Uint32Array(2))).join('-'),
    )
  } catch {
    /* local storage may be disabled */
  }
}
let versionRequest = 0
async function readVersions(more = false) {
  if (!session.value || viewerMode.value) return
  const seq = ++versionRequest
  const before = more ? versions.value.at(-1)?.version : undefined
  versionsBusy.value = true
  versionError.value = ''
  try {
    const result = await api<{ items: VersionRow[]; more: boolean }>(
      '/admin/versions?view=page' + (before ? '&before=' + before : ''),
    )
    if (seq === versionRequest) {
      versions.value = more ? [...versions.value, ...result.items] : result.items
      moreVersions.value = result.more
    }
  } catch (e) {
    if (seq === versionRequest) versionError.value = message(e)
  } finally {
    if (seq === versionRequest) versionsBusy.value = false
  }
}
let serviceRequest = 0,
  activityRequest = 0
async function readServices() {
  const seq = ++serviceRequest
  try {
    const result = await api<{ services: CimAdminService[] }>(
      viewerMode.value ? '/cim/services' : '/cim/admin/services',
    )
    if (seq === serviceRequest) {
      services.value = result.services
      serviceError.value = ''
    }
  } catch (e) {
    if (seq === serviceRequest) serviceError.value = message(e)
  }
}
async function readActivity(more = false) {
  if (!session.value || viewerMode.value) return
  const seq = ++activityRequest
  const before = more ? activity.value.at(-1)?.id : undefined
  activityBusy.value = true
  try {
    const result = await api<{ items: ActivityRow[]; more: boolean }>(
      '/admin/activity' + (before ? '?before=' + before : ''),
    )
    if (seq === activityRequest) {
      activity.value = more ? [...activity.value, ...result.items] : result.items
      moreActivity.value = result.more
      activityError.value = ''
    }
  } catch (e) {
    if (seq === activityRequest) activityError.value = message(e)
  } finally {
    if (seq === activityRequest) activityBusy.value = false
  }
}
async function readWorkspace() {
  if (busy.value) return
  error.value = ''
  notice.value = ''
  busy.value = true
  try {
    if (viewerMode.value) {
      const value = await api<PublishedData>('/data')
      accept({ ...value, draft: value.data, revision: value.version, updatedAt: value.publishedAt })
    } else accept(await api<DataWorkspace>('/admin'))
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
function onReviewedPublication() {
  void readServices()
  if (dirty.value || editing.value || enterprise.value) {
    notice.value = '新版本已发布。当前编辑内容仍在，请核对后重新载入草稿。'
  } else {
    void readWorkspace()
  }
  void readVersions()
  void readActivity()
  signal('publication')
}
function onHash() {
  const next = platformRoute()
  if (next.tab === route.value.tab && next.key === route.value.key) return
  if (removal.value && !busy.value) closeRemoval()
  if(batchTargets.value.length && !busy.value)closeBatch()
  route.value = next
  if (next.tab === 'overview') {
    const search = parseCatalogSearch(next.key)
    searchDomain.value = search.domain
    globalTerms.value = search.query
  } else {
    globalTerms.value = ''
  }
  editing.value = false
  error.value = ''
  notice.value = ''
}
function guard(e: BeforeUnloadEvent) {
  if (dirty.value || editing.value || enterprise.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}
function onShared(e: StorageEvent) {
  if (e.key === 'jingshan-catalog-changed') void readServices()
  if (e.key === 'jingshan-publication-changed') {
    void readServices()
    if (dirty.value || editing.value || enterprise.value) {
      notice.value = '已有新发布版本，请核对当前草稿后重新载入。'
    } else {
      void readWorkspace()
    }
    void readVersions()
  }
  if (e.key?.startsWith('jingshan-') && e.key.endsWith('-changed')) void readActivity()
}
watch(tab, (s) => {
  if (s !== 'local') editingReferences.value = []
  document.title = pageTitle.value
  if (s === 'overview' || s === 'activity') void readActivity()
  if (s === 'overview') void readServices()
  if (s === 'versions') void readVersions()
})
onMounted(() => {
  void api<PlatformSession>('/platform/session')
    .then((v) => {
      session.value = v
      void readWorkspace()
      void readServices()
      void readActivity()
      void readVersions()
    })
    .catch((e) => (error.value = message(e)))
  document.title = pageTitle.value
  window.addEventListener('hashchange', onHash)
  window.addEventListener('beforeunload', guard)
  window.addEventListener('storage', onShared)
})
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onHash)
  window.removeEventListener('beforeunload', guard)
  window.removeEventListener('storage', onShared)
})
function confirmOp(action: Operation, version = 0) {
  operation.value = action
  targetVersion.value = version
  confirmBox.value?.showModal()
}
function reload() {
  if (dirty.value) confirmOp('reload')
  else void readWorkspace()
}
async function writeDraft() {
  if (!draft.value || !workspace.value) throw new Error('请先载入草稿')
  checkDocument(draft.value)
  const before=undoRemoval.value
  accept(
    await api<DataWorkspace>(
      '/admin/draft',
      jsonRequest('PUT', { revision: workspace.value.revision, data: draft.value, removedDatasetIds:[...confirmedDatasetIds] }),
    ),
  )
  if (before) undoRemoval.value={...before,dirty:true}
}
async function save() {
  if (busy.value || !dirty.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await writeDraft()
    notice.value = '草稿已保存。'
    void readActivity()
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
async function execute() {
  confirmBox.value?.close()
  if (!workspace.value || busy.value) return
  if (operation.value === 'reload') {
    await readWorkspace()
    return
  }
  error.value = ''
  notice.value = ''
  busy.value = true
  try {
    if (operation.value === 'publish') {
      if (dirty.value) await writeDraft()
      accept(
        await api<DataWorkspace>('/admin/publish', jsonRequest('POST', { revision: workspace.value.revision })),
      )
      signal('publication')
      void readServices()
      notice.value = 'V' + workspace.value.version + ' 已发布到驾驶舱。'
      void readVersions()
    } else if (operation.value === 'restore') {
      accept(
        await api<DataWorkspace>(
          '/admin/restore',
          jsonRequest('POST', { revision: workspace.value.revision, version: targetVersion.value }),
        ),
      )
      notice.value = 'V' + targetVersion.value + ' 已载入草稿。'
    } else {
      const data = operation.value === 'demo' ? await api<DataDocument>('/admin/demo-v3') : importing.value
      checkDocument(data)
      confirmedDatasetIds.clear()
      missingSourceDatasets(workspace.value.draft,data).forEach(row=>confirmedDatasetIds.add(row.id))
      replaceDraft(data)
      notice.value = '已载入编辑区，请核对后保存草稿。'
    }
    void readActivity()
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
    importing.value = undefined
    if (operation.value === 'publish' && error.value) void readServices()
  }
}
async function importBackup(e: Event) {
  const input = e.target as HTMLInputElement,
    chosen = input.files?.[0]
  if (!chosen) return
  try {
    if (chosen.size > 18000000) throw new Error('备份文件须小于 18 MB')
    const data: unknown = JSON.parse((await chosen.text()).replace(/^\uFEFF/, ''))
    checkDocument(data)
    importing.value = data
    confirmOp('import')
  } catch (e) {
    error.value = message(e)
  } finally {
    input.value = ''
  }
}
function toggleImagery(on: boolean) {
  if (draft.value) {
    draft.value.imagery = on ? { url: '', credit: '', bounds: [112.6, 30.5, 113.7, 31.7] } : undefined
    changed()
  }
}
function onSync(value: DataWorkspace, id: string, info: string) {
  accept(value)
  const d = value.draft.datasets.find((row) => row.id === id)
  location.hash = platformLink(d && isPlatformFormDataset(d) ? 'forms' : 'local', id)
  void readActivity()
  setTimeout(() => {
    notice.value = info + '。请核对后发布。'
  }, 0)
}
function editEnterprise(id: string, record?: CityFeature) {
  const dataset = draft.value?.datasets.find((d) => d.id === id)
  if (dataset) enterprise.value = { dataset, record }
}
function applyEnterprise(record: CityFeature) {
  const target = enterprise.value?.dataset
  if (!target) return
  const i = target.features.findIndex((f) => f.id === record.id)
  if (i < 0) target.features.unshift(record)
  else target.features.splice(i, 1, record)
  enterprise.value = undefined
  changed()
}
</script>
<template>
  <component :is="props.workspaceShell || PlatformShell" :section="section" :sections="availableSections" :session="session" v-bind="workspaceEdition ? {version:workspace?.version} : {}" v-model:domain="searchDomain" v-model:terms="globalTerms" @search="searchCatalog">
      <div class="platform-page" :data-page="tab">
        <div class="platform-page-title">
          <div v-if="!workspaceEdition || tab !== 'overview'" :key="tab" class="page-heading"><div class="portal-crumb"><template v-if="!workspaceEdition"><span>京山网旅</span><PortalIcon name="chevron" :size="13"/></template>{{section.group}}</div><h1>{{section.label}}</h1></div>
          <a v-if="!workspaceEdition && tab === 'overview' && !viewerMode" class="portal-config-link" href="#bindings"
            ><PortalIcon name="bindings" :size="17" />配置一张图数据源</a
          >
          <div
            v-if="workspace && (draftSection || dirty || (['overview', 'preview','services'].includes(tab) && savedChanges))"
            class="platform-toolbar"
          >
            <span
              v-if="draftSection || dirty || savedChanges"
              class="draft-pill"
              :data-active="dirty || savedChanges"
              >{{ dirty ? '有未保存修改' : savedChanges ? '草稿待发布' : '已与发布版同步' }} · R{{
                workspace.revision
              }}</span
            >
            <template v-if="(draftSection || dirty || savedChanges) && session && allowed(session.role, 'edit')"
              ><button :disabled="busy || !dirty" @click="save">保存草稿</button
              ><button
                v-if="session && allowed(session.role, 'review')"
                class="primary"
                :disabled="busy || !(dirty || savedChanges)"
                @click="confirmOp('publish')"
              >
                发布到驾驶舱
              </button></template
            >
          </div>
        </div>
        <div v-if="error" class="message error platform-notice" role="alert">
          {{ error }} <button @click="reload" :disabled="busy">重新载入草稿</button>
        </div>
        <p v-if="notice || undoRemoval" role="status" class="message success platform-notice">{{ notice || undoRemoval?.label }}
          <button v-if="undoRemoval" type="button" :disabled="busy || editing" @click="undoLastRemoval">撤销本次操作</button>
        </p>
        <p v-if="staleRemovals.length && session && allowed(session.role,'services')" class="platform-notice" role="status">
          待下线的服务配置已更新。<button v-for="s in staleRemovals" :key="s.id" type="button" @click="askRemoval({kind:'service',service:s})">重新核对「{{ s.name }}」</button>
        </p>
        <div v-if="draft && workspace" :key="tab" class="platform-content" :inert="busy">
          <component :is="props.workspaceCatalog || PlatformOverview"
            v-if="tab === 'overview'"
            :draft="draft"
            :services="directoryServices"
            :service-error="serviceError"
            :activity="activity"
            :activity-error="activityError"
            :initial-query="route.key"
            :viewer-mode="viewerMode"
            :can-edit="!!session && allowed(session.role, 'edit')"
            @catalog="applyCatalog" @batch="askBatch" @domain="(domain: CatalogDomain,q: string)=>{searchDomain=domain;globalTerms=q;searchCatalog()}"
            :version="workspace.version"
            :published-at="workspace.publishedAt"
          />
          <PlatformSceneBindings
            v-else-if="tab === 'bindings'"
            :initial-scope="route.key"
            :read-only="!session || !allowed(session.role, 'edit')"
            :document="draft"
            :services="directoryServices"
            @update="replaceDraft"
          />
          <PlatformResourcePreview :published="workspace.data"
            v-else-if="tab === 'preview'"
            :read-only="!session || !allowed(session.role, 'edit')"
            :dirty="dirty"
            :draft="draft"
            :services="directoryServices"
            :initial-id="route.key"
            @update="replaceDraft"
          />
          <PlatformGovernance
            v-else-if="
              session && (tab === 'reviews' || tab === 'accounts' || tab === 'activity' || tab === 'api')
            "
            :key="tab"
            :section="tab"
            :session="session"
            :services="services"
            :revision="workspace.revision"
            :can-submit="savedChanges && !dirty"
            :activity="activity"
            :activity-error="activityError"
            :more-activity="moreActivity"
            :loading="activityBusy"
            @load-activity="readActivity"
            @published="onReviewedPublication"
          />
          <PlatformMapServices
            :registry="services" @batch="rows=>askBatch(rows.map(service=>({kind:'service',service})))" @remove="askRemoval({kind:'service',service:$event})"
            v-else-if="tab === 'services'"
            :draft="draft"
            :published="workspace.data"
            :revision="workspace.revision"
            :initial-id="route.key"
            :draft-changed="dirty"
            @synced="onSync"
            @reload-draft="reload"
            @changed="onServiceChange"
          />
          <PlatformLocalData
            :services="services"
            :can-publish="!!session && allowed(session.role,'review')" @publish-source="askSourcePublish" @batch="ids=>askBatch(ids.map(id=>({kind:'dataset',id})))"
            @record-removed="applyDraftRemoval"
            @remove="askRemoval({kind:'dataset',id:$event})"
            v-else-if="tab === 'local'"
            :draft="draft"
            :initial-id="route.key"
            @update="replaceDraft"
            @edit-enterprise="editEnterprise"
            @editing="editing = $event"
          />
          <PlatformForms @batch="ids=>askBatch(ids.map(id=>({kind:'dataset',id})))"
            @remove="askRemoval({kind:'dataset',id:$event})"
            v-else-if="tab === 'forms'"
            :draft="draft"
            :initial-id="route.key"
            :disabled="busy || !session || !allowed(session.role, 'edit')"
            @change="changed"
            @editing="editing = $event"
          />
          <ResultsAdmin v-else-if="tab === 'results'" @updated="onResultChange" />
          <PlatformEvents v-else-if="tab === 'events' && session && allowed(session.role,'edit')" :datasets="draft.datasets" :version="workspace.version" />
          <PlatformOpening
            v-else-if="tab === 'opening'"
            :published="workspace.data"
            @changed="readActivity()"
          />
          <template v-else-if="tab === 'settings'"
            ><div :class="workspaceEdition ? 'workspace-rule-groups' : 'legacy-rule-groups'">
            <section v-for="g in ruleGroups" :key="g.title" class="platform-card platform-settings">
              <header><h2><PortalIcon v-if="g.icon" :name="g.icon" :size="18" />{{ g.title }}</h2></header>
              <div class="rules-grid">
                <label v-for="k in g.keys" :key="k"
                  >{{ ruleLabels[k] || k
                  }}<input :value="rules[k]" type="number" min="0" step="any" @input="updateRule(k, $event)"
                /></label>
              </div>
            </section></div>
            <section class="platform-card platform-settings workspace-map-config">
              <header><h2>地图配置</h2></header>
              <div v-if="workspaceEdition" class="workspace-map-cover"><img src="/jingshan/ui/platform-city-model.webp" alt=""><b>京山驾驶舱</b><small>地图数据源</small></div>
              <label
                >驾驶舱数据模式<select v-model="draft.mode" @change="changed">
                  <option value="demo">演示数据</option>
                  <option value="live">业务数据</option>
                </select></label
              >
              <label class="checkbox"
                ><input
                  type="checkbox"
                  :checked="!!draft.imagery"
                  @change="toggleImagery(($event.target as HTMLInputElement).checked)"
                />使用自定义正射影像</label
              >
              <template v-if="draft.imagery"
                ><div class="rules-grid">
                  <label>HTTPS 影像地址<input v-model.trim="draft.imagery.url" @input="changed" /></label
                  ><label>影像署名<input v-model.trim="draft.imagery.credit" @input="changed" /></label>
                </div>
                <div class="rules-grid">
                  <label v-for="(label, i) in ['西经界', '南纬界', '东经界', '北纬界']" :key="label"
                    >{{ label
                    }}<input v-model.number="draft.imagery.bounds[i]" type="number" step="any" @input="changed"
                  /></label></div
              ></template></section
          ></template>
          <template v-else-if="tab === 'versions'"
            ><section class="platform-card backup-card">
              <img v-if="workspaceEdition" class="workspace-backup-cover" src="/jingshan/workspace/mountain.webp" alt="">
              <header><h2>草稿与备份</h2></header>
              <div v-if="workspaceEdition" class="workspace-draft-summary"><img src="/jingshan/workspace/mountain.webp" alt=""><span><b>当前草稿 R{{ workspace.revision }}</b><small>{{dirty ? '有未保存修改' : savedChanges ? '草稿待发布' : '已与发布版同步'}}</small></span></div>
              <p>备份包含本地数据、业务表单、分析参数和地图配置。</p>
              <div class="modal-actions">
                <button
                  @click="
                    downloadFile(
                      '京山网旅-草稿-R' + workspace.revision + '.json',
                      JSON.stringify(draft, null, 2),
                    )
                  "
                >
                  导出草稿 JSON</button
                ><button v-if="session && allowed(session.role, 'edit')" @click="file?.click()">导入备份</button
                ><button @click="reload">重新载入草稿</button
                ><button v-if="session && allowed(session.role, 'edit')" @click="confirmOp('demo')">
                  载入 V3 演示数据
                </button>
              </div>
            </section>
            <section class="platform-card workspace-version-history">
              <header>
                <h2>发布历史</h2>
                <button :disabled="versionsBusy" @click="readVersions()">刷新</button>
              </header>
              <p v-if="versionError" role="alert">{{ versionError }}</p>
              <ol v-if="workspaceEdition" class="workspace-version-list" aria-label="发布历史">
                <li v-for="v in versions" :key="v.version">
                  <span><b>V{{v.version}}{{v.version === workspace.version ? ' · 当前发布版' : ''}}</b><time :datetime="v.publishedAt">{{platformTime(v.publishedAt)}}</time></span>
                  <button v-if="session && allowed(session.role,'edit')" @click="confirmOp('restore',v.version)">载入到草稿</button>
                </li>
              </ol>
              <div v-else class="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>版本号</th>
                      <th>发布时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="v in versions" :key="v.version">
                      <td>
                        <b>V{{ v.version }}</b> {{ v.version === workspace.version ? ' · 当前发布版' : '' }}
                      </td>
                      <td>{{ platformTime(v.publishedAt) }}</td>
                      <td>
                        <button
                          v-if="session && allowed(session.role, 'edit')"
                          @click="confirmOp('restore', v.version)"
                        >
                          载入到草稿
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <footer v-if="moreVersions" class="catalog-pager">
                <button :disabled="versionsBusy" @click="readVersions(true)">加载更早版本</button>
              </footer>
            </section></template
          >
        </div>
        <p v-else-if="!error" role="status">正在读取数据工作区…</p>
      </div>
    <template #dialogs>
    <input hidden type="file" accept=".json,application/json" ref="file" @change="importBackup" />
    <PlatformEnterpriseEditor
      v-if="enterprise"
      :dataset="enterprise.dataset"
      :record="enterprise.record"
      @apply="applyEnterprise"
      @close="enterprise = undefined"
    />
    <dialog ref="removalDialog" class="platform-dialog platform-confirm" aria-labelledby="remove-resource-title"
      @cancel.prevent="!busy && closeRemoval()">
      <template v-if="removal && removalPlan">
        <h2 id="remove-resource-title">{{ removalAction }}</h2><p><strong>{{ removalName }}</strong></p>
        <p v-if="removalPlan.source">将删除整项{{ isPlatformFormDataset(removalPlan.source) ? '表单' : '空间数据集' }}及其中的 {{ populationRecordCount(removalPlan.source) }} 条记录。</p>
        <p v-else>将从服务目录下线这个接口。源数据及其记录会保留。</p>
        <p v-if="removalPlan.children.length">随源数据移除的图层有{{ removalPlan.children.map(d=>d.name).join('、') }}。</p>
        <p v-if="removal.kind==='dataset' && hostedRemovals.length">关联的 {{ hostedRemovals.length }} 个托管服务将同时下线。</p>
        <p v-if="removalPlan.bindings.length || removalPlan.folders.length">同步清理 {{ removalPlan.bindings.length }} 项地图绑定、{{ removalPlan.folders.length }} 个专题目录中的引用。</p>
        <p>本次操作将计入草稿，发布工作区后生效。</p>
        <label v-if="removal.kind==='dataset'" class="whole-resource-confirm">输入完整名称「{{ removalName }}」以确认
          <input v-model="typedRemovalName" autocomplete="off" spellcheck="false">
        </label>
        <p v-if="removalError" class="message error" role="alert">{{ removalError }}</p>
        <div class="modal-actions"><button type="button" autofocus :disabled="busy" @click="closeRemoval">取消</button>
          <button type="button" class="resource-delete" :disabled="busy || (removal.kind==='dataset' && typedRemovalName!==removalName)" @click="confirmRemoval">{{ removalAction }}</button></div>
      </template>
    </dialog>
    <dialog ref="sourcePublishDialog" class="platform-dialog platform-confirm" :class="{'workspace-publication':workspaceEdition}" aria-label="发布当前空间数据">
          <div v-if="workspaceEdition && publishDataset && workspace" class="workspace-publication-body">
        <small>空间数据管理　/　{{publishDataset.name}}</small><h2>确认发布服务</h2>
        <div class="workspace-publish-steps">
          <div><img :src="workspaceArtwork(publishDataset.name)" alt=""><span><small>空间源数据</small><b>{{publishDataset.name}}</b></span></div><PortalIcon name="arrow"/>
          <div><img src="/jingshan/workspace/mountain.webp" alt=""><span><small>发布地图服务</small><b>GeoJSON 接口</b></span></div><PortalIcon name="arrow"/>
          <div><img src="/jingshan/workspace/stadium.webp" alt=""><span><small>图层绑定</small><b>一张图目录</b></span></div>
        </div>
        <div class="workspace-publish-panels">
          <section><h3>发布范围</h3><dl><dt>发布对象</dt><dd>{{publishDataset.name}}</dd><dt>所属部门</dt><dd>{{publishDataset.department || '—'}}</dd><dt>发布后</dt><dd>可在图层绑定中选用该地图服务</dd></dl></section>
          <section><h3>关联展示图层</h3><ul v-if="publishLayers.length"><li v-for="layer in publishLayers" :key="layer.id">{{layer.name}}</li></ul><p v-else>当前数据集没有派生图层</p><h3>工作区</h3><dl><dt>当前发布版</dt><dd>V{{workspace.version}}</dd><dt>草稿修订</dt><dd>R{{workspace.revision}}</dd></dl></section>
        </div>
      </div>
      <template v-else><h2>发布当前数据集</h2><p>{{publishDataset?.name}} 将更新为可绑定的地图服务。其他数据集和一张图配置的草稿可继续编辑。</p></template>
      <footer><button @click="sourcePublishDialog?.close()">取消</button><button class="primary" @click="publishSource">确认发布服务</button></footer>
    </dialog>
    <dialog ref="batchDialog" class="platform-dialog platform-confirm" aria-label="确认批量操作" @cancel.prevent="closeBatch">
      <template v-if="batchPlan"><h2>{{batchTargets[0]?.kind==='service'?'批量下线服务':'批量删除数据资源'}}</h2>
        <p>共 {{batchNames.length}} 项，涉及 {{batchPlan.bindings}} 项图层绑定。保存并发布工作区后生效。</p>
        <ul style="max-height:14rem;overflow:auto"><li v-for="(n,i) in batchNames" :key="i">{{n}}</li></ul>
        <p v-if="batchError" role="alert">{{batchError}}</p><footer><button @click="closeBatch">取消</button><button class="primary" @click="stageBatch">确认加入草稿</button></footer></template>
    </dialog>
    <dialog ref="confirmBox" class="platform-dialog platform-confirm">
      <h2>{{ labels[operation] }}</h2>
      <p>{{ instructions }}</p>
      <div class="modal-actions">
        <button autofocus @click="confirmBox?.close()">取消</button
        ><button class="primary" @click="execute">{{ labels[operation] }}</button>
      </div>
    </dialog>
    </template>
  </component>
</template>
