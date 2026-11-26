import type {SupportKind} from './venue-support.ts'
import {dashboardPalette} from './dashboard-palette.ts'

export const serviceSymbols = {
  food:     {glyph:'吃',color:dashboardPalette.orange},
  hotels:   {glyph:'住',color:dashboardPalette.blue},
  tourism:  {glyph:'游',color:'#35b987'},
  shopping: {glyph:'购',color:'#df85c8'},
  coaches:  {glyph:'训',color:dashboardPalette.cyan},
  partners: {glyph:'陪',color:dashboardPalette.red},
  springs:  {glyph:'泉',color:dashboardPalette.purple},
  medical:  {glyph:'医',color:dashboardPalette.green},
  parking:  {glyph:'停',color:dashboardPalette.sky},
  charging: {glyph:'充',color:dashboardPalette.yellow},
  venue:    {glyph:'场',color:'#91b7ff'},
} satisfies Record<SupportKind|'venue',{glyph:string;color:string}>

export const serviceCaptionResolution = .85 // metres per CSS pixel
export type ServicePoint = {id:string; name:string; selected:boolean}
type ProjectedPoint = ServicePoint & {x:number; y:number; metersPerPixel:number; withinLabelRange?:boolean}
export type ServiceCaption = ServicePoint & {x:number; y:number; width:number}

export function layoutServiceCaptions(points:ProjectedPoint[], width:number, height:number, highlight?:string):ServiceCaption[] {
  const margin = 2
  const captionHeight = 28
  const offset = captionHeight / 2 + 6
  if (width <= 2 * margin || height < captionHeight + 2 * margin) return []

  const visible = points.filter(point => (point.selected || point.withinLabelRange || point.metersPerPixel <= serviceCaptionResolution) &&
    point.name.trim() && point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height)
  const center = visible.find(point => point.selected) ?? {x:width / 2, y:height / 2}
  const distance = (point:ProjectedPoint) => Math.hypot(point.x - center.x, point.y - center.y)
  visible.sort((a,b) => Number(b.selected) - Number(a.selected) || Number(b.id === highlight) - Number(a.id === highlight) ||
    distance(a) - distance(b) || a.id.localeCompare(b.id))

  const captions:ServiceCaption[] = []
  const limit = Math.ceil(width * height / 16000)
  for (const {id, name, selected, x, y} of visible) {
    const textWidth = Array.from(name).reduce((sum,char) => sum + (char.charCodeAt(0) > 255 ? 18 : 11), 16)
    const size = Math.min(textWidth, width - 2 * margin)
    const cx = Math.max(margin + size / 2, Math.min(width - margin - size / 2, x))
    const cy = y - offset - captionHeight / 2 >= margin ? y - offset : y + offset
    if (cy + captionHeight / 2 > height - margin || captions.some(caption => caption.id === id ||
      (Math.abs(caption.x - cx) < (caption.width + size) / 2 + 4 && Math.abs(caption.y - cy) < captionHeight + 4))) continue
    captions.push({id, name, selected, x:cx, y:cy, width:size})
    if (captions.length >= limit) break
  }
  return captions
}
