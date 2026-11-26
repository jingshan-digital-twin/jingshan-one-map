import { eventCalendarStatus, eventVenueNames, isRegisteredCompetition } from './event-plan-data.ts'
import { selectedTopics } from './event-plan-selection.ts'
import { eventTopics, type EventAssessment, type EventTopic, type PlannedEvent } from './event-plan-types.ts'
import { assessmentStatus } from './event-workflow.ts'

export type AssessmentStage = ReturnType<typeof assessmentStatus>
type Plans = Readonly<Record<string,EventAssessment>>
type VenueOverlap = { venue:string; startDate:string; endDate:string; events:PlannedEvent[] }
export interface AssessmentOverview {
  stageRows:{stage:AssessmentStage; count:number; events:PlannedEvent[]}[]
  topics:{id:EventTopic; label:string; responded:number; assigned:number}[]
  overlaps:VenueOverlap[]
  missingVenues:PlannedEvent[]
}

function activePlan(event:PlannedEvent, assessments:Plans) {
  const plan = assessments[event.id]
  return plan && !plan.example && !plan.withdrawnAt ? plan : undefined
}

export function eventAssessmentStage(event:PlannedEvent, assessments:Plans):AssessmentStage | undefined {
  if (!isRegisteredCompetition(event)) return
  const plan = activePlan(event,assessments)
  if (event.assessment || plan) return assessmentStatus(plan)
}

function topicProgress(plans:EventAssessment[]):AssessmentOverview['topics'] {
  const responses = new Map<EventTopic,Map<string,boolean>>()
  for (const plan of plans) {
    if (plan.status === 'draft' || !plan.taskIds.length) continue
    const topics = selectedTopics(plan.topics,plan.dispatchedItems)
    for (const [index,taskId] of plan.taskIds.entries()) {
      const department = plan.departments[index]
      if (!department) continue
      const replied = plan.feedback?.some(row =>
        row.taskId === taskId && row.department === department && row.status === 'completed') ?? false
      for (const topic of topics) {
        if (topic.department !== department || !topic.items.length) continue
        const departments = responses.get(topic.id) ?? new Map<string,boolean>()
        // One department is counted once per topic, after all of its current assignments have replied.
        departments.set(department,(departments.get(department) ?? true) && replied)
        responses.set(topic.id,departments)
      }
    }
  }
  return eventTopics.flatMap(([id,label]) => {
    const departments = responses.get(id)
    return departments ? [{id,label,responded:[...departments.values()].filter(Boolean).length,assigned:departments.size}] : []
  })
}

const unknownVenue = /^(?:(?:比赛|举办)?场馆[：:]?\s*)?(?:无|暂无|待定|待确认|待确定|未定|未确定|尚未确定|待落实|待核实|未填写|未登记|另行通知|[-—/]+)(?:场馆(?:信息)?)?$/
function registeredVenues(event:PlannedEvent) {
  const names = event.venueNames.map(name => name.trim()).filter(name => name && !unknownVenue.test(name))
  return [...new Set(names.map(name => eventVenueNames(name).at(-1)!))]
}

type DatedEvent = PlannedEvent & {startDate:string; endDate:string}
function sharedDates(venues:Map<string,DatedEvent[]>, monthKey:string, today:string) {
  const overlaps:VenueOverlap[] = []
  const dayMs = 86_400_000
  for (const [venue,events] of venues) {
    // The ending day is part of the tournament. Membership changes only at a start or the following day after a finish.
    const changes = events.flatMap(event => [
      {at:Date.parse(event.startDate), event, entering:true},
      {at:Date.parse(event.endDate)+dayMs, event, entering:false},
    ]).sort((a,b) => a.at-b.at || a.event.sequence-b.event.sequence)
    const active = new Set<DatedEvent>()
    for (const [index,{at,event,entering}] of changes.entries()) {
      if (entering) active.add(event)
      else active.delete(event)
      const next = changes[index+1]?.at
      if (active.size < 2 || next === undefined || next === at) continue
      const startDate = new Date(at).toISOString().slice(0,10)
      const endDate = new Date(next-dayMs).toISOString().slice(0,10)
      if (endDate < today || (monthKey && (endDate.slice(0,7) < monthKey || startDate.slice(0,7) > monthKey))) continue
      overlaps.push({venue,startDate,endDate,events:[...active]})
    }
  }
  return overlaps.sort((a,b) => a.startDate.localeCompare(b.startDate) || a.venue.localeCompare(b.venue,'zh-CN'))
}

export function assessmentOverview(events:readonly PlannedEvent[], assessments:Plans, year:number, month:number|null, today:string):AssessmentOverview {
  const stages:Record<AssessmentStage,PlannedEvent[]> = {'待研判':[], '处理中':[], '已完结':[]}
  const plans:EventAssessment[] = []
  const missingVenues:PlannedEvent[] = []
  const venues = new Map<string,DatedEvent[]>()
  for (const event of events) {
    if (event.year !== year) continue
    const stage = eventAssessmentStage(event,assessments)
    if (!stage) continue
    const names = registeredVenues(event)
    if (month === null || event.months.includes(month)) {
      stages[stage].push(event)
      const plan = activePlan(event,assessments)
      if (plan) plans.push(plan)
      if (!names.length && eventCalendarStatus(event,today) !== '已完结') missingVenues.push(event)
    }
    if (!event.startDate || !event.endDate || event.datePrecision !== 'day') continue
    if (event.reportedStatus === '已办结' && event.endDate >= today) continue
    for (const name of names) {
      const group = venues.get(name) ?? []
      group.push({...event,startDate:event.startDate,endDate:event.endDate})
      venues.set(name,group)
    }
  }
  const monthKey = month === null ? '' : year+'-'+String(month).padStart(2,'0')
  return {
    stageRows:(Object.keys(stages) as AssessmentStage[]).map(stage => ({stage,count:stages[stage].length,events:stages[stage]})),
    topics:topicProgress(plans), missingVenues, overlaps:sharedDates(venues,monthKey,today),
  }
}
