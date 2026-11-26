<script setup lang="ts">
import { computed } from 'vue'
import { servicePageSizes, type ServicePagination } from './service-pagination'

const props = defineProps<{ pagination: ServicePagination; label: string; unit?: string; compact?: boolean }>()
const compactStart = computed(() => Math.max(1, Math.min(props.pagination.page - 1, props.pagination.pageCount - 2)))
const pages = computed(() => {
  const { page, pageCount } = props.pagination
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  if (page <= 4) return [1, 2, 3, 4, 5, 'after', pageCount] as const
  if (page >= pageCount - 3) return [1, 'before', pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount] as const
  return [1, 'before', page - 1, page, page + 1, 'after', pageCount] as const
})
</script>

<template>
  <nav class="service-pager" :class="{ 'pager-compact': compact }" :aria-label="label">
    <span class="pager-total" aria-live="polite"><slot name="total"><span class="pager-prefix">共 </span>{{ pagination.total }} {{ unit ?? '条' }}<span class="pager-page-total">，共 {{ pagination.total ? pagination.pageCount : 0 }} 页</span></slot></span>
    <label v-if="pagination.total > servicePageSizes[0]" class="pager-field"><span class="pager-long">每页</span>
      <select class="pager-select" title="每页条数" :aria-label="label + '每页条数'" :value="pagination.pageSize"
        @change="pagination.resize(Number(($event.target as HTMLSelectElement).value))">
        <option v-for="size in servicePageSizes" :key="size" :value="size">{{ size }}</option>
      </select><span class="pager-long">条</span><span class="pager-short">条/页</span>
    </label>
    <div v-if="pagination.pageCount > 1" class="page-buttons">
      <button type="button" aria-label="上一页" :disabled="pagination.page === 1" @click="pagination.go(pagination.page - 1)">‹</button>
      <span class="pager-numbers"><template v-for="item in pages" :key="item">
        <button v-if="typeof item === 'number'" type="button" :aria-label="'第 ' + item + ' 页'"
          :class="{ 'near-current': item >= compactStart && item < compactStart + 3 }"
          :aria-current="item === pagination.page ? 'page' : undefined" @click="pagination.go(item)">{{ item }}</button>
        <span v-else class="pager-ellipsis" aria-hidden="true">…</span>
      </template></span>
      <label class="pager-field pager-compact-jump">
        <select class="pager-select" :title="'当前第 ' + pagination.page + ' 页，共 ' + pagination.pageCount + ' 页'" :aria-label="label + '前往页码'" :value="pagination.page"
          @change="pagination.go(Number(($event.target as HTMLSelectElement).value))">
          <option v-for="number in pagination.pageCount" :key="number" :value="number">{{ number }}/{{ pagination.pageCount }}</option>
        </select>
      </label>
      <button type="button" aria-label="下一页" :disabled="pagination.page === pagination.pageCount" @click="pagination.go(pagination.page + 1)">›</button>
    </div>
    <label v-if="pagination.pageCount > 1" class="pager-field pager-full-jump">前往
      <select class="pager-select" :aria-label="label + '前往页码'" :value="pagination.page"
        @change="pagination.go(Number(($event.target as HTMLSelectElement).value))">
        <option v-for="number in pagination.pageCount" :key="number" :value="number">{{ number }}</option>
      </select>页
    </label>
  </nav>
</template>

<style scoped>
.service-pager {
  width: 100%; min-width: 0; display: flex; flex-flow: row nowrap; gap: 4px;
  align-items: center; justify-content: safe flex-end;
  container: pager / inline-size; font: 400 16px/24px var(--v14-font); color: var(--v14-ink);
  white-space: nowrap; overflow-x: auto; overflow-y: hidden;
}
.service-pager > *, .page-buttons > * { flex: 0 0 auto; }
.pager-field, .page-buttons, .pager-numbers { display: inline-flex; align-items: center; gap: 4px; }
.service-pager :is(.pager-compact-jump,.pager-short) { display: none; }
.service-pager > :not(:first-child) { margin-inline-start: 8px; }
.page-buttons button, .service-pager label.pager-field select.pager-select {
  box-sizing: border-box; min-height: 26px; height: 26px; min-width: 26px; padding: 0 3px;
  border: 1px solid var(--v14-list-line); border-radius: 3px; background: var(--service-page-fill,var(--v14-list));
  color: inherit; font: inherit; cursor: pointer;
}
.service-pager label.pager-field select.pager-select { width: auto; padding-inline-start: 4px; font-variant-numeric: tabular-nums; }
.page-buttons [aria-current="page"] { border-color: var(--v14-metric); background: var(--v14-scroll-thumb); color: #102b57; font-weight: 700; }
.pager-ellipsis { min-width: 26px; text-align: center; line-height: 24px; border: 1px solid var(--v14-list-line); border-radius: 3px; }
.page-buttons button:disabled { opacity: .45; cursor: default; }
.service-pager :is(button,select):focus-visible { outline: 2px solid var(--v14-metric); outline-offset: -2px; }
@container pager (max-width: 690px) {
  .service-pager :is(.pager-numbers > :not(.near-current),.pager-full-jump,.pager-page-total) { display: none; }
  .service-pager .pager-compact-jump { display: inline-flex; }
  .service-pager > :not(:first-child) { margin-inline-start: 0; }
}
@container pager (min-width: 300px) and (max-width: 384px) {
  .service-pager .pager-numbers > :not([aria-current="page"]) { display: none; }
}
@container pager (max-width: 299px) {
  .service-pager .pager-numbers { display: none; }
}
@container pager (max-width: 415px) {
  .service-pager :is(.pager-page-total,.pager-long) { display: none; }
  .service-pager .pager-short { display: inline; }
  .service-pager > :not(:first-child) { margin-inline-start: 0; }
  .pager-total { margin-inline-end: auto; }
}
@container pager (max-width: 324px) {
  .service-pager .pager-short { display: none; }
}
@container pager (max-width: 249px) {
  .page-buttons > button { display: none; }
}
.service-pager.pager-compact :is(.pager-page-total,.pager-long,.pager-short,.pager-full-jump,.pager-numbers > :not([aria-current="page"])) { display:none; }
.service-pager.pager-compact .pager-compact-jump { display:inline-flex; }
.service-pager.pager-compact > :not(:first-child) { margin-inline-start:0; }
.service-pager.pager-compact .pager-total { margin-inline-end:auto; }
@container pager (min-width: 216px) and (max-width: 249px) {
  .pager-compact .pager-prefix { display:none; }
  .pager-compact .pager-select { field-sizing:content; }
  .pager-compact .page-buttons { gap:2px; }
  .pager-compact .page-buttons > button { display:inline-block; min-width:24px; padding:0; }
}
</style>
