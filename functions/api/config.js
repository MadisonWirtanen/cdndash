import { getRuntimeConfig } from '../_lib/config.js'
import { json, requestPolicyResponse } from '../_lib/http.js'

export function onRequestGet(context) {
  const denied = requestPolicyResponse(context.request, context.env)
  if (denied) return denied
  const config = getRuntimeConfig(context.env)
  return json({
    ok: true,
    owner: config.owner,
    repo: config.repo,
    branch: config.branch,
    publicBaseUrl: config.publicBaseUrl,
    defaultUploadDir: config.defaultUploadDir,
    maxUploadMB: config.maxUploadMB,
    maxUploadBytes: config.maxUploadBytes,
    protectedPaths: config.protectedPaths,
    capabilities: {
      delete: config.allowDelete,
      overwrite: config.allowOverwrite
    }
  })
}
