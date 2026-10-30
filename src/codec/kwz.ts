import { kwz_common_lines, kwz_speeds } from './kwzformat'
import { binary_writer, crc32, writer_bytes, writer_finish, writer_u8, writer_u16, writer_u32, type binary_writer_t } from '../binary'
import { clamp } from '../lib'
import { kwz_adpcm_encode } from './adpcm'
import { hex_to_bytes, nintendo_ts_from_unix } from './fname'
import type { kwz_frame_meta_t } from './kwzmeta'
import type { flip_meta_t } from './kwzdec'
import { kwz_frame_h, kwz_frame_w } from './kwzgeom'
import { kwz_sign } from './sig'

export { kwz_speeds } from './kwzformat'

export const kwz_w = kwz_frame_w
export const kwz_h = kwz_frame_h

export type kwz_frame_t = {
  layers: [Uint8Array, Uint8Array, Uint8Array]
  paper: number
  colors: [number, number][]
  se: number
  meta?: kwz_frame_meta_t
}

export type kwz_input_t = {
  meta?: flip_meta_t
  thumb_idx?: number
  frames: kwz_frame_t[]
  speed: number
  loop: number
  name: string
  thumb_jpeg: Uint8Array
  bgm: Int16Array | null
  se: (Int16Array | null)[]
}

let common_map: Map<number, number> | null = null

function common_of(idx: number): number {
  if (!common_map) {
    common_map = new Map()
    for (let i = 0; i < 32; i++) common_map.set(kwz_common_lines[i], i)
  }
  const v = common_map.get(idx)
  return v === undefined ? -1 : v
}

export function kwz_line_index(m: Uint8Array, off: number): number {
  return m[off + 1] * 2187 + m[off] * 729 + m[off + 3] * 243 + m[off + 2] * 81 + m[off + 5] * 27 + m[off + 4] * 9 + m[off + 7] * 3 + m[off + 6]
}

type binary_writer16_t = { buf: number, cnt: number, out: number[] }

function b16_push(w: binary_writer16_t, val: number, n: number): void {
  w.buf |= val << w.cnt
  w.cnt += n
  while (w.cnt >= 16) {
    w.out.push(w.buf & 0xffff)
    w.buf >>>= 16
    w.cnt -= 16
  }
}

