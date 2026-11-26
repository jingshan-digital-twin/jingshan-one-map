<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  Cartesian2, Cartesian3, Cartographic, Color, ConstantProperty, Credit, CustomDataSource,
  DistanceDisplayCondition, HeadingPitchRange, LabelStyle, Math as CesiumMath, Matrix4,
  NearFarScalar, PolylineGlowMaterialProperty, Rectangle, ScreenSpaceEventHandler,
  ScreenSpaceEventType, SingleTileImageryProvider, VerticalOrigin, Viewer,
} from 'cesium';
import type { Entity, ImageryLayer } from 'cesium';
import type { FeatureCollection, Position } from 'geojson';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { MapProject } from './demo.ts';

const props = withDefaults(defineProps<{
  projects: MapProject[];
  selectedId: string | null;
  showBoundaries: boolean;
  showCities?: boolean;
  showImagery: boolean;
  command: { action: 'home' | 'in' | 'out' | 'north' | 'tilt'; serial: number } | null;
}>(), { showCities: true });

const emit = defineEmits<{
  select: [id: string];
  camera: [position: { longitude: number; latitude: number; height: number }];
}>();

const mapElement = ref<HTMLDivElement | null>(null);
const mapCredits = ref<HTMLDivElement | null>(null);
const mapError = ref(false);
let viewer: Viewer | undefined;
let inputHandler: ScreenSpaceEventHandler | undefined;
let imageryLayer: ImageryLayer | undefined;
let projectLayer: CustomDataSource | undefined;
let borderLayer: CustomDataSource | undefined;
let cityLayer: CustomDataSource | undefined;
let removeCameraListener: (() => void) | undefined;

const home = { longitude: 113.72, latitude: 30.68, height: 500_000 };
const imageBounds = Rectangle.fromDegrees(109.2, 28.3, 118.0, 34.3);
const colors: Record<MapProject['status'], string> = {
  new: '#ff493f', ongoing: '#28d5a0', reserve: '#ffd000', statistics: '#f2be2c',
};
const cityNames: [name: string, longitude: number, latitude: number][] = [
  ['武汉市', 114.30, 30.60], ['荆门市', 112.20, 31.04], ['随州市', 113.38, 31.69],
  ['孝感市', 113.92, 30.93], ['襄阳市', 112.14, 32.04], ['黄冈市', 114.88, 30.46],
  ['鄂州市', 114.90, 30.39], ['黄石市', 115.05, 30.20], ['咸宁市', 114.32, 29.85],
  ['荆州市', 112.24, 30.34], ['天门市', 113.17, 30.65], ['潜江市', 112.90, 30.40],
  ['仙桃市', 113.46, 30.34], ['宜昌市', 111.29, 30.70], ['信阳市', 114.10, 32.13],
  ['岳阳市', 113.12, 29.36], ['京山市', 113.12, 31.02], ['安陆市', 113.69, 31.25],
];

const projectSprites = new Map<string, HTMLCanvasElement>();
const projectEntities = new Map<string, { entity: Entity; project: MapProject; label: boolean }>();
const labelBackground = Color.fromCssColorString('#0b1b2e').withAlpha(0.9);
const labelDistance = new DistanceDisplayCondition(0, 720_000);
const markerScale = new NearFarScalar(80_000, 1.15, 850_000, 0.85);
const markerSize = 34;
const selectedMarkerSize = 42;

