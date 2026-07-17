import { getStrokePoints } from 'perfect-freehand'
import { live_slot } from './engine'
import { B_PEN, B_MARKER, B_PENCIL, B_BRUSH, B_AIRBRUSH, B_CRAYON, B_CALLIG, B_DOTS, B_WATER, B_NEON, B_CHALK, B_SPAT, B_RIBBON } from './h'
import { clamp, canvas_make, hex_rgb } from './lib'
import { st } from './state/store'

let seed = 0x2545f491
function rnd(): number {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return ((seed >>> 0) % 100000) / 100000
}
export function brush_seed(v: number): void {
  seed = (v | 1) >>> 0
}

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0
  h = (h ^ (h >>> 13)) | 0
  h = Math.imul(h, 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

export function brush_is_direct(brush: number): number {
  return brush === B_PEN ? 0 : 1
}

function buffered(brush: number): number {
  return brush === B_MARKER || brush === B_WATER ? 1 : 0
}

let grainC: HTMLCanvasElement | null = null
function grain(): HTMLCanvasElement {
  if (grainC) return grainC
  const [c, x] = canvas_make(96, 96)
  const img = x.createImageData(96, 96)
  for (let y = 0; y < 96; y++)
    for (let px = 0; px < 96; px++) {
      const g = hash2(px, y)
      const a = g > 0.34 ? Math.min(255, (g - 0.34) * 560) : 0
      img.data[(y * 96 + px) * 4 + 3] = a
      img.data[(y * 96 + px) * 4] = 255
      img.data[(y * 96 + px) * 4 + 1] = 255
      img.data[(y * 96 + px) * 4 + 2] = 255
    }
  x.putImageData(img, 0, 0)
  grainC = c
  return c
}

let streakC: HTMLCanvasElement | null = null
function streaks(): HTMLCanvasElement {
  if (streakC) return streakC
  const [c, x] = canvas_make(96, 96)
  const img = x.createImageData(96, 96)
  for (let y = 0; y < 96; y++)
    for (let px = 0; px < 96; px++) {
      const s = hash2(Math.round((px - y) * 0.7), 7)
      const f = hash2(px, y + 400)
      const g = s * 0.75 + f * 0.25
      img.data[(y * 96 + px) * 4 + 3] = g > 0.3 ? Math.min(255, (g - 0.3) * 480) : 0
      img.data[(y * 96 + px) * 4] = 255
      img.data[(y * 96 + px) * 4 + 1] = 255
      img.data[(y * 96 + px) * 4 + 2] = 255
    }
  x.putImageData(img, 0, 0)
  streakC = c
  return c
}

const tips = new Map<string, HTMLCanvasElement>()

export function tip_get(brush: number, size: number, color: string, variant: number): HTMLCanvasElement {
  const key = brush + '|' + size + '|' + color + '|' + variant
  const hit = tips.get(key)
  if (hit) {
    tips.delete(key)
    tips.set(key, hit)
    return hit
  }
  const [cr, cg, cb] = hex_rgb(color)
  const rgba = (a: number) => `rgba(${cr},${cg},${cb},${a})`
  let c: HTMLCanvasElement
  if (brush === B_MARKER) {
    const w = Math.ceil(size * 1.9)
    const [cv, x] = canvas_make(w, w)
    x.translate(w / 2, w / 2)
    x.rotate(Math.PI / 4)
    x.fillStyle = rgba(1)
    const bw = size * 1.5
    const bh = Math.max(1.6, size * 0.5)
    x.beginPath()
    const rr = Math.min(bw, bh) * 0.4
    x.roundRect(-bw / 2, -bh / 2, bw, bh, rr)
    x.fill()
    c = cv
  } else if (brush === B_WATER) {
    const d = Math.ceil(size * 2.6)
    const [cv, x] = canvas_make(d, d)
    const g = x.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2)
    g.addColorStop(0, rgba(0.5))
    g.addColorStop(0.62, rgba(0.42))
    g.addColorStop(0.86, rgba(0.78))
    g.addColorStop(1, rgba(0.02))
    x.fillStyle = g
    x.fillRect(0, 0, d, d)
    c = cv
  } else if (brush === B_PENCIL) {
    const d = Math.ceil(size * 1.35) + 2
    const [cv, x] = canvas_make(d, d)
    const g = x.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2)
    g.addColorStop(0, rgba(0.62))
    g.addColorStop(0.8, rgba(0.5))
    g.addColorStop(1, rgba(0))
    x.fillStyle = g
    x.fillRect(0, 0, d, d)
    x.globalCompositeOperation = 'destination-in'
    x.drawImage(streaks(), 0, 0, d, d)
    c = cv
  } else if (brush === B_CRAYON) {
    const d = Math.ceil(size * 1.5) + 2
    const [cv, x] = canvas_make(d, d)
    const g = x.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2)
    g.addColorStop(0, rgba(0.98))
    g.addColorStop(0.75, rgba(0.92))
    g.addColorStop(1, rgba(0.15))
    x.fillStyle = g
    x.fillRect(0, 0, d, d)
    x.globalCompositeOperation = 'destination-in'
    x.drawImage(grain(), 0, 0, d, d)
    c = cv
  } else if (brush === B_BRUSH) {
    const d = Math.ceil(size * 1.6) + 2
    const [cv, x] = canvas_make(d, d)
    const g = x.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2)
    g.addColorStop(0, rgba(0.92))
    g.addColorStop(0.62, rgba(0.66))
    g.addColorStop(1, rgba(0))
    x.fillStyle = g
    x.fillRect(0, 0, d, d)
    x.globalCompositeOperation = 'destination-out'
    x.drawImage(streaks(), 0, 0, d * 1.4, d * 1.4)
    c = cv
  } else if (brush === B_AIRBRUSH) {
    const d = Math.ceil(size * 2.4)
    const [cv, x] = canvas_make(d, d)
    const g = x.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2)
    g.addColorStop(0, rgba(0.3))
    g.addColorStop(1, rgba(0))
    x.fillStyle = g
    x.fillRect(0, 0, d, d)
    c = cv
  } else if (brush === B_CALLIG) {
    const w = Math.ceil(size * 1.7)
    const [cv, x] = canvas_make(w, w)
    x.translate(w / 2, w / 2)
    x.rotate(Math.PI / 4)
    x.fillStyle = rgba(1)
    x.beginPath()
    x.ellipse(0, 0, size * 0.75, Math.max(0.9, size * 0.2), 0, 0, Math.PI * 2)
    x.fill()
    c = cv
  } else if (brush === B_NEON) {
    const d = Math.ceil(size * 3.2)
    const [cv, x] = canvas_make(d, d)
    const g = x.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2)
    g.addColorStop(0, rgba(0.5))
    g.addColorStop(0.35, rgba(0.32))
    g.addColorStop(1, rgba(0))
    x.fillStyle = g
    x.fillRect(0, 0, d, d)
    const core = x.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, size * 0.55)
    core.addColorStop(0, 'rgba(255,255,255,0.95)')
    core.addColorStop(0.55, rgba(0.95))
    core.addColorStop(1, rgba(0))
    x.fillStyle = core
    x.fillRect(0, 0, d, d)
    c = cv
  } else if (brush === B_CHALK) {
    const d = Math.ceil(size * 1.6) + 2
    const [cv, x] = canvas_make(d, d)
    const g = x.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2)
    g.addColorStop(0, rgba(0.8))
    g.addColorStop(0.7, rgba(0.66))
    g.addColorStop(1, rgba(0.05))
    x.fillStyle = g
    x.fillRect(0, 0, d, d)
    x.globalCompositeOperation = 'destination-in'
    x.drawImage(grain(), -d * 0.2, -d * 0.2, d * 1.8, d * 1.8)
    c = cv
  } else if (brush === B_SPAT) {
    const d = Math.ceil(size * 3)
    const [cv, x] = canvas_make(d, d)
    x.fillStyle = rgba(1)
    let sd = (variant * 2654435761 + 12345) >>> 0
    const vr = () => {
      sd ^= sd << 13
      sd ^= sd >>> 17
      sd ^= sd << 5
      return ((sd >>> 0) % 100000) / 100000
    }
    const nDrop = 5 + ((variant * 3) % 4)
    for (let k = 0; k < nDrop; k++) {
      const a = vr() * Math.PI * 2
      const rr2 = vr() * d * 0.42
      const dr = Math.max(0.8, (vr() * vr()) * size * 0.45)
      x.beginPath()
      x.arc(d / 2 + Math.cos(a) * rr2, d / 2 + Math.sin(a) * rr2, dr, 0, Math.PI * 2)
      x.fill()
    }
    c = cv
  } else if (brush === B_RIBBON) {
    const w = Math.ceil(size * 2)
    const [cv, x] = canvas_make(w, w)
    x.fillStyle = rgba(1)
    const bw = size * 1.8
    const bh = Math.max(1.4, size * 0.34)
    x.beginPath()
    x.roundRect((w - bw) / 2, (w - bh) / 2, bw, bh, bh * 0.4)
    x.fill()
    c = cv
  } else {
    const d = Math.max(2, Math.ceil(size * 0.7))
    const [cv, x] = canvas_make(d, d)
    x.fillStyle = rgba(1)
    x.beginPath()
    x.arc(d / 2, d / 2, d / 2, 0, Math.PI * 2)
    x.fill()
    c = cv
  }
  tips.set(key, c)
  if (tips.size > 128) {
    const oldest = tips.keys().next().value as string | undefined
    if (oldest !== undefined) tips.delete(oldest)
  }
  return c
}

