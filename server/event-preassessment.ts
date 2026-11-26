import { createHash } from 'node:crypto'
import { eventRoadSurfaces } from './event-road-surfaces.ts'
import { needsSurveyRoads, pendingRoadBasis, withSurveyRoads } from '../src/jingshan/event-survey-roads.ts'
import { Router, type ErrorRequestHandler } from 'express'
import { CimError } from './cim-error.ts'
import type { Pool, PoolClient } from 'pg'
import type { DataDocument } from '../src/jingshan/types.ts'
import type { AssessmentWithdrawal, EventAssessment, EventDepartmentFeedback, PlannedEvent } from '../src/jingshan/event-plan-types.ts'
import { buildEventAssessment, checkAssessmentInputs, topicsByDepartment } from '../src/jingshan/event-assessment.ts'
import { checkedSelection, itemDescription, sameSelection, selectedTopics } from '../src/jingshan/event-plan-selection.ts'
import { prepareTrafficProposals } from '../src/jingshan/event-traffic-proposals.ts'
import { assessmentProgress, assessmentStatus, assessmentVersion } from '../src/jingshan/event-workflow.ts'
import { readPublishedEventCatalog } from './event-platform.ts'
import { publishedEventCatalog } from '../src/jingshan/event-platform-data.ts'
import { createAssessmentExamples } from './event-sources/assessment-examples.ts'

function roadSignature(plan:EventAssessment){
  return createHash('sha256').update(JSON.stringify(plan.roads)).digest('hex')
}

async function surveyDraft(db:Pool|PoolClient,plan:EventAssessment){
  const roads=plan.position && plan.inputs.bufferM>0 ? await eventRoadSurfaces(db,plan.position,plan.inputs.bufferM) : []
  return prepareTrafficProposals(withSurveyRoads(plan,roads))
}

type TaskRow = { id: number; department: string; status: EventDepartmentFeedback['status'] }

function normalize(plan: EventAssessment) {
  plan.planVersion = assessmentVersion(plan)
  // Earlier all-task feedback was called completed without a platform closure.
  if (plan.status === 'completed' && !plan.completedAt) plan.status = plan.taskIds.length ? 'review' : 'draft'
  plan.timeline ??= [{ action: 'generated', at: plan.generatedAt, detail: '生成研判方案 V' + plan.planVersion }]
  return plan
}
function hydrateFeedback(plan: EventAssessment, tasks: TaskRow[]) {
  if (assessmentStatus(plan) === '已完结') return plan
  plan.feedback = plan.taskIds.map((taskId, index) => {
    const stored = plan.feedback?.find(item => item.taskId === taskId)
    const task = tasks.find(item => item.id === taskId && item.department === plan.departments[index])
    return { ...stored, taskId, department: plan.departments[index] ?? '无', status: task?.status ?? 'pending' }
  })
  return plan
}
async function lockPlan(client: PoolClient, eventId: string, revision: number, includeWithdrawn = false) {
  const { rows } = await client.query<{ plan: EventAssessment }>('SELECT plan FROM jingshan_event_assessments WHERE event_id=$1 FOR UPDATE', [eventId])
  const plan = rows[0]?.plan
  return plan && plan.revision === revision && (includeWithdrawn || !plan.withdrawnAt) ? normalize(plan) : undefined
}
async function lockTasks(client: PoolClient, plan: EventAssessment) {
  const { rows } = await client.query<TaskRow>('SELECT id,department,status FROM jingshan_results WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE', [plan.taskIds])
  return rows
}
async function savePlan(client: PoolClient, plan: EventAssessment) {
  await client.query('UPDATE jingshan_event_assessments SET plan=$2,revision=$3,updated_at=now() WHERE event_id=$1', [plan.eventId, JSON.stringify(plan), plan.revision])
}
async function assignResponsibilities(client: PoolClient, event: PlannedEvent, plan: EventAssessment) {
  const submittedAt = new Date().toISOString()
  const feedback: EventDepartmentFeedback[] = []
  for (const [department, topics] of topicsByDepartment(selectedTopics(plan.topics,plan.dispatchedItems))) {
    const names = topics.map(topic => topic.label).join('、')
    const summary = topics.map(topic => [topic.label, ...topic.items.map(item => item.title + ' · ' + itemDescription(item))].join('\n')).join('\n\n')
    const ids = new Set(topics.flatMap(topic => topic.items.map(item => item.featureId)))
    const features = [...plan.features, ...plan.roads].filter(f => f.id === event.id || ids.has(f.id))
    const saved = await client.query<{ id: number }>(`INSERT INTO jingshan_results(scene,title,department,summary,version,features)
      VALUES('events',$1,$2,$3,$4,$5) RETURNING id`, [
      `${event.name} · ${names} V${assessmentVersion(plan)}`.slice(0, 150), department, summary, plan.version, JSON.stringify(features),
    ])
    feedback.push({ taskId: saved.rows[0].id, department, status: 'pending' })
  }
  plan.status = 'review'
  plan.submittedAt = submittedAt
  plan.departments = feedback.map(item => item.department)
  plan.taskIds = feedback.map(item => item.taskId)
  plan.feedback = feedback
  plan.timeline!.push({ action: 'submitted', at: submittedAt, detail: `系统按专项分工向 ${feedback.length} 个责任部门分派任务` })
}
function validRevision(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2147483647 }

