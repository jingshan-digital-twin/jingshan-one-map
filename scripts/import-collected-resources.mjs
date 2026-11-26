import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import pg from 'pg'
import { readCollectedResources, withCollectedResources } from '../server/collected-resources.ts'
import { legacyPopulationGridId, populationGridId } from '../src/jingshan/population-grid.ts'
import { isCourtLedgerId,courtMapSlot } from '../src/jingshan/court-ledger.ts'
import { registerHostedLayer } from '../server/hosted-layers.ts'

// node --env-file=.env scripts/import-collected-resources.mjs [--layer=dataset_id] [local-contact-file.json]
const {values, positionals} = parseArgs({ options: {layer: {type:'string'}}, allowPositionals:true })
const contacts = positionals[0] ? JSON.parse(await readFile(positionals[0], 'utf8')) : {}
if (!contacts || Array.isArray(contacts) || typeof contacts !== 'object' ||
    Object.entries(contacts).some(([key,value]) => !/^js-shelter-\d+$/.test(key) || typeof value !== 'string')) {
  throw new Error('请按避难场所编号填写本地联系人')
}
const sources = await readCollectedResources()
const pack = values.layer === undefined ? sources : sources.filter(dataset => dataset.id === values.layer)
if (!pack.length) throw new Error('采集包中没有该图层：' + values.layer)
const client = new pg.Client()
await client.connect()
try {
  await client.query('BEGIN')
  const {rows:[current]} = await client.query('SELECT published, draft, version FROM jingshan_workspace WHERE id FOR UPDATE')
  if (!current) throw new Error('请先启动项目以初始化数据工作区')
  const population=pack.find(d=>d.id===populationGridId)
  if(population && current.published.datasets.some(d=>d.id===legacyPopulationGridId)){
    const prior=await client.query("SELECT 1 FROM jingshan_cim_services WHERE id=$1 AND url=$2 AND NOT deleted",
      ['hosted-'+legacyPopulationGridId,'/api/jingshan/layers/'+legacyPopulationGridId+'/features.geojson'])
    if(prior.rowCount)await registerHostedLayer(client,population)
  }
  const ledger=pack.find(d=>isCourtLedgerId(d.id))
  if(ledger) await registerHostedLayer(client,current.published.datasets.find(d=>d.id===ledger.id) ?? ledger)
  const migrate = source => {
    const collected=withCollectedResources(source,pack,contacts)
    if(!ledger || collected.mapBindings?.some(b=>b.scope==='all' && b.slot===courtMapSlot)) return collected
    return {...collected,mapBindings:[...(collected.mapBindings??[]),{scope:'all',slot:courtMapSlot,serviceId:'hosted-'+ledger.id}]}
  }
  const published = migrate(current.published)
  const draft = migrate(current.draft)
  let version = current.version
  if (current.published !== published) {
    const result = await client.query(`
      UPDATE jingshan_workspace SET published=$1, version=version+1, published_at=now() WHERE id
      RETURNING version, published_at`, [published])
    version = result.rows[0].version
    await client.query('INSERT INTO jingshan_publications(version,data,published_at) VALUES ($1,$2,$3)',
      [version,published,result.rows[0].published_at])
  }
  if (current.draft !== draft) {
    await client.query('UPDATE jingshan_workspace SET draft=$1, revision=revision+1, updated_at=now() WHERE id', [draft])
  }
  await client.query('COMMIT')
  console.log('已核对采集台账，当前发布版本 V' + version)
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
