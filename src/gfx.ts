import { dot_font_family, dot_text_canvas } from './dotfont'
import { paint_active, paint_index, paint_pattern, type paint_pattern_t } from './paint'
import { st } from './state/store'
import { mode_normal } from './h'
import { canvas_affine_matrix, hex_rgb, canvas_make, clamp } from './lib'

export type mask_t = {
  b: Uint8Array
  w: number
  h: number
  x0: number
  y0: number
  x1: number
  y1: number
}

export function mask_make(w: number, h: number): mask_t {
  return { b: new Uint8Array(w * h), w, h, x0: w, y0: h, x1: -1, y1: -1 }
}

export function mask_empty(m: mask_t): boolean {
  return m.x1 < m.x0
}

function mask_bbox(m: mask_t, x0: number, y0: number, x1: number, y1: number): void {
  if (x0 < m.x0) m.x0 = x0 < 0 ? 0 : x0
  if (y0 < m.y0) m.y0 = y0 < 0 ? 0 : y0
  if (x1 > m.x1) m.x1 = x1 >= m.w ? m.w - 1 : x1
  if (y1 > m.y1) m.y1 = y1 >= m.h ? m.h - 1 : y1
}

export function mask_disc(m: mask_t, cx: number, cy: number, r: number): void {
  const w = m.w
  const h = m.h
  const b = m.b
  const ri = Math.max(0.5, r)
  const r2 = ri * ri
  const iy0 = Math.max(0, Math.floor(cy - ri))
  const iy1 = Math.min(h - 1, Math.ceil(cy + ri))
  const ix0 = Math.max(0, Math.floor(cx - ri))
  const ix1 = Math.min(w - 1, Math.ceil(cx + ri))
  for (let y = iy0; y <= iy1; y++) {
    const dy = y + 0.5 - cy
    const dx2max = r2 - dy * dy
    if (dx2max < 0) continue
    const dxm = Math.sqrt(dx2max)
    const sx = Math.max(ix0, Math.floor(cx - dxm))
    const ex = Math.min(ix1, Math.ceil(cx + dxm) - 1)
    const row = y * w
    for (let x = sx; x <= ex; x++) {
      const dx = x + 0.5 - cx
      if (dx * dx + dy * dy <= r2) b[row + x] = 255
    }
  }
  mask_bbox(m, ix0, iy0, ix1, iy1)
}

export function mask_rect(m: mask_t, x: number, y: number, rw: number, rh: number): void {
  const x0 = Math.max(0, x | 0)
  const y0 = Math.max(0, y | 0)
  const x1 = Math.min(m.w - 1, (x + rw - 1) | 0)
  const y1 = Math.min(m.h - 1, (y + rh - 1) | 0)
  if (x1 < x0 || y1 < y0) return
  const b = m.b
  const w = m.w
  for (let yy = y0; yy <= y1; yy++) b.fill(255, yy * w + x0, yy * w + x1 + 1)
  mask_bbox(m, x0, y0, x1, y1)
}

export function mask_seg(m: mask_t, x0: number, y0: number, x1: number, y1: number, r: number): void {
  const dx = x1 - x0
  const dy = y1 - y0
  const dist = Math.sqrt(dx * dx + dy * dy)
  const step = Math.max(0.5, r * 0.4)
  const n = Math.max(1, Math.ceil(dist / step))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    mask_disc(m, x0 + dx * t, y0 + dy * t, r)
  }
}

export function mask_polyline(m: mask_t, pts: readonly number[], r: number, close: number): void {
  const n = pts.length >> 1
  if (n === 0) return
  if (n === 1) {
    mask_disc(m, pts[0], pts[1], r)
    return
  }
  for (let i = 0; i < n - 1; i++) mask_seg(m, pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3], r)
  if (close) mask_seg(m, pts[(n - 1) * 2], pts[(n - 1) * 2 + 1], pts[0], pts[1], r)
}

