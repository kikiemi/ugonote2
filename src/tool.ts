import { brush_begin, brush_point, brush_compose, brush_is_direct, brush_seed } from './brush'
import { native_paint_bucket, pen_tool } from './penprofile'
import { nd_begin, nd_bucket, nd_constrain, nd_eraser, nd_ink, nd_keys, nd_line, nd_outline, nd_oval, nd_paint, nd_paint_px, nd_pen, nd_pen_index, nd_plot, nd_rand_load, nd_rand_save, nd_rect, nd_shape, nd_state, nd_step, nd_surface, type nd_rand_t, type nd_state_t, type nd_surface_t } from './nativedraw'
import { nt_flush, nt_frame, nt_make, type nt_point_t, type nt_sample_t } from './nativetouch'
import { kwz_border } from './codec/kwzgeom'
import { ds_box_of_pat, ds_brush_solid_paint, ds_down, ds_eraser_brushes, ds_line_to, ds_paint_brushes, ds_pen_brushes, ds_pen_pro_brushes, ds_sample, ds_samples, ds_seed, ds_seed_value, ds_state, type ds_state_t } from './dsidraw'
import { paint_active, paint_pattern } from './paint'
import { doc_frame_order, doc_frame_paper, doc_compose, doc_layer_pixel, pack_canvas } from './doc'
import { toast } from './dom'
import { live_slot, live_write, live_canvas } from './engine'
import { pat_canvas, mask_make, mask_rect, mask_polyline, mask_poly_fill, mask_outline_ring, blend_mask, paint_mask, flood_mask, shape_pts, path_smooth, type mask_t } from './gfx'
import { t_fill, t_eraser, t_pixel, t_line, t_rect, t_circle, t_arrow, d_stage, mode_dsi, mode_normal, is_shape_tool, shape_index } from './h'
import { hist_grp, rect_grab } from './hist'
import { canvas_make, clamp, hex_rgb, rle_pack } from './lib'
import { mode_one_sheet, mode_order, sheet_layer } from './mode'
import { pen_begin, pen_point, pen_draw } from './penstroke'
import { sfx_play } from './snd'
import { dispatch } from './state/commands'
import { st, dirty } from './state/store'

let pv: CanvasRenderingContext2D | null = null
let stroking = 0
let live_mode = 0
let pts: number[] = []
let anchor = [0, 0]
let ema = [0, 0]
let shift_held = 0
let snap_canvas: HTMLCanvasElement | null = null
let union_box = [0, 0, -1, -1]
let work_mask: mask_t | null = null
let brush_mode = 0
let pen_mode = 0
let stroke_raf = 0
let pixel_at: [number, number] | null = null
let nd_surf: nd_surface_t | null = null
let nd_layers: { l: number, img: ImageData, base: Uint8ClampedArray }[] = []
let nd_states: { st: nd_state_t, fx: number, fy: number }[] = []
let nd_raf = 0
let nd_clock = 0
let nd_at = [0, 0]
let nd_done = [0, 0]
let nd_kind = -1
let nd_shape_rand: nd_rand_t | null = null
let nd_box = [0, 0, -1, -1]
const nd_frame = 1000 / 60
// うごメモ3D のタッチの補正 (nativetouch)。実機と同じく、ペンを離しても状態は持ち越す。
const nt = nt_make()
let nt_count = 0
let nt_quirk = 0
// うごメモ (DSi) は別の描画処理 (dsidraw)。タッチを1フレームに4回読む。
let ds_states: { st: ds_state_t, fx: number, fy: number }[] = []
let ds_count = 0
let ds_shape_seed = 0

export function tool_bind_preview(ctx: CanvasRenderingContext2D): void {
  pv = ctx
}

export function tool_mod_shift(v: number): void {
  shift_held = v
}

export function tool_is_stroking(): number {
  return stroking
}

function shape_kind(t: number): number {
  return shape_index(t)
}

function is_shape(t: number): number {
  return is_shape_tool(t)
}

function box_union(x0: number, y0: number, x1: number, y1: number): void {
  const g = st()
  if (x0 < union_box[0]) union_box[0] = Math.max(0, x0)
  if (y0 < union_box[1]) union_box[1] = Math.max(0, y0)
  if (x1 > union_box[2]) union_box[2] = Math.min(g.doc.w - 1, x1)
  if (y1 > union_box[3]) union_box[3] = Math.min(g.doc.h - 1, y1)
}

function pv_clear(): void {
  const g = st()
  if (pv) pv.clearRect(0, 0, g.doc.w, g.doc.h)
}

function pv_style(erasing: number): void {
  const g = st()
  if (!pv) return
  pv.lineCap = 'round'
  pv.lineJoin = 'round'
  pv.globalAlpha = erasing ? 0.6 : g.pen.alpha
  if (erasing) {
    pv.strokeStyle = '#FFFFFF'
    pv.fillStyle = '#FFFFFF'
    return
  }
  if (g.pen.pat > 0) {
    const p = pv.createPattern(pat_canvas(g.pen.pat, g.pen.color), 'repeat') as CanvasPattern
    pv.strokeStyle = p
    pv.fillStyle = p
  } else {
    pv.strokeStyle = g.pen.color
    pv.fillStyle = g.pen.color
  }
}

