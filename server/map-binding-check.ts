import type { Pool } from 'pg'
import type { DataDocument } from '../src/jingshan/types.ts'
import type { CimService } from '../src/jingshan/cim-types.ts'
import { checkBindingServices, type MapBinding } from '../src/jingshan/map-bindings.ts'

type Database = Pick<Pool,'query'>

export async function validateBindingServices(db:Database, bindings: readonly MapBinding[] = [], lock = false) {
  const ids = [...new Set(bindings.flatMap(item => item.serviceId ? [item.serviceId] : []))]
  if (!ids.length) return
  const { rows } = await db.query<Pick<CimService,'id'|'kind'|'category'|'enabled'>>(
    'SELECT id, kind, category, enabled FROM jingshan_cim_services WHERE NOT deleted AND id = ANY($1::text[])' +
    (lock ? ' ORDER BY id FOR SHARE' : ''), [ids])
  try { checkBindingServices(bindings,rows) }
  catch (error) { throw Object.assign(error instanceof Error ? error : new Error('地图服务绑定无效'),{status:400}) }
}

export async function checkWorkspaceBindingRevision(db:Database, revision:number) {
  const result = await db.query<{draft:DataDocument}>(
    "SELECT draft FROM jingshan_workspace WHERE id AND revision=$1 FOR UPDATE", [revision])
  if (!result.rowCount) throw Object.assign(new Error('草稿已被修改，请重新载入后再发布'),{status:409})
  await validateBindingServices(db,result.rows[0].draft.mapBindings ?? [],true)
  return result.rows[0].draft
}
