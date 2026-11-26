<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, toRaw } from 'vue'
import { attributeFields, downloadAttributeTable } from './platform-attribute-table'
import { planSpatialAttributeUpdate, spatialMatchColumns } from './spatial-attribute-update'
import { isAttributeIdHeader, readSpatialAttributeWorkbook, type SpatialAttributeSheet } from './spatial-attribute-workbook'
import { isPopulationRaster } from './population-raster'
import { populationAttributeColumns } from './population-attribute-fields'
import type { CityFeature, Dataset } from './types'

const props = defineProps<{
  dataset: Dataset
  rows?: CityFeature[]
  query?: string
  rasterIds?: string[]
  filtered?: boolean
  templateScope?: 'selected' | 'filtered' | 'all'
}>()
const emit = defineEmits<{ apply: [dataset: Dataset]; close: [] }>()
const sheets = shallowRef<SpatialAttributeSheet[]>([])
const sheetName = ref('')
const fileName = ref('')
const matchColumn = ref('')
const clearBlank = ref(false)
const reading = ref(false)
const exporting = ref(false)
const readError = ref('')
const downloadError = ref('')
let request = 0
onBeforeUnmount(() => { request++ })

const sheet = computed(() => sheets.value.find(item => item.name === sheetName.value))
const hasId = computed(() => sheet.value?.headers.some(isAttributeIdHeader) ?? false)
const matchChoices = computed(() => sheet.value && !sheet.value.error && !hasId.value
  ? spatialMatchColumns(toRaw(props.dataset), sheet.value.headers) : [])
const raster = computed(() => isPopulationRaster(props.dataset))
const scopeText = computed(() => {
  const scope = props.templateScope ?? (props.filtered ? 'filtered' : 'all')
  return scope === 'selected' ? '已勾选记录' : scope === 'filtered' ? '筛选结果' : '全部记录'
})
const preview = computed(() => {
  if (!sheet.value) return {}
  if (sheet.value.error) return { error: sheet.value.error }
  if (!hasId.value && !matchColumn.value) {
    if (raster.value) return { error: '人口网格需要用「实体业务ID」匹配。请下载当前图层的模板，保留编号后再导入。' }
    if (!matchChoices.value.length) return { error: '表中找不到可匹配的字段。请保留模板的「实体业务ID」，或使用当前图层已有的唯一字段作为表头。' }
    return {}
  }
  try {
    const plan = planSpatialAttributeUpdate(toRaw(props.dataset), sheet.value, {
      clearBlank: clearBlank.value,
      matchColumn: matchColumn.value || undefined,
    })
    return { plan }
  } catch (error) {
    return { error: error instanceof Error ? error.message : '无法校验工作表，请核对表头和数据。' }
  }
})

async function readFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const ticket = ++request
  input.value = ''
  fileName.value = file.name
  sheets.value = []
  sheetName.value = ''
  matchColumn.value = ''
  clearBlank.value = false
  readError.value = ''
  reading.value = false
  if (!/\.xlsx$/i.test(file.name)) {
    readError.value = '请选择 .xlsx 工作簿。'
    return
  }
  reading.value = true
  try {
    const fields = raster.value ? populationAttributeColumns : attributeFields(toRaw(props.dataset))
    const headers = fields.map(field => field.label)
    const result = await readSpatialAttributeWorkbook(file, headers)
    if (ticket !== request) return
    if (!result.length) throw new Error('工作簿中没有可用的属性表。')
    sheets.value = result
    sheetName.value = (result.find(item => !item.error) ?? result[0]).name
  } catch (error) {
    if (ticket === request) readError.value = error instanceof Error ? error.message : '读取 Excel 失败。'
  } finally {
    if (ticket === request) reading.value = false
  }
}
async function downloadTemplate() {
  if (exporting.value) return
  exporting.value = true
  downloadError.value = ''
  try {
    await downloadAttributeTable(props.dataset, props.rows, props.query, props.filtered, props.rasterIds)
  } catch (error) {
    downloadError.value = error instanceof Error ? error.message : '属性模板下载失败。'
  } finally {
    exporting.value = false
  }
}
function chooseSheet(event: Event) {
  matchColumn.value = ''
  clearBlank.value = false
  sheetName.value = (event.target as HTMLSelectElement).value
}
function showValue(value: unknown) {
  if (value == null || value === '') return '（空）'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}
