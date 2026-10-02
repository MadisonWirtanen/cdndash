const $ = id => document.getElementById(id)
const MiB = 1024 * 1024

const els = {
  repoMeta: $('repoMeta'),
  healthBadge: $('healthBadge'),
  settingsBtn: $('settingsBtn'),
  uploadView: $('uploadView'),
  manageView: $('manageView'),
  uploadDir: $('uploadDir'),
  dropZone: $('dropZone'),
  chooseFilesBtn: $('chooseFilesBtn'),
  fileInput: $('fileInput'),
  compressToggle: $('compressToggle'),
  overwriteToggle: $('overwriteToggle'),
  qualityRow: $('qualityRow'),
  qualityRange: $('qualityRange'),
  qualityValue: $('qualityValue'),
  queuePanel: $('queuePanel'),
  queueSummary: $('queueSummary'),
  uploadQueue: $('uploadQueue'),
  clearQueueBtn: $('clearQueueBtn'),
  uploadAllBtn: $('uploadAllBtn'),
  managerPath: $('managerPath'),
  managerUpBtn: $('managerUpBtn'),
  managerRefreshBtn: $('managerRefreshBtn'),
  managerSearch: $('managerSearch'),
  managerNotice: $('managerNotice'),
  managerGrid: $('managerGrid'),
  managerEmpty: $('managerEmpty'),
  settingsBackdrop: $('settingsBackdrop'),
  settingsDrawer: $('settingsDrawer'),
  closeSettingsBtn: $('closeSettingsBtn'),
  defaultDirSetting: $('defaultDirSetting'),
  namingSetting: $('namingSetting'),
  copyFormatSetting: $('copyFormatSetting'),
  autoCheckSetting: $('autoCheckSetting'),
  settingsRepo: $('settingsRepo'),
  settingsBranch: $('settingsBranch'),
  settingsCdn: $('settingsCdn'),
  saveSettingsBtn: $('saveSettingsBtn'),
  toastRegion: $('toastRegion')
}

const state = {
  config: null,
  queue: [],
  managerPath: '',
  managerItems: [],
  uploading: false,
  settings: loadSettings()
}

function loadSettings() {
  const defaults = {
    version: 2,
    defaultDir: 'image',
    compress: false,
    quality: 86,
    naming: 'custom',
    copyFormat: 'url',
    autoCheck: true
  }
  try {
    const saved = JSON.parse(localStorage.getItem('cdndash.settings') || '{}')
    if (!saved.version || saved.version < 2) {
      return {
        ...defaults,
        defaultDir: saved.defaultDir || defaults.defaultDir,
        quality: Number(saved.quality) || defaults.quality,
        copyFormat: saved.copyFormat || defaults.copyFormat,
        autoCheck: saved.autoCheck ?? defaults.autoCheck
      }
    }
    return { ...defaults, ...saved, version: 2 }
  } catch {
    return defaults
  }
}

function persistSettings() {
  state.settings.version = 2
  localStorage.setItem('cdndash.settings', JSON.stringify(state.settings))
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...options
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `请求失败 (${response.status})`)
    error.status = response.status
    error.data = data
    throw error
  }
  return data
}

function toast(message, type = '') {
  const node = document.createElement('div')
  node.className = `toast ${type}`.trim()
  node.textContent = message
  els.toastRegion.append(node)
  setTimeout(() => node.remove(), 3600)
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value.toFixed(index === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`
}

function sanitizeFilename(name) {
  return String(name || '')
    .replace(/[\\/\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, 'file') || 'file'
}

function normalizeDir(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .map(x => x.trim())
    .filter(x => x && x !== '.' && x !== '..')
    .join('/')
}

function joinPath(dir, name) {
  const cleanDir = normalizeDir(dir)
  const cleanName = sanitizeFilename(name)
  return cleanDir ? `${cleanDir}/${cleanName}` : cleanName
}

function extensionFor(fileName, mimeType) {
  const match = String(fileName).match(/\.([A-Za-z0-9]{1,12})$/)
  if (match) return `.${match[1].toLowerCase()}`
  const byType = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'image/avif': '.avif',
    'application/pdf': '.pdf',
    'application/zip': '.zip',
    'text/plain': '.txt'
  }
  return byType[mimeType] || ''
}

function baseNameWithoutExtension(name) {
  return String(name).replace(/\.[^.]+$/, '')
}

function timestampName(ext) {
  const now = new Date()
  const p = n => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  const random = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(-5)
  return `${stamp}-${random}${ext}`
}

async function hashName(blob, ext) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  const hex = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 20)}${ext}`
}

function isCompressibleImage(file) {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
}

function looksLikeImage(name, mime = '') {
  return mime.startsWith('image/') || /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(String(name))
}

async function blobToWebp(file, quality) {
  if (!isCompressibleImage(file)) return { blob: file, converted: false }
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return { blob: file, converted: false }
  }

  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d', { alpha: true })
  context.drawImage(bitmap, 0, 0)
  bitmap.close?.()

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality / 100))
  if (!blob) return { blob: file, converted: false }
  return { blob, converted: true }
}

