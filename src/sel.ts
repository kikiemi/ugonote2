import { doc_pack_layer } from './doc'
import { toast } from './dom'
import { live_slot, live_canvas, flo_img, flo_img_set, clip_img, clip_img_set } from './engine'
import { mask_make, mask_rect, mask_poly_fill, type Mask } from './gfx'
import { T_LASSO, T_PASTE, K_NONE, K_PASTE, K_PHOTO, K_TEXT, K_SEL, L_P, ERR_BAD, ERR_NOOP } from './h'
import { hist_grp, hist_pix, rect_grab } from './hist'
import { canvas_make, clamp } from './lib'
import { sfx_play } from './snd'
import { st, type DeepRO, type Globals } from './state/store'

export const H_NONE = 0
export const H_MOVE = 1
export const H_TL = 2
export const H_T = 3
export const H_TR = 4
export const H_R = 5
export const H_BR = 6
export const H_B = 7
export const H_BL = 8
export const H_L = 9
export const H_ROT = 10

let antsCtx: CanvasRenderingContext2D | null = null
let floCtx: CanvasRenderingContext2D | null = null
let marquee = 0
let marqueeLasso = 0
let drawPts: number[] = []
let drag = H_NONE
let dragOff = [0, 0]
let dragBase = [0, 0, 0]

export function sel_bind(ants: CanvasRenderingContext2D, flo: CanvasRenderingContext2D): void {
  antsCtx = ants
  floCtx = flo
}

function sel_mask(g: DeepRO<Globals>): Mask {
  const m = mask_make(g.doc.w, g.doc.h)
  if (g.sel.poly) mask_poly_fill(m, g.sel.poly)
  else mask_rect(m, g.sel.x, g.sel.y, g.sel.w, g.sel.h)
  return m
}

export function sel_render(): void {
  if (!antsCtx) return
  const g = st()
  const x = antsCtx
  x.clearRect(0, 0, g.doc.w, g.doc.h)
  const path = (): void => {
    x.beginPath()
    if (marquee && drawPts.length >= 4) {
      if (marqueeLasso) {
        x.moveTo(drawPts[0], drawPts[1])
        for (let i = 1; i < drawPts.length >> 1; i++) x.lineTo(drawPts[i * 2], drawPts[i * 2 + 1])
      } else {
        x.rect(Math.min(drawPts[0], drawPts[2]), Math.min(drawPts[1], drawPts[3]), Math.abs(drawPts[2] - drawPts[0]), Math.abs(drawPts[3] - drawPts[1]))
      }
      return
    }
    if (!g.sel.has) return
    const poly = g.sel.poly
    if (poly) {
      x.moveTo(poly[0], poly[1])
      for (let i = 1; i < poly.length >> 1; i++) x.lineTo(poly[i * 2], poly[i * 2 + 1])
      x.closePath()
    } else {
      x.rect(g.sel.x, g.sel.y, g.sel.w, g.sel.h)
    }
  }
  x.lineWidth = Math.max(1, 2 / g.view.z)
  x.setLineDash([6 / g.view.z, 4 / g.view.z])
  x.strokeStyle = '#FFFFFF'
  x.lineDashOffset = 0
  path()
  x.stroke()
  x.strokeStyle = '#FF6600'
  x.lineDashOffset = 6 / g.view.z
  path()
  x.stroke()
  x.setLineDash([])
}

function flo_corners(g: DeepRO<Globals>, fi: HTMLCanvasElement): number[] {
  const f = g.flo
  const hw = fi.width / 2
  const hh = fi.height / 2
  const c = Math.cos(f.rot)
  const s = Math.sin(f.rot)
  const pts: number[] = []
  const point = (lx: number, ly: number): void => {
    const px = lx * f.sx
    const py = ly * f.sy
    pts.push(f.x + px * c - py * s, f.y + px * s + py * c)
  }
  point(-hw, -hh)
  point(hw, -hh)
  point(hw, hh)
  point(-hw, hh)
  return pts
}

