import type { MapBounds } from './cim-map.ts'

export async function planningRoofTexture(urls:string[], district:string,signal:AbortSignal){
  const surfaces=await Promise.allSettled(urls.map(async path=>{
    const url=new URL(path,location.origin)
    url.searchParams.set('district',district)
    const response=await fetch(url,{signal})
    if(!response.ok)throw Error('规划立体贴图暂不可用')
    const bounds=response.headers.get('X-Geo-Bounds')?.split(',').map(Number)
    if(bounds?.length!==4 || !bounds.every(Number.isFinite))throw Error('规划立体贴图缺少地理范围')
    return {bounds:bounds as MapBounds,image:await createImageBitmap(await response.blob())}
  }))
  const ready=surfaces.flatMap(r=>r.status==='fulfilled'?[r.value]:[])
  try{
    if(signal.aborted)return
    if(!ready.length || ready.length!==urls.length)throw Error('规划立体贴图不完整')
    const bounds:MapBounds=[Math.min(...ready.map(r=>r.bounds[0])),Math.min(...ready.map(r=>r.bounds[1])),
      Math.max(...ready.map(r=>r.bounds[2])),Math.max(...ready.map(r=>r.bounds[3]))]
    const canvas=document.createElement('canvas')
    canvas.width=Math.max(...ready.map(r=>r.image.width))
    canvas.height=Math.max(...ready.map(r=>r.image.height))
    const ctx=canvas.getContext('2d')
    if(!ctx)throw Error('无法绘制规划立体贴图')
    const dx=canvas.width/(bounds[2]-bounds[0]),dy=canvas.height/(bounds[3]-bounds[1])
    for(const {image,bounds:[w,s,e,n]} of ready)ctx.drawImage(image,(w-bounds[0])*dx,(bounds[3]-n)*dy,(e-w)*dx,(n-s)*dy)
    return {image:canvas,bounds}
  }finally{for(const r of ready)r.image.close()}
}
