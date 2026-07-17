import { animfx_active, animfx_cache_clear } from '../../animfx'
import { animfx_normalize } from '../../animset'
import { rand_hex } from '../../codec/fname'
import { KWZ_BORDER, KWZ_CANVAS_W, KWZ_CANVAS_H, KWZ_FRAME_W, KWZ_FRAME_H } from '../../codec/kwzgeom'
import { doc_boot_size, doc_cache_clear, doc_crop_frames, doc_frame_new, doc_resize, doc_transform_all, doc_unpack_live, frame_id_next, frame_id_seed } from '../../doc'
import { snd_buf_set } from '../../engine'
import type { LoadedProject } from '../../fmt'
import { canvas_flip, canvas_rot90 } from '../../gfx'
import { D_ALL, ERR_BAD, ERR_FULL, HOLD_MAX, L_BASE_N, L_DRAW_DEFAULT, L_DRAW_MAX, L_N, MODE_3D, MODE_NORMAL, PAL_STD, anim_fx_zero, note_meta_zero, type Frame, type MarkDef, type NoteMeta } from '../../h'
import { hist_clear } from '../../hist'
import { clamp } from '../../lib'
import { mode_allows_runtime_anim, mode_canvas, mode_frame_limit, mode_ink, mode_name, mode_order, mode_pal, mode_paper_opts } from '../../mode'
import { flo_cancel, sel_clear } from '../../sel'
import { snd_apply_vol, snd_load_epoch_bump, snd_restore_slots, snd_stop_all } from '../../snd'
import { thumb_clear } from '../../thumb'
import { fx_sfx, fx_toast } from '../fx_hooks'
import { doc_reset, type Globals } from '../store'
import { anim_playing, PLAY_COMMANDS } from './play'
import { VIEW_COMMANDS } from './view'

function meta_fresh(): NoteMeta {
  const m = note_meta_zero()
  const now = Math.floor(Date.now() / 1000)
  m.created = now
  m.modified = now
  m.cur_id = '0' + rand_hex(6) + '0' + rand_hex(8)
  m.root_id = m.cur_id
  m.parent_id = m.cur_id
  m.cur_fn = rand_hex(6) + '_' + rand_hex(13) + '_000'
  m.root_fn = m.cur_fn
  m.parent_fn = m.cur_fn
  return m
}

export type FlipLoaded = {
  meta: NoteMeta
  mode: number
  w: number
  h: number
  ratio: string
  res: string
  fps: number
  loop: number
  paper: string
  frames: Frame[]
  cur: number
  bgm: Int16Array | null
  bgmRate: number
  bgmFps: number
  se: (Int16Array | null)[]
}

export type Cmds = {
  'project.boot_prefs': { mobile: number, marks: MarkDef[], custom: string[] }
  'project.boot_empty': null
  'project.set_booted': null
  'project.new': { w: number, h: number, ratio: string, res: string, paper: string, name: string }
  'project.apply_loaded': LoadedProject
  'project.apply_flip': FlipLoaded
  'project.resize_canvas': { w: number, h: number, ratio: string, res: string, quiet?: number }
  'project.transform_all': string
  'project.set_mode': number
}

function visual_cache_clear(): void {
  doc_cache_clear()
  animfx_cache_clear()
}

function stop_all(g: Globals): void {
  if (anim_playing()) PLAY_COMMANDS['play.stop'](g, null)
  else snd_stop_all()
  flo_cancel(g)
  sel_clear(g)
}

function mode_normalize(g: Globals): void {
  const mode = g.doc.mode
  g.pen.palMode = mode_pal(mode)
  const inks = mode_ink(mode)
  const activeLayers = mode_order(mode, g.doc.lord)
  if (activeLayers.indexOf(g.pen.layer) < 0) g.pen.layer = activeLayers[0] || 1
  if (!mode_allows_runtime_anim(mode)) {
    g.doc.anim = anim_fx_zero()
    const up = g.pen.color.toUpperCase()
    if (!inks.some(c => c.toUpperCase() === up)) g.pen.color = inks[0]
    const papers = mode_paper_opts(mode)
    const pu = g.doc.paper.toUpperCase()
    if (!papers.some(c => c.toUpperCase() === pu)) g.doc.paper = papers[0]
  }
}

