export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/api/jingshan' + path, options)
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || '服务请求失败（' + response.status + '）')
  return body as T
}
export function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
export function downloadFile(name: string, content: string, type = 'application/json') {
  downloadBlob(new Blob([content], {type}),name)
}
export function downloadCsv(name:string, rows:readonly (readonly (string|number|null|undefined)[])[]) {
  const cell=(value:string|number|null|undefined) => {
    const text=typeof value==='string' ? value.replace(/^[=+@\-\t\r]/, char=>"'"+char) : String(value??'')
    return '"'+text.replaceAll('"','""')+'"'
  }
  downloadFile(name,'\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8')
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
