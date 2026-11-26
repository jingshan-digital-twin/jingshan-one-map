import {
  ArcType, Cartesian2, Cartesian3, Color, ColorGeometryInstanceAttribute, DistanceDisplayCondition, GeometryInstance, LabelStyle,
  PerInstanceColorAppearance, PinBuilder, PolygonGeometry, PolygonHierarchy, PolylineColorAppearance, PolylineGeometry, Primitive,
  PrimitiveCollection,
  PolylineDashMaterialProperty, PolylineGlowMaterialProperty, VerticalOrigin,
  type Entity, type EntityCollection,
} from 'cesium'
import type { Position } from 'geojson'
import { dashboardPalette as palette } from './dashboard-palette.ts'
import { availableParcelStyle } from './investment-planning.ts'
import { featureCenter, type CityFeature } from './types.ts'
import { servicePictograms } from './service-pictograms.ts'

const colors = {
  reserveGroup: '#9A58FF', park: palette.blue, parcel: palette.red, candidate: palette.yellow, gap: palette.orange,
  range: '#58dedc', link: '#68dffc', venue: palette.blue, support: '#23a8a4',
  building: '#5cd6fa', task: palette.blue, coverage: '#8cafd1', demand: palette.yellow,
  project:'#ffd15e', opportunity:'#df765e',
}
type Role = keyof typeof colors
type Props = CityFeature['properties']
const pins = new PinBuilder()
const pinCache = new Map<string, HTMLCanvasElement>()
const eventPinUrls = new WeakMap<HTMLCanvasElement,string>()

const pinText: Partial<Record<Role, string>> = {task:'办', demand:'需', project:'项'}

function pin(text: string, color: Color) {
  const css = color.toCssHexString()
  const key = css + text
  let canvas = pinCache.get(key)
  if (!canvas) {
    canvas = pins.fromText(text, color, 64)
    pinCache.set(key, canvas)
  }
  return canvas
}

const eventSymbols:Record<string,string> = {
  hotels:'宿', food:'餐', parking:'P', medical:'医', shelters:'避', charging:'充', coaches:'教', partners:'练',
  tourism:'游', scenic:'游', springs:'泉',
}

function eventPointIcon(role:Role,p:Props,color:Color) {
  if (p.kind === 'review-support') {
    const path = servicePictograms[p.supportKind as keyof typeof servicePictograms]
    if (path) return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="54" viewBox="0 0 30 34">'
      + '<path d="M15 33S2 21 2 14a13 13 0 0 1 26 0c0 7-13 19-13 19Z" fill="'+color.toCssHexString()+'" stroke="white" stroke-width="1.5"/>'
      + '<circle cx="15" cy="14" r="9.7" fill="#143451"/><path d="'+path+'" transform="translate(7.3 6.3) scale(.64)" '
      + 'fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>')
  }
  const glyph = typeof p.serviceGlyph === 'string' ? p.serviceGlyph :
    role === 'venue' ? '馆' : eventSymbols[String(p.supportKind ?? p.kind)] ?? '配'
  const canvas = pin(glyph,color)
  let url = eventPinUrls.get(canvas)
  if (!url) {
    // Polling a live scene rebuilds its entities. Reuse an image URL in Cesium's billboard atlas.
    url = canvas.toDataURL()
    eventPinUrls.set(canvas,url)
  }
  return url
}

function cssColor(value: unknown, fallback: string) {
  return (typeof value === 'string' && Color.fromCssColorString(value)) || Color.fromCssColorString(fallback)
}

function geometryColor(role: Role, p: Props) {
  if (role === 'coverage' && !p.color && !p.fillColor) {
    if (p.covered === true) return Color.fromCssColorString(palette.blue)
    if (p.covered === false) return Color.fromCssColorString(palette.orange)
  }
  return cssColor(p.fillColor ?? p.color, colors[role])
}

function place(path: Position[], height: number) {
  return path.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, height))
}

function shape(rings: Position[][], height: number) {
  return new PolygonHierarchy(place(rings[0], height), rings.slice(1).map(ring => new PolygonHierarchy(place(ring, height))))
}

// WGS84 locality circles are drawn in metres, independent of camera zoom.
function circle(center: Position, radius: number): Position[] {
  const [lon, lat] = center
  const radians = Math.PI / 180
  const distance = radius / 6371008.8
  const latitude = lat * radians
  const ring: Position[] = []
  for (let i = 0; i < 96; i++) {
    const angle = (2 * Math.PI * i) / 96
    const y = Math.asin(Math.sin(latitude) * Math.cos(distance) + Math.cos(latitude) * Math.sin(distance) * Math.cos(angle))
    const x = Math.atan2(Math.sin(angle) * Math.sin(distance) * Math.cos(latitude), Math.cos(distance) - Math.sin(latitude) * Math.sin(y))
    ring.push([lon + x / radians, y / radians])
  }
  ring.push(ring[0])
  return ring
}

