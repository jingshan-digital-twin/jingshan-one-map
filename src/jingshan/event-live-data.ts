import { locateEventVenue } from './event-assessment.ts'
import type { PlannedEvent } from './event-plan-types.ts'
import type { Coordinate, Dataset } from './types.ts'
import { createDemoRoads, venueOffset } from './event-live-roads.ts'
import type {
  LiveAction, LiveAlert, LiveEventMonitor, LiveIncident, LiveIncidentStatus, LiveMonitorPoint,
} from './event-live-types.ts'

// Only these catalog events have a prepared exercise. Their real schedule is never overwritten.
const exercises = [
  { id: 'plan-2026-34', fallback: [113.123, 31.032] as Coordinate, onsite: 3286, capacity: 4000, hotelRooms: 2318, staff: 428, day: 2 },
  { id: 'plan-2026-41', fallback: [113.126, 31.025] as Coordinate, onsite: 1240, capacity: 1800, hotelRooms: 670, staff: 185, day: 3 },
  { id: 'plan-2026-42', fallback: [113.112, 31.018] as Coordinate, onsite: 1876, capacity: 2600, hotelRooms: 924, staff: 208, day: 1 },
]

export function createLiveEvents(events: PlannedEvent[], datasets: Dataset[], now = new Date()): LiveEventMonitor[] {
  return exercises.flatMap((exercise, index) => {
    const event = events.find(candidate => candidate.id === exercise.id)
    if (!event) return []
    const venueName = event.venueNames[0] ?? '赛事场馆'
    const location = locateEventVenue(venueName, datasets)
    const position = location.position ?? exercise.fallback
    const id = (suffix: string) => event.id + '-' + suffix
    const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60000).toISOString()
    const snapshotAt = at(0)
    const seats = [400, 500, 180].map(count => Math.round(count * (1 - index * 0.15)))
    const occupancy = [0.59 + index * 0.02, 0.92 + index * 0.01, 0]
    const vehicles = seats.reduce((sum, count, lot) => sum + Math.round(count * occupancy[lot]), 0)
    const points: LiveMonitorPoint[] = []
    function addPoint(suffix: string, name: string, kind: LiveMonitorPoint['kind'], east: number, north: number,
      status: LiveMonitorPoint['status'], metrics: LiveMonitorPoint['metrics'], extra: Partial<Pick<LiveMonitorPoint, 'contact' | 'camera'>> = {}) {
      points.push({ id: id(suffix), eventId: event!.id, name, kind, position: venueOffset(position, east, north),
        status, metrics, updatedAt: snapshotAt, demo: true, ...extra })
    }
    addPoint('venue', venueName, 'venue', 0, 0, 'normal', [
      { label: '现场人数', value: exercise.onsite, unit: '人' }, { label: '容纳人数', value: exercise.capacity, unit: '人' },
      { label: '场馆定位', value: location.position ? location.note : '演练示意坐标' },
    ])
    const parkingOffsets = [[245, 173], [-320, 225], [345, -210]]
    seats.forEach((capacity, lot) => {
      const used = Math.round(capacity * occupancy[lot])
      const percent = Math.round(used * 100 / capacity)
      addPoint('parking-p' + (lot + 1), ['P1 停车场', 'P2 停车场', 'P3 临时停车场'][lot], 'parking',
        parkingOffsets[lot][0], parkingOffsets[lot][1], lot === 2 ? 'standby' : lot === 1 ? 'warning' : 'normal', [
          { label: '总车位', value: capacity, unit: '个' }, { label: '已占用', value: used, unit: '个' },
          { label: '空余车位', value: capacity - used, unit: '个' }, { label: '占用率', value: percent, unit: '%', percent },
        ])
    })
    addPoint('police-f03', '交警岗 F03', 'police', -108, 309, 'busy',
      [{ label: '在岗人员', value: 4, unit: '人' }, { label: '任务', value: '停车分流' }],
      { contact: { name: '交通一组值班员（模拟）', phone: '演练分机 6301', department: '公安交警' } })
    addPoint('police-f04', '交警岗 F04', 'police', 389, 48, 'normal',
      [{ label: '在岗人员', value: 3, unit: '人' }, { label: '任务', value: '接驳引导' }],
      { contact: { name: '交通二组值班员（模拟）', phone: '演练分机 6302', department: '公安交警' } })
    addPoint('medical-m1', '医疗点 M1', 'medical', 172, 52, 'normal',
      [{ label: '值守医护', value: 5, unit: '人' }, { label: '应急设备', value: '已就绪' }])
    addPoint('medical-m2', '医疗点 M2', 'medical', -130, -200, 'normal',
      [{ label: '值守医护', value: 4, unit: '人' }, { label: '保障车辆', value: 1, unit: '辆' }])
    addPoint('entrance', '西侧观众入口', 'entrance', -354, 0, 'warning',
      [{ label: '入场速率', value: 88 - index * 7, unit: '人/分钟' }, { label: '开放通道', value: 4, unit: '条' }])
    addPoint('shuttle', '接驳车 08 号站', 'shuttle', 275, -62, 'busy',
      [{ label: '待发车辆', value: 3, unit: '辆' }, { label: '平均候车', value: 6, unit: '分钟' }])
    addPoint('supplies', '应急物资点', 'supplies', -80, -319, 'normal',
      [{ label: '保障人员', value: 6, unit: '人' }, { label: '物资状态', value: '已备齐' }])
    const cameras = [
      { view: 'entrance', name: '西入口监控', east: -278, north: -111 },
      { view: 'parking', name: '停车场监控', east: -217, north: 203 },
      { view: 'court', name: '中心场监控', east: 41, north: 180 },
    ] as const
    cameras.forEach((camera, channel) => {
      const online = channel !== 2
      const code = 'CAM-' + event.sequence + '-0' + (channel + 1)
      addPoint('camera-' + camera.view, camera.name, 'camera', camera.east, camera.north, online ? 'normal' : 'offline',
        [{ label: '信号状态', value: online ? '正常' : '离线' }],
        { camera: { code, view: camera.view, online, source: 'simulation' } })
    })

    const routes = createDemoRoads(event.id, position)
    const incidents: LiveIncident[] = []
    function incident(suffix: string, title: string, type: string, level: LiveIncident['level'], point: string,
      department: string, collaborators: string[], resources: string[], historySteps: [LiveAction['action'], string, number, string][], status: LiveIncidentStatus) {
      const history = historySteps.map(([action, label, age, note], i) => ({ id: id(suffix + '-log-' + i), action, label, at: at(age), note }))
      incidents.push({ id: id(suffix), eventId: event!.id, title, type, level, pointId: id(point), department, collaborators,
        deadline: '接警后 30 分钟内', status, createdAt: history[0].at, updatedAt: history.at(-1)!.at, history, resourceIds: resources.map(id) })
    }
    incident('incident-parking', '启用 P3 临时停车场', '交通保障', 'medium', 'parking-p2', '交通运输局', ['公安交警'],
      ['parking-p3', 'police-f03', 'camera-parking'], [['alert', '系统预警', 11, 'P2 车位占用超过演练阈值。']], 'pending')
    incident('incident-entrance', '增开西侧入场通道', '客流保障', 'high', 'entrance', '赛事组委会', ['公安交警', '卫健局'],
      ['camera-entrance', 'medical-m2'], [['alert', '系统预警', 20, '入口客流短时增加。'], ['dispatch', '一键派单', 16, '增派入口引导人员。'],
        ['receive', '部门签收', 12, '现场协调组已签收。']], 'received')
    incident('incident-weather', '检查雨具与防滑物资', '气象保障', 'info', 'supplies', '应急管理局', ['赛事组委会'],
      ['supplies', 'shuttle'], [['alert', '系统预警', 8, '演练场景设有短时降水。'], ['dispatch', '一键派单', 5, '核验入口防滑垫及雨具库存。']], 'dispatched')
    incident('incident-shuttle', '补充接驳班次', '接驳保障', 'info', 'shuttle', '交通运输局', ['赛事组委会'],
      ['shuttle', 'police-f04'], [['alert', '系统预警', 59, '候车区出现排队。'], ['dispatch', '一键派单', 55, '安排备用车辆。'],
        ['receive', '部门签收', 52, '车队签收。'], ['onsite', '到场处置', 45, '车辆已到指定站点。'], ['resolve', '确认办结', 32, '候车区恢复有序。']], 'resolved')
    const alerts: LiveAlert[] = [
      { id: id('alert-parking'), title: 'P2 停车场接近饱和', level: 'medium', pointId: id('parking-p2'), detail: '占用率 ' + Math.round(occupancy[1] * 100) + '%，建议启用 P3 并增加接驳。', type: 'parking', createdAt: at(11), incidentId: id('incident-parking') },
      { id: id('alert-entry'), title: '西侧入口客流聚集', level: 'high', pointId: id('entrance'), detail: '入口客流较集中，建议增开两条通道。', type: 'crowd', createdAt: at(20), incidentId: id('incident-entrance') },
      { id: id('alert-weather'), title: '气象短临提醒', level: 'info', pointId: id('supplies'), detail: '模拟短时降雨，需核验入口防滑物资。', type: 'weather', createdAt: at(8), incidentId: id('incident-weather') },
    ]
    return [{ id: event.id, planId:event.id, name: event.name, venueName, position, day: exercise.day, status: 'ongoing', demo: true,
      startTime: '08:30', nextPeak: ['16:30', '14:00', '15:15'][index], snapshotAt, revision: 1,
      metrics: { onsite: exercise.onsite, capacity: exercise.capacity, vehicles, hotelRooms: exercise.hotelRooms, medicalPoints: 2, staff: exercise.staff },
      traffic: { smooth: 78 - index, slow: 18 + index, congested: 4 }, points, routes, alerts, incidents, publicNotices: [] }]
  })
}
