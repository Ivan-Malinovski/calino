const CACHE_NAME = 'calino-v8'
const STATIC_ASSETS = [
  '/manifest.json',
  '/apple-touch-icon.png',
  '/favicon-96x96.png',
  '/vite.svg',
  '/calino-icon.svg',
  '/icon-192.svg',
]

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
        cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      )
    })
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const { request } = event

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
        .catch(() => caches.match(request))
    )
    return
  }

  // Cache-first for everything else (hashed JS/CSS assets, icons, etc.)
  // New builds produce new URLs so cache-first is always fresh.
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
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
    event.waitUntil(clients.openWindow('/'))
    return
  }

  const url = `/?date=${eventDate.split('T')[0]}&event=${eventData.eventId}`
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/') && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return clients.openWindow(url)
    })
  )
})
