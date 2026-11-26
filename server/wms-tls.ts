import https from 'node:https'
import { isIP } from 'node:net'
import tls from 'node:tls'
import { CimError } from './cim-error.ts'

const endpoint = process.env.CIM_WMS_TLS_ENDPOINT?.trim()
const fingerprint = process.env.CIM_WMS_TLS_SHA256?.trim().replaceAll(':', '').toLowerCase()
let agent: https.Agent | undefined

export function pinnedWmsAgent(url: URL) {
  if (url.protocol !== 'https:' || url.username || url.password || url.origin + url.pathname !== endpoint) return
  const service = url.searchParams.get('service')?.toUpperCase()
  const operation = url.searchParams.get('request')?.toLowerCase()
  if (service !== 'WMS' || (operation !== 'getmap' && operation !== 'getcapabilities')) return
  if (!fingerprint || !/^[0-9a-f]{64}$/.test(fingerprint)) throw new CimError('WMS 证书指纹配置无效。', 502, 'auth')
  if (agent) return agent

  agent = new https.Agent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 4 })
  // This service has an expired leaf. Verify the exact certificate on each new
  // connection before passing the socket to HTTP, so no request precedes verification.
  agent.createConnection = (_options, done) => {
    if (!done) throw new Error('WMS TLS requires an asynchronous connection')
    const socket = tls.connect({
      host: url.hostname, port: Number(url.port || 443),
      servername: isIP(url.hostname) ? undefined : url.hostname, rejectUnauthorized: false,
    })
    const timer = setTimeout(() => socket.destroy(new Error('WMS TLS handshake timed out')), 8000)
    const failed = (error: Error) => { clearTimeout(timer); done(error, socket) }
    socket.once('error', failed)
    socket.once('secureConnect', () => {
      clearTimeout(timer)
      if (socket.getPeerCertificate().fingerprint256?.replaceAll(':', '').toLowerCase() !== fingerprint) {
        socket.destroy(new CimError('WMS 服务证书指纹与本机授权不符。', 502, 'auth'))
        return
      }
      socket.off('error', failed)
      done(null, socket)
    })
    return undefined
  }
  return agent
}
