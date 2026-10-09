import { binary_writer, writer_bytes, writer_finish, writer_u8, writer_u16, type BinaryWriter } from './binary'

type Box = { px: number[], rmin: number, rmax: number, gmin: number, gmax: number, bmin: number, bmax: number }

function box_bounds(b: Box): void {
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
  const first: Box = { px: colors, rmin: 0, rmax: 0, gmin: 0, gmax: 0, bmin: 0, bmax: 0 }
  box_bounds(first)
  const boxes: Box[] = [first]
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
    const left: Box = { px: b.px.slice(0, mid), rmin: 0, rmax: 0, gmin: 0, gmax: 0, bmin: 0, bmax: 0 }
    const right: Box = { px: b.px.slice(mid), rmin: 0, rmax: 0, gmin: 0, gmax: 0, bmin: 0, bmax: 0 }
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

export function gif_palette(frames: ImageData[]): number[] {
  const seen = new Set<number>()
  const sample: number[] = []
  for (const f of frames) {
    const d = f.data
    for (let i = 0; i < d.length; i += 16) {
      const c = ((d[i] & 0xf8) << 16) | ((d[i + 1] & 0xf8) << 8) | (d[i + 2] & 0xf8)
      if (!seen.has(c)) {
        seen.add(c)
        sample.push((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
      } else if (sample.length < 200000) sample.push((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
    }
  }
  if (seen.size <= 256) {
    const exact = new Set<number>()
    for (const f of frames) {
      const d = f.data
      for (let i = 0; i < d.length; i += 4) {
        exact.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
        if (exact.size > 256) break
      }
      if (exact.size > 256) break
    }
    if (exact.size <= 256) return Array.from(exact)
  }
  return median_cut(sample, 256)
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

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
    cache.set(key, bi)
    return bi
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let r = d[i]
      let g = d[i + 1]
      let b = d[i + 2]
      if (dither) {
        const t = (BAYER4[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 24
        r = Math.max(0, Math.min(255, r + t))
        g = Math.max(0, Math.min(255, g + t))
        b = Math.max(0, Math.min(255, b + t))
      }
      out[y * w + x] = nearest(r | 0, g | 0, b | 0)
    }
  }
  return out
}

function lzw_encode(w: BinaryWriter, idx: Uint8Array, minCode: number): void {
  writer_u8(w, minCode)
  const CLEAR = 1 << minCode
  const EOI = CLEAR + 1
  let codeSize = minCode + 1
  let next = EOI + 1
  let table = new Map<number, number>()
  let bitBuf = 0
  let bitCnt = 0
  const block = new Uint8Array(255)
  let blockLen = 0
  const flush_block = () => {
    if (blockLen === 0) return
    writer_u8(w, blockLen)
    writer_bytes(w, block.subarray(0, blockLen))
    blockLen = 0
  }
  const put_byte = (b: number) => {
    block[blockLen++] = b
    if (blockLen === 255) flush_block()
  }
  const put_code = (c: number) => {
    bitBuf |= c << bitCnt
    bitCnt += codeSize
    while (bitCnt >= 8) {
      put_byte(bitBuf & 255)
      bitBuf >>= 8
      bitCnt -= 8
    }
  }
  put_code(CLEAR)
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
      put_code(CLEAR)
      table = new Map<number, number>()
      next = EOI + 1
      codeSize = minCode + 1
    } else {
      if (next >= 1 << codeSize) codeSize++
      table.set(key, next)
      next++
    }
    prefix = k
  }
  put_code(prefix)
  put_code(EOI)
  if (bitCnt > 0) put_byte(bitBuf & 255)
  flush_block()
  writer_u8(w, 0)
}

export function gif_encode(frames: ImageData[], fps: number, holds: number[], dither: number, onProgress: (p: number) => void, done: (bytes: Uint8Array) => void): void {
  const w0 = frames[0].width
  const h0 = frames[0].height
  const pal = gif_palette(frames)
  while (pal.length < 2) pal.push(0)
  let palBits = 1
  while (1 << palBits < pal.length) palBits++
  const palSize = 1 << palBits
  const wtr = binary_writer(1 << 20)
  writer_bytes(wtr, new TextEncoder().encode('GIF89a'))
  writer_u16(wtr, w0)
  writer_u16(wtr, h0)
  writer_u8(wtr, 0x80 | 0x70 | (palBits - 1))
  writer_u8(wtr, 0)
  writer_u8(wtr, 0)
  for (let i = 0; i < palSize; i++) {
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
  const minCode = Math.max(2, palBits)
  let i = 0
  let emittedCs = 0
  const step = () => {
    const t0 = performance.now()
    while (i < frames.length && performance.now() - t0 < 24) {
      let tick = 0
      for (let k = 0; k <= i; k++) tick += holds[k] || 1
      const targetCs = Math.round((tick * 100) / fps)
      const delay = Math.max(1, targetCs - emittedCs)
      emittedCs += delay
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
      lzw_encode(wtr, gif_index_frame(frames[i], pal, dither), minCode)
      i++
    }
    onProgress(i / frames.length)
    if (i < frames.length) {
      setTimeout(step, 0)
      return
    }
    writer_u8(wtr, 0x3b)
    done(writer_finish(wtr))
  }
  step()
}