async function archiveVersion(client:PoolClient,plan:EventAssessment,event:PlannedEvent,operator:string,reason:string,replacedByVersion?:number) {
  plan.eventSnapshot ??= event
  const tasks=await lockTasks(client,plan)
  hydrateFeedback(plan,tasks)
  const unfinished=tasks.filter(task=> task.status!=='completed' && task.department===plan.departments[plan.taskIds.indexOf(task.id)])
  const cancelled=await client.query(`DELETE FROM jingshan_results WHERE scene='events'
    AND id=ANY($1::int[]) AND status IN ('pending','received') RETURNING *`,[unfinished.map(task=>task.id)])
  const stats=assessmentProgress(plan)
  plan.revision++
  plan.withdrawnAt=new Date().toISOString()
  const entry:AssessmentWithdrawal={
    eventId:plan.eventId, name:event.name, year:event.year, revision:plan.revision, planVersion:assessmentVersion(plan),
    withdrawnAt:plan.withdrawnAt,operator,reason,replacedByVersion,departmentCount:stats.total,feedbackCount:stats.completed,cancelledCount:cancelled.rows.length,
  }
  plan.timeline!.push({action:replacedByVersion?'superseded':'withdrawn',at:entry.withdrawnAt,
    detail:replacedByVersion?`${operator}推送 V${replacedByVersion}，本版反馈归档`:operator+'撤回方案 V'+entry.planVersion+(reason?'，'+reason:'')})
  await client.query('INSERT INTO jingshan_event_withdrawals(event_id,revision,entry,plan,cancelled_tasks) VALUES($1,$2,$3,$4,$5)',
    [plan.eventId,plan.revision,entry,plan,JSON.stringify(cancelled.rows)])
  return {entry,cancelledTaskIds:cancelled.rows.map(task=>task.id)}
}

