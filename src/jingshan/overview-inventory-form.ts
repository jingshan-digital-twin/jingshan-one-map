import { overviewCourtStatsId } from './estimated-court-inventory.ts'
import type { Dataset, FormField } from './types.ts'

const quantities = {
  venues: '网球场馆（处）', courts: '网球场地（片）',
  stateCourts: '国有（片）', schoolCourts: '学校（片）', officeCourts: '机关（片）', privateCourts: '民营（片）',
  fullOpenCourts: '全面开放（片）', timedOpenCourts: '错时开放（片）', closedCourts: '未开放（片）',
  nationalSites: '可承办国际、全国赛事（处）',
}

// Older publications used four ownership groups. Expose the new column without changing their records.
export function withVillageCourtField(dataset: Dataset): Dataset {
  const schema = dataset.formSchema
  if (dataset.id !== overviewCourtStatsId || !schema || schema.fields.some(field => field.key === 'villageCourts')) return dataset
  const fields = [...schema.fields]
  const afterPrivate = fields.findIndex(field => field.key === 'privateCourts') + 1
  fields.splice(afterPrivate, 0, {key:'villageCourts', label:'村镇（片）', type:'number'})
  return {...dataset, formSchema:{...schema, fields}}
}

export function createOverviewCourtStats(): Dataset {
  const fields: FormField[] = Object.entries(quantities).map(([key,label]) => ({key,label,type:'number',required:true}))
  fields.push({key:'estimated',label:'暂估数据',type:'boolean',required:true,defaultValue:true})
  return withVillageCourtField({
    id:overviewCourtStatsId, name:'首页场地家底统计', department:'文旅局', category:'首页统计',
    description:'一图总览左栏按乡镇汇总场馆、场地、权属、开放程度和赛事承办场馆数。',
    formSchema:{fields},
    features:[], 
  })
}

export function checkOverviewCourtStats(dataset: Dataset) {
  if (!dataset.formSchema) throw new Error('首页场地家底统计需使用业务表单')
  const fields = new Map(dataset.formSchema.fields.map(f=>[f.key, f.type]))
  if (Object.keys(quantities).some(key=>fields.get(key)!=='number') || fields.get('estimated')!=='boolean') {
    throw new Error('首页场地家底统计需保留场馆、场地、分类统计及暂估字段')
  }
  if (fields.has('villageCourts') && fields.get('villageCourts') !== 'number') throw new Error('村镇（片）需使用数值字段')
  const regions = new Set(['新市街道','永兴街道','温泉街道','曹武镇','罗店镇','宋河镇','坪坝镇','三阳镇','绿林镇','杨集镇','孙桥镇','石龙镇','永漋镇','雁门口镇','钱场镇'])
  const present = new Set<string>()
  for (const row of dataset.features) {
    const p = row.properties
    if (row.geometry.type!=='GeometryCollection' || row.geometry.geometries.length) throw new Error('乡镇场地汇总记录应留空位置')
    if (!regions.has(p.region) || present.has(p.region)) throw new Error('请选择京山市乡镇或街道，每个区域仅保留一条家底统计')
    present.add(p.region)
    if (typeof p.estimated !== 'boolean') throw new Error('请选择是否使用暂估数据')
    for (const [key,label] of Object.entries(quantities)) {
      const value = p[key]
      if (typeof value!=='number'||!Number.isSafeInteger(value)||value<0) throw new Error(p.region+'：'+label+'需填写非负整数')
    }
    const village = p.villageCourts
    if (village != null) {
      if (!fields.has('villageCourts')) throw new Error('请在首页家底表单中保留村镇（片）字段')
      if (typeof village !== 'number' || !Number.isSafeInteger(village) || village < 0)
        throw new Error(p.region+'：村镇（片）需填写非负整数')
      const total = ['stateCourts', 'schoolCourts', 'officeCourts', 'privateCourts'].reduce((n,key) => n + Number(p[key]), village)
      if (total !== p.courts) throw new Error(p.region+'：五类权属片数之和应等于网球场地总片数')
    }
  }
}

