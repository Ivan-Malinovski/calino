const scope = new URL(self.registration.scope)
const cachePrefix = `calino:${scope.pathname}:`
const CACHE_NAME = `${cachePrefix}v1`
const STATIC_ASSETS = [
  'manifest.json',
  'apple-touch-icon.png',
  'favicon-96x96.png',
  'vite.svg',
  'calino-icon.svg',
  'icon-192.svg',
].map((path) => new URL(path, scope).href)

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS)
    })
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(
            (name) =>
              (name.startsWith(cachePrefix) && name !== CACHE_NAME) ||
              (scope.pathname === '/' && /^calino-v\d+$/.test(name))
          )
          .map((name) => caches.delete(name))
      )
    })
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const { request } = event
  if (
    !request.url.startsWith(scope.href) ||
    new URL(request.url).pathname.endsWith('/calino.config.json')
  ) {
    return
  }

  // Network-first for navigation requests (HTML shell) so users always
  // see the latest app version. Falls back to cache when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const cloned = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned))
          return response
        })
        .catch(() => caches.match(request, { cacheName: CACHE_NAME }))
    )
    return
  }

  // Cache-first for everything else (hashed JS/CSS assets, icons, etc.)
  // New builds produce new URLs so cache-first is always fresh.
  event.respondWith(
    caches.match(request, { cacheName: CACHE_NAME }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse
      }
      return fetch(request).then((response) => {
        if (response.ok && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache))
        }
        return response
      })
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const eventData = event.notification.data
  if (!eventData || !eventData.eventId) return

  // Validate UUID format. Without this, a malicious actor that can
  // trigger a notification on this origin (e.g. via a future push
  // channel) could embed "../etc" or other path-traversal in the
  // eventId and have clients.navigate() follow it. Reject anything
  // that isn't a real UUID.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(eventData.eventId)) {
    console.warn('[sw] ignoring notification with invalid eventId:', eventData.eventId)
    return
  }

  // Validate date is a yyyy-MM-dd prefix. eventDate is required for the
  // URL — if it's missing or malformed, fall back to opening the root.
  const eventDate = eventData.eventDate
  if (typeof eventDate !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(eventDate)) {
    event.waitUntil(clients.openWindow(scope.href))
    return
  }

  const url = new URL(scope)
  url.searchParams.set('date', eventDate.slice(0, 10))
  url.searchParams.set('event', eventData.eventId)
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(scope.href)) {
          return client.navigate(url.href).then((window) => window?.focus())
        }
      }
      return clients.openWindow(url.href)
    })
  )
})