function slot_ref(g: Globals, i: number) {
  return i === 0 ? g.snd.bgm[0] : i === 1 ? g.snd.bgm[1] : g.snd.se[i - 2]
}

function valid_size(w: number, h: number): boolean {
  return Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= 4096 && h <= 4096
}

function valid_rle(packed: unknown, pixelCount: number): boolean {
  if (packed === null) return true
  if (!(packed instanceof Uint32Array) || packed.length < 1) return false
  const header = packed[0]
  const decodedLength = header & 0x7fffffff
  if (decodedLength !== pixelCount) return false
  if (header & 0x80000000) return packed.length === pixelCount + 1
  if ((packed.length & 1) === 0) return false
  let total = 0
  for (let index = 1; index < packed.length; index += 2) {
    const count = packed[index]
    if (count < 1 || total + count > pixelCount) return false
    total += count
  }
  return total === pixelCount
}

function valid_project(w: number, h: number, frames: readonly Frame[], mode: number): boolean {
  if (!valid_size(w, h) || !Array.isArray(frames) || frames.length < 1 || frames.length > mode_frame_limit(mode)) return false
  const pixelCount = w * h
  for (const frame of frames) {
    if (!frame || !Array.isArray(frame.pk) || frame.pk.length < L_BASE_N || frame.pk.length > L_N) return false
    for (const packed of frame.pk) if (!valid_rle(packed, pixelCount)) return false
  }
  return true
}

function finite_clamp(value: number, lo: number, hi: number, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? clamp(numeric, lo, hi) : fallback
}

function finite_index(value: number, length: number, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? clamp(Math.trunc(numeric), 0, length - 1) : fallback
}

function normalized_string(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback
}

function normalized_uint(value: unknown, max: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? clamp(Math.trunc(numeric), 0, max) : 0
}

function normalize_meta(source: NoteMeta | null | undefined): NoteMeta {
  const meta = note_meta_zero()
  if (!source || typeof source !== 'object') return meta
  meta.root_name = normalized_string(source.root_name, '', 64)
  meta.parent_name = normalized_string(source.parent_name, '', 64)
  meta.cur_name = normalized_string(source.cur_name, '', 64)
  meta.root_id = normalized_string(source.root_id, '', 64)
  meta.parent_id = normalized_string(source.parent_id, '', 64)
  meta.cur_id = normalized_string(source.cur_id, '', 64)
  meta.root_fn = normalized_string(source.root_fn, '', 96)
  meta.parent_fn = normalized_string(source.parent_fn, '', 96)
  meta.cur_fn = normalized_string(source.cur_fn, '', 96)
  meta.created = normalized_uint(source.created, 0xffffffff)
  meta.modified = normalized_uint(source.modified, 0xffffffff)
  meta.edits = normalized_uint(source.edits, 0xffff)
  meta.lock = normalized_uint(source.lock, 1)
  meta.flags = normalized_uint(source.flags, 0xffff)
  meta.layer_flags = normalized_uint(source.layer_flags, 0xffff)
  meta.app_ver = normalized_uint(source.app_ver, 0xffffffff)
  return meta
}

function normalize_hex(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9A-F]{6}$/i.test(value) ? value.toUpperCase() : fallback
}

function normalize_ratio(value: unknown): string {
  return typeof value === 'string' && ['4:3', '16:9', '1:1', '3:4', '9:16'].includes(value) ? value : '4:3'
}

function normalize_resolution(value: unknown): string {
  return typeof value === 'string' && ['low', 'mid', 'hd', 'dsi', '3ds'].includes(value) ? value : 'low'
}