function apply() {
  const plan = preview.value.plan
  if (plan?.updated && !reading.value) emit('apply', plan.dataset)
}
</script>

<template>
  <form class="local-form attribute-import" @submit.prevent="apply">
    <div class="attribute-target">
      <div><span>目标图层</span><strong>{{ dataset.name }}</strong></div>
      <button type="button" :disabled="exporting" @click="downloadTemplate">
        {{ exporting ? '正在生成模板…' : '下载模板（' + scopeText + '）' }}
      </button>
    </div>
    <p v-if="downloadError" class="local-error" role="alert">{{ downloadError }}</p>
    <div class="attribute-file">
      <label>属性工作簿
        <span class="attribute-picker">
          <span class="attribute-picker-action">{{ fileName ? '重新选择' : '选择文件' }}</span>
          <span class="attribute-filename">{{ fileName || '.xlsx 工作簿' }}</span>
          <input type="file" aria-label="选择属性 Excel 文件" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="readFile">
        </span>
      </label>
      <p v-if="!fileName" class="attribute-hint">{{ raster
        ? '用「实体业务ID」匹配网格，在「格内人口（人）」列填写新值。空白单元格会保留原值。'
        : '可修改模板，也可上传自己的表格。保留「实体业务ID」，或选择图层中值唯一的字段匹配记录。空白单元格默认保留原值。' }}</p>
    </div>
    <p v-if="reading" class="attribute-hint" role="status">正在读取工作簿…</p>
    <label v-if="sheets.length > 1">工作表
      <select aria-label="工作表" :value="sheetName" @change="chooseSheet">
        <option v-for="item in sheets" :key="item.name" :value="item.name">{{ item.name }}</option>
      </select>
    </label>
    <label v-if="sheet && !hasId && matchChoices.length">用于匹配记录的唯一字段
      <select v-model="matchColumn" aria-label="用于匹配记录的唯一字段">
        <option value="" disabled>请选择匹配字段</option>
        <option v-for="choice in matchChoices" :key="choice" :value="choice">{{ choice }}</option>
      </select>
    </label>
    <label v-if="sheet && !sheet.error && !raster" class="attribute-blank">空白单元格
      <select v-model="clearBlank" aria-label="空白单元格处理">
        <option :value="false">保留原值（默认）</option>
        <option :value="true">清除原值</option>
      </select>
    </label>
    <p v-if="readError || preview.error" class="local-error attribute-error" role="alert">{{ readError || preview.error }}</p>
    <section v-if="preview.plan" class="attribute-preview" aria-label="替换预览">
      <div class="attribute-counts" role="status">
        <span>匹配 <b>{{ preview.plan.matched }}</b> 条</span>
        <span>将更新 <b>{{ preview.plan.updated }}</b> 条</span>
        <span>无变化 <b>{{ preview.plan.unchanged }}</b> 条</span>
      </div>
      <template v-if="preview.plan.changeCount">
        <p class="attribute-hint">共 {{ preview.plan.changeCount }} 处属性变更<span v-if="preview.plan.samples.length < preview.plan.changeCount">，预览前 {{ preview.plan.samples.length }} 处</span>。</p>
        <div class="attribute-table" tabindex="0" role="region" aria-label="属性变更明细">
          <table>
            <thead><tr><th scope="col" title="Excel 工作表行号">行号</th><th scope="col">实体业务ID</th><th scope="col">属性</th><th scope="col">原值</th><th scope="col">新值</th></tr></thead>
            <tbody>
              <tr v-for="change in preview.plan.samples" :key="change.row + '/' + change.field">
                <td data-label="行号">{{ change.row }}</td><td data-label="实体业务ID">{{ change.id }}</td><td data-label="属性">{{ change.field }}</td>
                <td data-label="原值">{{ showValue(change.before) }}</td><td data-label="新值">{{ showValue(change.after) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <p v-else class="attribute-hint">当前工作表没有需要替换的属性。</p>
      <details v-if="preview.plan.ignored.length"><summary>已跳过的列（{{ preview.plan.ignored.length }}）</summary><p class="attribute-hint">{{ preview.plan.ignored.join('、') }}</p></details>
    </section>
    <footer>
      <span class="attribute-hint">应用后可在草稿中核对，再保存、发布。</span>
      <button type="button" @click="emit('close')">取消</button>
      <button type="submit" class="local-primary" :disabled="reading || !preview.plan?.updated">应用到草稿</button>
    </footer>
  </form>
</template>

<style scoped>
.attribute-import { min-width: 0; }
.attribute-import p { margin: 0; }
.attribute-target, .attribute-counts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.attribute-target { justify-content: space-between; border-bottom: 1px solid var(--platform-line); padding-bottom: 14px; }
.attribute-target > div, .attribute-file, .attribute-preview { display: grid; gap: 7px; min-width: 0; }
.attribute-target strong, .attribute-filename { overflow-wrap: anywhere; }
.attribute-target span, .attribute-hint { font-size: 13px; line-height: 1.55; color: var(--platform-muted); }
.attribute-picker { display: flex; gap: 10px; align-items: center; position: relative; min-height: 38px; padding: 5px 8px; border: 1px solid var(--platform-line); border-radius: 7px; background: var(--platform-paper); }
.attribute-picker:focus-within { outline: 2px solid var(--platform-accent); outline-offset: 2px; }
.attribute-picker-action { flex: none; padding: 3px 9px; border-radius: 4px; background: var(--platform-soft); color: var(--platform-accent); font-weight: 600; }
.attribute-picker input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.attribute-filename { color: var(--platform-muted); font-size: 13px; }
.attribute-import .attribute-blank { display: flex; align-items: center; gap: 8px; }
.attribute-import .attribute-blank select { width: auto; }
.attribute-error { white-space: pre-line; overflow-wrap: anywhere; }
.attribute-counts { border-radius: 8px; background: var(--platform-soft); padding: 9px 12px; font-size: 13px; }
.attribute-counts b { color: var(--platform-accent); font-variant-numeric: tabular-nums; }
.attribute-table { max-height: min(38vh, 360px); overflow: auto; border: 1px solid var(--platform-line); border-radius: 7px; }
.attribute-table table { width: 100%; min-width: 410px; border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: 13px; line-height: 1.5; }
.attribute-table th, .attribute-table td { padding: 7px 8px; text-align: left; white-space: pre-wrap; overflow-wrap: anywhere; vertical-align: top; }
.attribute-table th { position: sticky; top: 0; background: var(--platform-soft); color: var(--platform-ink); }
.attribute-table th:first-child { width: 46px; }
.attribute-table td { border-top: 1px solid var(--platform-line); }
.attribute-table td:last-child { color: var(--platform-accent); }
.attribute-import footer { align-items: center; }
.attribute-import footer span { flex: 1 1 200px; }
@media (max-width: 600px) {
  .attribute-import footer span { flex-basis: 100%; }
  .attribute-table table, .attribute-table tbody { display: block; min-width: 0; }
  .attribute-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .attribute-table tr { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; padding: 9px; }
  .attribute-table tr + tr { border-top: 1px solid var(--platform-line); }
  .attribute-table td { display: flex; gap: 6px; min-width: 0; padding: 0; border: none; }
  .attribute-table td::before { content: attr(data-label); flex: none; color: var(--platform-muted); }
  .attribute-table td:nth-child(3) { grid-area: 1 / 2; }
  .attribute-table td:nth-child(2), .attribute-table td:nth-child(n+4) { grid-column: span 2; }
}
</style>