function pv_path(list: number[], width: number, style: string | null): void {
  if (!pv || list.length < 2) return
  if (style) {
    pv.strokeStyle = style
    pv.globalAlpha = st().pen.alpha
  }
  pv.lineWidth = width
  pv.beginPath()
  pv.moveTo(list[0], list[1])
  for (let i = 1; i < list.length >> 1; i++) pv.lineTo(list[i * 2], list[i * 2 + 1])
  if (list.length === 2) pv.lineTo(list[0] + 0.01, list[1])
  pv.stroke()
}

function shape_constrain(x: number, y: number): [number, number] {
  if (!shift_held) return [x, y]
  const t = st().pen.tool
  if (t === t_line || t === t_arrow) {
    const dx = x - anchor[0]
    const dy = y - anchor[1]
    const a = Math.atan2(dy, dx)
    const snap = Math.round(a / (Math.PI / 4)) * (Math.PI / 4)
    const d = Math.sqrt(dx * dx + dy * dy)
    return [anchor[0] + Math.cos(snap) * d, anchor[1] + Math.sin(snap) * d]
  }
  const s = Math.max(Math.abs(x - anchor[0]), Math.abs(y - anchor[1]))
  return [anchor[0] + Math.sign(x - anchor[0] || 1) * s, anchor[1] + Math.sign(y - anchor[1] || 1) * s]
}

// ドットは、前に塗ったマスから今のマスまでを、すき間なくつないで塗る (細かいマスで速く動かしても途切れない)。
function stamp_cell(bx: number, by: number): void {
  const g = st()
  const n = clamp(g.pen.pxn, 2, Math.min(256, g.doc.w))
  const cell = g.doc.w / n
  const gx = Math.floor(bx / cell)
  const gy = Math.floor(by / cell)
  const [sx, sy] = pixel_at || [gx, gy]
  pixel_at = [gx, gy]
  const m = work_mask as mask_t
  const put = (cgx: number, cgy: number) => {
    const x0 = Math.round(cgx * cell)
    const y0 = Math.round(cgy * cell)
    const x1 = Math.round((cgx + 1) * cell)
    const y1 = Math.round((cgy + 1) * cell)
    m.x0 = m.w
    m.y0 = m.h
    m.x1 = -1
    m.y1 = -1
    for (let y = Math.max(0, y0); y < Math.min(g.doc.h, y1); y++) m.b.fill(0, y * m.w + Math.max(0, x0), y * m.w + Math.min(g.doc.w, x1))
    mask_rect(m, x0, y0, x1 - x0, y1 - y0)
    if (m.x1 < m.x0) return
    blend_mask(live_write(g.pen.layer), m, g.pen.color, 1, 0)
    box_union(m.x0, m.y0, m.x1, m.y1)
  }
  const ny = Math.max(1, Math.round(n * (g.doc.h / g.doc.w)))
  const steps = Math.max(Math.abs(gx - sx), Math.abs(gy - sy))
  for (let i = steps ? 1 : 0; i <= steps; i++) {
    const cx = steps ? sx + Math.round((gx - sx) * i / steps) : gx
    const cy = steps ? sy + Math.round((gy - sy) * i / steps) : gy
    put(cx, cy)
    if (g.pen.sym) put(n - 1 - cx, cy)
    if (g.pen.symy) put(cx, ny - 1 - cy)
    if (g.pen.sym && g.pen.symy) put(n - 1 - cx, ny - 1 - cy)
  }
}

function sym_variants(pts: number[], fn: (p: number[]) => void): void {
  const g = st()
  const mx = (p: number[]) => {
    const o = p.slice()
    for (let i = 0; i < o.length; i += 2) o[i] = g.doc.w - o[i]
    return o
  }
  const my = (p: number[]) => {
    const o = p.slice()
    for (let i = 1; i < o.length; i += 2) o[i] = g.doc.h - o[i]
    return o
  }
  if (g.pen.sym) fn(mx(pts))
  if (g.pen.symy) fn(my(pts))
  if (g.pen.sym && g.pen.symy) fn(my(mx(pts)))
}

export function tool_down(bx: number, by: number, pressure: number): number {
  stroke_flush_cancel()
  const g = st()
  const t = g.pen.tool
  if (mode_one_sheet(g.doc) && g.pen.layer !== sheet_layer(g.pen.color)) dispatch('pen.set_layer', sheet_layer(g.pen.color))
  if (t === t_fill && !tool_fill_brush()) {
    tool_fill(bx, by)
    return 0
  }
  stroking = 1
  anchor = [bx, by]
  ema = [bx, by]
  pts = [bx, by]
  union_box = [g.doc.w, g.doc.h, -1, -1]
  if (!work_mask || work_mask.w !== g.doc.w || work_mask.h !== g.doc.h) work_mask = mask_make(g.doc.w, g.doc.h)
  live_mode = 0
  if (t === t_pixel) {
    live_mode = 1
    snap_take()
    pixel_at = null
    stamp_cell(bx, by)
    dirty(d_stage)
    return 1
  }
  if (g.doc.mode !== mode_normal && (pen_tool(t) || t === t_eraser || t === t_fill)) {
    live_mode = 1
    brush_mode = 0
    pen_mode = 0
    snap_take()
    nd_start(bx, by)
    return 1
  }
  if (pen_tool(t) && brush_is_direct(g.pen.brush)) {
    live_mode = 1
    brush_mode = 1
    pen_mode = 0
    brush_seed((Math.floor(bx * 131 + by * 977) | 1) >>> 0)
    snap_take()
    brush_begin(ema[0], ema[1], pressure)
    const bb = brush_compose(live_write(g.pen.layer), snap_canvas as HTMLCanvasElement)
    if (bb) box_union(bb[0], bb[1], bb[2], bb[3])
    dirty(d_stage)
    return 1
  }
  if (pen_tool(t) || t === t_eraser) {
    live_mode = 1
    brush_mode = 0
    pen_mode = 1
    snap_take()
    pen_begin(ema[0], ema[1], pressure)
    const b0 = pen_draw(live_write(g.pen.layer), snap_canvas as HTMLCanvasElement, t === t_eraser ? 1 : 0, 0)
    if (b0) box_union(b0[0], b0[1], b0[2], b0[3])
    dirty(d_stage)
    return 1
  }
  const kind = t === t_line ? nd_line : t === t_rect ? nd_rect : t === t_circle ? nd_oval : -1
  if (g.doc.mode !== mode_normal && kind >= 0) {
    live_mode = 1
    brush_mode = 0
    pen_mode = 0
    snap_take()
    nd_shape_start(kind, bx, by)
    return 1
  }
  pv_clear()
  pv_style(0)
  return 1
}

