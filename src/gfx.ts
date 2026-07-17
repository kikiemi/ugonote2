import { DOT_FONT_FAMILY, dot_text_canvas } from './dotfont'
import { PAT_TABLE } from './h'
import { hex_rgb, canvas_make, clamp } from './lib'

export type Mask = {
  b: Uint8Array
  w: number
  h: number
  x0: number
  y0: number
  x1: number
  y1: number
}

export function mask_make(w: number, h: number): Mask {
  return { b: new Uint8Array(w * h), w, h, x0: w, y0: h, x1: -1, y1: -1 }
}

export function mask_clear(m: Mask): void {
  m.b.fill(0)
  m.x0 = m.w
  m.y0 = m.h
  m.x1 = -1
  m.y1 = -1
}

export function mask_empty(m: Mask): boolean {
  return m.x1 < m.x0
}

function mask_bbox(m: Mask, x0: number, y0: number, x1: number, y1: number): void {
  if (x0 < m.x0) m.x0 = x0 < 0 ? 0 : x0
  if (y0 < m.y0) m.y0 = y0 < 0 ? 0 : y0
  if (x1 > m.x1) m.x1 = x1 >= m.w ? m.w - 1 : x1
  if (y1 > m.y1) m.y1 = y1 >= m.h ? m.h - 1 : y1
}

export function mask_disc(m: Mask, cx: number, cy: number, r: number): void {
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

export function mask_rect(m: Mask, x: number, y: number, rw: number, rh: number): void {
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

export function mask_seg(m: Mask, x0: number, y0: number, x1: number, y1: number, r: number): void {
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

export function mask_polyline(m: Mask, pts: readonly number[], r: number, close: number): void {
  const n = pts.length >> 1
  if (n === 0) return
  if (n === 1) {
    mask_disc(m, pts[0], pts[1], r)
    return
  }
  for (let i = 0; i < n - 1; i++) mask_seg(m, pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3], r)
  if (close) mask_seg(m, pts[(n - 1) * 2], pts[(n - 1) * 2 + 1], pts[0], pts[1], r)
}

export function mask_poly_fill(m: Mask, pts: readonly number[]): void {
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

export function mask_outline_ring(m: Mask, ow: number): Mask {
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

function pat_bit(pat: number, x: number, y: number): number {
  const rows = PAT_TABLE[pat].rows
  return (rows[y & 7] >> (7 - (x & 7))) & 1
}

export function blend_mask(ctx: CanvasRenderingContext2D, m: Mask, color: string, alpha: number, pat: number): void {
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
  const patterned = pat > 0
  for (let y = 0; y < bh; y++) {
    const mrow = (by + y) * mw + bx
    const drow = y * bw * 4
    for (let x = 0; x < bw; x++) {
      if (!mb[mrow + x]) continue
      if (patterned && !pat_bit(pat, bx + x, by + y)) continue
      const di = drow + x * 4
      const da = d[di + 3] / 255
      const oa = sa + da * (1 - sa)
      if (oa <= 0) continue
      const inv = (da * (1 - sa)) / oa
      const sf = sa / oa
      d[di] = sr * sf + d[di] * inv
      d[di + 1] = sg * sf + d[di + 1] * inv
      d[di + 2] = sb * sf + d[di + 2] * inv
      d[di + 3] = oa * 255
    }
  }
  ctx.putImageData(img, bx, by)
}

export function erase_mask(ctx: CanvasRenderingContext2D, m: Mask, pat: number): void {
  if (mask_empty(m)) return
  const bx = m.x0
  const by = m.y0
  const bw = m.x1 - m.x0 + 1
  const bh = m.y1 - m.y0 + 1
  const img = ctx.getImageData(bx, by, bw, bh)
  const d = img.data
  const mb = m.b
  const mw = m.w
  const patterned = pat > 0
  for (let y = 0; y < bh; y++) {
    const mrow = (by + y) * mw + bx
    const drow = y * bw * 4
    for (let x = 0; x < bw; x++) {
      if (!mb[mrow + x]) continue
      if (patterned && !pat_bit(pat, bx + x, by + y)) continue
      const di = drow + x * 4
      d[di] = 0
      d[di + 1] = 0
      d[di + 2] = 0
      d[di + 3] = 0
    }
  }
  ctx.putImageData(img, bx, by)
}

export function flood_mask(ref: ImageData, sx: number, sy: number, tol: number): Mask | null {
  const w = ref.width
  const h = ref.height
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

export function shape_pts(kind: number, x0: number, y0: number, x1: number, y1: number): number[] {
  const pts: number[] = []
  if (kind === 0) {
    pts.push(x0, y0, x1, y1)
    return pts
  }
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const rx = Math.abs(x1 - x0) / 2
  const ry = Math.abs(y1 - y0) / 2
  if (kind === 1) {
    pts.push(x0, y0, x1, y0, x1, y1, x0, y1)
    return pts
  }
  if (kind === 2) {
    const n = Math.max(24, Math.ceil((rx + ry) * 0.7))
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      pts.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry)
    }
    return pts
  }
  if (kind === 3) {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5
      const r = i % 2 === 0 ? 1 : 0.42
      pts.push(cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r)
    }
    return pts
  }
  const n = 48
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    const hx = 16 * Math.pow(Math.sin(t), 3)
    const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    pts.push(cx + (hx / 17) * rx, cy - (hy / 17) * ry)
  }
  return pts
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

const VERT_ROT = 'ー〜…‥－―‐（）｛｝［］「」『』〈〉《》【】()[]{}<>-—–'

const patCache = new Map<string, HTMLCanvasElement>()

export function pat_canvas(pat: number, color: string): HTMLCanvasElement {
  const key = pat + '|' + color
  const hit = patCache.get(key)
  if (hit) return hit
  const rows = PAT_TABLE[pat].rows
  const [c, x] = canvas_make(8, 8)
  x.fillStyle = color
  for (let y = 0; y < 8; y++) for (let px = 0; px < 8; px++) if ((rows[y] >> (7 - px)) & 1) x.fillRect(px, y, 1, 1)
  if (patCache.size > 64) patCache.clear()
  patCache.set(key, c)
  return c
}

export function text_render(text: string, size: number, bold: number, color: string, outline: number, ocolor: string, owidth: number, vert: number, fam: string): HTMLCanvasElement {
  if (fam === DOT_FONT_FAMILY) return dot_text_canvas(text, Math.max(1, Math.round(size / 8)), color, outline ? 1 : 0, ocolor, vert)
  const lines = text.split('\n')
  const font = (bold ? '700 ' : '400 ') + size + 'px ' + (fam ? '"' + fam + '",' : '') + '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN",sans-serif'
  const pad = (outline ? owidth : 0) + 4
  if (vert) {
    const cw = Math.ceil(size * 1.16)
    const chh = Math.ceil(size * 1.1)
    let maxChars = 1
    for (const ln of lines) maxChars = Math.max(maxChars, [...ln].length)
    const cols = Math.max(1, lines.length)
    const [c, x] = canvas_make(cw * cols + pad * 2, chh * maxChars + pad * 2)
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
        if (VERT_ROT.indexOf(ch) >= 0) x.rotate(Math.PI / 2)
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

export function canvas_rot90(src: HTMLCanvasElement, dir: number): HTMLCanvasElement {
  const [c, x] = canvas_make(src.height, src.width)
  x.save()
  x.translate(c.width / 2, c.height / 2)
  x.rotate((dir > 0 ? 90 : -90) * (Math.PI / 180))
  x.drawImage(src, -src.width / 2, -src.height / 2)
  x.restore()
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