function pointSprite(status: MapProject['status'], selected: boolean) {
  const key = `${status}-${selected}`;
  const cached = projectSprites.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const color = colors[status];
  const radius = status === 'statistics' ? 8 : 13;
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, selected ? 32 : 29);
  glow.addColorStop(0, color + 'ee');
  glow.addColorStop(0.58, color + '69');
  glow.addColorStop(1, color + '00');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = color;
  if (status === 'statistics') {
    ctx.fillRect(32 - radius, 32 - radius, radius * 2, radius * 2);
    ctx.strokeStyle = '#ffe786';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(32 - radius, 32 - radius, radius * 2, radius * 2);
  } else {
    ctx.beginPath();
    ctx.arc(32, 32, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = status === 'reserve' ? '#fff6c9' : '#ffdace';
    ctx.lineWidth = status === 'reserve' ? 3.5 : 2;
    ctx.stroke();
  }
  if (selected) {
    ctx.beginPath();
    ctx.arc(32, 32, radius + 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff3bd';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  projectSprites.set(key, canvas);
  return canvas;
}

function projectLabel(name: string) {
  const characters = Array.from(name);
  return characters.length <= 15 ? name : characters.slice(0, 14).join('') + '…';
}

function syncProjects() {
  if (!viewer || !projectLayer) return;
  const labelPositions: MapProject[] = [];
  const entityCollection = projectLayer.entities;
  projectEntities.clear();
  entityCollection.suspendEvents();
  try {
    entityCollection.removeAll();
    for (const project of props.projects) {
      const selected = project.id === props.selectedId;
      const label = project.status !== 'statistics' && !labelPositions.some(other =>
        Math.abs(project.longitude - other.longitude) < 0.45 && Math.abs(project.latitude - other.latitude) < 0.12,
      );
      if (label) labelPositions.push(project);
      const size = selected ? selectedMarkerSize : markerSize;
      const entity = entityCollection.add({
        id: `project:${project.id}`,
        position: Cartesian3.fromDegrees(project.longitude, project.latitude, 35),
        billboard: {
          image: pointSprite(project.status, selected), width: size, height: size,
          scaleByDistance: markerScale, disableDepthTestDistance: Infinity,
        },
        label: {
          text: projectLabel(project.name), font: selected ? 'bold 15px Microsoft YaHei' : 'bold 13px Microsoft YaHei',
          show: selected || label, showBackground: true, backgroundColor: labelBackground,
          backgroundPadding: new Cartesian2(6, 3), fillColor: selected ? Color.fromCssColorString('#ffe775') : Color.fromCssColorString('#e6f1ff'),
          pixelOffset: new Cartesian2(0, -12), verticalOrigin: VerticalOrigin.BOTTOM,
          distanceDisplayCondition: selected ? undefined : labelDistance, disableDepthTestDistance: Infinity,
        },
      });
      projectEntities.set(project.id, { entity, project, label });
    }
  } finally {
    entityCollection.resumeEvents();
  }
  viewer.scene.requestRender();
}

function syncSelection(id: string | null, previous: string | null) {
  if (!viewer) return;
  for (const [projectId, selected] of [[previous, false], [id, true]] as const) {
    if (!projectId) continue;
    const entry = projectEntities.get(projectId);
    if (!entry) continue;
    const { billboard, label } = entry.entity;
    if (billboard) {
      billboard.image = new ConstantProperty(pointSprite(entry.project.status, selected));
      const size = new ConstantProperty(selected ? selectedMarkerSize : markerSize);
      billboard.width = size;
      billboard.height = size;
    }
    if (label) {
      label.show = new ConstantProperty(selected || entry.label);
      label.font = new ConstantProperty(selected ? 'bold 15px Microsoft YaHei' : 'bold 13px Microsoft YaHei');
      label.fillColor = new ConstantProperty(selected ? Color.fromCssColorString('#ffe775') : Color.fromCssColorString('#e6f1ff'));
      label.distanceDisplayCondition = selected ? undefined : new ConstantProperty(labelDistance);
    }
  }
  const project = id ? projectEntities.get(id)?.project : undefined;
  if (project) {
    const height = Math.min(viewer.camera.positionCartographic.height, 300_000);
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(project.longitude, project.latitude, height),
      orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 },
      duration: 0.75, complete: reportCamera,
    });
  }
  viewer.scene.requestRender();
}

function cameraCenter(map: Viewer) {
  const { clientWidth, clientHeight } = map.canvas;
  const point = map.camera.pickEllipsoid(new Cartesian2(clientWidth / 2, clientHeight / 2));
  return point ? Cartographic.fromCartesian(point) : map.camera.positionCartographic;
}

function reportCamera() {
  if (!viewer) return;
  const center = cameraCenter(viewer);
  emit('camera', {
    longitude: CesiumMath.toDegrees(center.longitude),
    latitude: CesiumMath.toDegrees(center.latitude),
    height: viewer.camera.positionCartographic.height,
  });
}

