import { createHash } from 'node:crypto'
import { SaxesParser } from 'saxes'
import type { CimService, GatewayStatus } from '../src/jingshan/cim-types.ts'
import { rasterMime, rasterUrl, sampleTile } from './cim-raster.ts'
import { parseJingmenWmts } from './jingmen-wmts.ts'
import { CimError, upstream } from './cim-upstream.ts'

export function dscHeaders(appKey:string, secret:string, now=Date.now(), query=new URLSearchParams()) {
  // The portal's AppKeyDemo SignUtil appends the same time sent in the header.
  const timestamp=String(Math.floor(now/1000))
  const params=new URLSearchParams(query)
  params.set('dscAppKey',appKey)
  params.sort()
  const form=Array.from(params).filter(([,value])=>value.trim()).map(([name,value])=>name+'='+value).join('&')
  const signature=createHash('md5').update(form+'&time='+timestamp+'&key='+secret,'utf8').digest('hex').toUpperCase()
  return {'DSC-APP-KEY':appKey,'DSC-APP-SIGN':signature,'DSC-APP-TIMESTAMP':timestamp,Accept:'*/*'}
}

function inspectXml(bytes:Buffer) {
  const source=new TextDecoder().decode(bytes)
  let dataStart=0, embedded=false, payload='', textChunks:string[]=[]
  const parser=new SaxesParser({xmlns:true})
  const path:string[]=[]
  const fields:Record<string,string>=Object.create(null)
  const dataFields:Record<string,string>=Object.create(null)
  let root='',hasData=false,hasException=false
  const isEnvelope=()=>root==='BusinessMessage'||root==='ISSTECH'
  parser.on('doctype',()=>{throw new Error('DTD')})
  parser.on('opentag',tag=>{
    path.push(tag.local)
    if(path.length===1)root=tag.local
    if(path.length===2&&tag.local==='data'){hasData=true;dataStart=parser.position}
    if(path.length===3&&isEnvelope()&&path[1]==='data')embedded=true
    if(['ExceptionReport','ServiceExceptionReport'].includes(tag.local))hasException=true
  })
  const collect=(value:string)=>{
    if(isEnvelope()&&path.length===2&&path[1]==='data')textChunks.push(value)
    if(path.length===3&&path[1]==='data'&&['code','success'].includes(path[2])){
      dataFields[path[2]]=((dataFields[path[2]]??'')+value).slice(0,64)
    }
    if(path.length!==2||!['code','success'].includes(path[1]))return
    fields[path[1]]=((fields[path[1]]??'')+value).slice(0,64)
  }
  parser.on('text',collect)
  parser.on('cdata',collect)
  parser.on('closetag',()=>{
    if(path.length===2&&isEnvelope()&&path[1]==='data'){
      payload=embedded?source.slice(dataStart,source.lastIndexOf('</',parser.position-1)):textChunks.join('').trim()
      textChunks=[]
    }
    path.pop()
  })
  try {parser.write(source).close()}
  catch {throw new CimError('网关返回的内容无法识别为有效 XML。')}
  if(hasException)throw new CimError('上游地图服务返回 OGC 异常。')
  if(isEnvelope()){
    const code=(fields.code??'').trim()
    if(fields.success?.trim().toLowerCase()!=='true'){
      if(code==='100107')throw new CimError('100107 · 服务授权信息不存在，请检查授权缓存信息。',502,'auth')
      if(code==='100104')throw new CimError('100104 · 网关未收到所需的授权认证参数。',502,'auth')
      throw new CimError((/^\d{1,12}$/.test(code)?code+' · ':'')+'网关未返回成功的业务结果。')
    }
    if(dataFields.success?.trim().toLowerCase()==='false'){
      const upstreamCode=dataFields.code?.trim()
      if(upstreamCode==='404')throw new CimError('上游返回 404，未找到相关服务资源。')
      throw new CimError('网关已应答，上游地图服务返回失败。')
    }
    return {message:hasData?'已收到成功的 XML 业务响应。':'已收到成功响应，未包含 data 节点。',capabilities:payload.startsWith('<')?Buffer.from(payload):null}
  }
  if(root==='WMS_Capabilities'||root==='WMT_MS_Capabilities')return {message:'已取得 WMS 服务描述。',capabilities:null}
  if(root==='Capabilities')return {message:'已取得地图服务能力描述。',capabilities:bytes}
  if(root==='FeatureCollection')return {message:'已取得 XML 地理要素集合。',capabilities:null}
  if(root.toLowerCase()==='html')throw new CimError('上游返回了网页，请核对资源授权。')
  throw new CimError('上游返回了未识别的 XML，请核对平台的应用返回参数。')
}

