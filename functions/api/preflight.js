import { getRuntimeConfig, isProtectedPath, normalizeRepoPath } from '../_lib/config.js'
import { branchSnapshot, getBranch, getTree, githubErrorMessage } from '../_lib/github.js'
import { errorJson, json, requestPolicyResponse } from '../_lib/http.js'

export async function onRequestPost(context) {
  const denied = requestPolicyResponse(context.request, context.env)
  if (denied) return denied
  const config = getRuntimeConfig(context.env)

  try {
    const body = await context.request.json()
    const overwrite = Boolean(body.overwrite)
    const rawPaths = Array.isArray(body.paths) ? body.paths : []
    if (!rawPaths.length) return errorJson(400, '没有待上传文件')
    if (rawPaths.length > 100) return errorJson(400, '单次最多处理 100 个文件')
    if (overwrite && !config.allowOverwrite) return errorJson(403, '服务器已禁用覆盖功能')

    const paths = rawPaths.map(normalizeRepoPath)
    if (paths.some(path => !path)) return errorJson(400, '存在空文件路径')
    if (new Set(paths).size !== paths.length) return errorJson(409, '上传队列中存在重复的目标文件名')

    const protectedPath = paths.find(path => isProtectedPath(path, config))
    if (protectedPath) return errorJson(403, `受保护路径禁止写入：${protectedPath}`)

    const branch = await getBranch(context.env, config)
    if (!branch.ok) return errorJson(502, githubErrorMessage(branch))
    const snapshot = branchSnapshot(branch)

    const treeResult = await getTree(context.env, config, snapshot.treeSha, true)
    if (!treeResult.ok) return errorJson(502, githubErrorMessage(treeResult))
    if (treeResult.data?.truncated) return errorJson(409, '仓库文件树过大，无法安全执行批量冲突检查')

    const entries = new Map((treeResult.data?.tree || []).map(entry => [entry.path, entry]))
    const conflicts = []
    const existingPaths = []

    for (const path of paths) {
      const entry = entries.get(path)
      if (!entry) continue
      if (entry.type === 'tree') {
        conflicts.push({ path, reason: '目标路径已被目录占用' })
        continue
      }
      existingPaths.push(path)
      if (!overwrite) conflicts.push({ path, reason: '同名文件已经存在' })
    }

    if (conflicts.length) {
      return errorJson(409, '上传前检查发现冲突', { conflicts })
    }

    return json({
      ok: true,
      baseCommitSha: snapshot.commitSha,
      baseTreeSha: snapshot.treeSha,
      existingPaths
    })
  } catch (error) {
    return errorJson(400, error.message)
  }
}
