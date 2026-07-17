import { report_warning } from '../diagnostics'
import { kwz_adpcm_decode } from './adpcm'
import { bytes_to_hex, unix_from_nintendo_ts } from './fname'
import { KWZ_H, KWZ_W } from './kwz'

function utf16_str(b: Uint8Array, ptr: number, chars: number): string {
  let s = ''
  for (let i = 0; i < chars; i++) {
    const c = b[ptr + i * 2] | (b[ptr + i * 2 + 1] << 8)
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s
}

function ascii_str(b: Uint8Array, ptr: number, n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) {
    const c = b[ptr + i]
    if (c === 0) break
    if (c >= 0x20 && c < 0x7f) s += String.fromCharCode(c)
  }
  return s
}

export type FlipMeta = {
  created: number
  modified: number
  app_ver: number
  root_id: string
  parent_id: string
  cur_id: string
  root_name: string
  parent_name: string
  cur_name: string
  root_fn: string
  parent_fn: string
  cur_fn: string
  lock: number
  flags: number
  layer_flags: number
  edits: number
}

export function flip_meta_zero(): FlipMeta {
  return { created: 0, modified: 0, app_ver: 0, root_id: '', parent_id: '', cur_id: '', root_name: '', parent_name: '', cur_name: '', root_fn: '', parent_fn: '', cur_fn: '', lock: 0, flags: 0, layer_flags: 0, edits: 0 }
}

export type KwzDecoded = {
  meta: FlipMeta
  w: number
  h: number
  frameCount: number
  fps: number
  speed: number
  loop: number
  paper: number[]
  frameColors: number[][]
  layerDepths: number[][]
  thumbIdx: number
  layers: Uint8Array[][]
  seFlags: number[]
  bgm: Int16Array | null
  bgmRate: number
  bgmFps: number
  se: (Int16Array | null)[]
}

const FPS_TABLE = [0.2, 0.5, 1, 2, 4, 6, 8, 12, 20, 24, 30]

let LINE_LUT: Uint8Array | null = null
function line_lut(): Uint8Array {
  if (LINE_LUT) return LINE_LUT
  const lut = new Uint8Array(6561 * 8)
  const tmp = new Uint8Array(8)
  for (let idx = 0; idx < 6561; idx++) {
    let v = idx
    const m1 = (v / 2187) | 0
    v -= m1 * 2187
    const m0 = (v / 729) | 0
    v -= m0 * 729
    const m3 = (v / 243) | 0
    v -= m3 * 243
    const m2 = (v / 81) | 0
    v -= m2 * 81
    const m5 = (v / 27) | 0
    v -= m5 * 27
    const m4 = (v / 9) | 0
    v -= m4 * 9
    const m7 = (v / 3) | 0
    v -= m7 * 3
    const m6 = v
    tmp[0] = m0
    tmp[1] = m1
    tmp[2] = m2
    tmp[3] = m3
    tmp[4] = m4
    tmp[5] = m5
    tmp[6] = m6
    tmp[7] = m7
    lut.set(tmp, idx * 8)
  }
  LINE_LUT = lut
  return lut
}

let LINE_LUT_S: Uint8Array | null = null
function line_lut_s(): Uint8Array {
  if (LINE_LUT_S) return LINE_LUT_S
  const base = line_lut()
  const s = new Uint8Array(6561 * 8)
  for (let idx = 0; idx < 6561; idx++) {
    const o = idx * 8
    for (let i = 0; i < 8; i++) s[o + i] = base[o + ((i + 1) & 7)]
  }
  LINE_LUT_S = s
  return s
}

const COMMON = [
  0x0000, 0x0cd0, 0x19a0, 0x02d9, 0x088b, 0x0051, 0x00f3, 0x0009, 0x001b, 0x0001, 0x0003, 0x05b2, 0x1116, 0x00a2, 0x01e6, 0x0012, 0x0036, 0x0002, 0x0006,
  0x0b64, 0x08dc, 0x0144, 0x00fc, 0x0024, 0x001c, 0x0004, 0x0334, 0x099c, 0x0668, 0x1338, 0x1004, 0x166c,
]

type Br16 = { bytes: Uint8Array, pos: number, buf: number, cnt: number }

function br_make(bytes: Uint8Array, start: number): Br16 {
  return { bytes, pos: start, buf: 0, cnt: 0 }
}

function br_read(r: Br16, n: number): number {
  while (r.cnt < n) {
    const lo = r.bytes[r.pos] || 0
    const hi = r.bytes[r.pos + 1] || 0
    r.pos += 2
    r.buf |= (lo | (hi << 8)) << r.cnt
    r.cnt += 16
  }
  const val = r.buf & ((1 << n) - 1)
  r.buf >>>= n
  r.cnt -= n
  return val
}

