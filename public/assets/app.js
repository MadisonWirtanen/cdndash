const $ = id => document.getElementById(id)

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
    defaultDir: 'image',
    compress: true,
    quality: 86,
    naming: 'timestamp',
    copyFormat: 'url',
    autoCheck: true
  }
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem('cdndash.settings') || '{}') }
  } catch {
    return defaults
  }
}

function persistSettings() {
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
  setTimeout(() => node.remove(), 3200)
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
    .replace(/^\.+$/, 'image') || 'image'
}

function normalizeDir(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .map(x => x.trim())
    .filter(x => x && x !== '.' && x !== '..')
    .join('/')
}

function extensionFor(fileName, mimeType) {
  const match = String(fileName).match(/\.([A-Za-z0-9]{1,8})$/)
  if (match) return `.${match[1].toLowerCase()}`
  const byType = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'image/avif': '.avif'
  }
  return byType[mimeType] || '.img'
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

async function blobToWebp(file, quality) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return { blob: file, converted: false }
  }

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
  if (!file.type.startsWith('image/')) throw new Error(`${file.name || '文件'} 不是图片`)
  if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name} 超过浏览器处理上限 50 MB`)

  const shouldCompress = els.compressToggle.checked
  const processed = shouldCompress
    ? await blobToWebp(file, Number(els.qualityRange.value))
    : { blob: file, converted: false }

  let ext = processed.converted ? '.webp' : extensionFor(file.name, processed.blob.type)
  let filename
  if (state.settings.naming === 'original') {
    const original = sanitizeFilename(file.name)
    filename = processed.converted ? original.replace(/\.[^.]+$/, '') + '.webp' : original
  } else if (state.settings.naming === 'hash') {
    filename = await hashName(processed.blob, ext)
  } else {
    filename = timestampName(ext)
  }

  return {
    id: crypto.randomUUID(),
    originalName: file.name || filename,
    originalSize: file.size,
    blob: processed.blob,
    filename,
    previewUrl: URL.createObjectURL(processed.blob),
    status: 'ready',
    statusText: processed.converted && processed.blob.size < file.size
      ? `已转换 WebP · ${formatBytes(file.size)} → ${formatBytes(processed.blob.size)}`
      : formatBytes(processed.blob.size),
    result: null
  }
}

async function addFiles(fileList) {
  const files = [...fileList]
  if (!files.length) return
  for (const file of files) {
    try {
      const item = await prepareFile(file)
      state.queue.push(item)
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

function renderQueue() {
  els.queuePanel.classList.toggle('hidden', state.queue.length === 0)
  els.queueSummary.textContent = `${state.queue.length} 张图片`
  els.uploadQueue.replaceChildren()

  for (const item of state.queue) {
    const card = document.createElement('div')
    card.className = 'queue-item'

    const img = document.createElement('img')
    img.className = 'queue-thumb'
    img.src = item.previewUrl
    img.alt = ''

    const main = document.createElement('div')
    main.className = 'queue-main'
    const input = document.createElement('input')
    input.className = 'queue-name'
    input.value = item.filename
    input.disabled = item.status === 'uploading' || item.status === 'uploaded'
    input.addEventListener('change', () => {
      item.filename = sanitizeFilename(input.value)
      input.value = item.filename
    })

    const meta = document.createElement('div')
    meta.className = 'queue-meta'
    meta.textContent = item.originalName === item.filename ? formatBytes(item.blob.size) : `原文件：${item.originalName}`

    const status = document.createElement('div')
    const statusClass = item.status === 'uploaded' ? 'good' : item.status === 'error' ? 'bad' : item.status === 'checking' ? 'pending' : ''
    status.className = `queue-status ${statusClass}`.trim()
    status.textContent = item.statusText

    main.append(input, meta, status)

    const actions = document.createElement('div')
    actions.className = 'queue-actions'

    if (item.result?.publicUrl) {
      actions.append(
        makeButton('复制链接', 'mini-btn', () => copyImageLink(item.result.publicUrl, item.filename)),
        makeButton('打开', 'mini-btn', () => window.open(item.result.publicUrl, '_blank', 'noopener'))
      )
    }

    if (item.status !== 'uploading') {
      actions.append(makeButton('移除', 'mini-btn', () => removeQueueItem(item.id)))
    }

    card.append(img, main, actions)
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
  URL.revokeObjectURL(state.queue[index].previewUrl)
  state.queue.splice(index, 1)
  renderQueue()
}

function clearQueue() {
  if (state.uploading) return
  state.queue.forEach(item => URL.revokeObjectURL(item.previewUrl))
  state.queue = []
  renderQueue()
}

async function uploadAll() {
  if (state.uploading || !state.config) return
  const dir = normalizeDir(els.uploadDir.value)
  els.uploadDir.value = dir
  state.settings.defaultDir = dir || state.settings.defaultDir
  persistSettings()

  state.uploading = true
  renderQueue()
  let success = 0

  for (const item of state.queue) {
    if (item.result) continue
    try {
      if (item.blob.size > state.config.maxUploadBytes) {
        throw new Error(`处理后仍超过 ${state.config.maxUploadMB} MB 限制`)
      }
      setQueueStatus(item, 'uploading', '正在提交到 GitHub…')
      const form = new FormData()
      form.set('file', item.blob, item.filename)
      form.set('dir', dir)
      form.set('filename', item.filename)
      form.set('overwrite', String(els.overwriteToggle.checked))

      const result = await fetchJson('/api/upload', { method: 'POST', body: form })
      item.result = result
      item.filename = result.name
      setQueueStatus(item, 'uploaded', result.overwritten ? 'GitHub 已覆盖更新' : 'GitHub 已提交')
      success += 1
      if (state.settings.autoCheck) void pollCdn(item)
    } catch (error) {
      const suffix = error.status === 409 ? '；如确认需要替换，请勾选“允许覆盖同名图片”' : ''
      setQueueStatus(item, 'error', `${error.message}${suffix}`)
    }
  }

  state.uploading = false
  renderQueue()
  if (success) toast(`已完成 ${success} 张图片的 GitHub 提交`, 'good')
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
      // Deployment propagation can temporarily fail; retry quietly.
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  item.status = 'uploaded'
  item.statusText = 'GitHub 已提交 · CDN 尚未检测到，可稍后刷新确认'
  renderQueue()
}

function copyValueFor(url, name, format = state.settings.copyFormat) {
  if (format === 'markdown') return `![${name}](${url})`
  if (format === 'html') return `<img src="${url}" alt="${name}">`
  return url
}

async function copyImageLink(url, name, format) {
  const value = copyValueFor(url, name, format)
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
  els.managerPath.textContent = `/${state.managerPath}`.replace(/\/$/, '') || '/'
  els.managerGrid.replaceChildren()
  els.managerEmpty.classList.add('hidden')
  els.managerNotice.classList.add('hidden')

  try {
    const data = await fetchJson(`/api/list?path=${encodeURIComponent(state.managerPath)}`)
    state.managerItems = data.items
    if (data.limited) {
      els.managerNotice.textContent = '当前目录项目很多；GitHub Contents API 最多返回 1000 项，建议继续使用子目录组织图片。'
      els.managerNotice.classList.remove('hidden')
    }
    renderManager()
  } catch (error) {
    els.managerNotice.textContent = error.message
    els.managerNotice.classList.remove('hidden')
  }
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
    const image = document.createElement('img')
    image.className = 'image-preview'
    image.loading = 'lazy'
    image.src = item.publicUrl
    image.alt = item.name

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
      makeButton('复制', 'mini-btn', () => copyImageLink(item.publicUrl, item.name)),
      makeButton('Markdown', 'mini-btn', () => copyImageLink(item.publicUrl, item.name, 'markdown')),
      makeButton('打开', 'mini-btn', () => window.open(item.publicUrl, '_blank', 'noopener'))
    )
    if (state.config?.capabilities.delete && !item.protected) {
      const del = makeButton('删除', 'danger-btn', () => deleteManagedImage(item))
      actions.append(del)
    }
    info.append(name, size, actions)
    card.append(image, info)
    els.managerGrid.append(card)
  }
}

async function deleteManagedImage(item) {
  if (!confirm(`确定删除以下图片吗？\n\n${item.path}\n\n删除后旧 CDN 链接将失效。`)) return
  try {
    await fetchJson('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: item.path, sha: item.sha, confirm: item.path })
    })
    toast('图片已从 GitHub 删除', 'good')
    await loadManager(state.managerPath)
  } catch (error) {
    toast(error.message, 'bad')
  }
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
    if (!localStorage.getItem('cdndash.settings')) {
      state.settings.defaultDir = state.config.defaultUploadDir || 'image'
      persistSettings()
    }
    els.repoMeta.textContent = `${state.config.owner}/${state.config.repo} · ${state.config.branch}`
    els.uploadDir.value = state.settings.defaultDir || state.config.defaultUploadDir
    els.compressToggle.checked = state.settings.compress
    els.qualityRange.value = String(state.settings.quality)
    els.qualityValue.textContent = `${state.settings.quality}%`
    els.overwriteToggle.disabled = !state.config.capabilities.overwrite
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
  const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'))
  if (files.length) void addFiles(files)
})
els.compressToggle.addEventListener('change', () => {
  state.settings.compress = els.compressToggle.checked
  persistSettings()
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
