import { computed, ref, watch, type ComputedRef, type WatchSource } from 'vue'

export type ServicePagination = {
  readonly page: number
  readonly total: number
  readonly pageCount: number
  readonly pageSize: number
  go: (page: number) => void
  resize: (size: number) => void
}

export const servicePageSizes = [6, 10, 15, 30] as const

export function useServicePage<T>(source: ComputedRef<T[]>, resetOn: WatchSource[], initialSize: typeof servicePageSizes[number] = servicePageSizes[0]) {
  const current = ref(1)
  const size = ref<number>(initialSize)
  const pageCount = computed(() => Math.max(1, Math.ceil(source.value.length / size.value)))
  function go(page: number) {
    current.value = Math.min(pageCount.value, Math.max(1, page))
  }
  const rows = computed(() => source.value.slice((current.value - 1) * size.value, current.value * size.value))
  watch(pageCount, () => go(current.value), { flush: 'sync' })
  watch(resetOn, () => go(1), { flush: 'sync' })
  return {
    get rows() { return rows.value },
    get page() { return current.value },
    get total() { return source.value.length },
    get pageCount() { return pageCount.value },
    get pageSize() { return size.value },
    go,
    resize(next: number) {
      if (!servicePageSizes.some(value => value === next)) return
      const offset = (current.value - 1) * size.value
      size.value = next
      go(Math.floor(offset / next) + 1)
    },
    reveal(index: number) { if (index >= 0) go(Math.floor(index / size.value) + 1) },
  }
}