function normalize_frames(frames: Frame[]): void {
  let maxId = 0
  for (const frame of frames) {
    if (Number.isSafeInteger(frame.id) && frame.id >= 0 && frame.id < 0x7fffffff) maxId = Math.max(maxId, frame.id)
  }
  frame_id_seed(maxId + 1)
  const used = new Set<number>()
  for (const frame of frames) {
    if (!Number.isSafeInteger(frame.id) || frame.id < 0 || frame.id >= 0x7fffffff || used.has(frame.id)) frame.id = frame_id_next()
    used.add(frame.id)
    frame.se = Number.isFinite(frame.se) ? Math.max(0, Math.min(15, Math.trunc(frame.se))) : 0
    frame.hold = Number.isFinite(frame.hold) ? clamp(Math.round(frame.hold), 1, HOLD_MAX) : 1
    if (frame.pk.length > L_N) frame.pk.length = L_N
    while (frame.pk.length < L_N) frame.pk.push(null)
  }
}

function normalize_u8(src: ArrayLike<number> | null | undefined, n: number, fallback: number): Uint8Array {
  const out = new Uint8Array(n)
  out.fill(fallback)
  if (!src) return out
  const m = Math.min(n, src.length)
  for (let i = 0; i < m; i++) {
    const value = Number(src[i])
    out[i] = Number.isFinite(value) ? clamp(Math.round(value), 0, 255) : fallback
  }
  return out
}

function normalize_vis(src: ArrayLike<number> | null | undefined): Uint8Array {
  const out = new Uint8Array(L_N)
  out.fill(1)
  if (!src) return out
  const n = Math.min(out.length, src.length)
  for (let i = 0; i < n; i++) out[i] = Number(src[i]) ? 1 : 0
  return out
}

function normalize_order(src: readonly number[] | null | undefined): number[] {
  const out: number[] = []
  if (src) {
    for (const value of src) {
      const layer = Math.trunc(Number(value))
      if (layer < 1 || layer > L_DRAW_MAX || out.indexOf(layer) >= 0) continue
      out.push(layer)
    }
  }
  for (let layer = 1; layer <= L_DRAW_DEFAULT; layer++) if (out.indexOf(layer) < 0) out.push(layer)
  return out
}

function clear_sound_slots(g: Globals): void {
  for (const slot of g.snd.bgm) {
    slot.bytes = null
    slot.name = ''
  }
  for (const slot of g.snd.se) {
    slot.bytes = null
    slot.name = ''
  }
  g.snd.bgmFps = 0
  for (const k of ['bgm0', 'bgm1', 'se0', 'se1', 'se2', 'se3']) snd_buf_set(k, null)
}

