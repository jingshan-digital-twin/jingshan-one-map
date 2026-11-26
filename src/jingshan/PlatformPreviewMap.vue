<script setup lang="ts">
import { workspaceEdition } from './workspace-artwork'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  BoundingSphere, Cartesian2, Cartesian3, Cartographic, Color, CustomShader, Entity, HeadingPitchRange, LightingModel,
  ImageryLayer, Math as GeoMath, Rectangle, VerticalOrigin,
  ScreenSpaceEventHandler, ScreenSpaceEventType, SingleTileImageryProvider, Viewer,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import type { CimAdminService } from './cim-types'
import { cimProtocols } from './cim-types'
import { configureMapCameraControls } from './map-camera-controls'
import type { CimFocusTarget } from './cim-map'
import {loadPreviewLayer, previewBounds, type PreviewLayer} from './platform-preview-layers'
import { focusTargetFromFeatures } from './cim-map'
import type { CityFeature, Coordinate, Dataset } from './types'
import type { MapAddress } from './platform-address-search'

const props = defineProps<{dataset?:Dataset; service?:CimAdminService; overlays:PreviewLayer[]; visible:boolean; alpha:number;
  highlighted?:string[]; focusRow?:{feature:CityFeature;serial:number}; address?: MapAddress; pickingAddress: boolean}>()
