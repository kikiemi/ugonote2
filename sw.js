const cache_prefix = 'ugonote2-'
const cache_name = cache_prefix + 'v1'
const core_assets = [
  './',
  './index.html',
  './style.css',
  './assets/rounded.woff',
  './assets/dot.woff2',
  './assets/memo.woff2',
  './assets/font-LICENSE.txt',
  './assets/library_licenses.txt',
  './dist/app.js',
  './dist/worker.js',
  './manifest.webmanifest',
  './icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
]

function report_warning(context, error) {
  console.warn('[ugonote2] ' + context, error)
}

async function install_cache() {
  try {
    const cache = await caches.open(cache_name)
    await cache.addAll(core_assets).catch(error => report_warning('オフライン用ファイルの準備に失敗しました', error))
    await self.skipWaiting()
  } catch (error) {
    report_warning('オフライン用ファイルの準備に失敗しました', error)
    throw error
  }
}

async function activate_cache() {
  await self.clients.claim()
}

async function cache_response(request, response) {
  try {
    const cache = await caches.open(cache_name)
    await cache.put(request, response)
  } catch (error) {
    report_warning('取得したファイルをキャッシュできませんでした', error)
  }
}

async function cache_first(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok) void cache_response(request, response.clone())
    return response
  } catch (error) {
    report_warning('ネットワーク取得にもキャッシュ取得にも失敗しました', error)
    return new Response('', { status: 200, headers: { 'Content-Type': 'text/plain' } })
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
  event.respondWith(cache_first(request))
})
