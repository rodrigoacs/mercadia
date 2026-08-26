const CACHE_NAME = 'mercadia-v1'
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/ui.js',
  '/charts.js',
  '/inventory.js',
  '/utils.js',
  '/site.webmanifest',
  '/favicon.svg'
]

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)))
})

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('/api/')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const resClone = res.clone()
          caches.open('mercadia-api').then((c) => c.put(e.request, resClone))
          return res
        })
        .catch(() => caches.match(e.request))
    )
  } else {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)))
  }
})