const emit=defineEmits<{rowPicked:[id:string];layerStatus:[key:string,message:string]; addressPicked:[position:Coordinate]}>()
const host = ref<HTMLElement>(), frame = ref<HTMLElement>()
const status = ref('正在加载地图…'), failed = ref(false), measure = ref(false), lengthM = ref(0)
const showImage = ref(true), zoomReady = ref(false), coords = ref('')
const feature = ref<{name:string; properties:Record<string,unknown>}>()
const rows = computed(() => Object.entries(feature.value?.properties ?? {}).filter(([k]) => k !== 'name'))
let map: Viewer | undefined, input: ScreenSpaceEventHandler | undefined
let focus:CimFocusTarget|undefined, urbanShader:CustomShader|undefined
type Handle=ReturnType<typeof loadPreviewLayer>
let primary:Handle|undefined
const overlayHandles=new Map<string,{handle:Handle;dataset?:Dataset}>()
function syncOverlays() {
  const viewer=map
  if(!viewer)return
  const wanted=new Set(props.overlays.map(o=>o.key))
  for(const [key,{handle}] of overlayHandles) {
    if(!wanted.has(key)){handle.destroy();overlayHandles.delete(key)}
  }
  for(const o of props.overlays) {
    let entry=overlayHandles.get(o.key)
    if(!entry || entry.dataset!==o.dataset){
      entry?.handle.destroy()
      entry={dataset:o.dataset,handle:loadPreviewLayer(viewer,o,(message)=>emit('layerStatus',o.key,message))}
      overlayHandles.set(o.key,entry)
    }
    entry.handle.display(o.visible,o.alpha)
  }
}
watch(()=>props.overlays,syncOverlays)
watch(()=>[props.visible,props.alpha] as const,([shown,alpha])=>primary?.display(shown,alpha))
const baseLayers:ImageryLayer[]=[]
let alive = true, line:Entity | undefined
const path: Cartesian3[] = []
let addressPin: Entity | undefined, locatedAddress = false
function showAddress() {
  const viewer = map
  if (!viewer) return
  if (addressPin) viewer.entities.remove(addressPin)
  addressPin = undefined
  const place = props.address
  coords.value = place ? place.position[0].toFixed(5)+'° E  /  '+place.position[1].toFixed(5)+'° N' : ''
  if (place) {
    locatedAddress = true
    feature.value = undefined
    measure.value = false
    resetMeasure()
    const position = Cartesian3.fromDegrees(...place.position)
    addressPin = viewer.entities.add({ name: place.name, position,
      billboard: { image: '/jingshan/ui/location-ring.svg', width: 35, height: 41, pixelOffset: new Cartesian2(0, 6),
        verticalOrigin: VerticalOrigin.BOTTOM, disableDepthTestDistance: Infinity },
      label: { text: place.name.length > 24 ? place.name.slice(0, 23) + '…' : place.name,
        font: 'bold 15px "Microsoft YaHei", sans-serif', fillColor: Color.WHITE, showBackground: true,
        backgroundColor: Color.fromCssColorString('#142b3bef'), backgroundPadding: new Cartesian2(8, 4),
        pixelOffset: new Cartesian2(0,-41), verticalOrigin: VerticalOrigin.BOTTOM, disableDepthTestDistance: Infinity },
    })
    viewer.camera.cancelFlight()
    viewer.camera.flyToBoundingSphere(new BoundingSphere(position, 1), {duration: .7,
      offset: new HeadingPitchRange(viewer.camera.heading, Math.min(viewer.camera.pitch, GeoMath.toRadians(-35)), 1400)})
  }
  viewer.scene.requestRender()
}
watch(() => props.address, showAddress)
watch(() => props.pickingAddress, picking => {
  if (picking) { feature.value = undefined; measure.value = false; resetMeasure() }
})
function fly(instant=false) {
  if (!map) return
  if (focus) {
    map.camera.flyToBoundingSphere(focus.sphere, {duration:instant ? 0 : .6,
      offset:new HeadingPitchRange(0, GeoMath.toRadians(focus.model ? -38 : -89.9), Math.max(focus.model ? 90 : 800,focus.sphere.radius * 2.8))})
  } else map.camera.setView({destination:Rectangle.fromDegrees(...(props.service?.bounds ?? previewBounds))})
}
function zoom(direction:number) {
  if (!map) return
  const distance = map.camera.positionCartographic.height * .38
  if (direction > 0) map.camera.zoomIn(distance)
  else map.camera.zoomOut(distance)
  map.scene.requestRender()
}
function resetMeasure() {
  if (line) map?.entities.remove(line)
  line=undefined; path.length=0; lengthM.value=0
  map?.scene.requestRender()
}
function toggleMeasure() { resetMeasure(); measure.value=!measure.value; feature.value=undefined }
function toggleImage() {
  showImage.value=!showImage.value
  for (const layer of baseLayers) layer.show=showImage.value
  map?.scene.requestRender()
}
function locate(pixel:Cartesian2) {
  if (!map) return
  const xyz=map.camera.pickEllipsoid(pixel,map.scene.globe.ellipsoid)
  if (!xyz) return
  const geo=Cartographic.fromCartesian(xyz)
  return {xyz,x:GeoMath.toDegrees(geo.longitude),y:GeoMath.toDegrees(geo.latitude)}
}
function pick(pixel:Cartesian2) {
  if (!map) return
  const point = locate(pixel)
  if (!point) return
  coords.value=point.x.toFixed(5)+'° E  /  '+point.y.toFixed(5)+'° N'
  if (props.pickingAddress) {emit('addressPicked',[point.x,point.y]);return}
  if (measure.value) {
    const prev=path.at(-1)
    if (prev) lengthM.value+=Cartesian3.distance(prev,point.xyz)
    path.push(point.xyz)
    if (line) map.entities.remove(line)
    if (path.length>1) line=map.entities.add({polyline:{positions:[...path],width:3,material:Color.YELLOW}})
    map.scene.requestRender(); return
  }
  const hit=map.scene.pick(pixel)
  feature.value=undefined
  for(const handle of [...overlayHandles.values()].map(entry=>entry.handle).reverse().concat(primary ? [primary] : [])){
    const item=handle.pick(hit,point.x,point.y)
    if(item){feature.value=item;if(handle===primary && 'id' in item && typeof item.id==='string')emit('rowPicked',item.id);break}
  }
}
watch(()=>props.highlighted,ids=>primary?.highlight(new Set(ids)))
watch(()=>props.focusRow,row=>{
  if(!row||!map)return
  const target=focusTargetFromFeatures([row.feature])
  if(target){map.camera.flyToBoundingSphere(target.sphere,{duration:.55,offset:new HeadingPitchRange(0,-Math.PI/2,Math.max(400,target.sphere.radius*3))});map.scene.requestRender()}
})
function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void frame.value?.requestFullscreen().catch(()=>{})
}
function failure(message:string) { failed.value=true; status.value=message }
function loadPrimary(viewer:Viewer) {
  const { dataset, service } = props
  primary=loadPreviewLayer(viewer,{key:'primary',name:dataset?.name ?? service?.name ?? '',dataset,service,
    visible:props.visible,alpha:props.alpha,color:workspaceEdition ? '#765bc6' : '#56d9e3'},(message,error)=>{status.value=message;failed.value=!!error})
  return primary
}
watch([()=>props.dataset,()=>props.service], async () => {
  if (!map) return
  primary?.destroy()
  const current = loadPrimary(map)
  const target = await current.ready
  if (alive && current === primary){focus = target;current.highlight(new Set(props.highlighted))}
})