async function prepareFile(file) {
  const hardLimit = state.config?.maxUploadBytes || 25 * MiB
  if (file.size > hardLimit) {
    throw new Error(`${file.name || '文件'} 大小为 ${formatBytes(file.size)}，超过 25 MB 限制，未加入上传队列`)
  }
  if (file.size <= 0) throw new Error(`${file.name || '文件'} 为空`)

  const processed = els.compressToggle.checked && isCompressibleImage(file)
    ? await blobToWebp(file, Number(els.qualityRange.value))
    : { blob: file, converted: false }

  const originalName = sanitizeFilename(file.name || 'file')
  const ext = processed.converted ? '.webp' : extensionFor(originalName, processed.blob.type)
  let filename

  if (state.settings.naming === 'timestamp') {
    filename = timestampName(ext)
  } else if (state.settings.naming === 'hash') {
    filename = await hashName(processed.blob, ext)
  } else {
    filename = processed.converted
      ? `${baseNameWithoutExtension(originalName)}.webp`
      : originalName
  }

  const isImage = looksLikeImage(filename, processed.blob.type)
  return {
    id: crypto.randomUUID(),
    originalName,
    originalSize: file.size,
    blob: processed.blob,
    filename,
    mime: processed.blob.type || file.type || 'application/octet-stream',
    isImage,
    previewUrl: isImage ? URL.createObjectURL(processed.blob) : null,
    status: 'ready',
    statusText: processed.converted
      ? `已转换 WebP · ${formatBytes(file.size)} → ${formatBytes(processed.blob.size)}`
      : formatBytes(processed.blob.size),
    staged: null,
    result: null
  }
}

async function addFiles(fileList) {
  const files = [...fileList]
  if (!files.length) return
  for (const file of files) {
    try {
      state.queue.push(await prepareFile(file))
    } catch (error) {
      toast(error.message, 'bad')
    }
  }
  renderQueue()
}

function setQueueStatus(item, status, text) {
  item.status = status
  item.statusText = text
  renderQueue()
}

function fileIconFor(name, kind) {
  if (kind === 'video') return '▶'
  if (kind === 'audio') return '♪'
  if (kind === 'archive') return 'ZIP'
  if (kind === 'document') return /\.pdf$/i.test(name) ? 'PDF' : 'DOC'
  if (kind === 'code') return '</>'
  if (kind === 'font') return 'Aa'
  return 'FILE'
}

