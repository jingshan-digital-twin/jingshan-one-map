export const platformSections = [
  { id:'overview', label:'资源目录', group:'平台门户', icon:'catalog' },
  { id:'local', label:'空间数据管理', group:'资源管理', icon:'local' },
  { id:'forms', label:'业务表单', group:'资源管理', icon:'forms' },
  { id:'services', label:'服务资源管理', group:'资源管理', icon:'services' },
  { id:'preview', label:'地图与属性表', group:'资源管理', icon:'preview' },
  { id:'bindings', label:'一张图图层绑定', group:'场景应用', icon:'bindings' },
  { id:'settings', label:'分析参数', group:'场景应用', icon:'settings' },
  { id:'results', label:'成果台账', group:'场景应用', icon:'results' },
  { id:'opening', label:'场地开放交办', group:'场景应用', icon:'opening' },
  { id:'events', label:'赛事引流', group:'场景应用', icon:'star' },
  { id:'versions', label:'版本与备份', group:'平台治理', icon:'versions' },
  { id:'reviews', label:'发布审批', group:'平台治理', icon:'reviews' },
  { id:'activity', label:'运行与审计', group:'平台治理', icon:'activity' },
  { id:'accounts', label:'用户与权限', group:'平台治理', icon:'accounts' },
  { id:'api', label:'接口中心', group:'平台治理', icon:'api' },
] as const
export type PlatformSection = (typeof platformSections)[number]['id']
export type ActivityRow = {
  id: string
  recordedAt: string
  area: string
  action: string
  resource: string
  detail: string
}
export function platformRoute() {
  const [section, key] = location.hash.slice(1).split('/')
  const tab = platformSections.find((item) => item.id === section)?.id ?? 'overview'
  try {
    return { tab, key: key ? decodeURIComponent(key) : '' }
  } catch {
    return { tab, key: '' }
  }
}
export function platformLink(tab: PlatformSection, key = '') {
  return '#' + tab + (key ? '/' + encodeURIComponent(key) : '')
}
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
export function platformTime(date: string) {
  return dateFormat.format(new Date(date))
}
