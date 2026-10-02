import { getRuntimeConfig, isProtectedPath, normalizeFilename, normalizeRepoPath, publicUrlForPath } from '../_lib/config.js'
import { branchSnapshot, createGitCommit, createTree, getBranch, getContent, githubErrorMessage, updateBranchRef } from '../_lib/github.js'
import { errorJson, json, requestPolicyResponse } from '../_lib/http.js'

export async function onRequestPost(context) {
  const denied = requestPolicyResponse(context.request, context.env)
  if (denied) return denied
  const config = getRuntimeConfig(context.env)
  if (!config.allowRename) return errorJson(403, '服务器已禁用重命名功能')

  try {
    const body = await context.request.json()
    const oldPath = normalizeRepoPath(body.path || '')
    const rawName = String(body.newName || '').trim()
    if (!oldPath) return errorJson(400, '缺少原文件路径')
    if (!rawName) return errorJson(400, '新文件名不能为空')
    if (/[\\/]/.test(rawName)) return errorJson(400, '重命名只能修改文件名，不能移动目录')
    if (body.confirm !== oldPath) return errorJson(400, '重命名确认值不匹配')
    if (isProtectedPath(oldPath, config)) return errorJson(403, `受保护路径禁止重命名：${oldPath}`)

    const newName = normalizeFilename(rawName)
    const slash = oldPath.lastIndexOf('/')
    const dir = slash >= 0 ? oldPath.slice(0, slash) : ''
    const newPath = dir ? `${dir}/${newName}` : newName
    if (newPath === oldPath) return errorJson(400, '新文件名与当前文件名相同')
    if (isProtectedPath(newPath, config)) return errorJson(403, `受保护路径禁止写入：${newPath}`)

    const branch = await getBranch(context.env, config)
    if (!branch.ok) return errorJson(502, githubErrorMessage(branch))
    const snapshot = branchSnapshot(branch)

    const [existing, target] = await Promise.all([
      getContent(context.env, config, oldPath),
      getContent(context.env, config, newPath)
    ])

    if (!existing.ok) return errorJson(existing.status === 404 ? 404 : 502, githubErrorMessage(existing))
    if (existing.data?.type !== 'file') return errorJson(400, '当前路径不是普通文件')
    if (target.ok) return errorJson(409, '新文件名已经存在')
    if (target.status !== 404) return errorJson(502, githubErrorMessage(target))

    const treeResult = await createTree(context.env, config, snapshot.treeSha, [
      { path: newPath, mode: '100644', type: 'blob', sha: existing.data.sha },
      { path: oldPath, mode: '100644', type: 'blob', sha: null }
    ])
    if (!treeResult.ok) return errorJson(502, githubErrorMessage(treeResult))

    const commitResult = await createGitCommit(
      context.env,
      config,
      `cdn: rename ${oldPath} to ${newPath}`,
      treeResult.data.sha,
      snapshot.commitSha
    )
    if (!commitResult.ok) return errorJson(502, githubErrorMessage(commitResult))

    const refResult = await updateBranchRef(context.env, config, commitResult.data.sha)
    if (!refResult.ok) return errorJson(refResult.status === 422 ? 409 : 502, githubErrorMessage(refResult))

    return json({
      ok: true,
      oldPath,
      newPath,
      commit: commitResult.data.sha,
      oldPublicUrl: publicUrlForPath(oldPath, config),
      publicUrl: publicUrlForPath(newPath, config)
    })
  } catch (error) {
    return errorJson(400, error.message)
  }
}
