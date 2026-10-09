import { binary_reader, binary_writer, crc32, reader_bytes, reader_f32, reader_left, reader_string, reader_u8, reader_u16, reader_u32, writer_bytes, writer_f32, writer_finish, writer_string, writer_u8, writer_u16, writer_u32 } from './binary'
import { kwz_frame_meta_clone, kwz_frame_meta_read, kwz_frame_meta_write, type KwzFrameMeta } from './codec/kwzmeta'
import { report_warning } from './diagnostics'
import { HOLD_MAX, L_BASE_N, L_DRAW_MAX, L_N, anim_fx_zero, note_meta_zero, type AnimFx, type Frame, type NoteMeta, type Rle } from './h'
import { pixel_valid } from './pixel'
import { clamp } from './lib'
import { mode_frame_limit } from './mode'
import { st } from './state/store'

const MAGIC = 0x324e4755
const FORMAT_VERSION = 6

export function rle_bytes(pk: Rle): Uint8Array {
  const out = new Uint8Array(pk.length * 4)
  const dv = new DataView(out.buffer)
  for (let i = 0; i < pk.length; i++) dv.setUint32(i * 4, pk[i], true)
  return out
}

export function bytes_rle(b: Uint8Array): Rle {
  const n = b.length >> 2
  const out = new Uint32Array(n)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  for (let i = 0; i < n; i++) out[i] = dv.getUint32(i * 4, true)
  return out
}

const SLOT_KEYS = ['bgm0', 'bgm1', 'se0', 'se1', 'se2', 'se3']

function slot_ref(k: string) {
  const g = st()
  if (k === 'bgm0') return g.snd.bgm[0]
  if (k === 'bgm1') return g.snd.bgm[1]
  return g.snd.se[parseInt(k.slice(2), 10)]
}

export type ProjSnap = {
  w: number
  h: number
  fps: number
  loop: number
  palMode: number
  name: string
  ratio: string
  res: string
  paper: string
  lvis: number[]
  lalpha: number[]
  lord: number[]
  mode: number
  anim: AnimFx
  bgmVol: number
  bgmFps: number
  seVol: number
  cur: number
  loopA: number
  loopB: number
  frames: { se: number, hold: number, paper?: string, kwz?: KwzFrameMeta, pk: (Uint8Array | null)[] }[]
  slots: { name: string, bytes: ArrayBuffer | null }[]
  meta: NoteMeta
}

export function fmt_snapshot(): ProjSnap {
  const g = st()
  const images = new Map<Rle, Uint8Array>()
  function image_bytes(p: Rle | null): Uint8Array | null {
    if (!p) return null
    let bytes = images.get(p)
    if (!bytes) { bytes = rle_bytes(p); images.set(p, bytes) }
    return bytes
  }
  const frames = g.doc.frames.map(f => ({
    se: f.se,
    hold: f.hold,
    paper: f.paper,
    kwz: kwz_frame_meta_clone(f.kwz),
    pk: f.pk.map(image_bytes),
  }))
  const slots: { name: string, bytes: ArrayBuffer | null }[] = []
  for (const k of SLOT_KEYS) {
    const s = slot_ref(k)
    slots.push({ name: s.name, bytes: s.bytes })
  }
  return {
    w: g.doc.w, h: g.doc.h, fps: g.doc.fps, loop: g.doc.loop, palMode: g.pen.palMode,
    name: g.doc.name, ratio: g.doc.ratio, res: g.doc.res, paper: g.doc.paper,
    lvis: [...g.doc.lvis], lalpha: [...g.doc.lalpha], lord: [...g.doc.lord],
    mode: g.doc.mode, anim: { ...g.doc.anim }, bgmVol: g.snd.bgmVol, bgmFps: g.snd.bgmFps, seVol: g.snd.seVol,
    cur: g.doc.cur, loopA: g.doc.loopA, loopB: g.doc.loopB,
    frames, slots, meta: { ...g.doc.meta },
  }
}

function write_anim(w: ReturnType<typeof binary_writer>, anim: AnimFx): void {
  writer_u8(w, anim.wiggle)
  writer_f32(w, anim.wiggleAmount)
  writer_f32(w, anim.wiggleCell)
  writer_f32(w, anim.wiggleRate)
  writer_u8(w, anim.wigglePhases)
  writer_u32(w, anim.wiggleSeed)
  writer_u8(w, anim.motion)
  writer_f32(w, anim.motionAmount)
  writer_f32(w, anim.motionRate)
  writer_f32(w, anim.motionAnchorX)
  writer_f32(w, anim.motionAnchorY)
  writer_u32(w, anim.motionSeed)
}

