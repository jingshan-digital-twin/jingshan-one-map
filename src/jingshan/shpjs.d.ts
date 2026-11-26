declare module 'shpjs' {
  import type {FeatureCollection} from 'geojson'
  export default function readShapefile(parts:{shp:Uint8Array;dbf?:Uint8Array;prj?:Uint8Array;cpg?:string}): Promise<FeatureCollection>
  export default function readShapefile(buffer:ArrayBuffer): Promise<FeatureCollection | FeatureCollection[]>
}
