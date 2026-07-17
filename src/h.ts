export { KWZ_SPEEDS } from './codec/kwz'
export { PPM_SPEEDS } from './codec/ppm'

export const APP_NAME = 'うごくノート2'

export const L_P = 0
export const L_A = 1
export const L_B = 2
export const L_C = 3
export const L_BASE_N = 4
export const L_DRAW_MIN = 1
export const L_DRAW_DEFAULT = 3
export const L_DRAW_MAX = 8
export const L_N = L_DRAW_MAX + 1

export const T_PEN = 0
export const T_FILL = 1
export const T_ERASER = 2
export const T_EYEDROP = 3
export const T_PIXEL = 4
export const T_LINE = 5
export const T_RECT = 6
export const T_CIRCLE = 7
export const T_STAR = 8
export const T_HEART = 9
export const T_TEXT = 10
export const T_SELECT = 11
export const T_LASSO = 12
export const T_PASTE = 13
export const T_HAND = 14
export const T_N = 15

export const B_PEN = 0
export const B_MARKER = 1
export const B_PENCIL = 2
export const B_BRUSH = 3
export const B_AIRBRUSH = 4
export const B_CRAYON = 5
export const B_CALLIG = 6
export const B_DOTS = 7
export const B_WATER = 8
export const B_NEON = 9
export const B_CHALK = 10
export const B_SPAT = 11
export const B_RIBBON = 12
export const B_N = 13

export const EF_NONE = 0
export const EF_BLUR = 1
export const EF_MOSAIC = 2
export const EF_GLOW = 3
export const EF_CHROMA = 4
export const EF_NOISE = 5
export const EF_OUTLINE = 6
export const EF_WAVE = 7

export const TR_NONE = 0
export const TR_FADE = 1
export const TR_SLIDE_L = 2
export const TR_SLIDE_R = 3
export const TR_SLIDE_U = 4
export const TR_SLIDE_D = 5
export const TR_ZOOM_IN = 6
export const TR_ZOOM_OUT = 7
export const TR_WIPE = 8

export const MODE_NORMAL = 0
export const MODE_DSI = 1
export const MODE_3D = 2

export const MOTION_NONE = 0
export const MOTION_BREATHE = 1
export const MOTION_SWAY = 2
export const MOTION_FLOAT = 3
export const MOTION_BOUNCE = 4
export const MOTION_CAMERA = 5
export const MOTION_N = 6

export const K_NONE = 0
export const K_PASTE = 1
export const K_PHOTO = 2
export const K_TEXT = 3
export const K_SEL = 4

export const D_STAGE = 1 << 0
export const D_THUMB = 1 << 1
export const D_TIMELINE = 1 << 2
export const D_FRAMEINFO = 1 << 3
export const D_TOOLS = 1 << 4
export const D_PEN = 1 << 5
export const D_LAYER = 1 << 6
export const D_PLAY = 1 << 7
export const D_ZOOM = 1 << 8
export const D_SOUND = 1 << 9
export const D_SAVE = 1 << 10
export const D_PAGE = 1 << 11
export const D_ONION = 1 << 12
export const D_SEL = 1 << 13
export const D_GRID = 1 << 14
export const D_TRANS = 1 << 15
export const D_MODE = 1 << 16
export const D_ANIM = 1 << 17
export const D_ALL = 0x3ffff

export const OP_PIX = 0
export const OP_FRAME_INS = 1
export const OP_FRAME_DEL = 2
export const OP_FRAME_MOVE = 3
export const OP_SE = 4
export const OP_LAYER_ALPHA = 5
export const OP_FRAME_CURSOR = 6

export const PAL_STD = 0
export const PAL_PPM = 1
export const PAL_KWZ = 2

export const ERR_OK = 0
export const ERR_BAD = -1
export const ERR_FULL = -2
export const ERR_IO = -3
export const ERR_NOOP = -4

