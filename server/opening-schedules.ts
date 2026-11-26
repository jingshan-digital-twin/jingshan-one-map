import { Router } from 'express'
import type { Pool,PoolClient } from 'pg'
import type { DataDocument } from '../src/jingshan/types.ts'
import { OpeningError, openingUuid, type OpeningEvent } from '../src/jingshan/venue-opening.ts'
import { checkedPlan,courtVenueId,canScheduleCourt,type OpeningSchedule } from '../src/jingshan/opening-schedule.ts'

const columns='task_id AS "taskId", venue_id AS "venueId", revision, cancelled, plan'
type Row=Pick<OpeningSchedule,'taskId'|'venueId'|'revision'|'cancelled'> & {plan:Omit<OpeningSchedule,'taskId'|'venueId'|'revision'|'cancelled'>}
function proposalCourts(data:DataDocument,venueId:string,history:OpeningEvent[]){
  const assigned=history[0]?.proposal?.venues
  const bindings=new Map(assigned?.flatMap(v=>v.courts.map(c=>[c.id,v.id] as const)))
  return data.datasets.find(d=>d.id==='courts')?.features.filter(f=>canScheduleCourt(f)&&
    (assigned?bindings.get(f.id)===courtVenueId(f):courtVenueId(f)===venueId))??[]
}
export async function listedSchedules(db:Pool|PoolClient,mode:string):Promise<OpeningSchedule[]>{
  const {rows}=await db.query<Row>('SELECT '+columns+' FROM jingshan_opening_schedules WHERE mode=$1 AND NOT cancelled',[mode])
  return rows.flatMap(row=>{
    const s=flatten(row),venues=s.courtVenues
    if(!venues)return [s]
    return [...new Set(s.courtIds.map(id=>venues[id]))].map(venueId=>({...s,venueId,courtIds:s.courtIds.filter(id=>venues[id]===venueId)}))
  })
}
const flatten=({plan,...record}:Row):OpeningSchedule=>({...record,...plan})
export function openingSchedulesRouter(pool:Pool){
  const router=Router()
  router.get('/',async(req,res)=>{
    if(req.query.mode!=='live'&&req.query.mode!=='demo') throw new OpeningError('数据模式无效')
    res.json(await listedSchedules(pool,req.query.mode))
  })
  router.get('/:id',async(req,res)=>{
    const id=openingUuid(req.params.id)
    const {rows}=await pool.query<{venueId:string;mode:string;history:OpeningEvent[];data:DataDocument}>(
      'SELECT t.venue_id AS "venueId", t.mode,t.history,w.published AS data FROM jingshan_venue_opening_tasks t CROSS JOIN jingshan_workspace w WHERE t.id=$1 AND w.id',[id])
    if(!rows[0])throw new OpeningError('任务不存在',404)
    const {venueId,mode,data,history}=rows[0]
    const courts=data.mode!==mode?[]:proposalCourts(data,venueId,history).map(f=>({id:f.id,name:f.properties.name}))
    const existing=await pool.query<Row>('SELECT '+columns+' FROM jingshan_opening_schedules WHERE task_id=$1',[id])
    res.json({courts,schedule:existing.rows[0]?flatten(existing.rows[0]):null})
  })
  router.put('/:id',async(req,res)=>{
    const id=openingUuid(req.params.id)
    const input=req.body??{}
    if(!Number.isSafeInteger(input.revision)||input.revision<0)throw new OpeningError('缺少排期修订号')
    const db=await pool.connect()
    try {
      await db.query('BEGIN')
      const {rows}=await db.query<{venueId:string;name:string;stage:string;mode:string;history:OpeningEvent[]}>(
        'SELECT venue_id AS "venueId",venue_name AS name,stage,mode,history FROM jingshan_venue_opening_tasks WHERE id=$1 FOR UPDATE',[id])
      const task=rows[0]
      if(!task)throw new OpeningError('任务不存在',404)
      const feedback=task.history.findLast(e=>e.action==='feedback')
      if(task.stage!=='closed'||feedback?.outcome!=='scheduled')throw new OpeningError('先核验并办结有开放方案的工单',409)
      const current=(await db.query<Row>('SELECT '+columns+' FROM jingshan_opening_schedules WHERE task_id=$1',[id])).rows[0]
      if((current?.revision??0)!==input.revision)throw new OpeningError('排期已变更，请刷新后核对',409)
      const cancel=input.cancelled===true
      if(cancel&&!current)throw new OpeningError('尚未登记排期')
      const {rows:docs}=await db.query<{data:DataDocument}>('SELECT published AS data FROM jingshan_workspace WHERE id FOR SHARE')
      const data=docs[0]?.data
      if(!data||data.mode!==task.mode)throw new OpeningError('发布数据模式已切换，请刷新',409)
      const allowed=proposalCourts(data,task.venueId,task.history)
      const plan=cancel?current.plan:checkedPlan(input,allowed,task.history[0]?.proposal?undefined:task.venueId)
      if(!cancel&&task.history[0]?.proposal)plan.courtVenues=Object.fromEntries(allowed.filter(f=>plan.courtIds.includes(f.id)).map(f=>[f.id,courtVenueId(f)]))
      const saved=await db.query<Row>(`INSERT INTO jingshan_opening_schedules(task_id,venue_id,mode,plan,cancelled)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(task_id) DO UPDATE SET plan=EXCLUDED.plan,cancelled=EXCLUDED.cancelled,
        revision=jingshan_opening_schedules.revision+1 RETURNING `+columns,[id,task.venueId,task.mode,JSON.stringify(plan),cancel])
      await db.query("INSERT INTO jingshan_activity(area,action,resource,detail) VALUES ('场地排期',$1,$2,$3)",
        [cancel?'停止排期':current?'调整排期':'登记排期',task.name,plan.courtIds.length+' 项场地 · '+plan.startsOn+' 起 '+plan.from+'–'+plan.until])
      await db.query('COMMIT')
      res.json(flatten(saved.rows[0]))
    }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
  })
  return router
}

