export type byte_cache_t<k, v> = { items: Map<k, { value: v, bytes: number }>, bytes: number, dispose: (value: v) => void }
export type memory_use_t = 'raster' | 'effects' | 'onion' | 'thumb' | 'history'

export function memory_budget(mobile: number, use: memory_use_t): number {
  const device = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || (mobile ? 2 : 4)
  const total = Math.max(48, Math.min(mobile ? 128 : 320, device * 32)) * 1048576
  const parts = { raster: 0.25, effects: 0.2, onion: 0.1, thumb: 0.05, history: 0.4 }
  return Math.floor(total * parts[use])
}

export function cache_make<k, v>(dispose: (value: v) => void): byte_cache_t<k, v> {
  return { items: new Map(), bytes: 0, dispose }
}

export function cache_get<k, v>(cache: byte_cache_t<k, v>, key: k): v | null {
  const item = cache.items.get(key)
  if (!item) return null
  cache.items.delete(key)
  cache.items.set(key, item)
  return item.value
}

export function cache_drop<k, v>(cache: byte_cache_t<k, v>, key: k): void {
  const item = cache.items.get(key)
  if (!item) return
  cache.items.delete(key)
  cache.bytes -= item.bytes
  cache.dispose(item.value)
}

export function cache_trim<k, v>(cache: byte_cache_t<k, v>, budget: number): void {
  while (cache.bytes > budget && cache.items.size) cache_drop(cache, cache.items.keys().next().value as k)
}

export function cache_put<k, v>(cache: byte_cache_t<k, v>, key: k, value: v, bytes: number, budget: number): number {
  cache_drop(cache, key)
  if (bytes > budget) return 0
  cache_trim(cache, budget - bytes)
  cache.items.set(key, { value, bytes })
  cache.bytes += bytes
  return 1
}

export function cache_clear<k, v>(cache: byte_cache_t<k, v>): void {
  for (const key of cache.items.keys()) cache_drop(cache, key)
}

export function memory_work_budget(mobile = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 ? 1 : 0): number {
  const device = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory || (mobile ? 2 : 4) : 2
  return Math.max(64, Math.min(mobile ? 128 : 384, device * 64)) * 1048576
}

export function memory_check(bytes: number, budget: number): void {
  if (!Number.isFinite(bytes) || bytes < 0 || bytes > budget) throw new Error('メモリ使用量を抑えるため処理を中止しました。範囲か画像の大きさを小さくしてください')
}
