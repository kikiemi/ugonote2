import type { kwz_frame_meta_t } from './codec/kwzmeta'
import { kwz_speeds } from './codec/kwzformat'
export { kwz_speeds } from './codec/kwzformat'
export { ppm_speeds } from './codec/ppm'

export const app_name = 'うごくノート2'

export const l_p = 0
export const l_a = 1
export const l_b = 2
export const l_c = 3
export const l_base_n = 4
export const l_draw_min = 1
export const l_draw_default = 3
export const l_draw_max = 64
export const l_n = l_draw_max + 1

export const t_pen = 0
export const t_fill = 1
export const t_eraser = 2
export const t_eyedrop = 3
export const t_pixel = 4
export const t_line = 5
export const t_rect = 6
export const t_circle = 7
export const t_star = 8
export const t_heart = 9
export const t_text = 10
export const t_select = 11
export const t_lasso = 12
export const t_paste = 13
export const t_hand = 14
export const t_n = 15

export const b_pen = 0
export const b_marker = 1
export const b_pencil = 2
export const b_brush = 3
export const b_airbrush = 4
export const b_crayon = 5
export const b_callig = 6
export const b_dots = 7
export const b_water = 8
export const b_neon = 9
export const b_chalk = 10
export const b_spat = 11
export const b_ribbon = 12
export const b_n = 13

export const ef_none = 0
export const ef_blur = 1
export const ef_mosaic = 2
export const ef_glow = 3
export const ef_chroma = 4
export const ef_noise = 5
export const ef_outline = 6
export const ef_wave = 7

export const tr_none = 0
export const tr_fade = 1
export const tr_slide_l = 2
export const tr_slide_r = 3
export const tr_slide_u = 4
export const tr_slide_d = 5
export const tr_zoom_in = 6
export const tr_zoom_out = 7
export const tr_wipe = 8

export const mode_normal = 0
export const mode_dsi = 1
export const mode_3_d = 2

export const motion_none = 0
export const motion_breathe = 1
export const motion_sway = 2
export const motion_float = 3
export const motion_bounce = 4
export const motion_camera = 5
export const motion_n = 6

export const k_none = 0
export const k_paste = 1
export const k_photo = 2
export const k_text = 3
export const k_sel = 4

export const d_stage = 1 << 0
export const d_thumb = 1 << 1
export const d_timeline = 1 << 2
export const d_frameinfo = 1 << 3
export const d_tools = 1 << 4
export const d_pen = 1 << 5
export const d_layer = 1 << 6
export const d_play = 1 << 7
export const d_zoom = 1 << 8
export const d_sound = 1 << 9
export const d_save = 1 << 10
export const d_page = 1 << 11
export const d_onion = 1 << 12
export const d_sel = 1 << 13
export const d_grid = 1 << 14
export const d_trans = 1 << 15
export const d_mode = 1 << 16
export const d_anim = 1 << 17
export const d_all = 0x3ffff

export const op_pix = 0
export const op_frame_ins = 1
export const op_frame_del = 2
export const op_frame_move = 3
export const op_se = 4
export const op_layer_alpha = 5
export const op_frame_cursor = 6
export const op_paper = 7

export const pal_std = 0
export const pal_ppm = 1
export const pal_kwz = 2

export const err_ok = 0
export const err_bad = -1
export const err_full = -2
export const err_io = -3
export const err_noop = -4

