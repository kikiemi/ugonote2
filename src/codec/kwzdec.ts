import { kwz_common_lines, kwz_speeds } from './kwzformat'
import { report_warning } from '../diagnostics'
import { kwz_adpcm_decode } from './adpcm'
import { bytes_to_hex, unix_from_nintendo_ts } from './fname'
import type { kwz_frame_meta_t } from './kwzmeta'
import { kwz_h, kwz_w } from './kwz'

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

export type flip_meta_t = {
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

export function flip_meta_zero(): flip_meta_t {
  return { created: 0, modified: 0, app_ver: 0, root_id: '', parent_id: '', cur_id: '', root_name: '', parent_name: '', cur_name: '', root_fn: '', parent_fn: '', cur_fn: '', lock: 0, flags: 0, layer_flags: 0, edits: 0 }
}

export type kwz_decoded_t = {
  meta: flip_meta_t
  w: number
  h: number
  frame_count: number
  fps: number
  speed: number
  loop: number
  paper: number[]
  frame_colors: number[][]
  layer_depths: number[][]
  frame_meta: kwz_frame_meta_t[]
  thumb_idx: number
  layers: Uint8Array[][]
  se_flags: number[]
  bgm: Int16Array | null
  bgm_rate: number
  bgm_fps: number
  se: (Int16Array | null)[]
}

let line_lut_cache: Uint8Array | null = null
function line_lut(): Uint8Array {
  if (line_lut_cache) return line_lut_cache
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
  line_lut_cache = lut
  return lut
}

let line_lut_small_cache: Uint8Array | null = null
function line_lut_s(): Uint8Array {
  if (line_lut_small_cache) return line_lut_small_cache
  const base = line_lut()
  const s = new Uint8Array(6561 * 8)
  for (let idx = 0; idx < 6561; idx++) {
    const o = idx * 8
    for (let i = 0; i < 8; i++) s[o + i] = base[o + ((i + 1) & 7)]
  }
  line_lut_small_cache = s
  return s
}

type br16_t = { bytes: Uint8Array, pos: number, buf: number, cnt: number }

function br_make(bytes: Uint8Array, start: number): br16_t {
  return { bytes, pos: start, buf: 0, cnt: 0 }
}

function br_read(r: br16_t, n: number): number {
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
  const lut_s = line_lut_s()
  const r = br_make(bytes, start)
  const put = (x: number, y: number, row: number, idx: number, shifted: number) => {
    const t = shifted ? lut_s : lut
    const base = (y + row) * kwz_w + x
    const lo = idx * 8
    for (let i = 0; i < 8; i++) dst[base + i] = t[lo + i]
  }
  let skip = 0
  for (let ly = 0; ly < kwz_h; ly += 128) {
    for (let lx = 0; lx < kwz_w; lx += 128) {
      for (let ty = 0; ty < 128; ty += 8) {
        const y = ly + ty
        if (y >= kwz_h) break
        for (let tx = 0; tx < 128; tx += 8) {
          const x = lx + tx
          if (x >= kwz_w) break
          if (skip > 0) {
            skip--
            continue
          }
          const tag = br_read(r, 3)
          if (tag === 0) {
            const idx = kwz_common_lines[br_read(r, 5)]
            for (let rr = 0; rr < 8; rr++) put(x, y, rr, idx, 0)
          } else if (tag === 1) {
            const idx = br_read(r, 13)
            for (let rr = 0; rr < 8; rr++) put(x, y, rr, idx, 0)
          } else if (tag === 2) {
            const idx = kwz_common_lines[br_read(r, 5)]
            for (let rr = 0; rr < 8; rr++) put(x, y, rr, idx, rr & 1)
          } else if (tag === 3) {
            const idx = br_read(r, 13)
            for (let rr = 0; rr < 8; rr++) put(x, y, rr, idx, rr & 1)
          } else if (tag === 4) {
            const flags = br_read(r, 8)
            for (let rr = 0; rr < 8; rr++) {
              const common = (flags & (1 << rr)) !== 0
              const idx = common ? kwz_common_lines[br_read(r, 5)] : br_read(r, 13)
              put(x, y, rr, idx, 0)
            }
          } else if (tag === 5) {
            skip = br_read(r, 5)
          } else if (tag === 7) {
            let pattern = br_read(r, 2)
            const use_common = br_read(r, 1)
            let ia: number
            let ib: number
            if (use_common) {
              ia = kwz_common_lines[br_read(r, 5)]
              ib = kwz_common_lines[br_read(r, 5)]
              pattern += 1
            } else {
              ia = br_read(r, 13)
              ib = br_read(r, 13)
            }
            const p: number[][] = [
              [0, 1, 0, 1, 0, 1, 0, 1],
              [0, 0, 1, 0, 0, 1, 0, 0],
              [0, 1, 0, 0, 1, 0, 0, 1],
              [0, 1, 1, 0, 1, 1, 0, 1],
            ]
            const pat = p[pattern % 4]
            for (let rr = 0; rr < 8; rr++) put(x, y, rr, pat[rr] ? ib : ia, 0)
          }
        }
      }
    }
  }
}

export function kwz_decode(buf: ArrayBuffer): kwz_decoded_t | null {
  const bytes = new Uint8Array(buf)
  const file_size = bytes.length
  const known = ['KFH', 'KTN', 'KMC', 'KMI', 'KSN']
  const sections = new Map<string, { ptr: number, len: number }>()
  let ptr = 0
  let count = 0
  while (ptr + 8 <= file_size && count < 12) {
    const magic = String.fromCharCode(bytes[ptr], bytes[ptr + 1], bytes[ptr + 2])
    const len = dv_u32(bytes, ptr + 4)
    if (len > file_size - ptr - 8) break
    if (known.indexOf(magic) >= 0 && !sections.has(magic)) sections.set(magic, { ptr, len })
    ptr += len + 8
    count++
  }
  const kmi = sections.get('KMI')
  const kmc = sections.get('KMC')
  const kfh = sections.get('KFH')
  if (!kmi || !kmc) return null

  const meta = flip_meta_zero()
  let frame_count = 0xffff
  let thumb_idx = 0
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
    frame_count = dv_u16(bytes, kb + 196)
    thumb_idx = dv_u16(bytes, kb + 198)
    flags = dv_u16(bytes, kb + 200)
    speed = bytes[kb + 202]
    meta.flags = flags
    meta.lock = flags & 0x1 ? 1 : 0
    meta.layer_flags = bytes[kb + 203]
  }
  const loop = flags & 0x2 ? 1 : 0

  const kmi_body = kmi.ptr + 8
  const n_frames = Math.min(frame_count, (kmi.len / 28) | 0)
  let fc = n_frames

  const layer_sizes: number[][] = []
  const paper: number[] = []
  const frame_colors: number[][] = []
  const layer_depths: number[][] = []
  const frame_meta: kwz_frame_meta_t[] = []
  const se_flags: number[] = []
  for (let f = 0; f < fc; f++) {
    const o = kmi_body + f * 28
    const fl = dv_u32(bytes, o)
    layer_sizes.push([dv_u16(bytes, o + 4), dv_u16(bytes, o + 6), dv_u16(bytes, o + 8)])
    paper.push(fl & 0xf)
    frame_colors.push([(fl >> 8) & 0xf, (fl >> 12) & 0xf, (fl >> 16) & 0xf, (fl >> 20) & 0xf, (fl >> 24) & 0xf, (fl >> 28) & 0xf])
    layer_depths.push([bytes[o + 0x14], bytes[o + 0x15], bytes[o + 0x16]])
    let author = ''
    for (let i = 0; i < 10; i++) author += bytes[o + 0xa + i].toString(16).padStart(2, '0')
    frame_meta.push({ depth: [...layer_depths[f]], colors: [...frame_colors[f]], author, reserved: dv_u16(bytes, o + 0x18), camera: dv_u16(bytes, o + 0x1a) })
    se_flags.push(bytes[o + 0x17] & 0xf)
  }

  const layers: Uint8Array[][] = []
  const n = kwz_w * kwz_h
  const cur: Uint8Array[] = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)]
  let dp = kmc.ptr + 8 + 4
  for (let f = 0; f < fc; f++) {
    try {
      for (let l = 0; l < 3; l++) {
        const size = layer_sizes[f][l]
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
    layer_sizes.length = fc
    paper.length = fc
    frame_colors.length = fc
    layer_depths.length = fc
    frame_meta.length = fc
    se_flags.length = fc
  }

  let bgm: Int16Array | null = null
  const bgm_rate = 16364
  let bgm_fps = 0
  const se: (Int16Array | null)[] = [null, null, null, null]
  const ksn = sections.get('KSN')
  if (ksn) {
    const kp = ksn.ptr + 8
    bgm_fps = kwz_speeds[dv_u32(bytes, kp)] || 0
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
    w: kwz_w,
    h: kwz_h,
    meta,
    frame_count: fc,
    fps: kwz_speeds[speed] !== undefined ? kwz_speeds[speed] : 6,
    speed,
    loop,
    paper,
    frame_colors,
    layer_depths,
    frame_meta,
    thumb_idx: Math.min(thumb_idx, fc > 0 ? fc - 1 : 0),
    layers,
    se_flags,
    bgm,
    bgm_rate,
    bgm_fps: bgm_fps || (kwz_speeds[speed] || 6),
    se,
  }
}