function dv_u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8)
}
function dv_u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
}

function decode_layer(bytes: Uint8Array, start: number, dst: Uint8Array): void {
  const lut = line_lut()
  const lutS = line_lut_s()
  const r = br_make(bytes, start)
  const put = (x: number, y: number, row: number, idx: number, shifted: number) => {
    const t = shifted ? lutS : lut
    const base = (y + row) * KWZ_W + x
    const lo = idx * 8
    for (let i = 0; i < 8; i++) dst[base + i] = t[lo + i]
  }
  let skip = 0
  for (let ly = 0; ly < KWZ_H; ly += 128) {
    for (let lx = 0; lx < KWZ_W; lx += 128) {
      for (let ty = 0; ty < 128; ty += 8) {
        const y = ly + ty
        if (y >= KWZ_H) break
        for (let tx = 0; tx < 128; tx += 8) {
          const x = lx + tx
          if (x >= KWZ_W) break
          if (skip > 0) {
            skip--
            continue
          }
          const tag = br_read(r, 3)
          if (tag === 0) {
            const idx = COMMON[br_read(r, 5)]
            for (let rr = 0; rr < 8; rr++) put(x, y, rr, idx, 0)
          } else if (tag === 1) {
            const idx = br_read(r, 13)
            for (let rr = 0; rr < 8; rr++) put(x, y, rr, idx, 0)
          } else if (tag === 2) {
            const idx = COMMON[br_read(r, 5)]
            for (let rr = 0; rr < 8; rr++) put(x, y, rr, idx, rr & 1)
          } else if (tag === 3) {
            const idx = br_read(r, 13)
            for (let rr = 0; rr < 8; rr++) put(x, y, rr, idx, rr & 1)
          } else if (tag === 4) {
            const flags = br_read(r, 8)
            for (let rr = 0; rr < 8; rr++) {
              const common = (flags & (1 << rr)) !== 0
              const idx = common ? COMMON[br_read(r, 5)] : br_read(r, 13)
              put(x, y, rr, idx, 0)
            }
          } else if (tag === 5) {
            skip = br_read(r, 5)
          } else if (tag === 7) {
            let pattern = br_read(r, 2)
            const useCommon = br_read(r, 1)
            let ia: number
            let ib: number
            if (useCommon) {
              ia = COMMON[br_read(r, 5)]
              ib = COMMON[br_read(r, 5)]
              pattern += 1
            } else {
              ia = br_read(r, 13)
              ib = br_read(r, 13)
            }
            const P: number[][] = [
              [0, 1, 0, 1, 0, 1, 0, 1],
              [0, 0, 1, 0, 0, 1, 0, 0],
              [0, 1, 0, 0, 1, 0, 0, 1],
              [0, 1, 1, 0, 1, 1, 0, 1],
            ]
            const pat = P[pattern % 4]
            for (let rr = 0; rr < 8; rr++) put(x, y, rr, pat[rr] ? ib : ia, 0)
          }
        }
      }
    }
  }
}