function flo_handle_pts(q: readonly number[]): number[] {
  const mid = (i: number, j: number): [number, number] => [(q[i * 2] + q[j * 2]) / 2, (q[i * 2 + 1] + q[j * 2 + 1]) / 2]
  const t = mid(0, 1)
  const r = mid(1, 2)
  const b = mid(2, 3)
  const l = mid(3, 0)
  return [q[0], q[1], t[0], t[1], q[2], q[3], r[0], r[1], q[4], q[5], b[0], b[1], q[6], q[7], l[0], l[1]]
}

function flo_rot_pt(g: DeepRO<Globals>, fi: HTMLCanvasElement): [number, number] {
  const f = g.flo
  const c = Math.cos(f.rot)
  const s = Math.sin(f.rot)
  const ly = -((fi.height / 2) * Math.abs(f.sy) + 30 / g.view.z)
  return [f.x - ly * s, f.y + ly * c]
}

function flo_smooth(kind: number): boolean {
  return kind === K_PHOTO || kind === K_TEXT
}

export function flo_render(): void {
  if (!floCtx) return
  const g = st()
  const x = floCtx
  x.clearRect(0, 0, g.doc.w, g.doc.h)
  const f = g.flo
  const fi = flo_img()
  if (!f.kind || !fi) return
  x.save()
  x.globalAlpha = 0.82
  x.translate(f.x, f.y)
  x.rotate(f.rot)
  x.scale(f.sx, f.sy)
  x.imageSmoothingEnabled = flo_smooth(f.kind)
  x.drawImage(fi, -fi.width / 2, -fi.height / 2)
  x.restore()
  x.globalAlpha = 1
  const q = flo_corners(g, fi)
  x.setLineDash([6 / g.view.z, 4 / g.view.z])
  x.lineWidth = Math.max(1, 2 / g.view.z)
  x.strokeStyle = '#FF6600'
  x.beginPath()
  x.moveTo(q[0], q[1])
  for (let i = 1; i < 4; i++) x.lineTo(q[i * 2], q[i * 2 + 1])
  x.closePath()
  x.stroke()
  x.setLineDash([])
  const hs = 5 / g.view.z
  const hp = flo_handle_pts(q)
  const [rx, ry] = flo_rot_pt(g, fi)
  const tx = (q[0] + q[2]) / 2
  const ty = (q[1] + q[3]) / 2
  x.strokeStyle = '#FF6600'
  x.lineWidth = Math.max(1, 1.5 / g.view.z)
  x.beginPath()
  x.moveTo(tx, ty)
  x.lineTo(rx, ry)
  x.stroke()
  x.fillStyle = '#FFFFFF'
  for (let i = 0; i < 8; i++) {
    x.beginPath()
    x.rect(hp[i * 2] - hs, hp[i * 2 + 1] - hs, hs * 2, hs * 2)
    x.fill()
    x.stroke()
  }
  x.beginPath()
  x.arc(rx, ry, hs * 1.2, 0, Math.PI * 2)
  x.fill()
  x.stroke()
}

function inside_sel(g: DeepRO<Globals>, bx: number, by: number): number {
  if (!g.sel.has) return 0
  return bx >= g.sel.x && by >= g.sel.y && bx < g.sel.x + g.sel.w && by < g.sel.y + g.sel.h ? 1 : 0
}

export function sel_down(g: Globals, bx: number, by: number): number {
  if (inside_sel(g, bx, by)) return lift_to_flo(g, bx, by)
  g.sel.has = 0
  g.sel.poly = null
  marquee = 1
  marqueeLasso = g.pen.tool === T_LASSO ? 1 : 0
  drawPts = [bx, by, bx, by]
  sel_render()
  return 0
}

export function sel_move(bx: number, by: number): void {
  if (!marquee) return
  const g = st()
  if (marqueeLasso) {
    const n = drawPts.length
    const dx = bx - drawPts[n - 2]
    const dy = by - drawPts[n - 1]
    const minDist = Math.max(0.5, 1.75 / g.view.z)
    if (dx * dx + dy * dy < minDist * minDist) return
    if (drawPts.length < 8192) drawPts.push(bx, by)
    else {
      drawPts[n - 2] = bx
      drawPts[n - 1] = by
    }
  } else {
    drawPts[2] = bx
    drawPts[3] = by
  }
  sel_render()
}

