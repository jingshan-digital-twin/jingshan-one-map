import { fusionArrivalsId } from '../src/jingshan/fusion-arrivals.ts'
import type { CityFeature, DataDocument, Dataset } from '../src/jingshan/types.ts'

const cityNames = ['武汉市','荆门市','襄阳市','宜昌市','孝感市']
// Fixed examples for the demonstration release. Each row represents an independent daily report.
const demoDays = [
  ['2026-11-18', [948,518,290,217,176], [283,198,82,71,56]],
  ['2026-11-19', [997,532,321,240,189], [294,202,94,74,64]],
  ['2026-11-20', [1188,625,365,284,241], [367,240,113,89,72]],
  ['2026-11-21', [1612,870,515,412,308], [519,346,147,130,98]],
  ['2026-11-22', [1446,792,468,351,275], [454,303,142,107,86]],
  ['2026-11-23', [894,541,285,219,174], [271,201,86,66,50]],
  ['2026-11-24', [1048,608,312,265,204], [317,212,91,83,62]],
] as const

function demoRecords():CityFeature[] {
  return demoDays.flatMap(([reportDate,people,vehicles])=>{
    const record = (originCity:string, people:number, vehicles:number, index:number):CityFeature => ({
      type:'Feature', id:'fusion-arrival-demo-'+reportDate+'-'+index,
      geometry:{type:'GeometryCollection',geometries:[]},
      properties:{name:reportDate+' · '+(originCity || '全市汇总'), kind:'form_record', region:'京山市',
        reportDate, rowType:originCity?'客源分项':'全市汇总', ...(originCity?{originCity}:{}),
        people, vehicles, sourceName:'演示日报', sample:true},
    })
    const total=record('',people.reduce((a,b)=>a+b,0),vehicles.reduce((a,b)=>a+b,0),0)
    return [total,...cityNames.map((name,i)=>record(name,people[i],vehicles[i],i+1))]
  })
}

export function withFusionArrivals(doc:DataDocument):DataDocument {
  if (doc.datasets.some(d=>d.id===fusionArrivalsId)) return doc
  const table:Dataset={
    id:fusionArrivalsId,name:'来京山客流车流日报',department:'文旅局',category:'融合发展',
    description:'按北京时间自然日汇总市外来京山的人数与车辆数，同人、同车当日各计一次。分别登记全市汇总及按来源地市拆分的分项，人员按常住地或调查来源地、车辆按出发地归集。',
    formSchema:{fields:[
      {key:'reportDate',label:'统计日期',type:'date',required:true},
      {key:'rowType',label:'统计口径',type:'select',options:['全市汇总','客源分项'],required:true,defaultValue:'客源分项'},
      {key:'originCity',label:'客源地市',type:'text',hint:'全市汇总留空。地市分项各填一条，荆门市填市内除京山市外的来访。'},
      {key:'people',label:'来京山人数',type:'number',hint:'同日去重人数。没有采集的指标留空，确认无人填 0。'},
      {key:'vehicles',label:'来京山车辆数',type:'number',hint:'同日去重车辆数。没有采集的指标留空，确认无车填 0。'},
      {key:'sourceName',label:'数据来源',type:'text',required:true,hint:'填写统计报表或接入来源名称。'},
    ]}, features:doc.mode==='demo'?demoRecords():[],
  }
  return {...doc,datasets:[...doc.datasets,table]}
}
