import { getRuntimeConfig, isProtectedPath, joinRepoPath, publicUrlForPath } from '../_lib/config.js'
import { arrayBufferToBase64, getContent, githubErrorMessage, putContent } from '../_lib/github.js'
import { errorJson, json, requestPolicyResponse } from '../_lib/http.js'

export async function onRequestPost(context) {
  const denied = requestPolicyResponse(context.request, context.env)
  if (denied) return denied
  const config = getRuntimeConfig(context.env)

  try {
    const form = await context.request.formData()
    const file = form.get('file')
    const dir = form.get('dir') || ''
    const filename = form.get('filename') || file?.name || ''
    const overwrite = String(form.get('overwrite') || 'false').toLowerCase() === 'true'

    if (!file || typeof file.arrayBuffer !== 'function') return errorJson(400, '没有收到图片文件')
    if (!String(file.type || '').startsWith('image/')) return errorJson(415, '仅允许上传图片文件')
    if (file.size <= 0) return errorJson(400, '图片为空')
    if (file.size > config.maxUploadBytes) return errorJson(413, `图片超过 ${config.maxUploadMB} MB 上传限制`)

    const path = joinRepoPath(dir, filename)
    if (isProtectedPath(path, config)) return errorJson(403, `受保护路径禁止写入：${path}`)
    if (overwrite && !config.allowOverwrite) return errorJson(403, '服务器已禁用覆盖功能')

    const existing = await getContent(context.env, config, path)
    let existingSha = null
    if (existing.ok) {
      if (existing.data?.type !== 'file') return errorJson(409, '目标路径已被目录占用')
      existingSha = existing.data.sha
      if (!overwrite) return errorJson(409, '同名文件已经存在', { path })
    } else if (existing.status !== 404) {
      return errorJson(502, githubErrorMessage(existing))
    }

    const content = arrayBufferToBase64(await file.arrayBuffer())
    const result = await putContent(context.env, config, path, content, existingSha)
    if (!result.ok) return errorJson(result.status === 422 ? 409 : 502, githubErrorMessage(result))

    return json({
      ok: true,
      path,
      name: path.split('/').pop(),
      sha: result.data?.content?.sha || null,
      commit: result.data?.commit?.sha || null,
      overwritten: Boolean(existingSha),
      publicUrl: publicUrlForPath(path, config)
    }, { status: existingSha ? 200 : 201 })
  } catch (error) {
    return errorJson(400, error.message)
  }
}
