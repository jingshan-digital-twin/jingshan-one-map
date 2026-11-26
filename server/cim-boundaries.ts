import type { Feature, FeatureCollection } from 'geojson'
import type { Pool } from 'pg'
import { checkDataset } from '../src/jingshan/validate.ts'
import type { CityFeature, Dataset } from '../src/jingshan/types.ts'
import { getCimService, fetchCimFeatures } from './cim.ts'
import { simplifyCimAreas } from './cim-geometry.ts'

function boundaryFeature(item: Feature, county: boolean): CityFeature {
  const source = item.properties ?? {}
  const code = String(county ? source.qxxzqhdm ?? '' : source.xzjxzqhdm ?? '')
  const name = county ? source.qxxzqhmc : source.xzjxzqhmc
  if ((county ? code !== '420882' : !/^420882\d{3}$/.test(code)) || !name || source.qxxzqhmc !== '京山市') {
    throw new Error('行政区划来源缺少京山市所属关系、行政区代码或名称')
  }
  const x = Number(source.x), y = Number(source.y)
  const center = Number.isFinite(x) && Number.isFinite(y) && x > 110 && x < 116 && y > 29 && y < 33 ? [x,y] : undefined
  return {
    type: 'Feature', id: 'cim-admin-' + code, geometry: item.geometry,
    properties: {
      name, region: name, kind: county ? 'city-boundary' : 'town-boundary', adcode: code,
      ...(center ? {center} : {}), source: source.sjly || '京山 CIM',
      sourceServiceId: county ? 'cim-05' : 'cim-06', sourceFeatureId: item.id, sourceAttributes: source,
      ...(source.gxsj ? {sourceUpdatedAt: source.gxsj} : {}),
    },
  }
}

export async function fetchCimAdministration(pool: Pool): Promise<Dataset> {
  const [county, towns] = await Promise.all(['cim-05','cim-06'].map(async (id, i) => {
    const service = await getCimService(pool, id)
    const layer = i === 0 ? 'topp:jss_skjc_xzq_qxj' : 'topp:jss_skjc_xzq_xzj'
    if (!service?.enabled || service.layer !== layer) throw new Error('请启用原清单中京山市的县级和乡镇级行政区划服务')
    return fetchCimFeatures({...service, kind: 'wfs', version: '1.1.0'})
  }))
  if (county.features.length !== 1 || towns.features.length < 15) throw new Error('县级或镇街边界返回不完整，已保留当前行政区划')
  const source: FeatureCollection = {type: 'FeatureCollection', features: [
    ...county.features.map(item => boundaryFeature(item, true)),
    ...towns.features.map(item => boundaryFeature(item, false)),
  ]}
  const display = simplifyCimAreas(source, 20)
  const dataset = {
    id: 'administration', name: '京山市行政区划', department: '京山市民政局', category: '行政区划',
    description: '县级和镇街界线来自 CIM 同名 WFS。显示几何按共享边界简化，原始服务保留完整精度。',
    source: {serviceId: 'cim-05,cim-06', serviceName: '京山市区县级、乡镇级行政区划', syncedAt: new Date().toISOString(), count: display.features.length},
    features: display.features,
  }
  checkDataset(dataset)
  return dataset
}
