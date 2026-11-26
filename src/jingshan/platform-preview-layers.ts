import {
 Cesium3DTileStyle, Color, ColorMaterialProperty, ConstantProperty, Entity, GeoJsonDataSource, PointGraphics, Rectangle,
 type Viewer,
} from 'cesium'
import { createCimMap, focusTargetFromFeatures, type CimFocusTarget } from './cim-map'
import type { CimService } from './cim-types'
import { isCimBasemap } from './cim-types'
import { MapImageMaterialProperty } from './map-image-material'
import { populationSurface } from './population-surface'
import { populationRaster, pickRaster, rasterFeatureById, type PopulationRaster } from './population-raster'
import { populationDisplayGrid, populationMapFeature, type PopulationDisplayGrid } from './population-display-grid'
import { rasterAttributeCanvas, rasterSurface } from './population-raster-surface'
import { legacyPopulationGridId } from './population-grid'
import type { Dataset } from './types'

export type PreviewLayer = {key:string;name:string;dataset?:Dataset;service?:CimService;visible:boolean;alpha:number;color:string}
export const previewBounds:[number,number,number,number]=[112.65,30.55,113.66,31.62]

export function loadPreviewLayer(map:Viewer, layer:PreviewLayer, report:(message:string,error?:boolean)=>void) {
  let alive=true, shown=layer.visible, alpha=layer.alpha, source:GeoJsonDataSource|undefined
  const rasterLoad = new AbortController()
  let raster:Awaited<ReturnType<typeof populationSurface>>, rasterEntity:Entity|undefined, rasterMaterial:MapImageMaterialProperty|undefined
  let native:PopulationRaster|undefined
  let displayGrid:PopulationDisplayGrid|undefined
  let serviceMap:ReturnType<typeof createCimMap>|undefined
  const originals=new Map(layer.dataset?.features.map(f=>[f.id,f]))
  const sourceId=(id:string)=>originals.has(id)?id:id.replace(/_\d+$/,'')
  const color=Color.fromCssColorString(layer.color)
  // Shared properties keep the opacity control O(1) even for thousands of features.
  const stroke=new ConstantProperty(color),fill=new ConstantProperty(color.withAlpha(.24)),outline=new ConstantProperty(Color.fromCssColorString('#132c3c'))
  const strokeMat=new ColorMaterialProperty(stroke),fillMat=new ColorMaterialProperty(fill)
  let styled:GeoJsonDataSource|undefined
  function appearance() {
    if (!alive) return
    const r=serviceMap?.renderedLayer(layer.service!.id)
    const vector=r?.vector ?? source
    if (vector && styled!==vector) {
      for (const entity of vector.entities.values) {
        if (entity.billboard) {entity.billboard=undefined;entity.point=new PointGraphics({pixelSize:9,outlineWidth:2,disableDepthTestDistance:Infinity})}
        if (entity.point) {entity.point.color=stroke;entity.point.outlineColor=outline}
        if (entity.polyline) entity.polyline.material=strokeMat
        if (entity.polygon) {entity.polygon.material=fillMat;entity.polygon.outlineColor=stroke}
      }
      styled=vector
    }
    stroke.setValue(color.withAlpha(alpha));fill.setValue(color.withAlpha(alpha*.24));outline.setValue(Color.fromCssColorString('#132c3c').withAlpha(alpha))
    if (vector) vector.show=shown && alpha>0
    if (r?.image){r.image.show=shown;r.image.alpha=alpha}
    if (r?.tiles){
      r.tiles.show=shown && alpha>0
      if (alpha<1) r.tiles.style=new Cesium3DTileStyle({color:'color("white", '+alpha+')'})
      else if (lastAlpha<1) r.tiles.style=undefined
    }
    if(rasterEntity) rasterEntity.show=shown && alpha>0
    if(rasterMaterial) rasterMaterial.color=new ConstantProperty(Color.WHITE.withAlpha(alpha))
    lastAlpha=alpha;map.scene.requestRender()
  }
  let lastAlpha=1
  async function load():Promise<CimFocusTarget|undefined> {
    const {dataset,service}=layer
    if (service) {
      if (!service.enabled){report('服务已停用，可在服务管理中启用后预览',true);return}
      serviceMap=createCimMap(map,e=>{ if(alive){report(e.message || (e.state==='ready'?'图层已加载':'正在请求服务…'),e.state==='error');if(e.state==='ready')appearance()} },()=>{})
      serviceMap.setLayers([service],isCimBasemap(service)?(service.bounds ?? previewBounds):undefined)
      const target=await serviceMap.getFocusTarget(service.id)
      if(alive)appearance()
      return target
    }
    if (!dataset)return
    const features=dataset.features.filter(x=>x.geometry.type!=='GeometryCollection' || x.geometry.geometries.length)
    if (!features.length){report('当前数据集没有已定位要素');return}
    native=populationRaster(dataset)
    if(native){
      displayGrid=populationDisplayGrid({grid:native,bit:1})
      raster=await rasterSurface(displayGrid,rasterLoad.signal)
      if(!alive)return
    } else if (dataset.id===legacyPopulationGridId) {
      raster=await populationSurface(features,undefined,rasterLoad.signal)
      if (!alive) return
    }
    if(raster){
      rasterMaterial=new MapImageMaterialProperty({image:raster.canvas,transparent:true})
      rasterEntity=map.entities.add({rectangle:{coordinates:Rectangle.fromDegrees(...raster.bounds),material:rasterMaterial}})
    }else if(!native){
      const vector=await GeoJsonDataSource.load({type:'FeatureCollection',features},{stroke:color,fill:color.withAlpha(.24),strokeWidth:2})
      if(!alive)return
      await map.dataSources.add(vector)
      if (!alive){if(!map.isDestroyed())map.dataSources.remove(vector,true);return}
      source=vector
    }
    appearance();report((native?.count ?? features.length).toLocaleString('zh-CN')+(native ? ' 个有效像元' : ' 个空间要素'))
    return focusTargetFromFeatures(features)
  }
  const ready=load().catch(()=>{if(alive)report('图层无法载入，请检查数据和服务连接',true);return undefined})
  return { ready,
    display(visible:boolean,opacity:number){if(visible===shown && alpha===opacity)return;shown=visible;alpha=opacity;appearance()},
    pick(hit:Parameters<ReturnType<typeof createCimMap>['pick']>[0]|undefined,x:number,y:number) {
      if(!shown || alpha<=0)return
      if(hit && serviceMap)return serviceMap.pick(hit)
      let id:string|undefined
      if(hit && 'id' in hit && hit.id instanceof Entity && source?.entities.contains(hit.id))id=sourceId(hit.id.id)
      else if (raster && (!hit || ('id' in hit && hit.id===rasterEntity)))id=raster.pick([x,y])
      const row=id && (displayGrid ? populationMapFeature(displayGrid,id) : originals.get(id))
      const native=layer.dataset && populationRaster(layer.dataset)
      if(native && raster){
        const cellId=pickRaster({grid:native,bit:1},x,y)
        const cell=cellId && rasterFeatureById(native,cellId)
        if(cell)return {id:cell.id,name:cell.properties.name,properties:cell.properties}
      }
      if(row)return {id:row.id,name:row.properties.name,properties:row.properties}
    },
    highlight(ids:ReadonlySet<string>){
      if(native && raster && rasterEntity?.rectangle){
        rasterMaterial=new MapImageMaterialProperty({image:rasterAttributeCanvas(raster.canvas,raster.bounds,native,ids),transparent:true,color:Color.WHITE.withAlpha(alpha)})
        rasterEntity.rectangle.material=rasterMaterial
        map.scene.requestRender()
        return
      }
      const vector=source??(layer.service && serviceMap?.renderedLayer(layer.service.id)?.vector)
      if(!vector)return
      const chosen=new ConstantProperty(Color.fromCssColorString('#ffbc27')),fillChosen=new ColorMaterialProperty(Color.fromCssColorString('#ffbc27').withAlpha(.68))
      for(const entity of vector.entities.values){
        const selected=ids.has(sourceId(entity.id))
        if(entity.point){entity.point.color=selected?chosen:stroke;entity.point.pixelSize=new ConstantProperty(selected?14:9)}
        if(entity.polyline)entity.polyline.material=selected?fillChosen:strokeMat
        if(entity.polygon){entity.polygon.material=selected?fillChosen:fillMat;entity.polygon.outlineColor=selected?chosen:stroke}
      }
      map.scene.requestRender()
    },
    model(){return layer.service && serviceMap?.renderedLayer(layer.service.id)?.tiles},
    destroy(){alive=false;rasterLoad.abort();serviceMap?.destroy();if(map.isDestroyed())return;if(source)map.dataSources.remove(source,true);if(rasterEntity)map.entities.remove(rasterEntity)}
  }
}