export function sel_up(g: Globals): number {
  if (!marquee) return ERR_NOOP
  const lasso = marqueeLasso
  marquee = 0
  marqueeLasso = 0
  if (lasso) {
    if (drawPts.length < 6) {
      drawPts = []
      sel_render()
      return 0
    }
    let x0 = g.doc.w
    let y0 = g.doc.h
    let x1 = 0
    let y1 = 0
    for (let i = 0; i < drawPts.length; i += 2) {
      x0 = Math.min(x0, drawPts[i])
      y0 = Math.min(y0, drawPts[i + 1])
      x1 = Math.max(x1, drawPts[i])
      y1 = Math.max(y1, drawPts[i + 1])
    }
    g.sel.poly = drawPts.slice()
    g.sel.x = Math.max(0, Math.floor(x0))
    g.sel.y = Math.max(0, Math.floor(y0))
    g.sel.w = Math.max(0, Math.min(g.doc.w, Math.ceil(x1)) - g.sel.x)
    g.sel.h = Math.max(0, Math.min(g.doc.h, Math.ceil(y1)) - g.sel.y)
  } else {
    g.sel.poly = null
    const ax = clamp(drawPts[0], 0, g.doc.w)
    const ay = clamp(drawPts[1], 0, g.doc.h)
    const bx = clamp(drawPts[2], 0, g.doc.w)
    const by = clamp(drawPts[3], 0, g.doc.h)
    const x0 = Math.floor(Math.min(ax, bx))
    const y0 = Math.floor(Math.min(ay, by))
    const x1 = Math.ceil(Math.max(ax, bx))
    const y1 = Math.ceil(Math.max(ay, by))
    g.sel.x = x0
    g.sel.y = y0
    g.sel.w = Math.max(0, x1 - x0)
    g.sel.h = Math.max(0, y1 - y0)
  }
  drawPts = []
  g.sel.has = g.sel.w > 1 && g.sel.h > 1 ? 1 : 0
  if (!g.sel.has) g.sel.poly = null
  sel_render()
  if (g.sel.has) sfx_play('tap')
  return 0
}

export function sel_clear(g: Globals): number {
  const changed = g.sel.has || g.sel.poly || marquee || drawPts.length
  g.sel.has = 0
  g.sel.poly = null
  marquee = 0
  marqueeLasso = 0
  drawPts = []
  sel_render()
  return changed ? 0 : ERR_NOOP
}

function region_grab(g: DeepRO<Globals>, masked: number): HTMLCanvasElement {
  const [c, x] = canvas_make(Math.max(1, g.sel.w), Math.max(1, g.sel.h), 1)
  x.drawImage(live_canvas(g.pen.layer), g.sel.x, g.sel.y, g.sel.w, g.sel.h, 0, 0, g.sel.w, g.sel.h)
  if (masked && g.sel.poly) {
    const m = sel_mask(g)
    const img = x.getImageData(0, 0, g.sel.w, g.sel.h)
    for (let y = 0; y < g.sel.h; y++) {
      const mrow = (g.sel.y + y) * m.w + g.sel.x
      for (let px = 0; px < g.sel.w; px++) {
        if (!m.b[mrow + px]) img.data[(y * g.sel.w + px) * 4 + 3] = 0
      }
    }
    x.putImageData(img, 0, 0)
  }
  return c
}

