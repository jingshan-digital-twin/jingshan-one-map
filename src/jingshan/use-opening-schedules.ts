import { computed, onMounted, onBeforeUnmount, ref, shallowRef, watch, type ComputedRef } from 'vue'
import { api } from './api'
import { applyOpeningSchedules,scheduleState,type OpeningSchedule } from './opening-schedule'
import type { PublishedData } from './types'

export function useOpeningSchedules(source:ComputedRef<PublishedData|undefined>) {
  const plans=shallowRef<OpeningSchedule[]>([])
  const minute=ref(Math.floor(Date.now()/60000))
  const warning=ref('')
  const mode=computed(()=>source.value?.data.mode)
  let seq=0,timer:ReturnType<typeof setInterval>|undefined
  async function refresh() {
    const request=++seq
    minute.value=Math.floor(Date.now()/60000)
    if(!mode.value)return
    try{
      const rows=await api<OpeningSchedule[]>('/venue-opening/schedules?mode='+mode.value)
      if(request!==seq)return
      rows.sort((a,b)=>a.taskId.localeCompare(b.taskId)||a.venueId.localeCompare(b.venueId))
      if(rows.length!==plans.value.length||rows.some((s,i)=>s.taskId!==plans.value[i].taskId||s.revision!==plans.value[i].revision||s.venueId!==plans.value[i].venueId))plans.value=rows
      warning.value=''
    }catch{if(request===seq)warning.value='排期同步失败，指标暂按上次取得的场地台账计算。'}
  }
  function shared(e:StorageEvent){if(e.key==='jingshan-opening-schedules')void refresh()}
  watch(mode,()=>{plans.value=[];void refresh()},{immediate:true})
  onMounted(()=>{
    window.addEventListener('focus',refresh)
    window.addEventListener('jingshan-opening-schedules',refresh)
    window.addEventListener('storage',shared)
    timer=setInterval(()=>{const now=Math.floor(Date.now()/60000);if(minute.value!==now)void refresh()},1000)
  })
  onBeforeUnmount(()=>{seq++;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('jingshan-opening-schedules',refresh);window.removeEventListener('storage',shared)})
  const active=computed<OpeningSchedule[]>((old)=>{
    const rows=plans.value.filter(s=>scheduleState(s,minute.value*60000)==='当前时段开放')
    return old&&old.length===rows.length&&rows.every((r,i)=>r===old[i])?old:rows
  })
  const datasets=computed(()=>applyOpeningSchedules(source.value?.data.datasets??[],active.value,Date.now()))
  return {datasets,warning,plans}
}

