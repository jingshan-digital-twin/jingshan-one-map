import { computed, shallowRef, triggerRef, watch, type ComputedRef, type WatchSource } from 'vue'

export function useTableSelection(keys:ComputedRef<string[]>, resetOn:WatchSource[]){
  const checked=shallowRef(new Set<string>())
  const selected=computed(()=>checked.value.size?keys.value.filter(id=>checked.value.has(id)):[])
  const all=computed(()=>!!keys.value.length && selected.value.length===keys.value.length)
  function clear(){checked.value=new Set()}
  function toggle(id:string){if(checked.value.has(id))checked.value.delete(id);else checked.value.add(id);triggerRef(checked)}
  function toggleAll(){checked.value=new Set(all.value?[]:keys.value)}
  watch(resetOn,clear,{flush:'sync'})
  return {checked,selected,all,clear,toggle,toggleAll}
}