function spacing(brush: number, size: number): number {
  const r = Math.max(1, size / 2)
  if (brush === B_AIRBRUSH) return Math.max(1, r * 0.35)
  if (brush === B_DOTS) return Math.max(5, size * 1.4)
  if (brush === B_WATER) return Math.max(1, r * 0.45)
  if (brush === B_MARKER) return Math.max(0.8, r * 0.3)
  if (brush === B_PENCIL) return Math.max(0.8, r * 0.4)
  if (brush === B_CRAYON) return Math.max(0.9, r * 0.42)
  if (brush === B_NEON) return Math.max(0.8, r * 0.3)
  if (brush === B_CHALK) return Math.max(0.9, r * 0.45)
  if (brush === B_SPAT) return Math.max(6, size * 1.1)
  if (brush === B_RIBBON) return Math.max(0.8, r * 0.3)
  return Math.max(0.8, r * 0.35)
}

let raw: number[][] = []
let consumedLen = 0
let carry = 0
let bufC: HTMLCanvasElement | null = null
let bufX: CanvasRenderingContext2D | null = null
let rawDirty = 0
const RAW_LIMIT = 512
const RAW_TAIL = 192

function buf(): CanvasRenderingContext2D {
  const g = st()
  if (!bufC || bufC.width !== g.doc.w || bufC.height !== g.doc.h) {
    const [c, x] = canvas_make(g.doc.w, g.doc.h)
    bufC = c
    bufX = x
  }
  return bufX as CanvasRenderingContext2D
}