export type NoteMeta = {
  root_name: string
  parent_name: string
  cur_name: string
  root_id: string
  parent_id: string
  cur_id: string
  root_fn: string
  parent_fn: string
  cur_fn: string
  created: number
  modified: number
  edits: number
  lock: number
  flags: number
  layer_flags: number
  app_ver: number
}

export function note_meta_zero(): NoteMeta {
  return { root_name: '', parent_name: '', cur_name: '', root_id: '', parent_id: '', cur_id: '', root_fn: '', parent_fn: '', cur_fn: '', created: 0, modified: 0, edits: 0, lock: 0, flags: 0, layer_flags: 0, app_ver: 0 }
}

export const MAX_FRAMES_NORMAL = 9999
export const MAX_FRAMES_FLIPNOTE = 999
export const MAX_UNDO_PC = 40
export const MAX_UNDO_MOBILE = 20
export const UNDO_BYTE_CAP = 48 << 20
export const AUTOSAVE_MS = 2500
export const THUMB_W = 96
export const THUMB_H = 72
export const ZOOM_MIN = 0.05
export const ZOOM_MAX = 32
export const LONGPRESS_MS = 300
export const DRAG_SLOP = 8

export const SIZES = [1, 2, 3, 5, 8, 12, 16, 24, 32]
export const SIZE_MIN = 1
export const SIZE_MAX = 64
export const PXN_MIN = 4
export const PXN_MAX = 128
export const PIXEL_NS = [8, 16, 32, 48, 64]
export const FPS_SPEEDS = [0.5, 1, 2, 4, 6, 12, 20, 30]

export const ASPECTS = [
  { name: '4:3', w: 512, h: 384 },
  { name: '16:9', w: 512, h: 288 },
  { name: '1:1', w: 400, h: 400 },
  { name: '3:4', w: 384, h: 512 },
  { name: '9:16', w: 288, h: 512 },
]
export const RESOS = [
  { id: 'low', label: '低画質', mul: 1 },
  { id: 'mid', label: '中画質', mul: 1.875 },
  { id: 'hd', label: 'HD', mul: 2.5 },
  { id: 'dsi', label: 'DSi実寸', mul: 0.5 },
  { id: '3ds', label: '3DS実寸', mul: 0.625 },
]

export const PAT_TABLE: { id: string, label: string, rows: number[] }[] = [
  { id: 'solid', label: 'ベタ', rows: [255, 255, 255, 255, 255, 255, 255, 255] },
  { id: 'dots_sparse', label: 'ドット', rows: [146, 0, 0, 146, 0, 0, 146, 0] },
  { id: 'dots_dense', label: '密ドット', rows: [170, 0, 170, 0, 170, 0, 170, 0] },
  { id: 'diag_cross', label: '斜め格子', rows: [170, 68, 170, 17, 170, 68, 170, 17] },
  { id: 'lines_h', label: '横線', rows: [255, 0, 255, 0, 255, 0, 255, 0] },
  { id: 'lines_v', label: '縦線', rows: [170, 170, 170, 170, 170, 170, 170, 170] },
  { id: 'checker', label: '市松', rows: [170, 85, 170, 85, 170, 85, 170, 85] },
  { id: 'grid', label: '格子', rows: [255, 170, 255, 170, 255, 170, 255, 170] },
  { id: 'inverse_dots', label: '反転ドット', rows: [109, 255, 255, 109, 255, 255, 109, 255] },
]

export const INK_STD = ['#111111', '#E02020', '#2060E0', '#20A020', '#F0C000', '#FF6B9D', '#9C27B0', '#FF8C00', '#00BCD4', '#795548', '#607D8B', '#8BC34A', '#CDDC39', '#FF5722', '#E91E63', '#FFFFFF']
export const PAPER_STD = ['#FFFFFF', '#1A1A1A', '#FFF8E7', '#E8F5E9', '#E3F2FD', '#FCE4EC', '#F3E5F5', '#FFF3E0', '#ECEFF1', '#263238']
export const INK_PPM = ['#0E0E0E', '#FF2A2A', '#0A39FF', '#FFFFFF']
export const PAPER_PPM = ['#FFFFFF', '#0E0E0E']
export const INK_KWZ = ['#101010', '#FF1010', '#FFE700', '#008631', '#0038CE', '#FFFFFF']
export const PAPER_KWZ = ['#FFFFFF', '#101010', '#FF1010', '#FFE700', '#008631', '#0038CE']

