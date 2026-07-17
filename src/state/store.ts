import { report_warning } from '../diagnostics'
import { B_PEN, L_N, MODE_NORMAL, PAL_STD, T_PEN, anim_fx_zero, note_meta_zero, type Clip, type Doc, type FloatSt, type MarkDef, type Pen, type PlaySt, type SelSt, type SndSt, type ViewSt } from '../h'

export type Globals = {
  doc: Doc
  pen: Pen
  view: ViewSt
  play: PlaySt
  sel: SelSt
  flo: FloatSt
  snd: SndSt
  clip: Clip | null
  mobile: number
  dirtyBits: number
  phase: number
  booted: number
  marks: MarkDef[]
}

function doc_zero(): Doc {
  const lvis = new Uint8Array(L_N)
  const lalpha = new Uint8Array(L_N)
  lvis[0] = 1
  lvis[1] = 1
  lvis[2] = 1
  lvis[3] = 1
  lalpha.fill(255)
  return {
    meta: note_meta_zero(), w: 512, h: 288, ratio: '16:9', res: 'low', paper: '#FFFFFF', fps: 6, loop: 1, name: 'むだいのノート', loopA: -1, loopB: -1, frames: [], cur: 0, lvis, lalpha, lord: [1, 2, 3], mode: MODE_NORMAL, anim: anim_fx_zero() }
}

const G: Globals = {
  doc: doc_zero(),
  pen: { tool: T_PEN, prevTool: T_PEN, layer: 1, size: 3, color: '#111111', alpha: 1, pat: 0, outline: 0, ocolor: '#FFFFFF', owidth: 3, smooth: 2, pressure: 0, sym: 0, symy: 0, custom: [], pxn: 32, fill: 0, palMode: PAL_STD, brush: B_PEN, markId: '', fillAll: 0 },
  view: { z: 1, px: 0, py: 0, fitZ: 1, onion: 0, ocount: 1, grid: 0, gsize: 16, page: 'canvas', flip: 0, tlopen: 1 },
  play: { on: 0, acc: 0, last: 0, raf: 0 },
  sel: { has: 0, x: 0, y: 0, w: 0, h: 0, poly: null },
  flo: { kind: 0, x: 0, y: 0, rot: 0, sx: 1, sy: 1, cont: 0, srcLayer: 0, srcRect: null, srcBefore: null },
  snd: { bgm: [{ bytes: null, name: '' }, { bytes: null, name: '' }], se: [{ bytes: null, name: '' }, { bytes: null, name: '' }, { bytes: null, name: '' }, { bytes: null, name: '' }], bgmVol: 0.9, seVol: 0.9, bgmFps: 0 },
  clip: null,
  mobile: 0,
  dirtyBits: 0,
  phase: 0,
  booted: 0,
  marks: [],
}

export function doc_reset(g: Globals, w: number, h: number, ratio: string, res: string, paper: string): void {
  const d = doc_zero()
  d.w = w
  d.h = h
  d.ratio = ratio
  d.res = res
  d.paper = paper
  g.doc = d
}

let touchTimer = 0
let touchFn: (() => void) | null = null

let touchMark: (() => void) | null = null

export function store_hook(fn: () => void, delayMs: number, onTouch: (() => void) | null): void {
  touchFn = fn
  touchTimer = delayMs
  touchMark = onTouch
}

export function proj_touch(): void {
  if (touchMark) touchMark()
  if (!touchFn) return
  const fn = touchFn
  if (proj_touch_t) clearTimeout(proj_touch_t)
  proj_touch_t = setTimeout(() => {
    proj_touch_t = 0
    fn()
  }, touchTimer)
}

let proj_touch_t: ReturnType<typeof setTimeout> | 0 = 0

let onDirty: (() => void) | null = null

export function store_dirty_hook(fn: () => void): void {
  onDirty = fn
}

export function dirty(bits: number): void {
  G.dirtyBits |= bits
  if (!G.phase && onDirty) onDirty()
}

export function in_flush(): number {
  return G.phase
}

export function flush_begin(): number {
  let bits = G.dirtyBits
  if (!bits) return 0
  G.dirtyBits = 0
  G.phase = 1
  return bits
}

export function flush_end(): void {
  G.phase = 0
  if (G.dirtyBits && onDirty) onDirty()
}

export function st_mut_for_dispatch(): Globals {
  if (G.phase) report_warning('再描画中の状態変更を検出しました', { phase: G.phase })
  return G
}

export type DeepRO<T> = T extends (infer U)[] ? readonly DeepRO<U>[]
  : T extends Uint8Array | Uint16Array | Uint32Array | Float32Array | Int16Array | ImageData | HTMLCanvasElement | CanvasRenderingContext2D | AudioBuffer | ArrayBuffer ? T
  : T extends object ? { readonly [K in keyof T]: DeepRO<T[K]> }
  : T

export function st(): DeepRO<Globals> {
  return G as DeepRO<Globals>
}
