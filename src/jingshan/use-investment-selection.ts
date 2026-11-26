import { computed, reactive, ref, shallowRef, watch, type ComputedRef } from 'vue'
import { availableParcelStyle, eligibleReserve, matchesReserve, reserveLayerId, type UrbanRelation } from './investment-planning.ts'
import { rankAvailableParcels, recommendedParcels } from './investment-selection.ts'
import { useServicePage } from './service-pagination.ts'
import type { CityFeature } from './types.ts'
import type { Demand } from './investment-demand.ts'

export function useInvestmentSelection(lead:ComputedRef<Demand|undefined>,version:()=>number|undefined,
  scope:()=>string,inScope:(f:CityFeature)=>boolean,
  nearby?:ComputedRef<CityFeature[]|undefined>){
  const index=shallowRef<CityFeature[]>([]), loadedVersion=ref<number>(), state=ref(''), retry=ref(0)
  const filters=reactive({town:'',landUse:'',urban:'' as UrbanRelation|'',search:'',area:''})
  const sets=ref<Record<string,string[]>>({}), focused=ref(''), revision=ref(0)
  const key=computed(()=>JSON.stringify([version(),scope(),lead.value?.id]))
  const checkedIds=computed(()=>sets.value[key.value]??[])
  watch([()=>Boolean(lead.value) && nearby?.value===undefined,version,retry],async([active,v],_,onCleanup)=>{
    if(v!==loadedVersion.value){index.value=[];loadedVersion.value=undefined}
    if(!active || !v || loadedVersion.value===v){state.value='';return}
    const controller=new AbortController()
    onCleanup(()=>controller.abort())
    state.value='正在加载可用地块…'
    try{
      const response=await fetch('/api/jingshan/layers/'+reserveLayerId+'/features.geojson',{signal:controller.signal})
      if(!response.ok)throw Error('可用地块图层加载失败。')
      if(response.headers.get('X-Publication-Version')!==String(v))throw Error('地块已更新，请刷新页面。')
      const data=await response.json() as {features:CityFeature[]}
      if(!controller.signal.aborted){
        index.value=data.features.filter(eligibleReserve).map(f=>({...f,properties:{...f.properties,kind:'available-parcel'}}))
        loadedVersion.value=v
        state.value=''
      }
    }catch(e){if(!controller.signal.aborted)state.value=e instanceof Error?e.message:'可用地块加载失败'}
  },{immediate:true})
  const options=computed(()=>nearby?.value ?? (lead.value?rankAvailableParcels(lead.value,index.value.filter(inScope)):[]))
  const filtered=computed(()=>options.value.filter(f=>matchesReserve(f,filters) && (!filters.area ||
    (filters.area==='small'?Number(f.properties.area)<10000:filters.area==='medium'?Number(f.properties.area)>=10000 && Number(f.properties.area)<50000:Number(f.properties.area)>=50000))))
  const recommended=computed(()=>lead.value && nearby?.value===undefined?recommendedParcels(lead.value,filtered.value).map(f=>f.id):[])
  const selected=computed(()=>{const ids=new Set(checkedIds.value);return options.value.filter(f=>ids.has(f.id))})
  const towns=computed(()=>[...new Set(options.value.map(f=>f.properties.region))].sort((a,b)=>a.localeCompare(b,'zh-CN')))
  const focus=computed(()=>filtered.value.find(f=>f.id===focused.value) ?? selected.value.find(f=>f.id===focused.value)
    ?? filtered.value.find(f=>f.id===recommended.value[0]) ?? filtered.value[0] ?? selected.value[0])
  const page=useServicePage(filtered,[key,()=>filters.town,()=>filters.landUse,()=>filters.urban,()=>filters.search,()=>filters.area],6)
  function resetFilters(){Object.assign(filters,{town:'',landUse:'',urban:'',search:'',area:''})}
  watch(key,()=>{focused.value='';revision.value++;resetFilters()},{flush:'sync'})
  function locate(id:string){
    focused.value=id;revision.value++
    page.reveal(filtered.value.findIndex(f=>f.id===id))
  }
  function toggle(id:string){
    if(!options.value.some(f=>f.id===id))return
    const old=checkedIds.value
    sets.value[key.value]=old.includes(id)?old.filter(v=>v!==id):[...old,id]
  }
  const features=computed(()=>{
    if(nearby?.value!==undefined || !lead.value)return []
    const visible=new Map([...filtered.value,...selected.value].map(f=>[f.id,f]))
    const selectedIds=new Set(checkedIds.value),recommendedIds=new Set(recommended.value)
    return Array.from(visible.values(),f=>{
      const checked=selectedIds.has(f.id), rec=recommendedIds.has(f.id)
      const style=checked ? {color:'#ffc64e',strokeColor:'#ffd55b',fillOpacity:.72}
        : rec ? {color:'#24cad6',strokeColor:'#9ff9ff',fillOpacity:.58} : availableParcelStyle
      return {...f,id:'available:'+f.id,properties:{...f.properties,mapRole:'candidate',optionId:f.id,
        selected:checked,recommended:rec,focused:f.id===focus.value?.id,...style,fillColor:style.color,
        legendLabel:checked?'已选地块':rec?'推荐地块':'可用地块',showLabel:false}}
    })
  })
  return reactive({filters,options,filtered,recommended,selected,towns,focus,revision,page,features,state,checkedIds,
    locate,toggle,resetFilters,reload:()=>retry.value++})
}