function region_erase(g: Globals, grp: number, withHist: number): void {
  const layer = g.pen.layer
  const before = withHist ? rect_grab(layer, g.sel.x, g.sel.y, g.sel.w, g.sel.h) : null
  const m = sel_mask(g)
  const img = live_slot(layer).getImageData(g.sel.x, g.sel.y, g.sel.w, g.sel.h)
  for (let y = 0; y < g.sel.h; y++) {
    const mrow = (g.sel.y + y) * m.w + g.sel.x
    for (let px = 0; px < g.sel.w; px++) {
      if (!m.b[mrow + px]) continue
      const i = (y * g.sel.w + px) * 4
      img.data[i] = 0
      img.data[i + 1] = 0
      img.data[i + 2] = 0
      img.data[i + 3] = 0
    }
  }
  live_slot(layer).putImageData(img, g.sel.x, g.sel.y)
  if (withHist && before) {
    hist_pix(g, grp, g.doc.cur, layer, g.sel.x, g.sel.y, g.sel.w, g.sel.h, before)
    doc_pack_layer(g, layer)
  }
}

export function sel_copy(g: Globals): number {
  if (!g.sel.has) return ERR_NOOP
  clip_img_set(region_grab(g, 1))
  g.clip = { w: g.sel.w, h: g.sel.h }
  toast('コピーしました')
  sfx_play('tap')
  return 0
}

export function sel_cut(g: Globals): number {
  if (!g.sel.has) return ERR_NOOP
  clip_img_set(region_grab(g, 1))
  g.clip = { w: g.sel.w, h: g.sel.h }
  region_erase(g, hist_grp(), 1)
  sel_clear(g)
  toast('切り取りました')
  sfx_play('del')
  return 0
}

export function sel_delete(g: Globals): number {
  if (!g.sel.has) return ERR_NOOP
  region_erase(g, hist_grp(), 1)
  sel_clear(g)
  sfx_play('del')
  return 0
}

export function sel_transform(g: Globals): number {
  if (!g.sel.has) return ERR_NOOP
  return lift_to_flo(g, 0, 0)
}

function lift_to_flo(g: Globals, bx: number, by: number): number {
  if (!g.sel.has) return ERR_NOOP
  const layer = g.pen.layer
  const img = region_grab(g, 1)
  const f = g.flo
  f.kind = K_SEL
  flo_img_set(img)
  f.srcLayer = layer
  f.srcRect = [g.sel.x, g.sel.y, g.sel.w, g.sel.h]
  f.srcBefore = rect_grab(layer, g.sel.x, g.sel.y, g.sel.w, g.sel.h)
  f.x = g.sel.x + g.sel.w / 2
  f.y = g.sel.y + g.sel.h / 2
  f.rot = 0
  f.sx = 1
  f.sy = 1
  f.cont = 0
  region_erase(g, 0, 0)
  doc_pack_layer(g, layer)
  g.sel.has = 0
  g.sel.poly = null
  sel_render()
  drag = H_MOVE
  dragOff = [bx - f.x, by - f.y]
  flo_render()
  sfx_play('tap')
  return 0
}

export function flo_begin_paste(g: Globals): number {
  const img = clip_img()
  if (!g.clip || !img) return ERR_NOOP
  const f = g.flo
  f.kind = K_PASTE
  flo_img_set(img)
  f.x = g.doc.w / 2
  f.y = g.doc.h / 2
  f.rot = 0
  f.sx = 1
  f.sy = 1
  f.cont = 1
  f.srcRect = null
  f.srcBefore = null
  flo_render()
  return 0
}

export function flo_begin_img(g: Globals, c: HTMLCanvasElement, kind: number, bx: number, by: number, cont = 0): number {
  if (!c.width || !c.height || kind === K_NONE) return ERR_BAD
  const f = g.flo
  f.kind = kind
  flo_img_set(c)
  const fit = Math.min(1, (g.doc.w * 0.9) / c.width, (g.doc.h * 0.9) / c.height)
  const scale = kind === K_TEXT ? 1 : fit
  f.sx = scale
  f.sy = scale
  f.x = bx
  f.y = by
  f.rot = 0
  f.cont = cont
  f.srcLayer = g.pen.layer
  f.srcRect = null
  f.srcBefore = null
  flo_render()
  return 0
}

