import type { globals_t } from './state/store'
import { mode_normal, type rle_t } from './h'
import { rotation_axes } from './lib'
import { pixel_bounds } from './pixel'
import { memory_budget } from './memory'

export type canvas_transform_t = { angle: number, smooth: number, scale: number, dx: number, dy: number, source: (rle_t | null)[][] }
type transform_cache_t = { doc: globals_t['doc'], w: number, h: number, mode: number, all: number, kind: string, factor: number, ids: number[], source: (rle_t | null)[][], after: (rle_t | null)[][], angle: number }
let cache: transform_cache_t | null = null

export function canvas_transform_clear(): void { cache = null }

export function canvas_transform_prepare(g: globals_t, value: number, all: number, kind: 'rotate' | 'scale'): canvas_transform_t {
  const frames = all ? g.doc.frames : [g.doc.frames[g.doc.cur]]
  let reuse = cache !== null && cache.doc === g.doc && cache.w === g.doc.w && cache.h === g.doc.h && cache.mode === g.doc.mode && cache.all === all && cache.kind === kind && cache.ids.length === frames.length
  if (reuse && cache) for (let i = 0; i < frames.length; i++) {
    if (cache.ids[i] !== frames[i].id || cache.after[i].length !== frames[i].pk.length) reuse = false
    else for (let l = 0; l < frames[i].pk.length; l++) if (cache.after[i][l] !== frames[i].pk[l]) reuse = false
  }
  if (!reuse) cache = { doc: g.doc, w: g.doc.w, h: g.doc.h, mode: g.doc.mode, all, kind, factor: 1, ids: frames.map(f => f.id), source: frames.map(f => f.pk.slice()), after: [], angle: 0 }
  const active = cache!
  if (kind === 'scale') {
    active.factor *= value
    if (Math.abs(active.factor - 1) < 0.0000000001) active.factor = 1
  }
  else active.angle = Math.round((((active.angle + value) % 360 + 360) % 360) * 1000000) / 1000000
  if (active.angle === 360) active.angle = 0
  const plan: canvas_transform_t = { angle: active.angle, smooth: g.doc.mode === mode_normal ? 1 : 0, scale: 1, dx: 0, dy: 0, source: active.source }
  if (kind === 'scale') { plan.scale = active.factor; return plan }
  if (!active.angle) return plan
  const [cos, sin] = rotation_axes(active.angle)
  const cx = g.doc.w / 2, cy = g.doc.h / 2
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const packed of active.source) for (const image of packed) {
    const rect = pixel_bounds(image, g.doc.w, g.doc.h)
    if (!rect) continue
    for (const x of [rect.x, rect.x + rect.w]) for (const y of [rect.y, rect.y + rect.h]) {
      const rx = (x - cx) * cos - (y - cy) * sin
      const ry = (x - cx) * sin + (y - cy) * cos
      x0 = Math.min(x0, rx); x1 = Math.max(x1, rx)
      y0 = Math.min(y0, ry); y1 = Math.max(y1, ry)
    }
  }
  if (x1 < x0) return plan
  plan.scale = Math.min(1, g.doc.w / (x1 - x0), g.doc.h / (y1 - y0))
  const left = cx + x0 * plan.scale, right = cx + x1 * plan.scale
  const top = cy + y0 * plan.scale, bottom = cy + y1 * plan.scale
  if (left < 0) plan.dx = -left
  else if (right > g.doc.w) plan.dx = g.doc.w - right
  if (top < 0) plan.dy = -top
  else if (bottom > g.doc.h) plan.dy = g.doc.h - bottom
  return plan
}

export function canvas_transform_finish(g: globals_t, all: number): void {
  if (!cache) return
  const seen = new Set<rle_t>()
  let bytes = 0
  for (const packed of cache.source) for (const image of packed) if (image && !seen.has(image)) { seen.add(image); bytes += image.byteLength }
  if (bytes > memory_budget(g.mobile, 'history')) { cache = null; return }
  const frames = all ? g.doc.frames : [g.doc.frames[g.doc.cur]]
  cache.after = frames.map(f => f.pk.slice())
}