export function mask_poly_fill(m: mask_t, pts: readonly number[]): void {
  const n = pts.length >> 1
  if (n < 3) return
  let py0 = m.h
  let py1 = -1
  for (let i = 0; i < n; i++) {
    const y = pts[i * 2 + 1]
    if (y < py0) py0 = y
    if (y > py1) py1 = y
  }
  const iy0 = Math.max(0, Math.floor(py0))
  const iy1 = Math.min(m.h - 1, Math.ceil(py1))
  const xs: number[] = []
  const b = m.b
  const w = m.w
  for (let y = iy0; y <= iy1; y++) {
    const yc = y + 0.5
    xs.length = 0
    let j = n - 1
    for (let i = 0; i < n; i++) {
      const yi = pts[i * 2 + 1]
      const yj = pts[j * 2 + 1]
      if ((yi <= yc && yj > yc) || (yj <= yc && yi > yc)) {
        const xi = pts[i * 2]
        const xj = pts[j * 2]
        xs.push(xi + ((yc - yi) / (yj - yi)) * (xj - xi))
      }
      j = i
    }
    xs.sort((a, c) => a - c)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const sx = Math.max(0, Math.round(xs[k]))
      const ex = Math.min(w - 1, Math.round(xs[k + 1]) - 1)
      if (ex >= sx) {
        b.fill(255, y * w + sx, y * w + ex + 1)
        mask_bbox(m, sx, y, ex, y)
      }
    }
  }
}

export function mask_outline_ring(m: mask_t, ow: number): mask_t {
  const ring = mask_make(m.w, m.h)
  if (mask_empty(m)) return ring
  const w = m.w
  const h = m.h
  const b = m.b
  for (let y = m.y0; y <= m.y1; y++) {
    const row = y * w
    for (let x = m.x0; x <= m.x1; x++) {
      if (!b[row + x]) continue
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || !b[row + x - 1] || !b[row + x + 1] || !b[row + x - w] || !b[row + x + w]
      if (edge) mask_disc(ring, x + 0.5, y + 0.5, ow + 0.5)
    }
  }
  const rb = ring.b
  const y0 = Math.max(0, ring.y0)
  const y1 = Math.min(h - 1, ring.y1)
  for (let y = y0; y <= y1; y++) {
    const row = y * w
    for (let x = ring.x0; x <= ring.x1; x++) if (b[row + x]) rb[row + x] = 0
  }
  return ring
}

export function blend_mask(ctx: CanvasRenderingContext2D, m: mask_t, color: string, alpha: number, pat: number, overwrite = 0, empty_only = 0): void {
  if (mask_empty(m)) return
  const bx = m.x0
  const by = m.y0
  const bw = m.x1 - m.x0 + 1
  const bh = m.y1 - m.y0 + 1
  const img = ctx.getImageData(bx, by, bw, bh)
  const d = img.data
  const [sr, sg, sb] = hex_rgb(color)
  const sa = clamp(alpha, 0, 1)
  const mb = m.b
  const mw = m.w
  const g = st()
  const tile = paint_pattern(g.doc.mode, pat, paint_active(g.doc.mode, g.pen.paint_tile, g.pen.paint_tile_normal))
  for (let y = 0; y < bh; y++) {
    const mrow = (by + y) * mw + bx
    const drow = y * bw * 4
    for (let x = 0; x < bw; x++) {
      if (!mb[mrow + x]) continue
      const di = drow + x * 4
      if (empty_only && d[di + 3]) continue
      const ti = paint_index(tile, bx + x, by + y)
      if (!tile.b[ti]) {
        if (overwrite) d.fill(0, di, di + 4)
        continue
      }
      if (overwrite) d.fill(0, di, di + 4)
      const rgba = tile.rgba
      const pi = ti * 4
      const a = rgba ? sa * rgba[pi + 3] / 255 : sa
      const da = d[di + 3] / 255
      const oa = a + da * (1 - a)
      if (oa <= 0) continue
      const inv = (da * (1 - a)) / oa
      const sf = a / oa
      d[di] = (rgba ? rgba[pi] : sr) * sf + d[di] * inv
      d[di + 1] = (rgba ? rgba[pi + 1] : sg) * sf + d[di + 1] * inv
      d[di + 2] = (rgba ? rgba[pi + 2] : sb) * sf + d[di + 2] * inv
      d[di + 3] = oa * 255
    }
  }
  ctx.putImageData(img, bx, by)
}