export function describeGatewayXml(bytes:Buffer) {
  return inspectXml(bytes).message
}

const resourceId='JMS2026N05MYX/1'
const resource='荆门市2026年0.5米影像'
type Profile=ReturnType<typeof parseJingmenWmts>

export function jingmenMapGateway() {
  const address=process.env.JINGMEN_DSC_SERVICE_URL?.trim()
  if(!address)return null
  let state:GatewayStatus={resource,resourceId,status:'unchecked',statusMessage:'尚未验证影像瓦片',checkedAt:null}
  let verified:Profile|null=null
  let pending:Promise<void>|null=null
  let revision=0

  function endpoint(){
    const url=URL.canParse(address!)?new URL(address!):null
    if(!url||!['http:','https:'].includes(url.protocol)||url.pathname!=='/prod-api/jmdsj/'+resourceId||url.search||url.hash||url.username||url.password){
      throw new CimError('请将本机网关地址配置为 0.5 米影像资源 '+resourceId+'。',503)
    }
    return url
  }

  async function request(url:URL,limit:number){
    const key=process.env.JINGMEN_DSC_APP_KEY,secret=process.env.JINGMEN_DSC_APP_SECRET
    if(!key||!secret)throw new CimError('本机尚未配置网关应用的 Key 和 Secret。',503,'auth')
    return (await upstream(url,limit,dscHeaders(key,secret,Date.now(),url.searchParams))).data
  }

  async function readTile(profile:Profile,z:number,x:number,y:number){
    const url=rasterUrl({...profile,kind:'wmts',url:endpoint().href},z,x,y)
    const data=await request(url,8*1024*1024)
    if(data.toString('utf8',0,128).trimStart().startsWith('<')){
      // An HTTP 200 error envelope must never become a Cesium tile or a positive health check.
      const result=inspectXml(data)
      if(result.capabilities)throw new CimError('GetTile 返回了服务说明，未返回京山影像瓦片。')
      throw new CimError('GetTile 返回了 XML，尚未取到影像瓦片。')
    }
    const type=rasterMime(data)
    const format=profile.raster.format
    if(format==='image/jpgpng' ? type!=='image/jpeg'&&type!=='image/png' : type!==format){
      throw new CimError('样片格式与 WMTS 服务描述不一致。')
    }
    return {data,type}
  }

  function invalidate(error:CimError){
    verified=null
    state={resource,resourceId,status:error.state,statusMessage:error.message,checkedAt:new Date().toISOString()}
  }
  async function verify(){
    try {
      const url=endpoint()
      let result=inspectXml(await request(url,16*1024*1024))
      if(!result.capabilities){
        // Ask the same authorized gateway for its WMTS description; ignore URLs in returned data.
        url.search=new URLSearchParams({service:'WMTS',request:'GetCapabilities',version:'1.0.0'}).toString()
        result=inspectXml(await request(url,16*1024*1024))
      }
      if(!result.capabilities)throw new CimError('未取得 WMTS 服务描述，请核对影像网关的能力查询配置。')
      const profile=parseJingmenWmts(result.capabilities)
      const {z,x,y}=sampleTile(profile)
      const {type}=await readTile(profile,z,x,y)
      if(JSON.stringify(verified)!==JSON.stringify(profile))revision++
      verified=profile
      state={resource,resourceId,status:'online',statusMessage:'已取得京山样点 '+z+' 级 '+type+' 瓦片，可在地图图层目录中打开。',checkedAt:new Date().toISOString()}
    }catch(error){
      invalidate(error instanceof CimError?error:new CimError('影像服务描述或瓦片校验失败。'))
    }
  }
  function check(){
    pending??=verify().finally(()=>{pending=null})
    return pending
  }
  function layer():CimService|null {
    if(!verified)return null
    return {id:'jingmen-2026-05m',name:resource,category:'基础影像',kind:'wmts',layer:verified.layer,version:'1.0.0',
      enabled:true,defaultVisible:false,sortOrder:11,description:'市大数据能力平台 · '+resourceId,status:state.status,
      statusMessage:state.statusMessage,checkedAt:state.checkedAt,sourceRow:null,revision,
      mapUrl:'/api/jingshan/cim/jingmen-map/raster/{z}/{x}/{y}',raster:verified.raster}
  }
  async function tile(z:number,x:number,y:number){
    const profile=verified
    if(!profile)throw new CimError('影像瓦片尚未通过校验，请在数据中台复测。',503)
    try{return await readTile(profile,z,x,y)}
    catch(error){
      if(verified===profile&&error instanceof CimError&&error.state==='auth')invalidate(error)
      throw error
    }
  }
  return {status:()=>state,check,layer,tile}
}
