<script setup lang="ts">
import { browserUuid } from './browser-uuid'
import { computed,onMounted,onBeforeUnmount,reactive,ref } from 'vue'
import type {OpeningProposal} from './opening-proposal'
import { api,jsonRequest } from './api'
import { dayNames,scheduleState,type OpeningSchedule,type SchedulePlan } from './opening-schedule'
const props=defineProps<{taskId:string;startsOn?:string;proposal?:OpeningProposal}>()
const courts=ref<{id:string;name:string}[]>([]),schedule=ref<OpeningSchedule|null>(null)
const editing=ref(false),busy=ref(false),loaded=ref(false),error=ref('')
const clock=ref(Date.now())
const form=reactive<SchedulePlan>({startsOn:'',endsOn:'',days:[],from:'',until:'',courtIds:[]})
const state=computed(()=>schedule.value?scheduleState(schedule.value,clock.value):'尚未登记')
let timer:ReturnType<typeof setInterval>
async function load(){
  busy.value=true;error.value=''
  try{const data=await api<{courts:typeof courts.value;schedule:OpeningSchedule|null}>('/venue-opening/schedules/'+props.taskId)
    courts.value=data.courts;schedule.value=data.schedule;loaded.value=true;editing.value=false
  }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
function edit(){
  const s=schedule.value
  Object.assign(form,{startsOn:s?.startsOn??props.startsOn??'',endsOn:s?.endsOn??'',days:[...(s?.days??props.proposal?.days??[])],
    from:s?.from??props.proposal?.from??'',until:s?.until??props.proposal?.until??'',courtIds:(s?.courtIds??props.proposal?.venues.flatMap(v=>v.courts.map(c=>c.id))??[]).filter(id=>courts.value.some(c=>c.id===id))})
  error.value='';editing.value=true
}
async function save(cancelled=false){
  if(busy.value||!loaded.value)return
  if(cancelled&&!window.confirm('停止这份排期后，其提供的开放时段将从指标中移除。确认停排？'))return
  busy.value=true;error.value=''
  try{schedule.value=await api('/venue-opening/schedules/'+props.taskId,jsonRequest('PUT',{...form,revision:schedule.value?.revision??0,cancelled}))
    editing.value=false;clock.value=Date.now()
    window.dispatchEvent(new Event('jingshan-opening-schedules'))
    try{localStorage.setItem('jingshan-opening-schedules',browserUuid())}catch{/* optional storage */}
  }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
onMounted(()=>{void load();timer=setInterval(()=>clock.value=Date.now(),15000)})
onBeforeUnmount(()=>clearInterval(timer))
</script>
<template>
<section class="opening-plan industry-card" aria-label="正式开放排期">
  <div class="service-line"><h4>正式开放排期</h4><b v-if="loaded">{{ state }}</b></div>
  <p v-if="error" role="alert">{{ error }} <button type="button" class="industry-button" @click="load" :disabled="busy">重新读取</button></p>
  <p v-if="schedule">{{ schedule.startsOn }} 起<span v-if="schedule.endsOn">至 {{ schedule.endsOn }}</span> · 周{{ schedule.days.map(d=>dayNames[d]).join('、') }} · {{ schedule.from }}–{{ schedule.until }}</p>
  <p v-if="schedule">场地：{{ schedule.courtIds.map(id=>courts.find(c=>c.id===id)?.name||id).join('、') }}</p>
  <p v-else-if="loaded">工单已办结。登记具体场地和开放时段后，指标在对应时段计入。</p>
  <template v-if="!editing && loaded">
    <button v-if="courts.length" type="button" class="industry-button" :disabled="busy" @click="edit">{{ schedule?'调整排期':'登记开放排期' }}</button>
    <p v-else>请先在当前发布台账中核实可用的逐片场地。</p>
    <button v-if="schedule && !schedule.cancelled" type="button" class="industry-button" :disabled="busy" @click="save(true)">停止排期</button>
  </template>
  <form v-if="editing" class="opening-form" @submit.prevent="save()">
    <fieldset><legend>面向公众开放的场地</legend><label v-for="c in courts" :key="c.id"><input type="checkbox" v-model="form.courtIds" :value="c.id">{{ c.name }}</label></fieldset>
    <div class="opening-fields"><label>生效日期<input type="date" v-model="form.startsOn" required></label><label>截止日期（选填）<input type="date" v-model="form.endsOn" :min="form.startsOn"></label></div>
    <fieldset><legend>每周开放日</legend><label v-for="d in [1,2,3,4,5,6,0]" :key="d"><input type="checkbox" v-model="form.days" :value="d">周{{ dayNames[d] }}</label></fieldset>
    <div class="opening-fields"><label>开始时间<input type="time" v-model="form.from" required></label><label>结束时间<input v-model.trim="form.until" placeholder="如 21:00 或 24:00" pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00" required></label></div>
    <div class="opening-buttons"><button class="industry-button" type="button" @click="editing=false">取消</button><button class="industry-button primary" :disabled="busy||!form.courtIds.length||!form.days.length">保存正式排期</button></div>
  </form>
</section>
</template>
<style scoped>
.opening-plan,.opening-form { display:grid;gap:8px;min-width:0 }
.opening-fields { display:grid;grid-template-columns:repeat(auto-fit,minmax(min(135px,100%),1fr));gap:8px }
.opening-fields label{display:grid;min-width:0}.opening-fields input{min-width:0;width:100%}
fieldset{display:flex;flex-wrap:wrap;gap:6px 12px;border:1px solid var(--industry-table-line);min-width:0}
fieldset label{display:inline-flex;align-items:center;gap:4px}.opening-buttons{display:flex;justify-content:flex-end;gap:8px}
</style>

