import { live_make, live_slot, live_canvas } from './engine'
import { L_N, L_P, ERR_OK, ERR_FULL, ERR_BAD, type Frame, type Rle } from './h'
import { rle_pack, rle_unpack, canvas_make } from './lib'
import { mode_allows_layer_alpha, mode_frame_limit, mode_order } from './mode'
import { st, type DeepRO, type Globals } from './state/store'

const cache: Map<Rle, HTMLCanvasElement> = new Map()

function cache_cap(g: DeepRO<Globals>): number {
  const budget = g.mobile ? 24 << 20 : 64 << 20
  const per = g.doc.w * g.doc.h * 4
  const n = Math.floor(budget / per)
  return n < 8 ? 8 : n > 96 ? 96 : n
}

export function doc_cache_clear(): void {
  cache.clear()
}

let frameIdSeq = 1

export function doc_frame_new(): Frame {
  return { id: frameIdSeq++, se: 0, hold: 1, pk: new Array<Rle | null>(L_N).fill(null) }
}

function loop_order(g: Globals): void {
  if (g.doc.loopA >= 0 && g.doc.loopB >= 0 && g.doc.loopA > g.doc.loopB) {
    const t = g.doc.loopA
    g.doc.loopA = g.doc.loopB
    g.doc.loopB = t
  }
}

export function doc_loop_insert(g: Globals, at: number, count = 1): void {
  if (count < 1) return
  if (g.doc.loopA >= at) g.doc.loopA += count
  if (g.doc.loopB >= at) g.doc.loopB += count
}

export function doc_loop_delete(g: Globals, at: number, count = 1): void {
  if (count < 1) return
  const end = at + count
  const move = (v: number): number => v < 0 || v < at ? v : v < end ? -1 : v - count
  g.doc.loopA = move(g.doc.loopA)
  g.doc.loopB = move(g.doc.loopB)
  loop_order(g)
}

export function doc_loop_move(g: Globals, from: number, to: number): void {
  const move = (v: number): number => {
    if (v < 0) return v
    if (v === from) return to
    if (from < to && v > from && v <= to) return v - 1
    if (to < from && v >= to && v < from) return v + 1
    return v
  }
  g.doc.loopA = move(g.doc.loopA)
  g.doc.loopB = move(g.doc.loopB)
  loop_order(g)
}

export function doc_frame_clone(f: DeepRO<Frame>): Frame {
  return { id: frameIdSeq++, se: f.se, hold: f.hold, pk: f.pk.map(p => (p ? p.slice() : null)) }
}

export function frame_id_next(): number {
  return frameIdSeq++
}

export function frame_id_seed(minNext: number): void {
  if (minNext > frameIdSeq) frameIdSeq = minNext
}

export function pack_canvas(c: HTMLCanvasElement, x: CanvasRenderingContext2D): Rle | null {
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

export function doc_unpack_to(pk: Rle | null, ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h)
  if (!pk) return
  const img = ctx.createImageData(w, h)
  const words = new Uint32Array(img.data.buffer)
  if (rle_unpack(pk, words) !== w * h) return
  ctx.putImageData(img, 0, 0)
}

export function doc_pack_live(g: Globals): void {
  const f = g.doc.frames[g.doc.cur]
  if (!f) return
  for (let l = 0; l < L_N; l++) f.pk[l] = pack_canvas(live_canvas(l), live_slot(l))
}

export function doc_unpack_live(g: DeepRO<Globals> = st()): void {
  const f = g.doc.frames[g.doc.cur]
  if (!f) return
  for (let l = 0; l < L_N; l++) doc_unpack_to(f.pk[l], live_slot(l), g.doc.w, g.doc.h)
}

export function doc_pack_layer(g: Globals, l: number): void {
  const f = g.doc.frames[g.doc.cur]
  if (!f || l < 0 || l >= L_N) return
  f.pk[l] = pack_canvas(live_canvas(l), live_slot(l))
}

export function doc_layer_canvas(i: number, l: number): HTMLCanvasElement | null {
  const g = st()
  if (i === g.doc.cur) {
    if (!g.doc.frames[i]) return null
    return live_canvas(l)
  }
  const f = g.doc.frames[i]
  if (!f) return null
  const pk = f.pk[l]
  if (!pk) return null
  const hit = cache.get(pk)
  if (hit) {
    cache.delete(pk)
    cache.set(pk, hit)
    return hit
  }
  const [c, x] = canvas_make(g.doc.w, g.doc.h)
  doc_unpack_to(pk, x, g.doc.w, g.doc.h)
  cache.set(pk, c)
  if (cache.size > cache_cap(g)) {
    const first = cache.keys().next().value as Rle
    cache.delete(first)
  }
  return c
}

export function doc_compose(i: number, ctx: CanvasRenderingContext2D, w: number, h: number, withPaper: number): void {
  const g = st()
  if (withPaper) {
    ctx.fillStyle = g.doc.paper
    ctx.fillRect(0, 0, w, h)
  } else {
    ctx.clearRect(0, 0, w, h)
  }
  ctx.imageSmoothingEnabled = w < g.doc.w
  const draw = (l: number): void => {
    if (!g.doc.lvis[l]) return
    const c = doc_layer_canvas(i, l)
    if (!c) return
    ctx.globalAlpha = mode_allows_layer_alpha(g.doc.mode) ? g.doc.lalpha[l] / 255 : 1
    ctx.drawImage(c, 0, 0, w, h)
  }
  draw(L_P)
  const ord = mode_order(g.doc.mode, g.doc.lord)
  for (let k = ord.length - 1; k >= 0; k--) draw(ord[k])
  ctx.globalAlpha = 1
}

