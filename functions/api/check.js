import { getRuntimeConfig, normalizeRepoPath, publicUrlForPath } from '../_lib/config.js'
import { errorJson, json, requestPolicyResponse } from '../_lib/http.js'

export async function onRequestGet(context) {
  const denied = requestPolicyResponse(context.request, context.env)
  if (denied) return denied
  const config = getRuntimeConfig(context.env)
  try {
    const path = normalizeRepoPath(new URL(context.request.url).searchParams.get('path') || '')
    if (!path) return errorJson(400, '缺少 path')
    const publicUrl = publicUrlForPath(path, config)
    const probeUrl = `${publicUrl}${publicUrl.includes('?') ? '&' : '?'}__cdndash=${Date.now()}`
    let response = await fetch(probeUrl, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'Cache-Control': 'no-cache' },
      cf: { cacheTtl: 0, cacheEverything: false }
    })
    if (response.status === 405) {
      response = await fetch(probeUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: { Range: 'bytes=0-0', 'Cache-Control': 'no-cache' },
        cf: { cacheTtl: 0, cacheEverything: false }
      })
    }
    return json({ ok: response.ok, status: response.status, publicUrl })
  } catch (error) {
    return errorJson(502, error.message)
  }
}
