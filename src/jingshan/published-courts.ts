import { api } from './api.ts'
import { boundCourtSource, withCourtLedger } from './court-ledger.ts'
import type { PublishedData, CityFeature, Dataset } from './types.ts'

export async function readDeferredPopulation(snapshot:PublishedData,signal:AbortSignal):Promise<PublishedData|undefined>{
  const blocks=await Promise.all((snapshot.deferredPopulation??[]).map(id=>
    api<{dataset:Dataset;version:number}>('/layers/'+encodeURIComponent(id)+'/population-blocks',{signal})))
  if(blocks.some(row=>row.version!==snapshot.version))return
  const sources=new Map(blocks.map(({dataset})=>[dataset.id,dataset]))
  const {deferredPopulation:_,...published}=snapshot
  return {...published,data:{...published.data,datasets:published.data.datasets.map(d=>sources.get(d.id)??d)}}
}

export async function readPublishedMap(deferPopulation=false):Promise<PublishedData> {
  // Each snapshot and its separately cacheable service response must refer to one release.
  for (let attempt=0; attempt<3; attempt++) {
    const snapshot=await api<PublishedData>('/data?courtSource=service'+(deferPopulation?'&population=deferred&reserves=deferred':''))
    const id=boundCourtSource(snapshot.data)
    const ledger=snapshot.data.datasets.find(d=>d.id===id)
    if (!ledger) return snapshot
    const datasetId=encodeURIComponent(ledger.id)
    let response=await fetch('/api/jingshan/cim/services/hosted-'+datasetId+'/features',{cache:'no-cache'})
    if([502,503,504].includes(response.status)){
      // The hosted service and its canonical resource both carry the publication version.
      response=await fetch('/api/jingshan/layers/'+datasetId+'/features.geojson',{cache:'no-cache'})
    }
    if (!response.ok) throw Error('网球场地服务读取失败（'+response.status+'）')
    if (response.headers.get('X-Publication-Version')!==String(snapshot.version)) continue
    const collection=await response.json() as {type:string;features:CityFeature[]}
    if (collection.type!=='FeatureCollection' || !Array.isArray(collection.features)) throw Error('网球场地服务缺少要素集合')
    return {...snapshot,data:withCourtLedger(snapshot.data,{...ledger,features:collection.features})}
  }
  throw Error('网球场地服务正在切换发布版本，请刷新重试')
}
