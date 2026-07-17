import { report_warning } from '../diagnostics'
import { ppm_adpcm_decode } from './adpcm'
import { bytes_to_hex, unix_from_nintendo_ts, ppm_filename_unpack, ppm_filename_format } from './fname'
import { flip_meta_zero, type FlipMeta } from './kwzdec'
import { PPM_H, PPM_W } from './ppm'

function frameSpeedIdxSafe(b: Uint8Array, soundOff: number): number {
  const p = soundOff + 16
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

export type PpmDecoded = {
  meta: FlipMeta
  w: number
  h: number
  frameCount: number
  fps: number
  speed: number
  loop: number
  paper: number[]
  thumbIdx: number
  penIdx: number[][]
  layers: Uint8Array[][]
  seFlags: number[]
  bgm: Int16Array | null
  bgmRate: number
  bgmFps: number
  se: (Int16Array | null)[]
}

const FPS_TABLE = [0, 0.5, 1, 2, 4, 6, 12, 20, 30]

function dv_u16(d: DataView, o: number): number {
  return d.getUint16(o, true)
}
function dv_u32(d: DataView, o: number): number {
  return d.getUint32(o, true)
}

function dec_line(bytes: Uint8Array, p: { o: number }, t: number, out: Uint8Array, rowBase: number): void {
  if (t === 0) return
  if (t === 3) {
    for (let c = 0; c < 32; c++) {
      const b = bytes[p.o++]
      for (let bit = 0; bit < 8; bit++) out[rowBase + c * 8 + bit] = (b >> bit) & 1
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
        for (let bit = 0; bit < 8; bit++) out[rowBase + c * 8 + bit] = (b >> bit) & 1
      } else {
        for (let bit = 0; bit < 8; bit++) out[rowBase + c * 8 + bit] = 1
      }
    } else {
      if (present) {
        const b = bytes[p.o++]
        for (let bit = 0; bit < 8; bit++) out[rowBase + c * 8 + bit] = (b >> bit) & 1
      }
    }
  }
}