export function flo_hit(bx: number, by: number): number {
  const g = st()
  const f = g.flo
  const fi = flo_img()
  if (!f.kind || !fi) return H_NONE
  const tol = 9 / g.view.z
  const [rx, ry] = flo_rot_pt(g, fi)
  if (Math.hypot(bx - rx, by - ry) <= tol) return H_ROT
  const hp = flo_handle_pts(flo_corners(g, fi))
  const order = [H_TL, H_T, H_TR, H_R, H_BR, H_B, H_BL, H_L]
  for (let i = 0; i < 8; i++) {
    if (Math.abs(bx - hp[i * 2]) <= tol && Math.abs(by - hp[i * 2 + 1]) <= tol) return order[i]
  }
  const dx = bx - f.x
  const dy = by - f.y
  const c = Math.cos(-f.rot)
  const s = Math.sin(-f.rot)
  const lx = (dx * c - dy * s) / (f.sx || 0.0001)
  const ly = (dx * s + dy * c) / (f.sy || 0.0001)
  if (Math.abs(lx) <= fi.width / 2 && Math.abs(ly) <= fi.height / 2) return H_MOVE
  return H_NONE
}

export function flo_drag_start(code: number, bx: number, by: number): void {
  const f = st().flo
  drag = code
  if (code === H_MOVE) {
    dragOff = [bx - f.x, by - f.y]
    return
  }
  if (code === H_ROT) {
    dragBase = [Math.atan2(by - f.y, bx - f.x) - f.rot, 0, 0]
    return
  }
  dragBase = [Math.hypot(bx - f.x, by - f.y), f.sx, f.sy]
}

export function flo_drag_move(g: Globals, bx: number, by: number, shift: number): number {
  const f = g.flo
  const fi = flo_img()
  if (drag === H_NONE || !fi) return ERR_NOOP
  if (drag === H_MOVE) {
    f.x = bx - dragOff[0]
    f.y = by - dragOff[1]
    flo_render()
    return 0
  }
  if (drag === H_ROT) {
    let rot = Math.atan2(by - f.y, bx - f.x) - dragBase[0]
    if (shift) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12)
    f.rot = rot
    flo_render()
    return 0
  }
  const dx = bx - f.x
  const dy = by - f.y
  const c = Math.cos(-f.rot)
  const s = Math.sin(-f.rot)
  const lx = dx * c - dy * s
  const ly = dx * s + dy * c
  const hw = fi.width / 2
  const hh = fi.height / 2
  const min = 0.03
  const sxAbs = clamp(Math.abs(lx) / hw, min, 24)
  const syAbs = clamp(Math.abs(ly) / hh, min, 24)
  const sgx = f.sx < 0 ? -1 : 1
  const sgy = f.sy < 0 ? -1 : 1
  if (drag === H_T || drag === H_B) {
    f.sy = syAbs * sgy
  } else if (drag === H_L || drag === H_R) {
    f.sx = sxAbs * sgx
  } else {
    const dist = Math.hypot(bx - f.x, by - f.y)
    const ratio = dragBase[0] > 0.0001 ? dist / dragBase[0] : 1
    f.sx = clamp(dragBase[1] * ratio, -24, 24)
    f.sy = clamp(dragBase[2] * ratio, -24, 24)
    if (Math.abs(f.sx) < min) f.sx = min * sgx
    if (Math.abs(f.sy) < min) f.sy = min * sgy
  }
  flo_render()
  return 0
}

export function flo_drag_end(): void {
  drag = H_NONE
}

export function flo_dragging(): number {
  return drag !== H_NONE ? 1 : 0
}

export function flo_nudge(g: Globals, dx: number, dy: number): number {
  if (!g.flo.kind) return ERR_NOOP
  g.flo.x += dx
  g.flo.y += dy
  flo_render()
  return 0
}

export function flo_rot(g: Globals, dir: number): number {
  if (!g.flo.kind) return ERR_NOOP
  g.flo.rot += (dir > 0 ? 1 : -1) * (Math.PI / 2)
  flo_render()
  sfx_play('tap')
  return 0
}

export function flo_flip(g: Globals, axis: number): number {
  if (!g.flo.kind) return ERR_NOOP
  if (axis) g.flo.sy = -g.flo.sy
  else g.flo.sx = -g.flo.sx
  flo_render()
  sfx_play('tap')
  return 0
}

