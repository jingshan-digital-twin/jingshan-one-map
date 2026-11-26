import type { FeatureCollection } from 'geojson'
import type { CimService } from './cim-types.ts'
import type { CityFeature, Dataset } from './types.ts'

export function identifiedServiceFeatures(data:FeatureCollection):FeatureCollection{
  if(data?.type!=='FeatureCollection' || !Array.isArray(data.features))throw Error('服务未返回可查询的要素集合。')
  const used=new Set<string>()
  return {...data,features:data.features.map((feature,index)=>{
    const p=feature.properties
    let id=String(feature.id??p?.OBJECTID??p?.objectid??p?.FID??('record-'+(index+1)))
    while(used.has(id))id+='_'
    used.add(id)
    return feature.id===id?feature:{...feature,id}
  })}
}

export async function readServiceAttributes(service:CimService,signal:AbortSignal):Promise<Dataset>{
  const response=await fetch(service.mapUrl,{signal})
  if(!response.ok)throw Error('服务要素读取失败（'+response.status+'）')
  const data=identifiedServiceFeatures(await response.json())
  const features:CityFeature[]=data.features.map(f=>{
    const p=f.properties??{}
    return {...f,id:String(f.id),geometry:f.geometry??{type:'GeometryCollection',geometries:[]},
      properties:{...p,name:String(p.name??p['名称']??f.id),region:String(p.region??''),kind:String(p.kind??service.kind)}}
  })
  return {id:service.id,name:service.name,category:service.category,department:'',description:service.description,features}
}
