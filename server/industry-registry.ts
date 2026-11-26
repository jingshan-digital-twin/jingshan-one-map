import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { chain, enterpriseDirectoryId, type ChainStage, type ChainTopic } from '../src/jingshan/chain-taxonomy.ts'
import type { CityFeature, DataDocument, Dataset } from '../src/jingshan/types.ts'
import { checkDocument } from '../src/jingshan/validate.ts'

type EnterpriseRecord = {
  name: string
  stage: ChainStage
  topics: ChainTopic[]
  mainBusiness: string
  sources: {title:string; url:string; evidence:string; date?:string}[]
  region?: string
  siteNames?: string[]
  siteRegion?: string
  sitePoint?: {name:string; source:string; url:string; originalCrs:string; originalCoordinates:[number,number]; wgs84:[number,number]; conversion:string}
  creditCode?: string
  [field:string]: unknown
}

function enterpriseFeature(record: EnterpriseRecord, places: CityFeature[]): CityFeature {
  const {stage, topics, siteNames = [], siteRegion, ...fields} = record
  const taxonomy = chain.find(item => item.id === stage)
  if (!taxonomy || !topics.length || !topics.every(topic => (taxonomy.topics as readonly string[]).includes(topic))) {
    throw new Error(record.name + '的产业链环节有误')
  }

  // Match only a uniquely named, verified operating site in a compatible township.
  const location = siteNames.map(name => places.filter(site => site.properties.name === name))
    .find(sites => sites.length === 1 && (!siteRegion || sites[0].properties.region === siteRegion))?.[0]
  const id = 'business-js-' + createHash('sha256').update(record.name.normalize('NFKC')).digest('hex').slice(0,20)
  const properties: CityFeature['properties'] = {
    ...fields, kind:'business', name:record.name, region:record.region || '京山市',
    segment:stage, subtype:topics[0], chainTopics:topics, siteNames, sourceServiceId:enterpriseDirectoryId,
  }
  if (location) {
    properties.locationLabel = '运营场所 · ' + location.properties.name
    properties.locationSource = location.properties.source
    properties.locationFeatureId = location.id
  }
  if (!location && record.sitePoint) {
    properties.locationLabel = record.sitePoint.name + '（近似位置）'
    properties.locationSource = record.sitePoint.source
    return {id, type:'Feature', properties, geometry:{type:'Point', coordinates:record.sitePoint.wgs84}}
  }
  return {id, type:'Feature', properties, geometry:location?.geometry ?? {type:'GeometryCollection', geometries:[]}}
}

export async function withEnterpriseDirectory(document: DataDocument): Promise<DataDocument> {
  const batches = await Promise.all(['upstream','middle','downstream'].map(async file =>
    JSON.parse(await readFile(new URL('./industry-sources/' + file + '.json', import.meta.url),'utf8')) as EnterpriseRecord[]
  ))
  const previous = document.datasets.find(dataset => dataset.id === 'businesses')
  if (!previous) throw new Error('找不到产业链企业数据集')
  const places = document.datasets.filter(dataset => ['tourism','cim_parks','schools','cim_squares'].includes(dataset.id) &&
    dataset.source?.serviceId.startsWith('cim-')).flatMap(dataset => dataset.features.filter(feature =>
      feature.geometry.type === 'Point' && feature.properties.sourceServiceId === dataset.source?.serviceId))
  const researched = batches.flat().map(record => enterpriseFeature(record, places))
  const retained = previous.features.filter(feature => feature.properties.sample !== true)
  const names = new Set(retained.map(feature => feature.properties.name.normalize('NFKC')))
  const codes = new Set(retained.map(feature => feature.properties.creditCode).filter(Boolean))
  const features = [...retained, ...researched.filter(feature =>
    !names.has(feature.properties.name.normalize('NFKC')) && (!feature.properties.creditCode || !codes.has(feature.properties.creditCode)))]
  const dataset: Dataset = {
    ...previous, name:'京山产业链企业名录', features,
    description:'按装备与设施供给、网球运营与引流、文旅消费承接收录。环节归属依据公开业务记录，企业档案附来源。一个企业可以涉及多个环节。',
    source:{serviceId:enterpriseDirectoryId, serviceName:'政府公示、企业披露及公开报道', syncedAt:new Date().toISOString(), count:features.length},
  }
  const updated = {...document, datasets:document.datasets.map(item => item.id === dataset.id ? dataset : item)}
  checkDocument(updated)
  return updated
}