function runCommand(action: NonNullable<typeof props.command>['action'], immediate = false) {
  if (!viewer) return;
  const { camera, scene } = viewer;
  const height = camera.positionCartographic.height;
  const center = cameraCenter(viewer);
  const topDown = { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 };
  if (action === 'home') {
    const view = { destination: Cartesian3.fromDegrees(home.longitude, home.latitude, home.height), orientation: topDown };
    if (immediate) camera.setView(view);
    else camera.flyTo({ ...view, duration: 0.8, complete: reportCamera });
  } else if (action === 'in') {
    camera.zoomIn(Math.min(height * 0.22, Math.max(0, height - 2_000)));
  } else if (action === 'out') {
    camera.zoomOut(Math.min(height * 0.28, Math.max(0, 1_200_000 - height)));
  } else if (action === 'north') {
    camera.flyTo({
      destination: Cartesian3.fromRadians(center.longitude, center.latitude, height),
      orientation: topDown, duration: 0.55, complete: reportCamera,
    });
  } else {
    const tilt = camera.pitch < -1.4 ? -CesiumMath.PI_OVER_THREE : -CesiumMath.PI_OVER_TWO;
    const target = Cartesian3.fromRadians(center.longitude, center.latitude);
    camera.lookAt(target, new HeadingPitchRange(camera.heading, tilt, height / Math.abs(Math.sin(tilt))));
    camera.lookAtTransform(Matrix4.IDENTITY);
  }
  reportCamera();
  scene.requestRender();
}

function addCities(layer: CustomDataSource) {
  for (const [name, longitude, latitude] of cityNames) {
    layer.entities.add({
      position: Cartesian3.fromDegrees(longitude, latitude, 25),
      label: {
        text: name, font: 'bold 15px Microsoft YaHei', style: LabelStyle.FILL_AND_OUTLINE,
        fillColor: Color.fromCssColorString('#dce6e4'), outlineColor: Color.fromCssColorString('#26383c'),
        outlineWidth: 3.5, disableDepthTestDistance: Infinity, distanceDisplayCondition: labelDistance,
      },
    });
  }
}

async function addBoundaries(map: Viewer, layer: CustomDataSource) {
  const response = await fetch(`${import.meta.env.BASE_URL}imagery/hubei-boundaries.json`);
  if (!response.ok) throw new Error(`Boundary request returned ${response.status}`);
  const boundaries = await response.json() as FeatureCollection;
  if (map.isDestroyed()) return;
  const glow = new PolylineGlowMaterialProperty({
    color: Color.fromCssColorString('#28c8f2').withAlpha(0.94), glowPower: 0.19,
  });
  function addLine(line: Position[]) {
    if (line.length < 2) return;
    layer.entities.add({
      polyline: {
        positions: Cartesian3.fromDegreesArray(line.flatMap(([x, y]) => [x, y])),
        clampToGround: true, width: 3.7, material: glow,
      },
    });
  }
  layer.entities.suspendEvents();
  try {
    for (const { geometry } of boundaries.features) {
      if (!geometry) continue;
      if (geometry.type === 'LineString') addLine(geometry.coordinates);
      if (geometry.type === 'Polygon' || geometry.type === 'MultiLineString') geometry.coordinates.forEach(addLine);
      if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach(polygon => polygon.forEach(addLine));
    }
  } finally {
    layer.entities.resumeEvents();
  }
  map.scene.requestRender();
}