export type note_meta_t = {
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

export function note_meta_zero(): note_meta_t {
  return { root_name: '', parent_name: '', cur_name: '', root_id: '', parent_id: '', cur_id: '', root_fn: '', parent_fn: '', cur_fn: '', created: 0, modified: 0, edits: 0, lock: 0, flags: 0, layer_flags: 0, app_ver: 0 }
}

export const max_frames_normal = 9999
export const max_frames_flipnote = 999
export const autosave_ms = 2500
export const thumb_w = 96
export const thumb_h = 72
export const zoom_min = 0.05
export const zoom_max = 32
export const longpress_ms = 300
export const drag_slop = 8

export const sizes = [1, 2, 3, 5, 8, 12, 16, 24, 32]
export const size_min = 1
export const size_max = 64
export const pxn_min = 4
export const pxn_max = 128
export const pixel_ns = [8, 16, 32, 48, 64]
export const fps_speeds = kwz_speeds

export const aspects = [
  { name: '4:3', w: 512, h: 384 },
  { name: '16:9', w: 512, h: 288 },
  { name: '1:1', w: 400, h: 400 },
  { name: '3:4', w: 384, h: 512 },
  { name: '9:16', w: 288, h: 512 },
]
export const resos = [
  { id: 'low', label: '低画質', mul: 1 },
  { id: 'mid', label: '中画質', mul: 1.875 },
  { id: 'hd', label: 'HD', mul: 2.5 },
  { id: '4k', label: '4K', mul: 7.5 },
  { id: 'dsi', label: 'DSi実寸', mul: 0.5 },
  { id: '3ds', label: '3DS実寸', mul: 0.625 },
]

export const pat_table: { id: string, label: string, rows: number[] }[] = [
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

export const ink_std = ['#111111', '#E02020', '#2060E0', '#20A020', '#F0C000', '#FF6B9D', '#9C27B0', '#FF8C00', '#00BCD4', '#795548', '#607D8B', '#8BC34A', '#CDDC39', '#FF5722', '#E91E63', '#FFFFFF']
export const paper_std = ['#FFFFFF', '#1A1A1A', '#FFF8E7', '#E8F5E9', '#E3F2FD', '#FCE4EC', '#F3E5F5', '#FFF3E0', '#ECEFF1', '#263238']
export const ink_ppm = ['#0E0E0E', '#FF2A2A', '#0A39FF', '#FFFFFF']
export const paper_ppm = ['#FFFFFF', '#0E0E0E']
export const ink_kwz = ['#101010', '#FF1010', '#FFE700', '#008631', '#0038CE', '#FFFFFF']
export const paper_kwz = ['#FFFFFF', '#101010', '#FF1010', '#FFE700', '#008631', '#0038CE']

export const brush_defs: { id: number, icon: string, label: string }[] = [
  { id: b_pen, icon: 'pen', label: 'ペン' },
  { id: b_marker, icon: 'marker', label: 'マーカー' },
  { id: b_pencil, icon: 'pencil', label: 'えんぴつ' },
  { id: b_brush, icon: 'brush', label: 'ふで' },
  { id: b_airbrush, icon: 'airbrush', label: 'エアブラシ' },
  { id: b_crayon, icon: 'crayon', label: 'クレヨン' },
  { id: b_callig, icon: 'callig', label: 'つけペン' },
  { id: b_dots, icon: 'bdots', label: 'てんてん' },
  { id: b_water, icon: 'water', label: 'すいさい' },
  { id: b_neon, icon: 'neon', label: 'ネオン' },
  { id: b_chalk, icon: 'chalk', label: 'チョーク' },
  { id: b_spat, icon: 'spat', label: 'しぶき' },
  { id: b_ribbon, icon: 'ribbon', label: 'リボン' },
]

export const effect_defs: { id: number, icon: string, label: string, desc: string }[] = [
  { id: ef_blur, icon: 'blur', label: 'ぼかし', desc: 'やわらかくにじませる' },
  { id: ef_mosaic, icon: 'mosaic', label: 'モザイク', desc: '四角く粗くする' },
  { id: ef_glow, icon: 'glow', label: '発光', desc: 'ふんわり光らせる' },
  { id: ef_chroma, icon: 'chroma', label: '色ずれ', desc: 'RGBをずらす' },
  { id: ef_noise, icon: 'noise', label: 'ノイズ', desc: 'ざらざらを足す' },
  { id: ef_outline, icon: 'outline', label: 'フチ抽出', desc: '輪郭線をつくる' },
  { id: ef_wave, icon: 'wave', label: '波', desc: 'ゆらゆら歪ませる' },
]

export const transition_defs: { id: number, label: string }[] = [
  { id: tr_fade, label: 'フェード' },
  { id: tr_slide_l, label: '左へスライド' },
  { id: tr_slide_r, label: '右へスライド' },
  { id: tr_slide_u, label: '上へスライド' },
  { id: tr_slide_d, label: '下へスライド' },
  { id: tr_zoom_in, label: 'ズームイン' },
  { id: tr_zoom_out, label: 'ズームアウト' },
  { id: tr_wipe, label: 'ワイプ' },
]

export const mode_defs: { id: number, label: string, sub: string }[] = [
  { id: mode_normal, label: 'ノーマル', sub: '自由に描ける拡張モード' },
  { id: mode_dsi, label: 'うごメモ', sub: 'DSi風・2レイヤー・実機準拠' },
  { id: mode_3_d, label: 'うごメモ3D', sub: '3DS風・3レイヤー・6色' },
]

export type mark_def_t = { id: string, name: string, w: number, h: number, data: string }

export const se_presets = ['coin', 'jump', 'hit', 'chime', 'blip', 'splash', 'woosh', 'ding', 'buzz', 'zip', 'thud', 'sparkle', 'horn']
export const se_labels: { [k: string]: string } = { coin: 'コイン', jump: 'ジャンプ', hit: 'ヒット', chime: 'チャイム', blip: 'ピッ', splash: 'スプラッシュ', woosh: 'ヒュッ', ding: 'ディン', buzz: 'ブザー', zip: 'ジップ', thud: 'ドスン', sparkle: 'キラキラ', horn: 'ラッパ' }

export type rle_t = Uint32Array

export type frame_t = {
  id: number
  se: number
  hold: number
  paper?: string
  kwz?: kwz_frame_meta_t
  pk: (rle_t | null)[]
}

export type anim_fx_t = {
  wiggle: number
  wiggle_amount: number
  wiggle_cell: number
  wiggle_rate: number
  wiggle_phases: number
  wiggle_seed: number
  motion: number
  motion_amount: number
  motion_rate: number
  motion_anchor_x: number
  motion_anchor_y: number
  motion_seed: number
}

export function anim_fx_zero(): anim_fx_t {
  return { wiggle: 0, wiggle_amount: 2, wiggle_cell: 28, wiggle_rate: 8, wiggle_phases: 4, wiggle_seed: 1, motion: motion_none, motion_amount: 2, motion_rate: 2, motion_anchor_x: 0.5, motion_anchor_y: 0.82, motion_seed: 1 }
}

export type doc_t = {
  meta: note_meta_t
  w: number
  h: number
  ratio: string
  res: string
  paper: string
  fps: number
  loop: number
  name: string
  frames: frame_t[]
  cur: number
  loop_a: number
  loop_b: number
  lvis: Uint8Array
  lalpha: Uint8Array
  lord: number[]
  mode: number
  anim: anim_fx_t
}

export type paint_tile_t = { w: number, h: number, b: number[], rgba?: number[] }

export type pen_t = {
  tool: number
  prev_tool: number
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
  pal_mode: number
  brush: number
  native_tip: number
  mark_id: string
  fill_all: number
  paint_over: number
  paint_tile: paint_tile_t | null
  paint_tile_normal: paint_tile_t | null
}

export type view_st_t = {
  z: number
  px: number
  py: number
  fit_z: number
  onion: number
  ocount: number
  oprev: number
  onext: number
  grid: number
  gsize: number
  page: string
  flip: number
  tlopen: number
}

export type play_st_t = {
  on: number
  acc: number
  last: number
  raf: number
}

export type sel_st_t = {
  has: number
  x: number
  y: number
  w: number
  h: number
  poly: number[] | null
}

export type float_st_t = {
  kind: number
  x: number
  y: number
  rot: number
  sx: number
  sy: number
  cont: number
  src_layer: number
  src_poly: number[] | null
  src_rect: [number, number, number, number] | null
  src_before: rle_t | null
}

export type clip_t = {
  w: number
  h: number
}

export type audio_slot_t = {
  bytes: ArrayBuffer | null
  name: string
}

export type snd_st_t = {
  bgm: audio_slot_t[]
  se: audio_slot_t[]
  bgm_vol: number
  bgm_fps: number
  se_vol: number
}

export type hist_ent_t = {
  paper?: { before: string, after: string, frames: (string | undefined)[] }
  op: number
  grp: number
  f: number
  l: number
  x: number
  y: number
  w: number
  h: number
  before: rle_t | null
  after: rle_t | null
  snap: frame_t | null
  a: number
  b: number
  bytes: number
}

export function reso_size(ratio: string, res: string): { w: number, h: number } {
  if (ratio === '4:3' && res === '3ds') return { w: 310, h: 230 }
  let a = aspects[0]
  for (let i = 0; i < aspects.length; i++) if (aspects[i].name === ratio) a = aspects[i]
  let m = 1
  for (let i = 0; i < resos.length; i++) if (resos[i].id === res) m = resos[i].mul
  const ev = (v: number) => {
    const rounded = Math.round(v)
    return (rounded & 1) === 0 ? rounded : rounded + 1
  }
  return { w: Math.min(4096, ev(a.w * m)), h: Math.min(4096, ev(a.h * m)) }
}

export const kwz_pal: [number, number, number][] = [
  [0xff, 0xff, 0xff],
  [0x10, 0x10, 0x10],
  [0xff, 0x10, 0x10],
  [0xff, 0xe7, 0x00],
  [0x00, 0x86, 0x31],
  [0x00, 0x38, 0xce],
]
export const hold_max = 8