function snap_take(): void {
  const g = st()
  if (!snap_canvas || snap_canvas.width !== g.doc.w || snap_canvas.height !== g.doc.h) {
    const [c] = canvas_make(g.doc.w, g.doc.h, 1)
    snap_canvas = c
  }
  const x = snap_canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  x.clearRect(0, 0, g.doc.w, g.doc.h)
  x.drawImage(live_canvas(g.pen.layer), 0, 0)
}

// うごメモ・うごメモ3Dモードのペイントは、バケツ以外ならペン先で塗る。
export function tool_fill_brush(): number {
  const g = st()
  return g.doc.mode !== mode_normal && g.pen.native_paint !== native_paint_bucket ? 1 : 0
}

function nd_tile(): ReturnType<typeof paint_pattern> {
  const g = st()
  return paint_pattern(g.doc.mode, g.pen.pat, paint_active(g.doc.mode, g.pen.paint_tile, g.pen.paint_tile_normal))
}

function nd_map(s: { fx: number, fy: number }, x: number, y: number): [number, number] {
  const g = st()
  return [s.fx ? g.doc.w - 1 - x : x, s.fy ? g.doc.h - 1 - y : y]
}

// 描くレイヤーの絵を取り出す。普通ふでばこ (うごメモ3D) は1枚の紙として描くので、ほかの2枚のレイヤーの同じ点も消す。
function nd_open(): nd_surface_t {
  const g = st()
  const ls = [g.pen.layer]
  if (mode_one_sheet(g.doc)) for (let l = 1; l <= 3; l++) if (l !== g.pen.layer) ls.push(l)
  nd_layers = ls.map(l => {
    const img = live_write(l).getImageData(0, 0, g.doc.w, g.doc.h)
    return { l, img, base: new Uint8ClampedArray(img.data) }
  })
  const [px, ...others] = nd_layers.map(item => new Uint32Array(item.img.data.buffer))
  return nd_surface(g.doc.w, g.doc.h, px, nd_ink(g.pen.color), nd_tile(), g.pen.paint_over, others)
}

function nd_put(x: number, y: number, w: number, h: number): void {
  for (const item of nd_layers) live_write(item.l).putImageData(item.img, 0, 0, x, y, w, h)
}

function nd_commit(grp: number): void {
  const g = st()
  if (union_box[2] < union_box[0]) return
  const [x, y] = union_box
  const w = union_box[2] - x + 1
  const h = union_box[3] - y + 1
  const changes = nd_layers.map(item => {
    const words = new Uint32Array(item.base.buffer)
    const rect = new Uint32Array(w * h)
    for (let row = 0; row < h; row++) rect.set(words.subarray((y + row) * g.doc.w + x, (y + row) * g.doc.w + x + w), row * w)
    return { layer: item.l, x, y, w, h, before: rle_pack(rect) }
  })
  dispatch('frame.commit_pixels', { grp, frame: g.doc.cur, changes })
}

// DSi のブラシ番号と設定を、いまの道具・ペン先・もようから決める。
function ds_make(s: nd_surface_t, kind: number): ds_state_t {
  const g = st()
  const box = ds_box_of_pat(g.pen.pat)
  let brush = 0
  if (kind === nd_pen) brush = g.pen.native_tip >= 8 ? ds_pen_pro_brushes[g.pen.native_tip & 7] : ds_pen_brushes[g.pen.native_tip & 7]
  else if (kind === nd_eraser) brush = ds_eraser_brushes[g.pen.native_eraser & 7]
  else brush = box < 0 ? ds_brush_solid_paint : ds_paint_brushes[box]
  const ds = ds_state(s, brush)
  ds.size = g.pen.native_paint === 1 ? 2 : g.pen.native_paint === 2 ? 1 : 0
  ds.pat_erase = kind === nd_eraser && g.pen.native_eraser >= 8 ? 1 : 0
  ds.pat = Math.max(0, box)
  return ds
}

// 対称描画のぶんも含めた、描く向き (左右・上下の反転) の組。
function nd_flips(): [number, number][] {
  const g = st()
  const out: [number, number][] = [[0, 0]]
  if (g.pen.sym) out.push([1, 0])
  if (g.pen.symy) out.push([0, 1])
  if (g.pen.sym && g.pen.symy) out.push([1, 1])
  return out
}

