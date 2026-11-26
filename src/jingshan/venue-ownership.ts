import { dashboardPalette } from './dashboard-palette.ts'

export const venueOwnershipGroups = [
  { label:'国有', shortLabel:'国有', color:dashboardPalette.green, icon:'state', aliases:['国有场馆','公共场馆'] },
  { label:'学校', shortLabel:'学校', color:dashboardPalette.blue, icon:'school', aliases:['校园','教育','学校场馆','校园场馆','教育场馆'] },
  { label:'机关单位', shortLabel:'机关', color:dashboardPalette.yellow, icon:'government', aliases:['机关场馆','机关单位场馆'] },
  { label:'民营和社会', shortLabel:'民营', color:dashboardPalette.purple, icon:'private', aliases:['民营或社会','社会','商业','俱乐部','民营及社会','民营场馆','社会场馆','商业场馆'] },
  { label:'村镇', shortLabel:'村镇', color:dashboardPalette.cyan, icon:'state', aliases:['乡镇','镇村','村集体','镇集体','村镇场馆','乡镇场馆'] },
] as const

type OwnershipGroup = typeof venueOwnershipGroups[number]
export type VenueOwnership = OwnershipGroup['label']

const byName = new Map<string,OwnershipGroup>()
for (const group of venueOwnershipGroups) {
  for (const value of [group.label,group.shortLabel,...group.aliases]) byName.set(value,group)
}

export function venueOwnershipGroup(raw:unknown) {
  return typeof raw === 'string' ? byName.get(raw.trim()) : undefined
}
