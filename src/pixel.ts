const RAW_FLAG = 0x80000000

export function rle_pack(src: Uint32Array): Uint32Array {
  const n = src.length
  let runs = 0
  let i = 0
  while (i < n) {
    const v = src[i]
    let j = i + 1
    while (j < n && src[j] === v) j++
    runs++
    i = j
  }
  if (runs * 2 + 1 >= n + 1) {
    const out = new Uint32Array(n + 1)
    out[0] = (n >>> 0) | RAW_FLAG
    out.set(src, 1)
    return out
  }
  const out = new Uint32Array(runs * 2 + 1)
  out[0] = n >>> 0
  let k = 1
  i = 0
  while (i < n) {
    const v = src[i]
    let j = i + 1
    while (j < n && src[j] === v) j++
    out[k++] = j - i
    out[k++] = v
    i = j
  }
  return out
}

export function rle_unpack(pk: Uint32Array, dst: Uint32Array): number {
  if (pk.length < 1) return -1
  const head = pk[0]
  const n = head & 0x7fffffff
  if (n > dst.length) return -1
  if (head & RAW_FLAG) {
    if (pk.length !== n + 1) return -1
    dst.set(pk.subarray(1, 1 + n), 0)
    return n
  }
  if ((pk.length & 1) === 0) return -1
  let di = 0
  for (let k = 1; k < pk.length; k += 2) {
    const cnt = pk[k]
    const v = pk[k + 1]
    if (cnt === 0 || cnt > n - di) return -1
    dst.fill(v, di, di + cnt)
    di += cnt
  }
  return di === n ? di : -1
}

export function rle_len(pk: Uint32Array): number {
  return pk.length ? pk[0] & 0x7fffffff : 0
}

export type PixelRect = { x: number, y: number, w: number, h: number }
export type PixelCrop = PixelRect & { pixels: Uint32Array }

export function pixel_valid(pk: Uint32Array, count: number): number {
  if (!pk.length || (pk[0] & 0x7fffffff) !== count) return 0
  if (pk[0] & RAW_FLAG) return pk.length === count + 1 ? 1 : 0
  if (!(pk.length & 1)) return 0
  let at = 0
  for (let i = 1; i < pk.length; i += 2) {
    const n = pk[i]
    if (!n || n > count - at) return 0
    at += n
  }
  return at === count ? 1 : 0
}

function pixels_visible(src: Uint32Array): number {
  for (let i = 0; i < src.length; i++) if (src[i] >>> 24) return 1
  return 0
}

