import assert from 'node:assert/strict'
import test from 'node:test'
import {applyOpeningSchedules,checkedPlan,scheduleState} from '../src/jingshan/opening-schedule.ts'
import {diagnoseGaps,coordinatingOffice} from '../src/jingshan/service-gaps.ts'
import {venueCapacity} from '../src/jingshan/venue-capacity.ts'

const point=(id,properties={},x=113)=>({id,type:'Feature',geometry:{type:'Point',coordinates:[x,31]},properties:{name:id,region:'京山',...properties}})
const court=(id,facilityId,properties={})=>point(id,{kind:'court',facilityId,ownership:'学校',lighting:true,...properties})
const layer=(id,features)=>({id,features})
const venue=point('v',{kind:'venue',ownership:'学校'})
const day='2026-11-19'
function inventory(courts,slots=[],population=200){
  return [layer('venues',[venue]),layer('courts',courts),layer('population',[point('grid',{population})]),layer('court_slots',slots)]
}
function gaps(data,period='weekdayEvening'){
  return diagnoseGaps(venueCapacity(data,{mode:'walk'},{peoplePerCourt:100}),data,period,day)
}
const plan={taskId:'t',venueId:'v',startsOn:'2026-11-16',endsOn:'2026-11-23',days:[1],from:'18:00',until:'21:00',courtIds:['a'],revision:1,cancelled:false}
const stamp=local=>Date.parse(local+':00+08:00')
const at=stamp('2026-11-16T18:00')

test('排期只在京山当地日期、开放日及时间范围内生效，停排和到期恢复原台账',()=>{
  for(const [moment,expected] of [['2026-11-09T18:00','待生效'],['2026-11-16T17:59','当前不在开放时段'],['2026-11-16T18:00','当前时段开放'],['2026-11-16T20:59','当前时段开放'],['2026-11-16T21:00','当前不在开放时段'],['2026-11-17T18:00','当前不在开放时段'],['2026-11-23T18:00','当前时段开放'],['2026-11-30T18:00','已到期']]){
    assert.equal(scheduleState(plan,stamp(moment)),expected)
  }
  assert.equal(scheduleState({...plan,cancelled:true},at),'已停排')
  assert.equal(scheduleState({...plan,from:'00:00',until:'02:00'},stamp('2026-11-16T00:30')),'当前时段开放')
})

test('重叠工单只计同一片一次，维修、跨馆与被撤下的场地不计入，原发布数据保持独立',()=>{
  const data=inventory([court('a','v',{open:false}),court('b','v',{open:false,status:'维修'}),court('c','another',{open:false})])
  const many={...plan,courtIds:['a','b','c','removed']}
  const opened=applyOpeningSchedules(data,[many,{...plan,taskId:'another-task'}],at)
  assert.deepEqual(opened[1].features.map(f=>f.properties.open),[true,false,false])
  assert.equal(data[1].features[0].properties.open,false)
  assert.deepEqual(gaps(data)[0].source.kinds,['coverage'])
  assert.deepEqual(gaps(opened)[0].source.kinds,['capacity'])
  assert.equal(applyOpeningSchedules(data,[plan],stamp('2026-11-16T21:00')),data)
  assert.equal(applyOpeningSchedules(data,[{...plan,cancelled:true}],at),data)
  assert.throws(()=>checkedPlan(many,data[1].features,'v'),/可排期/)
  assert.throws(()=>checkedPlan(plan,[court('a','v',{count:8})],'v'),/可排期/)
  assert.throws(()=>checkedPlan({...plan,until:'12:00'},data[1].features,'v'),/起止时段/)
})

test('登记开放时间与需求错开可单独形成时段缺口，延长开放的排期生效时解除该缺口',()=>{
  const data=inventory([court('a','v',{open:true,openingHours:'周末 09:00–17:00（错时）'})],[],50)
  const result=gaps(data)[0]
  assert.deepEqual(result.source.kinds,['time'])
  assert.equal(result.hoursGap,true)
  assert.equal(result.candidates[0].action,'协调时段')
  assert.equal(result.candidates[0].department,'教育局')
  assert.deepEqual(gaps(data,'weekendMorning'),[])
  assert.deepEqual(gaps(applyOpeningSchedules(data,[plan],at)),[])
  assert.deepEqual(gaps(applyOpeningSchedules(data,[plan],stamp('2026-11-16T21:00')))[0].source.kinds,['time'])
  data[1].features[0].properties.openingHours='按通知开放'
  assert.deepEqual(gaps(data),[])
})

test('仅用已报连续时段判断预约紧张，跳过样例、重复冲突、单点记录及统计当天',()=>{
  const slots=[]
  const dates=['2026-11-16','2026-11-17','2026-11-18']
  for(const date of dates)for(const time of ['18:00','19:00','20:00'])slots.push(point(date+time,{courtId:'a',date,time,status:'已预约'}))
  const data=inventory([court('a','v',{open:true})],slots,50)
  const result=gaps(data)[0]
  assert.deepEqual(result.source.kinds,['time'])
  assert.equal(result.pressure.total,9)
  data[3].features.push(slots[0])
  assert.equal(gaps(data)[0].pressure.total,9)
  data[3].features.push(point('冲突',{...slots[0].properties,status:'空闲'}))
  assert.deepEqual(gaps(data),[])
  data[3].features=slots.filter(f=>f.properties.time==='18:00')
  assert.deepEqual(gaps(data),[])
  data[3].features=slots.slice(0,9).map(f=>({...f,properties:{...f.properties,sample:true}}))
  assert.deepEqual(gaps(data),[])
  data[3].features=slots.slice(0,9).map(f=>({...f,properties:{...f.properties,date:day}}))
  assert.deepEqual(gaps(data),[])
})

test('缺少逐时记录时保留覆盖或容量诊断，候选按距离、照明、权属与时段匹配',()=>{
  const data=inventory([court('a','v',{open:false,lighting:false,indoor:false})])
  data.push(layer('venue_operations',[point('month',{bookedHours:100,availableHours:100})]))
  assert.equal(gaps(data)[0].pressure.sufficient,false)
  assert.deepEqual(gaps(data)[0].source.kinds,['coverage'])
  assert.equal(gaps(data)[0].candidates.length,0)
  assert.equal(gaps(data,'weekdayMorning')[0].candidates.length,1)
  assert.equal(coordinatingOffice(point('agency',{ownership:'机关单位'})),'机关事务服务中心')
  assert.equal(coordinatingOffice(point('shop',{operator:'网球俱乐部公司'})),'网球俱乐部公司')
  data[0].features[0]=point('v',{ownership:'学校'},114)
  assert.equal(gaps(data,'weekdayMorning')[0].candidates.length,0)
})
