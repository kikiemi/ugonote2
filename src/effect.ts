import { toast } from './dom'
import { live_slot } from './engine'
import { EF_BLUR, EF_MOSAIC, EF_GLOW, EF_CHROMA, EF_NOISE, EF_OUTLINE, EF_WAVE } from './h'
import { hist_grp, rect_grab } from './hist'
import { hex_rgb, clamp, canvas_make } from './lib'
import { sfx_play } from './snd'
import { dispatch } from './state/commands'
import { st } from './state/store'

export type EffectRegion = { x: number, y: number, w: number, h: number }
export type EffectCapture = { reg: EffectRegion, src: ImageData }

function target_region(): EffectRegion {
  const g = st()
  if (g.sel.has) {
    return { x: g.sel.x, y: g.sel.y, w: g.sel.w, h: g.sel.h }
  }
  return { x: 0, y: 0, w: g.doc.w, h: g.doc.h }
}

function blur_rgba(src: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
  const r = Math.max(1, Math.round(radius))
  const tmp = new Float32Array(w * h * 4)
  const out = new Uint8ClampedArray(w * h * 4)
  const div = r * 2 + 1
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0
      for (let k = -r; k <= r; k++) sum += src[(y * w + clamp(k, 0, w - 1)) * 4 + c]
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 4 + c] = sum / div
        const add = src[(y * w + clamp(x + r + 1, 0, w - 1)) * 4 + c]
        const rem = src[(y * w + clamp(x - r, 0, w - 1)) * 4 + c]
        sum += add - rem
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0
      for (let k = -r; k <= r; k++) sum += tmp[(clamp(k, 0, h - 1) * w + x) * 4 + c]
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 4 + c] = sum / div
        const add = tmp[(clamp(y + r + 1, 0, h - 1) * w + x) * 4 + c]
        const rem = tmp[(clamp(y - r, 0, h - 1) * w + x) * 4 + c]
        sum += add - rem
      }
    }
  }
  return out
}

function apply_blur(d: Uint8ClampedArray, w: number, h: number, amt: number): Uint8ClampedArray {
  return blur_rgba(d, w, h, 1 + amt * 6)
}

function apply_mosaic(d: Uint8ClampedArray, w: number, h: number, amt: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d.length)
  const cell = Math.max(2, Math.round(2 + amt * 22))
  for (let by = 0; by < h; by += cell) {
    for (let bx = 0; bx < w; bx += cell) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let y = by; y < Math.min(h, by + cell); y++) {
        for (let x = bx; x < Math.min(w, bx + cell); x++) {
          const i = (y * w + x) * 4
          r += d[i]
          g += d[i + 1]
          b += d[i + 2]
          a += d[i + 3]
          n++
        }
      }
      r /= n
      g /= n
      b /= n
      a /= n
      for (let y = by; y < Math.min(h, by + cell); y++) {
        for (let x = bx; x < Math.min(w, bx + cell); x++) {
          const i = (y * w + x) * 4
          out[i] = r
          out[i + 1] = g
          out[i + 2] = b
          out[i + 3] = a
        }
      }
    }
  }
  return out
}

function apply_glow(d: Uint8ClampedArray, w: number, h: number, amt: number): Uint8ClampedArray {
  const blurred = blur_rgba(d, w, h, 2 + amt * 8)
  const out = new Uint8ClampedArray(d.length)
  const k = 0.5 + amt * 0.9
  for (let i = 0; i < d.length; i += 4) {
    const ba = blurred[i + 3] / 255
    out[i] = clamp(d[i] + blurred[i] * ba * k, 0, 255)
    out[i + 1] = clamp(d[i + 1] + blurred[i + 1] * ba * k, 0, 255)
    out[i + 2] = clamp(d[i + 2] + blurred[i + 2] * ba * k, 0, 255)
    out[i + 3] = clamp(d[i + 3] + blurred[i + 3] * k * 0.4, 0, 255)
  }
  return out
}

function apply_chroma(d: Uint8ClampedArray, w: number, h: number, amt: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d.length)
  const off = Math.max(1, Math.round(1 + amt * 10))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const rx = clamp(x - off, 0, w - 1)
      const bx = clamp(x + off, 0, w - 1)
      out[i] = d[(y * w + rx) * 4]
      out[i + 1] = d[i + 1]
      out[i + 2] = d[(y * w + bx) * 4 + 2]
      out[i + 3] = d[i + 3]
    }
  }
  return out
}

function apply_noise(d: Uint8ClampedArray, _w: number, _h: number, amt: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d)
  const str = amt * 120
  let seed = 0x9e3779b9
  const rnd = (): number => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return ((seed >>> 0) % 100000) / 100000 - 0.5
  }
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] < 8) continue
    const n = rnd() * str
    out[i] = clamp(out[i] + n, 0, 255)
    out[i + 1] = clamp(out[i + 1] + n, 0, 255)
    out[i + 2] = clamp(out[i + 2] + n, 0, 255)
  }
  return out
}

