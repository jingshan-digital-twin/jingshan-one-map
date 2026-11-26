import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Response } from 'express'
import { populationRaster, rasterGeoJsonChunks } from '../src/jingshan/population-raster.ts'
import type { Pool, PoolClient } from 'pg'
import type { Dataset } from '../src/jingshan/types.ts'
import { isPlatformFormDataset } from '../src/jingshan/platform-forms.ts'
import { publicResourceData } from './collected-resources.ts'
import { CimError } from './cim-error.ts'

export function hostedLayerPath(id:string) { return '/api/jingshan/layers/' + id + '/features.geojson' }
export function hostedSource(id:string,url:string) {
  const source = /^hosted-([a-z][a-z0-9_-]{0,71})$/.exec(id)?.[1]
  return source && url===hostedLayerPath(source) ? source : undefined
}
// A hosted registration is available exactly while its source exists in the published version.
// Keep its configuration for a subsequent version restore.
export const availableServiceSql = `(s.id NOT LIKE 'hosted-%' OR s.url <> ('/api/jingshan/layers/' || substr(s.id,8) || '/features.geojson')
  OR EXISTS (SELECT 1 FROM jingshan_workspace w CROSS JOIN LATERAL jsonb_array_elements(w.published->'datasets') d
    WHERE w.id AND d->>'id'=substr(s.id,8)))`

export async function publishedLayer(db:Pool|PoolClient, id:string, lock=false, initialize?:()=>Promise<unknown>) {
  const select=()=>db.query<{version:number;dataset:Dataset|null}>(`SELECT version,
    (SELECT d FROM jsonb_array_elements(published->'datasets') d WHERE d->>'id'=$1) AS dataset
    FROM jingshan_workspace WHERE id`+(lock?' FOR SHARE':''),[id])
  let result=await select()
  if(!result.rowCount && initialize){await initialize();result=await select()}
  const row=result.rows[0]
  if (!row?.dataset) throw new CimError('图层尚未发布或已移除',404)
  const dataset=publicResourceData({mode:'live',rules:{},datasets:[row.dataset]}).datasets[0]
  return {version:row.version,dataset,collection:{type:'FeatureCollection' as const,name:dataset.name,features:dataset.features}}
}
export async function sendPublishedFeatures(res:Response, layer:Awaited<ReturnType<typeof publishedLayer>>){
  const raster=populationRaster(layer.dataset)
  res.set('X-Publication-Version',String(layer.version)).type('application/geo+json')
  if(!raster){res.send(JSON.stringify(layer.collection));return}
  await pipeline(Readable.from(rasterGeoJsonChunks(raster,layer.dataset.name)),res)
}
export async function registerHostedLayer(db:Pool|PoolClient,dataset:Dataset) {
  const serviceId='hosted-'+dataset.id
  await db.query(`INSERT INTO jingshan_cim_services(id,name,category,kind,url,description,enabled,default_visible,status,checked_at)
    VALUES ($1,$2,$3,'geojson',$4,$5,true,false,'online',now())
    ON CONFLICT (id) DO UPDATE SET deleted=false,enabled=true,status='online',status_message='',checked_at=now(),
      revision=jingshan_cim_services.revision+1 WHERE jingshan_cim_services.deleted`,
    [serviceId,dataset.name,dataset.category,hostedLayerPath(dataset.id),dataset.description])
  return serviceId
}
export async function publishHostedLayer(pool:Pool,id:string) {
  const client=await pool.connect()
  try {
    await client.query('BEGIN')
    const {dataset}=await publishedLayer(client,id,true)
    if(isPlatformFormDataset(dataset) || dataset.derivedFrom) throw new CimError('请选择已发布的源空间数据集',400)
    const serviceId=await registerHostedLayer(client,dataset)
    await client.query('COMMIT')
    return serviceId
  } catch(error) {
    await client.query('ROLLBACK')
    throw error
  } finally {client.release()}
}
