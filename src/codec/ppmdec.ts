import { ppm_speeds } from './ppmformat'
import { report_warning } from '../diagnostics'
import { ppm_adpcm_decode } from './adpcm'
import { bytes_to_hex, unix_from_nintendo_ts, ppm_filename_unpack, ppm_filename_format } from './fname'
import { flip_meta_zero, type flip_meta_t } from './kwzdec'
import { ppm_h, ppm_w } from './ppm'

function frame_speed_idx_safe(b: Uint8Array, sound_off: number): number {
  const p = sound_off + 16
  if (p < b.length) return 8 - b[p]
  return 5
}

function utf16_str(b: Uint8Array, ptr: number, chars: number): string {
  let s = ''
  for (let i = 0; i < chars; i++) {
    const c = b[ptr + i * 2] | (b[ptr + i * 2 + 1] << 8)
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s
}

function ppm_id_hex(b: Uint8Array, ptr: number): string {
  const rev = new Uint8Array(8)
  for (let i = 0; i < 8; i++) rev[i] = b[ptr + 7 - i]
  return bytes_to_hex(rev)
}

export type ppm_decoded_t = {
  meta: flip_meta_t
  w: number
  h: number
  frame_count: number
  fps: number
  speed: number
  loop: number
  paper: number[]
  thumb_idx: number
  pen_idx: number[][]
  layers: Uint8Array[][]
  se_flags: number[]
  bgm: Int16Array | null
  bgm_rate: number
  bgm_fps: number
  se: (Int16Array | null)[]
}


function dv_u16(d: DataView, o: number): number {
  return d.getUint16(o, true)
}
function dv_u32(d: DataView, o: number): number {
  return d.getUint32(o, true)
}

function dec_line(bytes: Uint8Array, p: { o: number }, t: number, out: Uint8Array, row_base: number): void {
  if (t === 0) return
  if (t === 3) {
    for (let c = 0; c < 32; c++) {
      const b = bytes[p.o++]
      for (let bit = 0; bit < 8; bit++) out[row_base + c * 8 + bit] = (b >> bit) & 1
    }
    return
  }
  const flags = (bytes[p.o] << 24) | (bytes[p.o + 1] << 16) | (bytes[p.o + 2] << 8) | bytes[p.o + 3]
  p.o += 4
  for (let c = 0; c < 32; c++) {
    const present = (flags & (0x80000000 >>> c)) !== 0
    if (t === 2) {
      if (present) {
        const b = bytes[p.o++]
        for (let bit = 0; bit < 8; bit++) out[row_base + c * 8 + bit] = (b >> bit) & 1
      } else {
        for (let bit = 0; bit < 8; bit++) out[row_base + c * 8 + bit] = 1
      }
    } else {
      if (present) {
        const b = bytes[p.o++]
        for (let bit = 0; bit < 8; bit++) out[row_base + c * 8 + bit] = (b >> bit) & 1
      }
    }
  }
}

export function ppm_decode(buf: ArrayBuffer): ppm_decoded_t | null {
  const bytes = new Uint8Array(buf)
  if (bytes.length < 0x6a0) return null
  const d = new DataView(buf)
  if (bytes[0] !== 0x50 || bytes[1] !== 0x41 || bytes[2] !== 0x52 || bytes[3] !== 0x41) return null
  const anim_data_size = dv_u32(d, 4)
  let frame_count = dv_u16(d, 12) + 1
  if (frame_count > 999) frame_count = 999
  let thumb_idx = d.getInt16(0x12, true)
  if (thumb_idx < 0 || thumb_idx >= frame_count) thumb_idx = 0

  const meta = flip_meta_zero()
  meta.lock = dv_u16(d, 0x10) ? 1 : 0
  meta.root_name = utf16_str(bytes, 0x14, 11)
  meta.parent_name = utf16_str(bytes, 0x2a, 11)
  meta.cur_name = utf16_str(bytes, 0x40, 11)
  meta.parent_id = ppm_id_hex(bytes, 0x56)
  meta.cur_id = ppm_id_hex(bytes, 0x5e)
  const pfn = ppm_filename_unpack(bytes.subarray(0x66, 0x78))
  const cfn = ppm_filename_unpack(bytes.subarray(0x78, 0x8a))
  meta.parent_fn = ppm_filename_format(pfn.mac3hex, pfn.rand13, pfn.edits)
  meta.cur_fn = ppm_filename_format(cfn.mac3hex, cfn.rand13, cfn.edits)
  meta.root_id = ppm_id_hex(bytes, 0x8a)
  meta.edits = cfn.edits
  meta.modified = unix_from_nintendo_ts(dv_u32(d, 0x9a))
  meta.created = meta.modified

  const anim_off = 0x6a0
  const table_size = dv_u16(d, anim_off)
  const flags = dv_u16(d, anim_off + 6)
  meta.flags = flags
  const loop = flags & 0x2 ? 1 : 0
  const off_base = anim_off + 8 + table_size
  const frame_offsets: number[] = []
  for (let i = 0; i < frame_count; i++) {
    const rel = anim_off + 8 + i * 4
    if (rel + 4 > bytes.length) break
    const off = dv_u32(d, rel)
    if (off_base + off >= bytes.length) break
    frame_offsets.push(off)
  }
  if (frame_offsets.length < frame_count) frame_count = frame_offsets.length
  if (frame_count < 1) return null

  const layers: Uint8Array[][] = []
  const paper: number[] = []
  const pen_idx: number[][] = []
  const n = ppm_w * ppm_h
  const prev: Uint8Array[] = [new Uint8Array(n), new Uint8Array(n)]
  let decoded_frames = frame_count
  for (let f = 0; f < frame_count; f++) {
    try {
      const start = off_base + frame_offsets[f]
      let o = start
      const header = bytes[o++]
      paper.push(header & 1)
      pen_idx.push([(header >> 1) & 3, (header >> 3) & 3])
      const is_key = (header >> 7) & 1
      const is_translated = (header >> 5) & 3
      let tx = 0
      let ty = 0
      if (is_translated) {
        tx = (bytes[o] << 24) >> 24
        ty = (bytes[o + 1] << 24) >> 24
        o += 2
      }
      const types: number[][] = [new Array(ppm_h), new Array(ppm_h)]
      for (let l = 0; l < 2; l++) {
        for (let i = 0; i < 48; i++) {
          const value = bytes[o++]
          types[l][i * 4] = value & 3
          types[l][i * 4 + 1] = (value >> 2) & 3
          types[l][i * 4 + 2] = (value >> 4) & 3
          types[l][i * 4 + 3] = (value >> 6) & 3
        }
      }
      const frame_layers: Uint8Array[] = [new Uint8Array(n), new Uint8Array(n)]
      const pointer = { o }
      for (let l = 0; l < 2; l++) {
        for (let y = 0; y < ppm_h; y++) dec_line(bytes, pointer, types[l][y], frame_layers[l], y * ppm_w)
      }
      if (!is_key) {
        if (tx === 0 && ty === 0) {
          for (let i = 0; i < n; i++) {
            frame_layers[0][i] ^= prev[0][i]
            frame_layers[1][i] ^= prev[1][i]
          }
        } else {
          const sx0 = Math.max(tx, 0)
          const sy0 = Math.max(ty, 0)
          const ex = Math.min(ppm_w + tx, ppm_w)
          const ey = Math.min(ppm_h + ty, ppm_h)
          const shift = ty * ppm_w + tx
          for (let y = sy0; y < ey; y++) {
            for (let x = sx0; x < ex; x++) {
              const dest = y * ppm_w + x
              const src = dest - shift
              frame_layers[0][dest] ^= prev[0][src]
              frame_layers[1][dest] ^= prev[1][src]
            }
          }
        }
      }
      prev[0].set(frame_layers[0])
      prev[1].set(frame_layers[1])
      layers.push(frame_layers)
    } catch (error) {
      report_warning('PPMのフレーム' + (f + 1) + 'を最後まで解析できませんでした', error)
      decoded_frames = f
      break
    }
  }
  frame_count = decoded_frames
  if (frame_count < 1) return null

  const se_flag_off = 0x6a0 + anim_data_size
  let sound_off = se_flag_off + frame_count
  if (sound_off % 4 !== 0) sound_off += 4 - (sound_off % 4)
  const se_flags: number[] = []
  for (let f = 0; f < frame_count; f++) se_flags.push(se_flag_off + f < bytes.length ? bytes[se_flag_off + f] & 0x7 : 0)
  if (sound_off + 32 > bytes.length) {
    const spd = frame_speed_idx_safe(bytes, sound_off)
    return { thumb_idx, w: ppm_w, h: ppm_h, meta, frame_count, fps: ppm_speeds[spd] || 6, speed: spd, loop, paper, pen_idx, layers, se_flags, bgm: null, bgm_rate: 8180, bgm_fps: 0, se: [null, null, null] }
  }
  const bgm_len = dv_u32(d, sound_off)
  const se1_len = dv_u32(d, sound_off + 4)
  const se2_len = dv_u32(d, sound_off + 8)
  const se3_len = dv_u32(d, sound_off + 12)
  const speed = 8 - bytes[sound_off + 16]
  const bgm_speed = 8 - bytes[sound_off + 17]
  let tp = sound_off + 32
  let bgm: Int16Array | null = null
  const se: (Int16Array | null)[] = [null, null, null]
  if (bgm_len > 0) bgm = ppm_adpcm_decode(bytes.subarray(tp, tp + bgm_len))
  tp += bgm_len
  if (se1_len > 0) se[0] = ppm_adpcm_decode(bytes.subarray(tp, tp + se1_len))
  tp += se1_len
  if (se2_len > 0) se[1] = ppm_adpcm_decode(bytes.subarray(tp, tp + se2_len))
  tp += se2_len
  if (se3_len > 0) se[2] = ppm_adpcm_decode(bytes.subarray(tp, tp + se3_len))

  return {
    thumb_idx,
    w: ppm_w,
    h: ppm_h,
    meta,
    frame_count,
    fps: ppm_speeds[speed] || 6,
    speed,
    loop,
    paper,
    pen_idx,
    layers,
    se_flags,
    bgm,
    bgm_rate: 8180,
    bgm_fps: ppm_speeds[bgm_speed] || ppm_speeds[speed] || 6,
    se,
  }
}
