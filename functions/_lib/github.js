import { encodeRepoPath } from './config.js'

const API = 'https://api.github.com'

function githubHeaders(env, extra = {}) {
  if (!env.GITHUB_TOKEN) throw new Error('Cloudflare Secret GITHUB_TOKEN 尚未配置')
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'cdndash-cloudflare-pages',
    ...extra
  }
}

export async function githubRequest(env, path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: githubHeaders(env, init.headers)
  })
  let data = null
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => null)
  } else if (response.status !== 204) {
    data = await response.text().catch(() => null)
  }
  return { ok: response.ok, status: response.status, data, headers: response.headers }
}

function repoBase(config) {
  return `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`
}

export async function getContent(env, config, path = '') {
  const encoded = encodeRepoPath(path)
  const suffix = encoded ? `/contents/${encoded}` : '/contents'
  return githubRequest(env, `${repoBase(config)}${suffix}?ref=${encodeURIComponent(config.branch)}`)
}

export async function getBranch(env, config) {
  return githubRequest(env, `${repoBase(config)}/branches/${encodeURIComponent(config.branch)}`)
}

export function branchSnapshot(result) {
  const commitSha = result?.data?.commit?.sha
  const treeSha = result?.data?.commit?.commit?.tree?.sha
  if (!commitSha || !treeSha) throw new Error('无法读取 GitHub 分支快照')
  return { commitSha, treeSha }
}

export async function getTree(env, config, treeSha, recursive = true) {
  const query = recursive ? '?recursive=1' : ''
  return githubRequest(env, `${repoBase(config)}/git/trees/${encodeURIComponent(treeSha)}${query}`)
}

export async function createBlob(env, config, contentBase64) {
  return githubRequest(env, `${repoBase(config)}/git/blobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: contentBase64, encoding: 'base64' })
  })
}

export async function createTree(env, config, baseTreeSha, tree) {
  return githubRequest(env, `${repoBase(config)}/git/trees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_tree: baseTreeSha, tree })
  })
}

export async function createGitCommit(env, config, message, treeSha, parentSha) {
  return githubRequest(env, `${repoBase(config)}/git/commits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] })
  })
}

export async function updateBranchRef(env, config, sha) {
  return githubRequest(env, `${repoBase(config)}/git/refs/heads/${encodeURIComponent(config.branch)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha, force: false })
  })
}

export async function removeContent(env, config, path, sha) {
  const encoded = encodeRepoPath(path)
  return githubRequest(env, `${repoBase(config)}/contents/${encoded}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `cdn: delete ${path}`,
      sha,
      branch: config.branch
    })
  })
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
  }
  return btoa(binary)
}

export function githubErrorMessage(result) {
  const message = result?.data?.message || result?.data || `GitHub API 请求失败 (${result?.status || 'unknown'})`
  return typeof message === 'string' ? message : JSON.stringify(message)
}
