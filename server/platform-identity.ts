import { createHash, randomBytes, timingSafeEqual, scrypt } from 'node:crypto'
import { promisify } from 'node:util'
import type { RequestHandler } from 'express'
import type { Pool } from 'pg'
import {
  allowed,
  roleTitles,
  type Capability,
  type PlatformRole,
  type PlatformSession,
} from '../src/jingshan/platform-roles.ts'
const derive = promisify(scrypt)
export async function passwordDigest(password: string) {
  const salt = randomBytes(16).toString('hex')
  return salt + ':' + ((await derive(password, salt, 64)) as Buffer).toString('hex')
}
function capability(path: string, read: boolean): Capability {
  // This download only converts the raster snapshot already visible to its caller.
  if (path === '/api/jingshan/platform/population-attributes.xlsx' || path === '/api/jingshan/platform/spatial-export.zip') return 'browse'
  if (path.startsWith('/api/jingshan/platform/users')) return 'accounts'
  if (path.startsWith('/api/jingshan/platform/reviews') && !read)
    return path === '/api/jingshan/platform/reviews' ? 'edit' : 'review'
  if (read)
    return /^\/api\/jingshan\/(admin|cim\/admin|platform\/(reviews|operations))(\/|$)/.test(path)
      ? 'workspace'
      : 'browse'
  if (path === '/api/jingshan/admin/publish' || path === '/api/jingshan/admin/publish-layer') return 'review'
  if (path.startsWith('/api/jingshan/cim/admin/')) return 'services'
  if (
    path === '/api/jingshan/admin/draft' ||
    path === '/api/jingshan/admin/restore' ||
    path.startsWith('/api/jingshan/cim/sync/') ||
    path.startsWith('/api/jingshan/results') ||
    /^\/api\/jingshan\/event-(plans|live|reviews)(\/|$)/.test(path) ||
    path.startsWith('/api/jingshan/venue-opening')
  )
    return 'edit'
  return 'accounts'
}
export function platformIdentity(
  pool: Pool,
  protectedMode: boolean,
  adminName: string,
  adminPassword?: string,
): RequestHandler {
  if (protectedMode && (!adminPassword || adminPassword.length < 12 || !adminName || adminName.includes(':')))
    throw new Error('Set APP_USER and APP_PASSWORD (12 characters minimum).')
  const hash = (value: string) => createHash('sha256').update(value).digest()
  const adminHash = hash(adminName + ':' + adminPassword)
  return async (req, res, next) => {
    if (req.path === '/api/health' && req.method === 'GET') return next()
    let session: PlatformSession = { name: '本机工作区', role: 'admin', authenticated: false }
    if (protectedMode) {
      const encoded = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(req.headers.authorization ?? '')?.[1]
      let verified = false
      if (encoded && encoded.length < 2048) {
        const credentials = Buffer.from(encoded, 'base64').toString('utf8'),
          split = credentials.indexOf(':')
        const name = credentials.slice(0, split),
          password = credentials.slice(split + 1)
        if (timingSafeEqual(hash(credentials), adminHash)) {
          session = { name: adminName, role: 'admin', authenticated: true }
          verified = true
        } else if (split > 0 && name.length <= 80 && name !== adminName) {
          const row = (
            await pool.query('SELECT name,role,digest FROM jingshan_platform_users WHERE name=$1 AND enabled', [
              name,
            ])
          ).rows[0]
          if (row && Object.hasOwn(roleTitles, row.role) && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(row.digest)) {
            const [salt, digest] = String(row.digest).split(':')
            const actual = (await derive(password, salt, 64)) as Buffer
            if (timingSafeEqual(Buffer.from(digest, 'hex'), actual)) {
              session = { name: row.name, role: row.role as PlatformRole, authenticated: true }
              verified = true
            }
          }
        }
      }
      if (!verified) {
        res.set('WWW-Authenticate', 'Basic realm="Jingshan", charset="UTF-8"')
        res.status(401).send('Authentication required.')
        return
      }
      const path = req.path.replace(/\/+$/, '').toLowerCase()
      if (
        path.startsWith('/api/') &&
        (!allowed(session.role, capability(path, ['GET', 'HEAD', 'OPTIONS'].includes(req.method))) ||
          (path==='/api/jingshan/admin/publish-layer' && !allowed(session.role,'services')))
      ) {
        res.status(403).json({ error: '当前角色没有该操作权限' })
        return
      }
    }
    res.locals.platformSession = session
    next()
  }
}
