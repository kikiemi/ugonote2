export type ByteCache<K, V> = { items: Map<K, { value: V, bytes: number }>, bytes: number, dispose: (value: V) => void }
export type MemoryUse = 'raster' | 'effects' | 'onion' | 'thumb' | 'history'

export function memory_budget(mobile: number, use: MemoryUse): number {
  const device = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || (mobile ? 2 : 4)
  const total = Math.max(48, Math.min(mobile ? 128 : 320, device * 32)) * 1048576
  const parts = { raster: 0.25, effects: 0.2, onion: 0.1, thumb: 0.05, history: 0.4 }
  return Math.floor(total * parts[use])
}

export function cache_make<K, V>(dispose: (value: V) => void): ByteCache<K, V> {
  return { items: new Map(), bytes: 0, dispose }
}

export function cache_get<K, V>(cache: ByteCache<K, V>, key: K): V | null {
  const item = cache.items.get(key)
  if (!item) return null
  cache.items.delete(key)
  cache.items.set(key, item)
  return item.value
}

export function cache_drop<K, V>(cache: ByteCache<K, V>, key: K): void {
  const item = cache.items.get(key)
  if (!item) return
  cache.items.delete(key)
  cache.bytes -= item.bytes
  cache.dispose(item.value)
}

export function cache_trim<K, V>(cache: ByteCache<K, V>, budget: number): void {
  while (cache.bytes > budget && cache.items.size) cache_drop(cache, cache.items.keys().next().value as K)
}

export function cache_put<K, V>(cache: ByteCache<K, V>, key: K, value: V, bytes: number, budget: number): number {
  cache_drop(cache, key)
  if (bytes > budget) return 0
  cache_trim(cache, budget - bytes)
  cache.items.set(key, { value, bytes })
  cache.bytes += bytes
  return 1
}

export function cache_clear<K, V>(cache: ByteCache<K, V>): void {
  for (const key of cache.items.keys()) cache_drop(cache, key)
}
