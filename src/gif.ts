import { task_yield } from './task_queue'
import { binary_writer, writer_bytes, writer_finish, writer_u8, writer_u16, type binary_writer_t } from './binary'

type box_t = { px: number[], rmin: number, rmax: number, gmin: number, gmax: number, bmin: number, bmax: number }

function box_bounds(b: box_t): void {
  b.rmin = 255
  b.rmax = 0
  b.gmin = 255
  b.gmax = 0
  b.bmin = 255
  b.bmax = 0
  for (const c of b.px) {
    const r = (c >> 16) & 255
    const g = (c >> 8) & 255
    const bl = c & 255
    if (r < b.rmin) b.rmin = r
    if (r > b.rmax) b.rmax = r
    if (g < b.gmin) b.gmin = g
    if (g > b.gmax) b.gmax = g
    if (bl < b.bmin) b.bmin = bl
    if (bl > b.bmax) b.bmax = bl
  }
}

function median_cut(colors: number[], n: number): number[] {
  const first: box_t = { px: colors, rmin: 0, rmax: 0, gmin: 0, gmax: 0, bmin: 0, bmax: 0 }
  box_bounds(first)
  const boxes: box_t[] = [first]
  while (boxes.length < n) {
    let bi = -1
    let best = -1
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]
      if (b.px.length < 2) continue
      const span = Math.max(b.rmax - b.rmin, b.gmax - b.gmin, b.bmax - b.bmin)
      if (span > best) {
        best = span
        bi = i
      }
    }
    if (bi < 0) break
    const b = boxes[bi]
    const rs = b.rmax - b.rmin
    const gs = b.gmax - b.gmin
    const bs = b.bmax - b.bmin
    const shift = gs >= rs && gs >= bs ? 8 : rs >= bs ? 16 : 0
    b.px.sort((a, c) => ((a >> shift) & 255) - ((c >> shift) & 255))
    const mid = b.px.length >> 1
    const left: box_t = { px: b.px.slice(0, mid), rmin: 0, rmax: 0, gmin: 0, gmax: 0, bmin: 0, bmax: 0 }
    const right: box_t = { px: b.px.slice(mid), rmin: 0, rmax: 0, gmin: 0, gmax: 0, bmin: 0, bmax: 0 }
    box_bounds(left)
    box_bounds(right)
    boxes.splice(bi, 1, left, right)
  }
  const pal: number[] = []
  for (const b of boxes) {
    let r = 0
    let g = 0
    let bl = 0
    for (const c of b.px) {
      r += (c >> 16) & 255
      g += (c >> 8) & 255
      bl += c & 255
    }
    const cnt = Math.max(1, b.px.length)
    pal.push(((Math.round(r / cnt) & 255) << 16) | ((Math.round(g / cnt) & 255) << 8) | (Math.round(bl / cnt) & 255))
  }
  return pal
}

type palette_state_t = { seen: Set<number>, exact: Set<number>, sample: number[] }

function palette_state(): palette_state_t {
  return { seen: new Set(), exact: new Set(), sample: [] }
}

