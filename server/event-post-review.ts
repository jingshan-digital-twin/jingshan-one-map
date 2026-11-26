import { Router, type RequestHandler } from 'express'
import type { Pool, PoolClient } from 'pg'
import { buildEventReview, type ArchivedReview, type ReuseTarget, type ReviewState } from '../src/jingshan/event-post-review.ts'
import type { DataDocument } from '../src/jingshan/types.ts'
import { eventReviewDocument } from '../src/jingshan/event-platform-data.ts'
import { readPublishedEventCatalog } from './event-platform.ts'

async function state(db: Pool | PoolClient, id: string): Promise<ReviewState> {
  const { rows } = await db.query<ArchivedReview & { reused: ReuseTarget[] }>(`
    SELECT snapshot AS review, version, revision, generated_at AS "generatedAt", archived_at AS "archivedAt", selected_issues AS "selectedIssues",
      COALESCE((SELECT json_agg(json_build_object('id',target_id,'name',name,'start',start_date) ORDER BY start_date,target_id)
        FROM jingshan_event_review_uses WHERE event_id=$1), '[]') AS reused FROM jingshan_event_reviews WHERE event_id=$1`, [id])
  if (!rows[0]) return { report: null, reused: [] }
  const { reused, ...report } = rows[0]
  return { report, reused }
}
async function targets(db:Pool|PoolClient): Promise<ReuseTarget[]> {
  const catalog = await readPublishedEventCatalog(db)
  return catalog.events.filter(e => e.assessment && e.startDate).map(e => ({ id: e.id, name: e.name, start: e.startDate! }))
    .sort((a,b) => a.start.localeCompare(b.start))
}
function reject(status: number, message: string): never { throw Object.assign(new Error(message), { status }) }

export function eventPostReviewRouter(pool: Pool) {
  const router = Router()
  let schema: Promise<unknown> | undefined
  router.use(async (_req, _res, next) => {
    schema ??= pool.query(`CREATE TABLE IF NOT EXISTS jingshan_event_reviews (
      event_id text PRIMARY KEY, snapshot jsonb NOT NULL, version integer NOT NULL, revision integer NOT NULL DEFAULT 1,
      selected_issues text[] NOT NULL, generated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz
    ); CREATE TABLE IF NOT EXISTS jingshan_event_review_uses (
      event_id text NOT NULL REFERENCES jingshan_event_reviews(event_id), target_id text NOT NULL, name text NOT NULL,
      start_date text NOT NULL, PRIMARY KEY(event_id,target_id)
    )`).catch(error => { schema = undefined; throw error })
    await schema
    next()
  })
  router.get('/', async (_req,res) => {
    const archives = (await pool.query(`SELECT event_id AS id,snapshot->>'name' AS name,snapshot->>'start' AS start,
      snapshot->>'region' AS region FROM jingshan_event_reviews WHERE archived_at IS NOT NULL ORDER BY generated_at DESC`)).rows
    res.json({ archives, targets: await targets(pool) })
  })
  router.get('/for-plan/:id', async (req,res) => {
    const { rows } = await pool.query<Pick<ArchivedReview, 'review' | 'selectedIssues'>>(`SELECT r.snapshot AS review, r.selected_issues AS "selectedIssues"
      FROM jingshan_event_review_uses u JOIN jingshan_event_reviews r USING(event_id)
      WHERE u.target_id=$1 AND r.archived_at IS NOT NULL ORDER BY r.archived_at DESC,r.event_id`, [req.params.id])
    res.json(rows.map(({ review, selectedIssues }) => ({ id: review.id, name: review.name, sample: review.sample,
      issues: review.issues.filter(i => selectedIssues.includes(i.id)), template: review.assets[0].rows })))
  })
  router.get('/:id', async (req,res) => { res.json(await state(pool, req.params.id)) })
  const change = (operation: (db: PoolClient, id: string, body: Record<string,unknown>, current: ArchivedReview | null) => Promise<void>): RequestHandler =>
    async (req,res) => {
      const id = String(req.params.id)
      const body = req.body ?? {}
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) return res.status(400).json({ error: '报告修订号无效' })
      const db = await pool.connect()
      try {
        await db.query('BEGIN')
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['event-post-review:' + id])
        const { report } = await state(db, id)
        await operation(db, id, body, report)
        const result = await state(db, id)
        await db.query('COMMIT')
        res.json(result)
      } catch (error) {
        await db.query('ROLLBACK')
        const status = (error as { status?: number }).status
        if (status) res.status(status).json({ error: (error as Error).message })
        else throw error
      } finally { db.release() }
    }
  router.put('/:id/report', change(async (db, id, body, current) => {
    if (current?.archivedAt) reject(409, '报告已归档，请打开归档版本')
    const publication = (await db.query<{ published: DataDocument; version: number }>('SELECT published, version FROM jingshan_workspace WHERE id FOR SHARE')).rows[0]
    if (!publication || publication.version !== body.version) reject(409, '平台数据已更新，请刷新后生成报告')
    const review = buildEventReview(eventReviewDocument(publication.published), id)
    if (!review) reject(404, '未找到这场已办赛事')
    const picks = body.selectedIssues
    if (!Array.isArray(picks) || picks.some(id => !review.issues.some(i => i.id === id))) reject(400, '改进事项与这场赛事不符')
    const selected = review.issues.map(i => i.id).filter(id => picks.includes(id))
    if (current?.version === publication.version && current.review.formatVersion === review.formatVersion
      && JSON.stringify(current.selectedIssues) === JSON.stringify(selected)) return
    if ((current?.revision ?? 0) !== body.revision) reject(409, '报告已在其他窗口更新，请重新载入')
    await db.query(`INSERT INTO jingshan_event_reviews(event_id,snapshot,version,selected_issues) VALUES($1,$2,$3,$4)
      ON CONFLICT(event_id) DO UPDATE SET snapshot=EXCLUDED.snapshot,version=EXCLUDED.version,
      selected_issues=EXCLUDED.selected_issues,revision=jingshan_event_reviews.revision+1,generated_at=now()`,
      [id, JSON.stringify(review), publication.version, selected])
  }))
  router.post('/:id/archive', change(async (db, id, body, current) => {
    if (!current || current.revision !== body.revision) reject(409, '请重新核对要归档的报告版本')
    if (body.targetId !== null && body.targetId !== undefined) {
      if (!current.selectedIssues.length && !current.review.assets[0]?.rows.length) reject(400, '本报告暂无可复用的保障模板或改进事项')
      const target = (await targets(db)).find(e => e.id === body.targetId && e.start > current.review.end && e.id !== id)
      if (!target) reject(400, '请选择赛期在本场赛事之后的赛事计划')
      await db.query(`INSERT INTO jingshan_event_review_uses(event_id,target_id,name,start_date)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [id,target.id,target.name,target.start])
    }
    await db.query('UPDATE jingshan_event_reviews SET archived_at=COALESCE(archived_at, now()) WHERE event_id=$1', [id])
  }))
  return router
}
