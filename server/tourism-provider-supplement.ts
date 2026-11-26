import { readFileSync } from 'node:fs'
import type { CityFeature, DataDocument, Dataset } from '../src/jingshan/types.ts'
import { tourismProviderId, providerTypes } from '../src/jingshan/tourism-providers.ts'

export function withTourismProviders(doc: DataDocument): DataDocument {
  if (doc.datasets.some(dataset => dataset.id === tourismProviderId)) return doc
  const features: CityFeature[] = JSON.parse(readFileSync(new URL('./resource-sources/tourism-providers-1120.json', import.meta.url), 'utf8'))
  const dataset: Dataset = {
    id: tourismProviderId, name: '文旅服务机构', category: '文旅资源', department: '市文化和旅游局',
    description: '旅行社、网球俱乐部及非学科类校外培训机构名录。来源为11月20日文旅一张图台账。',
    formSchema: { fields: [
      {key:'providerType',label:'机构类型',type:'select',options:[...providerTypes],required:true},
      {key:'classification',label:'业务类别',type:'text'},
      {key:'address',label:'台账地址',type:'text'},
      {key:'grade',label:'等级',type:'text'},
      {key:'registeredDate',label:'注册日期',type:'date'},
      {key:'permitNumber',label:'经营许可证号',type:'text'},
      {key:'reportedCourtInfo',label:'填报场地情况',type:'text'},
      {key:'venueName',label:'关联场馆',type:'text'},
      {key:'venueRelation',label:'场馆关系',type:'text'},
      {key:'locationPrecision',label:'定位精度',type:'text'},
      {key:'locationName',label:'定位参照物',type:'text'},
      {key:'locationAddress',label:'地图登记地址',type:'text'},
      {key:'locationSource',label:'点位来源',type:'text'},
      {key:'sourceRow',label:'原表行号',type:'number'},
    ]}, features,
  }
  return {...doc,datasets:[...doc.datasets,dataset]}
}

