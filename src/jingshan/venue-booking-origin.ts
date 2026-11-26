export interface BookingOriginRegion {
  province:string
  city:string
  members:number
}

export function originShare(count:number, locatedMembers:number) {
  return locatedMembers > 0 ? (100 * count / locatedMembers).toFixed(1) + '%' : '—'
}

export interface BookingOriginCounts {
  /** Valid booking sessions, including those without an identifiable mobile number. */
  records:number
  mobileRecords:number
  nonMobileRecords:number
  /** Distinct mobile numbers, including unmatched prefixes. */
  members:number
  locatedMembers:number
  unknownMembers:number
  regions:BookingOriginRegion[]
}

export interface VenueBookingOrigin extends BookingOriginCounts {
  venueId:string
  venueName:string
  /** Only courts actually represented in the member booking export. */
  courtIds:string[]
}

type MemberCounts = Pick<BookingOriginCounts, 'members' | 'locatedMembers' | 'unknownMembers' | 'regions'>

/** Each member belongs to exactly one combination of visited venues. */
export interface BookingOriginCohort extends MemberCounts {
  venueIds:string[]
}

export function mergeOriginMembers(groups:readonly MemberCounts[]):MemberCounts {
  const regions = new Map<string,BookingOriginRegion>()
  let locatedMembers = 0, unknownMembers = 0
  for (const group of groups) {
    locatedMembers += group.locatedMembers
    unknownMembers += group.unknownMembers
    for (const row of group.regions) {
      const key = row.province + '/' + row.city
      const existing = regions.get(key)
      if (existing) existing.members += row.members
      else regions.set(key,{...row})
    }
  }
  return {members:locatedMembers + unknownMembers, locatedMembers, unknownMembers,
    regions:[...regions.values()].sort((a,b) => b.members - a.members ||
      a.province.localeCompare(b.province,'zh-CN') || a.city.localeCompare(b.city,'zh-CN'))}
}

export function bookingOriginMarkets(counts:BookingOriginCounts) {
  let jingmen = 0, hubei = 0, other = 0
  for (const region of counts.regions) {
    if (region.province.startsWith('湖北') && region.city.startsWith('荆门')) jingmen += region.members
    else if (region.province.startsWith('湖北')) hubei += region.members
    else other += region.members
  }
  return [{name:'荆门',count:jingmen},{name:'湖北其他地区',count:hubei},{name:'省外',count:other}]
}

export interface BookingOriginSnapshot {
  schema:1
  sourceFile:string
  from:string
  through:string
  lookupSource:string
  lookupUrl:string
  /** Deduplicated across venues, so this count cannot be obtained by adding venue counts. */
  overall:BookingOriginCounts
  venues:VenueBookingOrigin[]
  cohorts?:BookingOriginCohort[]
}