async function init() {
  if (!host.value) return
  const viewer = new Viewer(host.value, {baseLayer:false,baseLayerPicker:false,animation:false,timeline:false,
    geocoder:false,homeButton:false,sceneModePicker:false,infoBox:false,selectionIndicator:false,navigationHelpButton:false,
    fullscreenButton:false,scene3DOnly:true,skyBox:false,skyAtmosphere:false,requestRenderMode:true,maximumRenderTimeChange:Infinity})
  map=viewer
  configureMapCameraControls(viewer.scene.screenSpaceCameraController)
  viewer.scene.globe.baseColor=Color.fromCssColorString(workspaceEdition ? '#dfdfe3' : '#263b49')
  viewer.scene.backgroundColor=Color.fromCssColorString('#101c29')
  viewer.scene.globe.showGroundAtmosphere=false
  fly(true)
  const images:{url:string; bounds:[number,number,number,number]}[]=[
    { url:'/jingshan/eox2016.jpg', bounds:previewBounds },
    { url:'/jingshan/eox2016-city.jpg', bounds:[113.06,30.974,113.205,31.077] },
  ]
  void (async()=>{
    for (const image of images) {
      const provider=await SingleTileImageryProvider.fromUrl(image.url,{rectangle:Rectangle.fromDegrees(...image.bounds),credit:'EOX · Sentinel-2 cloudless'})
      if (!alive) return
      const layer=viewer.imageryLayers.addImageryProvider(provider,baseLayers.length)
      layer.brightness=workspaceEdition ? 1.1 : .7
      layer.saturation=workspaceEdition ? 0 : .66
      if (workspaceEdition) layer.alpha=.32
      layer.show=showImage.value; baseLayers.push(layer)
      viewer.scene.requestRender()
    }
  })().catch(()=>{})
  input=new ScreenSpaceEventHandler(viewer.scene.canvas)
  input.setInputAction(({position}:{position:Cartesian2})=>pick(position),ScreenSpaceEventType.LEFT_CLICK)
  zoomReady.value=true
  const service=props.service, initial=loadPrimary(viewer)
  syncOverlays()
  if (props.address) showAddress()
  const target=await initial.ready
  if (alive && primary===initial) {
    focus=target
    if(props.highlighted?.length)initial.highlight(new Set(props.highlighted))
    // The city tileset's root covers the whole county. Open on its urban buildings;
    // the full-extent control still frames the entire model.
    if (service?.mapUrl.includes('/local-tiles/central-white/')) {
      const tiles=primary.model()
      if(tiles) {
        // Older white-model tiles have flat or missing vertex normals. Derive
        // a face normal so adjacent walls remain distinguishable at any hour.
        urbanShader=new CustomShader({lightingModel:LightingModel.UNLIT,fragmentShaderText:`
          void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
            vec3 pos = fsInput.attributes.positionEC;
            vec3 n = normalize(cross(dFdx(pos), dFdy(pos)));
            float light = clamp(dot(n, normalize(vec3(-0.45, 0.78, 0.52))), 0.0, 1.0);
            material.diffuse = mix(vec3(0.26, 0.43, 0.52), vec3(0.88, 0.96, 1.0), light);
          }`})
        tiles.style=undefined
        tiles.customShader=urbanShader
      }
      if (!locatedAddress && !props.pickingAddress) viewer.camera.flyToBoundingSphere(new BoundingSphere(Cartesian3.fromDegrees(113.1184,31.009,22),390),{
        duration:0,offset:new HeadingPitchRange(GeoMath.toRadians(28),GeoMath.toRadians(-38),1250)})
    } else if (!locatedAddress && !props.pickingAddress) fly(true)
    viewer.scene.requestRender()
  }
}
onMounted(()=>{void init().catch(()=>{ if(alive) failure('地图初始化失败，请检查 WebGL 或图层连接') })})
onBeforeUnmount(()=>{alive=false;input?.destroy();for(const {handle} of overlayHandles.values())handle.destroy();primary?.destroy();map?.destroy();urbanShader?.destroy();map=undefined})
function valueText(v:unknown) {return v==null ? '—' : typeof v==='object' ? JSON.stringify(v) : String(v)}
</script>
<template>
  <section ref="frame" class="gis-viewport" :class="{ 'gis-picking': pickingAddress }" aria-label="资源地图">
    <div ref="host" class="gis-canvas"></div>
    <div class="gis-controls">
      <button type="button" :disabled="!zoomReady" title="放大" aria-label="放大" @click="zoom(1)">＋</button>
      <button type="button" :disabled="!zoomReady" title="缩小" aria-label="缩小" @click="zoom(-1)">−</button>
      <button type="button" :disabled="!zoomReady" @click="fly()">全图</button>
      <button type="button" :disabled="!zoomReady || pickingAddress" :aria-pressed="measure" @click="toggleMeasure">测距</button>
      <button type="button" :aria-pressed="showImage" @click="toggleImage">底图</button>
      <button type="button" @click="toggleFullscreen">全屏</button>
    </div>
    <div v-if="feature" class="gis-identify"><header><b>{{feature.name}}</b><button type="button" aria-label="关闭属性" @click="feature=undefined">×</button></header>
      <dl><template v-for="[key,val] in rows" :key="key"><dt>{{key}}</dt><dd>{{valueText(val)}}</dd></template></dl>
    </div>
    <div v-if="measure" class="gis-measure">点击地图添加测量点 · {{lengthM < 1000 ? lengthM.toFixed(0)+' m' : (lengthM/1000).toFixed(2)+' km'}}<button type="button" @click="resetMeasure">清除</button></div>
    <div class="gis-status" role="status"><span :class="{failed}">{{status}}</span><span>{{coords || (service ? cimProtocols[service.kind] : 'WGS 84')}}</span></div>
  </section>