function centerline(): number[][] {
  const sm = st().pen.smooth
  const sp = getStrokePoints(raw, {
    smoothing: clamp(0.35 + sm * 0.12, 0, 0.95),
    streamline: clamp(0.2 + sm * 0.13, 0, 0.9),
  })
  const out: number[][] = []
  for (const p of sp) out.push([p.point[0], p.point[1]])
  return out
}

function stamp_at(ctx: CanvasRenderingContext2D, tip: HTMLCanvasElement, x: number, y: number, jitterRot: number, box: number[]): void {
  const tw = tip.width
  const th = tip.height
  if (jitterRot) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rnd() * Math.PI * 2)
    ctx.drawImage(tip, -tw / 2, -th / 2)
    ctx.restore()
  } else {
    ctx.drawImage(tip, x - tw / 2, y - th / 2)
  }
  const pad = Math.max(tw, th) / 2 + 2
  if (x - pad < box[0]) box[0] = x - pad
  if (y - pad < box[1]) box[1] = y - pad
  if (x + pad > box[2]) box[2] = x + pad
  if (y + pad > box[3]) box[3] = y + pad
}

function mirror_pts(x: number, y: number): number[][] {
  const g = st()
  const out: number[][] = [[x, y]]
  if (g.pen.sym) out.push([g.doc.w - x, y])
  if (g.pen.symy) out.push([x, g.doc.h - y])
  if (g.pen.sym && g.pen.symy) out.push([g.doc.w - x, g.doc.h - y])
  return out
}

