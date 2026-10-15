import { doc_pack_layer } from './doc'
import { toast } from './dom'
import { live_slot, live_write, live_canvas, flo_img, flo_img_set, clip_img, clip_img_set } from './engine'
import { mask_make, mask_rect, mask_poly_fill, paint_mask, type mask_t } from './gfx'
import { t_lasso, t_paste, k_none, k_paste, k_photo, k_text, k_sel, l_p, mode_normal, err_bad, err_noop, type rle_t } from './h'
import { hist_grp, hist_pix, rect_grab } from './hist'
import { canvas_make, clamp, hex_rgb } from './lib'
import { paint_tile_max, pat_custom } from './paint'
import { paint_store_save } from './paint_storage'
import { sfx_play } from './snd'
import { st, type deep_ro_t, type globals_t } from './state/store'

export const h_none = 0
export const h_move = 1
export const h_tl = 2
export const h_t = 3
export const h_tr = 4
export const h_r = 5
export const h_br = 6
export const h_b = 7
export const h_bl = 8
export const h_l = 9
export const h_rot = 10

let ants_ctx: CanvasRenderingContext2D | null = null
let flo_ctx: CanvasRenderingContext2D | null = null
let marquee = 0
let marquee_lasso = 0
let draw_pts: number[] = []
let drag = h_none
let drag_off = [0, 0]
let drag_base = [0, 0, 0]

export function sel_bind(ants: CanvasRenderingContext2D, flo: CanvasRenderingContext2D): void {
  ants_ctx = ants
  flo_ctx = flo
}

function sel_mask(g: deep_ro_t<globals_t>): mask_t {
  const m = mask_make(g.doc.w, g.doc.h)
  if (g.sel.poly) mask_poly_fill(m, g.sel.poly)
  else mask_rect(m, g.sel.x, g.sel.y, g.sel.w, g.sel.h)
  return m
}

