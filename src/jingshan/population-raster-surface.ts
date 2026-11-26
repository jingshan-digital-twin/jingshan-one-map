import { displayCellAt, displayCellId, displayColumnsPerDegree, displayRowsPerDegree, displayDensity, type PopulationDisplayGrid } from './population-display-grid.ts'
import { plannedCoverageColor, populationBand } from './population-grid.ts'
import { pickRaster, rasterCellById, selectedPixel, type PopulationRaster } from './population-raster.ts'

/** Paint selected source pixels on a copy, leaving the reusable overview texture intact. */
export function rasterAttributeCanvas(base:HTMLCanvasElement,bounds:number[],grid:PopulationRaster,ids:Iterable<string>){
  const blocks=new Map<PopulationRaster['blocks'][number],number[]>()
  for(const id of ids){
    const hit=rasterCellById(grid,id)
    if(!hit)continue
    let list=blocks.get(hit.block)
    if(!list){list=[];blocks.set(hit.block,list)}
    list.push(hit.index)
  }
  if(!blocks.size)return base
  const out=document.createElement('canvas'),tile=document.createElement('canvas')
  out.width=base.width;out.height=base.height
  const ctx=out.getContext('2d'),tc=tile.getContext('2d')
  if(!ctx || !tc)return base
  ctx.drawImage(base,0,0);ctx.imageSmoothingEnabled=false
  const [west,south,east,north]=bounds,sx=out.width/(east-west),sy=out.height/(north-south)
  for(const [b,list] of blocks){
    tile.width=b.width;tile.height=b.height
    const image=tc.createImageData(b.width,b.height)
    for(const index of list){const i=index*4;image.data.set([255,187,35,245],i)}
    tc.putImageData(image,0,0)
    ctx.setTransform((b.ne[0]-b.nw[0])*sx/b.width,(b.nw[1]-b.ne[1])*sy/b.width,
      (b.sw[0]-b.nw[0])*sx/b.height,(b.nw[1]-b.sw[1])*sy/b.height,(b.nw[0]-west)*sx,(north-b.nw[1])*sy)
    ctx.drawImage(tile,0,0)
  }
  return out
}
const texelsPerCell = 12

export async function rasterSurface(display:PopulationDisplayGrid, signal:AbortSignal) {
  if (signal.aborted || !display.cells.size) return
  const [left,bottom,right,top] = display.bounds
  const bounds:[number,number,number,number] = [left/displayColumnsPerDegree, bottom/displayRowsPerDegree,
    right/displayColumnsPerDegree, top/displayRowsPerDegree]
  const [west,south,east,north] = bounds
  const canvas = document.createElement('canvas')
  canvas.width = (right-left)*texelsPerCell
  canvas.height = (top-bottom)*texelsPerCell
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const sx = canvas.width/(east-west), sy = canvas.height/(north-south)
  const {range,radiusX,radiusY} = display
  if (range) {
    ctx.beginPath()
    ctx.ellipse((range.center[0]-west)*sx, (north-range.center[1])*sy, radiusX*sx, radiusY*sy, 0, 0, 2*Math.PI)
    ctx.clip()
  }
  ctx.globalAlpha = .78
  for (const cell of display.cells.values()) {
    const x = (cell.column-left)*texelsPerCell, y = (top-cell.row-1)*texelsPerCell
    ctx.fillStyle = populationBand(displayDensity(cell)).color
    ctx.fillRect(x,y,texelsPerCell,texelsPerCell)
  }
  ctx.globalAlpha = 1

  // Clip the coarser rectangles to valid source data and the active geographic/coverage
  // selection. An empty display cell never receives a fill or a border.
  const mask = document.createElement('canvas'), tile = document.createElement('canvas')
  mask.width = canvas.width; mask.height = canvas.height
  const mc = mask.getContext('2d'), tc = tile.getContext('2d')
  if (!mc || !tc) return
  mc.imageSmoothingEnabled = false
  const planned=display.selection.planned?.size ? display.selection.planned : undefined
  let deadline = performance.now()+8
  for (const block of display.footprint.grid.blocks) {
    const [w,s,e,n] = block.bounds
    if (e < west || n < south || w > east || s > north) continue
    if (performance.now() > deadline) {
      await new Promise<void>(resolve => setTimeout(resolve,0))
      if (signal.aborted) return
      deadline = performance.now()+8
    }
    tile.width = block.width; tile.height = block.height
    const pixels = tc.createImageData(block.width, block.height)
    let gained:ImageData|undefined
    for (let i = 0; i < block.people.length; i++) {
      if (!selectedPixel(display.footprint, block, i))continue
      pixels.data[4*i+3] = 255
      if(planned?.has(block.offset+i) && displayCellAt(display,block.lon[i],block.lat[i])?.plannedPeople){
        gained??=tc.createImageData(block.width,block.height)
        gained.data[4*i+3]=255
      }
    }
    tc.putImageData(pixels,0,0)
    mc.setTransform((block.ne[0]-block.nw[0])*sx/block.width, (block.nw[1]-block.ne[1])*sy/block.width,
      (block.sw[0]-block.nw[0])*sx/block.height, (block.nw[1]-block.sw[1])*sy/block.height,
      (block.nw[0]-west)*sx, (north-block.nw[1])*sy)
    mc.drawImage(tile,0,0)
    if(gained){
      tc.putImageData(gained,0,0)
      tc.globalCompositeOperation='source-in'
      tc.fillStyle=plannedCoverageColor
      tc.fillRect(0,0,block.width,block.height)
      ctx.save()
      ctx.setTransform(mc.getTransform())
      ctx.globalCompositeOperation='source-atop'
      ctx.imageSmoothingEnabled=false
      ctx.drawImage(tile,0,0)
      ctx.restore()
    }
  }
  ctx.strokeStyle = planned ? 'rgba(242,246,248,.27)' : 'rgba(242,246,248,.13)'
  for (const cell of display.cells.values()) {
    const x=(cell.column-left)*texelsPerCell,y=(top-cell.row-1)*texelsPerCell
    ctx.strokeRect(x+.5,y+.5,texelsPerCell-1,texelsPerCell-1)
  }
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(mask,0,0)
  return {canvas, bounds, pick:([x,y]:number[]) => {
    const cell = displayCellAt(display,x,y)
    if (!cell || range && ((x-range.center[0])/radiusX)**2 + ((y-range.center[1])/radiusY)**2 > 1) return
    if (pickRaster(display.footprint,x,y)) return displayCellId(cell)
  }}
}
