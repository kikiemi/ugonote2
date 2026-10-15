import { blend_mask, mask_empty, mask_make, mask_outline_ring, mask_seg, type mask_t } from './gfx'
import type { pen_t } from './h'
import { n_brush, n_dots, n_outline, n_pencil, n_solid, n_spray, type native_pen_tip_t } from './penprofile'

export type native_pen_stroke_t = { mask: mask_t, segment: mask_t }
type native_pen_paint_t = Pick<pen_t, 'color' | 'pat' | 'paint_over' | 'outline' | 'ocolor' | 'owidth'>

export function native_pen_begin(w: number, h: number, previous: native_pen_stroke_t | null): native_pen_stroke_t {
  const stroke = previous && previous.mask.w === w && previous.mask.h === h ? previous : { mask: mask_make(w, h), segment: mask_make(w, h) }
  const m = stroke.mask
  m.b.fill(0)
  m.x0 = w; m.y0 = h; m.x1 = -1; m.y1 = -1
  return stroke
}

export function native_pen_point(stroke: native_pen_stroke_t, tip: native_pen_tip_t, ax: number, ay: number, bx: number, by: number): void {
  const m = stroke.mask
  const s = stroke.segment
  s.b.fill(0)
  s.x0 = s.w; s.y0 = s.h; s.x1 = -1; s.y1 = -1
  native_pen_mask(s, tip, ax, ay, bx, by)
  if (mask_empty(s)) return
  for (let y = s.y0; y <= s.y1; y++) {
    for (let x = s.x0; x <= s.x1; x++) {
      const i = y * m.w + x
      if (s.b[i]) m.b[i] = 255
    }
  }
  m.x0 = Math.min(m.x0, s.x0); m.y0 = Math.min(m.y0, s.y0)
  m.x1 = Math.max(m.x1, s.x1); m.y1 = Math.max(m.y1, s.y1)
}

export function native_pen_paint(ctx: CanvasRenderingContext2D, m: mask_t, p: native_pen_paint_t): void {
  if (p.outline) blend_mask(ctx, mask_outline_ring(m, p.owidth), p.ocolor, 1, 0)
  blend_mask(ctx, m, p.color, 1, p.pat, p.paint_over)
}

export function native_pen_draw(ctx: CanvasRenderingContext2D, snap: HTMLCanvasElement, stroke: native_pen_stroke_t, p: native_pen_paint_t): number[] | null {
  const m = stroke.mask
  if (mask_empty(m)) return null
  const pad = p.outline ? p.owidth + 1 : 0
  const x0 = Math.max(0, m.x0 - pad), y0 = Math.max(0, m.y0 - pad)
  const x1 = Math.min(m.w - 1, m.x1 + pad), y1 = Math.min(m.h - 1, m.y1 + pad)
  const w = x1 - x0 + 1, h = y1 - y0 + 1
  ctx.clearRect(x0, y0, w, h)
  ctx.drawImage(snap, x0, y0, w, h, x0, y0, w, h)
  native_pen_paint(ctx, m, p)
  return [x0, y0, x1, y1]
}

function grain(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ salt
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function distance(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0
  return Math.hypot(x - ax - t * dx, y - ay - t * dy)
}

export function native_pen_mask(m: mask_t, tip: native_pen_tip_t, ax: number, ay: number, bx: number, by: number): void {
  if (tip.shape === n_solid && tip.size % 2 === 0) { ax += 0.5; ay += 0.5; bx += 0.5; by += 0.5 }
  let r = Math.max(0.5, tip.size / 2)
  if (tip.shape === n_brush) r = Math.max(0.5, r / (1 + Math.hypot(bx - ax, by - ay) * 0.12))
  mask_seg(m, ax, ay, bx, by, r)
  if (tip.shape === n_solid || tip.shape === n_brush) return
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1))
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1))
  const x1 = Math.min(m.w - 1, Math.ceil(Math.max(ax, bx) + r + 1))
  const y1 = Math.min(m.h - 1, Math.ceil(Math.max(ay, by) + r + 1))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * m.w + x
      if (!m.b[i]) continue
      const d = distance(x + 0.5, y + 0.5, ax, ay, bx, by)
      let keep = true
      if (tip.shape === n_outline) keep = d >= Math.max(0.4, r - 1)
      else if (tip.shape === n_dots) keep = grain(x, y, 13) < 0.22
      else if (tip.shape === n_pencil) keep = grain(x - y, y, 71) < 0.52
      else if (tip.shape === n_spray) keep = grain(x, y, 113) < 0.9 * Math.max(0, 1 - d / r)
      if (!keep) m.b[i] = 0
    }
  }
}
