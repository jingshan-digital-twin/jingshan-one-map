import test from 'node:test'
import assert from 'node:assert/strict'
import { assessmentOverview } from '../src/jingshan/event-assessment-overview.ts'
import { parseEventDate } from '../src/jingshan/event-plan-data.ts'

const today = '2026-11-24'
function race(id,range,venueNames=[],fields={}) {
  return {id,name:id,year:2026,sequence:1,category:'赛事',assessment:true,venueNames,
    ...parseEventDate(2026,range),...fields}
}
function plan(eventId,fields={}) {
  return {eventId,status:'draft',departments:[],taskIds:[],topics:[],...fields}
}
const topic = (id,department) => ({id,label:id,department,items:[{id:id+'-1'}]})
const progress = summary => summary.stageRows.map(({stage,count}) => [stage,count])
const summarize = (events,plans={},month=null) => assessmentOverview(events,plans,2026,month,today)

test('状态筛选与数字卡同源，赛期结束、演练办结和已撤回方案不算正式研判办结',()=>{
  const events = [
    race('ended','10月8日'),race('closed','12月6日'),race('exercise','11月26日'),
    race('withdrawn','11月28日'),race('draft','12月3日'),race('legacy','12月8日'),
    race('history','11月6日',[],{assessment:false}),race('demo','11月',[],{sample:true}),
    race('cancelled','11月',[],{cancelled:true}),race('activity','12月',[],{category:'培训'}),
    race('next-year','12月',[],{year:2027}),
  ]
  const plans = {
    closed:plan('closed',{status:'completed',completedAt:'2026-11-22'}),
    exercise:plan('exercise',{status:'completed',completedAt:'2026-11-22',example:true}),
    withdrawn:plan('withdrawn',{status:'review',withdrawnAt:'2026-11-22'}),
    draft:plan('draft'),
    legacy:plan('legacy',{status:'completed'}), // Legacy labels alone do not confirm closure.
  }
  const result = summarize(events,plans)
  assert.deepEqual(progress(result),[['待研判',3],['处理中',2],['已完结',1]])
  assert.deepEqual(result.stageRows[0].events.map(row=>row.id),['ended','exercise','withdrawn'])
  assert.deepEqual(progress(summarize(events,plans,12)),[['待研判',0],['处理中',2],['已完结',1]])
  assert.ok(!result.missingVenues.some(row=>row.id==='ended'))
})

test('专项只计当前已下发任务，同部门跨场赛事待全部反馈，撤回和未选子项不计',()=>{
  const events = ['first','second','withdrawn','exercise','old-draft','december'].map(id=>race(id,id==='december'?'12月8日':'11月29日'))
  const assignments = (id,taskId,department,status) => plan(id,{
    status:'review',topics:[topic('traffic',department),topic('medical',department)],
    dispatchedItems:{traffic:['traffic-1'],medical:[]},departments:[department],taskIds:[taskId],
    feedback:[{taskId,department,status},{taskId:999,department,status:'completed'}],
  })
  const plans = {
    first:assignments('first',81,'交警大队','completed'),
    second:assignments('second',82,'交警大队','received'),
    withdrawn:{...assignments('withdrawn',83,'交通局','pending'),withdrawnAt:today},
    exercise:{...assignments('exercise',84,'演练部门','completed'),example:true},
    'old-draft':{...assignments('old-draft',86,'旧任务部门','completed'),status:'draft'},
    december:assignments('december',85,'交通局','completed'),
  }
  const byMonth = month => summarize(events,plans,month).topics.map(({id,responded,assigned})=>[id,responded,assigned])
  assert.deepEqual(byMonth(null),[['traffic',1,2]])
  assert.deepEqual(byMonth(11),[['traffic',0,1]])
  assert.deepEqual(byMonth(12),[['traffic',1,1]])
  plans.second.feedback[0].status = 'completed'
  assert.deepEqual(byMonth(11),[['traffic',1,1]])
})

test('场馆待定与并发赛期按所选月份重算，按别名匹配且不猜测未确定的日期',()=>{
  const shared = '京山国际网球中心'
  const events = [
    race('A','11月27日-12月1日',[shared]),race('B','11月28日-29日',['京山国际网球赛事中心',shared]),
    race('C','11月29日',[shared]),race('D','12月1日-3日',[shared]),
    race('unknown-day','12月',[shared]),race('unlocated','12月6日',['场馆待定','待定场馆']),
    race('partial','12月8日',['待定','已登记场馆']),
    race('history','11月28日',[shared],{assessment:false}),race('cancelled','11月29日',[shared],{cancelled:true}),
  ]
  const overlaps = month => summarize(events,{},month).overlaps.map(o=>[o.venue,o.startDate,o.endDate,o.events.map(e=>e.id)])
  assert.deepEqual(overlaps(11),[
    [shared,'2026-11-28','2026-11-28',['A','B']],
    [shared,'2026-11-29','2026-11-29',['A','B','C']],
  ])
  assert.deepEqual(overlaps(12),[[shared,'2026-12-01','2026-12-01',['A','D']]])
  assert.deepEqual(summarize(events,{},12).missingVenues.map(e=>e.id),['unlocated'])
  assert.deepEqual(summarize(events,{},11).missingVenues,[])
})

test('跨月重叠仍按整份赛历拆分，选月与当前日期只筛选相交且尚未结束的区段',()=>{
  const venue = ['京山网球训练基地']
  const events = [race('A','11月25日-12月3日',venue),race('B','11月28日-12月2日',venue),race('C','11月29日',venue)]
  const spans = (month,day) => assessmentOverview(events,{},2026,month,day).overlaps.map(group =>
    [group.startDate,group.endDate,group.events.map(event=>event.id)])
  const before = ['2026-11-28','2026-11-28',['A','B']]
  const during = ['2026-11-29','2026-11-29',['A','B','C']]
  const after = ['2026-11-30','2026-12-02',['A','B']]
  assert.deepEqual(spans(11,today),[before,during,after])
  assert.deepEqual(spans(12,today),[after])
  assert.deepEqual(spans(null,'2026-11-29'),[during,after])
  assert.deepEqual(spans(null,'2026-12-01'),[after])
  assert.deepEqual(spans(12,'2026-12-03'),[])
})
