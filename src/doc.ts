import { pixel_source_prepare, pixel_source_is } from './pixel_source'
import { canvas_rebuild } from './canvas_rebuild'
import { live_make, live_slot, live_bind, live_peek, live_changed, live_accept } from './engine'
import { l_n, l_p, mode_dsi, mode_normal, err_ok, err_full, err_bad, type frame_t, type rle_t } from './h'
import { rle_pack, rle_unpack, canvas_make } from './lib'
import { pixel_patch, pixel_at, type pixel_rect_t } from './pixel'
import { cache_clear, memory_budget, memory_check, memory_work_budget } from './memory'
import { raster_cache, raster_get, raster_release, type raster_t } from './raster'
import { render_layers, type render_layer_t } from './render'
import { kwz_frame_meta_clone } from './codec/kwzmeta'
import { mode_allows_layer_alpha, mode_frame_limit, mode_order } from './mode'
import { st, type deep_ro_t, type globals_t } from './state/store'

const cache = raster_cache()

export function doc_cache_clear(): void {
  cache_clear(cache)
}

let frame_id_seq = 1

export function doc_frame_new(): frame_t {
  return { id: frame_id_seq++, se: 0, hold: 1, pk: new Array<rle_t | null>(l_n).fill(null) }
}

function loop_order(g: globals_t): void {
  if (g.doc.loop_a >= 0 && g.doc.loop_b >= 0 && g.doc.loop_a > g.doc.loop_b) {
    const t = g.doc.loop_a
    g.doc.loop_a = g.doc.loop_b
    g.doc.loop_b = t
  }
}

export function doc_loop_insert(g: globals_t, at: number, count = 1): void {
  if (count < 1) return
  if (g.doc.loop_a >= at) g.doc.loop_a += count
  if (g.doc.loop_b >= at) g.doc.loop_b += count
}

export function doc_loop_delete(g: globals_t, at: number, count = 1): void {
  if (count < 1) return
  const end = at + count
  const move = (v: number): number => v < 0 || v < at ? v : v < end ? -1 : v - count
  g.doc.loop_a = move(g.doc.loop_a)
  g.doc.loop_b = move(g.doc.loop_b)
  loop_order(g)
}

export function doc_loop_move(g: globals_t, from: number, to: number): void {
  const move = (v: number): number => {
    if (v < 0) return v
    if (v === from) return to
    if (from < to && v > from && v <= to) return v - 1
    if (to < from && v >= to && v < from) return v + 1
    return v
  }
  g.doc.loop_a = move(g.doc.loop_a)
  g.doc.loop_b = move(g.doc.loop_b)
  loop_order(g)
}

export function doc_frame_clone(f: deep_ro_t<frame_t>): frame_t {
  return { id: frame_id_seq++, se: f.se, hold: f.hold, paper: f.paper, kwz: kwz_frame_meta_clone(f.kwz), pk: [...f.pk] }
}

export function frame_id_next(): number {
  return frame_id_seq++
}

export function frame_id_seed(min_next: number): void {
  if (min_next > frame_id_seq) frame_id_seq = min_next
}

export function pack_canvas(c: HTMLCanvasElement, x: CanvasRenderingContext2D): rle_t | null {
  const img = x.getImageData(0, 0, c.width, c.height)
  let any = 0
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] !== 0) {
      any = 1
      break
    }
  }
  if (!any) return null
  return rle_pack(new Uint32Array(img.data.buffer))
}

export function doc_unpack_to(pk: rle_t | null, ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h)
  if (!pk) return
  const img = ctx.createImageData(w, h)
  const words = new Uint32Array(img.data.buffer)
  if (rle_unpack(pk, words) !== w * h) return
  ctx.putImageData(img, 0, 0)
}

export function doc_pack_live(g: globals_t): void {
  const f = g.doc.frames[g.doc.cur]
  if (!f) return
  for (let l = 0; l < l_n; l++) if (live_changed(l)) doc_pack_layer(g, l)
}

export function doc_unpack_live(g: deep_ro_t<globals_t> = st()): void {
  const f = g.doc.frames[g.doc.cur]
  if (f) { live_bind(f.pk); void pixel_source_prepare(f.pk).catch(() => {}) }
}

export function doc_pack_layer(g: globals_t, l: number, rect?: pixel_rect_t): void {
  const f = g.doc.frames[g.doc.cur]
  if (!f || l < 0 || l >= l_n) return
  const ctx = live_slot(l)
  if (rect) {
    const image = ctx.getImageData(rect.x, rect.y, rect.w, rect.h)
    f.pk[l] = pixel_patch(f.pk[l], g.doc.w, g.doc.h, rect.x, rect.y, rect.w, rect.h, new Uint32Array(image.data.buffer))
  } else f.pk[l] = pack_canvas(ctx.canvas, ctx)
  live_accept(l, f.pk[l])
}

