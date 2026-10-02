import { execFileSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const required = [
  'public/index.html',
  'public/assets/app.js',
  'public/assets/styles.css',
  'functions/api/config.js',
  'functions/api/list.js',
  'functions/api/preflight.js',
  'functions/api/stage.js',
  'functions/api/commit.js',
  'functions/api/rename.js',
  'functions/api/delete.js',
  'functions/api/check.js',
  'functions/api/health.js',
  'functions/_lib/config.js',
  'functions/_lib/github.js',
  'functions/_lib/http.js',
  'wrangler.toml',
  'README.md'
]

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(path))
    else out.push(path)
  }
  return out
}

for (const file of required) await readFile(join(root, file))

const jsFiles = [
  ...await walk(join(root, 'public')),
  ...await walk(join(root, 'functions')),
  ...await walk(join(root, 'scripts'))
].filter(file => ['.js', '.mjs'].includes(extname(file)))

for (const file of jsFiles) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
}

const browserJs = await readFile(join(root, 'public/assets/app.js'), 'utf8')
const html = await readFile(join(root, 'public/index.html'), 'utf8')

if (browserJs.includes('GITHUB_TOKEN')) {
  throw new Error('Browser JavaScript must never reference the server-side GitHub credential binding')
}
if (/accept=["']image\/\*/i.test(html)) {
  throw new Error('File picker must not be restricted to image-only uploads')
}
if (browserJs.includes('compress: true')) {
  throw new Error('Image compression must not be enabled by default')
}
if (!browserJs.includes("naming: 'custom'")) {
  throw new Error('Custom/original naming must be the default')
}
if (!browserJs.includes('/api/preflight') || !browserJs.includes('/api/commit')) {
  throw new Error('Batch upload flow is incomplete')
}

console.log(`Syntax checked ${jsFiles.length} JavaScript files.`)
console.log('Generic file upload and batch-commit checks passed.')