function nd_moved(): boolean {
  return Math.floor(nd_at[0]) !== nd_done[0] || Math.floor(nd_at[1]) !== nd_done[1]
}

function nd_start(bx: number, by: number): void {
  const g = st()
  nd_surf = nd_open()
  const t = g.pen.tool
  const kind = pen_tool(t) ? nd_pen : t === t_eraser ? nd_eraser : nd_paint
  if (kind === nd_pen && g.pen.pat) nd_surf.mask = nd_tile()
  nd_at = [bx, by]
  nd_done = [Math.floor(bx), Math.floor(by)]
  nd_clock = performance.now()
  if (g.doc.mode === mode_dsi) ds_start(kind)
  else nt_start(kind)
  nd_flush()
  nd_raf = requestAnimationFrame(nd_loop)
}

// 実機はフレーム (60fps) ごとに入力を区切る。DSi は止まっていても毎回ブラシを呼び、3D は補正 (nativetouch) が点を出したときだけ呼ぶ。
function nd_loop(now: number): void {
  nd_raf = 0
  if (!nd_surf) return
  let n = Math.floor((now - nd_clock) / nd_frame)
  if (n > 0) {
    if (n > 6) {
      n = 6
      nd_clock = now
    } else nd_clock += n * nd_frame
    if (ds_states.length) ds_advance(n)
    else nt_advance(n, nd_clock)
    nd_flush()
  }
  nd_raf = requestAnimationFrame(nd_loop)
}

function nd_finish(bx: number, by: number): void {
  nd_at = [bx, by]
  if (nd_kind >= 0) {
    nd_shape_render()
    union_box = [st().doc.w, st().doc.h, -1, -1]
    box_union(nd_box[0], nd_box[1], nd_box[2], nd_box[3])
  } else if (ds_states.length) ds_finish()
  else nt_finish()
  if (nd_raf) cancelAnimationFrame(nd_raf)
  nd_raf = 0
}

// DSi: 触れた点で描き始め、そのあとはタッチを1フレームに4回読む。
function ds_start(kind: number): void {
  const s = nd_surf!
  ds_states = nd_flips().map(([fx, fy]) => ({ st: ds_make(s, kind), fx, fy }))
  for (const d of ds_states) {
    const [mx, my] = nd_map(d, nd_done[0], nd_done[1])
    ds_down(d.st, mx, my)
    d.st.start = 1
    ds_sample(d.st, mx, my)
  }
  ds_count = 1
}

// DSi: 前に読んだ位置から今の位置までを、そのあいだに読む回数で割って並べる。
// 描き始めのフレームのあいだは、実機と同じく「描き始め」の印を立てたままにする。
function ds_advance(n: number): void {
  const tx = Math.floor(nd_at[0])
  const ty = Math.floor(nd_at[1])
  const [sx, sy] = nd_done
  const m = n * ds_samples
  for (let i = 1; i <= m; i++) {
    const x = Math.round(sx + (tx - sx) * i / m)
    const y = Math.round(sy + (ty - sy) * i / m)
    for (const d of ds_states) {
      const [mx, my] = nd_map(d, x, y)
      d.st.start = ds_count < ds_samples ? 1 : 0
      ds_sample(d.st, mx, my)
    }
    ds_count++
  }
  nd_done = [tx, ty]
}

// DSi: 実機はペンを離したときに、最後の点でもう一度ブラシを呼ぶ。
function ds_finish(): void {
  if (nd_moved()) ds_advance(1)
  for (const d of ds_states) {
    const [mx, my] = nd_map(d, nd_done[0], nd_done[1])
    ds_sample(d.st, mx, my)
  }
  nd_flush()
}

// 3D: 触れたフレームから補正 (nativetouch) にかける。描き始めの点は、補正が出したときに nd_begin へ渡る。
function nt_start(kind: number): void {
  const g = st()
  const s = nd_surf!
  const tip = kind === nd_pen ? nd_pen_index(g.pen.native_tip) : kind === nd_eraser ? g.pen.native_eraser : g.pen.native_paint
  nd_states = nd_flips().map(([fx, fy]) => ({ st: nd_state(kind, tip, s), fx, fy }))
  nt_quirk = kind === nd_pen && tip === 12 ? 1 : 0
  nt_advance(1, nd_clock)
}

// 3D: 実機はタッチを 4ms ごと (1フレームに4〜5回) に読む。前に読んだ位置から今の位置までを、その回数で割って並べる。
// 補正は実機の画面の座標で行う (紙の左上が (5, 5))。
function nt_advance(n: number, now: number): void {
  const tx = Math.floor(nd_at[0])
  const ty = Math.floor(nd_at[1])
  const [sx, sy] = nd_done
  const counts: number[] = []
  for (let j = 0; j < n; j++, nt_count++) counts.push(Math.floor((nt_count + 1) * nd_frame / 4) - Math.floor(nt_count * nd_frame / 4))
  const m = counts.reduce((a, b) => a + b, 0)
  let i = 0
  for (let j = 0; j < n; j++) {
    const raw: nt_sample_t[] = []
    for (let k = 0; k < counts[j]; k++) {
      i++
      raw.push({ x: Math.round(sx + (tx - sx) * i / m) + kwz_border, y: Math.round(sy + (ty - sy) * i / m) + kwz_border, t: 1 })
    }
    nt_apply(nt_frame(nt, raw, now - (n - 1 - j) * nd_frame, nt_quirk))
  }
  nd_done = [tx, ty]
}

