import type { CityFeature, Coordinate, Dataset, Result } from './types.ts'
import { featureCenter } from './types.ts'
import { circle, distanceM, type BlindArea } from './analytics.ts'
import { displayCellGeometry, displayColumnsPerDegree, displayRowsPerDegree } from './population-display-grid.ts'
import { chain, type ChainTopic } from './chain-taxonomy.ts'
import { buildChainCatalog, scopeEnterprises } from './industry-panorama.ts'
import { buildScaleOutput, formatIndustryOutput } from './industry-output.ts'
import { investmentLeads, type InvestmentLead } from './industry-investment.ts'
import { reserveLayerId, eligibleReserve, reserveMapFeature, urbanExtentText, urbanPlacement } from './investment-planning.ts'
import { assessVenueSupport, supportRadiusM, type VenueSupport } from './venue-support-demand.ts'
import type { SceneMap } from './scene-map.ts'
import { venueModelTile, type VenueModelFocus } from './service-model-location.ts'



export const demandCategories = { chain: '产业链需求', venue: '场馆需求', support: '配套需求' } as const
export type Category = keyof typeof demandCategories
export type Demand = InvestmentLead & {
  category: Category; group: string; topic: ChainTopic; region: string; basis: string
  anchor?: Coordinate; blind?: BlindArea; support?: VenueSupport; radiusM?: number; areaPeople?: number
  venueModelFocus?: VenueModelFocus
}
export type SiteOption = { id: string; name: string; feature: CityFeature; area: number; use: string; distanceM: number; facts: [string,string][] }
export type InvestmentMap = SceneMap & { focus: 'county' | 'area' | 'model' }

function modelFocus(venue?:CityFeature):VenueModelFocus|undefined {
  const position=venue?.geometry && featureCenter(venue)
  if(!venue || !position)return
  const focus={id:venue.id,name:venue.properties.name,position}
  if(venueModelTile(focus))return focus
}

export function investmentGapGrids(areas:BlindArea[],peoplePerCourt:number):BlindArea[]{
  const grouped=new Map<string,BlindArea>()
  for(const area of areas){
    const at=featureCenter(area.feature)
    if(!at)continue
    const col=Math.floor(at[0]*displayColumnsPerDegree),row=Math.floor(at[1]*displayRowsPerDegree)
    const id='investment-pop:'+col+':'+row+':'+area.region
    let cell=grouped.get(id)
    if(!cell){
      const {center,geometry}=displayCellGeometry(col,row),name=area.region+'500 米缺口网格'
      cell={id,name,region:area.region,reachableCourts:0,gap:0,population:0,
        feature:{type:'Feature',id,geometry,properties:{name,region:area.region,kind:'coverage-blind',center}}}
      grouped.set(id,cell)
    }
    cell.population+=area.population
    cell.feature.properties.population=cell.population
    cell.gap=Math.ceil(cell.population/peoplePerCourt)
  }
  return [...grouped.values()].sort((a,b)=>b.population-a.population || a.id.localeCompare(b.id))
}

const titles: Record<ChainTopic, [string,string]> = {
  器材制造:['高端网球装备制造','球拍、球线及器材研发生产'], 运动服饰:['专业运动服饰','运动服装、网球鞋和功能面料'],
  场地建设:['专业场地铺装','球场面层、照明和工程施工'], 场馆运营:['场馆专业运营','公共场馆市场化服务'],
  俱乐部运营:['俱乐部运营合作','会员运营、联赛和俱乐部管理'], 培训陪练:['网球教学与陪练','课程、教练和陪练服务'],
  赛事组织:['赛事策划执行','赛事承办、裁判和活动组织'], 住宿接待:['赛事住宿接待','团队住宿及接待服务'],
  餐饮服务:['场馆周边餐饮','赛事简餐、配餐和接待'], 景区游览:['网旅线路运营','景区接驳及文旅线路'],
  运动康养:['运动康复服务','体能恢复与康养服务'], 购物展销:['体育用品展销','体育商品零售和赛事展销'],
}
export const records = (datasets:Dataset[], id:string, region='京山市') => (datasets.find(d=>d.id===id)?.features ?? [])
  .filter(f=>region==='京山市'||f.properties.region===region)