export function doc_goto(g: Globals, i: number): number {
  const n = g.doc.frames.length
  if (i < 0 || i >= n) return ERR_BAD
  if (i === g.doc.cur) return ERR_OK
  doc_pack_live(g)
  g.doc.cur = i
  doc_unpack_live(g)
  return ERR_OK
}

export function doc_frame_insert(g: Globals, at: number, f: Frame): number {
  if (g.doc.frames.length >= mode_frame_limit(g.doc.mode)) return ERR_FULL
  const i = at < 0 ? 0 : at > g.doc.frames.length ? g.doc.frames.length : at
  doc_pack_live(g)
  g.doc.frames.splice(i, 0, f)
  doc_loop_insert(g, i)
  g.doc.cur = i
  doc_unpack_live(g)
  return ERR_OK
}

export function doc_frame_delete(g: Globals, i: number): Frame | null {
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

export function doc_frame_move(g: Globals, a: number, b: number): number {
  const n = g.doc.frames.length
  if (a < 0 || a >= n || b < 0 || b >= n || a === b) return ERR_BAD
  doc_pack_live(g)
  const f = g.doc.frames.splice(a, 1)[0]
  g.doc.frames.splice(b, 0, f)
  doc_loop_move(g, a, b)
  g.doc.cur = b
  doc_unpack_live(g)
  return ERR_OK
}

export function doc_frame_snap(g: Globals, i: number): Frame {
  if (i === g.doc.cur) doc_pack_live(g)
  const f = g.doc.frames[i]
  return { id: f.id, se: f.se, hold: f.hold, pk: f.pk.map(p => (p ? p.slice() : null)) }
}

export function doc_frame_restore(g: Globals, i: number, snap: DeepRO<Frame>): void {
  g.doc.frames[i] = doc_frame_clone(snap)
  if (i === g.doc.cur) doc_unpack_live(g)
}

export function doc_boot_size(g: DeepRO<Globals> = st()): void {
  live_make(g.doc.w, g.doc.h)
  doc_cache_clear()
}

export function doc_crop_frames(frames: Frame[], ow: number, oh: number, ox: number, oy: number, nw: number, nh: number): void {
  if (ow < 1 || oh < 1 || nw < 1 || nh < 1 || ox < 0 || oy < 0 || ox + nw > ow || oy + nh > oh) return
  const [sc, sx] = canvas_make(ow, oh, 1)
  const [dc, dx] = canvas_make(nw, nh, 1)
  for (const f of frames) {
    for (let l = 0; l < L_N; l++) {
      const pk = f.pk[l]
      if (!pk) continue
      doc_unpack_to(pk, sx, ow, oh)
      dx.clearRect(0, 0, nw, nh)
      dx.drawImage(sc, ox, oy, nw, nh, 0, 0, nw, nh)
      f.pk[l] = pack_canvas(dc, dx)
    }
  }
}

export function doc_resize(g: Globals, nw: number, nh: number, ratio: string, res: string): void {
  doc_pack_live(g)
  const ow = g.doc.w
  const oh = g.doc.h
  const [sc, sx] = canvas_make(ow, oh, 1)
  const [dc, dx] = canvas_make(nw, nh, 1)
  for (const f of g.doc.frames) {
    for (let l = 0; l < L_N; l++) {
      const pk = f.pk[l]
      if (!pk) continue
      doc_unpack_to(pk, sx, ow, oh)
      dx.clearRect(0, 0, nw, nh)
      dx.imageSmoothingEnabled = true
      const k = Math.max(nw / ow, nh / oh)
      const dw = Math.round(ow * k)
      const dh = Math.round(oh * k)
      dx.drawImage(sc, 0, 0, ow, oh, (nw - dw) >> 1, (nh - dh) >> 1, dw, dh)
      f.pk[l] = pack_canvas(dc, dx)
    }
  }
  g.doc.w = nw
  g.doc.h = nh
  g.doc.ratio = ratio
  g.doc.res = res
  doc_boot_size(g)
  doc_unpack_live(g)
}

export function doc_transform_all(g: Globals, op: (c: HTMLCanvasElement) => HTMLCanvasElement, swaps: number): void {
  doc_pack_live(g)
  const ow = g.doc.w
  const oh = g.doc.h
  const nw = swaps ? oh : ow
  const nh = swaps ? ow : oh
  const [sc, sx] = canvas_make(ow, oh, 1)
  for (const f of g.doc.frames) {
    for (let l = 0; l < L_N; l++) {
      const pk = f.pk[l]
      if (!pk) continue
      doc_unpack_to(pk, sx, ow, oh)
      const out = op(sc)
      const ox = out.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
      f.pk[l] = pack_canvas(out, ox)
    }
  }
  if (swaps) {
    g.doc.w = nw
    g.doc.h = nh
    const r = g.doc.ratio.split(':')
    if (r.length === 2) g.doc.ratio = r[1] + ':' + r[0]
    doc_boot_size(g)
  }
  doc_cache_clear()
  doc_unpack_live(g)
}

export function doc_est_bytes(): number {
  let sum = 0
  for (const f of st().doc.frames) for (const pk of f.pk) if (pk) sum += pk.byteLength
  return sum
}
