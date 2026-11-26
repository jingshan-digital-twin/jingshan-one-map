import type { Dataset } from './types.ts'

export const chain = [
  {id:'上游', title:'装备与设施供给', topics:['器材制造','运动服饰','场地建设']},
  {id:'中游', title:'网球运营与引流', topics:['场馆运营','俱乐部运营','培训陪练','赛事组织']},
  {id:'下游', title:'文旅消费承接', topics:['住宿接待','餐饮服务','景区游览','运动康养','购物展销']},
] as const

export type ChainStage = typeof chain[number]['id']
export type ChainTopic = typeof chain[number]['topics'][number]

export const enterpriseDirectoryId = 'public-enterprise-directory'
export const hasEnterpriseDirectory = (datasets: Dataset[]) => datasets.some(
  dataset => dataset.id === 'businesses' && dataset.source?.serviceId === enterpriseDirectoryId,
)
