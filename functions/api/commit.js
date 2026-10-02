import { getRuntimeConfig, isProtectedPath, normalizeRepoPath, publicUrlForPath } from '../_lib/config.js'
import { branchSnapshot, createGitCommit, createTree, getBranch, githubErrorMessage, updateBranchRef } from '../_lib/github.js'
import { errorJson, json, requestPolicyResponse } from '../_lib/http.js'

export async function onRequestPost(context) {
  const denied = requestPolicyResponse(context.request, context.env)
  if (denied) return denied
  const config = getRuntimeConfig(context.env)

  try {
    const body = await context.request.json()
    const baseCommitSha = String(body.baseCommitSha || '')
    const baseTreeSha = String(body.baseTreeSha || '')
    const items = Array.isArray(body.items) ? body.items : []

    if (!baseCommitSha || !baseTreeSha) return errorJson(400, '缺少批次基础快照')
    if (!items.length) return errorJson(400, '没有可提交文件')
    if (items.length > 100) return errorJson(400, '单次最多提交 100 个文件')

    const normalized = items.map(item => ({
      path: normalizeRepoPath(item.path || ''),
      sha: String(item.blobSha || '')
    }))

    if (normalized.some(item => !item.path || !/^[0-9a-f]{40}$/i.test(item.sha))) {
      return errorJson(400, '批次文件信息无效')
    }
    if (new Set(normalized.map(item => item.path)).size !== normalized.length) {
      return errorJson(409, '批次中存在重复路径')
    }
    const protectedPath = normalized.find(item => isProtectedPath(item.path, config))
    if (protectedPath) return errorJson(403, `受保护路径禁止写入：${protectedPath.path}`)

    const branch = await getBranch(context.env, config)
    if (!branch.ok) return errorJson(502, githubErrorMessage(branch))
    const snapshot = branchSnapshot(branch)
    if (snapshot.commitSha !== baseCommitSha || snapshot.treeSha !== baseTreeSha) {
      return errorJson(409, '提交前仓库分支发生变化，本批次未提交，请重新上传')
    }

    const tree = normalized.map(item => ({
      path: item.path,
      mode: '100644',
      type: 'blob',
      sha: item.sha
    }))

    const treeResult = await createTree(context.env, config, baseTreeSha, tree)
    if (!treeResult.ok) return errorJson(502, githubErrorMessage(treeResult))

    const count = normalized.length
    const message = `cdn: upload ${count} ${count === 1 ? 'file' : 'files'}`
    const commitResult = await createGitCommit(context.env, config, message, treeResult.data.sha, baseCommitSha)
    if (!commitResult.ok) return errorJson(502, githubErrorMessage(commitResult))

    const refResult = await updateBranchRef(context.env, config, commitResult.data.sha)
    if (!refResult.ok) {
      return errorJson(refResult.status === 422 ? 409 : 502, githubErrorMessage(refResult))
    }

    return json({
      ok: true,
      commit: commitResult.data.sha,
      count,
      items: normalized.map(item => ({
        path: item.path,
        name: item.path.split('/').pop(),
        publicUrl: publicUrlForPath(item.path, config)
      }))
    }, { status: 201 })
  } catch (error) {
    return errorJson(400, error.message)
  }
}
