import type { Pool, PoolClient } from 'pg'
import { withCourtLedger } from '../src/jingshan/court-ledger.ts'
import { checkDocument } from '../src/jingshan/validate.ts'
import type { DataWorkspace } from '../src/jingshan/types.ts'
import { checkWorkspaceBindingRevision } from './map-binding-check.ts'

export async function publishWorkspace(db: Pool | PoolClient, revision: number, reviewId?:number) {
  if ('release' in db) return publishLocked(db,revision,reviewId)
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const value = await publishLocked(client,revision,reviewId)
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

async function publishLocked(db:PoolClient, revision:number, reviewId?:number) {
  const document=withCourtLedger(await checkWorkspaceBindingRevision(db,revision))
  checkDocument(document)
  const {serviceRemovals=[],...draft}=document
  const pending=await db.query<{id:number}>("SELECT id FROM jingshan_platform_reviews WHERE revision=$1 AND state='pending'",[revision])
  if (pending.rowCount && pending.rows[0].id !== reviewId) throw Object.assign(new Error('此修订已提交审批，请在发布审批中处理'),{status:409})
  if (serviceRemovals.length) {
    const expected=new Map(serviceRemovals.map(row=>[row.id,row.revision]))
    const ids=[...expected.keys()]
    const current=await db.query<{id:string;name:string;revision:number}>(`SELECT id,name,revision FROM jingshan_cim_services
      WHERE id=ANY($1::text[]) AND NOT deleted ORDER BY id FOR UPDATE`,[ids])
    const changed=current.rows.find(s=>s.revision!==expected.get(s.id))
    if (changed) throw Object.assign(new Error('服务「'+changed.name+'」已更新，请在后台重新核对服务下线。'),{status:409})
    await db.query('UPDATE jingshan_cim_services SET deleted=true,revision=revision+1 WHERE id=ANY($1::text[]) AND NOT deleted',[current.rows.map(s=>s.id)])
  }
  const {rows}=await db.query<DataWorkspace>(`WITH changed AS (
    UPDATE jingshan_workspace SET draft=$2::jsonb,published=$2::jsonb,version=version+1,revision=revision+1,published_at=now(),updated_at=now()
    WHERE id AND revision=$1 RETURNING *
  ), history AS (
    INSERT INTO jingshan_publications(version,data,published_at) SELECT version,published,published_at FROM changed
  ) SELECT published AS data,draft,version,revision,published_at AS "publishedAt",updated_at AS "updatedAt" FROM changed`,[revision,JSON.stringify(draft)])
  return rows[0]
}