export const BRUSH_DEFS: { id: number, icon: string, label: string }[] = [
  { id: B_PEN, icon: 'pen', label: 'ペン' },
  { id: B_MARKER, icon: 'marker', label: 'マーカー' },
  { id: B_PENCIL, icon: 'pencil', label: 'えんぴつ' },
  { id: B_BRUSH, icon: 'brush', label: 'ふで' },
  { id: B_AIRBRUSH, icon: 'airbrush', label: 'エアブラシ' },
  { id: B_CRAYON, icon: 'crayon', label: 'クレヨン' },
  { id: B_CALLIG, icon: 'callig', label: 'つけペン' },
  { id: B_DOTS, icon: 'bdots', label: 'てんてん' },
  { id: B_WATER, icon: 'water', label: 'すいさい' },
  { id: B_NEON, icon: 'neon', label: 'ネオン' },
  { id: B_CHALK, icon: 'chalk', label: 'チョーク' },
  { id: B_SPAT, icon: 'spat', label: 'しぶき' },
  { id: B_RIBBON, icon: 'ribbon', label: 'リボン' },
]

export const EFFECT_DEFS: { id: number, icon: string, label: string, desc: string }[] = [
  { id: EF_BLUR, icon: 'blur', label: 'ぼかし', desc: 'やわらかくにじませる' },
  { id: EF_MOSAIC, icon: 'mosaic', label: 'モザイク', desc: '四角く粗くする' },
  { id: EF_GLOW, icon: 'glow', label: '発光', desc: 'ふんわり光らせる' },
  { id: EF_CHROMA, icon: 'chroma', label: '色ずれ', desc: 'RGBをずらす' },
  { id: EF_NOISE, icon: 'noise', label: 'ノイズ', desc: 'ざらざらを足す' },
  { id: EF_OUTLINE, icon: 'outline', label: 'フチ抽出', desc: '輪郭線をつくる' },
  { id: EF_WAVE, icon: 'wave', label: '波', desc: 'ゆらゆら歪ませる' },
]

export const TRANSITION_DEFS: { id: number, label: string }[] = [
  { id: TR_FADE, label: 'フェード' },
  { id: TR_SLIDE_L, label: '左へスライド' },
  { id: TR_SLIDE_R, label: '右へスライド' },
  { id: TR_SLIDE_U, label: '上へスライド' },
  { id: TR_SLIDE_D, label: '下へスライド' },
  { id: TR_ZOOM_IN, label: 'ズームイン' },
  { id: TR_ZOOM_OUT, label: 'ズームアウト' },
  { id: TR_WIPE, label: 'ワイプ' },
]

export const MODE_DEFS: { id: number, label: string, sub: string }[] = [
  { id: MODE_NORMAL, label: 'ノーマル', sub: '自由に描ける拡張モード' },
  { id: MODE_DSI, label: 'うごメモ', sub: 'DSi風・2レイヤー・実機準拠' },
  { id: MODE_3D, label: 'うごメモ3D', sub: '3DS風・3レイヤー・6色' },
]

export type MarkDef = { id: string, name: string, w: number, h: number, data: string }

export const SE_PRESETS = ['coin', 'jump', 'hit', 'chime', 'blip', 'splash', 'woosh', 'ding', 'buzz', 'zip', 'thud', 'sparkle', 'horn']
export const SE_LABELS: { [k: string]: string } = { coin: 'コイン', jump: 'ジャンプ', hit: 'ヒット', chime: 'チャイム', blip: 'ピッ', splash: 'スプラッシュ', woosh: 'ヒュッ', ding: 'ディン', buzz: 'ブザー', zip: 'ジップ', thud: 'ドスン', sparkle: 'キラキラ', horn: 'ラッパ' }

export type Rle = Uint32Array

