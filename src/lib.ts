import { binary_writer, writer_bytes, writer_finish, writer_u16, writer_u32 } from './binary'

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function hex_rgb(hex: string): [number, number, number] {
  let h = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h, 16) | 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgb_hex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()
}

export function canvas_make(w: number, h: number, read = 0): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const x = c.getContext('2d', read ? { willReadFrequently: true } : undefined) as CanvasRenderingContext2D
  x.imageSmoothingEnabled = false
  return [c, x]
}

export function canvas_to_blob(canvas: HTMLCanvasElement, type: string, quality: number | undefined, cb: (blob: Blob | null, error: unknown | null) => void): void {
  let completed = 0
  const finish = (blob: Blob | null, error: unknown | null): void => {
    if (completed) return
    completed = 1
    cb(blob, error)
  }
  try {
    canvas.toBlob(blob => finish(blob, blob ? null : new Error('Canvas.toBlob returned null')), type, quality)
  } catch (error) {
    finish(null, error)
  }
}

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

export function wav_encode(ch: Float32Array[], rate: number): ArrayBuffer {
  const nch = ch.length
  const n = ch[0].length
  const w = binary_writer(44 + n * nch * 2)
  writer_bytes(w, new TextEncoder().encode('RIFF'))
  writer_u32(w, 36 + n * nch * 2)
  writer_bytes(w, new TextEncoder().encode('WAVEfmt '))
  writer_u32(w, 16)
  writer_u16(w, 1)
  writer_u16(w, nch)
  writer_u32(w, rate)
  writer_u32(w, rate * nch * 2)
  writer_u16(w, nch * 2)
  writer_u16(w, 16)
  writer_bytes(w, new TextEncoder().encode('data'))
  writer_u32(w, n * nch * 2)
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      let s = ch[c][i]
      s = s < -1 ? -1 : s > 1 ? 1 : s
      writer_u16(w, (s < 0 ? s * 0x8000 : s * 0x7fff) & 0xffff)
    }
  }
  const out = writer_finish(w)
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
}

export function download_blob(blob: Blob, name: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

export function pad2(n: number): string {
  return n < 10 ? '0' + n : '' + n
}

let file_pick_input: HTMLInputElement | null = null

function file_pick_accept(accept: string): string {
  const entries = accept.split(',').map(entry => entry.trim()).filter(entry => entry.length > 0)
  if (!entries.length) return ''
  for (const entry of entries) if (entry.charCodeAt(0) !== 46) return entries.join(',')
  return ''
}

function file_pick_dispose(input: HTMLInputElement): void {
  if (file_pick_input === input) file_pick_input = null
  input.remove()
}

export function file_pick(accept: string, cb: (f: File) => void): void {
  if (file_pick_input) file_pick_dispose(file_pick_input)
  const input = document.createElement('input')
  const filter = file_pick_accept(accept)
  input.type = 'file'
  if (filter) input.accept = filter
  input.tabIndex = -1
  input.setAttribute('aria-hidden', 'true')
  input.style.position = 'fixed'
  input.style.left = '-10000px'
  input.style.top = '0'
  input.style.width = '1px'
  input.style.height = '1px'
  input.style.opacity = '0'
  document.body.appendChild(input)
  file_pick_input = input
  let settled = 0
  const finish = (file: File | null): void => {
    if (settled) return
    settled = 1
    file_pick_dispose(input)
    if (file) cb(file)
  }
  input.addEventListener('change', () => finish(input.files && input.files[0] ? input.files[0] : null), { once: true })
  input.addEventListener('cancel', () => finish(null), { once: true })
  try {
    input.click()
  } catch {
    finish(null)
  }
}
