import { readFile } from 'node:fs/promises'
import { Router, json } from 'express'
import { platformFormTemplates } from '../src/jingshan/platform-forms.ts'
import { publishedCatalog, type PortalCatalog } from '../src/jingshan/portal-catalog.ts'
import { publishWorkspace } from './platform-publication.ts'
import { platformGovernance } from './platform-governance.ts'
import { populationGridId,legacyPopulationGridId } from '../src/jingshan/population-grid.ts'
import { exportPopulationAttributes } from './population-attribute-export.ts'
import type { Pool } from 'pg'
import { checkDocument, checkFeature } from '../src/jingshan/validate.ts'
import { activeCourtSource, activeCourtSourceId, boundCourtSource, courtMapSlot, courtViewIds, isCourtLedgerId, surveyCourtLedgerId, withCourtLedger } from '../src/jingshan/court-ledger.ts'
import { publishSpatialSource } from './publish-spatial-source.ts'
import { sendShapefile } from './spatial-shapefile.ts'
import { investmentRecords } from './investment-records.ts'
import { pointsForRecord } from '../src/jingshan/investment-selection.ts'
import { reserveLayerId, surveyReferenceLayerId } from '../src/jingshan/investment-planning.ts'
import { availableServiceSql, publishedLayer, registerHostedLayer, sendPublishedFeatures } from './hosted-layers.ts'
import { CimError } from './cim-error.ts'
import { coverage, eventAssistance, industry, siteSelection, talent, tourism } from '../src/jingshan/analytics.ts'
import type { CityFeature, DataDocument, DataWorkspace, Dataset, Result } from '../src/jingshan/types.ts'
import { withEnterpriseDirectory } from './industry-registry.ts'
import { publicResourceData, readCollectedResources, withCollectedResources } from './collected-resources.ts'
import { createCityOutputEstimateDataset } from './industry-output-estimate.ts'
import { cimRouter, fetchCimFeatures, getCimService } from './cim.ts'
import { updateCimDataset } from './cim-datasets.ts'
import { cimDatasetBindings, cimBoundaryBindings } from '../src/jingshan/cim-datasets.ts'
import { fetchCimAdministration } from './cim-boundaries.ts'
import { fetchCimCommunities } from './cim-communities.ts'
import { venueOpeningRouter } from './venue-opening.ts'
import { venueReservationsHandler } from './venue-reservations.ts'
import { checkDatasetRemovals } from '../src/jingshan/resource-removal.ts'
import { checkChangedFormRecords } from './platform-form-check.ts'
import { validateBindingServices } from './map-binding-check.ts'
import { initialPlatformResources, installPlatformResources } from './install-platform-resources.ts'
import { eventPreassessmentRouter } from './event-preassessment.ts'
import { eventLiveRouter } from './event-live.ts'
import { roadSurfaceHandler } from './event-road-surfaces.ts'
import { eventPostReviewRouter } from './event-post-review.ts'

const sceneNames = new Set(['overview', 'venues', 'events', 'tourism', 'industry', 'talent', 'investment', 'liveEvent', 'consumption', 'merchants'])
const workspaceFields = 'published AS data, draft, version, revision, published_at AS "publishedAt", updated_at AS "updatedAt"'
const resultSummaryFields = 'id, scene, title, department, summary, status, created_at AS "createdAt", version'
const resultFields = resultSummaryFields + ', features'
type ResultInput = Pick<Result, 'scene' | 'title' | 'department' | 'summary' | 'features'>

async function readDemo(file: 'demo-data.json' | 'demo-data-v3.json'): Promise<DataDocument> {
  const [source, boundarySource] = await Promise.all([
    readFile(new URL('../public/jingshan/' + file, import.meta.url), 'utf8'),
    readFile(new URL('../public/jingshan/administration.json', import.meta.url), 'utf8'),
  ])
  const data: DataDocument = { mode: 'demo', rules: {}, ...JSON.parse(source) }
  data.datasets.unshift({
    id: 'administration', name: '行政区划', department: '基础地理', category: '基础地理',
    description: '京山市市界与公开乡镇边界。正式应用可用本地权威数据替换。',
    features: JSON.parse(boundarySource).features,
  })
  if (file === 'demo-data-v3.json' && !data.datasets.some(dataset => dataset.id === 'industry_output')) {
    data.datasets.push(createCityOutputEstimateDataset())
  }
  checkDocument(data)
  return data
}

