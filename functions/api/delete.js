import { getRuntimeConfig, isProtectedPath, normalizeRepoPath } from '../_lib/config.js'
import { getContent, githubErrorMessage, removeContent } from '../_lib/github.js'
import { errorJson, json, requestPolicyResponse } from '../_lib/http.js'

export async function onRequestPost(context) {
  const denied = requestPolicyResponse(context.request, context.env)
  if (denied) return denied
  const config = getRuntimeConfig(context.env)
  if (!config.allowDelete) return errorJson(403, '服务器已禁用删除功能')

  try {
    const body = await context.request.json()
    const path = normalizeRepoPath(body.path || '')
    if (!path) return errorJson(400, '缺少文件路径')
    if (body.confirm !== path) return errorJson(400, '删除确认值不匹配')
    if (isProtectedPath(path, config)) return errorJson(403, `受保护路径禁止删除：${path}`)

    let sha = body.sha
    if (!sha) {
      const existing = await getContent(context.env, config, path)
      if (!existing.ok) return errorJson(existing.status === 404 ? 404 : 502, githubErrorMessage(existing))
      sha = existing.data?.sha
    }
    if (!sha) return errorJson(400, '无法确定文件 SHA')

    const result = await removeContent(context.env, config, path, sha)
    if (!result.ok) return errorJson(result.status === 404 ? 404 : 502, githubErrorMessage(result))
    return json({ ok: true, path, commit: result.data?.commit?.sha || null })
  } catch (error) {
    return errorJson(400, error.message)
  }
}