function nt_apply(pts: nt_point_t[]): void {
  for (const p of pts) {
    for (const s of nd_states) {
      const [mx, my] = nd_map(s, p.x - kwz_border, p.y - kwz_border)
      if (p.start) nd_begin(s.st, mx, my)
      else nd_step(s.st, mx, my)
    }
  }
}

// 3D: 離したあとの数フレームで、補正に残っている点が出る (軽くたたいたときの点もここで打たれる)。
function nt_finish(): void {
  if (nd_moved()) {
    nd_clock += nd_frame
    nt_advance(1, nd_clock)
  }
  nt_apply(nt_flush(nt, nd_clock + nd_frame, nt_quirk, nd_frame))
  nd_flush()
}

function nd_flush(): void {
  const s = nd_surf
  if (!s || s.x1 < s.x0) return
  nd_put(s.x0, s.y0, s.x1 - s.x0 + 1, s.y1 - s.y0 + 1)
  box_union(s.x0, s.y0, s.x1, s.y1)
  s.x0 = s.w
  s.y0 = s.h
  s.x1 = -1
  s.y1 = -1
  dirty(d_stage)
}

function nd_stop(): void {
  if (nd_raf) cancelAnimationFrame(nd_raf)
  nd_raf = 0
  nd_surf = null
  nd_layers = []
  nd_kind = -1
  nd_states = []
  ds_states = []
}

// 図形は実機と同じく、動かすたびに元の絵へ戻してから今のペン先で描き直す。
function nd_shape_start(kind: number, bx: number, by: number): void {
  nd_surf = nd_open()
  if (st().pen.pat) nd_surf.mask = nd_tile()
  nd_kind = kind
  nd_shape_rand = nd_rand_save()
  ds_shape_seed = ds_seed_value()
  anchor = [Math.floor(bx), Math.floor(by)]
  nd_at = [bx, by]
  nd_shape_render()
}

function nd_shape_render(): void {
  const g = st()
  const s = nd_surf
  if (!s) return
  for (const item of nd_layers) item.img.data.set(item.base)
  s.x0 = s.w
  s.y0 = s.h
  s.x1 = -1
  s.y1 = -1
  if (nd_shape_rand) nd_rand_load(nd_shape_rand)
  const tip = nd_pen_index(g.pen.native_tip)
  const ex = Math.floor(nd_at[0])
  const ey = Math.floor(nd_at[1])
  ds_seed(ds_shape_seed)
  for (const [fx, fy] of nd_flips()) {
    const [ax, ay] = nd_map({ fx, fy }, anchor[0], anchor[1])
    const [bx, by] = nd_map({ fx, fy }, ex, ey)
    if (g.pen.fill && nd_kind !== nd_line) nd_fill_outline(s, nd_outline(nd_kind, ax, ay, bx, by, shift_held))
    if (g.doc.mode === mode_dsi) ds_shape(s, nd_kind, ax, ay, bx, by, shift_held)
    else nd_shape(nd_state(nd_pen, tip, s), nd_kind, ax, ay, bx, by, shift_held)
  }
  nd_box = [s.x0, s.y0, s.x1, s.y1]
  nd_put(0, 0, s.w, s.h)
  dirty(d_stage)
}

// DSi には図形がないので (ugonote2 の追加機能)、いまのペンで図形のふちを順にたどって描く。
function ds_shape(s: nd_surface_t, kind: number, ax: number, ay: number, bx: number, by: number, held: number): void {
  const [ex, ey] = nd_constrain(kind, ax, ay, bx, by, held)
  let path: [number, number][] = [[ax, ay], [ex, ey]]
  if (kind === nd_rect) path = [[ax, ey], [ax, ay], [ex, ay], [ex, ey], [ax, ey]]
  else if (kind === nd_oval) {
    path = nd_outline(kind, ax, ay, bx, by, held).slice().sort((p, q) => Math.atan2(p[1] - ay, p[0] - ax) - Math.atan2(q[1] - ay, q[0] - ax))
    if (!path.length) path = [[ax, ay]]
    path.push(path[0])
  }
  const d = ds_make(s, nd_pen)
  ds_down(d, path[0][0], path[0][1])
  d.start = 1
  ds_line_to(d, path[0][0], path[0][1])
  for (let i = 1; i < path.length; i++) {
    d.start = i < ds_samples ? 1 : 0
    ds_line_to(d, path[i][0], path[i][1])
  }
}

function nd_fill_outline(s: nd_surface_t, pts: [number, number][]): void {
  const lo = new Map<number, number>()
  const hi = new Map<number, number>()
  for (const [x, y] of pts) {
    lo.set(y, Math.min(lo.get(y) ?? x, x))
    hi.set(y, Math.max(hi.get(y) ?? x, x))
  }
  for (const [y, x0] of lo) for (let x = x0; x <= (hi.get(y) as number); x++) nd_plot(s, x, y)
}