export function fmt_build(p: ProjSnap): Uint8Array {
  const w = binary_writer(1 << 16)
  writer_u32(w, MAGIC)
  let layerSlots = 9
  for (const layer of p.lord) layerSlots = Math.max(layerSlots, layer + 1)
  const unique = new Set<Uint8Array>()
  let repeated = 0
  for (const frame of p.frames) for (const image of frame.pk) {
    if (!image) continue
    if (unique.has(image)) repeated += image.byteLength
    else unique.add(image)
  }
  const version = p.frames.some(f => f.kwz) ? 6 : p.frames.some(f => f.paper) ? 5 : layerSlots > 9 || repeated > (4 << 20) ? 4 : 3
  const images = new Map<Uint8Array, number>()
  writer_u32(w, version)
  writer_u16(w, p.w)
  writer_u16(w, p.h)
  writer_f32(w, p.fps)
  writer_u8(w, p.loop)
  writer_u8(w, p.palMode)
  writer_string(w, p.name)
  writer_string(w, p.ratio)
  writer_string(w, p.res)
  writer_string(w, p.paper)
  writer_u8(w, layerSlots)
  writer_u8(w, p.lord.length)
  for (let i = 0; i < layerSlots; i++) writer_u8(w, p.lvis[i] || 0)
  for (let i = 0; i < layerSlots; i++) writer_u8(w, p.lalpha[i] === undefined ? 255 : p.lalpha[i])
  for (const layer of p.lord) writer_u8(w, layer)
  writer_u8(w, p.mode)
  writer_f32(w, p.bgmVol)
  writer_f32(w, p.bgmFps)
  writer_f32(w, p.seVol)
  write_anim(w, p.anim)
  writer_u16(w, p.frames.length)
  writer_u16(w, p.cur)
  writer_u16(w, p.loopA < 0 ? 0xffff : p.loopA)
  writer_u16(w, p.loopB < 0 ? 0xffff : p.loopB)
  for (const f of p.frames) {
    writer_u8(w, f.se)
    writer_u8(w, f.hold)
    if (version >= 5) writer_string(w, f.paper || '')
    if (version >= 6) kwz_frame_meta_write(w, f.kwz)
    for (let l = 0; l < layerSlots; l++) {
      const b = f.pk[l]
      if (!b) {
        writer_u32(w, 0)
        continue
      }
      const ref = version >= 4 ? images.get(b) : undefined
      if (ref !== undefined) writer_u32(w, 0x80000000 | ref)
      else {
        if (version >= 4) images.set(b, images.size)
        writer_u32(w, b.length)
        writer_bytes(w, b)
      }
    }
  }
  for (const s of p.slots) {
    if (!s.bytes) {
      writer_u8(w, 0)
      continue
    }
    writer_u8(w, 1)
    writer_string(w, s.name)
    const b = new Uint8Array(s.bytes)
    writer_u32(w, b.length)
    writer_bytes(w, b)
  }
  const mt = p.meta
  writer_string(w, mt.root_name)
  writer_string(w, mt.parent_name)
  writer_string(w, mt.cur_name)
  writer_string(w, mt.root_id)
  writer_string(w, mt.parent_id)
  writer_string(w, mt.cur_id)
  writer_string(w, mt.root_fn)
  writer_string(w, mt.parent_fn)
  writer_string(w, mt.cur_fn)
  writer_u32(w, mt.created)
  writer_u32(w, mt.modified)
  writer_u16(w, mt.edits)
  writer_u8(w, mt.lock)
  writer_u16(w, mt.flags)
  writer_u16(w, mt.layer_flags)
  writer_u32(w, mt.app_ver)
  const body = writer_finish(w)
  const out = binary_writer(body.length + 4)
  writer_bytes(out, body)
  writer_u32(out, crc32(body, 0))
  return writer_finish(out)
}

export type LoadedProject = {
  meta: NoteMeta
  w: number
  h: number
  fps: number
  loop: number
  palMode: number
  name: string
  ratio: string
  res: string
  paper: string
  lvis: Uint8Array
  lalpha: Uint8Array
  lord: number[]
  mode: number
  anim: AnimFx
  bgmVol: number
  bgmFps: number
  seVol: number
  frames: Frame[]
  cur: number
  loopA: number
  loopB: number
  slots: { name: string, bytes: ArrayBuffer | null }[]
}

export function fmt_save(): Uint8Array {
  return fmt_build(fmt_snapshot())
}

function read_anim(r: ReturnType<typeof binary_reader>): AnimFx {
  const anim = anim_fx_zero()
  anim.wiggle = reader_u8(r)
  anim.wiggleAmount = reader_f32(r)
  anim.wiggleCell = reader_f32(r)
  anim.wiggleRate = reader_f32(r)
  anim.wigglePhases = reader_u8(r)
  anim.wiggleSeed = reader_u32(r)
  anim.motion = reader_u8(r)
  anim.motionAmount = reader_f32(r)
  anim.motionRate = reader_f32(r)
  anim.motionAnchorX = reader_f32(r)
  anim.motionAnchorY = reader_f32(r)
  anim.motionSeed = reader_u32(r)
  return anim
}

