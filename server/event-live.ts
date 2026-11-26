import { Router, type ErrorRequestHandler } from 'express'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { publishedLiveMonitors } from '../src/jingshan/event-monitor-records.ts'
import type { LiveAction, LiveEventMonitor, LiveIncidentStatus, LiveNotice, LiveTransitionAction } from '../src/jingshan/event-live-types.ts'
import type { Dataset } from '../src/jingshan/types.ts'

class LiveRequestError extends Error {
  status:number
  constructor(status:number,message:string){super(message);this.status=status}
}
const transitions = {
  dispatch:{from:'pending',to:'dispatched',label:'一键派单'},receive:{from:'dispatched',to:'received',label:'部门签收'},
  onsite:{from:'received',to:'onsite',label:'到场处置'},resolve:{from:'onsite',to:'resolved',label:'确认办结'},
} satisfies Record<Exclude<LiveTransitionAction,'consult'>,{from:LiveIncidentStatus;to:LiveIncidentStatus;label:string}>
type Entry = {incidentId:string;status:LiveIncidentStatus;action:LiveAction} | {notice:LiveNotice}
type State = {key:string;event:LiveEventMonitor}
const ids=['event_live_monitors','event_live_points','event_live_incidents','event_live_alerts','event_live_roads','event_plans','events','venues']

async function readMonitors(client:PoolClient,lock:boolean):Promise<State[]> {
  const result=await client.query<{version:number; datasets:Dataset[]}>(
    `SELECT version, (SELECT COALESCE(jsonb_agg(d),'[]') FROM jsonb_array_elements(published->'datasets') d
      WHERE d->>'id' = ANY($1::text[])) AS datasets FROM jingshan_workspace WHERE id`+(lock?' FOR SHARE':''),
    [ids])
  const snapshot=result.rows[0]
  if(!snapshot)return []
  const records=new Map(snapshot.datasets.find(d=>d.id===ids[0])?.features.map(f=>[String(f.properties.monitorCode).trim(),f.id]))
  return publishedLiveMonitors(snapshot.datasets).map(event=>{
    event.publicationVersion=snapshot.version
    return {key:JSON.stringify([records.get(event.id)??event.planId,event.demo]),event}
  })
}
async function replay(client:PoolClient,states:State[]) {
  if(!states.length)return
  const byKey=new Map(states.map(s=>[s.key,s.event]))
  const logs=await client.query<{monitor_key:string;revision:number;entry:Entry}>(
    'SELECT monitor_key,revision,entry FROM jingshan_event_live_actions WHERE monitor_key=ANY($1::text[]) ORDER BY monitor_key,revision',
    [[...byKey.keys()]])
  for(const {monitor_key,revision,entry} of logs.rows) {
    const event=byKey.get(monitor_key)!
    event.revision=revision
    if('notice' in entry){event.publicNotices.push(entry.notice);continue}
    const target=event.incidents.find(i=>i.id===entry.incidentId)
    if(target){target.status=entry.status;target.updatedAt=entry.action.at;target.history.push(entry.action)}
  }
}
function checkedText(input:unknown,required:boolean) {
  if(input===undefined&&!required)return ''
  if(typeof input!=='string'||input.length>1000||input.includes('\0')||(required&&!input.trim()))
    throw new LiveRequestError(400,'请填写有效内容，最多 1000 字')
  return input.trim()
}
export function eventLiveRouter(pool:Pool) {
  const router=Router()
  let initialization:Promise<void>|undefined
  async function initialize() {
    const client=await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('event-live-actions'))")
      await client.query(`CREATE TABLE IF NOT EXISTS jingshan_event_live_actions(
        monitor_key text NOT NULL, revision integer NOT NULL, entry jsonb NOT NULL, PRIMARY KEY(monitor_key,revision))`)
      await client.query('COMMIT')
    }catch(error){await client.query('ROLLBACK');throw error}
    finally{client.release()}
  }
  function ready(){
    return initialization??=initialize().catch(error=>{initialization=undefined;throw error})
  }
  router.get('/',async(_req,res)=>{
    await ready()
    const client=await pool.connect()
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const states=await readMonitors(client,false)
      await replay(client,states)
      await client.query('COMMIT')
      res.set('Cache-Control','no-store').json({events:states.map(s=>s.event)})
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  })
  async function update(id:string,body:Record<string,unknown>,makeEntry:(e:LiveEventMonitor)=>Entry) {
    if(!Number.isSafeInteger(body.revision)||!Number.isSafeInteger(body.publicationVersion))
      throw new LiveRequestError(400,'请重新读取赛事监测版本后再操作')
    await ready()
    const client=await pool.connect()
    try {
      await client.query('BEGIN')
      const state=(await readMonitors(client,true)).find(s=>s.event.id===id)
      if(!state)throw new LiveRequestError(404,'当前发布中没有这场监测')
      if(state.event.awaitingMonitor)throw new LiveRequestError(409,'请先在后台填报并发布本场赛中监测')
      await client.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))',[state.key])
      await replay(client,[state])
      const e=state.event
      if(e.revision!==body.revision || e.publicationVersion!==body.publicationVersion)
        throw new LiveRequestError(409,'监测资料或处置记录已更新，请刷新后重试')
      const entry=makeEntry(e)
      await client.query('INSERT INTO jingshan_event_live_actions(monitor_key,revision,entry) VALUES($1,$2,$3)',[state.key,++e.revision,entry])
      await client.query('COMMIT')
      return e
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
  router.post('/:id/incidents/:incidentId/transition',async(req,res)=>{
    const {action,note}=req.body??{}
    if(typeof action!=='string'||(action!=='consult'&&!Object.hasOwn(transitions,action)))throw new LiveRequestError(400,'请选择有效的处置操作')
    const comment=checkedText(note,['onsite','resolve','consult'].includes(action))
    res.json(await update(req.params.id,req.body??{},e=>{
      const incident=e.incidents.find(i=>i.id===req.params.incidentId)
      if(!incident)throw new LiveRequestError(404,'当前赛事中找不到此事件')
      if(incident.status==='resolved')throw new LiveRequestError(409,'此事件已办结')
      let label='部门会商'
      if(action!=='consult'){
        const step=transitions[action as keyof typeof transitions]
        if(incident.status!==step.from)throw new LiveRequestError(409,'当前处置状态不支持此操作')
        incident.status=step.to;label=step.label
      }
      const log={id:randomUUID(),at:new Date().toISOString(),action:action as LiveTransitionAction,label,note:comment}
      incident.updatedAt=log.at;incident.history.push(log)
      return {incidentId:incident.id,status:incident.status,action:log}
    }))
  })
  router.post('/:id/notices',async(req,res)=>{
    const text=checkedText(req.body?.text,true)
    res.json(await update(req.params.id,req.body??{},e=>{
      const notice={id:randomUUID(),at:new Date().toISOString(),text}
      e.publicNotices.push(notice);return {notice}
    }))
  })
  const handleRequestError:ErrorRequestHandler=(error,_req,res,next)=>{
    if(error instanceof LiveRequestError)res.status(error.status).json({error:error.message})
    else next(error)
  }
  router.use(handleRequestError)
  return router
}