// 実機のペイント: ふつうは模様の点だけを今の色にし (下の絵も塗りかえる)、うわがきは模様のすき間を透明にする。
export function paint_mask(ctx: CanvasRenderingContext2D, m: mask_t, pat = st().pen.pat): void {
  const g = st()
  const native = g.doc.mode !== mode_normal
  blend_mask(ctx, m, g.pen.color, native ? 1 : g.pen.alpha, pat, g.pen.paint_over)
}

export function flood_mask(ref: ImageData, sx: number, sy: number, tol: number): mask_t | null {
  const w = ref.width
  const h = ref.height
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx < 0 || sy < 0 || sx >= w || sy >= h) return null
  sx |= 0
  sy |= 0
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null
  const d = ref.data
  const i0 = (sy * w + sx) * 4
  const tr = d[i0]
  const tg = d[i0 + 1]
  const tb = d[i0 + 2]
  const ta = d[i0 + 3]
  const m = mask_make(w, h)
  const mb = m.b
  const match = (p: number) => {
    const i = p * 4
    return Math.abs(d[i] - tr) <= tol && Math.abs(d[i + 1] - tg) <= tol && Math.abs(d[i + 2] - tb) <= tol && Math.abs(d[i + 3] - ta) <= tol
  }
  const stack: number[] = [sy * w + sx]
  while (stack.length > 0) {
    const p = stack.pop() as number
    if (mb[p] || !match(p)) continue
    const py = (p / w) | 0
    const row = py * w
    let lx = p - row
    let rx = lx
    while (lx > 0 && !mb[row + lx - 1] && match(row + lx - 1)) lx--
    while (rx < w - 1 && !mb[row + rx + 1] && match(row + rx + 1)) rx++
    mb.fill(255, row + lx, row + rx + 1)
    mask_bbox(m, lx, py, rx, py)
    for (let s = -1; s <= 1; s += 2) {
      const ny = py + s
      if (ny < 0 || ny >= h) continue
      const nrow = ny * w
      for (let x = lx; x <= rx; x++) {
        const q = nrow + x
        if (!mb[q] && match(q)) {
          stack.push(q)
          while (x < rx && !mb[nrow + x + 1] && match(nrow + x + 1)) x++
        }
      }
    }
  }
  return m
}

