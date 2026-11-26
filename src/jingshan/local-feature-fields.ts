import type { Dataset } from './types.ts'
import { courtLedgerId, courtSourceField, isCourtLedgerId, ledgerFields, surveyCourtLedgerId } from './court-ledger.ts'

type FieldType = 'text' | 'number' | 'boolean' | 'date' | 'month'
export type LocalField = {key:string; label:string; type:FieldType}
type Properties = Record<string,unknown>
const labels:Record<string,string> = {
  recordSource:'填报来源',sourceRow:'原表行号',locationSource:'定位依据',reviewNote:'核对备注',locationRef:'关联点位编号',enterpriseId:'关联企业编号',
  address:'地址', ownership:'权属', operator:'运营单位', facilityName:'场馆名称', facilityId:'场馆编号',
  open:'对外开放', count:'数量', level:'级别', status:'状态', major:'重点场馆', capacity:'容量',
  indoorCourts:'室内场地数', outdoorCourts:'室外场地数', openingHours:'开放时段', companyOperated:'企业运营',
  courtCode:'场地编号', courtNo:'片号', courtNumber:'片号', indoor:'室内场地', surface:'面层', lighting:'有照明',
  accessible:'无障碍设施', servicePhone:'服务电话', registrationCode:'登记编号',
  date:'日期', endDate:'结束日期', days:'持续天数', host:'主办单位',venue:'举办场馆', venueId:'关联场馆编号',
  players:'运动员人数',spectators:'观赛人数', registered:'报名人数', visitors:'外地人数',attendance:'参与人次',
  companions:'随行人数',scenicVisitors:'景区游览人次',overnightGuests:'过夜人数',secondarySpendVisitors:'二次消费人数',
  spend:'带动消费（万元）', nights:'住宿间夜',stayDays:'停留天数', occupancy:'入住率',
  registrationFee:'报名费',registrationLimit:'报名人数上限',registrationDeadline:'报名截止日期',
  permitStatus:'审批状态',safetyPlanStatus:'安全预案状态',registrationStatus:'报名状态',
  category:'类别', type:'类型', beds:'床位数', rooms:'客房数', price:'价格', available:'可用数量',
  shuttle:'提供接驳', spaces:'车位数', charging:'充电车位数', temporary:'临时设施',grade:'等级',
  seats:'餐位数',cuisine:'菜系',population:'人口数',youth:'青少年人数',cellSize:'网格边长',
  code:'编号',adcode:'行政区划代码',county:'县市',countyCode:'县市代码',regionCode:'行政区代码',communityId:'社区编号',
  use:'用途',area:'面积（平方米）',landUse:'用地类型',roadAccess:'道路通达性',severity:'管控强度',constraint:'约束类型',
  lanes:'车道数',speed:'速度',roadClass:'道路等级',shelter:'设有候车亭',capacityPerHour:'每小时通行量',
  facilityType:'设施类型',minutes:'响应时长（分钟）',personnel:'人员数量',students:'学生人数',teaching:'已开课',
  from:'起点',to:'终点',conversion:'转化率',travelMinutes:'行程时长（分钟）',destinationId:'目的地编号',
  share:'占比',people:'人数',eventId:'关联赛事编号',parcelId:'地块编号',progress:'进度',investment:'投资额',responsibility:'责任单位',
  coaches:'教练数',trainees:'学员数',schoolDistrict:'学区',age6to9:'6 至 9 岁学员',age10to12:'10 至 12 岁学员',
  age13to15:'13 至 15 岁学员',age16to18:'16 至 18 岁学员',joined:'已入驻',rating:'评分',joinedAt:'入驻日期',
  appliedAt:'申请日期',redemptions:'核销次数',reviewCount:'评价数',reviewStatus:'审核状态',complaintsOpen:'待处理投诉数',
  rule:'使用规则',validFrom:'生效日期',validTo:'到期日期',discount:'优惠额度',merchantId:'商户编号',merchantName:'商户名称',
  scope:'适用范围',orders:'订单数',location:'地点',visitorCount:'游客数',month:'统计月份',events:'赛事场次',visits:'访问量',
  bookings:'预约量',activeUsers:'活跃用户数',routeOrders:'线路订单数',outOfTownRate:'外地用户占比',
  registrations:'新增注册数',outOfTownUsers:'外地用户数',registeredUsers:'注册用户数',observedThrough:'统计截止日期',
  eventRegistrations:'赛事报名数',clinicRegistrations:'培训报名数',day:'第几天',present:'当前在场人数',
  attendees:'到场人数',hotelRate:'住宿使用率',parkingRate:'停车使用率',pointsReady:'就绪点位数',
  pointsTotal:'总点位数',hotelCapacity:'住宿容量',hotelOccupied:'已占用床位',incidentCount:'事件数',
  incidentSummary:'事件摘要',shuttleRoutes:'接驳线路数',parkingCapacity:'停车容量',parkingOccupied:'已占用车位',
  temporaryParkingLots:'临时停车场数',shuttleIntervalMinutes:'接驳间隔（分钟）',temporaryParkingRemaining:'临时车位余量',
  radiusMeters:'统计半径（米）',gap:'缺口',demand:'需求量',supply:'供给量',rationale:'研判依据',hotspotId:'热区编号',
  lengthM:'长度（米）',sectionName:'路段范围',sectionCode:'路段编号',startAt:'开始时间',endAt:'结束时间',
  businessPhase:'经营阶段',creditCode:'统一社会信用代码',mainBusiness:'主营业务',registeredCapital:'注册资本',
  legalRepresentative:'法定代表人',registeredAddress:'注册地址',businessScope:'经营范围',established:'成立日期',
}
const datasetLabels:Record<string,Record<string,string>> = {
  charging:{stationCode:'站点编号',siteType:'建设场所',chargeType:'充电类型',completedOn:'建成日期',commissionedOn:'投运日期',
    gunCount:'充电枪数（把）',gunPowerKw:'单枪功率（kW）',totalPowerKw:'总功率（kW）',assetOwner:'资产单位',tariffGroup:'适用电价组',sourceCoordinates:'原表坐标'},
  commerce_hotels:{price:'平均房价（元）',reportedStreet:'原报街道',reportedOn:'填报日期'},
  commerce_food:{reportedStreet:'原报街道',reportedOn:'填报日期'},
  emergency_shelters:{shelterCapacity:'容纳人数',materialDetails:'物资明细',materialQuantity:'原报物资数量',dutyContact:'值班联系人与电话'},
  venues:{count:'场地总数',level:'可承办赛事级别'},events:{date:'开始日期',days:'办赛天数',level:'赛事级别'},
  hotels:{available:'可用床位数',type:'住宿类型'},parking:{available:'可用车位数',accessible:'无障碍车位数'},
  origins:{from:'客源地',to:'流向场馆'},routes:{to:'目的地'},emergency:{available:'当前可用'},
}
const defaults:Record<string,Record<string,FieldType>> = {
  [courtLedgerId]:Object.fromEntries(ledgerFields.map(key => [key,'text' as const])),
  [surveyCourtLedgerId]:Object.fromEntries(ledgerFields.map(key => [courtSourceField(surveyCourtLedgerId,key),'text' as const])),
  charging:{stationCode:'text',siteType:'text',chargeType:'text',gunCount:'number',gunPowerKw:'text',totalPowerKw:'number',
    assetOwner:'text',address:'text',completedOn:'date',commissionedOn:'date',tariffGroup:'text'},
  commerce_hotels:{type:'text',address:'text',rooms:'number',beds:'number',price:'number',locationSource:'text'},
  commerce_food:{type:'text',address:'text',seats:'number',locationSource:'text'},
  emergency_shelters:{address:'text',shelterCapacity:'number',materialDetails:'text',materialQuantity:'number',dutyContact:'text',locationSource:'text'},
  venues:{ownership:'text',operator:'text',count:'number',indoorCourts:'number',outdoorCourts:'number',open:'boolean',openingHours:'text'},
  courts:{courtCode:'text',facilityName:'text',ownership:'text',open:'boolean',surface:'text',lighting:'boolean'},
  events:{date:'date',endDate:'date',days:'number',host:'text',level:'text',venue:'text',players:'number',spectators:'number'},
  hotels:{type:'text',beds:'number',rooms:'number',available:'number',price:'number',shuttle:'boolean'},
  parking:{spaces:'number',available:'number',charging:'number',temporary:'boolean'},
}
const baseKeys = new Set(['name','region','kind'])
const dayPattern = /^\d{4}-\d{2}-\d{2}$/
function fieldType(value:unknown):FieldType|undefined {
  if (typeof value === 'boolean' || typeof value === 'number') return typeof value === 'boolean' ? 'boolean' : 'number'
  if (typeof value !== 'string') return
  if (dayPattern.test(value) && new Date(value+'T00:00:00Z').toJSON()?.slice(0,10) === value) return 'date'
  if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) return 'month'
  return 'text'
}
export function localFieldLabel(datasetId:string,key:string) {
  const specific = Object.hasOwn(datasetLabels,datasetId) ? datasetLabels[datasetId] : {}
  return Object.hasOwn(specific,key) ? specific[key] : Object.hasOwn(labels,key) ? labels[key]
    : /^[\u3400-\u9fff]{1,30}$/.test(key) && !/来源|同步|原始属性/.test(key) ? key : undefined
}
export function localFields(dataset:Dataset, current:Properties = {}):LocalField[] {
  const possible = new Map<string,FieldType>()
  const title = (key:string) => localFieldLabel(dataset.id,key)
  for (const p of [current,...dataset.features.slice(0,48).map(row=>row.properties)]) {
    for (const [key,value] of Object.entries(p)) {
      if (!title(key) || possible.has(key)) continue
      const type = fieldType(value)
      if (type) possible.set(key,type)
    }
  }
  const schemaId=isCourtLedgerId(dataset.id) && dataset.id!==surveyCourtLedgerId ? courtLedgerId : dataset.id
  const preferred = Object.hasOwn(defaults,schemaId) ? defaults[schemaId] : {}
  for (const [key,type] of Object.entries(preferred)) if (!possible.has(key)) possible.set(key,type)
  return [...new Set([...Object.keys(preferred),...possible.keys()])]
    .filter(key => current[key] == null || fieldType(current[key]) !== undefined)
    .map(key => ({key,type:possible.get(key)!,label:title(key)!}))
}
export function extraProperties(fields:LocalField[], properties:Properties):Properties {
  const shown = new Set([...baseKeys,...fields.map(f=>f.key)])
  return Object.fromEntries(Object.entries(properties).filter(([key])=>!shown.has(key)))
}
export function applyLocalProperties(fields:LocalField[], current:Properties, changes:Record<string,string>, extras:unknown):Properties {
  if (!extras || typeof extras !== 'object' || Array.isArray(extras)) throw new Error('扩展属性需为 JSON 对象')
  const result:Properties = {...extras}
  for (const key of baseKeys) if (Object.hasOwn(result,key)) throw new Error(key+' 已有基础字段，请通过表单编辑')
  for (const {key,label,type} of fields) {
    if (Object.hasOwn(result,key)) throw new Error('「'+label+'」已有业务字段，请通过表单编辑')
    if (!Object.hasOwn(changes,key)) {
      if (Object.hasOwn(current,key)) result[key]=current[key]
      continue
    }
    const value = changes[key]
    if (value === '') continue
    if (type === 'number') {
      if (!Number.isFinite(Number(value))) throw new Error(label+' 需填写数值')
      result[key]=Number(value)
    } else if (type === 'boolean') {
      if (!['true','false'].includes(value)) throw new Error(label+' 请选择是或否')
      result[key]=value === 'true'
    } else {
      if ((type === 'date' || type === 'month') && fieldType(value) !== type) throw new Error(label+' 的日期格式有误')
      result[key]=value
    }
  }
  return result
}
