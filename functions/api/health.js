import { getRuntimeConfig } from '../_lib/config.js'
import { getBranch, githubErrorMessage } from '../_lib/github.js'
import { errorJson, json, requestPolicyResponse } from '../_lib/http.js'

export async function onRequestGet(context) {
  const denied = requestPolicyResponse(context.request, context.env)
  if (denied) return denied
  const config = getRuntimeConfig(context.env)
  try {
    const result = await getBranch(context.env, config)
    if (!result.ok) return errorJson(result.status === 401 ? 401 : 502, githubErrorMessage(result))
    return json({
      ok: true,
      github: {
        ok: true,
        branch: result.data?.name || config.branch,
        commit: result.data?.commit?.sha || null,
        rateRemaining: result.headers.get('x-ratelimit-remaining')
      }
    })
  } catch (error) {
    return errorJson(500, error.message)
  }
}
