import { Router } from 'express'
import type { Pool } from 'pg'
import { createHash } from 'node:crypto'
import { publishedLayer } from './hosted-layers.ts'
import { CimError } from './cim-error.ts'
import { eligibleReserve, reserveLayerId, urbanPlacement } from '../src/jingshan/investment-planning.ts'
import { parcelPoint, pointsForRecord } from '../src/jingshan/investment-selection.ts'
import { encodeDispatch, type DispatchMaterial } from '../src/jingshan/industry-investment.ts'
import type { Result } from '../src/jingshan/types.ts'

const fields='id, scene, title, department, summary, status, created_at AS "createdAt", version, features'
const clean=(v:unknown,max:number)=>typeof v==='string' && v.trim().length<=max && !v.includes('\0') ? v.trim() : ''
const requestKey=/^(?:[\da-f]{32}|[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12})$/i

function validDeadline(v:unknown){
  if(typeof v!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(v))return false
  const day=new Date(v+'T00:00:00Z')
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0,10)===v
}

export function investmentRecords(pool:Pool){
  const router=Router()
  router.get('/candidates',async(_req,res)=>{
    const {version,dataset}=await publishedLayer(pool,reserveLayerId)
    res.set('Cache-Control','no-cache').json({version,features:dataset.features.filter(eligibleReserve).flatMap(f=>parcelPoint(f)??[])})
  })
  router.get('/records',async(_req,res)=>{
    const {rows}=await pool.query<Result>('SELECT '+fields+" FROM jingshan_results WHERE scene='investment' ORDER BY id DESC")
    res.json(rows.map(pointsForRecord))
  })
  router.get('/records/:id',async(req,res)=>{
    const id=Number(req.params.id)
    if(!Number.isSafeInteger(id) || id<1 || id>2147483647){res.sendStatus(400);return}
    const {rows}=await pool.query<Result>('SELECT '+fields+" FROM jingshan_results WHERE scene='investment' AND id=$1",[id])
    if(!rows.length){res.status(404).json({error:'选址记录不存在'});return}
    res.json(rows[0])
  })
  router.post('/records',async(req,res)=>{
    const b=req.body??{}, m=b.material??{}, kind=b.kind, requestId=clean(b.requestId,36)
    const ids:unknown=b.parcelIds, types:unknown=m.enterpriseTypes
    if(!['selection','dispatch'].includes(kind) || !requestKey.test(requestId) || !Number.isSafeInteger(b.version) ||
      !Array.isArray(ids) || !ids.length || !ids.every(id=>!!id && clean(id,150)===id) || new Set(ids).size!==ids.length ||
      !Array.isArray(types) || !types.length || !types.every(t=>!!clean(t,120)) || !clean(m.demandId,150) || !clean(m.title,150) ||
      !clean(m.direction,160) || !clean(m.evidence,500) || (kind==='dispatch' && (!validDeadline(m.deadline) || !clean(m.requirement,1500)))){
      res.status(400).json({error:'请核对需求、企业类型、所选地块和交办资料。'});return
    }
    const client=await pool.connect()
    try{
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',['investment:'+requestId])
      const signature=createHash('sha256').update(JSON.stringify([kind,b.version,ids,m.demandId,m.title,m.direction,m.evidence,types,m.deadline,m.requirement,m.assignee])).digest('hex')
      const existing=await client.query<Result>('SELECT '+fields+" FROM jingshan_results WHERE scene='investment' AND strpos(summary,$1)>0 LIMIT 1",['"requestId":"'+requestId+'"'])
      if(existing.rows[0]){
        if(JSON.parse(existing.rows[0].summary).signature!==signature)throw new CimError('此提交编号已经用于另一份资料，请重新提交。',409)
        await client.query('COMMIT')
        res.json(pointsForRecord(existing.rows[0]));return
      }
      const {dataset,version}=await publishedLayer(client,reserveLayerId,true)
      if(version!==b.version)throw new CimError('地块已重新发布，请刷新后核对所选地块。',409)
      const byId=new Map(dataset.features.map(f=>[f.id,f]))
      const features=ids.map(id=>{
        const f=byId.get(id)
        if(!f || !eligibleReserve(f))throw new CimError('部分地块已移出可用清单，请刷新后重新选择。',409)
        return f
      })
      const material:DispatchMaterial={recordKind:kind,demandId:clean(m.demandId,150),title:clean(m.title,150),direction:clean(m.direction,160),
        enterpriseTypes:[...new Set(types.map(t=>clean(t,120)))],evidence:clean(m.evidence,500),
        department:kind==='dispatch'?'招商事务中心':'项目选址',assignee:clean(m.assignee,120),deadline:kind==='dispatch'?m.deadline:'',
        requirement:clean(m.requirement,1500),sites:features.map(f=>f.properties.name+'（'+urbanPlacement(f).label+'）').join('、')}
      const summary=JSON.stringify({...JSON.parse(encodeDispatch(material)),requestId,signature})
      const {rows}=await client.query<Result>(`INSERT INTO jingshan_results (scene,title,department,summary,features,version,status)
        VALUES ('investment',$1,$2,$3,$4::jsonb,$5,$6) RETURNING `+fields,
        [material.title,material.department,summary,JSON.stringify(features),version,kind==='selection'?'completed':'pending'])
      await client.query('COMMIT')
      res.status(201).json(pointsForRecord(rows[0]))
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  })
  router.use((error:Error,_req:import('express').Request,res:import('express').Response,next:import('express').NextFunction)=>{
    if(error instanceof CimError){res.status(error.status).json({error:error.message});return}
    next(error)
  })
  return router
}