export function tool_move(bx: number, by: number, pressure: number): void {
  const g = st()
  if (!stroking) return
  const t = g.pen.tool
  if (live_mode) {
    if (nd_surf) {
      nd_at = [bx, by]
      if (nd_kind >= 0) stroke_flush()
      return
    }
    if (t === t_pixel) {
      stamp_cell(bx, by)
      dirty(d_stage)
      return
    }
    if (pen_mode) {
      pen_point(bx, by, pressure)
      stroke_flush()
    } else if (brush_mode) {
      brush_point(bx, by, pressure)
      stroke_flush()
    }
    dirty(d_stage)
    return
  }
  if (is_shape(t)) {
    const [cx, cy] = shape_constrain(bx, by)
    pv_clear()
    pv_style(0)
    const sp = shape_pts(shape_kind(t), anchor[0], anchor[1], cx, cy)
    if (g.pen.fill && t !== t_line) {
      if (!pv) return
      pv.beginPath()
      pv.moveTo(sp[0], sp[1])
      for (let i = 1; i < sp.length >> 1; i++) pv.lineTo(sp[i * 2], sp[i * 2 + 1])
      pv.closePath()
      pv.fill()
    }
    if (g.pen.outline) pv_path(t === t_line ? sp : sp.concat(sp[0], sp[1]), g.pen.size + g.pen.owidth * 2, g.pen.ocolor)
    pv_style(0)
    pv_path(t === t_line ? sp : sp.concat(sp[0], sp[1]), g.pen.size, null)
    pts = [anchor[0], anchor[1], cx, cy]
    return
  }
  const n = pts.length
  const dx = bx - pts[n - 2]
  const dy = by - pts[n - 1]
  const min_dist = Math.max(0.2, 0.55 / g.view.z)
  if (dx * dx + dy * dy < min_dist * min_dist) {
    pts[n - 2] = bx
    pts[n - 1] = by
  } else {
    pts.push(bx, by)
  }
  if (pts.length > 8192) {
    const reduced = [pts[0], pts[1]]
    for (let i = 4; i < pts.length - 2; i += 4) reduced.push(pts[i], pts[i + 1])
    reduced.push(pts[pts.length - 2], pts[pts.length - 1])
    pts = reduced
  }
  pv_clear()
  const sm = path_smooth(pts, g.pen.smooth)
  if (g.pen.outline) pv_path(sm, g.pen.size + g.pen.owidth * 2, g.pen.ocolor)
  pv_style(0)
  pv_path(sm, g.pen.size, null)
}

export function tool_move_pt(bx: number, by: number, pressure: number): void {
  if (!stroking || !live_mode) {
    tool_move(bx, by, pressure)
    return
  }
  if (pen_mode) {
    pen_point(bx, by, pressure)
    return
  }
  if (brush_mode) {
    brush_point(bx, by, pressure)
    return
  }
  tool_move(bx, by, pressure)
}

function stroke_flush_now(): void {
  const g = st()
  if (!stroking || !live_mode) return
  if (nd_surf) {
    if (nd_kind >= 0) nd_shape_render()
    else nd_flush()
    return
  }
  if (pen_mode) {
    const bb = pen_draw(live_write(g.pen.layer), snap_canvas as HTMLCanvasElement, g.pen.tool === t_eraser ? 1 : 0, 0)
    if (bb) box_union(bb[0], bb[1], bb[2], bb[3])
    dirty(d_stage)
    return
  }
  if (brush_mode) {
    const bb = brush_compose(live_write(g.pen.layer), snap_canvas as HTMLCanvasElement)
    if (bb) box_union(bb[0], bb[1], bb[2], bb[3])
    dirty(d_stage)
  }
}

function stroke_flush_cancel(): void {
  if (!stroke_raf) return
  cancelAnimationFrame(stroke_raf)
  stroke_raf = 0
}

function stroke_flush_pending(): void {
  stroke_flush_cancel()
  stroke_flush_now()
}

export function stroke_flush(): void {
  if (stroke_raf || !stroking || !live_mode) return
  stroke_raf = requestAnimationFrame(() => {
    stroke_raf = 0
    stroke_flush_now()
  })
}

export function tool_up(bx: number, by: number): void {
  if (!stroking) return
  if (brush_mode) brush_point(bx, by, 0)
  const g = st()
  if (nd_surf) {
    stroke_flush_cancel()
    nd_finish(bx, by)
    stroking = 0
    nd_commit(hist_grp())
    nd_stop()
    live_mode = 0
    return
  }
  stroke_flush_pending()
  stroking = 0
  const t = g.pen.tool
  const l = g.pen.layer
  const grp = hist_grp()
  if (live_mode) {
    if (pen_mode) {
      pen_mode = 0
      pen_point(bx, by, 0)
      const bb = pen_draw(live_write(l), snap_canvas as HTMLCanvasElement, t === t_eraser ? 1 : 0, 1)
      if (bb) box_union(bb[0], bb[1], bb[2], bb[3])
    }
    if (union_box[2] < union_box[0]) {
      live_mode = 0
      brush_mode = 0
      pen_mode = 0
      return
    }
    const x = union_box[0]
    const y = union_box[1]
    const w = union_box[2] - union_box[0] + 1
    const h = union_box[3] - union_box[1] + 1
    const sx = (snap_canvas as HTMLCanvasElement).getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
    const before_img = sx.getImageData(x, y, w, h)
    const before = pack_words(before_img)
    dispatch('frame.commit_pixels', {
      grp,
      frame: g.doc.cur,
      changes: [{ layer: l, x, y, w, h, before }],
    })
    live_mode = 0
    brush_mode = 0
    pen_mode = 0
    return
  }
  pv_clear()
  const m = work_mask as mask_t
  m.b.fill(0)
  m.x0 = m.w
  m.y0 = m.h
  m.x1 = -1
  m.y1 = -1
  const r = Math.max(0.5, g.pen.size / 2)
  if (is_shape(t)) {
    const [cx, cy] = shape_constrain(bx, by)
    const sp = shape_pts(shape_kind(t), anchor[0], anchor[1], cx, cy)
    if (g.pen.fill && t !== t_line) mask_poly_fill(m, sp)
    mask_polyline(m, sp, r, t === t_line ? 0 : 1)
    sym_variants(sp, mir => {
      if (g.pen.fill && t !== t_line) mask_poly_fill(m, mir)
      mask_polyline(m, mir, r, t === t_line ? 0 : 1)
    })
  } else {
    const sm = path_smooth(pts, g.pen.smooth)
    mask_polyline(m, sm, r, 0)
    sym_variants(sm, mir => mask_polyline(m, mir, r, 0))
  }
  if (m.x1 < m.x0) return
  apply_mask_with_outline(m, grp)
}

