import { getRuntimeConfig } from './config.js'

export function json(data, init = {}) {
  const headers = new Headers(init.headers || {})
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify(data), { ...init, headers })
}

export function errorJson(status, error, details) {
  return json({ ok: false, error, ...(details ? { details } : {}) }, { status })
}

export function requestPolicyResponse(request, env) {
  const config = getRuntimeConfig(env)
  const url = new URL(request.url)

  if (config.allowedHosts.length && !config.allowedHosts.includes(url.hostname)) {
    return errorJson(403, '当前域名不在 ALLOWED_HOSTS 白名单中')
  }

  const origin = request.headers.get('Origin')
  if (origin) {
    try {
      if (new URL(origin).origin !== url.origin) {
        return errorJson(403, '拒绝跨站请求')
      }
    } catch {
      return errorJson(403, 'Origin 无效')
    }
  }

  return null
}
