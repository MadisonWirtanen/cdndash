const CACHE_PREFIX = 'cdndash-pwa-'
const CACHE_NAME = `${CACHE_PREFIX}v1`
const SHELL_ASSETS = [
  '/assets/styles.css',
  '/assets/app.js',
  '/manifest.webmanifest',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
]

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    await Promise.allSettled(SHELL_ASSETS.map(async path => {
      const response = await fetch(path, { cache: 'reload', credentials: 'same-origin' })
      if (response.ok) await cache.put(path, response)
    }))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    )
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return
  if (!SHELL_ASSETS.includes(url.pathname)) return

  event.respondWith((async () => {
    try {
      const response = await fetch(request)
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME)
        await cache.put(request, response.clone())
      }
      return response
    } catch {
      const cached = await caches.match(request)
      if (cached) return cached
      throw new Error('Network unavailable and asset is not cached')
    }
  })())
})
