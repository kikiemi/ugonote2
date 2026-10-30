import { anim_seed_mix } from './animset'
import { doc_compose } from './doc'
import { motion_bounce, motion_breathe, motion_camera, motion_float, motion_none, motion_sway, type anim_fx_t } from './h'
import { canvas_make, clamp } from './lib'
import { st } from './state/store'

export type assist_analysis_t = {
  fx: anim_fx_t
  label: string
  detail: string
  occupancy: number
  edge: number
}

export type assist_shift_t = {
  dx: number
  dy: number
  score: number
}

type frame_signal_t = {
  data: Float32Array
  w: number
  h: number
}

function rgba_signal(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const luma = new Float32Array(w * h)
  const alpha = new Float32Array(w * h)
  for (let index = 0; index < w * h; index++) {
    const offset = index * 4
    const a = data[offset + 3] / 255
    alpha[index] = a
    luma[index] = ((data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722) / 255) * a
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : y
    const yp = y + 1 < h ? y + 1 : y
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : x
      const xp = x + 1 < w ? x + 1 : x
      const index = y * w + x
      const edge = Math.abs(luma[y * w + xp] - luma[y * w + xm]) + Math.abs(luma[yp * w + x] - luma[ym * w + x]) + Math.abs(alpha[y * w + xp] - alpha[y * w + xm]) + Math.abs(alpha[yp * w + x] - alpha[ym * w + x])
      out[index] = clamp(alpha[index] * 0.35 + edge * 0.65, 0, 1)
    }
  }
  return out
}

function frame_signal(frame_index: number, w: number, h: number): frame_signal_t {
  const [, context] = canvas_make(w, h, 1)
  doc_compose(frame_index, context, w, h, 0)
  const image = context.getImageData(0, 0, w, h)
  return { data: rgba_signal(image.data, w, h), w, h }
}

function frame_metrics(frame_index: number): { occupancy: number, edge: number, cx: number, cy: number, bx0: number, by0: number, bx1: number, by1: number } {
  const w = 96
  const h = 72
  const [, context] = canvas_make(w, h, 1)
  doc_compose(frame_index, context, w, h, 0)
  const data = context.getImageData(0, 0, w, h).data
  let mass = 0
  let sum_x = 0
  let sum_y = 0
  let edge = 0
  let bx0 = w
  let by0 = h
  let bx1 = -1
  let by1 = -1
  const luma = new Float32Array(w * h)
  const alpha = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = y * w + x
      const offset = index * 4
      const a = data[offset + 3] / 255
      const value = (data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722) / 255
      alpha[index] = a
      luma[index] = value * a
      if (a <= 0.04) continue
      mass += a
      sum_x += x * a
      sum_y += y * a
      if (x < bx0) bx0 = x
      if (y < by0) by0 = y
      if (x > bx1) bx1 = x
      if (y > by1) by1 = y
    }
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const index = y * w + x
      edge += Math.abs(luma[index + 1] - luma[index - 1]) + Math.abs(luma[index + w] - luma[index - w]) + Math.abs(alpha[index + 1] - alpha[index - 1]) + Math.abs(alpha[index + w] - alpha[index - w])
    }
  }
  if (mass <= 0) return { occupancy: 0, edge: 0, cx: 0.5, cy: 0.5, bx0: 0.2, by0: 0.2, bx1: 0.8, by1: 0.8 }
  return {
    occupancy: mass / (w * h),
    edge: clamp(edge / (w * h * 0.8), 0, 1),
    cx: sum_x / mass / (w - 1),
    cy: sum_y / mass / (h - 1),
    bx0: bx0 / w,
    by0: by0 / h,
    bx1: (bx1 + 1) / w,
    by1: (by1 + 1) / h,
  }
}