export function brush_begin(x: number, y: number, p: number): void {
  const g = st()
  raw = [[x, y, p || 0.5]]
  consumedLen = 0
  carry = 0
  rawDirty = 0
  if (buffered(g.pen.brush)) {
    const bx = buf()
    bx.clearRect(0, 0, g.doc.w, g.doc.h)
  }
  brush_step(1)
}

export function brush_point(x: number, y: number, p: number): void {
  const last = raw[raw.length - 1]
  const minDist = Math.max(0.2, 0.55 / st().view.z)
  const dx = x - last[0]
  const dy = y - last[1]
  if (dx * dx + dy * dy < minDist * minDist) {
    last[2] = p || last[2]
    return
  }
  raw.push([x, y, p || 0.5])
  rawDirty = 1
}

let lastEmit: number[] = [0, 0, 0, 0]

function brush_step(first: number): void {
  const g = st()
  const brush = g.pen.brush
  const cl = centerline()
  if (!cl.length) return
  const sp = spacing(brush, g.pen.size)
  const tipVar = brush === B_SPAT ? (rnd() * 4) | 0 : 0
  const tip = tip_get(brush, g.pen.size, g.pen.color, tipVar)
  const target: CanvasRenderingContext2D = buffered(brush) ? buf() : live_slot(g.pen.layer)
  const jitter = brush === B_CRAYON || brush === B_PENCIL || brush === B_CHALK || brush === B_SPAT ? 1 : 0
  const box: number[] = [g.doc.w, g.doc.h, -1, -1]
  target.save()
  if (!buffered(brush)) target.globalAlpha = clamp(g.pen.alpha, 0, 1) * (brush === B_AIRBRUSH ? 1 : brush === B_PENCIL ? 0.9 : 1)
  let i = Math.max(1, consumedLen)
  if (first) {
    for (const mp of mirror_pts(cl[0][0], cl[0][1])) stamp_at(target, tip, mp[0], mp[1], jitter, box)
  }
  for (; i < cl.length; i++) {
    const ax = cl[i - 1][0]
    const ay = cl[i - 1][1]
    const bx2 = cl[i][0]
    const by2 = cl[i][1]
    const dx = bx2 - ax
    const dy = by2 - ay
    const len = Math.hypot(dx, dy)
    if (len < 0.0001) continue
    let d = carry
    while (d <= len) {
      const px = ax + (dx * d) / len
      const py = ay + (dy * d) / len
      const tp = brush === B_SPAT ? tip_get(brush, g.pen.size, g.pen.color, (rnd() * 4) | 0) : tip
      for (const mp of mirror_pts(px, py)) stamp_at(target, tp, mp[0], mp[1], jitter, box)
      d += sp
    }
    carry = d - len
  }
  consumedLen = cl.length
  if (raw.length > RAW_LIMIT) {
    raw = raw.slice(-RAW_TAIL)
    consumedLen = centerline().length
  }
  target.restore()
  if (box[2] >= box[0]) {
    lastEmit = box
  } else {
    lastEmit = [0, 0, -1, -1]
  }
}

export function brush_compose(ctx: CanvasRenderingContext2D, snap: HTMLCanvasElement): number[] | null {
  const g = st()
  if (rawDirty) {
    rawDirty = 0
    brush_step(0)
  }
  if (!buffered(g.pen.brush)) return lastEmit[2] >= lastEmit[0] ? lastEmit.slice() : null
  const x0 = Math.max(0, Math.floor(lastEmit[0]))
  const y0 = Math.max(0, Math.floor(lastEmit[1]))
  const x1 = Math.min(g.doc.w - 1, Math.ceil(lastEmit[2]))
  const y1 = Math.min(g.doc.h - 1, Math.ceil(lastEmit[3]))
  if (x1 < x0 || y1 < y0) return null
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  ctx.clearRect(x0, y0, w, h)
  ctx.drawImage(snap, x0, y0, w, h, x0, y0, w, h)
  ctx.save()
  ctx.globalAlpha = (g.pen.brush === B_MARKER ? 0.5 : 0.85) * clamp(g.pen.alpha, 0, 1)
  ctx.drawImage(bufC as HTMLCanvasElement, x0, y0, w, h, x0, y0, w, h)
  ctx.restore()
  return [x0, y0, x1, y1]
}

export function brush_buffered_now(): number {
  return buffered(st().pen.brush)
}
