import type { BookingOriginSnapshot } from './venue-booking-origin.ts'

export type PublishedBookingOrigins = Omit<BookingOriginSnapshot, 'overall'> & {
  overall:BookingOriginSnapshot['overall'] | null
}

/** Durations in court-hours. Reserved includes bookings and locks, counted once per minute. */
export type BookingCell = [
  booked: number, locked: number, lessons: number, reserved: number, occupied: number, capacity: number,
]

export interface BookingCourt {
  id: string
  name: string
  venueId: string
  venueName: string
  project: string
  sourceName: string
  /** Indexed by snapshot date and operating period. */
  daily: BookingCell[][]
  /** One reference into the snapshot's hourProfiles per calendar date. */
  dailyHourProfile?: number[]
  /** Indexed by operating hour, over the entire history. */
  hourly: BookingCell[]
  /** Indexed by operating hour on the last day present in the source. */
  latest: BookingCell[]
}

export interface BookingSnapshot {
  schema: 1
  origins?:PublishedBookingOrigins
  sourceFile: string
  from: string
  through: string
  dates: string[]
  periods: { name: string; startHour: number; endHour: number }[]
  hours: number[]
  /** Unique daily sets of operating-hour cells shared across courts and dates. */
  hourProfiles?: BookingCell[][]
  courts: BookingCourt[]
}