const center = (f?:CityFeature):Coordinate|undefined => f?.geometry ? featureCenter(f) ?? undefined : undefined
const textField = (f:CityFeature,key:string) => typeof f.properties[key] === 'string' ? String(f.properties[key]) : ''
export const intText = (n:number) => Math.round(n).toLocaleString('zh-CN')
const pointForRegion = (data:Dataset[],region:string) => {
  const feature = records(data,'administration').find(f => f.properties.name===region)
  const point = feature?.properties.center
  return Array.isArray(point) && point.length===2 && point.every(Number.isFinite) ? point as Coordinate : center(feature)
}
function plan(id:string,category:Category,group:string,topic:ChainTopic,region:string,name:string,direction:string,evidence:string):Demand {
  return {id,category,group,topic,region,name,direction,evidence,source:demandCategories[category],origin:'研判方向',basis:'规划研判',
    method:'招商洽谈',status:'待核实',siteRequired:true}
}
function topicFor(value:string):ChainTopic {
  if (/住宿|酒店/.test(value)) return '住宿接待'
  if (/餐饮|简餐/.test(value)) return '餐饮服务'
  if (/康复|康养/.test(value)) return '运动康养'
  if (/服装|服饰/.test(value)) return '运动服饰'
  if (/零售|销售|维修/.test(value)) return '购物展销'
  if (/培训/.test(value)) return '培训陪练'
  if (/场馆|场地|球场/.test(value)) return '场馆运营'
  return '器材制造'
}
export function buildDemands(data:Dataset[],region:string,blindAreas:BlindArea[],radiusM=1000,categoryFilter?:Category,support?:VenueSupport[]):Demand[] {
  const list:Demand[] = []
  for(const stage of chain) for(const topic of stage.topics) {
    const [name,direction] = titles[topic]
    list.push({...plan('chain:'+topic,'chain',stage.id,topic,region,name,direction,'核对本环节已有经营主体、采购需求与可落地条件。'),anchor:pointForRegion(data,region)})
  }
  if(!categoryFilter || categoryFilter==='support')for(const assessment of support??assessVenueSupport(data,region)){
    const {venue,missing,anchor}=assessment
    if(!missing.length)continue
    const labels=missing.map(item=>item.label).join('、')
    const topic:ChainTopic=missing.some(i=>i.label==='餐饮')?'餐饮服务':missing.some(i=>i.label==='医疗')?'运动康养':'场馆运营'
    const direction=labels+'服务补点核查'
    list.push({...plan('support:'+venue.id,'support',venue.properties.region,topic,venue.properties.region,
      venue.properties.name+'周边配套',direction,'在已接入的设施台账中，场馆 1 公里内未检索到'+labels+'。'),
      basis:'场馆配套筛查',support:assessment,anchor,radiusM:supportRadiusM,venueModelFocus:modelFocus(venue)})
  }
  for(const item of investmentLeads(data,region,false,false)) {
    const feature = item.feature!
    const topic = topicFor(item.direction+' '+item.name)
    const explicit = feature.properties.demandCategory
    const category:Category = explicit === 'chain'||explicit === 'venue'||explicit === 'support' ? explicit
      : /增建|新建.*球场/.test(item.name) ? 'venue' : /器材制造|球线供应/.test(item.name) ? 'chain' : 'support'
    const hotspot = records(data,'investment_hotspots').find(f=>f.id===feature.properties.hotspotId)
    const location = records(data,'venues').find(f=>f.id===hotspot?.properties.venueId)
    if(category==='venue')continue // Venue leads use the all-courts density mask exclusively.
    list.push({...item,category,group:category==='chain' ? chain.find(s=>(s.topics as readonly string[]).includes(topic))!.id : feature.properties.region,
      topic,region:feature.properties.region, basis:'需求台账',
      anchor:center(location)||center(feature)||pointForRegion(data,region),venueModelFocus:modelFocus(location)})
  }
  // One actionable highest-gap grid for each township, retaining the original cell and population.
  const totals=new Map<string,number>()
  for(const area of blindAreas)totals.set(area.region,(totals.get(area.region)??0)+area.population)
  const seen = new Set<string>()
  for(const area of [...blindAreas].sort((a,b)=>b.population-a.population || a.id.localeCompare(b.id))) {
    if(seen.has(area.region)) continue
    seen.add(area.region)
    const locality=area.region==='京山市'?'镇街待核实片区':area.region
    list.push({...plan('venue:'+area.id,'venue',locality,'场馆运营',area.region,locality+'补建网球场地',
      '社区网球场建设与运营','全部实测场地开放后，'+locality+'仍有 '+intText(totals.get(area.region)!)+' 人居住在高密度缺口内，优先网格占 '+intText(area.population)+' 人。'),
      basis:'全部场地开放情景',feature:area.feature,blind:area,anchor:center(area.feature),areaPeople:totals.get(area.region),radiusM})
  }
  return categoryFilter ? list.filter(d=>d.category===categoryFilter) : list
}

