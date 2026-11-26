<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import type { Geometry } from 'geojson'
import { chain, enterpriseDirectoryId } from './chain-taxonomy'
import { browserUuid } from './browser-uuid'
import { checkDataset, checkFeature } from './validate'
import type { CityFeature, Dataset } from './types'

const props = defineProps<{ dataset: Dataset; record?: CityFeature }>()
const SpatialGeometryEditor = defineAsyncComponent(() => import('./SpatialGeometryEditor.vue'))
const emit = defineEmits<{ apply: [record: CityFeature]; close: [] }>()
const dialog = ref<HTMLDialogElement>()
const prior = props.record
const initial: Record<string, unknown> = prior?.properties ?? {}
const {
  name = '',
  region = '京山市',
  kind = 'business',
  chainTopics = [],
  mainBusiness = '',
  registeredCapital = '',
  businessScope,
  businessScopeExcerpt,
  sources = [],
  ...extra
} = initial
const fields = ref({
  name: String(name),
  region: String(region),
  topics: Array.isArray(chainTopics) ? ([...chainTopics] as string[]) : [],
  business: String(mainBusiness),
  capital: registeredCapital as string | number,
  scope: String(businessScope ?? ''),
  excerpt: String(businessScopeExcerpt ?? ''),
})
type Source = { title: string; url: string; evidence: string; date?: string }
const emptySource = (): Source => ({ title: '', url: '', evidence: '' })
const evidence = ref<Source[]>(
  Array.isArray(sources) && sources.length ? JSON.parse(JSON.stringify(sources)) : [emptySource()],
)
const attributes = ref(JSON.stringify(prior ? extra : { sourceServiceId: enterpriseDirectoryId }, null, 2))
const geometry = ref(
  prior && prior.geometry.type !== 'GeometryCollection' ? JSON.stringify(prior.geometry, null, 2) : '',
)
const error = ref('')
const spatialOpen = ref(false)
const mapGeometry = computed<Geometry | undefined>(() => {
  try {
    const value = JSON.parse(geometry.value)
    if (value && Array.isArray(value.coordinates) && ['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon'].includes(value.type)) return value
  } catch { /* Partial JSON stays in the text editor while typing. */ }
  return undefined
})
function apply() {
  try {
    const f = fields.value
    if (!f.topics.length || !evidence.value.length) throw new Error('请选择产业链环节并填写至少一条公开依据')
    const extraFields = JSON.parse(attributes.value)
    if (!extraFields || typeof extraFields !== 'object' || Array.isArray(extraFields))
      throw new Error('扩展属性需要是 JSON 对象')
    if (f.topics[0] !== (Array.isArray(chainTopics) ? chainTopics[0] : undefined)) {
      extraFields.subtype = f.topics[0]
      extraFields.segment = chain.find((stage) => stage.topics.some((topic) => topic === f.topics[0]))?.id
    }
    const record: unknown = {
      type: 'Feature',
      id: prior?.id ?? 'businesses-' + browserUuid(),
      properties: {
        ...extraFields,
        name: f.name,
        region: f.region,
        kind,
        chainTopics: f.topics,
        mainBusiness: f.business,
        ...(f.capital !== '' ? { registeredCapital: f.capital } : {}),
        ...(f.scope ? { businessScope: f.scope } : {}),
        ...(f.excerpt ? { businessScopeExcerpt: f.excerpt } : {}),
        sources: evidence.value.map(({ date, ...item }) => (date ? { ...item, date } : item)),
      },
      geometry: geometry.value.trim()
        ? JSON.parse(geometry.value)
        : { type: 'GeometryCollection', geometries: [] },
    }
    checkFeature(record, '企业记录', props.dataset.id)
    const others = props.dataset.features.filter((item) => item.id !== record.id)
    checkDataset({ ...props.dataset, features: [...others, record] })
    emit('apply', record)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
onMounted(() => dialog.value?.showModal())
</script>
<template>
  <dialog ref="dialog" class="platform-dialog" @cancel.prevent="emit('close')">
    <form @submit.prevent="apply">
      <header class="platform-dialog-head">
        <h2>{{ prior ? '编辑产业链企业' : '新增产业链企业' }}</h2>
        <button type="button" @click="emit('close')" aria-label="关闭">×</button>
      </header>
      <p v-if="error" role="alert" class="message error">{{ error }}</p>
      <div class="form-grid">
        <label>企业名称<input v-model.trim="fields.name" required /></label
        ><label>行政区<input v-model.trim="fields.region" required /></label>
      </div>
      <fieldset>
        <legend>产业链环节</legend>
        <div v-for="stage in chain" :key="stage.id" class="enterprise-stage">
          <b>{{ stage.id }}</b
          ><label v-for="topic in stage.topics" :key="topic"
            ><input v-model="fields.topics" type="checkbox" :value="topic" />{{ topic }}</label
          >
        </div>
      </fieldset>
      <label>主营业务<textarea v-model.trim="fields.business" rows="2"></textarea></label>
      <label>注册资本<input v-model.trim="fields.capital" placeholder="金额及币种" /></label>
      <label>经营范围<textarea v-model.trim="fields.scope" rows="2"></textarea></label>
      <label v-if="businessScopeExcerpt !== undefined"
        >经营范围摘录<textarea v-model.trim="fields.excerpt" rows="2"></textarea>
      </label>
      <fieldset>
        <legend>公开依据</legend>
        <section v-for="(source, i) in evidence" :key="i" class="platform-evidence">
          <div class="form-grid">
            <label>来源标题<input v-model.trim="source.title" required maxlength="300" /></label
            ><label>发布日期<input type="date" v-model="source.date" /></label>
          </div>
          <label>网页地址<input type="url" v-model.trim="source.url" required maxlength="2000" /></label
          ><label
            >核验说明<textarea v-model.trim="source.evidence" required maxlength="2000" rows="2"></textarea>
          </label>
          <button type="button" @click="evidence.splice(i, 1)">移除这条依据</button>
        </section>
        <button type="button" @click="evidence.push(emptySource())">添加依据</button>
      </fieldset>
      <details @toggle="spatialOpen = ($event.currentTarget as HTMLDetailsElement).open">
        <summary>空间位置与扩展属性</summary>
        <SpatialGeometryEditor v-if="spatialOpen" :dataset-id="dataset.id" :type="mapGeometry?.type ?? 'Point'" :geometry="mapGeometry"
          @change="geometry = JSON.stringify($event, null, 2)" />
        <label>几何 GeoJSON（坐标待核实时留空）<textarea v-model="geometry" rows="3"></textarea></label
        ><label>扩展属性 JSON<textarea v-model="attributes" rows="4"></textarea></label>
      </details>
      <footer class="modal-actions">
        <button type="button" @click="emit('close')">取消</button
        ><button type="submit" class="primary">应用到草稿</button>
      </footer>
    </form>
  </dialog>
</template>