function pack_words(img: ImageData): Uint32Array {
  return rle_pack(new Uint32Array(img.data.buffer))
}

function apply_mask_with_outline(m: mask_t, grp: number): void {
  const g = st()
  if (m.x1 < m.x0 || m.y1 < m.y0) return
  const l = g.pen.layer
  const ow = g.pen.outline ? g.pen.owidth : 0
  const pad = Math.ceil(ow) + 2
  const x = Math.max(0, m.x0 - pad)
  const y = Math.max(0, m.y0 - pad)
  const w = Math.min(g.doc.w - 1, m.x1 + pad) - x + 1
  const h = Math.min(g.doc.h - 1, m.y1 + pad) - y + 1
  if (w < 1 || h < 1) return
  const before = rect_grab(l, x, y, w, h)
  if (ow > 0) {
    const ring = mask_outline_ring(m, ow)
    blend_mask(live_write(l), ring, g.pen.ocolor, g.pen.alpha, 0)
  }
  blend_mask(live_write(l), m, g.pen.color, g.pen.alpha, g.pen.pat)
  dispatch('frame.commit_pixels', {
    grp,
    frame: g.doc.cur,
    changes: [{ layer: l, x, y, w, h, before }],
  })
}

export function tool_cancel(): void {
  if (!stroking) return
  stroke_flush_cancel()
  const g = st()
  for (const item of nd_layers) {
    if (item.l === g.pen.layer) continue
    item.img.data.set(item.base)
    live_write(item.l).putImageData(item.img, 0, 0)
    dispatch('frame.sync_layer', item.l)
  }
  nd_stop()
  stroking = 0
  pv_clear()
  if (live_mode && snap_canvas) {
    live_write(g.pen.layer).clearRect(0, 0, g.doc.w, g.doc.h)
    live_write(g.pen.layer).drawImage(snap_canvas, 0, 0)
    dispatch('frame.sync_layer', g.pen.layer)
    dirty(d_stage)
  }
  live_mode = 0
  brush_mode = 0
  pen_mode = 0
}

function fill_all_same(bx: number, by: number): void {
  const g = st()
  const l = g.pen.layer
  const w = g.doc.w
  const h = g.doc.h
  const [, rx] = canvas_make(w, h, 1)
  doc_compose(g.doc.cur, rx, w, h, 1)
  const ref = rx.getImageData(0, 0, w, h)
  const d = ref.data
  const px = clamp(bx | 0, 0, w - 1)
  const py = clamp(by | 0, 0, h - 1)
  const ti = (py * w + px) * 4
  const tr = d[ti]
  const tg = d[ti + 1]
  const tb = d[ti + 2]
  const ta = d[ti + 3]
  const m = mask_make(w, h)
  const tol = g.doc.mode === mode_normal ? 60 : 0
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const a = d[i + 3]
      let hit = 0
      if (ta < 8) hit = a < 8 ? 1 : 0
      else if (a >= 8) {
        const dr = d[i] - tr
        const dg = d[i + 1] - tg
        const db = d[i + 2] - tb
        if (dr * dr + dg * dg + db * db <= tol * tol && Math.abs(a - ta) < 90) hit = 1
      }
      if (!hit) continue
      m.b[y * w + x] = 255
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  if (x1 < x0) return
  const grp = hist_grp()
  const before = rect_grab(l, x0, y0, x1 - x0 + 1, y1 - y0 + 1)
  Object.assign(m, { x0, y0, x1, y1 })
  paint_mask(live_write(l), m)
  dispatch('frame.commit_pixels', {
    grp,
    frame: g.doc.cur,
    changes: [{ layer: l, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, before }],
  })
  toast('同じ色をぜんぶ塗りかえたよ')
  sfx_play('tap')
}

// 実機のバケツ: 上級ふでばこは今のレイヤーだけ、普通ふでばこは一番上に見えている色で範囲を決める。
function native_bucket(bx: number, by: number): void {
  const g = st()
  const s = nd_open()
  const w = g.doc.w
  const sx = Math.floor(bx)
  const sy = Math.floor(by)
  const planes = new Map(nd_layers.map((item, i) => [item.l, i ? s.others[i - 1] : s.px]))
  const order = mode_one_sheet(g.doc) ? doc_frame_order(g.doc.cur).filter(l => planes.has(l)).map(l => planes.get(l) as Uint32Array) : [s.px]
  if (g.pen.fill_all) {
    const keys = nd_keys(order)
    const target = keys[sy * w + sx]
    const hits: number[] = []
    for (let i = 0; i < keys.length; i++) if (keys[i] === target) hits.push(i)
    for (const i of hits) nd_paint_px(s, i % w, (i / w) | 0)
  } else nd_bucket(s, sx, sy, order)
  if (s.x1 >= s.x0) {
    union_box = [w, g.doc.h, -1, -1]
    box_union(s.x0, s.y0, s.x1, s.y1)
    nd_put(s.x0, s.y0, s.x1 - s.x0 + 1, s.y1 - s.y0 + 1)
    nd_commit(hist_grp())
    if (g.pen.fill_all) toast('同じ色をぜんぶ塗りかえたよ')
    sfx_play('tap')
  }
  nd_layers = []
}