export function ppm_decode(buf: ArrayBuffer): PpmDecoded | null {
  const bytes = new Uint8Array(buf)
  if (bytes.length < 0x6a0) return null
  const d = new DataView(buf)
  if (bytes[0] !== 0x50 || bytes[1] !== 0x41 || bytes[2] !== 0x52 || bytes[3] !== 0x41) return null
  const animDataSize = dv_u32(d, 4)
  let frameCount = dv_u16(d, 12) + 1
  if (frameCount > 999) frameCount = 999
  let thumbIdx = d.getInt16(0x12, true)
  if (thumbIdx < 0 || thumbIdx >= frameCount) thumbIdx = 0

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

  const animOff = 0x6a0
  const tableSize = dv_u16(d, animOff)
  const flags = dv_u16(d, animOff + 6)
  meta.flags = flags
  const loop = flags & 0x2 ? 1 : 0
  const offBase = animOff + 8 + tableSize
  const frameOffsets: number[] = []
  for (let i = 0; i < frameCount; i++) {
    const rel = animOff + 8 + i * 4
    if (rel + 4 > bytes.length) break
    const off = dv_u32(d, rel)
    if (offBase + off >= bytes.length) break
    frameOffsets.push(off)
  }
  if (frameOffsets.length < frameCount) frameCount = frameOffsets.length
  if (frameCount < 1) return null

  const layers: Uint8Array[][] = []
  const paper: number[] = []
  const penIdx: number[][] = []
  const N = PPM_W * PPM_H
  const prev: Uint8Array[] = [new Uint8Array(N), new Uint8Array(N)]
  let decodedFrames = frameCount
  for (let f = 0; f < frameCount; f++) {
    try {
      const start = offBase + frameOffsets[f]
      let o = start
      const header = bytes[o++]
      paper.push(header & 1)
      penIdx.push([(header >> 1) & 3, (header >> 3) & 3])
      const isKey = (header >> 7) & 1
      const isTranslated = (header >> 5) & 3
      let tx = 0
      let ty = 0
      if (isTranslated) {
        tx = (bytes[o] << 24) >> 24
        ty = (bytes[o + 1] << 24) >> 24
        o += 2
      }
      const types: number[][] = [new Array(PPM_H), new Array(PPM_H)]
      for (let l = 0; l < 2; l++) {
        for (let i = 0; i < 48; i++) {
          const value = bytes[o++]
          types[l][i * 4] = value & 3
          types[l][i * 4 + 1] = (value >> 2) & 3
          types[l][i * 4 + 2] = (value >> 4) & 3
          types[l][i * 4 + 3] = (value >> 6) & 3
        }
      }
      const frameLayers: Uint8Array[] = [new Uint8Array(N), new Uint8Array(N)]
      const pointer = { o }
      for (let l = 0; l < 2; l++) {
        for (let y = 0; y < PPM_H; y++) dec_line(bytes, pointer, types[l][y], frameLayers[l], y * PPM_W)
      }
      if (!isKey) {
        if (tx === 0 && ty === 0) {
          for (let i = 0; i < N; i++) {
            frameLayers[0][i] ^= prev[0][i]
            frameLayers[1][i] ^= prev[1][i]
          }
        } else {
          const sx0 = Math.max(tx, 0)
          const sy0 = Math.max(ty, 0)
          const ex = Math.min(PPM_W + tx, PPM_W)
          const ey = Math.min(PPM_H + ty, PPM_H)
          const shift = ty * PPM_W + tx
          for (let y = sy0; y < ey; y++) {
            for (let x = sx0; x < ex; x++) {
              const dest = y * PPM_W + x
              const src = dest - shift
              frameLayers[0][dest] ^= prev[0][src]
              frameLayers[1][dest] ^= prev[1][src]
            }
          }
        }
      }
      prev[0].set(frameLayers[0])
      prev[1].set(frameLayers[1])
      layers.push(frameLayers)
    } catch (error) {
      report_warning('PPMのフレーム' + (f + 1) + 'を最後まで解析できませんでした', error)
      decodedFrames = f
      break
    }
  }
  frameCount = decodedFrames
  if (frameCount < 1) return null

  const seFlagOff = 0x6a0 + animDataSize
  let soundOff = seFlagOff + frameCount
  if (soundOff % 4 !== 0) soundOff += 4 - (soundOff % 4)
  const seFlags: number[] = []
  for (let f = 0; f < frameCount; f++) seFlags.push(seFlagOff + f < bytes.length ? bytes[seFlagOff + f] & 0x7 : 0)
  if (soundOff + 32 > bytes.length) {
    const spd = frameSpeedIdxSafe(bytes, soundOff)
    return { thumbIdx, w: PPM_W, h: PPM_H, meta, frameCount, fps: FPS_TABLE[spd] || 6, speed: spd, loop, paper, penIdx, layers, seFlags, bgm: null, bgmRate: 8180, bgmFps: 0, se: [null, null, null] }
  }
  const bgmLen = dv_u32(d, soundOff)
  const se1Len = dv_u32(d, soundOff + 4)
  const se2Len = dv_u32(d, soundOff + 8)
  const se3Len = dv_u32(d, soundOff + 12)
  const speed = 8 - bytes[soundOff + 16]
  const bgmSpeed = 8 - bytes[soundOff + 17]
  let tp = soundOff + 32
  let bgm: Int16Array | null = null
  const se: (Int16Array | null)[] = [null, null, null]
  if (bgmLen > 0) bgm = ppm_adpcm_decode(bytes.subarray(tp, tp + bgmLen))
  tp += bgmLen
  if (se1Len > 0) se[0] = ppm_adpcm_decode(bytes.subarray(tp, tp + se1Len))
  tp += se1Len
  if (se2Len > 0) se[1] = ppm_adpcm_decode(bytes.subarray(tp, tp + se2Len))
  tp += se2Len
  if (se3Len > 0) se[2] = ppm_adpcm_decode(bytes.subarray(tp, tp + se3Len))

  return {
    thumbIdx,
    w: PPM_W,
    h: PPM_H,
    meta,
    frameCount,
    fps: FPS_TABLE[speed] || 6,
    speed,
    loop,
    paper,
    penIdx,
    layers,
    seFlags,
    bgm,
    bgmRate: 8180,
    bgmFps: FPS_TABLE[bgmSpeed] || FPS_TABLE[speed] || 6,
    se,
  }
}