function palette_add(state: palette_state_t, image: ImageData): void {
  const d = image.data
  for (let i = 0; i < d.length; i += 16) {
    const color = ((d[i] & 0xf8) << 16) | ((d[i + 1] & 0xf8) << 8) | (d[i + 2] & 0xf8)
    if (!state.seen.has(color)) { state.seen.add(color); state.sample.push((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) }
    else if (state.sample.length < 200000) state.sample.push((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
  }
  if (state.exact.size <= 256) for (let i = 0; i < d.length; i += 4) {
    state.exact.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
    if (state.exact.size > 256) break
  }
}

function palette_finish(state: palette_state_t): number[] {
  return state.exact.size <= 256 ? Array.from(state.exact) : median_cut(state.sample, 256)
}

const bayer4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

export function gif_index_frame(img: ImageData, pal: number[], dither: number): Uint8Array {
  const w = img.width
  const h = img.height
  const d = img.data
  const out = new Uint8Array(w * h)
  const cache = new Map<number, number>()
  const nearest = (r: number, g: number, b: number): number => {
    const key = (r << 16) | (g << 8) | b
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    let bi = 0
    let bd = 1e9
    for (let i = 0; i < pal.length; i++) {
      const p = pal[i]
      const dr = r - ((p >> 16) & 255)
      const dg = g - ((p >> 8) & 255)
      const db = b - (p & 255)
      const dist = dr * dr * 2 + dg * dg * 4 + db * db
      if (dist < bd) {
        bd = dist
        bi = i
      }
    }
    if (cache.size < 65536) cache.set(key, bi)
    return bi
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let r = d[i]
      let g = d[i + 1]
      let b = d[i + 2]
      if (dither) {
        const t = (bayer4[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 24
        r = Math.max(0, Math.min(255, r + t))
        g = Math.max(0, Math.min(255, g + t))
        b = Math.max(0, Math.min(255, b + t))
      }
      out[y * w + x] = nearest(r | 0, g | 0, b | 0)
    }
  }
  return out
}

function lzw_encode(w: binary_writer_t, idx: Uint8Array, min_code: number): void {
  writer_u8(w, min_code)
  const clear = 1 << min_code
  const eoi = clear + 1
  let code_size = min_code + 1
  let next = eoi + 1
  let table = new Map<number, number>()
  let bit_buf = 0
  let bit_cnt = 0
  const block = new Uint8Array(255)
  let block_len = 0
  const flush_block = () => {
    if (block_len === 0) return
    writer_u8(w, block_len)
    writer_bytes(w, block.subarray(0, block_len))
    block_len = 0
  }
  const put_byte = (b: number) => {
    block[block_len++] = b
    if (block_len === 255) flush_block()
  }
  const put_code = (c: number) => {
    bit_buf |= c << bit_cnt
    bit_cnt += code_size
    while (bit_cnt >= 8) {
      put_byte(bit_buf & 255)
      bit_buf >>= 8
      bit_cnt -= 8
    }
  }
  put_code(clear)
  let prefix = idx[0]
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i]
    const key = (prefix << 8) | k
    const hit = table.get(key)
    if (hit !== undefined) {
      prefix = hit
      continue
    }
    put_code(prefix)
    if (next === 4096) {
      put_code(clear)
      table = new Map<number, number>()
      next = eoi + 1
      code_size = min_code + 1
    } else {
      if (next >= 1 << code_size) code_size++
      table.set(key, next)
      next++
    }
    prefix = k
  }
  put_code(prefix)
  put_code(eoi)
  if (bit_cnt > 0) put_byte(bit_buf & 255)
  flush_block()
  writer_u8(w, 0)
}

export async function gif_stream(w0: number, h0: number, count: number, read: (index: number) => ImageData | Promise<ImageData>, fps: number, holds: number[], dither: number, on_progress: (p: number) => void, budget = 128 << 20): Promise<Uint8Array> {
  const state = palette_state()
  for (let index = 0; index < count; index++) {
    palette_add(state, await read(index))
    on_progress((index + 1) / count * 0.35)
    await task_yield()
  }
  const pal = palette_finish(state)
  while (pal.length < 2) pal.push(0)
  let pal_bits = 1
  while (1 << pal_bits < pal.length) pal_bits++
  const pal_size = 1 << pal_bits
  const wtr = binary_writer(Math.min(1 << 20, budget))
  wtr.limit = budget
  writer_bytes(wtr, new TextEncoder().encode('GIF89a'))
  writer_u16(wtr, w0)
  writer_u16(wtr, h0)
  writer_u8(wtr, 0x80 | 0x70 | (pal_bits - 1))
  writer_u8(wtr, 0)
  writer_u8(wtr, 0)
  for (let i = 0; i < pal_size; i++) {
    const c = i < pal.length ? pal[i] : 0
    writer_u8(wtr, (c >> 16) & 255)
    writer_u8(wtr, (c >> 8) & 255)
    writer_u8(wtr, c & 255)
  }
  writer_u8(wtr, 0x21)
  writer_u8(wtr, 0xff)
  writer_u8(wtr, 11)
  writer_bytes(wtr, new TextEncoder().encode('NETSCAPE2.0'))
  writer_u8(wtr, 3)
  writer_u8(wtr, 1)
  writer_u16(wtr, 0)
  writer_u8(wtr, 0)
  const min_code = Math.max(2, pal_bits)
  let i = 0
  let emitted_cs = 0
  let tick = 0
  while (i < count) {
    const t0 = performance.now()
    while (i < count && performance.now() - t0 < 12) {
      tick += holds[i] || 1
      const target_cs = Math.round((tick * 100) / fps)
      const delay = Math.max(1, target_cs - emitted_cs)
      emitted_cs += delay
      writer_u8(wtr, 0x21)
      writer_u8(wtr, 0xf9)
      writer_u8(wtr, 4)
      writer_u8(wtr, 0x04)
      writer_u16(wtr, delay)
      writer_u8(wtr, 0)
      writer_u8(wtr, 0)
      writer_u8(wtr, 0x2c)
      writer_u16(wtr, 0)
      writer_u16(wtr, 0)
      writer_u16(wtr, w0)
      writer_u16(wtr, h0)
      writer_u8(wtr, 0)
      lzw_encode(wtr, gif_index_frame(await read(i), pal, dither), min_code)
      i++
    }
    on_progress(0.35 + i / count * 0.65)
    if (i < count) await task_yield()
  }
  writer_u8(wtr, 0x3b)
  return writer_finish(wtr)
}
