const DEFAULTS = Object.freeze({
  owner: 'MadisonWirtanen',
  repo: 'cdn',
  branch: 'master',
  publicBaseUrl: 'https://cdn.003153.xyz',
  defaultUploadDir: 'image',
  maxUploadMB: 15,
  allowDelete: true,
  allowOverwrite: true,
  protectedPaths: ['index.html', '404.html', 'CNAME', 'vercel.json', '.settings', '.deploy']
})

function envString(env, key, fallback = '') {
  const value = env?.[key]
  return value == null || value === '' ? fallback : String(value)
}

function envBool(env, key, fallback) {
  const value = env?.[key]
  if (value == null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

export function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

export function getRuntimeConfig(env = {}) {
  const maxUploadMB = Math.max(1, Math.min(50, Number(envString(env, 'MAX_UPLOAD_MB', String(DEFAULTS.maxUploadMB))) || DEFAULTS.maxUploadMB))
  return {
    owner: envString(env, 'TARGET_OWNER', DEFAULTS.owner),
    repo: envString(env, 'TARGET_REPO', DEFAULTS.repo),
    branch: envString(env, 'TARGET_BRANCH', DEFAULTS.branch),
    publicBaseUrl: envString(env, 'PUBLIC_BASE_URL', DEFAULTS.publicBaseUrl).replace(/\/+$/, ''),
    defaultUploadDir: normalizeRepoPath(envString(env, 'DEFAULT_UPLOAD_DIR', DEFAULTS.defaultUploadDir)),
    maxUploadMB,
    maxUploadBytes: maxUploadMB * 1024 * 1024,
    allowDelete: envBool(env, 'ALLOW_DELETE', DEFAULTS.allowDelete),
    allowOverwrite: envBool(env, 'ALLOW_OVERWRITE', DEFAULTS.allowOverwrite),
    protectedPaths: parseCsv(envString(env, 'PROTECTED_PATHS', DEFAULTS.protectedPaths.join(','))).map(normalizeRepoPath),
    allowedHosts: parseCsv(envString(env, 'ALLOWED_HOSTS', ''))
  }
}

export function normalizeRepoPath(input = '') {
  const path = String(input)
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)

  if (path.some(segment => segment === '.' || segment === '..' || segment.includes('\u0000'))) {
    throw new Error('路径包含不允许的目录片段')
  }
  return path.join('/')
}

export function normalizeFilename(input = '') {
  const name = String(input)
    .replace(/[\\/\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  if (!name || name === '.' || name === '..') throw new Error('文件名无效')
  return name
}

export function joinRepoPath(dir, filename) {
  const normalizedDir = normalizeRepoPath(dir)
  const normalizedName = normalizeFilename(filename)
  return normalizedDir ? `${normalizedDir}/${normalizedName}` : normalizedName
}

export function isProtectedPath(path, config) {
  const normalized = normalizeRepoPath(path).toLowerCase()
  return config.protectedPaths.some(item => item.toLowerCase() === normalized)
}

export function encodeRepoPath(path) {
  return normalizeRepoPath(path)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
}

export function publicUrlForPath(path, config) {
  const encoded = normalizeRepoPath(path)
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/')
  return `${config.publicBaseUrl}/${encoded}`
}

export function isImageName(name) {
  return /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(String(name))
}
