import type { Pool } from 'pg'
import type { CityFeature, Dataset } from '../src/jingshan/types.ts'
import { checkDataset } from '../src/jingshan/validate.ts'
import { getCimService, fetchCimFeatures } from './cim.ts'
import { simplifyCimAreas } from './cim-geometry.ts'

/** The workbook publishes this GeoServer type as WMS and the same type exposes WFS geometries. */
export async function fetchCimCommunities(pool: Pool): Promise<Dataset> {
  const service = await getCimService(pool, 'cim-07')
  if (!service?.enabled || service.kind !== 'wms' || service.layer !== 'topp:jss_skjc_xzq_sqcj') {
    throw new Error('请启用并核对 CIM 村社区级行政区划图层。')
  }
  const complete = await fetchCimFeatures({ ...service, kind:'wfs', version:'1.1.0' }, 100)
  if (!complete.features.length) throw new Error('村社区服务未返回行政区划，已保留原数据。')
  const areas = simplifyCimAreas(complete, 10)
  const features: CityFeature[] = areas.features.map(f => {
    const raw = f.properties || {}
    const code = String(raw.sqjcwhdm ?? '').trim()
    const name = String(raw.sqjcwhmc ?? '').trim()
    const region = String(raw.xzjxzqhmc ?? '').trim()
    if (!/^\d{12}$/.test(code) || !name || !region || !['Polygon','MultiPolygon'].includes(f.geometry?.type)) {
      throw new Error('村社区区划缺少有效行政代码、名称、镇街或面几何，已停止同步。')
    }
    return {
      type:'Feature', id:'cim-community-' + code, geometry:f.geometry,
      properties:{
        name, region, code, kind:'community', color:'#6495ff',
        regionCode:raw.xzjxzqhdm, county:raw.qxxzqhmc, countyCode:raw.qxxzqhdm,
        source:service.name, sourceServiceId:service.id, sourceFeatureId:String(f.id ?? code),
        sourceDepartment:raw.sjly, sourceUpdatedAt:raw.gxsj, sourceAttributes:raw,
      },
    }
  })
  const dataset: Dataset = {
    id:'communities', name:'村社区行政区划', department:'京山市民政局', category:'行政区划',
    description:'CIM 村社区级行政区划。业务查询使用简化边界，原始边界可在同名 WMS 图层查看。',
    source:{serviceId:service.id,serviceName:service.name,syncedAt:new Date().toISOString(),count:features.length},
    features,
  }
  checkDataset(dataset)
  return dataset
}