async function initialWorkspaceData(demo: DataDocument) {
  const [sources,directory] = await Promise.all([readCollectedResources(),withEnterpriseDirectory(demo)])
  const data=withCollectedResources(directory,sources)
  return initialPlatformResources(withCourtLedger({...data,mapBindings:[{scope:'all',slot:courtMapSlot,serviceId:'hosted-'+surveyCourtLedgerId}]}))
}

function checkedResult(value: unknown): ResultInput {
  if (!value || typeof value !== 'object') throw new Error('成果内容不完整')
  const { scene, title, department, summary, features } = value as ResultInput
  if (!sceneNames.has(scene) || !Array.isArray(features) || features.length > 300 ||
      ![title, department, summary].every(text => typeof text === 'string' && text.trim() && !text.includes('\0')) ||
      title.length > 150 || department.length > 100 || summary.length > 10000) {
    throw new Error('成果内容不完整或超过大小限制')
  }
  features.forEach((feature, index) => checkFeature(feature, '成果第 ' + (index + 1) + ' 条'))
  return { scene, title: title.trim(), department: department.trim(), summary: summary.trim(), features }
}

function sampleResults(snapshot: DataWorkspace) {
  const { datasets, rules } = snapshot.data
  const cover = coverage(datasets, {}, rules)
  const sites = siteSelection(datasets, cover, {}, rules)
  const event = eventAssistance(datasets, undefined, undefined, rules)
  const travel = tourism(datasets, 'event-20261012-open')
  const chain = industry(datasets)
  const youth = talent(datasets, undefined, rules)
  const make = (scene: Result['scene'], title: string, department: string, status: Result['status'],
    text: string, features: CityFeature[]) => ({ scene, title, department, status, summary: '# ' + title + '\n\n演示数据 V1\n\n' + text, features: features.slice(0, 300) })
  return [
    make('venues', '服务覆盖诊断', '政数局', 'completed', '近似步行覆盖率 ' + cover.coveredRate + '%。', cover.overlays),
    make('venues', '服务盲区清单', '教育局', 'completed', '当前识别 ' + cover.blindAreas.length + ' 个未覆盖网格。', cover.blindAreas.map(item => item.feature)),
    make('venues', '推荐地块用地核查', '自然资源和规划局', 'received', '当前通过初筛 ' + sites.candidates.filter(item => item.compliant).length + ' 块。', sites.candidates.filter(item => item.compliant).map(item => item.feature)),
    make('events', '赛事交通与住宿保障', '公安交警', 'pending', '预计 ' + event.attendance + ' 人。当前停车缺口 ' + event.parkingGap + ' 个、床位缺口 ' + event.lodgingGap + ' 张。', event.overlays),
    make('tourism', '京山网球公开赛效益', '文旅局', 'completed', '赛事带动消费 ' + travel.spend + ' 万元，景区转化率 ' + travel.conversion + '%。', travel.overlays),
    make('industry', '网球产业补链建议', '商务局', 'received', '产业相关主体 ' + chain.total + ' 家。建议核实器材零售维修、运动康复供给。', chain.projects),
    make('talent', '网球进校园建议', '教育局', 'pending', '有场地未开课学校 ' + youth.withCourtsWithoutTeaching.length + ' 所。', youth.priorityZones),
  ]
}

