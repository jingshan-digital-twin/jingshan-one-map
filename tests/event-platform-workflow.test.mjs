import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {once} from 'node:events'
import {randomBytes} from 'node:crypto'
import {eventReviewDocument, makeEventPlanDataset, publishedCompetitions, publishedEventCatalog, upcomingCompetitions} from '../src/jingshan/event-platform-data.ts'
import {checkPlatformRecord, operationalRecordSources} from '../src/jingshan/platform-forms.ts'
import {checkDocument} from '../src/jingshan/validate.ts'
import {buildEventReview} from '../src/jingshan/event-post-review.ts'
import {defaultAssessmentInputs} from '../src/jingshan/event-estimates.ts'
import {allAssessmentItems} from '../src/jingshan/event-plan-selection.ts'
import {eventCalendarStatus, eventYearSummary, parseEventDate} from '../src/jingshan/event-plan-data.ts'

const source=JSON.parse(await readFile(new URL('../server/event-sources/events.json',import.meta.url),'utf8'))
test('首页只列已发布赛历中尚未开赛的正式赛事，保持原始赛期精度',()=>{
  const sourcePlan = makeEventPlanDataset(source)
  const record = (id,dateText,changes={}) => ({
    ...sourcePlan.features[0], id, properties:{...sourcePlan.features[0].properties, year:2026, category:'赛事',dateText,...changes},
  })
  const schedule = {...sourcePlan, features:[
    record('nextMonth','12月'),record('soon','11月27-29日'),record('today','11月24日'),
    record('ongoing','11月25日',{status:'进行中'}),record('finished','11月26日',{status:'已办结'}),
    record('sample','11月25日',{sample:true}),record('cancelled','11月25日',{status:'已取消'}),
    record('training','11月25日',{category:'培训'}),record('undated','',{year:2027}),
  ]}
  const legacy = {...sourcePlan,id:'events',features:[record('unpublished','11月25日')]}
  const competitions = publishedCompetitions([legacy,schedule])
  assert.equal(competitions.length,6)
  const upcoming = upcomingCompetitions(competitions,'2026-11-24')
  assert.deepEqual(upcoming.map(e=>e.id),['soon','nextMonth'])
  assert.equal(upcoming[1].startDate,null)
  assert.deepEqual(upcomingCompetitions(competitions,'2026-12-31'),[])
  assert.deepEqual(publishedCompetitions([legacy]),[])
})
test('年度赛历保留原序号升序，月份包含跨月赛事，已结束状态尊重发布台账和赛期精度',()=>{
  const event=(sequence,range,assessment)=>({id:'test-'+sequence,year:2026,sequence,assessment,...parseEventDate(2026,range)})
  const cross=event(10,'10月30日-11月2日',false), past=event(3,'11月3日',false), planned=event(22,'11月28日',true)
  const calendar=eventYearSummary([planned,cross,past],2026)
  assert.deepEqual(calendar.events.map(e=>e.sequence),[3,10,22])
  assert.deepEqual(calendar.monthly[9].events,[cross])
  assert.deepEqual(calendar.monthly[10].events,[past,cross,planned])
  assert.equal(eventCalendarStatus(cross,'2026-11-02'),'进行中')
  assert.equal(eventCalendarStatus(cross,'2026-11-03'),'已完结')
  assert.equal(eventCalendarStatus(planned,'2026-11-24'),'待开赛')
  assert.equal(eventCalendarStatus({...planned,reportedStatus:'已办结'},'2026-11-24'),'已完结')
  assert.equal(eventCalendarStatus(event(4,'9月-10月',false),'2026-11-01'),'已完结')
  assert.equal(eventCalendarStatus(event(5,'11月',false),'2026-11-24'),'赛期待定')
})
test('全年与已完成只计所选年的赛事，跨月赛只算一场，完结沿用赛事进度',()=>{
  const competition=(id,range,changes={})=>({id,year:2026,category:'赛事',...parseEventDate(2026,range),...changes})
  const events=[
    competition('cross','10月30日-11月2日'),
    competition('month','11月'),
    competition('future','12月6日'),
    competition('ongoing','9月',{reportedStatus:'进行中'}),
    competition('finished','12月6日',{reportedStatus:'已办结'}),
    competition('training','10月',{category:'培训'}),
    competition('previous','10月',{year:2025}),
  ]
  const summary=eventYearSummary(events,2026,'2026-11-24')
  assert.equal(summary.competitionCount,5)
  assert.equal(summary.completedCompetitionCount,2)
})
test('后台赛历保留原始计划、缺失人数和日期精度，已办赛事可以填写复盘实绩',()=>{
  const plans=makeEventPlanDataset(source),doc={mode:'live',rules:{},datasets:[plans]}
  checkDocument(doc)
  const catalog=publishedEventCatalog(doc)
  assert.deepEqual(catalog.events,source.events)
  assert.deepEqual(catalog.sourceSummaries.map(r=>[r.year,r.count,r.computedParticipants]),[[2025,48,13278],[2026,46,10028]])
  const event=plans.features[0]
  assert.equal(operationalRecordSources(doc.datasets,'event_actuals').length,0)
  event.properties.status='已办结'
  assert.equal(publishedEventCatalog(doc).events[0].reportedStatus,'已办结')
  const feature={id:'actual-1',type:'Feature',geometry:{type:'GeometryCollection',geometries:[]},properties:{name:'核验',kind:'event_actual',region:'京山市',
    eventId:event.id,confirmedAt:'2026-11-24',players:0,spectators:38,diningVisits:4,trafficScore:87,trendJson:'[{"date":"2026-11-24","event":0}]'}}
  const actual={id:'event_actuals',name:'赛后实绩',category:'运营统计',department:'文旅局',description:'',features:[feature]}
  doc.datasets.push(actual)
  checkPlatformRecord(actual,feature,doc.datasets);checkDocument(doc)
  assert.equal(operationalRecordSources(doc.datasets,'event_actuals')[0].id,event.id)
  const report=buildEventReview(eventReviewDocument(doc),event.id)
  assert.equal(report.metrics[0].value,0)
  assert.equal(report.metrics[1].value,38)
  assert.equal(report.funnel[2].value,4)
  assert.equal(report.scores[0].value,87)
  assert.equal(report.trend[0].event,0)
  feature.properties.trendJson='[{"date":"不是日期"}]'
  assert.throws(()=>checkPlatformRecord(actual,feature,doc.datasets),/每日客流/)
})