// 図形のふちの点 (x, y のくり返し)。kind は h.ts の shape_tool_list の番号。(x0, y0) はおしはじめ、(x1, y1) はいまの所。
// 直線と矢印は2点を結ぶ向きに、ほかは2点を対角とする四角の中に描く。
export function shape_pts(kind: number, x0: number, y0: number, x1: number, y1: number): number[] {
  const pts: number[] = []
  if (kind === 0) {
    pts.push(x0, y0, x1, y1)
    return pts
  }
  if (kind === 12) return arrow_pts(x0, y0, x1, y1)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const rx = Math.abs(x1 - x0) / 2
  const ry = Math.abs(y1 - y0) / 2
  switch (kind) {
    case 1:
      pts.push(x0, y0, x1, y0, x1, y1, x0, y1)
      break
    case 2: {
      const n = Math.max(24, Math.ceil((rx + ry) * 0.7))
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        pts.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry)
      }
      break
    }
    case 3:
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const r = i % 2 === 0 ? 1 : 0.42
        pts.push(cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r)
      }
      break
    case 4:
      for (let i = 0; i < 48; i++) {
        const t = (i / 48) * Math.PI * 2
        const hx = 16 * Math.pow(Math.sin(t), 3)
        const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
        pts.push(cx + (hx / 17) * rx, cy - (hy / 17) * ry)
      }
      break
    case 5:
      pts.push(cx, cy - ry, cx + rx, cy + ry, cx - rx, cy + ry)
      break
    case 6:
      // 直角は、おしはじめの横・いまの所の縦の角。
      pts.push(x0, y0, x0, y1, x1, y1)
      break
    case 7:
      pts.push(cx, cy - ry, cx + rx, cy, cx, cy + ry, cx - rx, cy)
      break
    case 8:
      polygon_pts(pts, cx, cy, rx, ry, 5, -Math.PI / 2, 1)
      break
    case 9:
      polygon_pts(pts, cx, cy, rx, ry, 6, 0, 1)
      break
    case 10:
      // 辺が四角のふちにふれるように、角までの長さをのばす。
      polygon_pts(pts, cx, cy, rx, ry, 8, Math.PI / 8, 1 / Math.cos(Math.PI / 8))
      break
    case 11:
      round_rect_pts(pts, cx, cy, rx, ry, Math.min(rx, ry) * 0.4)
      break
    case 13:
      bubble_pts(pts, cx, cy, rx, ry)
      break
    case 14:
      // くも: まるいふくらみが8つ、そのあいだはとがったくぼみ。
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * Math.PI * 2
        const r = 0.8 + 0.2 * Math.abs(Math.cos(4 * a))
        pts.push(cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r)
      }
      break
    case 15:
      moon_pts(pts, cx, cy, rx, ry)
      break
    case 16: {
      const ax = rx / 3
      const ay = ry / 3
      pts.push(cx - ax, cy - ry, cx + ax, cy - ry, cx + ax, cy - ay, cx + rx, cy - ay, cx + rx, cy + ay, cx + ax, cy + ay)
      pts.push(cx + ax, cy + ry, cx - ax, cy + ry, cx - ax, cy + ay, cx - rx, cy + ay, cx - rx, cy - ay, cx - ax, cy - ay)
      break
    }
    case 17: {
      const bolt = [0.15, -1, -0.7, 0.15, -0.1, 0.15, -0.25, 1, 0.7, -0.25, 0.05, -0.25]
      for (let i = 0; i < bolt.length; i += 2) pts.push(cx + bolt[i] * rx, cy + bolt[i + 1] * ry)
      break
    }
    case 18:
      // しずく: 上がとがり、下がまるい。いちばん太い所で四角のはばになるようにのばす。
      for (let i = 0; i < 48; i++) {
        const t = (i / 48) * Math.PI * 2
        pts.push(cx + rx * Math.sin(t) * Math.sin(t / 2) / 0.7698, cy - ry * Math.cos(t))
      }
      break
    case 19:
      // キラキラ: 4つのとがった先を、内がわへへこんだ線で結ぶ。
      for (let i = 0; i < 64; i++) {
        const t = (i / 64) * Math.PI * 2
        const c = Math.cos(t)
        const sn = Math.sin(t)
        pts.push(cx + rx * Math.sign(c) * Math.pow(Math.abs(c), 3), cy + ry * Math.sign(sn) * Math.pow(Math.abs(sn), 3))
      }
      break
    case 20:
      // はな: 花びら5まい (上に1まい)。
      for (let i = 0; i < 120; i++) {
        const a = (i / 120) * Math.PI * 2 - Math.PI / 2
        const r = 0.55 + 0.45 * Math.abs(Math.cos(2.5 * (a + Math.PI / 2)))
        pts.push(cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r)
      }
      break
    default:
      pts.push(x0, y0, x1, y0, x1, y1, x0, y1)
  }
  return pts
}

// 正 n 角形 (角の向きは start、角までの長さは四角の半分の scale 倍)。
function polygon_pts(pts: number[], cx: number, cy: number, rx: number, ry: number, n: number, start: number, scale: number): void {
  for (let i = 0; i < n; i++) {
    const a = start + (i * Math.PI * 2) / n
    pts.push(cx + Math.cos(a) * rx * scale, cy + Math.sin(a) * ry * scale)
  }
}