function renderQueue() {
  els.queuePanel.classList.toggle('hidden', state.queue.length === 0)
  els.queueSummary.textContent = `${state.queue.length} 个文件`
  els.uploadQueue.replaceChildren()

  for (const item of state.queue) {
    const card = document.createElement('div')
    card.className = 'queue-item'

    const preview = item.isImage && item.previewUrl
      ? document.createElement('img')
      : document.createElement('div')
    if (preview instanceof HTMLImageElement) {
      preview.className = 'queue-thumb'
      preview.src = item.previewUrl
      preview.alt = ''
    } else {
      preview.className = 'queue-file-icon'
      preview.textContent = fileIconFor(item.filename, guessKind(item.filename))
    }

    const main = document.createElement('div')
    main.className = 'queue-main'
    const input = document.createElement('input')
    input.className = 'queue-name'
    input.value = item.filename
    input.disabled = state.uploading || Boolean(item.result)
    input.addEventListener('change', () => {
      item.filename = sanitizeFilename(input.value)
      input.value = item.filename
      item.isImage = looksLikeImage(item.filename, item.mime)
    })

    const meta = document.createElement('div')
    meta.className = 'queue-meta'
    meta.textContent = item.originalName === item.filename
      ? formatBytes(item.blob.size)
      : `原文件：${item.originalName} · ${formatBytes(item.blob.size)}`

    const status = document.createElement('div')
    const statusClass = item.status === 'uploaded' ? 'good' : item.status === 'error' ? 'bad' : ['staging', 'committing', 'checking'].includes(item.status) ? 'pending' : ''
    status.className = `queue-status ${statusClass}`.trim()
    status.textContent = item.statusText

    main.append(input, meta, status)

    const actions = document.createElement('div')
    actions.className = 'queue-actions'
    if (item.result?.publicUrl) {
      actions.append(
        makeButton('复制链接', 'mini-btn', () => copyFileLink(item.result.publicUrl, item.filename, item.isImage)),
        makeButton('打开', 'mini-btn', () => window.open(item.result.publicUrl, '_blank', 'noopener'))
      )
    }
    if (!state.uploading) actions.append(makeButton('移除', 'mini-btn', () => removeQueueItem(item.id)))

    card.append(preview, main, actions)
    els.uploadQueue.append(card)
  }

  els.uploadAllBtn.disabled = state.uploading || !state.queue.some(x => !x.result)
  els.clearQueueBtn.disabled = state.uploading
}

function makeButton(text, className, handler) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = text
  button.addEventListener('click', handler)
  return button
}

function removeQueueItem(id) {
  const index = state.queue.findIndex(x => x.id === id)
  if (index === -1) return
  if (state.queue[index].previewUrl) URL.revokeObjectURL(state.queue[index].previewUrl)
  state.queue.splice(index, 1)
  renderQueue()
}

function clearQueue() {
  if (state.uploading) return
  state.queue.forEach(item => item.previewUrl && URL.revokeObjectURL(item.previewUrl))
  state.queue = []
  renderQueue()
}

async function uploadAll() {
  if (state.uploading || !state.config) return
  const pending = state.queue.filter(item => !item.result)
  if (!pending.length) return

  const dir = normalizeDir(els.uploadDir.value)
  els.uploadDir.value = dir
  state.settings.defaultDir = dir || state.settings.defaultDir
  persistSettings()

  const targets = pending.map(item => ({
    item,
    path: joinPath(dir, item.filename)
  }))

  const duplicate = targets.find((target, index) => targets.findIndex(other => other.path === target.path) !== index)
  if (duplicate) {
    toast(`上传队列中存在重复路径：${duplicate.path}`, 'bad')
    return
  }

  state.uploading = true
  pending.forEach(item => {
    item.staged = null
    item.status = 'staging'
    item.statusText = '正在检查上传批次…'
  })
  renderQueue()

  let snapshot
  try {
    snapshot = await fetchJson('/api/preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paths: targets.map(target => target.path),
        overwrite: els.overwriteToggle.checked
      })
    })
  } catch (error) {
    const conflicts = error.data?.details?.conflicts
    if (Array.isArray(conflicts)) {
      for (const conflict of conflicts) {
        const target = targets.find(entry => entry.path === conflict.path)
        if (target) setQueueStatus(target.item, 'error', conflict.reason)
      }
    }
    pending.filter(item => item.status !== 'error').forEach(item => setQueueStatus(item, 'ready', '未上传'))
    state.uploading = false
    renderQueue()
    toast(error.message, 'bad')
    return
  }

  let stageFailed = false
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]
    try {
      setQueueStatus(target.item, 'staging', `正在暂存文件 ${index + 1}/${targets.length}…`)
      const form = new FormData()
      form.set('file', target.item.blob, target.item.filename)
      form.set('path', target.path)
      form.set('expectedHeadSha', snapshot.baseCommitSha)
      target.item.staged = await fetchJson('/api/stage', { method: 'POST', body: form })
      setQueueStatus(target.item, 'staging', '已暂存，等待整批提交')
    } catch (error) {
      stageFailed = true
      setQueueStatus(target.item, 'error', error.message)
      break
    }
  }

  if (stageFailed) {
    pending.filter(item => item.status === 'staging').forEach(item => setQueueStatus(item, 'ready', '本批次未提交，可重新上传'))
    state.uploading = false
    renderQueue()
    toast('批次中有文件暂存失败，master 未发生任何变化', 'bad')
    return
  }

  pending.forEach(item => setQueueStatus(item, 'committing', '正在创建单一 Git commit…'))
  let committed
  try {
    committed = await fetchJson('/api/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseCommitSha: snapshot.baseCommitSha,
        baseTreeSha: snapshot.baseTreeSha,
        items: targets.map(target => ({
          path: target.path,
          blobSha: target.item.staged.blobSha
        }))
      })
    })
  } catch (error) {
    pending.forEach(item => setQueueStatus(item, 'error', `整批未提交：${error.message}`))
    state.uploading = false
    renderQueue()
    toast('整批提交失败，master 未更新', 'bad')
    return
  }

  const results = new Map(committed.items.map(item => [item.path, item]))
  for (const target of targets) {
    target.item.result = results.get(target.path)
    target.item.staged = null
    setQueueStatus(target.item, 'uploaded', `GitHub 已提交 · commit ${committed.commit.slice(0, 7)}`)
  }

  state.uploading = false
  renderQueue()
  toast(`已将 ${committed.count} 个文件合并为 1 个 Git commit`, 'good')

  if (state.settings.autoCheck) {
    for (const target of targets) void pollCdn(target.item)
  }
}

