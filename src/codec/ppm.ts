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

// 実機と同じ選び方: 全部 0 なら種類0、0 と 0xff のバイトが合わせて4個以下なら32バイトそのまま (種類3)、
// 0xff が多ければ 0xff 以外を (種類2)、そうでなければ 0 以外を (種類1) 書く。
function line_bytes(row: Uint8Array): Uint8Array {
  const chunks = new Uint8Array(32)
  for (let c = 0; c < 32; c++) {
    let b = 0
    const base = c * 8
    for (let bit = 0; bit < 8; bit++) if (row[base + bit]) b |= 1 << bit
    chunks[c] = b
  }
  return chunks
}

function enc_line(chunks: Uint8Array): { t: number, data: number[] } {
  let zero = 0
  let full = 0
  for (let c = 0; c < 32; c++) {
    if (chunks[c] === 0) zero++
    else if (chunks[c] === 0xff) full++
  }
  if (zero === 32) return { t: 0, data: [] }
  if (full + zero <= 4) {
    const d: number[] = []
    for (let c = 0; c < 32; c++) d.push(chunks[c])
    return { t: 3, data: d }
  }
  if (full > zero) {
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

// 1コマ分の2枚のレイヤーを、PPM の並び (1行32バイト × 192行 × 2枚) のバイト列にする。
function frame_bytes(fr: ppm_frame_t): Uint8Array {
  const out = new Uint8Array(32 * ppm_h * 2)
  const row = new Uint8Array(ppm_w)
  for (let l = 0; l < 2; l++) {
    const map = fr.layers[l]
    for (let y = 0; y < ppm_h; y++) {
      for (let x = 0; x < ppm_w; x++) row[x] = map[y * ppm_w + x]
      out.set(line_bytes(row), (l * ppm_h + y) * 32)
    }
  }
  return out
}

const pop8 = new Uint8Array(256)
for (let i = 1; i < 256; i++) pop8[i] = (i & 1) + pop8[i >> 1]

// 実機の差分判定に使う2つの量。点の数 (半分を超えたら少ない側) と、全部 0 か全部 1 の4バイトだけでできた行の数。
function frame_ink(b: Uint8Array): number {
  let n = 0
  for (let i = 0; i < b.length; i++) n += pop8[b[i]]
  return n >= 0xc000 ? 0x18000 - n : n
}

function frame_flat_lines(b: Uint8Array): number {
  let n = 0
  for (let line = 0; line < ppm_h * 2; line++) {
    let flat = 1
    for (let w = 0; w < 8 && flat; w++) {
      const o = line * 32 + w * 4
      const v = b[o] | b[o + 1] | b[o + 2] | b[o + 3]
      const a = b[o] & b[o + 1] & b[o + 2] & b[o + 3]
      if (v !== 0 && a !== 0xff) flat = 0
    }
    n += flat
  }
  return n
}

// 実機は先頭と16コマごとのコマはそのまま、ほかは前のコマとの差 (XOR) のほうが点が少なく、
// そろった行が減らないときだけ差分コマ (先頭バイトの bit7 が 0) にする。
function enc_frame(fr: ppm_frame_t, index: number, prev: Uint8Array | null): { bytes: Uint8Array, raw: Uint8Array } {
  const raw = frame_bytes(fr)
  let body = raw
  let diff = 0
  if (prev && index && index & 15) {
    const x = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) x[i] = raw[i] ^ prev[i]
    if (frame_ink(x) < frame_ink(raw) && frame_flat_lines(x) >= frame_flat_lines(raw)) {
      body = x
      diff = 1
    }
  }
  const types = [new Uint8Array(ppm_h), new Uint8Array(ppm_h)]
  const data: number[] = []
  for (let l = 0; l < 2; l++) {
    for (let y = 0; y < ppm_h; y++) {
      const e = enc_line(body.subarray((l * ppm_h + y) * 32, (l * ppm_h + y + 1) * 32))
      types[l][y] = e.t
      for (const b of e.data) data.push(b)
    }
  }
  const w = binary_writer(1 + 96 + data.length)
  writer_u8(w, (diff ? 0 : 0x80) | ((fr.pen[1] & 3) << 3) | ((fr.pen[0] & 3) << 1) | (fr.paper & 1))
  for (const lt of types) {
    for (let i = 0; i < 48; i++) {
      const b = lt[i * 4] | (lt[i * 4 + 1] << 2) | (lt[i * 4 + 2] << 4) | (lt[i * 4 + 3] << 6)
      writer_u8(w, b)
    }
  }
  for (const b of data) writer_u8(w, b)
  return { bytes: writer_finish(w), raw }
}

export async function ppm_build(inp: ppm_input_t): Promise<Uint8Array> {
  const n = inp.frames.length
  const frame_bytes: Uint8Array[] = []
  let prev: Uint8Array | null = null
  for (let i = 0; i < n; i++) {
    const e = enc_frame(inp.frames[i], i, prev)
    frame_bytes.push(e.bytes)
    prev = e.raw
  }
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
  // 0x40 は常に立つ。読み込んだ PPM にあった編集画面の状態 (bit0・bit2・bit3) はそのまま残す。
  const kept = meta && meta.flags & 0x40 ? meta.flags & 0x0d : 0
  writer_u16(w, 0x40 | kept | (inp.loop ? 0x2 : 0))
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
