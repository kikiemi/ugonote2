import { binary_writer, crc32, writer_bytes, writer_finish, writer_u8, writer_u16, writer_u32, type BinaryWriter } from '../binary'
import { clamp } from '../lib'
import { kwz_adpcm_encode } from './adpcm'
import { hex_to_bytes, nintendo_ts_from_unix } from './fname'
import type { FlipMeta } from './kwzdec'
import { KWZ_FRAME_H, KWZ_FRAME_W } from './kwzgeom'
import { kwz_sign } from './sig'

export const KWZ_SPEEDS = [0.2, 0.5, 1, 2, 4, 6, 8, 12, 20, 24, 30]

export const KWZ_W = KWZ_FRAME_W
export const KWZ_H = KWZ_FRAME_H

export type KwzFrame = {
  layers: [Uint8Array, Uint8Array, Uint8Array]
  paper: number
  colors: [number, number][]
  se: number
}

export type KwzInput = {
  meta?: FlipMeta
  thumbIdx?: number
  frames: KwzFrame[]
  speed: number
  loop: number
  name: string
  thumbJpeg: Uint8Array
  bgm: Int16Array | null
  se: (Int16Array | null)[]
}

const COMMON = [
  0x0000, 0x0cd0, 0x19a0, 0x02d9, 0x088b, 0x0051, 0x00f3, 0x0009, 0x001b, 0x0001, 0x0003, 0x05b2, 0x1116, 0x00a2, 0x01e6, 0x0012, 0x0036, 0x0002, 0x0006,
  0x0b64, 0x08dc, 0x0144, 0x00fc, 0x0024, 0x001c, 0x0004, 0x0334, 0x099c, 0x0668, 0x1338, 0x1004, 0x166c,
]

let commonMap: Map<number, number> | null = null

function common_of(idx: number): number {
  if (!commonMap) {
    commonMap = new Map()
    for (let i = 0; i < 32; i++) commonMap.set(COMMON[i], i)
  }
  const v = commonMap.get(idx)
  return v === undefined ? -1 : v
}

export function kwz_line_index(m: Uint8Array, off: number): number {
  return m[off + 1] * 2187 + m[off] * 729 + m[off + 3] * 243 + m[off + 2] * 81 + m[off + 5] * 27 + m[off + 4] * 9 + m[off + 7] * 3 + m[off + 6]
}

type BinaryWriter16 = { buf: number, cnt: number, out: number[] }

function b16_push(w: BinaryWriter16, val: number, n: number): void {
  w.buf |= val << w.cnt
  w.cnt += n
  while (w.cnt >= 16) {
    w.out.push(w.buf & 0xffff)
    w.buf >>>= 16
    w.cnt -= 16
  }
}

function b16_bytes(w: BinaryWriter16): Uint8Array {
  if (w.cnt > 0) {
    w.out.push(w.buf & 0xffff)
    w.buf = 0
    w.cnt = 0
  }
  const b = new Uint8Array(w.out.length * 2)
  for (let i = 0; i < w.out.length; i++) {
    b[i * 2] = w.out[i] & 0xff
    b[i * 2 + 1] = w.out[i] >> 8
  }
  return b
}

export function kwz_encode_layer(map: Uint8Array): Uint8Array {
  const w: BinaryWriter16 = { buf: 0, cnt: 0, out: [] }
  const li = new Int32Array(8)
  for (let ly = 0; ly < KWZ_H; ly += 128) {
    for (let lx = 0; lx < KWZ_W; lx += 128) {
      for (let ty = 0; ty < 128; ty += 8) {
        const y = ly + ty
        if (y >= KWZ_H) break
        for (let tx = 0; tx < 128; tx += 8) {
          const x = lx + tx
          if (x >= KWZ_W) break
          let same = 1
          for (let r = 0; r < 8; r++) {
            li[r] = kwz_line_index(map, (y + r) * KWZ_W + x)
            if (r > 0 && li[r] !== li[0]) same = 0
          }
          if (same) {
            const c = common_of(li[0])
            if (c >= 0) {
              b16_push(w, 0, 3)
              b16_push(w, c, 5)
            } else {
              b16_push(w, 1, 3)
              b16_push(w, li[0], 13)
            }
            continue
          }
          b16_push(w, 4, 3)
          let flags = 0
          for (let r = 0; r < 8; r++) if (common_of(li[r]) >= 0) flags |= 1 << r
          b16_push(w, flags & 0xff, 8)
          for (let r = 0; r < 8; r++) {
            const c = common_of(li[r])
            if (c >= 0) b16_push(w, c, 5)
            else b16_push(w, li[r], 13)
          }
        }
      }
    }
  }
  let bytes = b16_bytes(w)
  if (bytes.length === 38) {
    const pad = new Uint8Array(40)
    pad.set(bytes)
    bytes = pad
  }
  return bytes
}