function layer_raster(i: number, l: number): raster_t | null {
  const g = st()
  const frame = g.doc.frames[i]
  if (!frame) return null
  if (i === g.doc.cur) {
    const live = live_peek(l)
    if (live) return { canvas: live, x: 0, y: 0 }
  }
  const pk = frame.pk[l]
  if (!pk) return null
  return raster_get(cache, pk, g.doc.w, g.doc.h, memory_budget(g.mobile, 'raster'))
}

export function doc_layer_pixel(i: number, l: number, x: number, y: number): number {
  const g = st()
  if (i === g.doc.cur) {
    const canvas = live_peek(l)
    if (canvas) return new Uint32Array((canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(x, y, 1, 1).data.buffer)[0]
  }
  return pixel_at(g.doc.frames[i]?.pk[l] || null, y * g.doc.w + x)
}

export function doc_layer_canvas(i: number, l: number): HTMLCanvasElement | null {
  const g = st()
  const raster = layer_raster(i, l)
  if (!raster) return null
  const [canvas, context] = canvas_make(g.doc.w, g.doc.h)
  try { context.drawImage(raster.canvas, raster.x, raster.y) }
  finally { raster_release(raster) }
  return canvas
}

export function doc_frame_paper(i: number): string {
  const g = st()
  return g.doc.frames[i]?.paper || g.doc.paper
}

export function doc_frame_order(i: number): number[] {
  const g = st()
  const order = mode_order(g.doc.mode, g.doc.lord)
  const meta = g.doc.mode !== mode_dsi ? g.doc.frames[i]?.kwz : undefined
  if (!meta) return order
  const native = order.filter(layer => layer >= 1 && layer <= 3).sort((a, b) => meta.depth[a - 1] - meta.depth[b - 1])
  let index = 0
  return order.map(layer => layer >= 1 && layer <= 3 ? native[index++] : layer)
}

export function doc_render_plan(i: number, with_paper: number, live = 1): import('./render').render_plan_t {
  const g = st()
  const layers: render_layer_t[] = []
  function add(l: number): void {
    if (!g.doc.lvis[l]) return
    const packed = g.doc.frames[i]?.pk[l] || null
    const image = live && i === g.doc.cur ? live_peek(l) : null
    if (!packed && !image) return
    layers.push({ packed, image, smooth: g.doc.mode === mode_normal && l === l_p ? 1 : 0, alpha: mode_allows_layer_alpha(g.doc.mode) ? g.doc.lalpha[l] / 255 : 1 })
  }
  add(l_p)
  const order = doc_frame_order(i)
  for (let k = order.length - 1; k >= 0; k--) add(order[k])
  return { width: g.doc.w, height: g.doc.h, paper: with_paper ? doc_frame_paper(i) : '', layers }
}

export function doc_compose(i: number, ctx: CanvasRenderingContext2D, w: number, h: number, with_paper: number): number {
  return render_layers(doc_render_plan(i, with_paper), ctx, w, h, cache, memory_budget(st().mobile, 'raster'))
}

export function doc_goto(g: globals_t, i: number): number {
  const n = g.doc.frames.length
  if (i < 0 || i >= n) return err_bad
  if (i === g.doc.cur) return err_ok
  doc_pack_live(g)
  g.doc.cur = i
  doc_unpack_live(g)
  return err_ok
}

export function doc_frame_insert(g: globals_t, at: number, f: frame_t): number {
  if (g.doc.frames.length >= mode_frame_limit(g.doc.mode)) return err_full
  const i = at < 0 ? 0 : at > g.doc.frames.length ? g.doc.frames.length : at
  doc_pack_live(g)
  g.doc.frames.splice(i, 0, f)
  doc_loop_insert(g, i)
  g.doc.cur = i
  doc_unpack_live(g)
  return err_ok
}

export function doc_frame_delete(g: globals_t, i: number): frame_t | null {
  if (g.doc.frames.length <= 1) return null
  if (i < 0 || i >= g.doc.frames.length) return null
  doc_pack_live(g)
  const current = g.doc.frames[g.doc.cur]
  const removed = g.doc.frames.splice(i, 1)[0]
  doc_loop_delete(g, i)
  const keep = g.doc.frames.indexOf(current)
  g.doc.cur = keep >= 0 ? keep : Math.min(i, g.doc.frames.length - 1)
  doc_unpack_live(g)
  return removed
}

export function doc_frame_move(g: globals_t, a: number, b: number): number {
  const n = g.doc.frames.length
  if (a < 0 || a >= n || b < 0 || b >= n || a === b) return err_bad
  doc_pack_live(g)
  const f = g.doc.frames.splice(a, 1)[0]
  g.doc.frames.splice(b, 0, f)
  doc_loop_move(g, a, b)
  g.doc.cur = b
  doc_unpack_live(g)
  return err_ok
}

export function doc_frame_snap(g: globals_t, i: number): frame_t {
  if (i === g.doc.cur) doc_pack_live(g)
  const f = g.doc.frames[i]
  return { id: f.id, se: f.se, hold: f.hold, paper: f.paper, kwz: kwz_frame_meta_clone(f.kwz), pk: [...f.pk] }
}

export function doc_boot_size(g: deep_ro_t<globals_t> = st()): void {
  live_make(g.doc.w, g.doc.h)
  doc_cache_clear()
}

export function doc_crop_frames(frames: frame_t[], ow: number, oh: number, ox: number, oy: number, nw: number, nh: number): void {
  if (ow < 1 || oh < 1 || nw < 1 || nh < 1 || ox < 0 || oy < 0 || ox + nw > ow || oy + nh > oh) return
  const [sc, sx] = canvas_make(ow, oh, 1)
  const [dc, dx] = canvas_make(nw, nh, 1)
  for (const f of frames) {
    for (let l = 0; l < l_n; l++) {
      const pk = f.pk[l]
      if (!pk) continue
      doc_unpack_to(pk, sx, ow, oh)
      dx.clearRect(0, 0, nw, nh)
      dx.drawImage(sc, ox, oy, nw, nh, 0, 0, nw, nh)
      f.pk[l] = pack_canvas(dc, dx)
    }
  }
}

export function doc_resize(g: globals_t, nw: number, nh: number, ratio: string, res: string): void {
  doc_pack_live(g)
  const work = canvas_rebuild({ w: g.doc.w, h: g.doc.h, nw, nh, frames: g.doc.frames })
  for (;;) {
    const result = work.next()
    if (result.done) { g.doc.frames = result.value; break }
  }
  g.doc.w = nw
  g.doc.h = nh
  g.doc.ratio = ratio
  g.doc.res = res
  doc_boot_size(g)
  doc_unpack_live(g)
}

export function doc_transform_all(g: globals_t, op: (c: HTMLCanvasElement) => HTMLCanvasElement, sources?: readonly (readonly (rle_t | null)[])[], packed_op?: (packed: rle_t) => rle_t): void {
  doc_pack_live(g)
  const w = g.doc.w, h = g.doc.h
  const raster_needed = (sources || g.doc.frames.map(frame => frame.pk)).some(packed => packed.some(source => source && !pixel_source_is(source)))
  const budget = memory_work_budget(g.mobile), working = (raster_needed ? w * h * 20 : 0) + doc_est_bytes() * 2
  memory_check(working, budget)
  const surface = raster_needed ? canvas_make(w, h, 1) : null
  const canvas = surface?.[0] || null, context = surface?.[1] || null
  const converted = new Map<rle_t, rle_t | null>()
  const result: (rle_t | null)[][] = []
  let bytes = 0
  try {
    for (let i = 0; i < g.doc.frames.length; i++) {
      const packed = g.doc.frames[i].pk.slice()
      for (let l = 0; l < l_n; l++) {
        const source = sources ? sources[i][l] : packed[l]
        if (!source) { packed[l] = null; continue }
        if (!converted.has(source) && pixel_source_is(source) && packed_op) converted.set(source, packed_op(source))
        if (!converted.has(source)) {
          doc_unpack_to(source, context!, w, h)
          const output = op(canvas!)
          try {
            const raster = output.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
            const next = pack_canvas(output, raster)
            bytes += next?.byteLength || 0
            memory_check(working + bytes, budget)
            converted.set(source, next)
          } finally { if (output !== canvas) output.width = 0 }
        }
        packed[l] = converted.get(source)!
      }
      result.push(packed)
    }
    for (let i = 0; i < result.length; i++) g.doc.frames[i].pk = result[i]
    doc_cache_clear()
    doc_unpack_live(g)
  } finally { if (canvas) canvas.width = 0 }
}

export function doc_est_bytes(): number {
  let sum = 0
  const seen = new Set<rle_t>()
  for (const f of st().doc.frames) for (const pk of f.pk) if (pk && !seen.has(pk)) { seen.add(pk); sum += pk.byteLength }
  return sum
}
