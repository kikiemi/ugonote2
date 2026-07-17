const CACHE_NAME = 'ug2-3.3.3'
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './dist/app.js',
  './dist/worker.js',
  './manifest.webmanifest',
  './icon.svg',
]

function report_warning(context, error) {
  console.warn('[ugonote2] ' + context, error)
}

async function install_cache() {
  try {
    const cache = await caches.open(CACHE_NAME)
    await cache.addAll(CORE_ASSETS)
    await self.skipWaiting()
  } catch (error) {
    report_warning('オフライン用ファイルの準備に失敗しました', error)
    throw error
  }
}

async function activate_cache() {
  try {
    const names = await caches.keys()
    await Promise.all(names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name)))
    await self.clients.claim()
  } catch (error) {
    report_warning('古いキャッシュの整理に失敗しました', error)
    throw error
  }
}

async function cache_response(request, response) {
  try {
    const cache = await caches.open(CACHE_NAME)
    await cache.put(request, response)
  } catch (error) {
    report_warning('取得したファイルをキャッシュできませんでした', error)
  }
}

async function network_first(request) {
  try {
    const response = await fetch(request)
    if (response.ok) void cache_response(request, response.clone())
    return response
  } catch (error) {
    const cached = await caches.match(request)
    if (cached) return cached
    if (request.mode === 'navigate') {
      const shell = await caches.match('./index.html')
      if (shell) return shell
    }
    report_warning('ネットワーク取得にもキャッシュ取得にも失敗しました', error)
    throw error
  }
}

self.addEventListener('install', event => {
  event.waitUntil(install_cache())
})

self.addEventListener('activate', event => {
  event.waitUntil(activate_cache())
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  if (new URL(request.url).origin !== location.origin) return
  event.respondWith(network_first(request))
})