function apply_outline(d: Uint8ClampedArray, w: number, h: number, amt: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d.length)
  const th = 0.15 + (1 - amt) * 0.5
  const [lr, lg, lb] = hex_rgb(st().pen.color)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const a = d[i + 3] / 255
      const ax = d[(y * w + clamp(x + 1, 0, w - 1)) * 4 + 3] / 255
      const ay = d[(clamp(y + 1, 0, h - 1) * w + x) * 4 + 3] / 255
      const grad = Math.abs(a - ax) + Math.abs(a - ay)
      if (grad > th) {
        out[i] = lr
        out[i + 1] = lg
        out[i + 2] = lb
        out[i + 3] = 255
      }
    }
  }
  return out
}

function apply_wave(d: Uint8ClampedArray, w: number, h: number, amt: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d.length)
  const amp = 1 + amt * 14
  const freq = 0.05 + amt * 0.05
  for (let y = 0; y < h; y++) {
    const sh = Math.round(Math.sin(y * freq) * amp)
    for (let x = 0; x < w; x++) {
      const sx = clamp(x + sh, 0, w - 1)
      const i = (y * w + x) * 4
      const si = (y * w + sx) * 4
      out[i] = d[si]
      out[i + 1] = d[si + 1]
      out[i + 2] = d[si + 2]
      out[i + 3] = d[si + 3]
    }
  }
  return out
}

function run(kind: number, d: Uint8ClampedArray, w: number, h: number, amt: number): Uint8ClampedArray {
  if (kind === EF_BLUR) return apply_blur(d, w, h, amt)
  if (kind === EF_MOSAIC) return apply_mosaic(d, w, h, amt)
  if (kind === EF_GLOW) return apply_glow(d, w, h, amt)
  if (kind === EF_CHROMA) return apply_chroma(d, w, h, amt)
  if (kind === EF_NOISE) return apply_noise(d, w, h, amt)
  if (kind === EF_OUTLINE) return apply_outline(d, w, h, amt)
  if (kind === EF_WAVE) return apply_wave(d, w, h, amt)
  return d
}

export function effect_capture(maxSide = 0): EffectCapture | null {
  const reg = target_region()
  if (reg.w < 1 || reg.h < 1) return null
  const ctx = live_slot(st().pen.layer)
  if (maxSide > 0 && (reg.w > maxSide || reg.h > maxSide)) {
    const scale = Math.min(maxSide / reg.w, maxSide / reg.h)
    const w = Math.max(1, Math.round(reg.w * scale))
    const h = Math.max(1, Math.round(reg.h * scale))
    const [, out] = canvas_make(w, h, 1)
    out.imageSmoothingEnabled = true
    out.drawImage(ctx.canvas, reg.x, reg.y, reg.w, reg.h, 0, 0, w, h)
    return { reg: { x: 0, y: 0, w, h }, src: out.getImageData(0, 0, w, h) }
  }
  return { reg, src: ctx.getImageData(reg.x, reg.y, reg.w, reg.h) }
}

export function effect_preview(kind: number, amt: number, capture: EffectCapture | null = effect_capture()): { reg: EffectRegion, img: ImageData } | null {
  if (!capture) return null
  const { reg, src } = capture
  const ctx = live_slot(st().pen.layer)
  const outData = run(kind, src.data, reg.w, reg.h, clamp(amt, 0, 1))
  const img = ctx.createImageData(reg.w, reg.h)
  img.data.set(outData)
  return { reg, img }
}

export function effect_apply(kind: number, amt: number): void {
  const g = st()
  const reg = target_region()
  if (reg.w < 1 || reg.h < 1) return
  const l = g.pen.layer
  const ctx = live_slot(l)
  const before = rect_grab(l, reg.x, reg.y, reg.w, reg.h)
  const src = ctx.getImageData(reg.x, reg.y, reg.w, reg.h)
  const outData = run(kind, src.data, reg.w, reg.h, clamp(amt, 0, 1))
  const outImg = ctx.createImageData(reg.w, reg.h)
  outImg.data.set(outData)
  ctx.putImageData(outImg, reg.x, reg.y)
  if (dispatch('frame.commit_pixels', {
    grp: hist_grp(),
    frame: g.doc.cur,
    changes: [{ layer: l, x: reg.x, y: reg.y, w: reg.w, h: reg.h, before }],
  }) < 0) {
    ctx.putImageData(src, reg.x, reg.y)
    return
  }
  toast(g.sel.has ? '選択範囲にエフェクトをかけました' : 'レイヤー全体にエフェクトをかけました')
  sfx_play('paper')
}