export const PROJECT_COMMANDS = {
  'project.boot_prefs': (g: Globals, p: { mobile: number, marks: MarkDef[], custom: string[] }): number => {
    g.mobile = p.mobile
    g.marks = p.marks
    g.pen.custom = p.custom
    return 0
  },

  'project.boot_empty': (g: Globals, _p: null): number => {
    g.doc.frames = [doc_frame_new()]
    g.doc.cur = 0
    return 0
  },

  'project.set_booted': (g: Globals, _p: null): number => {
    g.booted = 1
    return 0
  },

  'project.new': (g: Globals, p: { w: number, h: number, ratio: string, res: string, paper: string, name: string }): number => {
    if (!valid_size(p.w, p.h)) return ERR_BAD
    snd_load_epoch_bump()
    stop_all(g)
    doc_reset(g, p.w, p.h, p.ratio, p.res, p.paper)
    return project_new_body(g, p.name)
  },

  'project.apply_loaded': (g: Globals, d: LoadedProject): number => {
    const mode = Number.isInteger(d.mode) && d.mode >= 0 && d.mode <= 2 ? d.mode : MODE_NORMAL
    if (!valid_project(d.w, d.h, d.frames, mode)) return ERR_BAD
    snd_load_epoch_bump()
    stop_all(g)
    let w = d.w
    let h = d.h
    let ratio = normalize_ratio(d.ratio)
    let res = normalize_resolution(d.res)
    if (mode === MODE_3D && w === KWZ_FRAME_W && h === KWZ_FRAME_H) {
      doc_crop_frames(d.frames, w, h, KWZ_BORDER, KWZ_BORDER, KWZ_CANVAS_W, KWZ_CANVAS_H)
      w = KWZ_CANVAS_W
      h = KWZ_CANVAS_H
      ratio = '4:3'
      res = '3ds'
    }
    g.doc.w = w
    g.doc.h = h
    g.doc.fps = finite_clamp(d.fps, 0.5, 30, 12)
    g.doc.loop = d.loop ? 1 : 0
    g.pen.palMode = Number.isInteger(d.palMode) && d.palMode >= 0 && d.palMode <= 2 ? d.palMode : PAL_STD
    g.doc.name = normalized_string(d.name, 'むだいのノート', 40) || 'むだいのノート'
    g.doc.ratio = ratio
    g.doc.res = res
    g.doc.paper = normalize_hex(d.paper, '#FFFFFF')
    g.doc.lvis = normalize_vis(d.lvis)
    g.doc.lalpha = normalize_u8(d.lalpha, L_N, 255)
    g.doc.lord = normalize_order(d.lord)
    g.doc.mode = mode
    g.doc.anim = animfx_normalize(d.anim)
    mode_normalize(g)
    g.snd.bgmVol = finite_clamp(d.bgmVol, 0, 1, 1)
    g.snd.seVol = finite_clamp(d.seVol, 0, 1, 1)
    g.doc.meta = normalize_meta(d.meta)
    normalize_frames(d.frames)
    g.doc.frames = d.frames
    g.doc.cur = finite_index(d.cur, d.frames.length, 0)
    g.doc.loopA = Number.isInteger(d.loopA) && d.loopA >= 0 && d.loopA < d.frames.length ? d.loopA : -1
    g.doc.loopB = Number.isInteger(d.loopB) && d.loopB >= 0 && d.loopB < d.frames.length ? d.loopB : -1
    if (g.doc.loopA >= 0 && g.doc.loopB >= 0 && g.doc.loopA > g.doc.loopB) {
      g.doc.loopA = -1
      g.doc.loopB = -1
    }
    const loadedSlots = Array.isArray(d.slots) ? d.slots : []
    for (let i = 0; i < 6; i++) {
      const slot = slot_ref(g, i)
      const source = loadedSlots[i]
      slot.bytes = source && source.bytes instanceof ArrayBuffer ? source.bytes : null
      slot.name = source ? normalized_string(source.name, '', 64) : ''
    }
    g.snd.bgmFps = (g.snd.bgm[0].bytes || g.snd.bgm[1].bytes) && Number.isFinite(d.bgmFps) && d.bgmFps > 0 ? d.bgmFps : 0
    doc_boot_size(g)
    visual_cache_clear()
    doc_unpack_live(g)
    hist_clear()
    thumb_clear()
    snd_apply_vol()
    snd_restore_slots()
    view_fit_after(g)
    return 0
  },

  'project.apply_flip': (g: Globals, d: FlipLoaded): number => {
    if (!Number.isInteger(d.mode) || d.mode < 0 || d.mode > 2 || !valid_project(d.w, d.h, d.frames, d.mode)) return ERR_BAD
    snd_load_epoch_bump()
    stop_all(g)
    hist_clear()
    thumb_clear()
    g.doc.mode = d.mode
    g.doc.ratio = normalize_ratio(d.ratio)
    g.doc.res = normalize_resolution(d.res)
    g.doc.fps = finite_clamp(d.fps, 0.5, 30, 12)
    g.doc.loop = d.loop ? 1 : 0
    g.doc.paper = normalize_hex(d.paper, '#FFFFFF')
    g.doc.lvis = new Uint8Array(L_N)
    g.doc.lvis[0] = 1
    g.doc.lvis[1] = 1
    g.doc.lvis[2] = 1
    g.doc.lvis[3] = 1
    g.doc.lalpha = new Uint8Array(L_N)
    g.doc.lalpha.fill(255)
    g.doc.lord = [1, 2, 3]
    g.doc.anim = anim_fx_zero()
    g.doc.meta = normalize_meta(d.meta)
    mode_normalize(g)
    normalize_frames(d.frames)
    g.doc.frames = d.frames
    g.doc.cur = finite_index(d.cur, d.frames.length, 0)
    g.doc.loopA = -1
    g.doc.loopB = -1
    clear_sound_slots(g)
    g.snd.bgmFps = d.bgm && d.bgm.length && Number.isFinite(d.bgmFps) && d.bgmFps > 0 ? d.bgmFps : 0
    doc_resize_raw(g, d.w, d.h)
    visual_cache_clear()
    doc_unpack_live(g)
    view_fit_after(g)
    return 0
  },

  'project.resize_canvas': (g: Globals, p: { w: number, h: number, ratio: string, res: string, quiet?: number }): number => {
    if (!valid_size(p.w, p.h)) return ERR_BAD
    stop_all(g)
    doc_resize(g, p.w, p.h, p.ratio, p.res)
    animfx_cache_clear()
    hist_clear()
    thumb_clear()
    view_fit_after(g)
    if (!p.quiet) {
      fx_toast('サイズを変えました')
      fx_sfx('paper')
    }
    return 0
  },

  'project.transform_all': (g: Globals, kind: string): number => {
    const label = kind === 'rotl' ? '左回転' : kind === 'rotr' ? '右回転' : kind === 'fliph' ? '左右反転' : '上下反転'
    stop_all(g)
    if (kind === 'rotl') doc_transform_all(g, c => canvas_rot90(c, -1), 1)
    else if (kind === 'rotr') doc_transform_all(g, c => canvas_rot90(c, 1), 1)
    else if (kind === 'fliph') doc_transform_all(g, c => canvas_flip(c, 1), 0)
    else if (kind === 'flipv') doc_transform_all(g, c => canvas_flip(c, 0), 0)
    else return ERR_BAD
    animfx_cache_clear()
    hist_clear()
    thumb_clear()
    view_fit_after(g)
    fx_toast(label + 'しました')
    fx_sfx('paper')
    return 0
  },

  'project.set_mode': (g: Globals, mode: number): number => {
    if (!Number.isInteger(mode) || mode < 0 || mode > 2) return ERR_BAD
    const limit = mode_frame_limit(mode)
    if (g.doc.frames.length > limit) {
      fx_toast(mode_name(mode) + 'は最大' + limit + 'コマです。先にコマを減らしてください')
      return ERR_FULL
    }
    const droppedAnim = !mode_allows_runtime_anim(mode) && animfx_active(g.doc.anim)
    stop_all(g)
    const mc = mode_canvas(mode)
    doc_resize(g, mc.w, mc.h, mc.ratio, mc.res)
    g.doc.mode = mode
    mode_normalize(g)
    animfx_cache_clear()
    hist_clear()
    thumb_clear()
    view_fit_after(g)
    fx_toast(mode_name(mode) + 'モードになりました' + (droppedAnim ? '。再生時だけの動きは解除しました' : ''))
    fx_sfx('paper')
    return 0
  },
}