async function pollCdn(item) {
  if (!item.result?.path) return
  item.status = 'checking'
  item.statusText = 'GitHub 已提交 · 等待 CDN 可访问…'
  renderQueue()

  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const result = await fetchJson(`/api/check?path=${encodeURIComponent(item.result.path)}`)
      if (result.ok) {
        item.status = 'uploaded'
        item.statusText = 'GitHub 已提交 · CDN 已可访问'
        renderQueue()
        return
      }
    } catch {
      // CDN propagation can temporarily fail.
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  item.status = 'uploaded'
  item.statusText = 'GitHub 已提交 · CDN 暂未检测到，可稍后刷新确认'
  renderQueue()
}

function copyValueFor(url, name, isImage, format = state.settings.copyFormat) {
  if (format === 'markdown') return isImage ? `![${name}](${url})` : `[${name}](${url})`
  if (format === 'html') return isImage ? `<img src="${url}" alt="${name}">` : `<a href="${url}">${name}</a>`
  return url
}

async function copyFileLink(url, name, isImage, format) {
  const value = copyValueFor(url, name, isImage, format)
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.append(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
  toast('已复制', 'good')
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === name))
  els.uploadView.classList.toggle('active', name === 'upload')
  els.manageView.classList.toggle('active', name === 'manage')
  if (name === 'manage') void loadManager(state.managerPath)
}

async function loadManager(path = '') {
  state.managerPath = normalizeDir(path)
  els.managerPath.textContent = state.managerPath ? `/${state.managerPath}` : '/'
  els.managerGrid.replaceChildren()
  els.managerEmpty.classList.add('hidden')
  els.managerNotice.classList.add('hidden')

  try {
    const data = await fetchJson(`/api/list?path=${encodeURIComponent(state.managerPath)}`)
    state.managerItems = data.items
    if (data.limited) {
      els.managerNotice.textContent = '当前目录项目很多；GitHub Contents API 最多返回 1000 项，建议继续使用子目录组织文件。'
      els.managerNotice.classList.remove('hidden')
    }
    renderManager()
  } catch (error) {
    els.managerNotice.textContent = error.message
    els.managerNotice.classList.remove('hidden')
  }
}

function guessKind(name) {
  if (/\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(name)) return 'image'
  if (/\.(?:mp4|m4v|mov|webm|mkv|avi)$/i.test(name)) return 'video'
  if (/\.(?:mp3|m4a|aac|wav|ogg|flac)$/i.test(name)) return 'audio'
  if (/\.(?:zip|7z|rar|tar|gz|bz2|xz)$/i.test(name)) return 'archive'
  if (/\.(?:pdf|docx?|xlsx?|pptx?)$/i.test(name)) return 'document'
  if (/\.(?:html?|css|js|mjs|cjs|json|xml|ya?ml|toml|ini|md|txt|csv)$/i.test(name)) return 'code'
  if (/\.(?:ttf|otf|woff2?|eot)$/i.test(name)) return 'font'
  return 'other'
}