export function pixel_patch(pk: Uint32Array | null, w: number, h: number, x: number, y: number, rw: number, rh: number, pixels: Uint32Array): Uint32Array | null {
  const count = w * h
  if (!Number.isInteger(w) || !Number.isInteger(h) || !Number.isInteger(rw) || !Number.isInteger(rh) || !Number.isInteger(x) || !Number.isInteger(y) || w < 1 || h < 1 || rw < 1 || rh < 1 || x < 0 || y < 0 || x + rw > w || y + rh > h || pixels.length !== rw * rh) throw new RangeError('Invalid pixel rectangle')
  if (pk && !pixel_valid(pk, count)) throw new RangeError('Invalid packed pixels')
  if (rw === w && rh === h) return pixels_visible(pixels) ? rle_pack(pixels) : null
  if (pk && (pk[0] & RAW_FLAG)) {
    const out = pk.slice()
    for (let row = 0; row < rh; row++) out.set(pixels.subarray(row * rw, (row + 1) * rw), 1 + (row + y) * w + x)
    return pixels_visible(out.subarray(1)) ? out : null
  }
  const out = new Uint32Array(Math.min(count + 1, (pk?.length || 3) + pixels.length * 2 + rh * 4))
  out[0] = count
  let used = 1
  let visible = 0
  let overflow = 0
  function emit(n: number, value: number): void {
    if (!n || overflow) return
    if (value >>> 24) visible = 1
    if (used > 1 && out[used - 1] === value) { out[used - 2] += n; return }
    if (used + 2 > out.length) { overflow = 1; return }
    out[used++] = n
    out[used++] = value
  }
  let run = 1
  let remain = pk ? pk[1] : count
  let value = pk ? pk[2] : 0
  let at = 0
  function take(n: number, keep: number): void {
    while (n > 0) {
      const amount = Math.min(n, remain)
      if (keep) emit(amount, value)
      at += amount
      n -= amount
      remain -= amount
      if (!remain && pk && at < count) { run += 2; remain = pk[run]; value = pk[run + 1] }
    }
  }
  for (let row = 0; row < rh; row++) {
    const start = (y + row) * w + x
    take(start - at, 1)
    take(rw, 0)
    const end = (row + 1) * rw
    for (let i = row * rw; i < end;) {
      const v = pixels[i]
      let next = i + 1
      while (next < end && pixels[next] === v) next++
      emit(next - i, v)
      i = next
    }
  }
  take(count - at, 1)
  if (overflow) {
    const raw = new Uint32Array(count)
    if (pk) rle_unpack(pk, raw)
    for (let row = 0; row < rh; row++) raw.set(pixels.subarray(row * rw, (row + 1) * rw), (y + row) * w + x)
    return pixels_visible(raw) ? rle_pack(raw) : null
  }
  return visible ? out.slice(0, used) : null
}

export function pixel_crop(pk: Uint32Array | null, w: number, h: number): PixelCrop | null {
  if (!pk || !pixel_valid(pk, w * h)) return null
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  const raw = pk[0] & RAW_FLAG
  function bounds(start: number, end: number): void {
    const first = Math.floor(start / w)
    const last = Math.floor((end - 1) / w)
    x0 = Math.min(x0, first === last ? start % w : 0)
    x1 = Math.max(x1, first === last ? (end - 1) % w : w - 1)
    y0 = Math.min(y0, first)
    y1 = Math.max(y1, last)
  }
  if (raw) {
    for (let i = 1; i < pk.length; i++) if (pk[i] >>> 24) bounds(i - 1, i)
  } else {
    let at = 0
    for (let i = 1; i < pk.length; i += 2) {
      if (pk[i + 1] >>> 24) bounds(at, at + pk[i])
      at += pk[i]
    }
  }
  if (x1 < x0) return null
  const cw = x1 - x0 + 1
  const ch = y1 - y0 + 1
  const pixels = new Uint32Array(cw * ch)
  if (raw) {
    for (let row = 0; row < ch; row++) pixels.set(pk.subarray(1 + (row + y0) * w + x0, 1 + (row + y0) * w + x0 + cw), row * cw)
  } else {
    let at = 0
    for (let i = 1; i < pk.length; i += 2) {
      const end = at + pk[i]
      if (pk[i + 1] >>> 24) {
        const first = Math.max(y0, Math.floor(at / w))
        const last = Math.min(y1, Math.floor((end - 1) / w))
        for (let row = first; row <= last; row++) {
          const startX = Math.max(x0, at - row * w)
          const endX = Math.min(x1 + 1, end - row * w)
          if (endX > startX) pixels.fill(pk[i + 1], (row - y0) * cw + startX - x0, (row - y0) * cw + endX - x0)
        }
      }
      at = end
    }
  }
  return { x: x0, y: y0, w: cw, h: ch, pixels }
}

export function pixel_at(pk: Uint32Array | null, index: number): number {
  if (!pk || !Number.isInteger(index) || index < 0 || index >= (pk[0] & 0x7fffffff)) return 0
  if (pk[0] & RAW_FLAG) return pk[index + 1]
  let end = 0
  for (let i = 1; i < pk.length; i += 2) { end += pk[i]; if (index < end) return pk[i + 1] }
  return 0
}
