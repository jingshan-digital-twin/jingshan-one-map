import type { CityFeature, Coordinate } from './types.ts'

export type LivePointKind = 'venue' | 'parking' | 'police' | 'medical' | 'camera' | 'entrance' | 'shuttle' | 'supplies'
export type LivePointStatus = 'normal' | 'busy' | 'warning' | 'offline' | 'standby'
export type LiveTrafficStatus = 'closed' | 'congested' | 'slow' | 'smooth'
export type LiveSeverity = 'high' | 'medium' | 'info'
export type LiveIncidentStatus = 'pending' | 'dispatched' | 'received' | 'onsite' | 'resolved'
export type LiveTransitionAction = 'dispatch' | 'receive' | 'onsite' | 'resolve' | 'consult'
export type LiveMonitorPoint = {
  id: string; eventId: string; name: string; kind: LivePointKind; position: Coordinate
  demo: boolean; status: LivePointStatus; updatedAt: string
  metrics: { label: string; value: number | string; unit?: string; percent?: number }[]
  contact?: { name: string; phone: string; department: string }
  camera?: { code: string; online: boolean; source: 'simulation' | 'url'; url?: string; view: 'entrance' | 'parking' | 'court' }
}
export type LiveAlert = {
  id: string; title: string; level: LiveSeverity; pointId?: string; detail: string
  type: 'parking' | 'crowd' | 'weather'; createdAt: string; incidentId?: string
}
export type LiveAction = { id: string; at: string; action: 'alert' | LiveTransitionAction; label: string; note: string }
export type LiveIncident = {
  id: string; eventId: string; title: string; type: string; level: LiveSeverity; pointId?: string
  department: string; collaborators: string[]; deadline: string; status: LiveIncidentStatus
  createdAt: string; updatedAt: string; history: LiveAction[]; resourceIds: string[]
}
export type LiveNotice = { id: string; at: string; text: string }
export type LiveEventMonitor = {
  awaitingMonitor?: boolean
  id: string; planId?: string; name: string; venueName: string; position: Coordinate | null; day: number | null
  status: 'ongoing'; demo: boolean; startTime: string; nextPeak: string; snapshotAt: string; revision: number; publicationVersion?:number
  metrics: { onsite: number | null; capacity: number | null; vehicles: number | null; hotelRooms: number | null; medicalPoints: number | null; staff: number | null }
  traffic: { smooth: number | null; slow: number | null; congested: number | null }
  points: LiveMonitorPoint[]; routes: CityFeature[]; alerts: LiveAlert[]; incidents: LiveIncident[]; publicNotices: LiveNotice[]
}
