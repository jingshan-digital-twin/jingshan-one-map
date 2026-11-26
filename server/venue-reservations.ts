import { readFile } from 'node:fs/promises'
import type { RequestHandler } from 'express'
import type { Pool } from 'pg'
import type { BookingSnapshot, PublishedBookingOrigins } from '../src/jingshan/venue-reservation-data.ts'
import { mergeOriginMembers, type BookingOriginCohort, type BookingOriginSnapshot } from '../src/jingshan/venue-booking-origin.ts'

type PublishedCourt = { id:string; name:string; venueId:string; venueName:string }
const source = new URL('./resource-sources/venue-reservations.json', import.meta.url)
const originSource = new URL('./resource-sources/venue-booking-origin.json', import.meta.url)

export function originsForPublishedCourts(origins:BookingOriginSnapshot, courts:BookingSnapshot['courts']):PublishedBookingOrigins {
  const published = new Map(courts.map(court => [court.id, court]))
  // Distinct subscribers cannot be subtracted from an aggregate when a contributing court disappears.
  const venues = origins.venues.filter(venue => venue.courtIds.length > 0 &&
    venue.courtIds.every(id => published.get(id)?.venueId === venue.venueId))
  if (venues.length && venues.length === origins.venues.length) return origins
  const available = new Set(venues.map(venue => venue.venueId))
  const combinations = new Map<string,BookingOriginCohort[]>()
  for (const cohort of origins.cohorts ?? []) {
    const venueIds = cohort.venueIds.filter(id => available.has(id))
    if (!venueIds.length) continue
    const key = JSON.stringify(venueIds)
    const matches = combinations.get(key) ?? []
    matches.push(cohort)
    combinations.set(key,matches)
  }
  const cohorts = origins.cohorts && [...combinations].map(([key,groups]) =>
    ({venueIds:JSON.parse(key) as string[], ...mergeOriginMembers(groups)}))
  return {...origins, venues, cohorts, overall:null}
}

export function bookingsForPublishedCourts(history:BookingSnapshot, courts:PublishedCourt[]):BookingSnapshot {
  const directory = new Map(courts.map(court => [court.id, court]))
  const matched = history.courts.flatMap(court => {
    const current = directory.get(court.id)
    if (!current || current.venueId !== court.venueId) return []
    return [{...court, name:current.name, venueName:current.venueName}]
  })
  if (!history.hourProfiles || matched.length === history.courts.length) return {...history, courts:matched}
  const used = [...new Set(matched.flatMap(court => court.dailyHourProfile ?? []))]
  const index = new Map(used.map((id,i) => [id,i]))
  return {...history, hourProfiles:used.map(id => history.hourProfiles![id]), courts:matched.map(court => ({
    ...court, dailyHourProfile:court.dailyHourProfile?.map(id => index.get(id)!),
  }))}
}

export function venueReservationsHandler(pool:Pool):RequestHandler {
  return async (_req, res) => {
    const [sourceText, originText, publication] = await Promise.all([
      readFile(source, 'utf8'),
      readFile(originSource, 'utf8'),
      pool.query<{version:number; courts:PublishedCourt[]}>(`
        SELECT w.version, COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', f->>'id', 'name', f->'properties'->>'name',
            'venueId', f->'properties'->>'facilityId', 'venueName', f->'properties'->>'facilityName'
          ))
          FROM jsonb_array_elements(w.published->'datasets') d
          CROSS JOIN LATERAL jsonb_array_elements(d->'features') f
          WHERE d->>'id' = 'courts' AND f->'properties'->>'facilityName' IS NOT NULL
        ), '[]'::jsonb) AS courts FROM jingshan_workspace w WHERE w.id
      `),
    ])
    const current = publication.rows[0]
    const history = bookingsForPublishedCourts(JSON.parse(sourceText) as BookingSnapshot, current?.courts ?? [])
    history.origins = originsForPublishedCourts(JSON.parse(originText) as BookingOriginSnapshot, history.courts)
    res.set('X-Publication-Version', String(current?.version ?? 0)).json(history)
  }
}