function fmt_parse_inner(bytes: Uint8Array): LoadedProject | null {
  if (bytes.length < 32) return null
  const body = bytes.subarray(0, bytes.length - 4)
  const dv = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 4, 4)
  if (dv.getUint32(0, true) !== crc32(body, 0)) return null
  const r = binary_reader(body)
  if (reader_u32(r) !== MAGIC) return null
  const version = reader_u32(r)
  if (version < 1 || version > FORMAT_VERSION) return null
  const w = reader_u16(r)
  const h = reader_u16(r)
  if (w < 8 || h < 8 || w > 4096 || h > 4096) return null
  const fps = reader_f32(r)
  const loop = reader_u8(r)
  const palMode = reader_u8(r)
  const name = reader_string(r)
  const ratio = reader_string(r)
  const res = reader_string(r)
  const paper = reader_string(r)
  let layerSlots = L_BASE_N
  let orderCount = 3
  if (version >= 3) {
    layerSlots = reader_u8(r)
    orderCount = reader_u8(r)
    if (layerSlots < L_BASE_N || layerSlots > L_N || orderCount < 1 || orderCount > L_DRAW_MAX) return null
  }
  const lvis = new Uint8Array(L_N)
  for (let i = 0; i < layerSlots; i++) lvis[i] = reader_u8(r)
  const lalpha = new Uint8Array(L_N)
  lalpha.fill(255)
  for (let i = 0; i < layerSlots; i++) lalpha[i] = reader_u8(r)
  const lord: number[] = []
  for (let i = 0; i < orderCount; i++) lord.push(reader_u8(r))
  const mode = reader_u8(r)
  const bgmVol = reader_f32(r)
  const bgmFps = reader_f32(r)
  const seVol = reader_f32(r)
  const anim = version >= 3 ? read_anim(r) : anim_fx_zero()
  const fcount = reader_u16(r)
  const cur = reader_u16(r)
  const la = reader_u16(r)
  const lb = reader_u16(r)
  const loopA = la === 0xffff ? -1 : la
  const loopB = lb === 0xffff ? -1 : lb
  if (fcount < 1 || fcount > mode_frame_limit(mode)) return null
  const frames: Frame[] = []
  const images: Rle[] = []
  for (let i = 0; i < fcount; i++) {
    if (reader_left(r) < 2 + 4 * layerSlots) return null
    const se = reader_u8(r)
    const hold = clamp(reader_u8(r), 1, HOLD_MAX)
    const framePaper = version >= 5 ? reader_string(r) : ''
    if (framePaper && !/^#[0-9a-f]{6}(00)?$/i.test(framePaper)) return null
    const kwz = version >= 6 ? kwz_frame_meta_read(r) : undefined
    const pk: (Rle | null)[] = new Array<Rle | null>(L_N).fill(null)
    for (let l = 0; l < layerSlots; l++) {
      const n = reader_u32(r)
      if (n === 0) continue
      if (version >= 4 && (n & 0x80000000)) {
        const ref = n & 0x7fffffff
        if (ref >= images.length) return null
        pk[l] = images[ref]
        continue
      }
      if (n > reader_left(r) || (n & 3) !== 0) return null
      const packed = bytes_rle(reader_bytes(r, n))
      if (!pixel_valid(packed, w * h)) return null
      pk[l] = packed
      if (version >= 4) images.push(packed)
    }
    frames.push({ id: -1, se, hold, paper: framePaper || undefined, kwz, pk })
  }
  const slots: { name: string, bytes: ArrayBuffer | null }[] = []
  for (let i = 0; i < 6; i++) {
    slots.push({ name: '', bytes: null })
    if (reader_left(r) < 1) continue
    if (!reader_u8(r)) continue
    slots[i].name = reader_string(r)
    const n = reader_u32(r)
    if (n > reader_left(r)) return null
    const b = reader_bytes(r, n)
    slots[i].bytes = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  }
  const meta = note_meta_zero()
  if (reader_left(r) > 0) {
    meta.root_name = reader_string(r)
    meta.parent_name = reader_string(r)
    meta.cur_name = reader_string(r)
    meta.root_id = reader_string(r)
    meta.parent_id = reader_string(r)
    meta.cur_id = reader_string(r)
    meta.root_fn = reader_string(r)
    meta.parent_fn = reader_string(r)
    meta.cur_fn = reader_string(r)
    meta.created = reader_u32(r)
    meta.modified = reader_u32(r)
    meta.edits = reader_u16(r)
    meta.lock = reader_u8(r)
    meta.flags = reader_u16(r)
    if (version >= 2) meta.layer_flags = reader_u16(r)
    meta.app_ver = reader_u32(r)
  }
  return { w, h, fps, loop, palMode, name, ratio, res, paper, lvis, lalpha, lord, mode, anim, bgmVol, bgmFps, seVol, frames, cur, loopA, loopB, slots, meta }
}

export function fmt_parse(bytes: Uint8Array): LoadedProject | null {
  try {
    return fmt_parse_inner(bytes)
  } catch (error) {
    report_warning('UGN2プロジェクトを解析できませんでした', error)
    return null
  }
}