export function kwz_decode(buf: ArrayBuffer): KwzDecoded | null {
  const bytes = new Uint8Array(buf)
  const fileSize = bytes.length
  const KNOWN = ['KFH', 'KTN', 'KMC', 'KMI', 'KSN']
  const sections = new Map<string, { ptr: number, len: number }>()
  let ptr = 0
  let count = 0
  while (ptr + 8 <= fileSize && count < 12) {
    const magic = String.fromCharCode(bytes[ptr], bytes[ptr + 1], bytes[ptr + 2])
    const len = dv_u32(bytes, ptr + 4)
    if (len > fileSize - ptr - 8) break
    if (KNOWN.indexOf(magic) >= 0 && !sections.has(magic)) sections.set(magic, { ptr, len })
    ptr += len + 8
    count++
  }
  const kmi = sections.get('KMI')
  const kmc = sections.get('KMC')
  const kfh = sections.get('KFH')
  if (!kmi || !kmc) return null

  const meta = flip_meta_zero()
  let frameCount = 0xffff
  let thumbIdx = 0
  let flags = 0
  let speed = 8
  if (kfh && kfh.len >= 204) {
    const kb = kfh.ptr + 8
    meta.created = unix_from_nintendo_ts(dv_u32(bytes, kb + 4))
    meta.modified = unix_from_nintendo_ts(dv_u32(bytes, kb + 8))
    meta.app_ver = dv_u32(bytes, kb + 12)
    meta.root_id = bytes_to_hex(bytes.subarray(kb + 16, kb + 26))
    meta.parent_id = bytes_to_hex(bytes.subarray(kb + 26, kb + 36))
    meta.cur_id = bytes_to_hex(bytes.subarray(kb + 36, kb + 46))
    meta.root_name = utf16_str(bytes, kb + 46, 11)
    meta.parent_name = utf16_str(bytes, kb + 68, 11)
    meta.cur_name = utf16_str(bytes, kb + 90, 11)
    meta.root_fn = ascii_str(bytes, kb + 112, 28)
    meta.parent_fn = ascii_str(bytes, kb + 140, 28)
    meta.cur_fn = ascii_str(bytes, kb + 168, 28)
    frameCount = dv_u16(bytes, kb + 196)
    thumbIdx = dv_u16(bytes, kb + 198)
    flags = dv_u16(bytes, kb + 200)
    speed = bytes[kb + 202]
    meta.flags = flags
    meta.lock = flags & 0x1 ? 1 : 0
    meta.layer_flags = bytes[kb + 203]
  }
  const loop = flags & 0x2 ? 1 : 0

  const kmiBody = kmi.ptr + 8
  const nFrames = Math.min(frameCount, (kmi.len / 28) | 0)
  let fc = nFrames

  const layerSizes: number[][] = []
  const paper: number[] = []
  const frameColors: number[][] = []
  const layerDepths: number[][] = []
  const seFlags: number[] = []
  for (let f = 0; f < fc; f++) {
    const o = kmiBody + f * 28
    const fl = dv_u32(bytes, o)
    layerSizes.push([dv_u16(bytes, o + 4), dv_u16(bytes, o + 6), dv_u16(bytes, o + 8)])
    paper.push(fl & 0xf)
    frameColors.push([(fl >> 8) & 0xf, (fl >> 12) & 0xf, (fl >> 16) & 0xf, (fl >> 20) & 0xf, (fl >> 24) & 0xf, (fl >> 28) & 0xf])
    layerDepths.push([bytes[o + 0x14], bytes[o + 0x15], bytes[o + 0x16]])
    seFlags.push(bytes[o + 0x17] & 0xf)
  }

  const layers: Uint8Array[][] = []
  const N = KWZ_W * KWZ_H
  const cur: Uint8Array[] = [new Uint8Array(N), new Uint8Array(N), new Uint8Array(N)]
  let dp = kmc.ptr + 8 + 4
  for (let f = 0; f < fc; f++) {
    try {
      for (let l = 0; l < 3; l++) {
        const size = layerSizes[f][l]
        if (size > 38) decode_layer(bytes, dp, cur[l])
        dp += size
      }
      layers.push([cur[0].slice(), cur[1].slice(), cur[2].slice()])
    } catch (error) {
      report_warning('KWZのフレーム' + (f + 1) + 'を最後まで解析できませんでした', error)
      break
    }
  }
  if (layers.length < 1) return null
  if (layers.length < fc) {
    fc = layers.length
    layerSizes.length = fc
    paper.length = fc
    frameColors.length = fc
    layerDepths.length = fc
    seFlags.length = fc
  }

  let bgm: Int16Array | null = null
  const bgmRate = 16364
  let bgmFps = 0
  const se: (Int16Array | null)[] = [null, null, null, null]
  const ksn = sections.get('KSN')
  if (ksn) {
    const kp = ksn.ptr + 8
    bgmFps = FPS_TABLE[dv_u32(bytes, kp)] || 0
    const sizes = [dv_u32(bytes, kp + 4), dv_u32(bytes, kp + 8), dv_u32(bytes, kp + 12), dv_u32(bytes, kp + 16), dv_u32(bytes, kp + 20)]
    let tp = kp + 28
    if (sizes[0] > 0) bgm = kwz_adpcm_decode(bytes.subarray(tp, tp + sizes[0]))
    tp += sizes[0]
    for (let i = 0; i < 4; i++) {
      if (sizes[i + 1] > 0) se[i] = kwz_adpcm_decode(bytes.subarray(tp, tp + sizes[i + 1]))
      tp += sizes[i + 1]
    }
  }

  return {
    w: KWZ_W,
    h: KWZ_H,
    meta,
    frameCount: fc,
    fps: FPS_TABLE[speed] !== undefined ? FPS_TABLE[speed] : 6,
    speed,
    loop,
    paper,
    frameColors,
    layerDepths,
    thumbIdx: Math.min(thumbIdx, fc > 0 ? fc - 1 : 0),
    layers,
    seFlags,
    bgm,
    bgmRate,
    bgmFps: bgmFps || (FPS_TABLE[speed] || 6),
    se,
  }
}