export function flo_reset(g: Globals): number {
  if (!g.flo.kind) return ERR_NOOP
  g.flo.rot = 0
  g.flo.sx = 1
  g.flo.sy = 1
  flo_render()
  sfx_play('tap')
  return 0
}

export function flo_scale(g: Globals, fac: number): number {
  if (!g.flo.kind || !Number.isFinite(fac) || fac <= 0) return ERR_NOOP
  g.flo.sx = clamp(g.flo.sx * fac, -24, 24)
  g.flo.sy = clamp(g.flo.sy * fac, -24, 24)
  flo_render()
  return 0
}

export function flo_confirm(g: Globals): number {
  const f = g.flo
  const fi = flo_img()
  if (!f.kind || !fi) return ERR_NOOP
  const target = f.kind === K_PHOTO ? L_P : f.kind === K_SEL ? f.srcLayer : g.pen.layer
  const q = flo_corners(g, fi)
  let x0 = g.doc.w
  let y0 = g.doc.h
  let x1 = 0
  let y1 = 0
  for (let i = 0; i < 4; i++) {
    x0 = Math.min(x0, q[i * 2])
    y0 = Math.min(y0, q[i * 2 + 1])
    x1 = Math.max(x1, q[i * 2])
    y1 = Math.max(y1, q[i * 2 + 1])
  }
  x0 = clamp(Math.floor(x0) - 1, 0, g.doc.w - 1)
  y0 = clamp(Math.floor(y0) - 1, 0, g.doc.h - 1)
  x1 = clamp(Math.ceil(x1) + 1, x0 + 1, g.doc.w)
  y1 = clamp(Math.ceil(y1) + 1, y0 + 1, g.doc.h)
  const grp = hist_grp()
  const dstBefore = rect_grab(target, x0, y0, x1 - x0, y1 - y0)
  const ctx = live_slot(target)
  ctx.save()
  ctx.translate(f.x, f.y)
  ctx.rotate(f.rot)
  ctx.scale(f.sx, f.sy)
  ctx.imageSmoothingEnabled = flo_smooth(f.kind)
  ctx.drawImage(fi, -fi.width / 2, -fi.height / 2)
  ctx.restore()
  if (f.kind === K_SEL && f.srcRect && f.srcBefore) {
    hist_pix(g, grp, g.doc.cur, target, f.srcRect[0], f.srcRect[1], f.srcRect[2], f.srcRect[3], f.srcBefore)
  }
  hist_pix(g, grp, g.doc.cur, target, x0, y0, x1 - x0, y1 - y0, dstBefore)
  doc_pack_layer(g, target)
  const wasPaste = f.kind === K_PASTE && f.cont
  const kind = f.kind
  if (!wasPaste) flo_end(g)
  flo_render()
  toast(kind === K_PHOTO ? '写真レイヤーに配置しました' : kind === K_SEL ? '確定しました' : '貼り付けました')
  sfx_play('paper')
  return 0
}

export function flo_cancel(g: Globals): number {
  const f = g.flo
  if (!f.kind) return ERR_NOOP
  const img = flo_img()
  if (f.kind === K_SEL && img && f.srcRect) {
    const layer = f.srcLayer
    live_slot(layer).drawImage(img, f.srcRect[0], f.srcRect[1])
    doc_pack_layer(g, layer)
    g.sel.x = f.srcRect[0]
    g.sel.y = f.srcRect[1]
    g.sel.w = f.srcRect[2]
    g.sel.h = f.srcRect[3]
    g.sel.poly = null
    g.sel.has = 1
    sel_render()
  }
  flo_end(g)
  flo_render()
  return 0
}

function flo_end(g: Globals): void {
  const f = g.flo
  f.kind = K_NONE
  flo_img_set(null)
  f.srcRect = null
  f.srcBefore = null
  drag = H_NONE
  if (g.pen.tool === T_PASTE) g.pen.tool = g.pen.prevTool
}

export function flo_active(): number {
  return st().flo.kind ? 1 : 0
}
