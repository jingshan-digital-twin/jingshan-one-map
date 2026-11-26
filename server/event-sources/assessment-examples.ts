import { buildEventAssessment } from '../../src/jingshan/event-assessment.ts'
import { prepareEstimatedInputs } from '../../src/jingshan/event-estimates.ts'
import type { EventCatalog, EventDepartmentFeedback, EventWorkflowRecord, PlannedEvent } from '../../src/jingshan/event-plan-types.ts'
import type { CityFeature, Coordinate, Dataset } from '../../src/jingshan/types.ts'

type Example = NonNullable<EventCatalog['examples']>[number]
const examples = [
  { sourceId: 'plan-2026-50', day: '2026-11-21', position: [113.126, 31.025] as Coordinate, closed: false },
  { sourceId: 'plan-2026-51', day: '2026-11-20', position: null, closed: true },
] as const

const feedbackExamples: Record<string, string> = {
  公安交警:'建议将进出路线和停车引导标识列入赛前检查。',
  属地街镇:'将入口秩序与人流疏导纳入值守清单。',
  市场监管局:'已核对供餐单位检查清单。',
  气象局:'已记录赛期天气预警联络要求。',
  卫健局:'已核对医疗与转运交接事项。',
  文旅局:'建议赛前复核接待单位可用房量。',
  团市委:'将观众问询和无障碍服务列入岗位安排。',
  应急管理局:'已记录现场通信设备检查要求。',
}

// These geometries illustrate a saved plan. They are independent of the current published map.
function exerciseResources(event: PlannedEvent, center: Coordinate) {
  const at = (x: number, y: number): Coordinate => [center[0] + x, center[1] + y]
  function dataset(kind: string, name: string, position: Coordinate, fields: Record<string, unknown> = {}): Dataset {
    return { id: kind, name, category: '研判示例', department: '赛事组委会', description: '模拟保障资源',
      features: [{ type: 'Feature', id: event.id + ':' + kind, geometry: { type: 'Point', coordinates: position },
        properties: { name, kind, region: '京山市', sample: true, ...fields } }] }
  }
  const venue = event.venueNames[0].replace('国际网球赛事中心', '国际网球中心')
  const datasets = [
    dataset('venues', venue, center),
    dataset('parking', '赛事停车场 P1（示意）', at(-0.0028, 0.0019), { spaces: 128 }),
    dataset('hotels', '运动员接待酒店（示意）', at(0.0029, 0.0020), { beds: 160 }),
    dataset('medical', '赛事医疗点（示意）', at(0.0033, -0.0004)),
  ]
  const road: CityFeature = { type: 'Feature', id: event.id + ':perimeter',
    geometry: { type: 'LineString', coordinates: [
      at(-0.0028, 0.0019), at(0.0011, 0.0024), at(0.0033, -0.0004),
      at(0.0006, -0.0026), at(-0.0030, -0.0013), at(-0.0028, 0.0019),
    ] },
    properties: { name: '场馆周边保障路线（示意）', kind: 'road', region: '京山市', sample: true } }
  return { datasets, roads: [road] }
}

export function createAssessmentExamples(catalog: PlannedEvent[]): Example[] {
  return examples.flatMap(spec => {
    const source = catalog.find(event => event.id === spec.sourceId && event.assessment)
    if (!source) return []
    const event = structuredClone(source)
    event.notes.push(spec.closed?'只读研判演练。赛事计划取自原表，保障点位、部门意见及办理时间为演练数据。':'赛事计划取自原表，保障点位及道路方案为模拟建议。')
    const inputs = prepareEstimatedInputs(event)
    inputs.note = '模拟保障资源。' + inputs.note
    const time = (clock: string) => new Date(spec.day + 'T' + clock + ':00+08:00').toISOString()
    const { datasets, roads } = spec.position && event.venueNames.length ? exerciseResources(event, spec.position) : { datasets: [], roads: [] }
    const plan = buildEventAssessment(event, inputs, datasets, roads, 1, time('09:00'),true)
    plan.planVersion = 1
    if (!spec.closed) {
      plan.locationNote = '模拟场馆与周边保障资源'
      plan.revision = 1
      return [{event,plan}]
    }
    plan.status = 'completed'
    plan.submittedAt = time('10:00')
    plan.departments = [...new Set(plan.topics.map(topic => topic.department))]
    // Negative IDs cannot refer to a real department task in jingshan_results.
    plan.taskIds = plan.departments.map((_, index) => -(100 + index))
    const timeline: EventWorkflowRecord[] = [
      { action: 'generated', at: plan.generatedAt, detail: '生成研判方案 V1' },
      { action: 'submitted', at: plan.submittedAt, detail: `系统按专项分工向 ${plan.departments.length} 个责任部门分派任务` },
    ]
    plan.feedback = plan.departments.map((department, index): EventDepartmentFeedback => {
      const base = { department, taskId: plan.taskIds[index] }
      const at = time('14:' + String(index * 5).padStart(2, '0'))
      const comment = feedbackExamples[department]
      const disposition = index === 0 ? 'adopted' : 'noted'
      timeline.push({ action: 'feedback', at, detail: department + '反馈已登记，' + (disposition === 'adopted' ? '意见已采纳' : '已阅归档') })
      return { ...base, status: 'completed', feedbackAt: at, disposition, comment }
    })
    plan.completedAt = time('16:30')
    timeline.push({ action: 'completed', at: plan.completedAt, detail: '平台确认完结，专项方案与会签记录已归档' })
    plan.timeline = timeline
    plan.revision = timeline.length
    return [{ event, plan }]
  })
}
