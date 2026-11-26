function configuredOrigin(key: string): string | undefined {
  const value = process.env[key]?.trim()
  if (!value) return undefined
  let url: URL
  try { url = new URL(value) } catch { throw new Error(key + ' must be an HTTP(S) origin.') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error(key + ' must contain only the protocol, host and optional port.')
  }
  return url.origin
}

export const workbookOrigin = configuredOrigin('CIM_SERVICE_ORIGIN')
export const pinnedCimOrigin = configuredOrigin('CIM_TLS_ORIGIN')