test('隔离数据库验证安装、草稿发布、研判交办与撤回、报告归档和已删赛历', {skip:process.env.EVENT_DB_TEST!=='1'},async t=>{
  const [{default:pg},{default:express},{jingshanRouter},{installPlatformResources}]=await Promise.all([
    import('pg'),import('express'),import('../server/jingshan.ts'),import('../server/install-platform-resources.ts')])
  const schema='event_merge_'+randomBytes(10).toString('hex'), admin=new pg.Pool()
  const pool=new pg.Pool({options:'-c search_path='+schema}), app=express()
  let server,created=false
  try {
    await admin.query('CREATE SCHEMA '+schema); created=true
    assert.equal((await pool.query('SELECT current_schema() name')).rows[0].name,schema)
    await pool.query(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8'))
    const original={mode:'live',rules:{},datasets:[]}
    const pending={...original,datasets:[{id:'pending',name:'未发布的部门资源',description:'',category:'草稿',department:'文旅局',features:[]}]}
    await pool.query('INSERT INTO jingshan_workspace(version,revision,published,draft) VALUES(10,20,$1,$2)',[original,pending])
    app.use('/api',jingshanRouter(pool))
    server=app.listen(0,'127.0.0.1');await once(server,'listening')
    const req=async(path,method='GET',body)=> {
      const response=await fetch('http://127.0.0.1:'+server.address().port+'/api'+path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)})
      return {status:response.status,body:await response.json()}
    }
    const ok=async(...args)=>{const r=await req(...args);assert.equal(r.status,200,JSON.stringify(r.body).slice(0,300));return r.body}
    const ws=await ok('/admin')
    assert.equal(ws.version,11); assert.equal(ws.revision,21)
    assert.equal(ws.data.datasets.find(d=>d.id==='form_fusion_arrivals').features.length,0)
    assert.ok(ws.draft.datasets.some(d=>d.id==='pending'));assert.ok(!ws.data.datasets.some(d=>d.id==='pending'))
    const catalog=await ok('/event-plans');assert.equal(catalog.events.length,94);assert.deepEqual(catalog.examples,[])
    const exercises=await ok('/event-plans/exercises');assert.equal(exercises.examples.length,2)
    assert.deepEqual(Object.keys((await ok('/event-plans')).assessments),[])
    const event=catalog.events.find(e=>e.id==='plan-2026-51'), url='/event-plans/'+event.id
    const eventRows=ws.draft.datasets.find(d=>d.id==='event_plans').features
    const r=eventRows.find(f=>f.id===event.id)
    const located=catalog.events.find(e=>e.id==='plan-2026-50')
    eventRows.find(f=>f.id===located.id).geometry={type:'Point',coordinates:[113.1,31]}
    r.properties.participants=18;r.properties.status='已办结';r.properties.name='隔离验证赛事'
    const arrivals=ws.draft.datasets.find(d=>d.id==='form_fusion_arrivals'), arrivalUrl='/layers/'+arrivals.id+'/features.geojson'
    const daily={name:'11月24日全市汇总',kind:'form_record',region:'京山市',reportDate:'2026-11-24',rowType:'全市汇总',sourceName:'隔离验收日报',people:217,vehicles:0,sample:false}
    arrivals.features.push({type:'Feature',id:'isolated-daily-total',geometry:{type:'GeometryCollection',geometries:[]},properties:daily})
    const saved=await ok('/admin/draft','PUT',{revision:ws.revision,data:ws.draft})
    assert.equal((await ok(arrivalUrl)).features.length,0)
    assert.equal((await ok('/event-plans')).events.find(e=>e.id===event.id).name,event.name)
    const release=await ok('/admin/publish','POST',{revision:saved.revision})
    assert.deepEqual((await ok(arrivalUrl)).features.map(f=>[f.properties.people,f.properties.vehicles]),[[217,0]])
    assert.equal((await ok('/event-plans')).events.find(e=>e.id===event.id).participants,18)
    await t.test('场馆已定位时道路源离线仍能生成及交办，恢复后增补核实的道路',async()=>{
      let available=false, calls=0
      app.get('/survey-test',(_req,res)=>{
        calls++
        if (!available) return res.type('application/xml').send('<ExceptionReport><ExceptionText>Data source unavailable</ExceptionText></ExceptionReport>')
        res.json({type:'FeatureCollection',totalFeatures:1,features:[{
          id:'road-21',type:'Feature',properties:{dlmc:'台账道路甲'},
          geometry:{type:'Polygon',coordinates:[[[113.1,31],[113.101,31],[113.101,31.001],[113.1,31.001],[113.1,31]]]},
        }]})
      })
      await pool.query(`INSERT INTO jingshan_cim_services(id,name,category,kind,url,layer,version)
        VALUES('cim-04','道路面测试服务','道路交通','wms',$1,'test:roads','1.3.0')`,
        ['http://127.0.0.1:'+server.address().port+'/survey-test'])
      const path='/event-plans/'+located.id
      const input={revision:0,inputs:defaultAssessmentInputs(located)}
      const draft=await ok(path+'/assessment','PUT',input)
      assert.equal(calls,0)
      assert.deepEqual(draft.position,[113.1,31])
      assert.equal(draft.roadBasis,'pending-road-surfaces')
      assert.equal(draft.topics.length,8)
      assert.deepEqual(draft.roads,[])
      assert.equal((await ok('/event-plans')).assessments[located.id].roadBasis,draft.roadBasis)
      assert.equal((await req(path+'/assessment','PUT',input)).status,409)

      const failure=await req(path+'/traffic-preview')
      assert.ok(failure.status===502 || failure.status===503)
      assert.ok(failure.body.error)
      assert.equal(calls,1)
      const selection=Object.fromEntries(draft.topics.map(topic=>[topic.id,[]]))
      selection.medical=[draft.topics.find(topic=>topic.id==='medical').items[0].id]
      const submit=(revision,chosen,options)=>req(path+'/submit','POST',{revision,selection:chosen,...options})
      assert.equal((await submit(draft.revision,{...selection,traffic:['fabricated-road']},{roadsDeferred:true})).status,400)
      const partial=await ok(path+'/submit','POST',{revision:draft.revision,selection,roadsDeferred:true})
      assert.equal(calls,1)
      assert.equal(partial.roadBasis,'pending-road-surfaces')
      assert.equal(partial.status,'review')
      assert.deepEqual(partial.dispatchedItems,selection)
      assert.equal(partial.taskIds.length,1)
      assert.equal((await ok('/event-plans')).assessments[located.id].revision,partial.revision)

      available=true
      const preview=await ok(path+'/traffic-preview')
      assert.ok(preview.signature)
      assert.equal(preview.plan.roadBasis,'road-surfaces')
      const road=preview.plan.roads.find(f=>f.properties.sourceFeatureId==='road-21')
      assert.equal(road?.properties.name,'台账道路甲')
      const withRoad={...selection,traffic:[road.id]}
      assert.equal((await submit(partial.revision,withRoad,{roadSignature:'stale-signature'})).status,409)
      const revised=await ok(path+'/submit','POST',{revision:partial.revision,selection:withRoad,roadSignature:preview.signature})
      assert.equal(revised.roadBasis,'road-surfaces')
      assert.deepEqual(revised.dispatchedItems,withRoad)
      assert.equal(revised.taskIds.length,2)
      assert.ok(revised.planVersion>partial.planVersion)
      assert.equal((await ok('/event-plans')).assessments[located.id].revision,revised.revision)
    })
    const start=await ok(url+'/assessment','PUT',{revision:0,inputs:defaultAssessmentInputs(event)})
    assert.equal(start.eventSnapshot.name,'隔离验证赛事')
    assert.equal(start.roadBasis,'road-surfaces')
    // Exercise the upgrade path for an unsubmitted draft that still carries an OSM road selection.
    const legacy=structuredClone(start)
    delete legacy.roadBasis
    legacy.roads=[{id:'retired-way',type:'Feature',properties:{name:'原参考道路'},geometry:{type:'LineString',coordinates:[[113,31],[113.01,31]]}}]
    legacy.topics.find(t=>t.id==='traffic').items.push({id:'retired-way',featureId:'retired-way',title:'原参考道路',detail:'',status:'封闭建议'})
    await pool.query('UPDATE jingshan_event_assessments SET plan=$1 WHERE event_id=$2',[legacy,event.id])
    const preview=await ok(url+'/traffic-preview')
    assert.equal(preview.plan.roadBasis,'road-surfaces')
    assert.ok(!preview.plan.roads.some(r=>r.id==='retired-way'))
    assert.equal((await ok('/event-plans')).assessments[event.id].roads[0].id,'retired-way')
    const selection=allAssessmentItems(preview.plan.topics)
    assert.equal((await req(url+'/submit','POST',{revision:start.revision,selection,roadSignature:'older-service'})).status,409)
    const stale={...selection,traffic:[...selection.traffic,'retired-way']}
    assert.equal((await req(url+'/submit','POST',{revision:start.revision,selection:stale,roadSignature:preview.signature})).status,400)
    const push=()=>req(url+'/submit','POST',{revision:start.revision,selection,roadSignature:preview.signature})
    const race=await Promise.all([push(),push()])
    assert.deepEqual(race.map(x=>x.status).sort(),[200,409])
    const sent=race.find(x=>x.status===200).body
    assert.ok(sent.taskIds.length>0)
    const withdrawn=await ok(url+'/withdraw','POST',{revision:sent.revision,reason:'验收撤回'})
    assert.equal(withdrawn.cancelledTaskIds.length,sent.taskIds.length)
    const report=await ok('/event-reviews/'+event.id+'/report','PUT',{version:release.version,revision:0,selectedIssues:[]})
    assert.equal(report.report.review.name,'隔离验证赛事')
    await pool.query("UPDATE jingshan_event_reviews SET snapshot = snapshot - 'formatVersion' WHERE event_id=$1",[event.id])
    const upgraded=await ok('/event-reviews/'+event.id+'/report','PUT',{version:release.version,revision:report.report.revision,selectedIssues:[]})
    assert.equal(upgraded.report.revision,report.report.revision+1)
    assert.equal(upgraded.report.review.formatVersion,report.report.review.formatVersion)
    const archived=await ok('/event-reviews/'+event.id+'/archive','POST',{revision:upgraded.report.revision})
    assert.ok(archived.report.archivedAt)
    const after=await ok('/admin')
    const removedDatasetIds=['event_plans','form_fusion_arrivals']
    after.draft.datasets=after.draft.datasets.filter(d=>!removedDatasetIds.includes(d.id))
    const removed=await ok('/admin/draft','PUT',{revision:after.revision,data:after.draft,removedDatasetIds})
    await ok('/admin/publish','POST',{revision:removed.revision})
    await installPlatformResources(pool)
    assert.ok(!(await ok('/admin')).data.datasets.some(d=>d.id==='form_fusion_arrivals'))
    assert.equal((await ok('/event-plans')).events.length,0)
    assert.equal((await ok('/event-plans/exercises')).examples.length,0)
    assert.equal((await ok('/event-reviews/'+event.id)).report.review.name,'隔离验证赛事')
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
    await pool.end();if(created)await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()
  }
})
