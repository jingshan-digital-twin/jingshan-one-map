import { Cartesian3, ConstantProperty, Matrix4, SceneTransforms, VerticalOrigin, type Entity, type Viewer } from 'cesium'

export function eventLabelLayout() {
  const view=new Matrix4()
  const context=document.createElement('canvas').getContext('2d')!
  let dirty=true, width=0, height=0
  function update(map:Viewer,entities:()=>Entity[],selected:(id:string)=>boolean) {
    const {scene,camera,canvas}=map
    if(!dirty && width===canvas.clientWidth && height===canvas.clientHeight && Matrix4.equals(view,camera.viewMatrix))return
    dirty=false
    width=canvas.clientWidth
    height=canvas.clientHeight
    Matrix4.clone(camera.viewMatrix,view)
    const time=map.clock.currentTime
    const rows=entities().filter(e=>e.show && e.label && e.position).map(entity=>({
      entity, priority:Number(selected(entity.id)),
    })).sort((a,b)=>b.priority-a.priority)
    const occupied:{left:number;right:number;top:number;bottom:number}[]=[]
    for(const {entity} of rows){
      const label=entity.label!, position=entity.position!.getValue(time)
      if(!position)continue
      const pixel=SceneTransforms.worldToWindowCoordinates(scene,position)
      const condition=label.distanceDisplayCondition?.getValue(time)
      const distance=Cartesian3.distance(camera.positionWC,position)
      let visible=false
      if(pixel && (!condition || (distance>=condition.near && distance<=condition.far))){
        const font=label.font?.getValue(time)??'16px sans-serif'
        context.font=font
        const text=label.text?.getValue(time)??''
        const offset=label.pixelOffset?.getValue(time)
        const x=pixel.x+(offset?.x??0), y=pixel.y+(offset?.y??0)
        const halfWidth=context.measureText(text).width/2+8
        const bottom=label.verticalOrigin?.getValue(time)===VerticalOrigin.BOTTOM?y+3:y+13
        const box={left:x-halfWidth,right:x+halfWidth,top:bottom-26,bottom}
        if(box.right>=0 && box.left<=width && box.bottom>=0 && box.top<=height &&
            !occupied.some(other=>box.left<other.right && box.right>other.left && box.top<other.bottom && box.bottom>other.top)){
          visible=true
          occupied.push(box)
        }
      }
      if((label.show?.getValue(time)??true)!==visible){
        if(label.show instanceof ConstantProperty)label.show.setValue(visible)
        else label.show=new ConstantProperty(visible)
        scene.requestRender()
      }
    }
  }
  return {invalidate:()=>{dirty=true},update}
}
