import { Cartesian2, Cartesian4, Color, Event, ImageMaterialProperty, Material, type JulianDate } from 'cesium'
import type { MapBounds } from './cim-map.ts'

// Cesium renders with a white 1×1 sampler while an image is being uploaded.
// Map imagery and population canvases are larger than one texel.
const mapImage = new Material({
  fabric: {
    type: 'JingshanMapImage',
    uniforms: { image: Material.DefaultImageId, repeat: new Cartesian2(1, 1), color: Color.WHITE },
    source: `
      czm_material czm_getMaterial(czm_materialInput materialInput) {
        if (imageDimensions.x == 1 && imageDimensions.y == 1) discard;
        czm_material material = czm_getDefaultMaterial(materialInput);
        vec4 pixel = texture(image, fract(repeat * materialInput.st)) * color;
        material.diffuse = czm_gammaCorrect(pixel.rgb);
        material.alpha = pixel.a;
        return material;
      }
    `,
  },
})

export class MapImageMaterialProperty extends ImageMaterialProperty {
  getType() { return mapImage.type }
}

export type ReliefTexture = {image:string | HTMLImageElement | HTMLCanvasElement; bounds:MapBounds}

// Composite the map inks onto the imagery before the depth test, so the relief has one opaque top.
const solidRelief = new Material({
  translucent:false,
  fabric:{
    type:'JingshanSolidRelief',
    uniforms:{image:Material.DefaultImageId,planningImage:Material.DefaultImageId,planningUV:new Cartesian4(1,1,0,0)},
    source:`
      czm_material czm_getMaterial(czm_materialInput inputData) {
        vec2 uv=clamp(inputData.st,0.0,1.0);
        vec3 surface=vec3(0.27,0.43,0.51);
        if (imageDimensions.x>1 || imageDimensions.y>1) {
          vec4 base=texture(image,uv);
          surface=mix(surface,base.rgb,base.a);
        }
        vec2 plan=uv*planningUV.xy+planningUV.zw;
        if ((planningImageDimensions.x>1 || planningImageDimensions.y>1) &&
            all(greaterThanEqual(plan,vec2(0.0))) && all(lessThanEqual(plan,vec2(1.0)))) {
          vec4 ink=texture(planningImage,plan);
          surface=mix(surface,ink.rgb,ink.a);
        }
        czm_material material=czm_getDefaultMaterial(inputData);
        material.diffuse=czm_gammaCorrect(surface);
        material.alpha=1.0;
        return material;
      }
    `,
  },
})

// Entity geometry creates fresh materials by type. Cesium's type cache reads this public flag.
solidRelief.translucent=false

export class SolidReliefMaterialProperty {
  readonly isConstant=true
  readonly definitionChanged=new Event()
  private readonly image:ReliefTexture['image']
  private readonly planningImage:ReliefTexture['image']
  private readonly uv=new Cartesian4(1,1,0,0)

  constructor(base?:ReliefTexture, planning?:ReliefTexture){
    this.image=base?.image ?? Material.DefaultImageId
    this.planningImage=planning?.image ?? Material.DefaultImageId
    if(base && planning){
      const [w,s,e,n]=base.bounds, [pw,ps,pe,pn]=planning.bounds
      this.uv=new Cartesian4((e-w)/(pe-pw),(n-s)/(pn-ps),(w-pw)/(pe-pw),(s-ps)/(pn-ps))
    }
  }
  getType(){return solidRelief.type}
  getValue(_time?:JulianDate,result:Record<string,unknown>={}){
    result.image=this.image
    result.planningImage=this.planningImage
    result.planningUV=this.uv
    return result
  }
  equals(other?:unknown){
    return other instanceof SolidReliefMaterialProperty && this.image===other.image &&
      this.planningImage===other.planningImage && Cartesian4.equals(this.uv,other.uv)
  }
}

export function populationMaterial(canvas: HTMLCanvasElement) {
  return Material.fromType(mapImage.type, { image: canvas })
}
