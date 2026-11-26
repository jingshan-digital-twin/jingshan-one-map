export const roleTitles = {
  admin: '平台管理员',
  editor: '数据维护员',
  reviewer: '发布审批员',
  viewer: '驾驶舱访客',
} as const
export type PlatformRole = keyof typeof roleTitles
export const roleCapabilities = {
  admin: ['browse', 'workspace', 'edit', 'services', 'review', 'accounts'],
  editor: ['browse', 'workspace', 'edit', 'services'],
  reviewer: ['browse', 'workspace', 'review'],
  viewer: ['browse'],
} as const
export const capabilityTitles = {
  browse: '查看驾驶舱',
  workspace: '读取工作区',
  edit: '编辑草稿',
  services: '管理服务',
  review: '审批与发布',
  accounts: '管理账号',
}
export type Capability = keyof typeof capabilityTitles
export function allowed(role: PlatformRole, action: Capability) {
  return (roleCapabilities[role] as readonly string[]).includes(action)
}
export type PlatformSession = { name: string; role: PlatformRole; authenticated: boolean }