function wname(w: ReturnType<typeof binary_writer>, s: string): void {
  for (let i = 0; i < 11; i++) {
    const c = i < s.length ? s.charCodeAt(i) : 0
    writer_u16(w, c)
  }
}

function nintendo_ts(): number {
  const base = Date.UTC(2000, 0, 1) / 1000
  return Math.max(0, Math.floor(Date.now() / 1000 - base))
}

export function kwz_speed_from_fps(fps: number): number {
  let best = 0
  let err = 1e9
  for (let i = 0; i < KWZ_SPEEDS.length; i++) {
    const e = Math.abs(KWZ_SPEEDS[i] - fps)
    if (e < err) {
      err = e
      best = i
    }
  }
  return best
}

const SEC_M4: Record<string, number> = { KFH: 0x14, KTN: 0x02, KMC: 0x02, KMI: 0x05, KSN: 0x01 }

function wid10(w: BinaryWriter, hex: string): void {
  const b = hex_to_bytes(hex)
  for (let i = 0; i < 10; i++) writer_u8(w, b[i] || 0)
}

function wfn28(w: BinaryWriter, fn: string): void {
  for (let i = 0; i < 28; i++) writer_u8(w, i < fn.length ? fn.charCodeAt(i) & 0x7f : 0)
}

function section(magic: string, body: Uint8Array): Uint8Array {
  const pad = (4 - (body.length & 3)) & 3
  const w = binary_writer(body.length + pad + 8)
  for (let i = 0; i < 3; i++) writer_u8(w, magic.charCodeAt(i))
  writer_u8(w, SEC_M4[magic] !== undefined ? SEC_M4[magic] : 0)
  writer_u32(w, body.length + pad)
  writer_bytes(w, body)
  for (let i = 0; i < pad; i++) writer_u8(w, 0)
  return writer_finish(w)
}

