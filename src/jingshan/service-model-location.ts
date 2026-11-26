import type {Position} from 'geojson'
import {featureCenter,type CityFeature,type Coordinate,type Dataset} from './types.ts'
import type { CimService } from './cim-types.ts'

export interface VenueModelFocus { name:string; position:Coordinate; id?:string }

// WGS84 extents of the published root boundingVolume.box after its root transform.
// The ledger distinguishes the original training base from its second-phase site.
const venueTiles = [
  {tile:'tennis-southwest',names:['国际网球中心','国际网球赛事中心','网球中心'],bounds:[113.1361504,30.9928706,113.1389467,30.9951320]},
  {tile:'tennis-northeast',names:['网球训练基地','网球训练基地一期','网球训练基地(一期)'],bounds:[113.1400081,30.9958339,113.1405848,30.9964044]},
]

export function venueModelTile(focus:VenueModelFocus|undefined) {
  if(!focus)return
  const names=[focus.name,focus.id?.replace(/^ledger-venue:/,'')].map(name=>
    name?.normalize('NFKC').replace(/\s/g,'').replace(/^京山市?/,''))
  const [x,y]=focus.position
  return venueTiles.find(({bounds:[west,south,east,north],names:aliases})=>
    x>=west && x<=east && y>=south && y<=north && aliases.some(name=>names.includes(name)))?.tile
}

export function venueModelForFocus(focus:VenueModelFocus|undefined, services:readonly CimService[]) {
  const tile=venueModelTile(focus)
  if(tile)return services.find(service=>service.enabled && service.kind==='3dtiles' &&
    service.mapUrl.split(/[?#]/,1)[0].endsWith('/local-tiles/'+tile+'/tileset.json'))
}

export const tennisCenterModelPosition:Coordinate=[113.13892249,30.99506023]
const demoCenterPosition:Coordinate=[113.112,31.021]
export function alignSampleTennisCenter(datasets:Dataset[]):Dataset[] {
  const center=datasets.find(d=>d.id==='venues')?.features.find(f=>f.id==='venue-international'&&
    f.properties.sample===true&&f.properties.name==='京山国际网球中心')
  const origin=center?.geometry&&featureCenter(center)
  if(!center||!origin||Math.abs(origin[0]-demoCenterPosition[0])>.001||Math.abs(origin[1]-demoCenterPosition[1])>.001)return datasets
  const dx=tennisCenterModelPosition[0]-origin[0],dy=tennisCenterModelPosition[1]-origin[1]
  const move=(p:Position)=>[p[0]+dx,p[1]+dy,...p.slice(2)]
  const align=(f:CityFeature):CityFeature=>{
    if(f.properties.sample!==true||!(f===center||f.properties.facilityId===center.id))return f
    const g=f.geometry
    if(g?.type==='Point')return {...f,geometry:{...g,coordinates:move(g.coordinates)}}
    if(g?.type==='Polygon')return {...f,geometry:{...g,coordinates:g.coordinates.map(r=>r.map(move))}}
    if(g?.type==='MultiPolygon')return {...f,geometry:{...g,coordinates:g.coordinates.map(poly=>poly.map(r=>r.map(move)))}}
    return f
  }
  return datasets.map(d=>d.id==='venues'||d.id==='courts'?{...d,features:d.features.map(align)}:d)
}

