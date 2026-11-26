import {readFile} from 'node:fs/promises'
import type {Pool,PoolClient} from 'pg'
import {eventPlanDatasetId,makeEventPlanDataset,publishedEventCatalog} from '../src/jingshan/event-platform-data.ts'
import {eventMonitoringDatasets} from './event-monitor-seed.ts'
import type {DataDocument,Dataset} from '../src/jingshan/types.ts'
import {checkDocument} from '../src/jingshan/validate.ts'

export async function readPublishedEventCatalog(db:Pool|PoolClient) {
  const {rows}=await db.query<{dataset:Dataset}>(`SELECT item AS dataset
    FROM jingshan_workspace, jsonb_array_elements(published->'datasets') item
    WHERE id AND item->>'id'=$1`,[eventPlanDatasetId])
  return publishedEventCatalog({datasets:rows.map(r=>r.dataset)})
}

let seedResource:Promise<Dataset>|undefined
export async function withEventResources(doc:DataDocument) {
  const datasets=doc.datasets.slice()
  if (!datasets.some(d=>d.id===eventPlanDatasetId)) {
    seedResource??=readFile(new URL('./event-sources/events.json',import.meta.url),'utf8')
      .then(text=>makeEventPlanDataset(JSON.parse(text))).catch(error=>{seedResource=undefined;throw error})
    datasets.push(await seedResource)
  }
  const {events}=publishedEventCatalog({datasets})
  for (const layer of eventMonitoringDatasets(events,datasets)) {
    if (!datasets.some(d=>d.id===layer.id)) datasets.push(layer)
  }
  if(datasets.length===doc.datasets.length)return doc
  const next={...doc,datasets}
  checkDocument(next)
  return next
}