export async function kwz_build(inp: KwzInput): Promise<Uint8Array> {
  const frames = inp.frames
  const n = frames.length
  const meta = inp.meta
  const nowTs = nintendo_ts()
  const created = meta && meta.created ? nintendo_ts_from_unix(meta.created) : nowTs
  const modified = meta && meta.modified ? nintendo_ts_from_unix(meta.modified) : nowTs
  const defFn = 'cwmfjordvegbalksnthpyxquiz01'
  const rootFn = meta && meta.root_fn.length === 28 ? meta.root_fn : defFn
  const parentFn = meta && meta.parent_fn.length === 28 ? meta.parent_fn : rootFn
  const curFn = meta && meta.cur_fn.length === 28 ? meta.cur_fn : defFn

  const kfhB = binary_writer(0xcc)
  writer_u32(kfhB, 0)
  writer_u32(kfhB, created)
  writer_u32(kfhB, modified)
  writer_u32(kfhB, meta ? meta.app_ver : 0)
  wid10(kfhB, meta ? meta.root_id : '')
  wid10(kfhB, meta ? meta.parent_id : '')
  wid10(kfhB, meta ? meta.cur_id : '')
  wname(kfhB, meta && meta.root_name ? meta.root_name : inp.name)
  wname(kfhB, meta && meta.parent_name ? meta.parent_name : inp.name)
  wname(kfhB, meta && meta.cur_name ? meta.cur_name : inp.name)
  wfn28(kfhB, rootFn)
  wfn28(kfhB, parentFn)
  wfn28(kfhB, curFn)
  writer_u16(kfhB, n)
  writer_u16(kfhB, clamp(inp.thumbIdx || 0, 0, n > 0 ? n - 1 : 0))
  const baseFlags = meta ? meta.flags & ~0x3 : 0
  writer_u16(kfhB, baseFlags | (meta && meta.lock ? 0x1 : 0) | (inp.loop ? 0x2 : 0))
  writer_u8(kfhB, clamp(inp.speed, 0, 10))
  writer_u8(kfhB, 0)
  const kfhBody = writer_finish(kfhB)
  const kfhCrc = crc32(kfhBody.subarray(4), 0)
  kfhBody[0] = kfhCrc & 0xff
  kfhBody[1] = (kfhCrc >>> 8) & 0xff
  kfhBody[2] = (kfhCrc >>> 16) & 0xff
  kfhBody[3] = (kfhCrc >>> 24) & 0xff

  const ktnB = binary_writer(inp.thumbJpeg.length + 4)
  writer_u32(ktnB, crc32(inp.thumbJpeg, 0))
  writer_bytes(ktnB, inp.thumbJpeg)

  const layerBytes: Uint8Array[][] = []
  for (let f = 0; f < n; f++) {
    layerBytes.push([kwz_encode_layer(frames[f].layers[0]), kwz_encode_layer(frames[f].layers[1]), kwz_encode_layer(frames[f].layers[2])])
  }

  let kmcSize = 4
  for (const lb of layerBytes) kmcSize += lb[0].length + lb[1].length + lb[2].length
  const kmcB = binary_writer(kmcSize)
  writer_u32(kmcB, 0)
  for (const lb of layerBytes) {
    writer_bytes(kmcB, lb[0])
    writer_bytes(kmcB, lb[1])
    writer_bytes(kmcB, lb[2])
  }
  const kmcBody = writer_finish(kmcB)
  const kmcCrc = crc32(kmcBody.subarray(4), 0)
  kmcBody[0] = kmcCrc & 0xff
  kmcBody[1] = (kmcCrc >>> 8) & 0xff
  kmcBody[2] = (kmcCrc >>> 16) & 0xff
  kmcBody[3] = (kmcCrc >>> 24) & 0xff

  const kmiB = binary_writer(28 * n)
  for (let f = 0; f < n; f++) {
    const fr = frames[f]
    const c = fr.colors
    const flags =
      (fr.paper & 0xf) |
      (0 << 4) |
      ((c[0][0] & 0xf) << 8) |
      ((c[0][1] & 0xf) << 12) |
      ((c[1][0] & 0xf) << 16) |
      ((c[1][1] & 0xf) << 20) |
      ((c[2][0] & 0xf) << 24) |
      ((c[2][1] & 0xf) << 28)
    writer_u32(kmiB, flags >>> 0)
    writer_u16(kmiB, layerBytes[f][0].length)
    writer_u16(kmiB, layerBytes[f][1].length)
    writer_u16(kmiB, layerBytes[f][2].length)
    for (let i = 0; i < 10; i++) writer_u8(kmiB, 0)
    writer_u8(kmiB, 0)
    writer_u8(kmiB, 0)
    writer_u8(kmiB, 0)
    writer_u8(kmiB, fr.se & 0xf)
    writer_u16(kmiB, 0)
    writer_u16(kmiB, 0)
  }

  const tracks: Uint8Array[] = []
  tracks.push(inp.bgm ? kwz_adpcm_encode(inp.bgm) : new Uint8Array(0))
  for (let i = 0; i < 4; i++) tracks.push(inp.se[i] ? kwz_adpcm_encode(inp.se[i] as Int16Array) : new Uint8Array(0))
  let trackLen = 0
  for (const t of tracks) trackLen += t.length
  const cat = new Uint8Array(trackLen)
  let tp = 0
  for (const t of tracks) {
    cat.set(t, tp)
    tp += t.length
  }
  const ksnB = binary_writer(28 + trackLen)
  writer_u32(ksnB, clamp(inp.speed, 0, 10))
  for (const t of tracks) writer_u32(ksnB, t.length)
  writer_u32(ksnB, crc32(cat, 0))
  writer_bytes(ksnB, cat)

  const secs = [section('KFH', kfhBody), section('KTN', writer_finish(ktnB)), section('KMC', kmcBody), section('KMI', writer_finish(kmiB)), section('KSN', writer_finish(ksnB))]
  let total = 0
  for (const s of secs) total += s.length
  const out = new Uint8Array(total)
  let p = 0
  for (const s of secs) {
    out.set(s, p)
    p += s.length
  }
  const sig = await kwz_sign(out)
  const signed = new Uint8Array(out.length + 256)
  signed.set(out, 0)
  signed.set(sig, out.length)
  return signed
}