</template>
<style scoped>
.gis-picking :deep(canvas) { cursor: crosshair; }
.gis-viewport {
  position: relative;
  min-height: 400px;
  height: 100%;
  isolation: isolate;
  overflow: hidden;
  background: #101c29;
  border: 1px solid var(--platform-line);
  border-radius: var(--portal-radius);
}
.gis-canvas { position: absolute; inset: 0; }
.gis-controls {
  position: absolute;
  left: 14px;
  top: 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border-radius: 10px;
}
.gis-controls button, .gis-identify button, .gis-measure button {
  min-height: 34px;
  padding: 3px 8px;
  background: transparent;
  border: 0;
  box-shadow: none;
  border-radius: 6px;
  font-size: 15px;
}
.gis-status, .gis-measure, .gis-identify { position: absolute; border-radius: 9px; }
.gis-status {
  bottom: 22px;
  left: 14px;
  right: 14px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  font-size: 13px;
  pointer-events: none;
}
.gis-measure { left: 75px; top: 14px; padding: 3px 8px; }
.gis-identify {
  top: 14px;
  right: 14px;
  width: min(305px, 65%);
  max-height: 60%;
  overflow: auto;
  padding: 12px;
}
.gis-identify header { display: flex; align-items: center; justify-content: space-between; }
.gis-identify dl {
  display: grid;
  grid-template-columns: minmax(55px, 1fr) minmax(90px, 1.4fr);
  font-size: 14px;
  gap: 6px;
  overflow-wrap: anywhere;
}
.gis-identify dd { margin: 0; }
.gis-viewport:fullscreen { height: 100dvh; }
.gis-canvas :deep(.cesium-viewer-bottom) { left: 8px; }
</style>
