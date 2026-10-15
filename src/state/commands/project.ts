import { pixel_source_transform, pixel_source_collect } from '../../pixel_source'
import { canvas_transform_clear, canvas_transform_prepare, canvas_transform_finish } from '../../canvas_transform'
import { kwz_frame_meta_valid } from '../../codec/kwzmeta'
import { pixel_valid } from '../../pixel'
import { animfx_active, animfx_cache_clear } from '../../animfx'
import { animfx_normalize } from '../../animset'
import { rand_hex } from '../../codec/fname'
import { kwz_border, kwz_canvas_w, kwz_canvas_h, kwz_frame_w, kwz_frame_h } from '../../codec/kwzgeom'
import { doc_boot_size, doc_cache_clear, doc_crop_frames, doc_frame_new, doc_resize, doc_transform_all, doc_unpack_live, doc_unpack_to, doc_pack_live, doc_pack_layer, frame_id_next, frame_id_seed } from '../../doc'
import { live_canvas, live_peek, live_write, snd_buf_set } from '../../engine'
import type { loaded_project_t } from '../../fmt'
import { canvas_flip, canvas_affine } from '../../gfx'
import { d_all, err_bad, err_noop, err_full, hold_max, l_base_n, l_draw_default, l_draw_max, l_n, mode_3_d, mode_normal, pal_std, anim_fx_zero, note_meta_zero, type frame_t, type mark_def_t, type note_meta_t } from '../../h'
import { hist_clear, hist_grp, hist_pix, rect_grab } from '../../hist'
import { canvas_affine_matrix, canvas_make, clamp } from '../../lib'
import { mode_allows_runtime_anim, mode_canvas, mode_frame_limit, mode_ink, mode_name, mode_speeds, mode_speed_index, mode_order, mode_pal, mode_paper_opts } from '../../mode'
import { paint_active, pat_custom } from '../../paint'
import { pen_mode_normalize } from '../../penprofile'
import { flo_cancel, sel_clear } from '../../sel'
import { snd_apply_vol, snd_load_epoch_bump, snd_restore_slots, snd_stop_all } from '../../snd'
import { thumb_clear } from '../../thumb'
import { fx_sfx, fx_toast } from '../fx_hooks'
import { doc_reset, type globals_t } from '../store'
import { anim_playing, play_commands } from './play'
import { view_commands } from './view'