// 角のまるい四角 (角のまるみの半径は r)。
function round_rect_pts(pts: number[], cx: number, cy: number, rx: number, ry: number, r: number): void {
  const corners = [[rx - r, -(ry - r), -Math.PI / 2], [rx - r, ry - r, 0], [-(rx - r), ry - r, Math.PI / 2], [-(rx - r), -(ry - r), Math.PI]]
  for (const [ox, oy, a0] of corners) {
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (i / 8) * (Math.PI / 2)
      pts.push(cx + ox + Math.cos(a) * r, cy + oy + Math.sin(a) * r)
    }
  }
}

// 矢印: おしはじめからいまの所へ向かう、太い軸と三角の先。
function arrow_pts(x0: number, y0: number, x1: number, y1: number): number[] {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy)
  if (len < 1) return [x0, y0, x1, y1]
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const shaft = len * 0.12
  const head = len * 0.27
  const neck = len * 0.62
  const kx = x0 + ux * neck
  const ky = y0 + uy * neck
  return [
    x0 + nx * shaft, y0 + ny * shaft, kx + nx * shaft, ky + ny * shaft, kx + nx * head, ky + ny * head, x1, y1,
    kx - nx * head, ky - ny * head, kx - nx * shaft, ky - ny * shaft, x0 - nx * shaft, y0 - ny * shaft,
  ]
}

// ふきだし: だ円の左下から、四角の下のはしまでしっぽをのばす。
function bubble_pts(pts: number[], cx: number, cy: number, rx: number, ry: number): void {
  const by = cy - ry * 0.15
  const bry = ry * 0.85
  const from = (125 / 180) * Math.PI
  const to = ((105 + 360) / 180) * Math.PI
  for (let i = 0; i <= 64; i++) {
    const a = from + ((to - from) * i) / 64
    pts.push(cx + Math.cos(a) * rx, by + Math.sin(a) * bry)
  }
  pts.push(cx - rx * 0.6, cy + ry)
}

// 月: 外がわのだ円の左の弧と、内がわの細いだ円の弧のあいだ。
function moon_pts(pts: number[], cx: number, cy: number, rx: number, ry: number): void {
  const ox = cx + rx * 0.35
  const outer = rx * 1.35
  const inner = outer * 0.55
  for (let i = 0; i <= 32; i++) {
    const a = Math.PI / 2 + (i / 32) * Math.PI
    pts.push(ox + Math.cos(a) * outer, cy + Math.sin(a) * ry)
  }
  for (let i = 31; i > 0; i--) {
    const a = Math.PI / 2 + (i / 32) * Math.PI
    pts.push(ox + Math.cos(a) * inner, cy + Math.sin(a) * ry)
  }
}

export function path_smooth(pts: number[], level: number): number[] {
  let p = pts
  const iters = clamp(Math.round(level / 3), 0, 3)
  for (let k = 0; k < iters; k++) {
    const n = p.length >> 1
    if (n < 3) return p
    const out: number[] = [p[0], p[1]]
    for (let i = 0; i < n - 1; i++) {
      const ax = p[i * 2]
      const ay = p[i * 2 + 1]
      const bx = p[i * 2 + 2]
      const by = p[i * 2 + 3]
      out.push(ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25, ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75)
    }
    out.push(p[(n - 1) * 2], p[(n - 1) * 2 + 1])
    p = out
  }
  return p
}

const vert_rot = 'ー〜…‥－―‐（）｛｝［］「」『』〈〉《》【】()[]{}<>-—–'

const pat_cache = new WeakMap<paint_pattern_t, Map<string, HTMLCanvasElement>>()

export function pat_canvas(pat: number, color: string): HTMLCanvasElement {
  const g = st()
  const tile = paint_pattern(g.doc.mode, pat, paint_active(g.doc.mode, g.pen.paint_tile, g.pen.paint_tile_normal))
  let colors = pat_cache.get(tile)
  if (!colors) {
    colors = new Map()
    pat_cache.set(tile, colors)
  }
  const key = tile.rgba ? '' : color
  const hit = colors.get(key)
  if (hit) return hit
  const [c, x] = canvas_make(tile.w, tile.h)
  const img = x.createImageData(tile.w, tile.h)
  const rgb = hex_rgb(color)
  if (tile.rgba) img.data.set(tile.rgba)
  else for (let i = 0; i < tile.b.length; i++) {
    if (!tile.b[i]) continue
    const p = i * 4
    img.data[p] = rgb[0]
    img.data[p + 1] = rgb[1]
    img.data[p + 2] = rgb[2]
    img.data[p + 3] = 255
  }
  x.putImageData(img, 0, 0)
  if (colors.size >= 16) colors.delete(colors.keys().next().value!)
  colors.set(key, c)
  return c
}

