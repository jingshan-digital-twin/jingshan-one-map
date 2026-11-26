import { Router, type ErrorRequestHandler } from 'express'
import {populationDataset} from '../src/jingshan/population-grid.ts'
import {openingBatchRouter,lockAssignments,ensureAssignable} from './opening-batches.ts'
import { openingSchedulesRouter } from './opening-schedules.ts'
import type { Pool } from 'pg'
import type { DataDocument } from '../src/jingshan/types.ts'
import { gapLabels, periods, type GapSource, type GapType, type Period } from '../src/jingshan/service-gaps.ts'
import {
  OpeningError, activeOpeningStages, openingDate, openingListSize, openingStageLabels, openingTransition, openingUuid, openingVenue, requiredText,
  type ActiveVenueTask, type OpeningEvent, type OpeningTask,
} from '../src/jingshan/venue-opening.ts'

const summaryFields = 'id, venue_id AS "venueId", venue_name AS "venueName", region, mode, department, to_char(due, \'YYYY-MM-DD\') AS due, stage'
const fields = summaryFields + ', history'

function modeValue(mode:unknown) {
  if (mode !== 'live' && mode !== 'demo') throw new OpeningError('数据模式无效')
  return mode
}
function scope(input: Record<string, unknown>) {
  return { venueId: requiredText(input.venueId, '场馆编号', 256), mode:modeValue(input.mode) }
}
function pageValue(value: unknown) {
  const page = Number(value ?? 1)
  if (!Number.isSafeInteger(page) || page < 1 || page > 2147483647) throw new OpeningError('页码无效')
  return page
}
function filterText(value:unknown) {
  if (value === undefined || value === '') return ''
  return requiredText(value,'筛选条件',120)
}

function gapSource(value:unknown, data:DataDocument):GapSource | undefined {
  if (value===undefined) return undefined
  if (!value || typeof value!=='object') throw new OpeningError('缺口片区无效')
  const {id,period,kinds}=value as Record<string,unknown>
  const area=populationDataset(data.datasets)?.features.find(f=>f.id===id)
  if (!area) throw new OpeningError('当前发布台账中找不到该片区，请刷新后交办',409)
  if (typeof period!=='string'||!Object.hasOwn(periods,period)||!Array.isArray(kinds)||!kinds.length||
    kinds.some(k=>typeof k!=='string'||!Object.hasOwn(gapLabels,k))) throw new OpeningError('片区缺口类型或诊断时段无效')
  return {id:area.id,name:area.properties.name,period:period as Period,kinds:[...new Set<GapType>(kinds)]}
}

