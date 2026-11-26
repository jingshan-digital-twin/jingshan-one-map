import type { Dataset } from './types.ts'
import type { GapSource } from './service-gaps.ts'
import type { SchedulePlan } from './opening-schedule.ts'

import type {OpeningProposal} from './opening-proposal.ts'

export const activeOpeningStages = ['assigned','received','review'] as const
export type ActiveOpeningStage = typeof activeOpeningStages[number]
export type OpeningStage = ActiveOpeningStage | 'closed' | 'withdrawn'
export type OpeningAction = 'assign' | 'receive' | 'feedback' | 'return' | 'close' | 'remind' | 'withdraw'
export type OpeningMode = 'live' | 'demo'
export type OpeningEvent = {
  action: OpeningAction; at: string; requestId: string; note: string
  outcome?: 'scheduled' | 'unavailable'; startsOn?: string; hours?: string
  source?: GapSource; proposal?:OpeningProposal
}
export type OpeningTask = {
  id: string; venueId: string; venueName: string; region: string; mode: OpeningMode; department: string
  due: string; stage: OpeningStage; history: OpeningEvent[]
}
export type OpeningTaskRow = Omit<OpeningTask,'history'> & {requirement:string; outcome?:OpeningEvent['outcome']; schedule?:(SchedulePlan&{cancelled:boolean})|null}
export type OpeningTaskLink = {taskId:string;venueId:string;venueName:string}
export type ActiveVenueTask = OpeningTaskLink & {stage:ActiveOpeningStage;department:string}
export type CreatedOpeningTask = Pick<OpeningTask,'id'|'venueId'|'venueName'|'department'>
export function openingTaskLink(task:Pick<OpeningTask,'id'|'venueId'|'venueName'>):OpeningTaskLink {
  return {taskId:task.id,venueId:task.venueId,venueName:task.venueName}
}
export function isOpeningActive(stage:OpeningStage):stage is ActiveOpeningStage{
  return activeOpeningStages.some(value=>value===stage)
}
export const openingListSize = 6
export const openingStageLabels: Record<OpeningStage,string> = {assigned:'待签收', received:'办理中', review:'待核验', closed:'已办结',withdrawn:'已撤回'}
export const openingStages: ReadonlyArray<{ id: OpeningStage; name: string }> = [
  { id: 'assigned', name: '交办' }, { id: 'received', name: '签收' },
  { id: 'review', name: '反馈方案' }, { id: 'closed', name: '核验办结' },
]
export const openingActions: Record<OpeningAction, string> = {
  assign: '已交办', receive: '承办单位签收', feedback: '已反馈方案', return: '退回补充', close: '核验办结', remind:'已登记督办提醒',withdraw:'撤回交办',
}
export class OpeningError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}

export function requiredText(value: unknown, field: string, max = 600) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.trim().length > max) {
    throw new OpeningError('请填写' + field + '，最多 ' + max + ' 字')
  }
  return value.trim()
}
export function openingDate(value: unknown, field: string) {
  const date = typeof value === 'string' ? value : ''
  const timestamp = Date.parse(date + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
    throw new OpeningError('请填写有效的' + field)
  }
  return date
}
export function openingUuid(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)) throw new OpeningError('任务请求编号无效')
  return value.toLowerCase()
}
export function openingVenue(datasets: Dataset[], id: string) {
  const venue = datasets.find(item => item.id === 'venues')?.features.find(item => item.id === id)
  if (venue) return {name:venue.properties.name, region:venue.properties.region}
  const court = datasets.find(item => item.id === 'courts')?.features.find(item => {
    const facility = item.properties.facilityId
    return (typeof facility === 'string' && facility.trim() ? facility : item.id) === id
  })
  if (!court) throw new OpeningError('当前发布数据中没有该场馆，请刷新场馆台账', 409)
  const name = typeof court.properties.facilityName === 'string' && court.properties.facilityName.trim() ? court.properties.facilityName : court.properties.name
  return {name, region:court.properties.region}
}
export function openingTransition(task: OpeningTask, input: Record<string, unknown>, at: string) {
  const action = input.action
  if (action !== 'withdraw' && action !== 'remind' && action !== 'receive' && action !== 'feedback' && action !== 'return' && action !== 'close') throw new OpeningError('办理操作无效')
  const event: OpeningEvent = { action, at, requestId: openingUuid(input.requestId), note: '' }
  if (action === 'feedback') {
    if (input.outcome !== 'scheduled' && input.outcome !== 'unavailable') throw new OpeningError('请选择协调结果')
    event.outcome = input.outcome
    event.note = requiredText(input.note, input.outcome === 'scheduled' ? '开放场地及安排' : '暂不能开放的原因')
    if (input.outcome === 'scheduled') {
      event.startsOn = openingDate(input.startsOn, '拟开放日期')
      event.hours = requiredText(input.hours, '拟开放时段', 120)
    }
  } else if (action==='remind') event.note=requiredText(input.note,'督办说明')
  else if (action === 'return' || action === 'close') event.note = requiredText(input.note, action === 'return' ? '退回原因' : '核验意见')
  const previous = task.history.find(item => item.requestId === event.requestId)
  if (previous) {
    if (Object.entries({...event, at: previous.at}).some(([key,value]) => previous[key as keyof OpeningEvent] !== value)) {
      throw new OpeningError('同一请求已用于其他办理内容', 409)
    }
    return task
  }
  if(action==='remind'){
    if(task.stage==='closed')throw new OpeningError('已办结工单不能催办',409)
    if(task.stage==='withdrawn')throw new OpeningError('工单已撤回',409)
    const day=(stamp:string)=>new Date(Date.parse(stamp)+8*3600000).toISOString().slice(0,10)
    const lastStep=task.history.findLastIndex(e=>e.action!=='remind')
    if(task.history.slice(lastStep+1).some(e=>e.note===event.note&&day(e.at)===day(event.at)))return task
    if(task.history.length!==input.revision)throw new OpeningError('任务进度已更新，请核对后再督办',409)
    return {...task,history:[...task.history,event]}
  }
  if(action==='withdraw'){
    if(!isOpeningActive(task.stage) || task.history.length!==input.revision)throw new OpeningError('工单状态已更新，请核对后再撤回',409)
    return {...task,stage:'withdrawn' as const,history:[...task.history,event]}
  }
  const allowed: Record<typeof action, [OpeningStage, OpeningStage]> = {
    receive: ['assigned', 'received'], feedback: ['received', 'review'], return: ['review', 'received'], close: ['review', 'closed'],
  }
  const [from, to] = allowed[action]
  if (task.stage !== from || task.history.length !== input.revision) throw new OpeningError('任务进度已更新，请核对后再办理', 409)
  return { ...task, stage: to, history: [...task.history, event] }
}