function meta_fresh(): note_meta_t {
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

export type flip_loaded_t = {
  meta: note_meta_t
  mode: number
  w: number
  h: number
  ratio: string
  res: string
  fps: number
  loop: number
  paper: string
  frames: frame_t[]
  cur: number
  bgm: Int16Array | null
  bgm_rate: number
  bgm_fps: number
  se: (Int16Array | null)[]
}

export type cmds_t = {
  'project.boot_prefs': { mobile: number, marks: mark_def_t[], custom: string[] }
  'project.boot_empty': null
  'project.set_booted': null
  'project.prepare_rebuild': null
  'project.new': { w: number, h: number, ratio: string, res: string, paper: string, name: string }
  'project.apply_loaded': loaded_project_t
  'project.apply_flip': flip_loaded_t
  'project.resize_canvas': { w: number, h: number, ratio: string, res: string, quiet?: number, frames?: frame_t[], mode?: number }
  'project.transform': { kind: 'rotate' | 'scale' | 'fliph' | 'flipv', angle: number, scale?: number, scope: 'current' | 'all' }
  'project.set_mode': number
}

function visual_cache_clear(): void {
  canvas_transform_clear()
  doc_cache_clear()
  animfx_cache_clear()
}

function stop_all(g: globals_t): void {
  if (anim_playing()) play_commands['play.stop'](g, null)
  else snd_stop_all()
  flo_cancel(g)
  sel_clear(g)
}

function mode_normalize(g: globals_t): void {
  const mode = g.doc.mode
  g.pen.pal_mode = mode_pal(mode)
  pen_mode_normalize(g.pen, mode)
  if (g.pen.pat === pat_custom && !paint_active(mode, g.pen.paint_tile, g.pen.paint_tile_normal)) g.pen.pat = 0
  const inks = mode_ink(mode)
  const active_layers = mode_order(mode, g.doc.lord)
  if (active_layers.indexOf(g.pen.layer) < 0) g.pen.layer = active_layers[0] || 1
  if (!mode_allows_runtime_anim(mode)) {
    g.doc.anim = anim_fx_zero()
    const up = g.pen.color.toUpperCase()
    if (!inks.some(c => c.toUpperCase() === up)) g.pen.color = inks[0]
    const papers = mode_paper_opts(mode)
    const pu = g.doc.paper.toUpperCase()
    if (!papers.some(c => c.toUpperCase() === pu)) g.doc.paper = papers[0]
  }
}

function slot_ref(g: globals_t, i: number) {
  return i === 0 ? g.snd.bgm[0] : i === 1 ? g.snd.bgm[1] : g.snd.se[i - 2]
}

function valid_size(w: number, h: number): boolean {
  return Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= 4096 && h <= 4096
}


function valid_project(w: number, h: number, frames: readonly frame_t[], mode: number): boolean {
  if (!valid_size(w, h) || !Array.isArray(frames) || frames.length < 1 || frames.length > mode_frame_limit(mode)) return false
  const pixel_count = w * h
  const checked = new Set<Uint32Array>()
  for (const frame of frames) {
    if (!frame || !Array.isArray(frame.pk) || frame.pk.length < l_base_n || frame.pk.length > l_n) return false
    if (frame.kwz !== undefined && !kwz_frame_meta_valid(frame.kwz)) return false
    if (frame.paper !== undefined && !/^#[0-9a-f]{6}(00)?$/i.test(frame.paper)) return false
    for (const packed of frame.pk) if (packed !== null && !checked.has(packed)) {
      if (!(packed instanceof Uint32Array) || !pixel_valid(packed, pixel_count)) return false
      checked.add(packed)
    }
  }
  try { pixel_source_collect(frames) } catch { return false }
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

function normalized_string(value: unknown, fallback: string, max_length: number): string {
  return typeof value === 'string' ? value.slice(0, max_length) : fallback
}

function normalized_uint(value: unknown, max: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? clamp(Math.trunc(numeric), 0, max) : 0
}

function normalize_meta(source: note_meta_t | null | undefined): note_meta_t {
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
  return typeof value === 'string' && ['4:3', '16:9', '1:1', '3:4', '9:16', 'free'].includes(value) ? value : '4:3'
}

function normalize_resolution(value: unknown): string {
  return typeof value === 'string' && ['low', 'mid', 'hd', '4k', 'dsi', '3ds', 'free'].includes(value) ? value : 'low'
}

function normalize_frames(frames: frame_t[]): void {
  let max_id = 0
  for (const frame of frames) {
    if (Number.isSafeInteger(frame.id) && frame.id >= 0 && frame.id < 0x7fffffff) max_id = Math.max(max_id, frame.id)
  }
  frame_id_seed(max_id + 1)
  const used = new Set<number>()
  for (const frame of frames) {
    if (!Number.isSafeInteger(frame.id) || frame.id < 0 || frame.id >= 0x7fffffff || used.has(frame.id)) frame.id = frame_id_next()
    used.add(frame.id)
    frame.se = Number.isFinite(frame.se) ? Math.max(0, Math.min(15, Math.trunc(frame.se))) : 0
    frame.hold = Number.isFinite(frame.hold) ? clamp(Math.round(frame.hold), 1, hold_max) : 1
    if (frame.pk.length > l_n) frame.pk.length = l_n
    while (frame.pk.length < l_n) frame.pk.push(null)
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
  const out = new Uint8Array(l_n)
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
      if (layer < 1 || layer > l_draw_max || out.indexOf(layer) >= 0) continue
      out.push(layer)
    }
  }
  for (let layer = 1; layer <= l_draw_default; layer++) if (out.indexOf(layer) < 0) out.push(layer)
  return out
}

function clear_sound_slots(g: globals_t): void {
  for (const slot of g.snd.bgm) {
    slot.bytes = null
    slot.name = ''
  }
  for (const slot of g.snd.se) {
    slot.bytes = null
    slot.name = ''
  }
  g.snd.bgm_fps = 0
  for (const k of ['bgm0', 'bgm1', 'se0', 'se1', 'se2', 'se3']) snd_buf_set(k, null)
}

export const project_commands = {
  'project.boot_prefs': (g: globals_t, p: { mobile: number, marks: mark_def_t[], custom: string[] }): number => {
    g.mobile = p.mobile
    g.marks = p.marks
    g.pen.custom = p.custom
    return 0
  },

  'project.boot_empty': (g: globals_t, _p: null): number => {
    g.doc.frames = [doc_frame_new()]
    g.doc.cur = 0
    return 0
  },

  'project.set_booted': (g: globals_t, _p: null): number => {
    g.booted = 1
    return 0
  },

  'project.new': (g: globals_t, p: { w: number, h: number, ratio: string, res: string, paper: string, name: string }): number => {
    if (!valid_size(p.w, p.h)) return err_bad
    snd_load_epoch_bump()
    stop_all(g)
    doc_reset(g, p.w, p.h, p.ratio, p.res, p.paper)
    return project_new_body(g, p.name)
  },

  'project.apply_loaded': (g: globals_t, d: loaded_project_t): number => {
    const mode = Number.isInteger(d.mode) && d.mode >= 0 && d.mode <= 2 ? d.mode : mode_normal
    if (!valid_project(d.w, d.h, d.frames, mode)) return err_bad
    snd_load_epoch_bump()
    stop_all(g)
    let w = d.w
    let h = d.h
    let ratio = normalize_ratio(d.ratio)
    let res = normalize_resolution(d.res)
    if (mode === mode_3_d && w === kwz_frame_w && h === kwz_frame_h) {
      doc_crop_frames(d.frames, w, h, kwz_border, kwz_border, kwz_canvas_w, kwz_canvas_h)
      w = kwz_canvas_w
      h = kwz_canvas_h
      ratio = '4:3'
      res = '3ds'
    }
    g.doc.w = w
    g.doc.h = h
    g.doc.fps = finite_clamp(d.fps, 0.2, 30, 12)
    g.doc.loop = d.loop ? 1 : 0
    g.pen.pal_mode = Number.isInteger(d.pal_mode) && d.pal_mode >= 0 && d.pal_mode <= 2 ? d.pal_mode : pal_std
    g.doc.name = normalized_string(d.name, 'むだいのノート', 40) || 'むだいのノート'
    g.doc.ratio = ratio
    g.doc.res = res
    g.doc.paper = normalize_hex(d.paper, '#FFFFFF')
    g.doc.lvis = normalize_vis(d.lvis)
    g.doc.lalpha = normalize_u8(d.lalpha, l_n, 255)
    g.doc.lord = normalize_order(d.lord)
    g.doc.mode = mode
    g.doc.anim = animfx_normalize(d.anim)
    mode_normalize(g)
    g.snd.bgm_vol = finite_clamp(d.bgm_vol, 0, 1, 1)
    g.snd.se_vol = finite_clamp(d.se_vol, 0, 1, 1)
    g.doc.meta = normalize_meta(d.meta)
    normalize_frames(d.frames)
    g.doc.frames = d.frames
    g.doc.cur = finite_index(d.cur, d.frames.length, 0)
    g.doc.loop_a = Number.isInteger(d.loop_a) && d.loop_a >= 0 && d.loop_a < d.frames.length ? d.loop_a : -1
    g.doc.loop_b = Number.isInteger(d.loop_b) && d.loop_b >= 0 && d.loop_b < d.frames.length ? d.loop_b : -1
    if (g.doc.loop_a >= 0 && g.doc.loop_b >= 0 && g.doc.loop_a > g.doc.loop_b) {
      g.doc.loop_a = -1
      g.doc.loop_b = -1
    }
    const loaded_slots = Array.isArray(d.slots) ? d.slots : []
    for (let i = 0; i < 6; i++) {
      const slot = slot_ref(g, i)
      const source = loaded_slots[i]
      slot.bytes = source && source.bytes instanceof ArrayBuffer ? source.bytes : null
      slot.name = source ? normalized_string(source.name, '', 64) : ''
    }
    g.snd.bgm_fps = (g.snd.bgm[0].bytes || g.snd.bgm[1].bytes) && Number.isFinite(d.bgm_fps) && d.bgm_fps > 0 ? d.bgm_fps : 0
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

  'project.apply_flip': (g: globals_t, d: flip_loaded_t): number => {
    if (!Number.isInteger(d.mode) || d.mode < 0 || d.mode > 2 || !valid_project(d.w, d.h, d.frames, d.mode)) return err_bad
    snd_load_epoch_bump()
    stop_all(g)
    hist_clear()
    thumb_clear()
    g.doc.mode = d.mode
    g.doc.ratio = normalize_ratio(d.ratio)
    g.doc.res = normalize_resolution(d.res)
    g.doc.fps = finite_clamp(d.fps, 0.2, 30, 12)
    g.doc.loop = d.loop ? 1 : 0
    g.doc.paper = normalize_hex(d.paper, '#FFFFFF')
    g.doc.lvis = new Uint8Array(l_n)
    g.doc.lvis[0] = 1
    g.doc.lvis[1] = 1
    g.doc.lvis[2] = 1
    g.doc.lvis[3] = 1
    g.doc.lalpha = new Uint8Array(l_n)
    g.doc.lalpha.fill(255)
    g.doc.lord = [1, 2, 3]
    g.doc.anim = anim_fx_zero()
    g.doc.meta = normalize_meta(d.meta)
    mode_normalize(g)
    normalize_frames(d.frames)
    g.doc.frames = d.frames
    g.doc.cur = finite_index(d.cur, d.frames.length, 0)
    g.doc.loop_a = -1
    g.doc.loop_b = -1
    clear_sound_slots(g)
    g.snd.bgm_fps = d.bgm && d.bgm.length && Number.isFinite(d.bgm_fps) && d.bgm_fps > 0 ? d.bgm_fps : 0
    doc_resize_raw(g, d.w, d.h)
    visual_cache_clear()
    doc_unpack_live(g)
    view_fit_after(g)
    return 0
  },

  'project.prepare_rebuild': (g: globals_t, _p: null): number => { stop_all(g); doc_pack_live(g); return 0 },

  'project.resize_canvas': (g: globals_t, p: cmds_t['project.resize_canvas']): number => {
    if (!valid_size(p.w, p.h)) return err_bad
    const mode = p.mode === undefined ? g.doc.mode : p.mode
    if (!Number.isInteger(mode) || mode < 0 || mode > 2 || (p.frames || g.doc.frames).length > mode_frame_limit(mode)) return err_bad
    if (p.frames && !valid_project(p.w, p.h, p.frames, mode)) return err_bad
    stop_all(g)
    canvas_transform_clear()
    if (p.frames) {
      g.doc.frames = p.frames
      g.doc.w = p.w; g.doc.h = p.h; g.doc.ratio = p.ratio; g.doc.res = p.res
      g.doc.cur = Math.min(g.doc.cur, p.frames.length - 1)
      doc_boot_size(g)
      doc_unpack_live(g)
    } else doc_resize(g, p.w, p.h, p.ratio, p.res)
    if (p.mode !== undefined) {
      g.doc.mode = mode
      if (mode !== mode_normal) g.doc.fps = mode_speeds(mode)[mode_speed_index(mode, g.doc.fps)]
      mode_normalize(g)
    }
    animfx_cache_clear()
    hist_clear()
    thumb_clear()
    view_fit_after(g)
    if (!p.quiet) { fx_toast('サイズを変えました'); fx_sfx('paper') }
    return 0
  },

  'project.transform': (g: globals_t, p: cmds_t['project.transform']): number => {
    if (!p || !['rotate', 'scale', 'fliph', 'flipv'].includes(p.kind) || !['current', 'all'].includes(p.scope)) return err_bad
    if (!Number.isFinite(p.angle) || Math.abs(p.angle) > 360) return err_bad
    if (p.kind === 'scale' && (!Number.isFinite(p.scale) || p.scale! < 0.01 || p.scale! > 8)) return err_bad
    if (p.kind === 'rotate' && p.angle % 360 === 0 || p.kind === 'scale' && p.scale === 1) return err_noop
    stop_all(g)
    doc_pack_live(g)
    const affine = p.kind === 'rotate' || p.kind === 'scale'
    if (!affine) canvas_transform_clear()
    const transform = affine ? canvas_transform_prepare(g, p.kind === 'scale' ? p.scale! : p.angle, p.scope === 'all' ? 1 : 0, p.kind as 'rotate' | 'scale') : null
    const op = (c: HTMLCanvasElement): HTMLCanvasElement => transform ? canvas_affine(c, transform.angle, transform.smooth, transform.scale, transform.dx, transform.dy) : canvas_flip(c, p.kind === 'fliph' ? 1 : 0)
    if (p.scope === 'all') {
      const matrix: [number, number, number, number, number, number] = transform ? canvas_affine_matrix(g.doc.w, g.doc.h, transform.angle, transform.scale, transform.dx, transform.dy) : p.kind === 'fliph' ? [-1, 0, 0, 1, g.doc.w, 0] : [1, 0, 0, -1, 0, g.doc.h]
      doc_transform_all(g, op, transform?.source, packed => pixel_source_transform(packed, g.doc.w, g.doc.h, ...matrix))
      hist_clear()
    } else {
      const grp = hist_grp()
      const [source, context] = canvas_make(g.doc.w, g.doc.h, 1)
      for (let l = 0; l < g.doc.frames[g.doc.cur].pk.length; l++) {
        if (!g.doc.frames[g.doc.cur].pk[l] && !live_peek(l) && !transform?.source[0][l]) continue
        const before = rect_grab(l, 0, 0, g.doc.w, g.doc.h)
        if (transform) doc_unpack_to(transform.source[0][l], context, g.doc.w, g.doc.h)
        const out = op(transform ? source : live_canvas(l))
        const x = live_write(l)
        x.clearRect(0, 0, g.doc.w, g.doc.h)
        x.drawImage(out, 0, 0)
        out.width = 0
        if (hist_pix(g, grp, g.doc.cur, l, 0, 0, g.doc.w, g.doc.h, before)) doc_pack_layer(g, l)
      }
    }
    if (transform) canvas_transform_finish(g, p.scope === 'all' ? 1 : 0)
    animfx_cache_clear()
    thumb_clear()
    fx_toast('絵をうごかしました')
    fx_sfx('paper')
    return 0
  },

  'project.set_mode': (g: globals_t, mode: number): number => {
    if (!Number.isInteger(mode) || mode < 0 || mode > 2) return err_bad
    const limit = mode_frame_limit(mode)
    if (g.doc.frames.length > limit) {
      fx_toast(mode_name(mode) + 'は最大' + limit + 'コマです。先にコマを減らしてください')
      return err_full
    }
    const dropped_anim = !mode_allows_runtime_anim(mode) && animfx_active(g.doc.anim)
    stop_all(g)
    canvas_transform_clear()
    const mc = mode_canvas(mode)
    doc_resize(g, mc.w, mc.h, mc.ratio, mc.res)
    g.doc.mode = mode
    if (mode !== mode_normal) g.doc.fps = mode_speeds(mode)[mode_speed_index(mode, g.doc.fps)]
    mode_normalize(g)
    animfx_cache_clear()
    hist_clear()
    thumb_clear()
    view_fit_after(g)
    fx_toast(mode_name(mode) + 'モードになりました' + (dropped_anim ? '。再生時だけの動きは解除しました' : ''))
    fx_sfx('paper')
    return 0
  },
}

function project_new_body(g: globals_t, name: string): number {
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

function doc_resize_raw(g: globals_t, w: number, h: number): void {
  g.doc.w = w
  g.doc.h = h
  doc_boot_size(g)
}

function view_fit_after(g: globals_t): void {
  view_commands['view.fit'](g, null)
}

export const project_effects: Partial<Record<keyof cmds_t, number>> = {
  'project.boot_prefs': d_all,
  'project.boot_empty': d_all,
  'project.set_booted': 0,
  'project.new': d_all,
  'project.apply_loaded': d_all,
  'project.apply_flip': d_all,
  'project.prepare_rebuild': d_all,
  'project.resize_canvas': d_all,
  'project.transform': d_all,
  'project.set_mode': d_all,
}

export const project_touch = new Set<keyof cmds_t>(['project.new', 'project.apply_loaded', 'project.apply_flip', 'project.resize_canvas', 'project.transform', 'project.set_mode'])