export function siteOptions(lead:Demand,data:Dataset[]):SiteOption[] {
  if(!lead.anchor)return []
  const at=lead.anchor, options:SiteOption[]=[]
  for(const feature of records(data,reserveLayerId)){
    if(!eligibleReserve(feature))continue
    const p=feature.properties, point=p.center
    const loc=Array.isArray(point) && point.length===2 && point.every(Number.isFinite) ? point as Coordinate : center(feature)
    if(!loc)continue
    const distance=distanceM(at,loc)
    if(lead.category==='chain' ? lead.region!=='京山市' && p.region!==lead.region : distance>(lead.radiusM??supportRadiusM))continue
    options.push({id:feature.id,name:p.name,feature:reserveMapFeature({...feature,properties:{...p,leadId:lead.id}}),area:Number(p.area),use:String(p.landUse),distanceM:distance,
      facts:[['所在片区',String(p.region)+' · '+String(p.surveyUnit)],['调查地类',String(p.landUse)],['调查图斑',String(p.surveyParcel)],['调查年度','2022 年'],
        ['调查面积',Number(p.area).toLocaleString('zh-CN')+' ㎡'],...(lead.category==='chain'?[]:[['距需求中心',(distance/1000).toFixed(2)+' 公里'] as [string,string]]),['城镇开发边界',urbanExtentText(feature)],['保护线核查','已避让生态保护红线、永久基本农田'],['选址研判',urbanPlacement(feature).action+'。'+urbanPlacement(feature).note],['储备状态','拟储备·待核实']]})
  }
  return options.sort((a,b)=>urbanPlacement(a.feature).rank-urbanPlacement(b.feature).rank || a.distanceM-b.distanceM || b.area-a.area || a.id.localeCompare(b.id))
}
export function investmentOverviewMap(list:Demand[], data:Dataset[], region:string, context:boolean, gaps:BlindArea[]=[]):InvestmentMap {
  const features:CityFeature[] = []
  const pins:CityFeature[] = []
  const local = (f:CityFeature) => region==='京山市' || f.properties.region===region
  const hotspots = records(data,'investment_hotspots',region).filter(f=>!f.properties.sample)
  const venues = records(data,'venues',region)
  const located = list.filter(d=>d.anchor && (d.feature || d.support))
  const scopedHotspots = hotspots.filter(f=>context || located.some(d=>d.feature?.properties.hotspotId===f.id))
  const scopedProjects = records(data,'projects',region).filter(f=>!f.properties.sample && (context || located.some(d=>d.parcelId && d.parcelId===f.properties.parcelId)))
  const area = (feature:CityFeature,id:string,props:Partial<CityFeature['properties']>) => {
    if(feature.geometry.type!=='Polygon' && feature.geometry.type!=='MultiPolygon') return
    features.push({...feature,id,properties:{...feature.properties,interactive:false,showLabel:false,...props}})
  }
  const addPin = (id:string,at:Coordinate,props:CityFeature['properties']) => {
    pins.push({id,type:'Feature',geometry:{type:'Point',coordinates:at},properties:props})
  }
  for(const hotspot of scopedHotspots) {
    const venue=venues.find(f=>f.id===hotspot.properties.venueId)
    const at=center(venue)
    const radius=Number(hotspot.properties.radiusMeters)
    const range=at && radius>0
      ? circle(hotspot.id,hotspot.properties.name,'investment-radius',hotspot.properties.region,at,radius,'#5caefe')
      : hotspot
    area(range,'overview:hotspot:'+hotspot.id,{mapRole:'range',legendLabel:'场馆需求服务圈',color:'#5caefe',dashed:true})
    if(!at || !venue)continue
    const related=located.find(d=>d.support?.venue.id===venue.id) || located.find(d=>d.feature?.properties.hotspotId===hotspot.id)
    addPin('overview:venue:'+venue.id,at,{...venue.properties,mapRole:'venue',color:'#79d6fd',legendLabel:'关联场馆',
      leadId:related?.id,interactive:!!related})
  }
  for(const project of scopedProjects) {
    const at=center(project)
    if(!at)continue
    const related=located.find(d=>d.parcelId && d.parcelId===project.properties.parcelId)
    const props={...project.properties,mapRole:'project',color:'#ffd15e',legendLabel:'在册招商项目',
      leadId:related?.id,interactive:!!related}
    area(project,'overview:project-area:'+project.id,{...props,legendLabel:false})
    addPin('overview:project:'+project.id,at,props)
  }
  const gapRegions=new Set(located.filter(d=>d.blind).map(d=>d.region))
  for(const g of gaps) {
    if(!gapRegions.has(g.region) || !local(g.feature))continue
    area(g.feature,'overview:gap:'+g.id,{mapRole:'opportunity',color:'#df765e',legendLabel:'场馆覆盖缺口'})
  }
  for(const d of located) {
    const at=(!d.blind && d.feature ? center(d.feature):d.anchor) || d.anchor!
    if(d.feature && local(d.feature) && !d.blind)area(d.feature,'overview:need-area:'+d.id,
      {mapRole:'opportunity',legendLabel:'台账需求范围',color:'#fd925e',leadId:d.id,interactive:true})
    addPin('demand:'+d.id,at,{name:d.name,region:d.region,kind:'investment-demand',mapRole:'demand',leadId:d.id,
      color:d.category==='venue'?'#ffa168':'#6dd7ce',legendLabel:demandCategories[d.category]})
  }
  // Keep nearby labels available on zoom; at each scale only a spaced subset is legible.
  const anchors:Coordinate[]=[]
  if(!context)pins.sort((a,b)=>Number(b.properties.mapRole==='demand')-Number(a.properties.mapRole==='demand'))
  for(const pin of pins) {
    const at=center(pin)!
    const labelHeight=anchors.reduce((nearest,p)=>Math.min(nearest,Math.max(
      distanceM(at,[p[0],at[1]])*8, distanceM(at,[at[0],p[1]])*25)),Infinity)
    pin.properties.showLabel=labelHeight>320
    if(Number.isFinite(labelHeight))pin.properties.labelMaxDistance=Math.max(300,labelHeight)
    if(pin.properties.mapRole==='demand')pin.properties.labelMaxDistance=Math.min(16000,Number(pin.properties.labelMaxDistance??16000))
    anchors.push(at)
  }
  features.push(...pins)
  const courtFootprints = located.some(d=>d.category==='venue') || scopedHotspots.length ? {region} : undefined
  if(context || !anchors.length)return {features,focus:'county',courtFootprints}
  const west=Math.min(...anchors.map(p=>p[0])), east=Math.max(...anchors.map(p=>p[0]))
  const south=Math.min(...anchors.map(p=>p[1])), north=Math.max(...anchors.map(p=>p[1]))
  const anchor:Coordinate=[(west+east)/2,(south+north)/2]
  const span=Math.max(distanceM([west,anchor[1]],[east,anchor[1]]),distanceM([anchor[0],south],[anchor[0],north]))
  return {features,focus:'area',anchor,height:Math.max(8500,span*2.3),courtFootprints}
}
export function demandMap(lead:Demand,options:SiteOption[],selected:string,locateParcel=false):InvestmentMap {
  const at=lead.anchor
  if(!at)return {focus:'county',features:[]}
  const features:CityFeature[]=[], support=lead.category==='support', radius=lead.radiusM??supportRadiusM
  if(lead.category!=='chain'){
    const label=(radius/1000)+' 公里'+(support?'配套筛查圈':'服务半径')
    const ring=circle(lead.id+':range',label,'investment-radius',lead.region,at,radius,'#56aaff')
    Object.assign(ring.properties,{mapRole:'range',legendLabel:label,interactive:false,showLabel:false})
    features.push(ring)
    for(const item of lead.support?.items??[])for(const f of item.nearby)features.push({...f,
      properties:{...f.properties,mapRole:'support',legendLabel:item.label,supportKind:f.properties.kind,showLabel:false}})
    features.push({type:'Feature',id:lead.id+':anchor',geometry:{type:'Point',coordinates:at},properties:{kind:'investment-anchor',mapRole:'venue',
      name:lead.support?.venue.properties.name ?? (support?lead.name:'优先缺口网格'),region:lead.region,color:'#ffc335',serviceRangeCenter:true}})
  }
  const chosen=options.find(o=>o.id===selected)
  if(chosen)features.push(reserveMapFeature(chosen.feature,true))
  if(chosen && (locateParcel || lead.category==='chain'))return {features,focus:'area',anchor:center(chosen.feature),height:2200}
  if(lead.category==='chain')return {features,focus:'county'}
  return {features,focus:lead.venueModelFocus?'model':'area',venueModelFocus:lead.venueModelFocus,anchor:at,courtFootprints:{radiusM:radius},height:Math.max(3200,radius*3.6)}
}
export function matchedEnterprises(lead:Demand,data:Dataset[]) {
  if(lead.support){
    const labels=new Set(lead.support.missing.map(i=>i.label))
    const kinds:Record<string,string>={medical:'医疗',food:'餐饮',commerce_food:'餐饮',parking:'停车',shopping:'日用品零售',commerce_retail:'日用品零售'}
    const matches=data.filter(d=>labels.has(kinds[d.id])).flatMap(d=>d.features).filter(f=>!f.properties.sample && f.geometry)
    const at=lead.support.anchor
    const meters=(f:CityFeature)=>{const loc=center(f);return loc?distanceM(at,loc):Infinity}
    return matches.sort((a,b)=>meters(a)-meters(b) || a.properties.name.localeCompare(b.properties.name,'zh-CN'))
  }
  const matches=scopeEnterprises(buildChainCatalog(data,'京山市'),null,lead.topic).map(row=>row.feature)
  return matches.sort((a,b)=>Number(b.properties.region===lead.region)-Number(a.properties.region===lead.region) || a.properties.name.localeCompare(b.properties.name,'zh-CN'))
}
export function demandFacts(lead:Demand,data:Dataset[],region:string,mode:'demo'|'live'):[string,string][] {
  if(lead.category==='chain'){
    const stage=chain.find(s=>(s.topics as readonly string[]).includes(lead.topic))!
    const output=buildScaleOutput(data,region,mode)
    const amount=output.amount(stage.id,lead.topic), full=output.amount()
    const count=matchedEnterprises(lead,data).filter(f=>region==='京山市'||f.properties.region===region).length
    return [['所属阶段',stage.id+' · '+lead.topic],['本地相关企业',count+' 家'],[(output.year?output.year+' 年':'年度')+'环节产值'+(output.basis==='estimate'?'估值':''),amount===null?'待采集':formatIndustryOutput(amount)+' 亿元'],['占全链产值',full && amount!==null ? (100*amount/full).toFixed(1)+'%' : '待核算'],['需求缺口金额','待采购与外采台账核实']]
  }
  if(lead.category==='venue')return [['所属镇街',lead.group],['全开放服务半径',(Number(lead.radiusM)/1000)+' 公里'],['镇街高密度缺口',intText(lead.areaPeople??0)+' 人'],
    ['优先网格未覆盖人口',intText(lead.blind?.population??0)+' 人'],['建议补足场地',lead.blind?.gap+' 片']]
  if(!lead.support)return [['需求来源',lead.basis],['需求业态',lead.direction]]
  return [['关联场馆',lead.support.venue.properties.name],['筛查半径','1 公里'],...lead.support.items.map((i):[string,string]=>
    [i.label,i.inventoried ? (i.count ? i.count+' 处已登记' : '圈内未检索到') : '台账待核实'])]
}
const projectStages = [
  ['规划', '储备', '拟建'],
  ['对接', '已对接', '对接中'],
  ['在谈', '洽谈', '洽谈中'],
  ['签约', '已签约'],
  ['落地', '已落地', '在建', '投产', '已投产', '运营', '完工', '已完工'],
]

