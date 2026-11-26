import { Router } from 'express'
import type { Pool } from 'pg'
import { roleTitles, type PlatformSession } from '../src/jingshan/platform-roles.ts'
import { passwordDigest } from './platform-identity.ts'
import { publishWorkspace } from './platform-publication.ts'

export function platformGovernance(pool: Pool) {
  const router = Router()
  router.get('/session', (_req, res) => res.json(res.locals.platformSession))
  router.get('/users', async (_req, res) => {
    const { rows } = await pool.query(
      'SELECT name,role,enabled,department FROM jingshan_platform_users ORDER BY name',
    )
    res.json(rows)
  })
  router.post('/users', async (req, res) => {
    const session = res.locals.platformSession as PlatformSession
    if (!session.authenticated) return res.status(403).json({ error: '请在启用账号认证的部署中管理账号' })
    const { name, password, department, role } = req.body ?? {}
    if (
      typeof name !== 'string' ||
      !/^[\p{L}\p{N}_.-]{1,60}$/u.test(name) ||
      name === (process.env.APP_USER ?? 'admin') ||
      typeof password !== 'string' ||
      password.length < 12 ||
      password.length > 128 ||
      typeof department !== 'string' ||
      department.length > 100 ||
      !Object.hasOwn(roleTitles, role)
    )
      return res.status(400).json({ error: '请检查用户名、角色和密码（12 至 128 位）' })
    const result = await pool.query(
      `WITH created AS (INSERT INTO jingshan_platform_users(name,digest,department,role)
      VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING name)
      INSERT INTO jingshan_activity(area,action,resource,detail) SELECT '账号管理','创建账号',name,$5 FROM created RETURNING id`,
      [name, await passwordDigest(password), department, role, session.name],
    )
    if (!result.rowCount) return res.status(409).json({ error: '用户名已存在' })
    return res.status(201).json({ ok: true })
  })
  router.patch('/users/:name', async (req, res) => {
    const session = res.locals.platformSession as PlatformSession
    const { role, enabled } = req.body ?? {}
    if (!session.authenticated || req.params.name === session.name)
      return res.status(403).json({ error: '此账号不能在当前会话中修改' })
    if (!Object.hasOwn(roleTitles, role) || typeof enabled !== 'boolean')
      return res.status(400).json({ error: '角色或状态无效' })
    const r = await pool.query(
      `WITH changed AS (UPDATE jingshan_platform_users SET role=$2,enabled=$3 WHERE name=$1 RETURNING name)
      INSERT INTO jingshan_activity(area,action,resource,detail) SELECT '账号管理','调整权限',name,$4 FROM changed RETURNING id`,
      [req.params.name, role, enabled, session.name],
    )
    return r.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: '账号不存在' })
  })
  router.get('/operations', async (_req, res) => {
    const r = await pool.query(`SELECT pg_database_size(current_database())::float8 AS bytes,
      (SELECT count(*)::int FROM jingshan_publications) AS versions,
      (SELECT count(*)::int FROM jingshan_activity) AS changes,
      (SELECT count(*)::int FROM jingshan_platform_reviews WHERE state='pending') AS pending`)
    res.json(r.rows[0])
  })
  router.get('/reviews', async (req, res) => {
    const before = req.query.before === undefined ? null : Number(req.query.before)
    if (before !== null && (!Number.isInteger(before) || before < 1 || before > 2147483647))
      return res.status(400).json({ error: '分页位置无效' })
    const { rows } = await pool.query(
      'SELECT * FROM jingshan_platform_reviews WHERE ($1::int IS NULL OR id<$1) ORDER BY id DESC LIMIT 26',
      [before],
    )
    res.json({ items: rows.slice(0, 25), more: rows.length > 25 })
  })
  router.post('/reviews', async (req, res) => {
    const { revision, note } = req.body ?? {}
    if (!Number.isInteger(revision) || typeof note !== 'string' || !note.trim() || note.length > 500)
      return res.status(400).json({ error: '请填写 1 至 500 字的发布说明' })
    const r = await pool.query(
      `WITH current_draft AS (
      SELECT revision FROM jingshan_workspace WHERE id AND revision=$1 AND published IS DISTINCT FROM draft FOR SHARE
    ) INSERT INTO jingshan_platform_reviews(revision,note,applicant)
      SELECT revision,$2,$3 FROM current_draft ON CONFLICT DO NOTHING RETURNING id`,
      [revision, note.trim(), res.locals.platformSession.name],
    )
    return r.rowCount
      ? res.status(201).json(r.rows[0])
      : res.status(409).json({ error: '请确认草稿有待发布变更、修订号有效且没有重复申请' })
  })
  router.post('/reviews/:id/decision', async (req, res) => {
    const { state, opinion } = req.body ?? {},
      id = Number(req.params.id),
      session = res.locals.platformSession as PlatformSession
    if (
      !Number.isInteger(id) ||
      id < 1 ||
      id > 2147483647 ||
      !['approved', 'rejected'].includes(state) ||
      typeof opinion !== 'string' ||
      opinion.length > 500 ||
      (state === 'rejected' && !opinion.trim())
    )
      return res.status(400).json({ error: '请检查审批决定，退回申请时须填写原因' })
    const db = await pool.connect()
    try {
      await db.query('BEGIN')
      const row = (await db.query('SELECT * FROM jingshan_platform_reviews WHERE id=$1 FOR UPDATE', [id]))
        .rows[0]
      if (!row || row.state !== 'pending') {
        await db.query('ROLLBACK')
        return res.status(409).json({ error: '申请不存在或已处理' })
      }
      if (session.authenticated && row.applicant === session.name) {
        await db.query('ROLLBACK')
        return res.status(403).json({ error: '请由另一位审批人处理本人提交的申请' })
      }
      const publication = state === 'approved' ? await publishWorkspace(db, row.revision, id) : undefined
      if (state === 'approved' && !publication) {
        await db.query('ROLLBACK')
        return res.status(409).json({ error: '申请所对应的草稿已更新，请退回后重新提交' })
      }
      await db.query(
        'UPDATE jingshan_platform_reviews SET state=$2,opinion=$3,reviewer=$4,finished=now(),version=$5 WHERE id=$1',
        [id, state, opinion.trim(), session.name, publication?.version ?? null],
      )
      await db.query("INSERT INTO jingshan_activity(area,action,resource,detail) VALUES('发布审批',$1,$2,$3)", [
        state === 'approved' ? '审批发布' : '退回申请',
        'R' + row.revision,
        session.name + ' ' + opinion.trim(),
      ])
      await db.query('COMMIT')
      return res.json({ version: publication?.version })
    } catch (error) {
      await db.query('ROLLBACK')
      if (error instanceof Error && 'status' in error && (error.status === 409 || error.status === 400)) {
        return res
          .status(error.status)
          .json({ error: error.status === 409 ? '申请对应的草稿已更新，请退回后重新提交' : error.message })
      }
      throw error
    } finally {
      db.release()
    }
  })
  return router
}