onMounted(async () => {
  if (!mapElement.value) return;
  try {
    const map = new Viewer(mapElement.value, {
      baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, animation: false, timeline: false,
      fullscreenButton: false, infoBox: false, selectionIndicator: false, skyAtmosphere: false,
      skyBox: false, requestRenderMode: true, maximumRenderTimeChange: Infinity,
      creditContainer: mapCredits.value ?? undefined,
    });
    viewer = map;
    map.scene.backgroundColor = Color.fromCssColorString('#182c27');
    map.scene.globe.baseColor = Color.fromCssColorString('#273b35');
    map.scene.globe.showGroundAtmosphere = false;
    map.scene.globe.enableLighting = false;
    map.scene.screenSpaceCameraController.minimumZoomDistance = 2_000;
    map.scene.screenSpaceCameraController.maximumZoomDistance = 1_200_000;
    map.scene.screenSpaceCameraController.enableLook = false;
    map.scene.postProcessStages.fxaa.enabled = true;
    removeCameraListener = map.camera.moveEnd.addEventListener(reportCamera);
    runCommand('home', true);

    borderLayer = new CustomDataSource('boundaries');
    projectLayer = new CustomDataSource('projects');
    cityLayer = new CustomDataSource('cities');
    borderLayer.show = props.showBoundaries;
    cityLayer.show = props.showCities;
    addCities(cityLayer);
    void map.dataSources.add(borderLayer);
    void map.dataSources.add(cityLayer);
    void map.dataSources.add(projectLayer);
    syncProjects();

    inputHandler = new ScreenSpaceEventHandler(map.canvas);
    inputHandler.setInputAction(({ position }: { position: Cartesian2 }) => {
      const entity: Entity | undefined = map.scene.pick(position)?.id;
      if (typeof entity?.id === 'string' && entity.id.startsWith('project:')) emit('select', entity.id.slice(8));
    }, ScreenSpaceEventType.LEFT_CLICK);
    let lastPick = -Infinity;
    inputHandler.setInputAction(({ endPosition }: { endPosition: Cartesian2 }) => {
      const now = performance.now();
      if (now - lastPick < 100) return;
      lastPick = now;
      const entity: Entity | undefined = map.scene.pick(endPosition)?.id;
      map.canvas.style.cursor = typeof entity?.id === 'string' && entity.id.startsWith('project:') ? 'pointer' : '';
    }, ScreenSpaceEventType.MOUSE_MOVE);

    void addBoundaries(map, borderLayer).catch(error => console.warn('Cesium boundary layer:', error));
    try {
      const provider = await SingleTileImageryProvider.fromUrl(`${import.meta.env.BASE_URL}imagery/hubei.jpg`, {
        rectangle: imageBounds,
        credit: new Credit('<a href="https://www.earthdata.nasa.gov/data/projects/gibs" target="_blank" rel="noopener noreferrer">NASA Earthdata GIBS · Blue Marble</a>', true),
      });
      if (map.isDestroyed()) return;
      imageryLayer = map.imageryLayers.addImageryProvider(provider);
      imageryLayer.brightness = 1.08;
      imageryLayer.contrast = 1.01;
      imageryLayer.saturation = 0.85;
      imageryLayer.show = props.showImagery;
      map.scene.requestRender();
    } catch (error) {
      console.warn('Cesium imagery layer:', error);
    }
  } catch (error) {
    mapError.value = true;
    console.warn('Cesium initialization:', error);
  }
});

watch(() => props.projects, syncProjects);
watch(() => props.selectedId, syncSelection);
watch(() => props.showBoundaries, value => {
  if (borderLayer) borderLayer.show = value;
  viewer?.scene.requestRender();
});
watch(() => props.showCities, value => {
  if (cityLayer) cityLayer.show = value;
  viewer?.scene.requestRender();
});
watch(() => props.showImagery, value => {
  if (imageryLayer) imageryLayer.show = value;
  viewer?.scene.requestRender();
});
watch(() => props.command, command => {
  if (command) runCommand(command.action);
});

onBeforeUnmount(() => {
  removeCameraListener?.();
  inputHandler?.destroy();
  if (viewer && !viewer.isDestroyed()) viewer.destroy();
  viewer = undefined;
});
</script>

<template>
  <div class="cesium-map">
    <div ref="mapElement" class="cesium-map__scene" aria-label="湖北省产业项目地图"></div>
    <div class="cesium-map__credits">
      <div ref="mapCredits"></div>
      <a v-if="showBoundaries" href="https://datav.aliyun.com/portal/school/atlas/area_selector" target="_blank" rel="noopener noreferrer">行政区线 · 阿里云 DataV</a>
    </div>
    <div v-if="mapError" class="cesium-map__message" role="status">当前浏览器无法初始化 Cesium 地图</div>
  </div>
</template>

<style scoped>
.cesium-map,
.cesium-map__scene {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.cesium-map {
  background: #263b34 url('/imagery/hubei.jpg') center 57% / cover no-repeat;
}

.cesium-map__credits {
  position: absolute;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  color: #d3e5ef;
  background: #10202d99;
  padding: 0 4px;
  font-size: 9px;
  line-height: 9px;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 5px;
}

.cesium-map__credits a {
  color: inherit;
}

.cesium-map__message {
  position: absolute;
  top: 22%;
  left: 50%;
  transform: translateX(-50%);
  border: 1px solid #5386aa;
  border-radius: 3px;
  background: #0c2238e8;
  color: #d9edff;
  padding: 8px 14px;
  font-size: 13px;
}
</style>