export function sceneMapRole(feature: CityFeature) {
  const role = feature.properties.mapRole
  return typeof role === 'string' && Object.hasOwn(colors, role) ? role as Role : undefined
}

export function gridCell(feature: CityFeature) {
  const role = sceneMapRole(feature)
  return (role === 'gap' || role === 'coverage') && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')
}

// All available survey parcels share two draw batches. Picking either a face or its
// boundary yields the source feature ID, including on disjoint parts and interior rings.
export function availableParcelBatch(features:CityFeature[],surface:number) {
  const faces:GeometryInstance[]=[], edges:GeometryInstance[]=[]
  const fill=Color.fromCssColorString(availableParcelStyle.color).withAlpha(availableParcelStyle.fillOpacity)
  const stroke=Color.fromCssColorString(availableParcelStyle.strokeColor).withAlpha(.88)
  const faceAppearance=new PerInstanceColorAppearance({flat:true,translucent:true,closed:false})
  const edgeAppearance=new PolylineColorAppearance({translucent:true})
  for(const {id,geometry} of features){
    const parts=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[]
    for(const rings of parts){
      if(!rings[0] || rings[0].length<4)continue
      faces.push(new GeometryInstance({id,geometry:new PolygonGeometry({
        polygonHierarchy:shape(rings,surface+9),height:surface+9,vertexFormat:PerInstanceColorAppearance.FLAT_VERTEX_FORMAT
      }),attributes:{color:ColorGeometryInstanceAttribute.fromColor(fill)}}))
      for(const ring of rings){
        if(ring.length<2)continue
        edges.push(new GeometryInstance({id,geometry:new PolylineGeometry({
          positions:place(ring,surface+9.6),width:1.6,vertexFormat:PolylineColorAppearance.VERTEX_FORMAT
        }),attributes:{color:ColorGeometryInstanceAttribute.fromColor(stroke)}}))
      }
    }
  }
  const layer=new PrimitiveCollection()
  if(faces.length)layer.add(new Primitive({geometryInstances:faces,appearance:faceAppearance}))
  if(edges.length)layer.add(new Primitive({geometryInstances:edges,appearance:edgeAppearance}))
  return layer
}


// Hundreds of small population cells share one translucent draw batch. Keep each
// geometry's pick ID so table and map selections still refer to the same source cell.
export function populationGrid(features: CityFeature[], surface: number, selectedId: string | null,
  register: (id: string, featureId: string) => void) {
  const instances: GeometryInstance[] = []
  for (const feature of features) {
    const geometry = feature.geometry
    const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
    const p = feature.properties
    const role = p.mapRole === 'gap' ? 'gap' : 'coverage'
    const active = feature.id === selectedId || p.selected === true
    const color = active ? Color.fromCssColorString('#ffd55b') : geometryColor(role, p)
    const floor = surface + (active ? 23 : 18)
    for (const [i, rings] of parts.entries()) {
      if (rings[0]?.length < 4) continue
      const id = 'scene:grid:' + feature.id + (i ? ':' + i : '')
      instances.push(new GeometryInstance({
        id, geometry: new PolygonGeometry({polygonHierarchy: shape(rings, floor), height: floor,
          vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT}),
        attributes: {color: ColorGeometryInstanceAttribute.fromColor(color.withAlpha(active ? .85 : .65))},
      }))
      if (p.interactive !== false && (role === 'gap' || p.interactive === true)) register(id, feature.id)
    }
  }
  return instances.length ? new Primitive({
    geometryInstances: instances, asynchronous: false,
    appearance: new PerInstanceColorAppearance({flat: true, translucent: true, closed: false}),
  }) : undefined
}