export function eventPreassessmentRouter(pool: Pool) {
  const router = Router()
  const source = () => readPublishedEventCatalog(pool)
  let schema: Promise<unknown> | undefined
  const ready = () => schema ??= pool.query(`CREATE TABLE IF NOT EXISTS jingshan_event_assessments (
    event_id text PRIMARY KEY, revision integer NOT NULL CHECK(revision > 0), plan jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS jingshan_event_withdrawals (
    event_id text NOT NULL, revision integer NOT NULL, entry jsonb NOT NULL, plan jsonb NOT NULL,
    cancelled_tasks jsonb NOT NULL, PRIMARY KEY(event_id,revision)
  )`).catch(e => { schema = undefined; throw e })

  router.get('/', async (_req, res) => {
    await ready()
    const [catalog, plans] = await Promise.all([source(), pool.query<{ event_id: string; plan: EventAssessment | null; withdrawals: AssessmentWithdrawal[] }>(`
      SELECT a.event_id, CASE WHEN a.plan->>'withdrawnAt' IS NULL THEN a.plan END AS plan,
        ARRAY(SELECT w.entry FROM jingshan_event_withdrawals w WHERE w.event_id=a.event_id ORDER BY w.revision DESC) AS withdrawals
      FROM jingshan_event_assessments a`)])
    const assessments = Object.fromEntries(plans.rows.flatMap(row => row.plan ? [[row.event_id, normalize(row.plan)] as const] : []))
    const withdrawals = plans.rows.flatMap(row => row.withdrawals)
    const ids = Object.values(assessments).filter(plan => assessmentStatus(plan) !== '已完结').flatMap(plan => plan.taskIds)
    const tasks = ids.length ? (await pool.query<TaskRow>('SELECT id,department,status FROM jingshan_results WHERE id=ANY($1::int[])', [ids])).rows : []
    for (const plan of Object.values(assessments)) hydrateFeedback(plan, tasks)
    res.json({ ...catalog, assessments, examples:[], withdrawals })
  })
  router.get('/exercises',async (_req,res)=>{
    res.json({examples:createAssessmentExamples((await source()).events)})
  })

  router.put('/:id/assessment', async (req, res) => {
    await ready()
    const revision = req.body?.revision
    if (!Number.isSafeInteger(revision) || revision < 0) return res.status(400).json({ error: '方案版本无效' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query<{ published: DataDocument; version: number }>('SELECT published,version FROM jingshan_workspace WHERE id FOR SHARE')
      if (!rows[0]) { await client.query('ROLLBACK'); return res.status(409).json({ error: '请先加载平台已发布数据' }) }
      const { published, version } = rows[0]
      const event=publishedEventCatalog(published).events.find(e=>e.id===req.params.id)
      if (!event) {await client.query('ROLLBACK');return res.status(404).json({error:'已发布赛历中没有这项赛事'})}
      let inputs
      try { inputs=checkAssessmentInputs(req.body?.inputs,event) }
      catch(e) {await client.query('ROLLBACK');return res.status(400).json({error:(e as Error).message})}
      const previous = revision > 0 ? await lockPlan(client, event.id, revision, true) : undefined
      if (revision > 0 && !previous) { await client.query('ROLLBACK'); return res.status(409).json({ error: '方案已被另一窗口修改，请刷新后重试' }) }
      if (!event.assessment && !previous?.withdrawnAt) { await client.query('ROLLBACK'); return res.status(400).json({ error: '历史赛事不属于本次研判场景' }) }
      if (previous && !previous.withdrawnAt && (previous.status !== 'draft' || previous.completedAt || previous.taskIds.length)) {
        await client.query('ROLLBACK'); return res.status(409).json({ error: '已推送或已完结的方案已锁定，不能重新生成' })
      }
      const plan = buildEventAssessment(event, inputs, published.datasets, null, version, new Date().toISOString())
      plan.revision = revision + 1
      plan.planVersion = (previous ? assessmentVersion(previous) : 0) + 1
      plan.feedback = []
      plan.timeline = [...(previous?.withdrawnAt ? [] : previous?.timeline ?? []), { action: 'generated', at: plan.generatedAt, detail: '生成研判方案 V' + plan.planVersion }]
      if (revision === 0) {
        const saved = await client.query('INSERT INTO jingshan_event_assessments(event_id,revision,plan) VALUES($1,1,$2) ON CONFLICT DO NOTHING RETURNING event_id', [event.id, JSON.stringify(plan)])
        if (!saved.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: '方案已被另一窗口修改，请刷新后重试' }) }
      }
      await savePlan(client, plan)
      await client.query('COMMIT')
      res.json(plan)
    } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
  })

  router.get('/:id/traffic-preview', async(req,res)=>{
    await ready()
    const {rows}=await pool.query<{plan:EventAssessment}>('SELECT plan FROM jingshan_event_assessments WHERE event_id=$1',[req.params.id])
    const plan=rows[0]?.plan
    if(!plan || plan.withdrawnAt)return res.status(404).json({error:'未找到当前赛事方案'})
    if(!needsSurveyRoads(plan))return res.status(409).json({error:'方案已更新，请重新打开预案'})
    const fresh=await surveyDraft(pool,plan)
    res.set('Cache-Control','no-store').json({plan:fresh,signature:roadSignature(fresh)})
  })

  router.get('/:id/withdrawals/:revision', async (req, res) => {
    await ready()
    const revision = Number(req.params.revision)
    if (!validRevision(revision)) return res.status(400).json({ error: '撤回记录编号无效' })
    const { rows } = await pool.query('SELECT entry,plan FROM jingshan_event_withdrawals WHERE event_id=$1 AND revision=$2', [req.params.id, revision])
    if (!rows.length) return res.status(404).json({ error: '未找到该次撤回记录' })
    res.json(rows[0])
  })

  router.post('/:id/withdraw', async (req, res) => {
    await ready()
    const revision = req.body?.revision
    const reason = req.body?.reason ?? ''
    if (!validRevision(revision) || typeof reason !== 'string' || reason.length > 200 || reason.includes('\0')) {
      return res.status(400).json({ error: '请检查方案版本，撤回原因最多填写200字' })
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const plan = await lockPlan(client, req.params.id, revision)
      if (!plan || plan.example || plan.completedAt || !['draft','review'].includes(plan.status)) {
        await client.query('ROLLBACK'); return res.status(409).json({ error: '仅可撤回当前版本的处理中方案，请刷新台账核对' })
      }
      const event = plan.eventSnapshot ?? (await readPublishedEventCatalog(client)).events.find(e => e.id === plan.eventId)
      if (!event) { await client.query('ROLLBACK'); return res.status(409).json({ error: '缺少赛事资料，无法保存撤回记录' }) }
      const result=await archiveVersion(client,plan,event,res.locals.platformSession?.name??'本机工作区',reason.trim())
      await savePlan(client, plan)
      await client.query('COMMIT')
      res.json(result)
    } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
  })

  router.post('/:id/submit', async (req, res) => {
    await ready()
    const revision=req.body?.revision
    if (!validRevision(revision)) return res.status(400).json({ error: '请先生成研判方案，再按当前版本推送' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const previous=await lockPlan(client,req.params.id,revision)
      if (!previous || previous.completedAt || previous.status==='completed') {
        await client.query('ROLLBACK');return res.status(409).json({error:'方案已变更或已归档，请刷新后核对'})
      }
      const event=previous.eventSnapshot??(await readPublishedEventCatalog(client)).events.find(e=>e.id===req.params.id)
      if (!event) {await client.query('ROLLBACK');return res.status(404).json({error:'未找到方案对应的赛事资料'})}
      const replacing=previous.status==='review'
      const deferred=req.body.roadsDeferred===true
      if(deferred && (previous.roadBasis!==pendingRoadBasis || !needsSurveyRoads(previous) || previous.roads.length || req.body.roadSignature!==undefined)) {
        await client.query('ROLLBACK')
        return res.status(409).json({error:'当前方案的道路清单必须核对后再推送'})
      }
      const verifyRoads=needsSurveyRoads(previous) && !deferred
      const proposal=verifyRoads ? await surveyDraft(client,previous) : prepareTrafficProposals(previous)
      if(verifyRoads && req.body.roadSignature!==roadSignature(proposal)){
        await client.query('ROLLBACK')
        return res.status(409).json({error:'道路面资料已更新，请重新核对道路清单后推送'})
      }
      let selection
      try { selection=checkedSelection(proposal.topics,req.body.selection) }
      catch(e){await client.query('ROLLBACK');return res.status(400).json({error:(e as Error).message})}
      if (!selectedTopics(proposal.topics,selection).length) {await client.query('ROLLBACK');return res.status(400).json({error:'至少选择一个专项子项再推送'})}
      if (previous.dispatchedItems && sameSelection(selection,previous.dispatchedItems)) {
        await client.query('ROLLBACK');return res.status(409).json({error:'相同的勾选结果已经推送'})
      }
      const now=new Date().toISOString()
      const version=assessmentVersion(previous)+(replacing?1:0)
      const eventSnapshot=previous.example?event:(previous.eventSnapshot??event)
      const plan:EventAssessment={...proposal,planVersion:version,revision:revision+(replacing?2:1),dispatchedItems:selection,
        eventSnapshot,example:false,
        generatedAt:replacing||previous.example?now:previous.generatedAt,
        timeline:replacing||previous.example?[{action:'generated',at:now,detail:'确认专项子项并生成方案 V'+version}]:[...previous.timeline??[]]}
      if(replacing)await archiveVersion(client,previous,previous.eventSnapshot??event,res.locals.platformSession?.name??'本机工作区','专项子项重新确认',version)
      await assignResponsibilities(client,eventSnapshot,plan)
      await savePlan(client,plan)
      await client.query('COMMIT')
      res.json(plan)
    } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
  })

  router.post('/:id/feedback', async (req, res) => {
    await ready()
    const { revision, taskId, comment, disposition } = req.body ?? {}
    if (!validRevision(revision) || !Number.isSafeInteger(taskId) || taskId < 1 || taskId > 2147483647 ||
      typeof comment !== 'string' || !comment.trim() || comment.length > 2000 || comment.includes('\0') || !['adopted', 'noted'].includes(disposition)) {
      return res.status(400).json({ error: '请填写有效的部门反馈（1至2000字）和意见处理结果' })
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const plan = await lockPlan(client, req.params.id, revision)
      if (!plan) { await client.query('ROLLBACK'); return res.status(409).json({ error: '方案版本已变化，请刷新后重试' }) }
      if (plan.status !== 'review' || plan.completedAt || !plan.taskIds.includes(taskId)) {
        await client.query('ROLLBACK'); return res.status(409).json({ error: '仅能登记当前处理中方案关联部门的反馈' })
      }
      const tasks = await lockTasks(client, plan)
      const task = tasks.find(item => item.id === taskId && item.department === plan.departments[plan.taskIds.indexOf(taskId)])
      if (!task) { await client.query('ROLLBACK'); return res.status(409).json({ error: '关联部门任务不存在，请刷新核验' }) }
      // Local registration confirms received feedback; it does not send an external message.
      await client.query("UPDATE jingshan_results SET status='completed' WHERE id=$1", [taskId])
      task.status = 'completed'
      hydrateFeedback(plan, tasks)
      const item = plan.feedback!.find(item => item.taskId === taskId)!
      item.comment = comment.trim(); item.disposition = disposition; item.feedbackAt = new Date().toISOString()
      plan.timeline!.push({ action: 'feedback', at: item.feedbackAt, detail: item.department + '反馈已登记，' + (disposition === 'adopted' ? '意见已采纳' : '已阅并归档') })
      plan.revision++
      await savePlan(client, plan)
      await client.query('COMMIT')
      res.json(plan)
    } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
  })

  router.post('/:id/complete', async (req, res) => {
    await ready()
    if (!validRevision(req.body?.revision)) return res.status(400).json({ error: '方案版本无效' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const plan = await lockPlan(client, req.params.id, req.body.revision)
      if (!plan) { await client.query('ROLLBACK'); return res.status(409).json({ error: '方案版本已变化，请刷新后重试' }) }
      if (plan.status !== 'review' || plan.completedAt) { await client.query('ROLLBACK'); return res.status(409).json({ error: '仅已推送且尚未完结的方案可确认完结' }) }
      hydrateFeedback(plan, await lockTasks(client, plan))
      if (!assessmentProgress(plan).canComplete) { await client.query('ROLLBACK'); return res.status(409).json({ error: '所有接收部门反馈完成后，平台才能确认完结' }) }
      if (!plan.eventSnapshot) {
        const event = (await readPublishedEventCatalog(client)).events.find(item => item.id === plan.eventId)
        if (!event) { await client.query('ROLLBACK'); return res.status(409).json({ error: '赛事资料不存在，无法归档完整方案' }) }
        plan.eventSnapshot = structuredClone(event)
      }
      plan.status = 'completed'; plan.completedAt = new Date().toISOString(); plan.revision++
      plan.timeline!.push({ action: 'completed', at: plan.completedAt, detail: '平台确认完结，专项方案与部门反馈已锁定归档' })
      await savePlan(client, plan)
      await client.query('COMMIT')
      res.json(plan)
    } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
  })
  const roadServiceError:ErrorRequestHandler = (error,_req,res,next)=>{
    if (!(error instanceof CimError)) return next(error)
    res.status(error.status).json({error:error.status===502?'京山市道路面暂时无法读取，请稍后重试。':error.message})
  }
  router.use(roadServiceError)
  return router
}
