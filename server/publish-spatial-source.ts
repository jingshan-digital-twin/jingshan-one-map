import type { Pool } from 'pg'
import type { DataDocument, DataWorkspace } from '../src/jingshan/types.ts'
import { withCourtLedger } from '../src/jingshan/court-ledger.ts'
import { checkDocument } from '../src/jingshan/validate.ts'
import { isPlatformFormDataset } from '../src/jingshan/platform-forms.ts'
import { registerHostedLayer } from './hosted-layers.ts'
import { CimError } from './cim-error.ts'

export function publishSourceDocument(published:DataDocument,draft:DataDocument,id:string){
  const source=draft.datasets.find(d=>d.id===id)
  if(!source || source.derivedFrom || isPlatformFormDataset(source))throw new CimError('请选择现存的源空间数据集。',400)
  if(draft.serviceRemovals?.some(s=>s.id==='hosted-'+id))throw new CimError('该服务已在草稿中标记下线，请先处理下线操作。',409)
  const exists=published.datasets.some(d=>d.id===id)
  const data=withCourtLedger({...published,datasets:exists?published.datasets.map(d=>d.id===id?source:d):[...published.datasets,source]})
  checkDocument(data)
  return {source,data}
}

export async function publishSpatialSource(pool:Pool,id:string,revision:number){
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    const locked=await client.query<{published:DataDocument;draft:DataDocument}>('SELECT published,draft FROM jingshan_workspace WHERE id AND revision=$1 FOR UPDATE',[revision])
    if(!locked.rowCount)throw new CimError('草稿版本已更新，请重新载入后再发布。',409)
    const pending=await client.query("SELECT 1 FROM jingshan_platform_reviews WHERE revision=$1 AND state='pending'",[revision])
    if(pending.rowCount)throw new CimError('此修订已提交审批，请在发布审批中处理。',409)
    const {published,draft}=locked.rows[0]
    const {source,data}=publishSourceDocument(published,draft,id)
    const serviceId=await registerHostedLayer(client,source)
    const previous=published.datasets.find(d=>d.id===id)
    if(previous && (previous.name!==source.name || previous.category!==source.category || previous.description!==source.description)){
      // Follow changed source metadata only on fields the service administrator has kept in sync.
      await client.query(`UPDATE jingshan_cim_services SET
        name=CASE WHEN name=$2 THEN $3 ELSE name END,
        category=CASE WHEN category=$4 THEN $5 ELSE category END,
        description=CASE WHEN description=$6 THEN $7 ELSE description END, revision=revision+1
        WHERE id=$1 AND ((name=$2 AND name<>$3) OR (category=$4 AND category<>$5) OR (description=$6 AND description<>$7))`,
        [serviceId,previous.name,source.name,previous.category,source.category,previous.description,source.description])
    }
    const {rows}=await client.query<DataWorkspace>(`WITH changed AS (
      UPDATE jingshan_workspace SET published=$1::jsonb,version=version+1,revision=revision+1,published_at=now(),updated_at=now() WHERE id RETURNING *
    ), history AS (
      INSERT INTO jingshan_publications(version,data,published_at) SELECT version,published,published_at FROM changed
    ) SELECT published AS data,draft,version,revision,published_at AS "publishedAt",updated_at AS "updatedAt" FROM changed`,[JSON.stringify(data)])
    await client.query('COMMIT')
    return {workspace:rows[0],serviceId}
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