function renderManager() {
  const keyword = els.managerSearch.value.trim().toLowerCase()
  const items = state.managerItems.filter(item => !keyword || item.name.toLowerCase().includes(keyword))
  els.managerGrid.replaceChildren()
  els.managerEmpty.classList.toggle('hidden', items.length > 0)

  for (const item of items) {
    if (item.type === 'dir') {
      const card = document.createElement('div')
      card.className = 'item-card folder-card'
      card.tabIndex = 0
      const icon = document.createElement('div')
      icon.className = 'folder-icon'
      icon.textContent = '▰'
      const name = document.createElement('div')
      name.className = 'folder-name'
      name.textContent = item.name
      card.append(icon, name)
      const open = () => loadManager(item.path)
      card.addEventListener('click', open)
      card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') open()
      })
      els.managerGrid.append(card)
      continue
    }

    const card = document.createElement('div')
    card.className = 'item-card'
    let preview
    if (item.isImage) {
      preview = document.createElement('img')
      preview.className = 'image-preview'
      preview.loading = 'lazy'
      preview.src = item.publicUrl
      preview.alt = item.name
    } else {
      preview = document.createElement('div')
      preview.className = 'file-preview'
      const badge = document.createElement('span')
      badge.className = 'file-kind-badge'
      badge.textContent = fileIconFor(item.name, item.kind || guessKind(item.name))
      preview.append(badge)
    }

    const info = document.createElement('div')
    info.className = 'image-info'
    const name = document.createElement('div')
    name.className = 'image-name'
    name.textContent = item.name
    const size = document.createElement('div')
    size.className = 'image-size'
    size.textContent = formatBytes(item.size)
    const actions = document.createElement('div')
    actions.className = 'image-actions'
    actions.append(
      makeButton('复制', 'mini-btn', () => copyFileLink(item.publicUrl, item.name, item.isImage)),
      makeButton('Markdown', 'mini-btn', () => copyFileLink(item.publicUrl, item.name, item.isImage, 'markdown')),
      makeButton('打开', 'mini-btn', () => window.open(item.publicUrl, '_blank', 'noopener'))
    )
    if (state.config?.capabilities.rename && !item.protected) {
      actions.append(makeButton('重命名', 'mini-btn', () => void renameManagedFile(item)))
    }
    if (state.config?.capabilities.delete && !item.protected) {
      actions.append(makeButton('删除', 'danger-btn', () => void deleteManagedFile(item)))
    }
    info.append(name, size, actions)
    card.append(preview, info)
    els.managerGrid.append(card)
  }
}

async function renameManagedFile(item) {
  const requested = prompt('请输入新的文件名（仅修改文件名，不移动目录）：', item.name)
  if (requested == null) return
  const newName = sanitizeFilename(requested)
  if (!newName || newName === item.name) return

  const slash = item.path.lastIndexOf('/')
  const dir = slash >= 0 ? item.path.slice(0, slash) : ''
  const newPath = dir ? `${dir}/${newName}` : newName
  const warning = `重命名会改变 CDN 路径，原链接将失效。\n\n原路径：/${item.path}\n新路径：/${newPath}\n\n确认继续吗？`
  if (!confirm(warning)) return

  try {
    await fetchJson('/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: item.path, newName, confirm: item.path })
    })
    toast('文件已重命名', 'good')
    await loadManager(state.managerPath)
  } catch (error) {
    toast(error.message, 'bad')
  }
}

async function deleteManagedFile(item) {
  if (!confirm(`确定删除以下文件吗？\n\n${item.path}\n\n删除后旧 CDN 链接将失效。`)) return
  try {
    await fetchJson('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: item.path, sha: item.sha, confirm: item.path })
    })
    toast('文件已从 GitHub 删除', 'good')
    await loadManager(state.managerPath)
  } catch (error) {
    toast(error.message, 'bad')
  }
}

function updateCompressUi() {
  els.qualityRow.classList.toggle('hidden', !els.compressToggle.checked)
}

function openSettings() {
  els.defaultDirSetting.value = state.settings.defaultDir || state.config?.defaultUploadDir || 'image'
  els.namingSetting.value = state.settings.naming
  els.copyFormatSetting.value = state.settings.copyFormat
  els.autoCheckSetting.checked = state.settings.autoCheck
  els.settingsRepo.textContent = state.config ? `${state.config.owner}/${state.config.repo}` : '-'
  els.settingsBranch.textContent = state.config?.branch || '-'
  els.settingsCdn.textContent = state.config?.publicBaseUrl || '-'
  els.settingsBackdrop.classList.remove('hidden')
  els.settingsDrawer.classList.add('open')
  els.settingsDrawer.setAttribute('aria-hidden', 'false')
}

