import { brush_begin, brush_point, brush_compose, brush_is_direct, brush_seed } from './brush'
import { native_pen_tip } from './penprofile'
import { native_pen_begin, native_pen_draw, native_pen_point, type native_pen_stroke_t } from './nativepen'
import { doc_frame_order, doc_frame_paper, doc_compose, doc_layer_pixel, pack_canvas } from './doc'
import { toast } from './dom'
import { live_slot, live_write, live_canvas } from './engine'
import { pat_canvas, mask_make, mask_rect, mask_seg, mask_polyline, mask_poly_fill, mask_outline_ring, blend_mask, paint_mask, erase_mask, flood_mask, shape_pts, path_smooth, type mask_t } from './gfx'
import { t_pen, t_fill, t_eraser, t_eyedrop, t_pixel, t_line, t_rect, t_circle, t_star, t_heart, d_stage, mode_normal } from './h'
import { hist_grp, rect_grab } from './hist'
import { canvas_make, clamp, hex_rgb, rle_pack } from './lib'
import { mode_order } from './mode'
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
let native_stroke: native_pen_stroke_t | null = null

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
  if (t === t_line) return 0
  if (t === t_rect) return 1
  if (t === t_circle) return 2
  if (t === t_star) return 3
  return 4
}

function is_shape(t: number): number {
  return t === t_line || t === t_rect || t === t_circle || t === t_star || t === t_heart ? 1 : 0
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
  if (t === t_line) {
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

function stamp_live(x0: number, y0: number, x1: number, y1: number, r: number): void {
  const g = st()
  const l = g.pen.layer
  const m = work_mask as mask_t
  const stamp_once = (ax: number, ay: number, bx: number, by: number) => {
    if (g.pen.tool === t_pen && native_stroke) {
      native_pen_point(native_stroke, native_pen_tip(g.pen.native_tip), ax, ay, bx, by)
      return
    }
    m.x0 = m.w
    m.y0 = m.h
    m.x1 = -1
    m.y1 = -1
    const pad = Math.ceil(r) + 2
    const cx0 = Math.max(0, Math.floor(Math.min(ax, bx)) - pad)
    const cy0 = Math.max(0, Math.floor(Math.min(ay, by)) - pad)
    const cx1 = Math.min(g.doc.w - 1, Math.ceil(Math.max(ax, bx)) + pad)
    const cy1 = Math.min(g.doc.h - 1, Math.ceil(Math.max(ay, by)) + pad)
    for (let y = cy0; y <= cy1; y++) m.b.fill(0, y * m.w + cx0, y * m.w + cx1 + 1)
    mask_seg(m, ax, ay, bx, by, r)
    if (m.x1 < m.x0) return
    if (g.pen.tool === t_eraser) erase_mask(live_write(l), m, g.pen.pat)
    else blend_mask(live_write(l), m, g.pen.color, 1, g.pen.pat, g.pen.paint_over)
    box_union(m.x0, m.y0, m.x1, m.y1)
  }
  stamp_once(x0, y0, x1, y1)
  if (g.pen.sym) stamp_once(g.doc.w - x0, y0, g.doc.w - x1, y1)
  if (g.pen.symy) stamp_once(x0, g.doc.h - y0, x1, g.doc.h - y1)
  if (g.pen.sym && g.pen.symy) stamp_once(g.doc.w - x0, g.doc.h - y0, g.doc.w - x1, g.doc.h - y1)
  if (g.pen.tool === t_pen && native_stroke) stroke_flush()
}

function stamp_cell(bx: number, by: number): void {
  const g = st()
  const n = clamp(g.pen.pxn, 2, Math.min(256, g.doc.w))
  const cell = g.doc.w / n
  const gx = Math.floor(bx / cell)
  const gy = Math.floor(by / cell)
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
  put(gx, gy)
  if (g.pen.sym) put(n - 1 - gx, gy)
  if (g.pen.symy) put(gx, ny - 1 - gy)
  if (g.pen.sym && g.pen.symy) put(n - 1 - gx, ny - 1 - gy)
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

function radius_now(pressure: number): number {
  const g = st()
  let r = g.pen.size / 2
  if (g.pen.pressure && pressure > 0) r = r * (0.3 + 0.7 * clamp(pressure, 0, 1))
  return Math.max(0.5, r)
}

export function tool_down(bx: number, by: number, pressure: number): number {
  stroke_flush_cancel()
  const g = st()
  const t = g.pen.tool
  if (t === t_eyedrop) {
    tool_eyedrop(bx, by)
    return 0
  }
  if (t === t_fill) {
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
    stamp_cell(bx, by)
    dirty(d_stage)
    return 1
  }
  if (g.doc.mode !== mode_normal && (t === t_pen || t === t_eraser)) {
    live_mode = 1
    brush_mode = 0
    pen_mode = 0
    snap_take()
    if (t === t_pen) native_stroke = native_pen_begin(g.doc.w, g.doc.h, native_stroke)
    stamp_live(Math.floor(bx) + 0.5, Math.floor(by) + 0.5, Math.floor(bx) + 0.5, Math.floor(by) + 0.5, Math.max(0.5, g.pen.size / 2))
    if (t === t_pen) stroke_flush_pending()
    dirty(d_stage)
    return 1
  }
  if (t === t_pen && brush_is_direct(g.pen.brush)) {
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
  if (t === t_pen || t === t_eraser) {
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

export function tool_move(bx: number, by: number, pressure: number): void {
  const g = st()
  if (!stroking) return
  const t = g.pen.tool
  if (live_mode) {
    if (t === t_pixel) {
      stamp_cell(bx, by)
      dirty(d_stage)
      return
    }
    const k = clamp(1 - g.pen.smooth * 0.08, 0.15, 1)
    const nx = ema[0] + (bx - ema[0]) * k
    const ny = ema[1] + (by - ema[1]) * k
    if (pen_mode) {
      pen_point(bx, by, pressure)
      stroke_flush()
    } else if (brush_mode) {
      brush_point(bx, by, pressure)
      stroke_flush()
    } else {
      stamp_live(ema[0], ema[1], nx, ny, radius_now(pressure))
    }
    ema = [nx, ny]
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
  if (g.doc.mode !== mode_normal && g.pen.tool === t_pen && native_stroke) {
    const bb = native_pen_draw(live_write(g.pen.layer), snap_canvas as HTMLCanvasElement, native_stroke, g.pen)
    if (bb) box_union(bb[0], bb[1], bb[2], bb[3])
    dirty(d_stage)
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
  if (live_mode && g.doc.mode !== mode_normal && g.pen.tool === t_pen && Math.hypot(bx - ema[0], by - ema[1]) > 0.001) stamp_live(ema[0], ema[1], bx, by, radius_now(1))
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

export function tool_fill(bx: number, by: number): void {
  const g = st()
  if (!Number.isFinite(bx) || !Number.isFinite(by) || bx < 0 || by < 0 || bx >= g.doc.w || by >= g.doc.h) return
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

export function tf_cancel(): void {
  if (!tf_snaps.length) return
  const g = st()
  for (const s of tf_snaps) {
    const dst = live_write(s.l)
    dst.clearRect(0, 0, g.doc.w, g.doc.h)
    dst.drawImage(s.c, 0, 0)
  }
  tf_snaps = []
  dirty(d_stage)
}