export function venueOpeningRouter(pool: Pool) {
  const router = Router()
  router.use('/batch',openingBatchRouter(pool))
  router.use('/schedules',openingSchedulesRouter(pool))
  router.get('/active-venues',async(req,res)=>{
    const {rows}=await pool.query<ActiveVenueTask>(`SELECT DISTINCT ON (site.id) site.id AS "venueId",t.id AS "taskId",
        t.venue_name AS "venueName",t.stage,t.department
      FROM jingshan_venue_opening_tasks t CROSS JOIN LATERAL (
        SELECT t.venue_id AS id UNION SELECT v->>'id' FROM jsonb_array_elements(t.history->0->'proposal'->'venues') v
      ) site WHERE t.mode=$1 AND t.stage=ANY($2::text[]) AND site.id IS NOT NULL ORDER BY site.id,t.seq DESC`,
      [modeValue(req.query.mode),activeOpeningStages])
    res.json({venueIds:rows.map(row=>row.venueId),tasks:rows})
  })
  router.get('/tasks', async (req,res) => {
    const mode = modeValue(req.query.mode)
    const region = filterText(req.query.region)
    const keyword = filterText(req.query.q)
    const stage = filterText(req.query.stage)
    const overdue = req.query.overdue==='1'
    if (stage && !Object.hasOwn(openingStageLabels,stage)) throw new OpeningError('办理状态无效')
    const focusId=req.query.focusId ? openingUuid(req.query.focusId) : null
    const page = pageValue(req.query.page)
    const size = Number(req.query.size ?? openingListSize)
    if (!Number.isInteger(size) || size < 1 || size > 50) throw new OpeningError('每页条数无效')
    const {rows} = await pool.query(`WITH scoped AS (
      SELECT seq, ${summaryFields}, history->0->>'note' AS requirement,
        (SELECT event->>'outcome' FROM jsonb_array_elements(history) WITH ORDINALITY AS h(event,n)
         WHERE event->>'action'='feedback' ORDER BY n DESC LIMIT 1) AS outcome FROM jingshan_venue_opening_tasks
      WHERE mode=$1 AND ($2='' OR region=$2 OR EXISTS (SELECT 1 FROM jsonb_array_elements(history->0->'proposal'->'venues') v WHERE v->>'region'=$2))
        AND ($4='' OR strpos(lower(concat_ws(' ',venue_name,department,'场地开放协调',history->0->>'note')),lower($4))>0 OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(history->0->'proposal'->'venues') v WHERE strpos(lower(v->>'name'),lower($4))>0))
    ), matched AS (
      SELECT * FROM scoped WHERE ($3='' OR stage=$3)
        AND (NOT $7::boolean OR (stage=ANY($9::text[]) AND due::date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date))
    ), counts AS (
      SELECT jsonb_build_object('assigned',count(*) FILTER (WHERE stage='assigned'),
        'received',count(*) FILTER (WHERE stage='received'), 'review',count(*) FILTER (WHERE stage='review'),
        'closed',count(*) FILTER (WHERE stage='closed'),'withdrawn',count(*) FILTER (WHERE stage='withdrawn'), 'overdue',count(*) FILTER (
          WHERE stage=ANY($9::text[]) AND due::date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date)) AS stages FROM scoped
    ), target AS (SELECT seq FROM matched WHERE id=$8::uuid), bounds AS (
      SELECT count(*)::int AS total, CASE WHEN EXISTS (SELECT 1 FROM target)
        THEN 1 + ((count(*) FILTER (WHERE seq>(SELECT seq FROM target)))/$6::int)::int
        ELSE least($5::int,greatest(1,ceil(count(*)::numeric/$6::int)::int)) END AS page FROM matched
    )
    SELECT total,page,(SELECT stages FROM counts) AS counts,COALESCE((SELECT jsonb_agg(to_jsonb(item)-'seq' ORDER BY seq DESC) FROM (
      SELECT matched.*, (SELECT s.plan || jsonb_build_object('cancelled',s.cancelled)
        FROM jingshan_opening_schedules s WHERE s.task_id=matched.id) AS schedule
      FROM matched ORDER BY seq DESC LIMIT $6 OFFSET (SELECT (page-1)::bigint*$6 FROM bounds)
    ) item),'[]'::jsonb) AS items FROM bounds`,[mode,region === '京山市' ? '' : region,stage,keyword,page,size,overdue,focusId,activeOpeningStages])
    res.json(rows[0])
  })
  router.get('/', async (req, res) => {
    const {venueId, mode} = scope(req.query)
    if (req.query.taskId !== undefined) {
      const taskId = openingUuid(req.query.taskId)
      const {rows} = await pool.query<OpeningTask & {page:number;count:number}>(`SELECT * FROM (
        SELECT ${fields}, (row_number() OVER (ORDER BY seq DESC))::int AS page, (count(*) OVER ())::int AS count
        FROM jingshan_venue_opening_tasks WHERE (venue_id=$1 OR EXISTS (SELECT 1 FROM jsonb_array_elements(history->0->'proposal'->'venues') v WHERE v->>'id'=$1)) AND mode=$2
      ) numbered WHERE id=$3`, [venueId,mode,taskId])
      if (!rows[0]) throw new OpeningError('当前场馆未找到所选任务',404)
      const {page,count,...task} = rows[0]
      return res.json({task,page,count})
    }
    const page = pageValue(req.query.page)
    const {rows} = await pool.query<OpeningTask & {count:number}>(`SELECT ${fields}, (count(*) OVER ())::int AS count
      FROM jingshan_venue_opening_tasks WHERE (venue_id=$1 OR EXISTS (SELECT 1 FROM jsonb_array_elements(history->0->'proposal'->'venues') v WHERE v->>'id'=$1)) AND mode=$2 ORDER BY seq DESC LIMIT 1 OFFSET $3`, [venueId, mode, page-1])
    if (!rows.length) return res.json({task: null, count: 0, page:1})
    const {count, ...task} = rows[0]
    res.json({task, count, page})
  })
  router.post('/', async (req, res) => {
    const input = req.body ?? {}
    const {venueId, mode} = scope(input)
    const id = openingUuid(input.requestId)
    const department = requiredText(input.department, '承办单位', 100)
    const due = openingDate(input.due, '办理期限')
    const note = requiredText(input.note, '交办要求')
    const {rows} = await pool.query<{data:DataDocument}>('SELECT published AS data FROM jingshan_workspace WHERE id')
    if (!rows[0] || rows[0].data.mode !== mode) throw new OpeningError('发布数据已切换，请刷新后办理', 409)
    const venue = openingVenue(rows[0].data.datasets, venueId)
    const event: OpeningEvent = {action:'assign', requestId:id, at:new Date().toISOString(), note}
    const source=gapSource(input.source,rows[0].data)
    if (source) event.source=source
    const db=await pool.connect()
    try {
    await db.query('BEGIN')
    await lockAssignments(db,mode)
    const priorRequest=await db.query('SELECT id FROM jingshan_venue_opening_tasks WHERE id=$1',[id])
    if(!priorRequest.rowCount)await ensureAssignable(db,mode,[venueId])
    const inserted = await db.query<OpeningTask>(`INSERT INTO jingshan_venue_opening_tasks
      (id, venue_id, venue_name, mode, department, due, stage, history, region) VALUES ($1,$2,$3,$4,$5,$6,'assigned',$7::jsonb,$8)
      ON CONFLICT DO NOTHING RETURNING ${fields}`, [id,venueId,venue.name,mode,department,due,JSON.stringify([event]),venue.region ?? ''])
    await db.query('COMMIT')
    if (inserted.rows.length) return res.status(201).json(inserted.rows[0])
    const {rows:existing} = await db.query<OpeningTask>('SELECT '+fields+' FROM jingshan_venue_opening_tasks WHERE id=$1', [id])
    const old = existing[0]
    const prior=old?.history[0].source
    if (old && old.venueId === venueId && old.mode === mode && old.department === department && old.due === due && old.history[0].note === note &&
      prior?.id===source?.id && prior?.period===source?.period && prior?.kinds.join()===source?.kinds.join()) return res.json(old)
    throw new OpeningError('该场馆已有在办任务或请求已变更，请刷新进度', 409)
    } catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
  })
  router.patch('/:id', async (req, res) => {
    const id = openingUuid(req.params.id)
    const input = req.body ?? {}
    const db = await pool.connect()
    try {
      await db.query('BEGIN')
      const {rows} = await db.query<OpeningTask>('SELECT '+fields+' FROM jingshan_venue_opening_tasks WHERE id=$1 FOR UPDATE', [id])
      const task = rows[0]
      if (!task) throw new OpeningError('找不到该任务', 404)
      const updated = openingTransition(task, input, new Date().toISOString())
      if (updated !== task) {
        await db.query('UPDATE jingshan_venue_opening_tasks SET stage=$1, history=$2::jsonb WHERE id=$3', [updated.stage,JSON.stringify(updated.history),id])
      }
      await db.query('COMMIT')
      res.json(updated)
    } catch (error) {
      await db.query('ROLLBACK')
      throw error
    } finally { db.release() }
  })
  const handleError: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof OpeningError) res.status(error.status).json({error:error.message})
    else next(error)
  }
  router.use(handleError)
  return router
}