export function tool_fill(bx: number, by: number): void {
  const g = st()
  if (!Number.isFinite(bx) || !Number.isFinite(by) || bx < 0 || by < 0 || bx >= g.doc.w || by >= g.doc.h) return
  if (g.doc.mode !== mode_normal) {
    native_bucket(bx, by)
    return
  }
  if (g.pen.fill_all) {
    fill_all_same(bx, by)
    return
  }
  const l = g.pen.layer
  const [, rx] = canvas_make(g.doc.w, g.doc.h, 1)
  doc_compose(g.doc.cur, rx, g.doc.w, g.doc.h, 1)
  const ref = rx.getImageData(0, 0, g.doc.w, g.doc.h)
  const m = flood_mask(ref, bx, by, g.doc.mode === mode_normal ? 30 : 0)
  if (!m || m.x1 < m.x0) return
  const grp = hist_grp()
  const x = m.x0
  const y = m.y0
  const w = m.x1 - m.x0 + 1
  const h = m.y1 - m.y0 + 1
  const before = rect_grab(l, x, y, w, h)
  paint_mask(live_write(l), m)
  dispatch('frame.commit_pixels', {
    grp,
    frame: g.doc.cur,
    changes: [{ layer: l, x, y, w, h, before }],
  })
  sfx_play('tap')
}

export function tool_eyedrop(bx: number, by: number): [number, number, number] {
  const g = st()
  const x = clamp(bx | 0, 0, g.doc.w - 1)
  const y = clamp(by | 0, 0, g.doc.h - 1)
  const ord = doc_frame_order(g.doc.cur)
  for (let k = 0; k < ord.length; k++) {
    const l = ord[k]
    if (!g.doc.lvis[l]) continue
    const pixel = doc_layer_pixel(g.doc.cur, l, x, y)
    if (pixel >>> 24 > 8) return [pixel & 255, (pixel >>> 8) & 255, (pixel >>> 16) & 255]
  }
  if (g.doc.lvis[0]) {
    const pixel = doc_layer_pixel(g.doc.cur, 0, x, y)
    if (pixel >>> 24 > 8) return [pixel & 255, (pixel >>> 8) & 255, (pixel >>> 16) & 255]
  }
  return hex_rgb(doc_frame_paper(g.doc.cur).slice(0, 7))
}

type tf_snap_t = { l: number, c: HTMLCanvasElement, x: CanvasRenderingContext2D }

let tf_snaps: tf_snap_t[] = []

export function tf_begin(layer: number): void {
  tf_cancel()
  dispatch('frame.sync_live', null)
  const g = st()
  const ls = layer < 0 ? [0, ...mode_order(g.doc.mode, g.doc.lord)] : [layer]
  for (const l of ls) {
    if (!g.doc.frames[g.doc.cur].pk[l]) continue
    const [c, x] = canvas_make(g.doc.w, g.doc.h)
    x.drawImage(live_slot(l).canvas, 0, 0)
    tf_snaps.push({ l, c, x })
  }
}

export function tf_active(): number {
  return tf_snaps.length ? 1 : 0
}

export function tf_preview(factor: number, dx: number, dy: number, deg: number): void {
  const g = st()
  const w = g.doc.w
  const h = g.doc.h
  for (const s of tf_snaps) {
    const dst = live_write(s.l)
    dst.clearRect(0, 0, w, h)
    dst.imageSmoothingEnabled = false
    dst.save()
    dst.translate(w / 2 + dx, h / 2 + dy)
    dst.rotate((deg * Math.PI) / 180)
    dst.scale(factor, factor)
    dst.drawImage(s.c, -w / 2, -h / 2)
    dst.restore()
  }
  dirty(d_stage)
}

export function tf_commit(): void {
  if (!tf_snaps.length) return
  const g = st()
  const grp = hist_grp()
  const changes = tf_snaps.map(s => ({
    layer: s.l,
    x: 0,
    y: 0,
    w: g.doc.w,
    h: g.doc.h,
    before: pack_canvas(s.c, s.x) || rle_pack(new Uint32Array(g.doc.w * g.doc.h)),
  }))
  dispatch('frame.commit_pixels', { grp, frame: g.doc.cur, changes })
  tf_snaps = []
}

// restore が 0 のときは、もとの絵へもどさずに捨てる (コマが変わってしまったとき)。
export function tf_cancel(restore = 1): void {
  if (!tf_snaps.length) return
  const g = st()
  if (restore) {
    for (const s of tf_snaps) {
      const dst = live_write(s.l)
      dst.clearRect(0, 0, g.doc.w, g.doc.h)
      dst.drawImage(s.c, 0, 0)
    }
  }
  tf_snaps = []
  dirty(d_stage)
}
