import { getRuntimeConfig, isImageName, isProtectedPath, normalizeRepoPath, publicUrlForPath } from '../_lib/config.js'
import { arrayBufferToBase64, branchSnapshot, createBlob, getBranch, githubErrorMessage } from '../_lib/github.js'
import { errorJson, json, requestPolicyResponse } from '../_lib/http.js'

export async function onRequestPost(context) {
  const denied = requestPolicyResponse(context.request, context.env)
  if (denied) return denied
  const config = getRuntimeConfig(context.env)

  try {
    const form = await context.request.formData()
    const file = form.get('file')
    const path = normalizeRepoPath(form.get('path') || '')
    const expectedHeadSha = String(form.get('expectedHeadSha') || '')

    if (!file || typeof file.arrayBuffer !== 'function') return errorJson(400, '没有收到文件')
    if (!path) return errorJson(400, '缺少目标文件路径')
    if (!expectedHeadSha) return errorJson(400, '缺少批次分支快照')
    if (isProtectedPath(path, config)) return errorJson(403, `受保护路径禁止写入：${path}`)
    if (file.size <= 0) return errorJson(400, '文件为空')
    if (file.size > config.maxUploadBytes) return errorJson(413, `${file.name || path} 超过 ${config.maxUploadMB} MB 限制`)

    const branch = await getBranch(context.env, config)
    if (!branch.ok) return errorJson(502, githubErrorMessage(branch))
    const snapshot = branchSnapshot(branch)
    if (snapshot.commitSha !== expectedHeadSha) {
      return errorJson(409, '上传期间仓库分支发生变化，请重新开始本批次上传')
    }

    const content = arrayBufferToBase64(await file.arrayBuffer())
    const result = await createBlob(context.env, config, content)
    if (!result.ok) return errorJson(502, githubErrorMessage(result))

    return json({
      ok: true,
      path,
      name: path.split('/').pop(),
      blobSha: result.data?.sha,
      size: file.size,
      isImage: isImageName(path),
      publicUrl: publicUrlForPath(path, config)
    }, { status: 201 })
  } catch (error) {
    return errorJson(400, error.message)
  }
}
