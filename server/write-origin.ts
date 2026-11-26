import { hostname, networkInterfaces } from 'node:os'

export function allowsDevWriteOrigin(origin: string, host: string | undefined, lanIp: string | undefined): boolean {
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return true
  if (!host || !lanIp || origin !== 'http://' + host) return false
  const name = host.split(':', 1)[0].toLowerCase()
  if (lanIp !== 'auto') return name === lanIp
  const machine = hostname().toLowerCase()
  return name === machine || name === machine + '.local' ||
    Object.values(networkInterfaces()).some(entries =>
      entries?.some(entry => entry.family === 'IPv4' && !entry.internal && entry.address === name))
}