export function sel_render(): void {
  if (!ants_ctx) return
  const g = st()
  const x = ants_ctx
  x.clearRect(0, 0, g.doc.w, g.doc.h)
  const path = (): void => {
    x.beginPath()
    if (marquee && draw_pts.length >= 4) {
      if (marquee_lasso) {
        x.moveTo(draw_pts[0], draw_pts[1])
        for (let i = 1; i < draw_pts.length >> 1; i++) x.lineTo(draw_pts[i * 2], draw_pts[i * 2 + 1])
      } else {
        x.rect(Math.min(draw_pts[0], draw_pts[2]), Math.min(draw_pts[1], draw_pts[3]), Math.abs(draw_pts[2] - draw_pts[0]), Math.abs(draw_pts[3] - draw_pts[1]))
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

function flo_corners(g: deep_ro_t<globals_t>, fi: HTMLCanvasElement): number[] {
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

function flo_rot_pt(g: deep_ro_t<globals_t>, fi: HTMLCanvasElement): [number, number] {
  const f = g.flo
  const c = Math.cos(f.rot)
  const s = Math.sin(f.rot)
  const ly = -((fi.height / 2) * Math.abs(f.sy) + 30 / g.view.z)
  return [f.x - ly * s, f.y + ly * c]
}

function flo_smooth(kind: number): boolean {
  return kind === k_photo || kind === k_text
}

export function flo_render(): void {
  if (!flo_ctx) return
  const g = st()
  const x = flo_ctx
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

function inside_sel(g: deep_ro_t<globals_t>, bx: number, by: number): number {
  if (!g.sel.has || bx < g.sel.x || by < g.sel.y || bx >= g.sel.x + g.sel.w || by >= g.sel.y + g.sel.h) return 0
  if (!g.sel.poly) return 1
  const m = sel_mask(g)
  return m.b[Math.floor(by) * m.w + Math.floor(bx)] ? 1 : 0
}

export function sel_down(g: globals_t, bx: number, by: number): number {
  if (inside_sel(g, bx, by)) return lift_to_flo(g, bx, by)
  g.sel.has = 0
  g.sel.poly = null
  marquee = 1
  marquee_lasso = g.pen.tool === t_lasso ? 1 : 0
  draw_pts = [bx, by, bx, by]
  sel_render()
  return 0
}

export function sel_move(bx: number, by: number): void {
  if (!marquee) return
  const g = st()
  if (marquee_lasso) {
    const n = draw_pts.length
    const dx = bx - draw_pts[n - 2]
    const dy = by - draw_pts[n - 1]
    const min_dist = Math.max(0.5, 1.75 / g.view.z)
    if (dx * dx + dy * dy < min_dist * min_dist) return
    if (draw_pts.length < 8192) draw_pts.push(bx, by)
    else {
      draw_pts[n - 2] = bx
      draw_pts[n - 1] = by
    }
  } else {
    draw_pts[2] = bx
    draw_pts[3] = by
  }
  sel_render()
}

export function sel_up(g: globals_t): number {
  if (!marquee) return err_noop
  const lasso = marquee_lasso
  marquee = 0
  marquee_lasso = 0
  if (lasso) {
    if (draw_pts.length < 6) {
      draw_pts = []
      sel_render()
      return 0
    }
    let x0 = g.doc.w
    let y0 = g.doc.h
    let x1 = 0
    let y1 = 0
    for (let i = 0; i < draw_pts.length; i += 2) {
      x0 = Math.min(x0, draw_pts[i])
      y0 = Math.min(y0, draw_pts[i + 1])
      x1 = Math.max(x1, draw_pts[i])
      y1 = Math.max(y1, draw_pts[i + 1])
    }
    g.sel.poly = draw_pts.slice()
    g.sel.x = Math.max(0, Math.floor(x0))
    g.sel.y = Math.max(0, Math.floor(y0))
    g.sel.w = Math.max(0, Math.min(g.doc.w, Math.ceil(x1)) - g.sel.x)
    g.sel.h = Math.max(0, Math.min(g.doc.h, Math.ceil(y1)) - g.sel.y)
  } else {
    g.sel.poly = null
    const ax = clamp(draw_pts[0], 0, g.doc.w)
    const ay = clamp(draw_pts[1], 0, g.doc.h)
    const bx = clamp(draw_pts[2], 0, g.doc.w)
    const by = clamp(draw_pts[3], 0, g.doc.h)
    const x0 = Math.floor(Math.min(ax, bx))
    const y0 = Math.floor(Math.min(ay, by))
    const x1 = Math.ceil(Math.max(ax, bx))
    const y1 = Math.ceil(Math.max(ay, by))
    g.sel.x = x0
    g.sel.y = y0
    g.sel.w = Math.max(0, x1 - x0)
    g.sel.h = Math.max(0, y1 - y0)
  }
  draw_pts = []
  g.sel.has = g.sel.w > 1 && g.sel.h > 1 ? 1 : 0
  if (!g.sel.has) g.sel.poly = null
  sel_render()
  if (g.sel.has) sfx_play('tap')
  return 0
}

export function sel_clear(g: globals_t): number {
  const changed = g.sel.has || g.sel.poly || marquee || draw_pts.length
  g.sel.has = 0
  g.sel.poly = null
  marquee = 0
  marquee_lasso = 0
  draw_pts = []
  sel_render()
  return changed ? 0 : err_noop
}

function region_grab(g: deep_ro_t<globals_t>, masked: number): HTMLCanvasElement {
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

function region_erase(g: globals_t, grp: number, with_hist: number): void {
  const layer = g.pen.layer
  const before = with_hist ? rect_grab(layer, g.sel.x, g.sel.y, g.sel.w, g.sel.h) : null
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
  live_write(layer).putImageData(img, g.sel.x, g.sel.y)
  if (with_hist && before) {
    hist_pix(g, grp, g.doc.cur, layer, g.sel.x, g.sel.y, g.sel.w, g.sel.h, before)
    doc_pack_layer(g, layer, { x: g.sel.x, y: g.sel.y, w: g.sel.w, h: g.sel.h })
  }
}

function region_commit(g: globals_t, before: rle_t): void {
  const s = g.sel
  hist_pix(g, hist_grp(), g.doc.cur, g.pen.layer, s.x, s.y, s.w, s.h, before)
  doc_pack_layer(g, g.pen.layer, { x: s.x, y: s.y, w: s.w, h: s.h })
}

export function sel_invert(g: globals_t): number {
  if (!g.sel.has || g.flo.kind) return err_noop
  const s = g.sel
  const m = sel_mask(g)
  const before = rect_grab(g.pen.layer, s.x, s.y, s.w, s.h)
  const img = live_slot(g.pen.layer).getImageData(s.x, s.y, s.w, s.h)
  const rgb = hex_rgb(g.pen.color)
  for (let y = 0; y < s.h; y++) {
    const row = (s.y + y) * m.w + s.x
    for (let x = 0; x < s.w; x++) {
      if (!m.b[row + x]) continue
      const i = (y * s.w + x) * 4
      if (g.doc.mode === mode_normal) {
        if (!img.data[i + 3]) continue
        img.data[i] = 255 - img.data[i]
        img.data[i + 1] = 255 - img.data[i + 1]
        img.data[i + 2] = 255 - img.data[i + 2]
      }
      else if (img.data[i + 3] >= 128) img.data.fill(0, i, i + 4)
      else {
        img.data[i] = rgb[0]
        img.data[i + 1] = rgb[1]
        img.data[i + 2] = rgb[2]
        img.data[i + 3] = 255
      }
    }
  }
  live_write(g.pen.layer).putImageData(img, s.x, s.y)
  region_commit(g, before)
  toast(g.doc.mode === mode_normal ? '選択した絵の色を反転しました' : '塗ったところと透明なところを反転しました')
  sfx_play('tap')
  return 0
}

export function sel_paint(g: globals_t): number {
  if (!g.sel.has || g.flo.kind) return err_noop
  const s = g.sel
  const before = rect_grab(g.pen.layer, s.x, s.y, s.w, s.h)
  paint_mask(live_write(g.pen.layer), sel_mask(g))
  region_commit(g, before)
  sfx_play('tap')
  return 0
}

export function sel_register_paint(g: globals_t): number {
  if (!g.sel.has || g.flo.kind) return err_noop
  if (g.sel.w > paint_tile_max || g.sel.h > paint_tile_max) {
    toast('ペイントに登録できる範囲は512×512までです')
    return err_bad
  }
  const c = region_grab(g, 1)
  const img = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
  const b: number[] = []
  const normal = g.doc.mode === mode_normal
  let filled = 0
  for (let i = 3; i < img.data.length; i += 4) {
    const bit = img.data[i] >= (normal ? 1 : 128) ? 1 : 0
    b.push(bit)
    filled += bit
  }
  if (!filled) {
    toast('選択したレイヤーに絵を描いてから登録してね')
    return err_noop
  }
  const tile = { w: c.width, h: c.height, b, ...(normal ? { rgba: Array.from(img.data) } : {}) }
  if (normal) g.pen.paint_tile_normal = tile
  else g.pen.paint_tile = tile
  g.pen.pat = pat_custom
  toast('ペイントの「？」に登録しました（保存中）')
  paint_store_save(g.doc.mode, tile, saved => {
    const current = st().pen
    if ((normal ? current.paint_tile_normal : current.paint_tile) !== tile) return
    toast(saved ? 'ペイントの「？」に登録しました' : '「？」に登録しました（端末への保存はできませんでした）')
  })
  sfx_play('save')
  return 0
}

export function sel_copy(g: globals_t): number {
  if (!g.sel.has) return err_noop
  clip_img_set(region_grab(g, 1))
  g.clip = { w: g.sel.w, h: g.sel.h }
  sel_clear(g)
  sfx_play('tap')
  return 0
}

export function sel_cut(g: globals_t): number {
  if (!g.sel.has) return err_noop
  clip_img_set(region_grab(g, 1))
  g.clip = { w: g.sel.w, h: g.sel.h }
  region_erase(g, hist_grp(), 1)
  sel_clear(g)
  toast('切り取りました')
  sfx_play('del')
  return 0
}

export function sel_delete(g: globals_t): number {
  if (!g.sel.has) return err_noop
  region_erase(g, hist_grp(), 1)
  sel_clear(g)
  sfx_play('del')
  return 0
}

export function sel_transform(g: globals_t): number {
  if (!g.sel.has) return err_noop
  return lift_to_flo(g, 0, 0)
}

function lift_to_flo(g: globals_t, bx: number, by: number): number {
  if (!g.sel.has) return err_noop
  const layer = g.pen.layer
  const img = region_grab(g, 1)
  const f = g.flo
  f.kind = k_sel
  flo_img_set(img)
  f.src_layer = layer
  f.src_poly = g.sel.poly ? [...g.sel.poly] : null
  f.src_rect = [g.sel.x, g.sel.y, g.sel.w, g.sel.h]
  f.src_before = rect_grab(layer, g.sel.x, g.sel.y, g.sel.w, g.sel.h)
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
  drag = h_move
  drag_off = [bx - f.x, by - f.y]
  flo_render()
  sfx_play('tap')
  return 0
}

export function flo_begin_paste(g: globals_t, continuous = 1): number {
  const img = clip_img()
  if (!g.clip || !img) return err_noop
  const f = g.flo
  f.kind = k_paste
  flo_img_set(img)
  f.x = g.doc.w / 2
  f.y = g.doc.h / 2
  f.rot = 0
  f.sx = 1
  f.sy = 1
  f.cont = continuous ? 1 : 0
  sel_clear(g)
  f.src_poly = null
  f.src_rect = null
  f.src_before = null
  flo_render()
  return 0
}

export function flo_begin_img(g: globals_t, c: HTMLCanvasElement, kind: number, bx: number, by: number, cont = 0): number {
  if (!c.width || !c.height || kind === k_none) return err_bad
  const f = g.flo
  f.kind = kind
  flo_img_set(c)
  const fit = Math.min(1, (g.doc.w * 0.9) / c.width, (g.doc.h * 0.9) / c.height)
  const scale = kind === k_text ? 1 : fit
  f.sx = scale
  f.sy = scale
  f.x = bx
  f.y = by
  f.rot = 0
  f.cont = cont
  f.src_layer = g.pen.layer
  f.src_poly = null
  f.src_rect = null
  f.src_before = null
  flo_render()
  return 0
}

export function flo_hit(bx: number, by: number): number {
  const g = st()
  const f = g.flo
  const fi = flo_img()
  if (!f.kind || !fi) return h_none
  const tol = 9 / g.view.z
  const [rx, ry] = flo_rot_pt(g, fi)
  if (Math.hypot(bx - rx, by - ry) <= tol) return h_rot
  const hp = flo_handle_pts(flo_corners(g, fi))
  const order = [h_tl, h_t, h_tr, h_r, h_br, h_b, h_bl, h_l]
  for (let i = 0; i < 8; i++) {
    if (Math.abs(bx - hp[i * 2]) <= tol && Math.abs(by - hp[i * 2 + 1]) <= tol) return order[i]
  }
  const dx = bx - f.x
  const dy = by - f.y
  const c = Math.cos(-f.rot)
  const s = Math.sin(-f.rot)
  const lx = (dx * c - dy * s) / (f.sx || 0.0001)
  const ly = (dx * s + dy * c) / (f.sy || 0.0001)
  if (Math.abs(lx) <= fi.width / 2 && Math.abs(ly) <= fi.height / 2) return h_move
  return h_none
}

export function flo_drag_start(code: number, bx: number, by: number): void {
  const f = st().flo
  drag = code
  if (code === h_move) {
    drag_off = [bx - f.x, by - f.y]
    return
  }
  if (code === h_rot) {
    drag_base = [Math.atan2(by - f.y, bx - f.x) - f.rot, 0, 0]
    return
  }
  drag_base = [Math.hypot(bx - f.x, by - f.y), f.sx, f.sy]
}

export function flo_drag_move(g: globals_t, bx: number, by: number, shift: number): number {
  const f = g.flo
  const fi = flo_img()
  if (drag === h_none || !fi) return err_noop
  if (drag === h_move) {
    f.x = bx - drag_off[0]
    f.y = by - drag_off[1]
    flo_render()
    return 0
  }
  if (drag === h_rot) {
    let rot = Math.atan2(by - f.y, bx - f.x) - drag_base[0]
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
  const sx_abs = clamp(Math.abs(lx) / hw, min, 24)
  const sy_abs = clamp(Math.abs(ly) / hh, min, 24)
  const sgx = f.sx < 0 ? -1 : 1
  const sgy = f.sy < 0 ? -1 : 1
  if (drag === h_t || drag === h_b) {
    f.sy = sy_abs * sgy
  } else if (drag === h_l || drag === h_r) {
    f.sx = sx_abs * sgx
  } else {
    const dist = Math.hypot(bx - f.x, by - f.y)
    const ratio = drag_base[0] > 0.0001 ? dist / drag_base[0] : 1
    f.sx = clamp(drag_base[1] * ratio, -24, 24)
    f.sy = clamp(drag_base[2] * ratio, -24, 24)
    if (Math.abs(f.sx) < min) f.sx = min * sgx
    if (Math.abs(f.sy) < min) f.sy = min * sgy
  }
  flo_render()
  return 0
}

export function flo_drag_end(): void {
  drag = h_none
}

export function flo_dragging(): number {
  return drag !== h_none ? 1 : 0
}

export function flo_nudge(g: globals_t, dx: number, dy: number): number {
  if (!g.flo.kind) return err_noop
  g.flo.x += dx
  g.flo.y += dy
  flo_render()
  return 0
}

export function flo_rot(g: globals_t, dir: number): number {
  if (!g.flo.kind) return err_noop
  g.flo.rot += (dir > 0 ? 1 : -1) * (Math.PI / 2)
  flo_render()
  sfx_play('tap')
  return 0
}

export function flo_flip(g: globals_t, axis: number): number {
  if (!g.flo.kind) return err_noop
  if (axis) g.flo.sy = -g.flo.sy
  else g.flo.sx = -g.flo.sx
  flo_render()
  sfx_play('tap')
  return 0
}

export function flo_reset(g: globals_t): number {
  if (!g.flo.kind) return err_noop
  g.flo.rot = 0
  g.flo.sx = 1
  g.flo.sy = 1
  flo_render()
  sfx_play('tap')
  return 0
}

export function flo_scale(g: globals_t, fac: number): number {
  if (!g.flo.kind || !Number.isFinite(fac) || fac <= 0) return err_noop
  g.flo.sx = clamp(g.flo.sx * fac, -24, 24)
  g.flo.sy = clamp(g.flo.sy * fac, -24, 24)
  flo_render()
  return 0
}

export function flo_confirm(g: globals_t): number {
  const f = g.flo
  const fi = flo_img()
  if (!f.kind || !fi) return err_noop
  const target = f.kind === k_photo ? l_p : f.kind === k_sel ? f.src_layer : g.pen.layer
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
  const dst_before = rect_grab(target, x0, y0, x1 - x0, y1 - y0)
  const ctx = live_write(target)
  ctx.save()
  ctx.translate(f.x, f.y)
  ctx.rotate(f.rot)
  ctx.scale(f.sx, f.sy)
  ctx.imageSmoothingEnabled = flo_smooth(f.kind)
  ctx.drawImage(fi, -fi.width / 2, -fi.height / 2)
  ctx.restore()
  if (f.kind === k_sel && f.src_rect && f.src_before) {
    hist_pix(g, grp, g.doc.cur, target, f.src_rect[0], f.src_rect[1], f.src_rect[2], f.src_rect[3], f.src_before)
  }
  hist_pix(g, grp, g.doc.cur, target, x0, y0, x1 - x0, y1 - y0, dst_before)
  doc_pack_layer(g, target)
  const was_paste = f.kind === k_paste && f.cont
  const kind = f.kind
  if (!was_paste) flo_end(g)
  flo_render()
  toast(kind === k_photo ? '写真レイヤーに配置しました' : kind === k_sel ? '確定しました' : '貼り付けました')
  sfx_play('paper')
  return 0
}

export function flo_cancel(g: globals_t): number {
  const f = g.flo
  if (!f.kind) return err_noop
  const img = flo_img()
  if (f.kind === k_sel && img && f.src_rect) {
    const layer = f.src_layer
    live_write(layer).drawImage(img, f.src_rect[0], f.src_rect[1])
    doc_pack_layer(g, layer)
    g.sel.x = f.src_rect[0]
    g.sel.y = f.src_rect[1]
    g.sel.w = f.src_rect[2]
    g.sel.h = f.src_rect[3]
    g.sel.poly = f.src_poly ? [...f.src_poly] : null
    g.sel.has = 1
    sel_render()
  }
  flo_end(g)
  flo_render()
  return 0
}

function flo_end(g: globals_t): void {
  const f = g.flo
  f.kind = k_none
  flo_img_set(null)
  f.src_poly = null
  f.src_rect = null
  f.src_before = null
  drag = h_none
  if (g.pen.tool === t_paste) g.pen.tool = g.pen.prev_tool
}

export function flo_active(): number {
  return st().flo.kind ? 1 : 0
}
