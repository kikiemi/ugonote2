import { getStroke } from 'perfect-freehand'
import { pat_canvas } from './gfx'
import { clamp } from './lib'
import { st } from './state/store'

let pts: number[][] = []
let real_pressure = 0
let prev_box: number[] | null = null
const point_limit = 4096

function pr(p: number): number {
  if (p > 0 && p !== 0.5) real_pressure = 1
  return real_pressure ? clamp(p, 0.05, 1) : 0.5
}

export function pen_begin(x: number, y: number, p: number): void {
  pts = []
  real_pressure = 0
  prev_box = null
  pts.push([x, y, pr(p)])
}

export function pen_point(x: number, y: number, p: number): void {
  const last = pts[pts.length - 1]
  const min_dist = Math.max(0.2, 0.55 / st().view.z)
  if (last && Math.hypot(last[0] - x, last[1] - y) < min_dist) {
    last[2] = pr(p)
    return
  }
  pts.push([x, y, pr(p)])
  if (pts.length > point_limit) {
    const reduced: number[][] = [pts[0]]
    for (let i = 2; i < pts.length - 1; i += 2) reduced.push(pts[i])
    reduced.push(pts[pts.length - 1])
    pts = reduced
  }
}

function outline_now(last: number): number[][] {
  const g = st()
  const sm = g.pen.smooth
  const src = pts
  return getStroke(src, {
    size: Math.max(1, g.pen.size),
    thinning: g.pen.pressure ? 0.6 : 0,
    smoothing: clamp(0.4 + sm * 0.12, 0, 0.95),
    streamline: clamp(0.25 + sm * 0.13, 0, 0.9),
    simulatePressure: g.pen.pressure && !real_pressure ? true : false,
    last: last ? true : false,
  })
}

function path_of(ol: number[][], fx: number, fy: number): Path2D {
  const g = st()
  const w = g.doc.w
  const h = g.doc.h
  const p = new Path2D()
  if (!ol.length) return p
  const x = (v: number) => (fx ? w - v : v)
  const y = (v: number) => (fy ? h - v : v)
  const first = fx !== fy ? ol.length - 1 : 0
  p.moveTo(x(ol[first][0]), y(ol[first][1]))
  for (let i = 1; i < ol.length; i++) {
    const j = fx !== fy ? ol.length - 1 - i : i
    p.lineTo(x(ol[j][0]), y(ol[j][1]))
  }
  p.closePath()
  return p
}

function box_of(ol: number[][], pad: number): number[] {
  const g = st()
  let x0 = g.doc.w
  let y0 = g.doc.h
  let x1 = -1
  let y1 = -1
  for (const q of ol) {
    if (q[0] < x0) x0 = q[0]
    if (q[1] < y0) y0 = q[1]
    if (q[0] > x1) x1 = q[0]
    if (q[1] > y1) y1 = q[1]
  }
  return [Math.floor(x0 - pad), Math.floor(y0 - pad), Math.ceil(x1 + pad), Math.ceil(y1 + pad)]
}

function clamp_box(b: number[]): number[] | null {
  const g = st()
  const x0 = Math.max(0, b[0])
  const y0 = Math.max(0, b[1])
  const x1 = Math.min(g.doc.w - 1, b[2])
  const y1 = Math.min(g.doc.h - 1, b[3])
  if (x1 < x0 || y1 < y0) return null
  return [x0, y0, x1, y1]
}

function merge_box(a: number[] | null, b: number[] | null): number[] | null {
  if (!a) return b
  if (!b) return a
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}

export function pen_draw(ctx: CanvasRenderingContext2D, snap: HTMLCanvasElement, eraser: number, last: number): number[] | null {
  const g = st()
  let ol = outline_now(last)
  if (ol.length < 3 && pts.length >= 1) {
    const r = Math.max(0.6, g.pen.size / 2)
    const cx = pts[pts.length - 1][0]
    const cy = pts[pts.length - 1][1]
    ol = []
    for (let a = 0; a < 12; a++) ol.push([cx + Math.cos((a / 12) * Math.PI * 2) * r, cy + Math.sin((a / 12) * Math.PI * 2) * r])
  }
  if (ol.length < 3) return null
  const ow_pad = g.pen.outline && !eraser ? g.pen.owidth : 0
  const raw = box_of(ol, 2 + ow_pad + g.pen.size * 0.5)
  const dirty_raw = merge_box(prev_box, raw)
  prev_box = raw
  let full: number[] = dirty_raw as number[]
  if (g.pen.sym || g.pen.symy) {
    const w = g.doc.w
    const h = g.doc.h
    const mir = (b: number[], fx: number, fy: number): number[] => [fx ? w - 1 - b[2] : b[0], fy ? h - 1 - b[3] : b[1], fx ? w - 1 - b[0] : b[2], fy ? h - 1 - b[1] : b[3]]
    if (g.pen.sym) full = merge_box(full, mir(dirty_raw as number[], 1, 0)) as number[]
    if (g.pen.symy) full = merge_box(full, mir(dirty_raw as number[], 0, 1)) as number[]
    if (g.pen.sym && g.pen.symy) full = merge_box(full, mir(dirty_raw as number[], 1, 1)) as number[]
  }
  const d_b = clamp_box(full)
  if (!d_b) return null
  const [x0, y0, x1, y1] = d_b
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  ctx.clearRect(x0, y0, bw, bh)
  ctx.drawImage(snap, x0, y0, bw, bh, x0, y0, bw, bh)
  const paths: Path2D[] = [path_of(ol, 0, 0)]
  if (g.pen.sym) paths.push(path_of(ol, 1, 0))
  if (g.pen.symy) paths.push(path_of(ol, 0, 1))
  if (g.pen.sym && g.pen.symy) paths.push(path_of(ol, 1, 1))
  if (g.pen.paint_over && !eraser) {
    const joined = new Path2D()
    for (const p of paths) joined.addPath(p)
    paths.length = 0
    paths.push(joined)
  }
  ctx.save()
  ctx.beginPath()
  ctx.rect(x0, y0, bw, bh)
  ctx.clip()
  if (eraser) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.globalAlpha = 1
    if (g.pen.pat > 0) {
      const pattern = ctx.createPattern(pat_canvas(g.pen.pat, '#000'), 'repeat')
      if (pattern) ctx.fillStyle = pattern
      else ctx.fillStyle = '#000'
    } else {
      ctx.fillStyle = '#000'
    }
    for (const p of paths) ctx.fill(p)
  } else {
    if (g.pen.paint_over) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.globalAlpha = 1
      ctx.fillStyle = '#000'
      for (const p of paths) ctx.fill(p)
      ctx.globalCompositeOperation = 'source-over'
    }
    ctx.globalAlpha = clamp(g.pen.alpha, 0, 1)
    if (g.pen.outline) {
      ctx.strokeStyle = g.pen.ocolor
      ctx.lineWidth = g.pen.owidth * 2
      ctx.lineJoin = 'round'
      for (const p of paths) ctx.stroke(p)
    }
    if (g.pen.pat > 0) {
      const pc = pat_canvas(g.pen.pat, g.pen.color)
      const pattern = ctx.createPattern(pc, 'repeat')
      ctx.fillStyle = pattern ? pattern : g.pen.color
    } else {
      ctx.fillStyle = g.pen.color
    }
    for (const p of paths) ctx.fill(p)
  }
  ctx.restore()
  return d_b
}
