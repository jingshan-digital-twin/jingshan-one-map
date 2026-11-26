import {randomUUID} from 'node:crypto'
import {populationDataset} from '../src/jingshan/population-grid.ts'
import {Router} from 'express'
import type {Pool,PoolClient} from 'pg'
import type {DataDocument} from '../src/jingshan/types.ts'
import {activeOpeningStages,openingDate,openingUuid,OpeningError,type CreatedOpeningTask,type OpeningMode} from '../src/jingshan/venue-opening.ts'
import {chinaClock} from '../src/jingshan/opening-schedule.ts'
import {planningInventory,proposalGroups,weeklyWindow,type OpeningProposal} from '../src/jingshan/opening-proposal.ts'
import {alignSampleTennisCenter} from '../src/jingshan/service-model-location.ts'
import {listedSchedules} from './opening-schedules.ts'

export async function lockAssignments(db:PoolClient,mode:OpeningMode){
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['jingshan:opening:'+mode])
}
export async function ensureAssignable(db:PoolClient,mode:OpeningMode,venues:string[]){
  const occupied=await db.query(`SELECT venue_name FROM jingshan_venue_opening_tasks t
    WHERE mode=$1 AND stage=ANY($3::text[]) AND (venue_id=ANY($2::text[]) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(t.history->0->'proposal'->'venues') v WHERE v->>'id'=ANY($2::text[])
    )) LIMIT 1`,[mode,venues,activeOpeningStages])
  if(occupied.rowCount)throw new OpeningError(occupied.rows[0].venue_name+'已有在办任务，请在交办台账处理后重试',409)
}
export function openingBatchRouter(pool:Pool){
  const router=Router()
  router.post('/',async(req,res)=>{
    const input=req.body??{},batchId=openingUuid(input.requestId),due=openingDate(input.due,'办理期限')
    const mode=input.mode
    if(mode!=='demo'&&mode!=='live')throw new OpeningError('数据模式无效')
    if(!Array.isArray(input.courtIds)||!input.courtIds.length||input.courtIds.some((id:unknown)=>typeof id!=='string'))throw new OpeningError('请选择场地')
    const ids=[...new Set<string>(input.courtIds)].sort(),window=weeklyWindow(input)
    const signature=JSON.stringify([ids,window,due,input.version,input.gridId??''])
    const db=await pool.connect()
    try{
      await db.query('BEGIN')
      await lockAssignments(db,mode)
      const previous=await db.query<CreatedOpeningTask & {signature:string}>(`SELECT id,department,venue_id AS "venueId",venue_name AS "venueName",
        history->0->'proposal'->>'signature' AS signature FROM jingshan_venue_opening_tasks
        WHERE mode=$1 AND history->0->'proposal'->>'batchId'=$2 ORDER BY seq`,[mode,batchId])
      if(previous.rowCount){
        if(previous.rows.some(r=>r.signature!==signature))throw new OpeningError('该提交已用于另一份方案',409)
        await db.query('COMMIT')
        return res.json({tasks:previous.rows.map(({id,department,venueId,venueName})=>({id,department,venueId,venueName}))})
      }
      const today=chinaClock(Date.now()).date
      if(due<today)throw new OpeningError('办理期限不能早于今天')
      const rows=await db.query<{published:DataDocument;version:number}>('SELECT published,version FROM jingshan_workspace WHERE id FOR SHARE')
      const record=rows.rows[0]
      if(!record||record.published.mode!==mode||record.version!==input.version)throw new OpeningError('已发布台账有更新，请刷新并重新预览',409)
      const schedules=await listedSchedules(db,mode)
      const inventory=planningInventory(alignSampleTennisCenter(record.published.datasets),schedules,window,today)
      const chosen=inventory.choices.filter(c=>ids.includes(c.id))
      if(chosen.length!==ids.length)throw new OpeningError('所选场地或排期已变更，请刷新方案',409)
      const scheduleKey=schedules.map(s=>s.taskId+':'+s.revision+':'+s.venueId).sort().join('|')
      if(input.scheduleKey!==scheduleKey)throw new OpeningError('正式排期已更新，请刷新并重新预览',409)
      await ensureAssignable(db,mode,[...new Set(chosen.map(c=>c.venueId))])
      const area=input.gridId && (record.published.datasets.filter(d=>d.id==='administration'||d.id==='communities')
        .flatMap(d=>d.features).find(f=>f.id===input.gridId && ['town-boundary','community'].includes(f.properties.kind))
        ?? populationDataset(record.published.datasets)?.features.find(f=>f.id===input.gridId))
      if(input.gridId&&!area)throw new OpeningError('所选片区已移出发布台账',409)
      const tasks:CreatedOpeningTask[]=[]
      for(const group of proposalGroups(chosen)){
        const id=randomUUID(),first=group.venues[0]
        const proposal:OpeningProposal={batchId,signature,venues:group.venues,...window}
        const name=group.venues.length===1?first.name:first.name+'等 '+group.venues.length+' 处场馆'
        const note=(area?'为'+area.properties.name+'协调开放。':'')+'核实所选场地的开放时间、入场条件及责任人员。'
        const history=[{action:'assign',requestId:id,at:new Date().toISOString(),note,proposal}]
        await db.query(`INSERT INTO jingshan_venue_opening_tasks(id,venue_id,venue_name,mode,department,due,stage,history,region)
          VALUES ($1,$2,$3,$4,$5,$6,'assigned',$7::jsonb,$8)`,[id,first.id,name,mode,group.department,due,JSON.stringify(history),first.region])
        tasks.push({id,department:group.department,venueId:first.id,venueName:name})
      }
      await db.query('COMMIT');res.status(201).json({tasks})
    }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
  })
  return router
}