function closeSettings() {
  els.settingsBackdrop.classList.add('hidden')
  els.settingsDrawer.classList.remove('open')
  els.settingsDrawer.setAttribute('aria-hidden', 'true')
}

function saveSettingsFromDrawer() {
  state.settings.defaultDir = normalizeDir(els.defaultDirSetting.value) || state.config?.defaultUploadDir || 'image'
  state.settings.naming = els.namingSetting.value
  state.settings.copyFormat = els.copyFormatSetting.value
  state.settings.autoCheck = els.autoCheckSetting.checked
  persistSettings()
  els.uploadDir.value = state.settings.defaultDir
  closeSettings()
  toast('设置已保存', 'good')
}

async function checkHealth() {
  els.healthBadge.className = 'status-badge neutral'
  els.healthBadge.textContent = '检查连接'
  try {
    const data = await fetchJson('/api/health')
    els.healthBadge.className = 'status-badge good'
    els.healthBadge.textContent = data.github.ok ? 'GitHub 已连接' : 'GitHub 异常'
  } catch (error) {
    els.healthBadge.className = 'status-badge bad'
    els.healthBadge.textContent = '连接失败'
    toast(error.message, 'bad')
  }
}

async function init() {
  try {
    state.config = await fetchJson('/api/config')
    state.settings.defaultDir ||= state.config.defaultUploadDir || 'image'
    persistSettings()
    els.repoMeta.textContent = `${state.config.owner}/${state.config.repo} · ${state.config.branch}`
    els.uploadDir.value = state.settings.defaultDir
    els.compressToggle.checked = state.settings.compress
    els.qualityRange.value = String(state.settings.quality)
    els.qualityValue.textContent = `${state.settings.quality}%`
    els.overwriteToggle.disabled = !state.config.capabilities.overwrite
    updateCompressUi()
    await checkHealth()
  } catch (error) {
    els.repoMeta.textContent = '配置读取失败'
    els.healthBadge.className = 'status-badge bad'
    els.healthBadge.textContent = '不可用'
    toast(error.message, 'bad')
  }
}

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)))
els.chooseFilesBtn.addEventListener('click', event => {
  event.stopPropagation()
  els.fileInput.click()
})
els.dropZone.addEventListener('click', () => els.fileInput.click())
els.dropZone.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') els.fileInput.click()
})
els.fileInput.addEventListener('change', () => {
  void addFiles(els.fileInput.files)
  els.fileInput.value = ''
})
for (const eventName of ['dragenter', 'dragover']) {
  els.dropZone.addEventListener(eventName, event => {
    event.preventDefault()
    els.dropZone.classList.add('dragover')
  })
}
for (const eventName of ['dragleave', 'drop']) {
  els.dropZone.addEventListener(eventName, event => {
    event.preventDefault()
    els.dropZone.classList.remove('dragover')
  })
}
els.dropZone.addEventListener('drop', event => void addFiles(event.dataTransfer.files))
document.addEventListener('paste', event => {
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return
  const files = [...(event.clipboardData?.files || [])]
  if (files.length) void addFiles(files)
})
els.compressToggle.addEventListener('change', () => {
  state.settings.compress = els.compressToggle.checked
  persistSettings()
  updateCompressUi()
})
els.qualityRange.addEventListener('input', () => {
  els.qualityValue.textContent = `${els.qualityRange.value}%`
  state.settings.quality = Number(els.qualityRange.value)
  persistSettings()
})
els.clearQueueBtn.addEventListener('click', clearQueue)
els.uploadAllBtn.addEventListener('click', () => void uploadAll())
els.managerUpBtn.addEventListener('click', () => {
  const parts = state.managerPath.split('/').filter(Boolean)
  parts.pop()
  void loadManager(parts.join('/'))
})
els.managerRefreshBtn.addEventListener('click', () => void loadManager(state.managerPath))
els.managerSearch.addEventListener('input', renderManager)
els.settingsBtn.addEventListener('click', openSettings)
els.closeSettingsBtn.addEventListener('click', closeSettings)
els.settingsBackdrop.addEventListener('click', closeSettings)
els.saveSettingsBtn.addEventListener('click', saveSettingsFromDrawer)
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeSettings()
})

void init()
