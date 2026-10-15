import { pixel_source_collect, pixel_source_restore, type pixel_source_asset_t } from './pixel_source'
import { binary_reader, binary_writer, crc32, reader_bytes, reader_f32, reader_left, reader_string, reader_u8, reader_u16, reader_u32, writer_bytes, writer_f32, writer_finish, writer_string, writer_u8, writer_u16, writer_u32 } from './binary'
import { kwz_frame_meta_clone, kwz_frame_meta_read, kwz_frame_meta_write, type kwz_frame_meta_t } from './codec/kwzmeta'
import { report_warning } from './diagnostics'
import { hold_max, l_base_n, l_draw_max, l_n, anim_fx_zero, note_meta_zero, type anim_fx_t, type frame_t, type note_meta_t, type rle_t } from './h'
import { pixel_valid } from './pixel'
import { clamp } from './lib'
import { mode_frame_limit } from './mode'
import { st } from './state/store'

const magic = 0x324e4755
const format_version = 8

export function rle_bytes(pk: rle_t): Uint8Array {
  const out = new Uint8Array(pk.length * 4)
  const dv = new DataView(out.buffer)
  for (let i = 0; i < pk.length; i++) dv.setUint32(i * 4, pk[i], true)
  return out
}

export function bytes_rle(b: Uint8Array): rle_t {
  const n = b.length >> 2
  const out = new Uint32Array(n)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  for (let i = 0; i < n; i++) out[i] = dv.getUint32(i * 4, true)
  return out
}

const slot_keys = ['bgm0', 'bgm1', 'se0', 'se1', 'se2', 'se3']

function slot_ref(k: string) {
  const g = st()
  if (k === 'bgm0') return g.snd.bgm[0]
  if (k === 'bgm1') return g.snd.bgm[1]
  return g.snd.se[parseInt(k.slice(2), 10)]
}

export type proj_snap_t = {
  w: number
  h: number
  fps: number
  loop: number
  pal_mode: number
  name: string
  ratio: string
  res: string
  paper: string
  lvis: number[]
  lalpha: number[]
  lord: number[]
  mode: number
  anim: anim_fx_t
  bgm_vol: number
  bgm_fps: number
  se_vol: number
  cur: number
  loop_a: number
  loop_b: number
  frames: { se: number, hold: number, paper?: string, kwz?: kwz_frame_meta_t, pk: (Uint8Array | null)[] }[]
  slots: { name: string, bytes: ArrayBuffer | null }[]
  meta: note_meta_t
  sources?: pixel_source_asset_t[]
  source_bytes?: { id: number, bytes: Uint8Array }[]
}

