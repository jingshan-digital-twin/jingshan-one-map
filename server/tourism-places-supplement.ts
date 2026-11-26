import { readFileSync } from 'node:fs'
import { fusionDestinationDataset, fusionDestinationsId } from '../src/jingshan/fusion-destinations.ts'
import type { CityFeature, Coordinate, DataDocument, Dataset, FormField } from '../src/jingshan/types.ts'
import { checkDataset } from '../src/jingshan/validate.ts'

type Site = {sequence:number; name:string; address:string; resourceClass:string; grade?:string; operator?:string; scaleEnterprise?:string}
type SiteLocation = {sequence:number; position?:Coordinate; precision:string; source:string; sourceUrl?:string; verifiedAddress?:string; town?:string}
const workbookName = '11.20 （文旅）京山市网旅产业“一张图”数据.xlsx'
const aliases:Record<number,string> = {1:'绿林山风景区',2:'太子山生态旅游区',3:'花台山',4:'潼泉湖休闲旅游区',5:'紫薇园',6:'月季园'}
const extraFields:FormField[] = [
  {key:'resourceClass',label:'文旅分类',type:'text'}, {key:'grade',label:'景区等级',type:'text'},
  {key:'address',label:'地址',type:'text'}, {key:'operator',label:'运营主体',type:'text'},
  {key:'registerAddress',label:'原表地址',type:'text'},
  {key:'scaleEnterprise',label:'规上企业',type:'select',options:['是','否']},
  {key:'locationPrecision',label:'定位类型',type:'text'}, {key:'locationUrl',label:'位置出处',type:'text'},
  {key:'registerSource',label:'来源台账',type:'text'}, {key:'registerRow',label:'台账行号',type:'number'},
]
function readRows<T>(file:string):T[] {
  return JSON.parse(readFileSync(new URL('./resource-sources/'+file,import.meta.url),'utf8'))
}

export function withTourismPlaces(doc:DataDocument):DataDocument {
  const register=doc.datasets.find(d=>d.id===fusionDestinationsId)
  if (!register?.formSchema) return doc
  const sites=readRows<Site>('tourism-sites-1120.json')
  const locations=new Map(readRows<SiteLocation>('tourism-locations-1120.json').map(row=>[row.sequence,row]))
  const original=doc.datasets.find(d=>d.id==='tourism')
  const firstTianmu=fusionDestinationDataset().features.find(f=>f.id==='fusion-place-tianmu')
  const additions:CityFeature[]=[]
  const updates=new Map<string,CityFeature>()
  const nativeUpdates=new Map<string,CityFeature>()
  for (const site of sites) {
    const location=locations.get(site.sequence)
    if (!location) throw Error('缺少游览地定位记录：'+site.name)
    const native=original?.features.find(f=>f.properties.name===site.name || f.properties.name===aliases[site.sequence])
    const id=site.sequence===12?'fusion-place-tianmu':'fusion-place-wl1120-'+site.sequence
    const saved=register.features.find(f=>f.id===id || (f.properties.scope==='京山' && f.properties.name===site.name))
    if (saved?.properties.registerSource===workbookName) continue
    const position=location.position
    if (position && !(position.length===2 && position[0]>=112.6 && position[0]<=113.8 && position[1]>=30.5 && position[1]<=31.7))
      throw Error('游览地不在京山范围：'+site.name)
    const fields={name:site.name,address:location.verifiedAddress || site.address,registerAddress:site.address,resourceClass:site.resourceClass,operator:site.operator,
      grade:site.grade,scaleEnterprise:site.scaleEnterprise,registerSource:workbookName,registerRow:site.sequence+2}
    const geometry:CityFeature['geometry']=position?{type:'Point',coordinates:[...position]}:{type:'GeometryCollection',geometries:[]}
    const isOriginal=saved?.id===firstTianmu?.id && JSON.stringify(saved?.geometry)===JSON.stringify(firstTianmu?.geometry)
    const keepPoint=saved?.geometry.type==='Point' && (!isOriginal || !position)
    const record:CityFeature={id:saved?.id??id,type:'Feature',geometry:keepPoint?saved.geometry:geometry,
      properties:{kind:'fusion-destination',city:'京山市',scope:'京山',status:'展示',
        category:site.name.includes('温泉')?'温泉':'景区',...(native?{sourceId:native.id}:{}),...fields,...saved?.properties,
        region:location.town || native?.properties.region || saved?.properties.region || '京山市',
        locationPrecision:keepPoint?saved.properties.locationPrecision || '场所':location.precision,
        locationSource:keepPoint?saved.properties.locationSource:location.source,locationUrl:keepPoint?saved.properties.locationUrl:location.sourceUrl}}
    if (saved) updates.set(saved.id,record)
    else additions.push(record)
    if (native) {
      const properties={...fields,...native.properties,tourismRegisterId:record.id}
      const point=native.geometry.type==='Point'?native.geometry.coordinates:undefined
      // Source services may specify a survey point. Only replace a known out-of-county location.
      const displaced=point && !(point[0]>=112.6 && point[0]<=113.8 && point[1]>=30.5 && point[1]<=31.7)
      nativeUpdates.set(native.id,{...native,properties, ...(displaced && position && location.precision!=='村级参考'
        ? {geometry,properties:{...properties,locationPrecision:location.precision,locationSource:location.source,locationUrl:location.sourceUrl}}:{})})
    }
  }
  const fields=extraFields.filter(f=>!register.formSchema!.fields.some(old=>old.key===f.key))
  if (!additions.length && !updates.size && !fields.length) return doc
  const enriched:Dataset={...register,formSchema:{...register.formSchema,fields:[...register.formSchema.fields,...fields]},
    features:[...register.features.map(f=>updates.get(f.id)??f),...additions]}
  checkDataset(enriched)
  return {...doc,datasets:doc.datasets.map(d=>d===register?enriched:d===original && nativeUpdates.size?
    {...d,features:d.features.map(f=>nativeUpdates.get(f.id)??f)}:d)}
}