function projectStage(project: CityFeature) {
  const status = textField(project, 'status').trim()
  const stage = projectStages.findIndex(labels => labels.includes(status))
  const signed = stage === 3 || Boolean(textField(project, 'signedAt').trim())
  return { signed, stage: Math.max(stage, signed ? 3 : 0) }
}

export function investmentOverview(data: Dataset[], region: string, leads: Demand[], tasks: Result[]) {
  const projects = records(data, 'projects', region)
  const progress = projects.map(projectStage)
  const funnel = ['项目储备', '对接及后续', '洽谈及后续', '签约及后续', '已落地'].map((label, stage) => ({
    label, count: progress.filter(project => project.stage >= stage).length,
  }))
  function amount(key: string) {
    const values = projects.map(project => project.properties[key])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    return values.length ? intText(values.reduce((sum, value) => sum + value, 0)) + ' 万元' : '待登记'
  }
  const cards = [
    ['本类需求', leads.length + ' 项'],
    ['在谈项目', progress.filter(project => project.stage === 2).length + ' 项'],
    ['签约项目', progress.filter(project => project.signed).length + ' 项'],
    ['落地项目', funnel[4].count + ' 项'],
    ['协议总投资', amount('contractInvestmentWan')],
    ['到位资金', amount('receivedInvestmentWan')],
  ]
  const reminders = tasks.filter(task => task.status !== 'completed' &&
    (region === '京山市' || task.features.some(feature => feature.properties.region === region)))
    .map(task => ({ id: task.id, name: task.title, detail: task.status === 'pending' ? '待签收' : '办理中' }))
  const conversion = projects.length ? (100 * funnel[4].count / projects.length).toFixed(1) + '%' : '待核算'
  return { cards, funnel, projects, reminders, conversion }
}
