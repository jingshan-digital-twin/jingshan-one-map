import type { CityFeature, Coordinate } from './types.ts'

export type EventSource = { title: string; url: string; fields: string[]; note?: string }
export type PlannedEvent = {
  id: string; year: number; sequence: number; sourceRow: number; sourceFile: string; sourceSheet: string
  name: string; monthText: string; dateText: string; startDate: string | null; endDate: string | null
  months: number[]; datePrecision: 'day' | 'month' | 'unknown'; host: string; organizer: string
  participants: number | null; category: string; level: string; venueNames: string[]; introduction?: string; position?:Coordinate
  assessment: boolean; reportedStatus?: '进行中' | '已办结'; sample?: boolean; cancelled?: boolean
  sources: EventSource[]; notes: string[]; original: unknown[]
}
export const eventTopics = [
  ['traffic','道路交通'], ['security','治安安保'], ['food','食品安全'], ['weather','气象保障'],
  ['medical','医疗应急'], ['lodging','住宿接待'], ['volunteers','志愿服务'], ['supplies','应急物资'],
] as const
export type EventTopic = typeof eventTopics[number][0]
export type AssessmentInputs = {
  venueName: string; spectators: number | null; outsidePercent: number | null; overnightPercent: number | null
  carPercent: number; peoplePerCar: number; coreM: number; bufferM: number
  scenario: boolean; note: string
}
export type AssessmentItem = { id: string; title: string; detail: string; status: string; featureId?: string; controlWindow?: string }
export type AssessmentTopic = { id: EventTopic; label: string; department: string; items: AssessmentItem[] }
export type AssessmentSelection = Record<EventTopic,string[]>
export type EventDepartmentFeedback = {
  taskId: number; department: string; status: 'pending' | 'received' | 'completed'
  comment?: string; disposition?: 'adopted' | 'noted'; feedbackAt?: string
}
export type EventWorkflowRecord = {
  action: 'generated' | 'submitted' | 'feedback' | 'completed' | 'withdrawn' | 'superseded'; at: string; detail: string
}
export type EventAssessment = {
  eventId: string; revision: number; generatedAt: string; version: number; inputs: AssessmentInputs
  status: 'draft' | 'review' | 'completed'; position: Coordinate | null; locationNote: string
  totalPeople: number | null; parkingDemand: number | null; lodgingDemand: number | null
  parkingSupply: number | null; lodgingSupply: number | null
  roadBasis?: 'road-surfaces' | 'pending-road-surfaces'
  risks: string[]; topics: AssessmentTopic[]; features: CityFeature[]; roads: CityFeature[]
  departments: string[]; taskIds: number[]
  planVersion?: number; submittedAt?: string; completedAt?: string; withdrawnAt?: string; example?: boolean
  eventSnapshot?: PlannedEvent
  dispatchedItems?: AssessmentSelection
  feedback?: EventDepartmentFeedback[]; timeline?: EventWorkflowRecord[]
}
export type AssessmentWithdrawal = {
  eventId: string; name: string; year: number; revision: number; planVersion: number
  withdrawnAt: string; operator: string; reason: string
  departmentCount: number; feedbackCount: number; cancelledCount: number
  replacedByVersion?: number
}
export type EventCatalog = { events: PlannedEvent[]; assessments: Record<string, EventAssessment>; checkedAt: string;
  withdrawals?: AssessmentWithdrawal[];
  examples?: { event: PlannedEvent; plan: EventAssessment }[];
  sourceSummaries: {year:number;file:string;count:number;declaredParticipants:number|null;computedParticipants:number;note:string}[] }
