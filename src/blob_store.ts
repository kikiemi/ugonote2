export type blob_store_t = { parts: { position: number, data: Blob }[], size: number, limit: number }

export function blob_store(limit: number): blob_store_t {
  return { parts: [], size: 0, limit }
}

export function blob_store_write(store: blob_store_t, data: Uint8Array<ArrayBuffer>, position: number): void {
  const end = position + data.byteLength
  if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(end) || end > store.limit) throw new Error('出力データが大きすぎます。範囲か書き出す大きさを小さくしてください')
  if (!data.byteLength) return
  const part = { position, data: new Blob([data]) }
  if (position === store.size) store.parts.push(part)
  else {
    const parts: blob_store_t['parts'] = []
    for (const old of store.parts) {
      const old_end = old.position + old.data.size
      if (old_end <= position || old.position >= end) parts.push(old)
      else {
        if (old.position < position) parts.push({ position: old.position, data: old.data.slice(0, position - old.position) })
        if (old_end > end) parts.push({ position: end, data: old.data.slice(end - old.position) })
      }
    }
    parts.push(part)
    parts.sort((a, b) => a.position - b.position)
    store.parts = parts
  }
  store.size = Math.max(store.size, end)
}

export function blob_store_finish(store: blob_store_t, type: string): Blob {
  const parts: BlobPart[] = []
  let position = 0
  for (const part of store.parts) {
    if (part.position > position) parts.push(new Uint8Array(part.position - position))
    parts.push(part.data)
    position = part.position + part.data.size
  }
  const blob = new Blob(parts, { type })
  store.parts.length = 0
  return blob
}
