import { getRuntimeConfig, isImageName, isProtectedPath, normalizeRepoPath, publicUrlForPath } from '../_lib/config.js'
import { getContent, githubErrorMessage } from '../_lib/github.js'
import { errorJson, json, requestPolicyResponse } from '../_lib/http.js'

export async function onRequestGet(context) {
  const denied = requestPolicyResponse(context.request, context.env)
  if (denied) return denied
  const config = getRuntimeConfig(context.env)
  let path
  try {
    path = normalizeRepoPath(new URL(context.request.url).searchParams.get('path') || '')
  } catch (error) {
    return errorJson(400, error.message)
  }

  try {
    const result = await getContent(context.env, config, path)
    if (!result.ok) return errorJson(result.status === 404 ? 404 : 502, githubErrorMessage(result))
    if (!Array.isArray(result.data)) return errorJson(400, '该路径不是目录')

    const items = result.data
      .filter(item => item.type === 'dir' || (item.type === 'file' && isImageName(item.name)))
      .map(item => item.type === 'dir'
        ? { type: 'dir', name: item.name, path: item.path }
        : {
            type: 'image',
            name: item.name,
            path: item.path,
            sha: item.sha,
            size: item.size || 0,
            publicUrl: publicUrlForPath(item.path, config),
            protected: isProtectedPath(item.path, config)
          })
      .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, 'zh-CN') : a.type === 'dir' ? -1 : 1)

    return json({ ok: true, path, items, limited: result.data.length >= 1000 })
  } catch (error) {
    return errorJson(500, error.message)
  }
}
