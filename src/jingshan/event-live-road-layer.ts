import {
  Cartesian3, ClassificationType, Color, GeometryInstance, GroundPolylineGeometry, GroundPolylinePrimitive,
  Material, PolylineMaterialAppearance, PrimitiveCollection, type Scene,
} from 'cesium'
import type { LiveTrafficStatus } from './event-live-types.ts'
import type { CityFeature } from './types.ts'
import { liveRoadStyles as roadStyles } from './event-live-roads.ts'

const trafficMaterial = `
czm_material czm_getMaterial(czm_materialInput inputData) {
    czm_material material = czm_getDefaultMaterial(inputData);
    vec2 st = inputData.st;
    float slope = length(vec2(dFdx(st.s), dFdy(st.s)));
    float pixels = st.s / max(0.0000001, slope) / czm_pixelRatio;
    float across = abs(2.0 * st.t - 1.0);
    float interior = 1.0 - smoothstep(0.74, 0.94, across);
    vec3 ink = mix(roadColor.rgb * 0.32, roadColor.rgb, interior);
    if (closedRoad > 0.5) {
        float stripe = fract(pixels / 15.0 + st.t * 0.6);
        float barrier = smoothstep(0.03, 0.12, stripe) * (1.0 - smoothstep(0.43, 0.52, stripe));
        ink = mix(ink, vec3(1.0, 0.85, 0.81), barrier * interior);
    } else {
        float phase = fract((pixels - offsetPixels) / 38.0 + across * 0.14);
        float pulse = smoothstep(0.15, 0.63, phase) * (1.0 - smoothstep(0.63, 0.71, phase));
        ink = mix(ink, vec3(1.0, 0.99, 0.94), pulse * interior * 0.86);
    }
    material.diffuse = ink;
    material.alpha = 1.0;
    return material;
}`

export function createLiveRoadLayer(scene: Scene, features: CityFeature[]) {
  const layer = scene.groundPrimitives.add(new PrimitiveCollection())
  const batches = new Map<LiveTrafficStatus, GeometryInstance[]>()
  for (const { geometry, properties } of features) {
    const status = properties.trafficStatus
    if (typeof status !== 'string' || !Object.hasOwn(roadStyles, status)) continue
    const key = status as LiveTrafficStatus
    const paths = geometry.type === 'LineString' ? [geometry.coordinates]
      : geometry.type === 'MultiLineString' ? geometry.coordinates : []
    for (const path of paths) {
      if (path.length < 2) continue
      const positions = path.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat))
      const instance = new GeometryInstance({ geometry: new GroundPolylineGeometry({ positions, width: 11 }) })
      if (!batches.has(key)) batches.set(key, [])
      batches.get(key)!.push(instance)
    }
  }
  const flows: { material: Material; speed: number }[] = []
  // Paint more severe states last when adjoining service geometries overlap at junctions.
  for (const key of Object.keys(roadStyles) as LiveTrafficStatus[]) {
    const instances = batches.get(key)
    if (!instances) continue
    const { color, speed } = roadStyles[key]
    const material = new Material({
      fabric: {
        type: 'JingshanLiveRoad',
        uniforms: { roadColor: Color.fromCssColorString(color), closedRoad: Number(key === 'closed'), offsetPixels: 0.0 },
        source: trafficMaterial,
      },
      translucent: false,
    })
    layer.add(new GroundPolylinePrimitive({
      geometryInstances: instances, appearance: new PolylineMaterialAppearance({ material }),
      classificationType: ClassificationType.TERRAIN, allowPicking: false,
    }))
    if (speed > 0) flows.push({ material, speed })
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let lastFrame = 0
  const stop = flows.length ? scene.preUpdate.addEventListener(() => {
    const now = performance.now()
    if (document.hidden || reducedMotion.matches || now - lastFrame < 1000 / 24) return
    lastFrame = now
    for (const { material, speed } of flows) material.uniforms.offsetPixels = ((now / 1000) * speed) % 38
    scene.requestRender()
  }) : undefined
  return {
    bringToFront() { scene.groundPrimitives.raiseToTop(layer) },
    destroy() {
      stop?.()
      scene.groundPrimitives.remove(layer)
    },
  }
}
