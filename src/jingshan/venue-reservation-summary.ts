import { bookingOriginMarkets, mergeOriginMembers, type BookingOriginCounts } from './venue-booking-origin.ts'
import type { BookingSnapshot, PublishedBookingOrigins } from './venue-reservation-data.ts'

type CourtHours = { occupied:number; capacity:number }
const emptyHours = ():CourtHours => ({occupied:0, capacity:0})

function addHours(total:CourtHours, occupied:number, capacity:number) {
  total.occupied += occupied
  total.capacity += capacity
}

function withRate<T extends CourtHours>(hours:T) {
  return {...hours, rate:hours.capacity > 0 ? 100 * hours.occupied / hours.capacity : null}
}

function originsForSelection(source:PublishedBookingOrigins | undefined, ids:Set<string>):BookingOriginCounts | null {
  if (!source || !ids.size) return null
  const venues = source.venues.filter(venue => ids.has(venue.venueId))
  if (venues.length !== ids.size) return null
  if (source.overall && venues.length === source.venues.length) return source.overall
  if (venues.length === 1) return venues[0]!
  if (!source.cohorts) return null

  // Session counts are additive. People who visited several venues must only
  // contribute once, using the disjoint memberships computed during import.
  const records = venues.reduce((n,v) => n + v.records,0)
  const mobileRecords = venues.reduce((n,v) => n + v.mobileRecords,0)
  const members = mergeOriginMembers(source.cohorts.filter(group => group.venueIds.some(id => ids.has(id))))
  return {records,mobileRecords,nonMobileRecords:records-mobileRecords,...members}
}

export function summarizeVenueReservations(history:BookingSnapshot, venueIds:readonly string[]) {
  const allowed = new Set(venueIds)
  const lastDay = history.dates.indexOf(history.through)
  const emptyPeriods = () => history.periods.map(period => ({...period,...emptyHours()}))
  function newVenue(id:string, name:string) {
    return {id,name,courtCount:0,overall:emptyHours(),today:emptyHours(),periods:emptyPeriods()}
  }
  const rows = new Map<string,ReturnType<typeof newVenue>>()
  for (const court of history.courts) {
    if (!allowed.has(court.venueId)) continue
    const venue = rows.get(court.venueId) ?? newVenue(court.venueId,court.venueName)
    venue.courtCount++
    for (const cell of court.hourly) addHours(venue.overall,cell[4],cell[5])
    for (const [i,cell] of (court.daily[lastDay] ?? []).entries()) {
      const period = venue.periods[i]
      if (period) addHours(period,cell[4],cell[5])
      addHours(venue.today,cell[4],cell[5])
    }
    rows.set(venue.id,venue)
  }
  const overall = emptyHours(), today = emptyHours(), periods = emptyPeriods()
  let courtCount = 0
  const venues = [...rows.values()].map(venue => {
    courtCount += venue.courtCount
    addHours(overall,venue.overall.occupied,venue.overall.capacity)
    addHours(today,venue.today.occupied,venue.today.capacity)
    venue.periods.forEach((period,i) => addHours(periods[i]!,period.occupied,period.capacity))
    return {...venue,overall:withRate(venue.overall),today:withRate(venue.today),periods:venue.periods.map(withRate)}
  }).sort((a,b) => (b.today.rate ?? -1) - (a.today.rate ?? -1) || a.name.localeCompare(b.name,'zh-CN'))
  const origins = originsForSelection(history.origins,new Set(rows.keys()))
  const originShares = origins?.locatedMembers ? bookingOriginMarkets(origins).map(({name,count}) =>
    ({label:name, rate:100 * count / origins.locatedMembers})) : []
  return {from:history.from,through:history.through,courtCount,overall:withRate(overall),today:withRate(today),
    periods:periods.map(withRate),venues,origins,originShares}
}
