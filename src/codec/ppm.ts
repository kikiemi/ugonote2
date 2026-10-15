import { ppm_speeds } from './ppmformat'
import { binary_writer, writer_bytes, writer_finish, writer_u8, writer_u16, writer_u32 } from '../binary'
import { clamp } from '../lib'
import { ppm_adpcm_encode } from './adpcm'
import { hex_to_bytes, nintendo_ts_from_unix, ppm_filename_pack } from './fname'
import type { flip_meta_t } from './kwzdec'
import { ppm_sign } from './sig'

export { ppm_speeds } from './ppmformat'

export const ppm_w = 256
export const ppm_h = 192

export type ppm_frame_t = {
  layers: [Uint8Array, Uint8Array]
  paper: number
  pen: [number, number]
  se: number
}

export type ppm_input_t = {
  meta?: flip_meta_t
  thumb_idx?: number
  frames: ppm_frame_t[]
  speed: number
  loop: number
  name: string
  thumb: Uint8Array
  bgm: Int16Array | null
  se: (Int16Array | null)[]
}

export function ppm_speed_from_fps(fps: number): number {
  let best = 1
  let err = 1e9
  for (let i = 1; i <= 8; i++) {
    const e = Math.abs(ppm_speeds[i] - fps)
    if (e < err) {
      err = e
      best = i
    }
  }
  return best
}

function enc_line(row: Uint8Array): { t: number, data: number[] } {
  const chunks = new Uint8Array(32)
  let used = 0
  let full = 0
  for (let c = 0; c < 32; c++) {
    let b = 0
    const base = c * 8
    for (let bit = 0; bit < 8; bit++) if (row[base + bit]) b |= 1 << bit
    chunks[c] = b
    if (b !== 0) used++
    if (b === 0xff) full++
  }
  if (used === 0) return { t: 0, data: [] }
  const cost1 = 4 + (used === 0 ? 0 : used)
  const diff2 = 32 - full
  const cost2 = 4 + diff2
  const cost3 = 32
  if (cost3 <= cost1 && cost3 <= cost2) {
    const d: number[] = []
    for (let c = 0; c < 32; c++) d.push(chunks[c])
    return { t: 3, data: d }
  }
  if (cost2 < cost1) {
    let flags = 0
    const d: number[] = []
    for (let c = 0; c < 32; c++) {
      if (chunks[c] !== 0xff) {
        flags |= 0x80000000 >>> c
        d.push(chunks[c])
      }
    }
    return { t: 2, data: [(flags >>> 24) & 0xff, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff, ...d] }
  }
  let flags = 0
  const d: number[] = []
  for (let c = 0; c < 32; c++) {
    if (chunks[c] !== 0) {
      flags |= 0x80000000 >>> c
      d.push(chunks[c])
    }
  }
  return { t: 1, data: [(flags >>> 24) & 0xff, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff, ...d] }
}

function enc_layer(map: Uint8Array): { types: Uint8Array, data: number[] } {
  const types = new Uint8Array(ppm_h)
  const data: number[] = []
  const row = new Uint8Array(ppm_w)
  for (let y = 0; y < ppm_h; y++) {
    for (let x = 0; x < ppm_w; x++) row[x] = map[y * ppm_w + x]
    const e = enc_line(row)
    types[y] = e.t
    for (const b of e.data) data.push(b)
  }
  return { types, data }
}

function enc_frame(fr: ppm_frame_t): Uint8Array {
  const l1 = enc_layer(fr.layers[0])
  const l2 = enc_layer(fr.layers[1])
  const w = binary_writer(1 + 96 + l1.data.length + l2.data.length)
  writer_u8(w, 0x80 | ((fr.pen[1] & 3) << 3) | ((fr.pen[0] & 3) << 1) | (fr.paper & 1))
  for (const lt of [l1.types, l2.types]) {
    for (let i = 0; i < 48; i++) {
      const b = lt[i * 4] | (lt[i * 4 + 1] << 2) | (lt[i * 4 + 2] << 4) | (lt[i * 4 + 3] << 6)
      writer_u8(w, b)
    }
  }
  for (const b of l1.data) writer_u8(w, b)
  for (const b of l2.data) writer_u8(w, b)
  return writer_finish(w)
}