export type Frame = {
  id: number
  se: number
  hold: number
  pk: (Rle | null)[]
}

export type AnimFx = {
  wiggle: number
  wiggleAmount: number
  wiggleCell: number
  wiggleRate: number
  wigglePhases: number
  wiggleSeed: number
  motion: number
  motionAmount: number
  motionRate: number
  motionAnchorX: number
  motionAnchorY: number
  motionSeed: number
}

export function anim_fx_zero(): AnimFx {
  return { wiggle: 0, wiggleAmount: 2, wiggleCell: 28, wiggleRate: 8, wigglePhases: 4, wiggleSeed: 1, motion: MOTION_NONE, motionAmount: 2, motionRate: 2, motionAnchorX: 0.5, motionAnchorY: 0.82, motionSeed: 1 }
}

export type Doc = {
  meta: NoteMeta
  w: number
  h: number
  ratio: string
  res: string
  paper: string
  fps: number
  loop: number
  name: string
  frames: Frame[]
  cur: number
  loopA: number
  loopB: number
  lvis: Uint8Array
  lalpha: Uint8Array
  lord: number[]
  mode: number
  anim: AnimFx
}

export type Pen = {
  tool: number
  prevTool: number
  layer: number
  size: number
  color: string
  alpha: number
  pat: number
  outline: number
  ocolor: string
  owidth: number
  smooth: number
  pressure: number
  sym: number
  symy: number
  custom: string[]
  pxn: number
  fill: number
  palMode: number
  brush: number
  markId: string
  fillAll: number
}

export type ViewSt = {
  z: number
  px: number
  py: number
  fitZ: number
  onion: number
  ocount: number
  grid: number
  gsize: number
  page: string
  flip: number
  tlopen: number
}

export type PlaySt = {
  on: number
  acc: number
  last: number
  raf: number
}

export type SelSt = {
  has: number
  x: number
  y: number
  w: number
  h: number
  poly: number[] | null
}

export type FloatSt = {
  kind: number
  x: number
  y: number
  rot: number
  sx: number
  sy: number
  cont: number
  srcLayer: number
  srcRect: [number, number, number, number] | null
  srcBefore: Rle | null
}

export type Clip = {
  w: number
  h: number
}

export type AudioSlot = {
  bytes: ArrayBuffer | null
  name: string
}

export type SndSt = {
  bgm: AudioSlot[]
  se: AudioSlot[]
  bgmVol: number
  bgmFps: number
  seVol: number
}

export type HistEnt = {
  op: number
  grp: number
  f: number
  l: number
  x: number
  y: number
  w: number
  h: number
  before: Rle | null
  after: Rle | null
  snap: Frame | null
  a: number
  b: number
  bytes: number
}

export function fps_speed_tag(fps: number): string {
  for (let i = 0; i < FPS_SPEEDS.length; i++) if (Math.abs(FPS_SPEEDS[i] - fps) < 0.01) return 'はやさ ' + (i + 1)
  return 'カスタム'
}

export function reso_size(ratio: string, res: string): { w: number, h: number } {
  if (ratio === '4:3' && res === '3ds') return { w: 310, h: 230 }
  let a = ASPECTS[0]
  for (let i = 0; i < ASPECTS.length; i++) if (ASPECTS[i].name === ratio) a = ASPECTS[i]
  let m = 1
  for (let i = 0; i < RESOS.length; i++) if (RESOS[i].id === res) m = RESOS[i].mul
  const ev = (v: number) => {
    const rounded = Math.round(v)
    return (rounded & 1) === 0 ? rounded : rounded + 1
  }
  return { w: ev(a.w * m), h: ev(a.h * m) }
}

export const KWZ_PAL: [number, number, number][] = [
  [0xff, 0xff, 0xff],
  [0x10, 0x10, 0x10],
  [0xff, 0x10, 0x10],
  [0xff, 0xe7, 0x00],
  [0x00, 0x86, 0x31],
  [0x00, 0x38, 0xce],
]
export const HOLD_MAX = 8
