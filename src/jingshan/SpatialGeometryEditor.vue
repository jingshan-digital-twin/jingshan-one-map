<script setup lang="ts">
import { workspaceEdition } from './workspace-artwork'
import { computed, inject, onMounted, onBeforeUnmount, ref, toRaw, watch } from 'vue'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import GeoJSON from 'ol/format/GeoJSON.js'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import VectorSource from 'ol/source/Vector.js'
import VectorLayer from 'ol/layer/Vector.js'
import ImageLayer from 'ol/layer/Image.js'
import ImageStatic from 'ol/source/ImageStatic.js'
import LayerGroup from 'ol/layer/Group.js'
import EditorReferenceLayers from './EditorReferenceLayers.vue'
import { editorReferences } from './editor-reference-context'
import PlatformAddressSearch from './PlatformAddressSearch.vue'
import PortalIcon from './PortalIcon.vue'
import type { MapAddress } from './platform-address-search'
import {Draw,Modify} from 'ol/interaction.js'
import {fromLonLat} from 'ol/proj.js'
import {Circle as CircleStyle,Fill,Icon,Stroke,Style} from 'ol/style.js'
import 'ol/ol.css'
import type {Geometry} from 'geojson'

const props=defineProps<{datasetId:string;type:string;geometry?:Geometry;readOnly?:boolean}>()
const emit=defineEmits<{change:[geometry:Geometry]}>()
const host=ref<HTMLElement>(),drawing=ref(false),status=ref('')
const vector=new VectorSource(),format=new GeoJSON()
const referenceGroup = new LayerGroup({ layers: [] })
const context = inject(editorReferences)!
const addressDatasets = computed(() => toRaw(context.datasets.value))
const addressQuery = ref(''), located = ref<MapAddress>()
const locationPin = new Feature<Point>()
const locationLayer = new VectorLayer({
  source: new VectorSource({features: [locationPin]}),
  zIndex: 20,
  style: new Style({image: new Icon({src:'/jingshan/ui/location-ring.svg', anchor:[0.5,0.83], scale:0.66})}),
})
let map:Map|undefined,draw:Draw|undefined,modify:Modify|undefined,observer:ResizeObserver|undefined
const crs={dataProjection:'EPSG:4326',featureProjection:'EPSG:3857'}
function locateAddress(place: MapAddress) {
  if (!map) return
  const center = fromLonLat(place.position)
  locationPin.setGeometry(new Point(center))
  addressQuery.value = place.name
  located.value = place
  const view = map.getView()
  view.cancelAnimations()
  view.animate({center, zoom: Math.max(16, view.getZoom() ?? 16),
    duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260})
}
function clearAddress() {
  locationPin.setGeometry(undefined)
  located.value = undefined
  addressQuery.value = ''
}
watch(addressQuery, value => { if (!value.trim() && located.value) clearAddress() })
function sync(fit=false){
  if(!map)return
  vector.clear()
  if(!props.geometry||props.geometry.type==='GeometryCollection')return
  try{
    const f=new Feature(format.readGeometry(props.geometry,crs))
    vector.addFeature(f)
    if(fit){
      const view = map.getView()
      view.cancelAnimations()
      view.fit(f.getGeometry()!.getExtent(),{padding:[35,35,35,35],maxZoom:17})
    }
  }catch{status.value='坐标尚不完整，请继续编辑或重新绘制。'}
}
function stop(){if(draw)map?.removeInteraction(draw);draw=undefined;drawing.value=false;modify?.setActive(true)}
function start(){
  if(!map || !['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon'].includes(props.type))return
  stop();drawing.value=true;modify?.setActive(false);status.value=props.type.includes('Point')?'单击地图落点。':'单击添加顶点，双击结束。'
  const simple=props.type.replace('Multi','') as 'Point'|'LineString'|'Polygon'
  draw=new Draw({type:simple})
  draw.on('drawend',event=>{
    const g=format.writeGeometryObject(event.feature.getGeometry()!,crs) as Geometry
    if('coordinates' in g && props.type.startsWith('Multi')){
      const existing=props.geometry?.type===props.type && 'coordinates' in props.geometry?props.geometry.coordinates:[]
      emit('change',{type:props.type,coordinates:[...existing,g.coordinates]} as Geometry)
    }else emit('change',g)
    stop();status.value='已更新图形，可拖动顶点调整。'
  })
  map.addInteraction(draw)
}
watch(()=>props.geometry,()=>sync(),{deep:true})
watch(()=>props.type,()=>{stop();sync()})
onMounted(()=>{
  map=new Map({target:host.value,layers:[new ImageLayer({className:workspaceEdition?'workspace-basemap':'ol-layer',source:new ImageStatic({url:'/jingshan/eox2016.jpg',imageExtent:[112.65,30.55,113.66,31.62],projection:'EPSG:4326'})}),
    new ImageLayer({className:workspaceEdition?'workspace-basemap':'ol-layer',source:new ImageStatic({url:'/jingshan/eox2016-city.jpg',imageExtent:[113.06,30.974,113.205,31.077],projection:'EPSG:4326'})}),
    referenceGroup, locationLayer,
    new VectorLayer({source:vector,zIndex:10,style:new Style({stroke:new Stroke({color:workspaceEdition?'#8066c5':'#26e2ec',width:3}),fill:new Fill({color:workspaceEdition?'rgba(115,87,192,.42)':'rgba(0,185,209,.25)'}),
    image:new CircleStyle({radius:7,stroke:new Stroke({color:'white',width:2}),fill:new Fill({color:workspaceEdition?'#7458b8':'#008398'})})})})],
    view:new View({center:fromLonLat([113.1,31.03]),zoom:11})})
  if (!props.readOnly) {
    modify=new Modify({source:vector});modify.on('modifyend',event=>{
    const g=event.features.item(0)?.getGeometry()
    if(g)emit('change',format.writeGeometryObject(g,crs) as Geometry)
    });map.addInteraction(modify)
  }
  sync(true);observer=new ResizeObserver(()=>map?.updateSize());if(host.value)observer.observe(host.value)
})
onBeforeUnmount(()=>{observer?.disconnect();stop();map?.setTarget(undefined);map?.dispose()})
</script>
<template>
  <section class="geometry-workbench" aria-label="地图编辑空间位置">
    <div class="geometry-toolbar">
      <div class="geometry-address">
        <PortalIcon class="geometry-search-icon" name="search" :size="15" />
        <PlatformAddressSearch v-model="addressQuery" :datasets="addressDatasets" :active-id="datasetId"
          places-only @locate="locateAddress" />
      </div>
      <div class="local-tools">
      <button v-if="!readOnly && type !== 'GeometryCollection'" type="button" :disabled="drawing" @click="start">{{type.startsWith('Multi')?'追加图形':geometry?'重新绘制':'在图上绘制'}}</button>
      <button v-if="drawing" type="button" @click="stop">取消绘制</button><button v-if="geometry" type="button" @click="sync(true)">定位图形</button>
      </div>
    </div>
    <EditorReferenceLayers :group="referenceGroup" :dataset-id="datasetId" />
    <div ref="host" class="geometry-map"></div>
    <div v-if="located" class="geometry-location">
      <PortalIcon name="pin" :size="15" /><span role="status">已定位到{{located.name}}</span>
      <button type="button" @click="clearAddress">清除定位</button>
    </div>
    <small v-if="!readOnly">{{type === 'GeometryCollection' ? '选择几何类型后可在地图上绘制。' : status || '拖动顶点编辑形状，Alt + 单击删除顶点。'}}</small>
  </section>
</template>
<style scoped>
.geometry-workbench{display:grid;gap:6px;min-width:0}
.geometry-map{height:240px;min-height:170px;background:#e0eaec;border:1px solid var(--platform-line)}
.geometry-workbench small{color:var(--platform-muted)}
.geometry-toolbar,.geometry-location{display:flex;align-items:center;gap:8px}
.geometry-toolbar{flex-wrap:wrap}
.geometry-address{position:relative;flex:1 1 205px;min-width:0}
.geometry-address .place-search{max-width:none}
.geometry-address .geometry-search-icon{position:absolute;z-index:1;top:50%;left:9px;transform:translateY(-50%);color:var(--platform-muted);pointer-events:none}
.geometry-address :deep(input[type='search']){padding-left:30px}
.geometry-toolbar .local-tools{margin:0}
.geometry-location{font-size:13px;color:var(--platform-ink)}
.geometry-location svg{flex:none;color:var(--platform-accent)}
.geometry-location span{min-width:0;overflow-wrap:anywhere}
.geometry-location button{flex:none;margin-left:auto;font-size:12px;color:var(--platform-accent)}
</style>