export function addSceneFeature(collection: EntityCollection, feature: CityFeature, role: Role, selected: boolean,
  surface: number, light: boolean, register: (id: string, priority: number) => void, crowded = false, eventScene = false) {
  const p = feature.properties
  const geometry = feature.geometry
  const passive = role === 'link' || role === 'range'
  const active = !passive && (selected || p.selected === true)
  const color = geometryColor(role, p)
  const edge = active ? Color.fromCssColorString('#ffd55b') : cssColor(p.strokeColor, color.toCssHexString())
  const labelText = typeof p.label === 'string' ? p.label : p.name
  const showLabel = p.showLabel !== false && p.label !== false && (active || p.showLabel === true || Boolean(p.label) ||
    (role !== 'coverage' && role !== 'gap' && role !== 'range' && role !== 'link'))
  const overlay = role === 'coverage' || passive
  const selectable = p.interactive !== false && (!overlay || p.interactive === true)
  // A venue pin or a matched site inside a larger park / gap wins the pick.
  const priority = ['support', 'venue', 'task', 'demand'].includes(role) ? 3
    : ['parcel', 'building', 'candidate'].includes(role) ? 2 : 1
  const prefix = 'scene:' + feature.id + ':'
  const add = (suffix: string, options: Entity.ConstructorOptions) => {
    const id = prefix + suffix
    collection.add({ ...options, id })
    if (selectable) register(id, priority)
  }
  function label(offset: number, verticalOrigin = VerticalOrigin.BOTTOM) {
    if (!showLabel || !labelText) return undefined
    return {
      text: labelText, font: 'bold 16px "Microsoft YaHei UI", sans-serif', style: LabelStyle.FILL,
      fillColor: light ? Color.fromCssColorString('#10365f') : Color.WHITE, showBackground: true,
      backgroundColor: Color.fromCssColorString(light ? '#f0f8ff' : '#0d2856').withAlpha(.92),
      backgroundPadding: new Cartesian2(6, 3), pixelOffset: new Cartesian2(0, -offset),
      verticalOrigin, disableDepthTestDistance: Infinity,
      distanceDisplayCondition: (!active || p.limitLabelAtDistance===true) && typeof p.labelMaxDistance === 'number'
        ? new DistanceDisplayCondition(0, p.labelMaxDistance) : crowded && !active && p.showLabel !== true
          ? new DistanceDisplayCondition(0, 21_000) : undefined,
    }
  }

  const rangeRadius = Number(p.radiusM)
  const pointCircle = role === 'range' && geometry.type === 'Point' && rangeRadius > 0
    ? circle(geometry.coordinates, rangeRadius) : undefined
  const polygons = pointCircle ? [[pointCircle]] : geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  const offsets: Partial<Record<Role, number>> = {park: 2, gap: 4, coverage: 3, opportunity:4, range: 6, building: 1, project:10}
  const floor = surface + (p.kind==='available-parcel' ? 12 : offsets[role] ?? 9)
  const building = role === 'building'
  const height = building ? Math.max(3, Number(p.heightM) || 16) : 0
  const top = floor + height
  const opacity = typeof p.fillOpacity==='number' ? Math.max(0,Math.min(1,p.fillOpacity)) : role === 'opportunity' ? .13 : role === 'project' ? .20 :
    role === 'range' ? .11 : role === 'coverage' ? .32 : building ? (active ? .70 : .52) : active ? .48 : .27
  const lineWidth = role === 'coverage' ? .9 : role === 'opportunity' ? 1.5 : active || (p.kind==='available-parcel' && p.focused) ? 4 : 2.5
  const dashed = p.dashed === true || (role === 'range' && p.dashed !== false && !p.supportKind && p.radiusKm !== 1)
  polygons.forEach((rings, index) => {
    if (!rings[0]?.length) return
    if (building) {
      const outline = rings[0]
      const center = featureCenter(feature)
      if (center) {
        const frame = outline.map(([x,y]) => [center[0] + (x-center[0]) * 1.16, center[1] + (y-center[1]) * 1.16])
        add('base:' + index, {polygon: {hierarchy: shape([frame], floor), height: floor,
          material: edge.withAlpha(active ? .41 : .26)}})
        add('halo:' + index, {polyline: {positions: place(frame, floor + .3), width: active ? 6 : 4,
          material: new PolylineGlowMaterialProperty({color:edge,glowPower:.26})}})
      }
      add('roof:' + index, {polygon: {hierarchy: shape(rings, top + .15), height: top + .15,
        material: Color.fromCssColorString(active ? '#c2f7ff' : '#a5e8f6').withAlpha(active ? .85 : .64)}})
      // Draw vertical corners on simple footprints. Dense survey rings retain their measured silhouette.
      if (outline.length <= 24) outline.slice(0,-1).forEach(([x,y], i) => {
        add('pillar:' + index + ':' + i, {polyline: {
          positions: [Cartesian3.fromDegrees(x,y,floor),Cartesian3.fromDegrees(x,y,top)],
          width: active ? 2 : 1.5, arcType: ArcType.NONE,
          material: Color.fromCssColorString('#b7f4ff').withAlpha(active ? .94 : .70),
        }})
      })
    }
    add('surface:' + index, {polygon: {
      hierarchy: shape(rings, floor), height: floor, extrudedHeight: building ? top : undefined,
      closeTop: !building,
      material: color.withAlpha(opacity),
    }})
    rings.forEach((ring, indexRing) => add('edge:' + index + ':' + indexRing, {
      polyline: {
        positions: place(ring, top + .6), width: lineWidth,
        material: dashed
          ? new PolylineDashMaterialProperty({color: edge, dashLength: 14})
          : building ? Color.fromCssColorString('#bcf5ff').withAlpha(.94) : edge.withAlpha(role === 'coverage' ? .40 : .97),
      },
    }))
  })

  const paths = geometry.type === 'LineString' ? [geometry.coordinates]
    : geometry.type === 'MultiLineString' ? geometry.coordinates : []
  if (eventScene && p.kind === 'review-flow') {
    paths.forEach((path,index) => {
      const positions = place(path,floor + 3)
      add('glow:' + index,{polyline:{positions,width:9,material:new PolylineGlowMaterialProperty({color:edge,glowPower:.25})}})
      add('flow:' + index,{polyline:{positions,width:2,material:edge}})
    })
    return
  }
  paths.forEach((path, index) => add('line:' + index, {polyline: {
    positions: place(path, floor + 3), width: active ? 5 : 3,
    material: dashed ? new PolylineDashMaterialProperty({color: edge, dashLength: 14})
      : new PolylineGlowMaterialProperty({color: edge, glowPower: .18}),
  }}))
  if (pointCircle || polygons.length || paths.length) {
    const ring = polygons[0]?.[0]
    const center = role === 'range' && ring?.length
      ? ring.reduce((furthest, value) => value[0] > furthest[0] ? value : furthest)
      : featureCenter(feature)
    if (showLabel && center) add('caption', {position: Cartesian3.fromDegrees(center[0], center[1], top + 5), label: label(building ? 10 : 4)})
    return
  }
  const points = geometry.type === 'Point' ? [geometry.coordinates] : geometry.type === 'MultiPoint' ? geometry.coordinates : []
  points.forEach(([lon, lat], index) => {
    const position = Cartesian3.fromDegrees(lon, lat, floor + 2)
    if (eventScene && (p.kind === 'review-stop' || p.kind === 'review-source')) {
      const size = p.kind === 'review-source' ? 23 : 15
      const caption = label(size + 4)
      const side = p.captionSide === 'east' ? 1 : p.captionSide === 'west' ? -1 : 0
      add('halo:' + index,{position,point:{pixelSize:size + 13,color:color.withAlpha(.22),
        outlineColor:color.withAlpha(.7),outlineWidth:1,disableDepthTestDistance:Infinity}})
      add('stop:' + index,{position,point:{pixelSize:size,color:active ? edge : color,
        outlineColor:Color.WHITE,outlineWidth:2,disableDepthTestDistance:Infinity},
        label:caption && side ? {...caption,pixelOffset:new Cartesian2(side * 34,-9)} : caption})
      return
    }
    if(p.kind==='available-parcel'){
      add('option:'+index,{position,point:{pixelSize:active?16:p.focused?15:p.recommended?13:10,
        color:active?Color.fromCssColorString('#ffc64e'):color,outlineColor:p.focused?Color.WHITE:Color.fromCssColorString('#10244f'),
        outlineWidth:p.focused?3:1.8,disableDepthTestDistance:Infinity}})
      return
    }
    const eventPoint = (eventScene || p.kind === 'fusion-stop') && (role === 'venue' || role === 'support')
    if (!eventPoint && (role === 'venue' || role === 'support')) {
      const size = p.kind==='plan-court' ? (active?14:7) : (active?8:5)
      add('pin:' + index, {
        position,
        point: {color:color.withAlpha(active?1:.8),pixelSize:size,outlineColor:active?edge:Color.WHITE.withAlpha(.68),outlineWidth:p.kind==='plan-court'&&active?2:1,disableDepthTestDistance:Infinity},
        label: index === 0 && !p.labelOnZoom ? label(9) : undefined,
      })
      return
    }
    // Cesium stamps the category glyph into 40% of a pin. Keep its glyph at least 16 CSS pixels.
    const reviewSupport = p.kind === 'review-support'
    const size = reviewSupport ? (active ? 37 : 30) : eventPoint ? (active ? 48 : 42) : active ? 43 : crowded ? 24 : 32
    const pinDistance = reviewSupport ? 12500 : crowded ? 21000 : undefined
    add('pin:' + index, {
      position,
      billboard: {image: eventPoint ? eventPointIcon(role,p,active ? edge : color) : pin(pinText[role] ?? '•', active ? edge : color), width: size, height: reviewSupport ? size*34/30 : size,
        verticalOrigin: VerticalOrigin.BOTTOM, disableDepthTestDistance: Infinity,
        distanceDisplayCondition: pinDistance && !active ? new DistanceDisplayCondition(0, pinDistance) : undefined},
      point: pinDistance && !active ? {color, pixelSize: reviewSupport ? 6 : 8, outlineColor: Color.WHITE, outlineWidth: 1,
        disableDepthTestDistance: Infinity, distanceDisplayCondition: new DistanceDisplayCondition(pinDistance, Number.MAX_VALUE)} : undefined,
      label: index === 0 ? label(size + 3) : undefined,
    })
  })
}