export function fmt_snapshot(): proj_snap_t {
  const g = st()
  const images = new Map<rle_t, Uint8Array>()
  function image_bytes(p: rle_t | null): Uint8Array | null {
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
  for (const k of slot_keys) {
    const s = slot_ref(k)
    slots.push({ name: s.name, bytes: s.bytes })
  }
  return {
    w: g.doc.w, h: g.doc.h, fps: g.doc.fps, loop: g.doc.loop, pal_mode: g.pen.pal_mode,
    name: g.doc.name, ratio: g.doc.ratio, res: g.doc.res, paper: g.doc.paper,
    lvis: [...g.doc.lvis], lalpha: [...g.doc.lalpha], lord: [...g.doc.lord],
    mode: g.doc.mode, anim: { ...g.doc.anim }, bgm_vol: g.snd.bgm_vol, bgm_fps: g.snd.bgm_fps, se_vol: g.snd.se_vol,
    cur: g.doc.cur, loop_a: g.doc.loop_a, loop_b: g.doc.loop_b,
    frames, slots, meta: { ...g.doc.meta }, sources: pixel_source_collect(g.doc.frames).map(({ id, file }) => ({ id, file })),
  }
}

function write_anim(w: ReturnType<typeof binary_writer>, anim: anim_fx_t): void {
  writer_u8(w, anim.wiggle)
  writer_f32(w, anim.wiggle_amount)
  writer_f32(w, anim.wiggle_cell)
  writer_f32(w, anim.wiggle_rate)
  writer_u8(w, anim.wiggle_phases)
  writer_u32(w, anim.wiggle_seed)
  writer_u8(w, anim.motion)
  writer_f32(w, anim.motion_amount)
  writer_f32(w, anim.motion_rate)
  writer_f32(w, anim.motion_anchor_x)
  writer_f32(w, anim.motion_anchor_y)
  writer_u32(w, anim.motion_seed)
}

function fmt_writer(p: proj_snap_t, source_count: number): ReturnType<typeof binary_writer> {
  const w = binary_writer(1 << 16)
  writer_u32(w, magic)
  let layer_slots = 9
  for (const layer of p.lord) layer_slots = Math.max(layer_slots, layer + 1)
  const unique = new Set<Uint8Array>()
  let repeated = 0
  for (const frame of p.frames) for (const image of frame.pk) {
    if (!image) continue
    if (unique.has(image)) repeated += image.byteLength
    else unique.add(image)
  }
  const compact = p.frames.some(f => f.pk.some(image => image && (image[3] & 0xc0) === 0x40))
  const version = source_count ? 8 : compact ? 7 : p.frames.some(f => f.kwz) ? 6 : p.frames.some(f => f.paper) ? 5 : layer_slots > 9 || repeated > (4 << 20) ? 4 : 3
  const images = new Map<Uint8Array, number>()
  writer_u32(w, version)
  writer_u16(w, p.w)
  writer_u16(w, p.h)
  writer_f32(w, p.fps)
  writer_u8(w, p.loop)
  writer_u8(w, p.pal_mode)
  writer_string(w, p.name)
  writer_string(w, p.ratio)
  writer_string(w, p.res)
  writer_string(w, p.paper)
  writer_u8(w, layer_slots)
  writer_u8(w, p.lord.length)
  for (let i = 0; i < layer_slots; i++) writer_u8(w, p.lvis[i] || 0)
  for (let i = 0; i < layer_slots; i++) writer_u8(w, p.lalpha[i] === undefined ? 255 : p.lalpha[i])
  for (const layer of p.lord) writer_u8(w, layer)
  writer_u8(w, p.mode)
  writer_f32(w, p.bgm_vol)
  writer_f32(w, p.bgm_fps)
  writer_f32(w, p.se_vol)
  write_anim(w, p.anim)
  writer_u16(w, p.frames.length)
  writer_u16(w, p.cur)
  writer_u16(w, p.loop_a < 0 ? 0xffff : p.loop_a)
  writer_u16(w, p.loop_b < 0 ? 0xffff : p.loop_b)
  for (const f of p.frames) {
    writer_u8(w, f.se)
    writer_u8(w, f.hold)
    if (version >= 5) writer_string(w, f.paper || '')
    if (version >= 6) kwz_frame_meta_write(w, f.kwz)
    for (let l = 0; l < layer_slots; l++) {
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
  return w
}

export function fmt_build(p: proj_snap_t): Uint8Array {
  if (p.sources?.length && !p.source_bytes) throw new Error('動画を含む作品は非同期の保存処理を使ってください')
  const sources = p.source_bytes || [], w = fmt_writer(p, sources.length)
  if (sources.length) {
    writer_u32(w, sources.length)
    for (const source of sources) { writer_u32(w, source.id); writer_u32(w, source.bytes.length); writer_u32(w, 0); writer_bytes(w, source.bytes) }
  }
  writer_u32(w, crc32(w.buf.subarray(0, w.len), 0))
  return writer_finish(w)
}

export async function fmt_build_blob(p: proj_snap_t): Promise<Blob> {
  const sources = p.sources || []
  const header = (() => {
    const writer = fmt_writer(p, sources.length)
    if (sources.length) writer_u32(writer, sources.length)
    return writer_finish(writer)
  })()
  const parts: BlobPart[] = [header as BlobPart]
  for (const source of sources) {
    const entry = new Uint8Array(12), view = new DataView(entry.buffer)
    view.setUint32(0, source.id, true); view.setUint32(4, source.file.size % 0x100000000, true); view.setUint32(8, Math.floor(source.file.size / 0x100000000), true)
    parts.push(entry, source.file)
  }
  const body = new Blob(parts)
  let checksum = 0
  const reader = body.stream().getReader()
  try { for (;;) { const part = await reader.read(); if (part.done) break; checksum = crc32(part.value, checksum) } }
  finally { reader.releaseLock() }
  const end = new Uint8Array(4)
  new DataView(end.buffer).setUint32(0, checksum, true)
  return new Blob([body, end], { type: 'application/octet-stream' })
}

export type loaded_project_t = {
  meta: note_meta_t
  w: number
  h: number
  fps: number
  loop: number
  pal_mode: number
  name: string
  ratio: string
  res: string
  paper: string
  lvis: Uint8Array
  lalpha: Uint8Array
  lord: number[]
  mode: number
  anim: anim_fx_t
  bgm_vol: number
  bgm_fps: number
  se_vol: number
  frames: frame_t[]
  cur: number
  loop_a: number
  loop_b: number
  slots: { name: string, bytes: ArrayBuffer | null }[]
}

export function fmt_save(): Uint8Array {
  return fmt_build(fmt_snapshot())
}

function read_anim(r: ReturnType<typeof binary_reader>): anim_fx_t {
  const anim = anim_fx_zero()
  anim.wiggle = reader_u8(r)
  anim.wiggle_amount = reader_f32(r)
  anim.wiggle_cell = reader_f32(r)
  anim.wiggle_rate = reader_f32(r)
  anim.wiggle_phases = reader_u8(r)
  anim.wiggle_seed = reader_u32(r)
  anim.motion = reader_u8(r)
  anim.motion_amount = reader_f32(r)
  anim.motion_rate = reader_f32(r)
  anim.motion_anchor_x = reader_f32(r)
  anim.motion_anchor_y = reader_f32(r)
  anim.motion_seed = reader_u32(r)
  return anim
}

function fmt_parse_inner(bytes: Uint8Array): loaded_project_t | null {
  if (bytes.length < 32) return null
  const body = bytes.subarray(0, bytes.length - 4)
  const dv = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 4, 4)
  if (dv.getUint32(0, true) !== crc32(body, 0)) return null
  const r = binary_reader(body)
  if (reader_u32(r) !== magic) return null
  const version = reader_u32(r)
  if (version < 1 || version > format_version) return null
  const w = reader_u16(r)
  const h = reader_u16(r)
  if (w < 8 || h < 8 || w > 4096 || h > 4096) return null
  const fps = reader_f32(r)
  const loop = reader_u8(r)
  const pal_mode = reader_u8(r)
  const name = reader_string(r)
  const ratio = reader_string(r)
  const res = reader_string(r)
  const paper = reader_string(r)
  let layer_slots = l_base_n
  let order_count = 3
  if (version >= 3) {
    layer_slots = reader_u8(r)
    order_count = reader_u8(r)
    if (layer_slots < l_base_n || layer_slots > l_n || order_count < 1 || order_count > l_draw_max) return null
  }
  const lvis = new Uint8Array(l_n)
  for (let i = 0; i < layer_slots; i++) lvis[i] = reader_u8(r)
  const lalpha = new Uint8Array(l_n)
  lalpha.fill(255)
  for (let i = 0; i < layer_slots; i++) lalpha[i] = reader_u8(r)
  const lord: number[] = []
  for (let i = 0; i < order_count; i++) lord.push(reader_u8(r))
  const mode = reader_u8(r)
  const bgm_vol = reader_f32(r)
  const bgm_fps = reader_f32(r)
  const se_vol = reader_f32(r)
  const anim = version >= 3 ? read_anim(r) : anim_fx_zero()
  const fcount = reader_u16(r)
  const cur = reader_u16(r)
  const la = reader_u16(r)
  const lb = reader_u16(r)
  const loop_a = la === 0xffff ? -1 : la
  const loop_b = lb === 0xffff ? -1 : lb
  if (fcount < 1 || fcount > mode_frame_limit(mode)) return null
  const frames: frame_t[] = []
  const images: rle_t[] = []
  for (let i = 0; i < fcount; i++) {
    if (reader_left(r) < 2 + 4 * layer_slots) return null
    const se = reader_u8(r)
    const hold = clamp(reader_u8(r), 1, hold_max)
    const frame_paper = version >= 5 ? reader_string(r) : ''
    if (frame_paper && !/^#[0-9a-f]{6}(00)?$/i.test(frame_paper)) return null
    const kwz = version >= 6 ? kwz_frame_meta_read(r) : undefined
    const pk: (rle_t | null)[] = new Array<rle_t | null>(l_n).fill(null)
    for (let l = 0; l < layer_slots; l++) {
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
    frames.push({ id: -1, se, hold, paper: frame_paper || undefined, kwz, pk })
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
  const sources: pixel_source_asset_t[] = []
  if (version >= 8) {
    const count = reader_u32(r)
    if (count > fcount * layer_slots) return null
    for (let i = 0; i < count; i++) {
      const id = reader_u32(r), length = reader_u32(r) + reader_u32(r) * 0x100000000
      if (!id || !Number.isSafeInteger(length) || !length || length > reader_left(r) || sources.some(source => source.id === id)) return null
      sources.push({ id, file: new Blob([reader_bytes(r, length) as BlobPart]) })
    }
  }
  pixel_source_restore(frames, sources)
  return { w, h, fps, loop, pal_mode, name, ratio, res, paper, lvis, lalpha, lord, mode, anim, bgm_vol, bgm_fps, se_vol, frames, cur, loop_a, loop_b, slots, meta }
}

export function fmt_parse(bytes: Uint8Array): loaded_project_t | null {
  try {
    return fmt_parse_inner(bytes)
  } catch (error) {
    report_warning('UGN2プロジェクトを解析できませんでした', error)
    return null
  }
}