function b16_bytes(w: binary_writer16_t): Uint8Array {
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
  const w: binary_writer16_t = { buf: 0, cnt: 0, out: [] }
  const li = new Int32Array(8)
  for (let ly = 0; ly < kwz_h; ly += 128) {
    for (let lx = 0; lx < kwz_w; lx += 128) {
      for (let ty = 0; ty < 128; ty += 8) {
        const y = ly + ty
        if (y >= kwz_h) break
        for (let tx = 0; tx < 128; tx += 8) {
          const x = lx + tx
          if (x >= kwz_w) break
          let same = 1
          for (let r = 0; r < 8; r++) {
            li[r] = kwz_line_index(map, (y + r) * kwz_w + x)
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
  for (let i = 0; i < kwz_speeds.length; i++) {
    const e = Math.abs(kwz_speeds[i] - fps)
    if (e < err) {
      err = e
      best = i
    }
  }
  return best
}

const sec_m4: Record<string, number> = { KFH: 0x14, KTN: 0x02, KMC: 0x02, KMI: 0x05, KSN: 0x01 }

function wid10(w: binary_writer_t, hex: string): void {
  const b = hex_to_bytes(hex)
  for (let i = 0; i < 10; i++) writer_u8(w, b[i] || 0)
}

function wfn28(w: binary_writer_t, fn: string): void {
  for (let i = 0; i < 28; i++) writer_u8(w, i < fn.length ? fn.charCodeAt(i) & 0x7f : 0)
}

function section(magic: string, body: Uint8Array): Uint8Array {
  const pad = (4 - (body.length & 3)) & 3
  const w = binary_writer(body.length + pad + 8)
  for (let i = 0; i < 3; i++) writer_u8(w, magic.charCodeAt(i))
  writer_u8(w, sec_m4[magic] !== undefined ? sec_m4[magic] : 0)
  writer_u32(w, body.length + pad)
  writer_bytes(w, body)
  for (let i = 0; i < pad; i++) writer_u8(w, 0)
  return writer_finish(w)
}

export async function kwz_build(inp: kwz_input_t): Promise<Uint8Array> {
  const frames = inp.frames
  const n = frames.length
  const meta = inp.meta
  const now_ts = nintendo_ts()
  const created = meta && meta.created ? nintendo_ts_from_unix(meta.created) : now_ts
  const modified = meta && meta.modified ? nintendo_ts_from_unix(meta.modified) : now_ts
  const def_fn = 'cwmfjordvegbalksnthpyxquiz01'
  const root_fn = meta && meta.root_fn.length === 28 ? meta.root_fn : def_fn
  const parent_fn = meta && meta.parent_fn.length === 28 ? meta.parent_fn : root_fn
  const cur_fn = meta && meta.cur_fn.length === 28 ? meta.cur_fn : def_fn

  const kfh_b = binary_writer(0xcc)
  writer_u32(kfh_b, 0)
  writer_u32(kfh_b, created)
  writer_u32(kfh_b, modified)
  writer_u32(kfh_b, meta ? meta.app_ver : 0)
  wid10(kfh_b, meta ? meta.root_id : '')
  wid10(kfh_b, meta ? meta.parent_id : '')
  wid10(kfh_b, meta ? meta.cur_id : '')
  wname(kfh_b, meta && meta.root_name ? meta.root_name : inp.name)
  wname(kfh_b, meta && meta.parent_name ? meta.parent_name : inp.name)
  wname(kfh_b, meta && meta.cur_name ? meta.cur_name : inp.name)
  wfn28(kfh_b, root_fn)
  wfn28(kfh_b, parent_fn)
  wfn28(kfh_b, cur_fn)
  writer_u16(kfh_b, n)
  writer_u16(kfh_b, clamp(inp.thumb_idx || 0, 0, n > 0 ? n - 1 : 0))
  const base_flags = meta ? meta.flags & ~0x3 : 0
  writer_u16(kfh_b, base_flags | (meta && meta.lock ? 0x1 : 0) | (inp.loop ? 0x2 : 0))
  writer_u8(kfh_b, clamp(inp.speed, 0, 10))
  writer_u8(kfh_b, 0)
  const kfh_body = writer_finish(kfh_b)
  const kfh_crc = crc32(kfh_body.subarray(4), 0)
  kfh_body[0] = kfh_crc & 0xff
  kfh_body[1] = (kfh_crc >>> 8) & 0xff
  kfh_body[2] = (kfh_crc >>> 16) & 0xff
  kfh_body[3] = (kfh_crc >>> 24) & 0xff

  const ktn_b = binary_writer(inp.thumb_jpeg.length + 4)
  writer_u32(ktn_b, crc32(inp.thumb_jpeg, 0))
  writer_bytes(ktn_b, inp.thumb_jpeg)

  const layer_bytes: Uint8Array[][] = []
  for (let f = 0; f < n; f++) {
    layer_bytes.push([kwz_encode_layer(frames[f].layers[0]), kwz_encode_layer(frames[f].layers[1]), kwz_encode_layer(frames[f].layers[2])])
  }

  let kmc_size = 4
  for (const lb of layer_bytes) kmc_size += lb[0].length + lb[1].length + lb[2].length
  const kmc_b = binary_writer(kmc_size)
  writer_u32(kmc_b, 0)
  for (const lb of layer_bytes) {
    writer_bytes(kmc_b, lb[0])
    writer_bytes(kmc_b, lb[1])
    writer_bytes(kmc_b, lb[2])
  }
  const kmc_body = writer_finish(kmc_b)
  const kmc_crc = crc32(kmc_body.subarray(4), 0)
  kmc_body[0] = kmc_crc & 0xff
  kmc_body[1] = (kmc_crc >>> 8) & 0xff
  kmc_body[2] = (kmc_crc >>> 16) & 0xff
  kmc_body[3] = (kmc_crc >>> 24) & 0xff

  const kmi_b = binary_writer(28 * n)
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
    writer_u32(kmi_b, flags >>> 0)
    writer_u16(kmi_b, layer_bytes[f][0].length)
    writer_u16(kmi_b, layer_bytes[f][1].length)
    writer_u16(kmi_b, layer_bytes[f][2].length)
    wid10(kmi_b, fr.meta ? fr.meta.author : meta ? meta.cur_id : '')
    for (let i = 0; i < 3; i++) writer_u8(kmi_b, fr.meta ? fr.meta.depth[i] : 0)
    writer_u8(kmi_b, fr.se & 0xf)
    writer_u16(kmi_b, fr.meta ? fr.meta.reserved : 0)
    writer_u16(kmi_b, fr.meta ? fr.meta.camera : 0)
  }

  const tracks: Uint8Array[] = []
  tracks.push(inp.bgm ? kwz_adpcm_encode(inp.bgm) : new Uint8Array(0))
  for (let i = 0; i < 4; i++) tracks.push(inp.se[i] ? kwz_adpcm_encode(inp.se[i] as Int16Array) : new Uint8Array(0))
  let track_len = 0
  for (const t of tracks) track_len += t.length
  const cat = new Uint8Array(track_len)
  let tp = 0
  for (const t of tracks) {
    cat.set(t, tp)
    tp += t.length
  }
  const ksn_b = binary_writer(28 + track_len)
  writer_u32(ksn_b, clamp(inp.speed, 0, 10))
  for (const t of tracks) writer_u32(ksn_b, t.length)
  writer_u32(ksn_b, crc32(cat, 0))
  writer_bytes(ksn_b, cat)

  const secs = [section('KFH', kfh_body), section('KTN', writer_finish(ktn_b)), section('KMC', kmc_body), section('KMI', writer_finish(kmi_b)), section('KSN', writer_finish(ksn_b))]
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