export async function ppm_build(inp: ppm_input_t): Promise<Uint8Array> {
  const n = inp.frames.length
  const frame_bytes = inp.frames.map(enc_frame)
  const table_size = 4 * n
  let frame_data_len = 0
  for (const fb of frame_bytes) frame_data_len += fb.length
  const anim_data_size0 = 8 + table_size + frame_data_len
  const anim_data_size = (anim_data_size0 + 3) & ~3
  const anim_pad = anim_data_size - anim_data_size0

  const tracks: Uint8Array[] = []
  tracks.push(inp.bgm && inp.bgm.length ? ppm_adpcm_encode(inp.bgm) : new Uint8Array(0))
  for (let i = 0; i < 3; i++) tracks.push(inp.se[i] && (inp.se[i] as Int16Array).length ? ppm_adpcm_encode(inp.se[i] as Int16Array) : new Uint8Array(0))
  let sound_data_len = 0
  for (const t of tracks) sound_data_len += t.length
  const sound_section_len = 32 + sound_data_len

  const se_off0 = 0x6a0 + anim_data_size + n
  const snd_off = (se_off0 + 3) & ~3
  const se_pad = snd_off - se_off0

  const total = snd_off + sound_section_len + 144
  const w = binary_writer(total)
  writer_u8(w, 0x50)
  writer_u8(w, 0x41)
  writer_u8(w, 0x52)
  writer_u8(w, 0x41)
  writer_u32(w, anim_data_size)
  writer_u32(w, sound_data_len)
  writer_u16(w, n - 1)
  writer_u16(w, 0x24)

  const meta = inp.meta
  writer_u16(w, meta && meta.lock ? 1 : 0)
  writer_u16(w, Math.max(0, Math.min(inp.thumb_idx || 0, n > 0 ? n - 1 : 0)))
  const wname = (s: string) => {
    for (let i = 0; i < 11; i++) writer_u16(w, i < s.length ? s.charCodeAt(i) : 0)
  }
  wname(meta && meta.root_name ? meta.root_name : inp.name)
  wname(meta && meta.parent_name ? meta.parent_name : inp.name)
  wname(meta && meta.cur_name ? meta.cur_name : inp.name)
  const wid = (hex: string) => {
    const b = hex_to_bytes((hex || '0011223344556607').padEnd(16, '0').slice(0, 16))
    for (let i = 7; i >= 0; i--) writer_u8(w, b[i] || 0)
  }
  wid(meta ? meta.parent_id : '')
  wid(meta ? meta.cur_id : '')
  const pack_fn = (fn: string, fallback_edits: number) => {
    const mm = /^([0-9A-F]{6})_([0-9A-F]{13})_(\d{3})$/.exec(fn || '')
    const mac3 = mm ? mm[1] : '123456'
    const r13 = mm ? mm[2] : '0123456789ABC'
    const ed = mm ? parseInt(mm[3], 10) : fallback_edits
    writer_bytes(w, ppm_filename_pack(mac3, r13, ed))
  }
  pack_fn(meta ? meta.parent_fn : '', 0)
  pack_fn(meta ? meta.cur_fn : '', 0)
  wid(meta ? meta.root_id : '')
  const cm = /^([0-9A-F]{6})_([0-9A-F]{13})_\d{3}$/.exec(meta ? meta.cur_fn : '') || [null, '123456', '0123456789ABC']
  const mac_hex = cm[1] as string
  const s13 = cm[2] as string
  writer_bytes(w, hex_to_bytes(mac_hex))
  for (let i = 0; i < 10; i += 2) writer_u8(w, (parseInt(s13[i], 16) << 4) | parseInt(s13[i + 1], 16))
  writer_u32(w, nintendo_ts_from_unix(meta && meta.modified ? meta.modified : Math.floor(Date.now() / 1000)))
  writer_u16(w, 0)

  writer_bytes(w, inp.thumb)

  writer_u16(w, table_size)
  writer_u16(w, 0)
  writer_u16(w, 0)
  writer_u16(w, 0x40 | (inp.loop ? 0x2 : 0))
  let off = 0
  for (const fb of frame_bytes) {
    writer_u32(w, off)
    off += fb.length
  }
  for (const fb of frame_bytes) writer_bytes(w, fb)
  for (let i = 0; i < anim_pad; i++) writer_u8(w, 0)

  for (const fr of inp.frames) writer_u8(w, fr.se & 0x7)
  for (let i = 0; i < se_pad; i++) writer_u8(w, 0)

  for (const t of tracks) writer_u32(w, t.length)
  writer_u8(w, 8 - clamp(inp.speed, 1, 8))
  writer_u8(w, 8 - clamp(inp.speed, 1, 8))
  for (let i = 0; i < 14; i++) writer_u8(w, 0)
  for (const t of tracks) writer_bytes(w, t)
  const body = writer_finish(w)
  const sig = await ppm_sign(body)
  const out = new Uint8Array(body.length + 128 + 16)
  out.set(body, 0)
  out.set(sig, body.length)
  return out
}