export function jingshanRouter(pool: Pool) {
  const router = Router()
  router.use(json({ limit: '18mb' }))
  let resourceInstallation:Promise<void>|undefined
  router.use(async (_req,_res,next)=>{
    resourceInstallation??=workspace().then(()=>installPlatformResources(pool)).catch(error=>{resourceInstallation=undefined;throw error})
    await resourceInstallation
    next()
  })
  router.use('/event-plans',eventPreassessmentRouter(pool))
  router.use('/event-live',eventLiveRouter(pool))
  router.get('/event-road-surfaces',roadSurfaceHandler(pool))
  router.use('/event-reviews',eventPostReviewRouter(pool))
  router.use('/cim', cimRouter(pool))
  router.use('/investment',investmentRecords(pool))
  router.use('/venue-opening', venueOpeningRouter(pool))
  router.get('/venue-reservations', venueReservationsHandler(pool))
  router.post('/platform/population-attributes.xlsx',exportPopulationAttributes)
  router.post('/platform/spatial-export.zip',sendShapefile)
  router.use('/platform', platformGovernance(pool))

  async function workspace() {
    const select = () => pool.query<DataWorkspace & { demoSeeded: boolean }>('SELECT ' + workspaceFields + ', demo_results_seeded AS "demoSeeded" FROM jingshan_workspace WHERE id')
    let result = await select()
    if (!result.rowCount) {
      const data = await initialWorkspaceData(await readDemo('demo-data-v3.json'))
      await registerHostedLayer(pool,activeCourtSource(data)!)
      await pool.query(`
        WITH seeded AS (
          INSERT INTO jingshan_workspace (published, draft)
          VALUES ($1, $1) ON CONFLICT (id) DO NOTHING
          RETURNING version, published, published_at
        )
        INSERT INTO jingshan_publications (version, data, published_at)
        SELECT version, published, published_at FROM seeded
      `, [JSON.stringify(data)])
      result = await select()
    } else {
      const current = result.rows[0]
      if (current.version === 1 && current.revision === 1 && current.data.mode === 'demo' &&
          !current.data.datasets.some(item => item.id === 'operations_monthly')) {
        const [previous, next] = await Promise.all([readDemo('demo-data.json'), readDemo('demo-data-v3.json')])
        const upgraded=await initialWorkspaceData(next)
        await registerHostedLayer(pool,activeCourtSource(upgraded)!)
        await pool.query(`
          WITH upgraded AS (
            UPDATE jingshan_workspace SET published = $2, draft = $2, version = 2, revision = 2,
              published_at = now(), updated_at = now()
            WHERE id AND version = 1 AND revision = 1 AND published = $1::jsonb AND draft = $1::jsonb
              AND NOT EXISTS (SELECT 1 FROM jingshan_opening_schedules WHERE NOT cancelled)
            RETURNING version, published, published_at
          )
          INSERT INTO jingshan_publications (version, data, published_at)
          SELECT version, published, published_at FROM upgraded
        `, [JSON.stringify(previous), JSON.stringify(upgraded)])
        result = await select()
      }
    }
    return result.rows[0]
  }

  router.get('/platform/catalog', async (req,res)=>{
    const page=Number(req.query.page??1),pageSize=Number(req.query.pageSize??20)
    const q=req.query.q??'', kind=req.query.type??''
    if(!Number.isSafeInteger(page)||page<1||page>1000000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100||
      typeof q!=='string'||q.length>150||!['','local','views','forms','services'].includes(String(kind))) {
      return res.status(400).json({error:'请检查资源类型、关键词或分页参数（每页 1 至 100 项）'})
    }
    const read=()=>pool.query(`WITH release AS (SELECT version,published FROM jingshan_workspace WHERE id),
      assets AS (
        SELECT 'dataset:'||(d->>'id') AS key, d->>'name' AS name, d->>'category' AS category, d->>'department' AS owner,
          CASE WHEN d->>'derivedFrom' IS NOT NULL THEN 'views' WHEN d ? 'formSchema' OR d->>'id'=ANY($1) THEN 'forms' ELSE 'local' END AS type,
          CASE WHEN d ? 'formSchema' OR d->>'id'=ANY($1) THEN '表单' WHEN d->>'id'='jingshan_population_100m' THEN 'GeoTIFF' ELSE 'GeoJSON' END AS format,
          d->>'derivedFrom' AS source_id, CASE WHEN d->>'id'='jingshan_population_100m' THEN coalesce((SELECT sum((b->'properties'->>'validCells')::int) FROM jsonb_array_elements(d->'features') b),0)::int ELSE jsonb_array_length(d->'features') END AS records FROM release CROSS JOIN LATERAL jsonb_array_elements(published->'datasets') d
        UNION ALL SELECT 'service:'||id,name,category,'','services',upper(kind),
          CASE WHEN s.id LIKE 'hosted-%' AND s.url=('/api/jingshan/layers/'||substr(s.id,8)||'/features.geojson') THEN substr(s.id,8) END,NULL FROM jingshan_cim_services s WHERE enabled AND NOT deleted AND ${availableServiceSql}
      ), matches AS (
        SELECT a.*, src.name AS source_name FROM assets a
        LEFT JOIN assets src ON src.key='dataset:'||a.source_id
        WHERE ($2='' OR a.type=$2)
          AND strpos(lower(concat_ws(' ',a.name,a.key,a.category,a.owner,a.format,a.source_id,src.name)),lower($3))>0
      )
      SELECT version,published->'portalCatalog' AS directory,(SELECT count(*)::int FROM matches) AS total,
        (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.name,s.key),'[]'::jsonb)
          FROM (SELECT * FROM matches ORDER BY name,key LIMIT $4 OFFSET $5) s) AS items FROM release`,
      [platformFormTemplates.map(f=>f.id),kind,q,pageSize,(page-1)*pageSize])
    let result=await read()
    if(!result.rowCount){await workspace();result=await read()}
    const {directory,...data}=result.rows[0]
    res.json({...data,page,pageSize,folders:publishedCatalog(directory as PortalCatalog|undefined)?.folders??[]})
  })
  router.get('/data', async (req, res) => {
    const { data, version, publishedAt } = await workspace()
    let document=data
    if (req.query.courtSource==='service') {
      const activeId=activeCourtSourceId(data), viaService=boundCourtSource(data)
      const layers=new Set<string>([activeId,...courtViewIds])
      document={...data,datasets:data.datasets.filter(d=>!isCourtLedgerId(d.id) || d.id===activeId)
        .map(d=>viaService && layers.has(d.id) ? {...d,features:[]} : d)}
    }
    const deferredPopulation=req.query.population==='deferred' ? document.datasets.filter(d=>
      [populationGridId,legacyPopulationGridId].includes(d.id) && d.features.length).map(d=>d.id) : []
    if(deferredPopulation.length)document={...document,datasets:document.datasets.map(d=>deferredPopulation.includes(d.id)?{...d,features:[]}:d)}
    const deferredReserves=req.query.reserves==='deferred' ? document.datasets.filter(d=>
      [reserveLayerId,surveyReferenceLayerId].includes(d.id) && d.features.length).map(d=>d.id) : []
    if(deferredReserves.length)document={...document,datasets:document.datasets.map(d=>deferredReserves.includes(d.id)?{...d,features:[]}:d)}
    res.json({data:publicResourceData(document),version,publishedAt,...(deferredPopulation.length?{deferredPopulation}:{}),...(deferredReserves.length?{deferredReserves}:{})})
  })

  // Expose exactly the published properties available on the map, never draft records.
  router.get('/layers/:id/population-blocks', async (req,res)=>{
    const id=String(req.params.id)
    if(![populationGridId,legacyPopulationGridId].includes(id)){res.sendStatus(404);return}
    try{
      const {dataset,version}=await publishedLayer(pool,id)
      res.set('Cache-Control','no-cache').json({dataset,version})
    }catch(error){if(error instanceof CimError){res.status(error.status).json({error:error.message});return}throw error}
  })
  router.get('/layers/:id/features.geojson', async (req, res) => {
    try {
      const layer=await publishedLayer(pool,String(req.params.id),false,workspace)
      await sendPublishedFeatures(res,layer)
    } catch(error) {
      if(error instanceof CimError) {res.status(error.status).json({error:error.message});return}
      throw error
    }
  })

  router.get('/admin', async (_req, res) => res.json(await workspace()))
  router.get('/admin/activity', async (req, res) => {
    const cursor = req.query.before
    if (cursor !== undefined && (typeof cursor !== 'string' || !/^[1-9]\d{0,17}$/.test(cursor))) {
      return res.status(400).json({error:'无效的操作记录分页位置'})
    }
    const {rows} = await pool.query(
      `SELECT id::text AS id, recorded_at AS "recordedAt", area, action, resource, detail
       FROM jingshan_activity WHERE ($1::bigint IS NULL OR id < $1::bigint)
       ORDER BY jingshan_activity.id DESC LIMIT 26`, [cursor ?? null])
    res.json({items:rows.slice(0,25), more:rows.length > 25})
  })
  router.post('/cim/sync/:id', async (req, res) => {
    const { revision } = req.body ?? {}
    if (!Number.isInteger(revision)) return res.status(400).json({error: '缺少草稿修订号'})
    const service = await getCimService(pool, req.params.id)
    const boundary = service && cimBoundaryBindings[service.id]
    if (!service || !(boundary && service.kind === 'wms' || cimDatasetBindings[service.id] && service.kind === 'wfs')) {
      return res.status(404).json({error: '未找到绑定的数据集'})
    }
    if (!service.enabled) return res.status(409).json({error: '请先启用该服务'})
    const current = await workspace()
    if (current.revision !== revision) return res.status(409).json({error: '草稿已更新，请重新载入'})
    const paired = boundary?.id === 'administration' ? await getCimService(pool, service.id === 'cim-05' ? 'cim-06' : 'cim-05') : null
    let incoming: {draft: DataDocument; datasetId: string; count: number}
    try {
      if (boundary) {
        const district = boundary.id === 'administration'
        const dataset = district ? await fetchCimAdministration(pool) : await fetchCimCommunities(pool)
        const count = dataset.features.length
        const previous = current.draft.datasets.find(item => item.id === dataset.id)
        const sourceCodes = new Set(dataset.features.map(item => item.properties.code ?? item.properties.adcode).filter(Boolean))
        const manual = previous?.features.filter(item => {
          if (item.properties.sample === true || ['cim-05','cim-06','cim-07'].includes(String(item.properties.sourceServiceId))) return false
          if (district && (item.id.startsWith('osm-') || String(item.properties.source ?? '').startsWith('OpenStreetMap'))) return false
          return !sourceCodes.has(item.properties.code ?? item.properties.adcode)
        }) ?? []
        dataset.features.push(...manual)
        const datasets = previous ? current.draft.datasets.map(item => item.id === dataset.id ? dataset : item) : [...current.draft.datasets, dataset]
        incoming = {draft: {...current.draft, datasets}, datasetId: dataset.id, count}
        checkDocument(incoming.draft)
      } else {
        incoming = updateCimDataset(current.draft, service, await fetchCimFeatures(service))
      }
    } catch (error) {
      return res.status(422).json({error: error instanceof Error ? error.message : '读取或验证来源失败，原数据已保留'})
    }
    const inputs = paired ? [service, paired] : [service]
    const {rows} = await pool.query<DataWorkspace>(`WITH configuration AS MATERIALIZED (
      SELECT s.id FROM jingshan_cim_services s JOIN unnest($3::text[], $4::integer[]) a(id, revision)
      ON s.id = a.id AND s.revision = a.revision WHERE s.enabled AND NOT s.deleted FOR SHARE OF s
    ) UPDATE jingshan_workspace SET draft = $1, revision = revision + 1, updated_at = now()
      WHERE id AND revision = $2 AND (SELECT count(*) FROM configuration) = cardinality($3::text[])
      RETURNING ${workspaceFields}`, [JSON.stringify(incoming.draft), revision, inputs.map(row => row.id), inputs.map(row => row.revision)])
    if (!rows[0]) return res.status(409).json({error: '草稿已更新，请重新载入后同步'})
    return res.json({workspace: rows[0], datasetId: incoming.datasetId, count: incoming.count})
  })
  router.get('/admin/demo-v3', async (_req, res) => {
    const ws=await workspace(), base=await initialWorkspaceData(await readDemo('demo-data-v3.json'))
    const sources=ws.draft.datasets.filter(d=>isCourtLedgerId(d.id))
    const datasets=sources.length ? [...base.datasets.filter(d=>!isCourtLedgerId(d.id)),...sources] : base.datasets
    res.json(withCourtLedger({...base,datasets,mapBindings:ws.draft.mapBindings},activeCourtSource(ws.draft)))
  })

  router.get('/admin/versions', async (req, res) => {
    const paged=req.query.view==='page'
    const before=req.query.before===undefined ? null : Number(req.query.before)
    if (before!==null && (!Number.isInteger(before) || before<1 || before>2147483647)) return res.status(400).json({error:'无效的版本分页位置'})
    const { rows } = await pool.query(`SELECT version, published_at AS "publishedAt" FROM jingshan_publications
      WHERE ($1::int IS NULL OR version < $1) ORDER BY version DESC LIMIT $2`, [before,paged?26:50])
    res.json(paged ? {items:rows.slice(0,25),more:rows.length>25} : rows)
  })

  router.put('/admin/draft', async (req, res) => {
    const { revision } = req.body ?? {}
    let data = req.body?.data
    if (!Number.isInteger(revision)) return res.status(400).json({ error: '缺少草稿修订号' })
    try {
      checkDocument(data)
      data=withCourtLedger(data)
      checkDocument(data)
      const current = await workspace()
      if (current.revision !== revision) return res.status(409).json({error:'草稿已被修改，请重新载入后再保存'})
      checkDatasetRemovals(current.draft,req.body.data,req.body.removedDatasetIds)
      checkChangedFormRecords(data, current.draft)
      await validateBindingServices(pool,data.mapBindings)
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : '数据格式不正确' })
    }
    const { rows } = await pool.query(`
      UPDATE jingshan_workspace SET draft = $1, revision = revision + 1, updated_at = now()
      WHERE id AND revision = $2 RETURNING ${workspaceFields}
    `, [JSON.stringify(data), revision])
    if (!rows[0]) return res.status(409).json({ error: '草稿已被修改，请重新载入后再保存' })
    res.json(rows[0])
  })

  router.post('/admin/publish-layer',async(req,res)=>{
    const {datasetId,revision}=req.body??{}
    if(typeof datasetId!=='string' || !Number.isInteger(revision))return res.status(400).json({error:'缺少数据集或草稿修订号'})
    try{res.json(await publishSpatialSource(pool,datasetId,revision))}
    catch(e){if(e instanceof CimError)return res.status(e.status).json({error:e.message});throw e}
  })

  router.post('/admin/publish', async (req, res) => {
    const { revision } = req.body ?? {}
    if (!Number.isInteger(revision)) return res.status(400).json({ error: '缺少草稿修订号' })
    try {
      const value = await publishWorkspace(pool,revision)
      if (!value) return res.status(409).json({ error: '草稿已被修改，请重新载入后再发布' })
      res.json(value)
    } catch (error) {
      const status = error instanceof Error && 'status' in error ? error.status : undefined
      if (error instanceof Error && (status === 400 || status === 409)) return res.status(status).json({error:error.message})
      throw error
    }
  })

  router.post('/admin/restore', async (req, res) => {
    const { revision, version } = req.body ?? {}
    if (!Number.isInteger(revision) || !Number.isInteger(version)) return res.status(400).json({ error: '版本参数不正确' })
    const { rows } = await pool.query(`
      UPDATE jingshan_workspace SET draft = historical.data, revision = revision + 1, updated_at = now()
      FROM (SELECT data FROM jingshan_publications WHERE version = $2) historical
      WHERE id AND revision = $1
      RETURNING published AS data, draft, version, revision, published_at AS "publishedAt", updated_at AS "updatedAt"
    `, [revision, version])
    if (!rows[0]) return res.status(409).json({ error: '版本不存在或草稿已更新' })
    res.json(rows[0])
  })

  router.get('/results', async (req, res) => {
    const snapshot = await workspace()
    if (!snapshot.demoSeeded && snapshot.version === 1 && snapshot.data.mode === 'demo') {
      await pool.query(`
        WITH reserved AS (
          UPDATE jingshan_workspace SET demo_results_seeded = true
          WHERE id AND version = 1 AND NOT demo_results_seeded AND published->>'mode' = 'demo'
          RETURNING version
        )
        INSERT INTO jingshan_results (scene, title, department, summary, features, version, status)
        SELECT input.scene, input.title, input.department, input.summary, input.features, reserved.version, input.status
        FROM reserved CROSS JOIN jsonb_to_recordset($1::jsonb)
        AS input(scene text, title text, department text, summary text, features jsonb, status text)
      `, [JSON.stringify(sampleResults(snapshot))])
    }
    if (req.query.view === 'list') {
      const before = req.query.before === undefined ? null : Number(req.query.before)
      if (before !== null && (!Number.isSafeInteger(before) || before < 1 || before > 2147483647))
        return res.status(400).json({ error:'无效的成果分页位置' })
      const status = req.query.status || ''
      if (!['','pending','received','completed'].includes(String(status)) || (req.query.q !== undefined && typeof req.query.q !== 'string'))
        return res.status(400).json({ error:'无效的台账筛选条件' })
      const keyword = String(req.query.q || '').trim().slice(0,120)
      const { rows } = await pool.query(`SELECT ${resultSummaryFields}, jsonb_array_length(features) AS "featureCount"
        FROM jingshan_results WHERE ($1::integer IS NULL OR id < $1)
          AND ($2::text = '' OR status = $2)
          AND ($3::text = '' OR strpos(lower(concat_ws(' ',title,department,summary)),lower($3)) > 0)
        ORDER BY id DESC LIMIT 26`,[before,status,keyword])
      return res.json({items:rows.slice(0,25), more:rows.length > 25})
    }
    // The admin ledger above retains the publication recorded with each historical decision.
    const usesCourtLedger=snapshot.data.datasets.some(d=>isCourtLedgerId(d.derivedFrom))
    const binding=JSON.stringify([{scope:'all',slot:courtMapSlot,serviceId:'hosted-'+activeCourtSourceId(snapshot.data)}])
    const { rows } = await pool.query('SELECT ' + resultFields + ` FROM jingshan_results r
      WHERE NOT $1::boolean OR NOT (
        (r.scene='venues' OR (r.scene='talent' AND r.summary LIKE '%演示数据 V1%')
          OR (r.scene='investment' AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(r.features) f WHERE f->>'id' LIKE 'support:tennis-dining:%')))
        AND r.version < (SELECT coalesce(min(version),0) FROM jingshan_publications WHERE data->'mapBindings' @> $2::jsonb)
      ) ORDER BY id DESC LIMIT 100`,[usesCourtLedger,binding])
    res.json(req.query.investmentPoints==='1' ? rows.map(row=>row.scene==='investment'?pointsForRecord(row):row) : rows)
  })

  router.post(['/results', '/results/batch'], async (req, res) => {
    const batch = req.path === '/results/batch'
    const version = req.body?.version
    const input = batch ? req.body?.items : [req.body]
    if (!Number.isInteger(version) || !Array.isArray(input) || !input.length || input.length > 12) {
      return res.status(400).json({ error: '成果需包含有效数据版本和 1 至 12 项任务' })
    }
    let items: ResultInput[]
    try {
      items = input.map(checkedResult)
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : '成果图层不正确' })
    }
    const { rows } = await pool.query(`
      INSERT INTO jingshan_results (scene, title, department, summary, features, version)
      SELECT input.scene, input.title, input.department, input.summary, input.features, published.version
      FROM jingshan_publications published CROSS JOIN jsonb_to_recordset($1::jsonb)
      AS input(scene text, title text, department text, summary text, features jsonb)
      WHERE published.version = $2 RETURNING ${resultFields}
    `, [JSON.stringify(items), version])
    if (!rows[0]) return res.status(409).json({ error: '请先载入已发布数据' })
    res.status(201).json(batch ? rows : rows[0])
  })

  router.patch('/results/:id', async (req, res) => {
    const id = Number(req.params.id)
    const { status } = req.body ?? {}
    if (!Number.isInteger(id) || id < 1 || id > 2147483647 || !['received', 'completed'].includes(status)) {
      return res.status(400).json({ error: '无效的成果或办理状态' })
    }
    const { rows } = await pool.query('UPDATE jingshan_results SET status = $1 WHERE id = $2 AND status = $3 RETURNING ' + resultFields,
      [status, id, status === 'received' ? 'pending' : 'received'])
    if (!rows[0]) return res.status(409).json({ error: '成果办理状态已更新，请刷新查看' })
    res.json(rows[0])
  })
  return router
}