export function assist_analyze_frame(frame_index: number, base: Readonly<anim_fx_t>): assist_analysis_t {
  const metrics = frame_metrics(frame_index)
  if (metrics.occupancy < 0.002) {
    return {
      fx: { ...base, wiggle: 1, motion: motion_none },
      label: '絵が見つかりません',
      detail: '線や塗りを描いてから使うと、動きと支点を提案できます',
      occupancy: 0,
      edge: 0,
    }
  }
  const width = Math.max(0.05, metrics.bx1 - metrics.bx0)
  const height = Math.max(0.05, metrics.by1 - metrics.by0)
  const aspect = width / height
  let motion = motion_breathe
  let label = '呼吸'
  let detail = '中心を保ったまま、やわらかくふくらませます'
  if (metrics.occupancy > 0.78) {
    motion = motion_camera
    label = '手持ちカメラ'
    detail = '画面全体の絵なので、ごく小さなカメラ揺れにします'
  } else if (aspect < 0.78 && metrics.by1 > 0.68) {
    motion = motion_sway
    label = 'ゆらゆら'
    detail = '縦長で足元がある形なので、下を支点に揺らします'
  } else if (metrics.by1 > 0.84 && metrics.occupancy < 0.58) {
    motion = motion_bounce
    label = 'ぴょこぴょこ'
    detail = '下側に接地した形なので、つぶれを含む跳ね方にします'
  } else if (aspect > 1.35 || metrics.cy < 0.42) {
    motion = motion_float
    label = 'ふわふわ'
    detail = '横長または上寄りの形なので、漂う動きにします'
  }
  const amount = clamp(2.2 + (1 - metrics.occupancy) * 3.2 + metrics.edge * 1.4, 2, 7)
  const wiggle_amount = clamp(1.2 + metrics.edge * 2.4, 1, 3.5)
  const wiggle_cell = clamp(42 - metrics.edge * 22, 16, 42)
  const rate = clamp(1.4 + metrics.edge * 1.3, 1.2, 3.2)
  const frame_id = st().doc.frames[frame_index] ? st().doc.frames[frame_index].id : frame_index + 1
  const seed = anim_seed_mix(frame_id ^ Math.round(metrics.cx * 65535) ^ Math.round(metrics.cy * 0x7fffffff) ^ Math.round(metrics.edge * 0x3fffffff))
  return {
    fx: {
      ...base,
      wiggle: 1,
      wiggle_amount,
      wiggle_cell,
      wiggle_rate: clamp(5 + metrics.edge * 7, 5, 12),
      wiggle_phases: metrics.edge > 0.5 ? 4 : 3,
      wiggle_seed: seed,
      motion,
      motion_amount: amount,
      motion_rate: rate,
      motion_anchor_x: clamp(metrics.cx, 0.15, 0.85),
      motion_anchor_y: clamp(metrics.by1, 0.45, 0.96),
      motion_seed: seed ^ 0x9e3779b9,
    },
    label,
    detail,
    occupancy: metrics.occupancy,
    edge: metrics.edge,
  }
}

function shift_cost(a: frame_signal_t, b: frame_signal_t, dx: number, dy: number): number {
  const x0 = Math.max(0, -dx)
  const y0 = Math.max(0, -dy)
  const x1 = Math.min(a.w, b.w - dx)
  const y1 = Math.min(a.h, b.h - dy)
  if (x1 <= x0 || y1 <= y0) return Infinity
  let sum = 0
  let count = 0
  for (let y = y0; y < y1; y++) {
    const ay = y * a.w
    const by = (y + dy) * b.w
    for (let x = x0; x < x1; x++) {
      sum += Math.abs(a.data[ay + x] - b.data[by + x + dx])
      count++
    }
  }
  const overlap = count / (a.w * a.h)
  return sum / Math.max(1, count) + (1 - overlap) * 0.15
}

export function assist_estimate_shift(frame_a: number, frame_b: number): assist_shift_t {
  const g = st()
  const w = 72
  const h = Math.max(36, Math.round(w * g.doc.h / g.doc.w))
  const a = frame_signal(frame_a, w, h)
  const b = frame_signal(frame_b, w, h)
  const max_x = 9
  const max_y = 7
  let best_x = 0
  let best_y = 0
  let best = shift_cost(a, b, 0, 0)
  for (let dy = -max_y; dy <= max_y; dy++) {
    for (let dx = -max_x; dx <= max_x; dx++) {
      const cost = shift_cost(a, b, dx, dy)
      if (cost >= best) continue
      best = cost
      best_x = dx
      best_y = dy
    }
  }
  return { dx: best_x * g.doc.w / w, dy: best_y * g.doc.h / h, score: best }
}
