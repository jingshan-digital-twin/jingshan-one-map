import type { Pool } from 'pg'
import { fusionArrivalsId } from '../src/jingshan/fusion-arrivals.ts'
import { fusionDestinationDataset, fusionDestinationsId } from '../src/jingshan/fusion-destinations.ts'
import type { DataDocument } from '../src/jingshan/types.ts'
import { checkDataset } from '../src/jingshan/validate.ts'
import { withEventResources } from './event-platform.ts'
import { withFusionArrivals } from './fusion-arrivals-source.ts'
import { withTourismPlaces } from './tourism-places-supplement.ts'
import { withTourismProviders } from './tourism-provider-supplement.ts'
import { withTourismCalendar } from './tourism-calendar-supplement.ts'

function withDestinations(doc:DataDocument):DataDocument {
  if (doc.datasets.some(d=>d.id===fusionDestinationsId)) return doc
  const destinations=fusionDestinationDataset()
  checkDataset(destinations)
  return {...doc,datasets:[...doc.datasets,destinations]}
}

function withTourismWorkbook(doc:DataDocument) {
  return withTourismCalendar(withTourismProviders(withTourismPlaces(doc)))
}

const resourceInstallers = new Map<string,(doc:DataDocument)=>DataDocument>([
  [fusionArrivalsId,withFusionArrivals],
  [fusionDestinationsId,withDestinations],
  [fusionDestinationsId + ':dongyong-mochou', doc => {
    const layer = doc.datasets.find(d => d.id === fusionDestinationsId)
    if (!layer) return doc
    const newIds = ['fusion-place-dongyong','fusion-place-mochou']
    const extra = fusionDestinationDataset().features.filter(f => newIds.includes(f.id) && !layer.features.some(saved => saved.id === f.id))
    if (!extra.length) return doc
    const next = {...layer, features: [...layer.features, ...extra]}
    return {...doc, datasets: doc.datasets.map(d => d === layer ? next : d)}
  }],
  ['tourism-workbook-20261120',withTourismWorkbook],
])

export async function initialPlatformResources(doc:DataDocument) {
  return withTourismWorkbook(withDestinations(withFusionArrivals(await withEventResources(doc))))
}

// Apply each installation once. Later deletions in either workspace stay authoritative.
export async function installPlatformResources(pool:Pool) {
  const db=await pool.connect()
  try {
    await db.query('BEGIN')
    await db.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('event-platform-install'))")
    await db.query('CREATE TABLE IF NOT EXISTS jingshan_event_installation (id boolean PRIMARY KEY CHECK(id), installed_at timestamptz NOT NULL DEFAULT now())')
    await db.query('CREATE TABLE IF NOT EXISTS jingshan_resource_installation (resource_id text PRIMARY KEY, installed_at timestamptz NOT NULL DEFAULT now())')
    const addEvents=!(await db.query('SELECT id FROM jingshan_event_installation WHERE id')).rowCount
    const installed=await db.query<{resource_id:string}>('SELECT resource_id FROM jingshan_resource_installation')
    const pending=new Map(resourceInstallers)
    for (const row of installed.rows) pending.delete(row.resource_id)
    if (addEvents || pending.size) {
      const {rows}=await db.query<{published:DataDocument;draft:DataDocument}>('SELECT published,draft FROM jingshan_workspace WHERE id FOR UPDATE')
      if (rows.length) {
        async function extend(doc:DataDocument) {
          let next=addEvents?await withEventResources(doc):doc
          for (const apply of pending.values()) next=apply(next)
          return next
        }
        const previous=rows[0], published=await extend(previous.published), draft=await extend(previous.draft)
        if (published!==previous.published) {
          await db.query(`WITH added AS (
            UPDATE jingshan_workspace SET published=$1,version=version+1,published_at=now() WHERE id
            RETURNING version,published,published_at
          ) INSERT INTO jingshan_publications(version,data,published_at) SELECT version,published,published_at FROM added`,[published])
        }
        if (draft!==previous.draft) await db.query('UPDATE jingshan_workspace SET draft=$1,revision=revision+1,updated_at=now() WHERE id',[draft])
        if (addEvents) await db.query('INSERT INTO jingshan_event_installation(id) VALUES(true)')
        for (const id of pending.keys()) await db.query('INSERT INTO jingshan_resource_installation(resource_id) VALUES($1)',[id])
      }
    }
    await db.query('COMMIT')
  } catch (e) {await db.query('ROLLBACK');throw e}
  finally {db.release()}
}
