import { report_warning } from '../diagnostics'
import { b_pen, l_n, mode_normal, pal_std, t_pen, anim_fx_zero, note_meta_zero, type clip_t, type doc_t, type float_st_t, type mark_def_t, type pen_t, type play_st_t, type sel_st_t, type snd_st_t, type view_st_t } from '../h'

export type globals_t = {
  doc: doc_t
  pen: pen_t
  view: view_st_t
  play: play_st_t
  sel: sel_st_t
  flo: float_st_t
  snd: snd_st_t
  clip: clip_t | null
  mobile: number
  dirty_bits: number
  phase: number
  booted: number
  marks: mark_def_t[]
}

function doc_zero(): doc_t {
  const lvis = new Uint8Array(l_n)
  const lalpha = new Uint8Array(l_n)
  lvis[0] = 1
  lvis[1] = 1
  lvis[2] = 1
  lvis[3] = 1
  lalpha.fill(255)
  return {
    meta: note_meta_zero(), w: 512, h: 288, ratio: '16:9', res: 'low', paper: '#FFFFFF', fps: 6, loop: 1, name: 'むだいのノート', loop_a: -1, loop_b: -1, frames: [], cur: 0, lvis, lalpha, lord: [1, 2, 3], mode: mode_normal, anim: anim_fx_zero() }
}

const g: globals_t = {
  doc: doc_zero(),
  pen: { tool: t_pen, prev_tool: t_pen, layer: 1, size: 3, color: '#111111', alpha: 1, pat: 0, outline: 0, ocolor: '#FFFFFF', owidth: 3, smooth: 2, pressure: 0, sym: 0, symy: 0, custom: [], pxn: 32, fill: 0, pal_mode: pal_std, brush: b_pen, native_tip: 2, mark_id: '', fill_all: 0, paint_over: 0, paint_tile: null, paint_tile_normal: null },
  view: { z: 1, px: 0, py: 0, fit_z: 1, onion: 0, ocount: 1, oprev: 1, onext: 1, grid: 0, gsize: 32, page: 'canvas', flip: 0, tlopen: 0 },
  play: { on: 0, acc: 0, last: 0, raf: 0 },
  sel: { has: 0, x: 0, y: 0, w: 0, h: 0, poly: null },
  flo: { kind: 0, x: 0, y: 0, rot: 0, sx: 1, sy: 1, cont: 0, src_layer: 0, src_poly: null, src_rect: null, src_before: null },
  snd: { bgm: [{ bytes: null, name: '' }, { bytes: null, name: '' }], se: [{ bytes: null, name: '' }, { bytes: null, name: '' }, { bytes: null, name: '' }, { bytes: null, name: '' }], bgm_vol: 0.9, se_vol: 0.9, bgm_fps: 0 },
  clip: null,
  mobile: 0,
  dirty_bits: 0,
  phase: 0,
  booted: 0,
  marks: [],
}

export function doc_reset(g: globals_t, w: number, h: number, ratio: string, res: string, paper: string): void {
  const d = doc_zero()
  d.w = w
  d.h = h
  d.ratio = ratio
  d.res = res
  d.paper = paper
  g.doc = d
}

let touch_timer = 0
let touch_fn: (() => void) | null = null

let touch_mark: (() => void) | null = null

export function store_hook(fn: () => void, delay_ms: number, on_touch: (() => void) | null): void {
  touch_fn = fn
  touch_timer = delay_ms
  touch_mark = on_touch
}

let revision = 0

export function project_revision(): number { return revision }

export function proj_touch(): void {
  revision++
  if (touch_mark) touch_mark()
  if (!touch_fn) return
  const fn = touch_fn
  if (proj_touch_t) clearTimeout(proj_touch_t)
  proj_touch_t = setTimeout(() => {
    proj_touch_t = 0
    fn()
  }, touch_timer)
}

let proj_touch_t: ReturnType<typeof setTimeout> | 0 = 0

let on_dirty: (() => void) | null = null

export function store_dirty_hook(fn: () => void): void {
  on_dirty = fn
}

export function dirty(bits: number): void {
  g.dirty_bits |= bits
  if (!g.phase && on_dirty) on_dirty()
}

export function in_flush(): number {
  return g.phase
}

export function flush_begin(): number {
  let bits = g.dirty_bits
  if (!bits) return 0
  g.dirty_bits = 0
  g.phase = 1
  return bits
}

export function flush_end(): void {
  g.phase = 0
  if (g.dirty_bits && on_dirty) on_dirty()
}

export function st_mut_for_dispatch(): globals_t {
  if (g.phase) report_warning('再描画中の状態変更を検出しました', { phase: g.phase })
  return g
}

export type deep_ro_t<t> = t extends (infer u)[] ? readonly deep_ro_t<u>[]
  : t extends Uint8Array | Uint16Array | Uint32Array | Float32Array | Int16Array | ImageData | HTMLCanvasElement | CanvasRenderingContext2D | AudioBuffer | ArrayBuffer ? t
  : t extends object ? { readonly [k in keyof t]: deep_ro_t<t[k]> }
  : t

export function st(): deep_ro_t<globals_t> {
  return g as deep_ro_t<globals_t>
}