function project_new_body(g: Globals, name: string): number {
  g.doc.name = name || 'むだいのノート'
  g.doc.meta = meta_fresh()
  g.doc.frames = [doc_frame_new()]
  g.doc.cur = 0
  mode_normalize(g)
  clear_sound_slots(g)
  doc_boot_size(g)
  visual_cache_clear()
  doc_unpack_live(g)
  hist_clear()
  thumb_clear()
  view_fit_after(g)
  fx_toast('あたらしいノート！')
  fx_sfx('paper')
  return 0
}

function doc_resize_raw(g: Globals, w: number, h: number): void {
  g.doc.w = w
  g.doc.h = h
  doc_boot_size(g)
}

function view_fit_after(g: Globals): void {
  VIEW_COMMANDS['view.fit'](g, null)
}

export const PROJECT_EFFECTS: Partial<Record<keyof Cmds, number>> = {
  'project.boot_prefs': D_ALL,
  'project.boot_empty': D_ALL,
  'project.set_booted': 0,
  'project.new': D_ALL,
  'project.apply_loaded': D_ALL,
  'project.apply_flip': D_ALL,
  'project.resize_canvas': D_ALL,
  'project.transform_all': D_ALL,
  'project.set_mode': D_ALL,
}

export const PROJECT_TOUCH = new Set<keyof Cmds>(['project.new', 'project.apply_loaded', 'project.apply_flip', 'project.resize_canvas', 'project.transform_all', 'project.set_mode'])