export function text_render(text: string, size: number, bold: number, color: string, outline: number, ocolor: string, owidth: number, vert: number, fam: string): HTMLCanvasElement {
  if (fam === dot_font_family) return dot_text_canvas(text, Math.max(1, Math.round(size / 16)), color, outline ? 1 : 0, ocolor, vert, bold, owidth)
  const lines = text.split('\n')
  const font = (bold ? '700 ' : '400 ') + size + 'px ' + (fam ? '"' + fam + '",' : '') + '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN",sans-serif'
  const pad = (outline ? owidth : 0) + 4
  if (vert) {
    const cw = Math.ceil(size * 1.16)
    const chh = Math.ceil(size * 1.1)
    let max_chars = 1
    for (const ln of lines) max_chars = Math.max(max_chars, [...ln].length)
    const cols = Math.max(1, lines.length)
    const [c, x] = canvas_make(cw * cols + pad * 2, chh * max_chars + pad * 2)
    x.font = font
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    x.lineJoin = 'round'
    for (let li = 0; li < lines.length; li++) {
      const chars = [...lines[li]]
      const cx = pad + (cols - 1 - li) * cw + cw / 2
      for (let ci = 0; ci < chars.length; ci++) {
        const ch = chars[ci]
        const cy = pad + ci * chh + chh / 2
        x.save()
        x.translate(cx, cy)
        if (vert_rot.indexOf(ch) >= 0) x.rotate(Math.PI / 2)
        if (outline) {
          x.strokeStyle = ocolor
          x.lineWidth = owidth * 2
          x.strokeText(ch, 0, 0)
        }
        x.fillStyle = color
        x.fillText(ch, 0, 0)
        x.restore()
      }
    }
    return c
  }
  const [, mx] = canvas_make(8, 8)
  mx.font = font
  let wmax = 8
  for (const ln of lines) wmax = Math.max(wmax, Math.ceil(mx.measureText(ln).width))
  const lh = Math.ceil(size * 1.25)
  const [c, x] = canvas_make(wmax + pad * 2, lh * lines.length + pad * 2)
  x.font = font
  x.textBaseline = 'top'
  x.lineJoin = 'round'
  for (let i = 0; i < lines.length; i++) {
    const tx = pad
    const ty = pad + i * lh
    if (outline) {
      x.strokeStyle = ocolor
      x.lineWidth = owidth * 2
      x.strokeText(lines[i], tx, ty)
    }
    x.fillStyle = color
    x.fillText(lines[i], tx, ty)
  }
  return c
}

export function canvas_affine(src: HTMLCanvasElement, angle: number, smooth = 0, scale = 1, dx = 0, dy = 0): HTMLCanvasElement {
  const [c, x] = canvas_make(src.width, src.height)
  const quarter = angle % 90 === 0
  const matrix = canvas_affine_matrix(src.width, src.height, angle, scale, dx, dy)
  x.imageSmoothingEnabled = smooth !== 0 && (!quarter || scale !== 1)
  x.imageSmoothingQuality = 'high'
  x.setTransform(...matrix)
  x.drawImage(src, 0, 0)
  return c
}

export function canvas_flip(src: HTMLCanvasElement, horiz: number): HTMLCanvasElement {
  const [c, x] = canvas_make(src.width, src.height)
  x.save()
  if (horiz) {
    x.scale(-1, 1)
    x.drawImage(src, -src.width, 0)
  } else {
    x.scale(1, -1)
    x.drawImage(src, 0, -src.height)
  }
  x.restore()
  return c
}
