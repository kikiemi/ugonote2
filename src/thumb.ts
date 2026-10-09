import { render_thumbnail_async } from './workercli'
import { memory_budget } from './memory'
import { doc_compose, doc_render_plan } from './doc'
import { D_THUMB, THUMB_W, THUMB_H, type Frame, type Rle } from './h'
import { canvas_make } from './lib'
import { dirty, st, type DeepRO } from './state/store'

type ReadFrame = DeepRO<Frame>

type Th = {
  c: HTMLCanvasElement
  x: CanvasRenderingContext2D
  k: (Rle | null)[]
  vk: string
  rev: number
  pending: number
}

type ThumbnailJob = { frame: ReadFrame, entry: Th, refs: (Rle | null)[], key: string, epoch: number }
const jobs: ThumbnailJob[] = []
let working = 0
let epoch = 0
let revSeq = 1
const cache = new Map<ReadFrame, Th>()
let scratch: HTMLCanvasElement | null = null
let scratchCtx: CanvasRenderingContext2D | null = null

function refs_same(a: readonly (Rle | null)[], b: readonly (Rle | null)[]): number {
  if (a.length !== b.length) return 0
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return 0
  return 1
}

function cache_cap(): number {
  return Math.max(1, Math.floor(memory_budget(st().mobile, 'thumb') / (THUMB_W * THUMB_H * 4)))
}

function vis_key(frame: ReadFrame): string {
  const g = st()
  return g.doc.mode + '|' + (frame.paper || g.doc.paper) + '|' + (frame.kwz?.depth.join(',') || '') + '|' + g.doc.lvis.join(',') + '|' + g.doc.lalpha.join(',') + '|' + g.doc.lord.join(',') + '|' + g.doc.w + 'x' + g.doc.h
}

function scratch_get(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  if (!scratch || !scratchCtx) {
    const created = canvas_make(w, h)
    scratch = created[0]
    scratchCtx = created[1]
  } else if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w
    scratch.height = h
  }
  return [scratch, scratchCtx]
}

export function thumb_get(i: number, background = 0): HTMLCanvasElement | null {
  const g = st()
  const f = g.doc.frames[i]
  if (!f) return null
  const vk = vis_key(f)
  let th = cache.get(f)
  const fresh = th && th.vk === vk && refs_same(th.k, f.pk)
  if (th && fresh) {
    cache.delete(f)
    cache.set(f, th)
    return th.c
  }
  if (!th) {
    const [c, x] = canvas_make(THUMB_W, THUMB_H)
    th = { c, x, k: [], vk: '', rev: 0, pending: 0 }
  } else {
    cache.delete(f)
  }
  if (background && i !== g.doc.cur && typeof OffscreenCanvas !== 'undefined') {
    cache.set(f, th)
    if (!th.pending) {
      th.pending = 1
      jobs.push({ frame: f, entry: th, refs: [...f.pk], key: vk, epoch })
      queue_start()
    }
    cache_trim()
    return th.c
  }
  th.rev = revSeq++
  draw_thumbnail(i, th)
  th.k = [...f.pk]
  th.vk = vk
  cache.set(f, th)
  cache_trim()
  return th.c
}

function cache_trim(): void {
  while (cache.size > cache_cap()) {
    const frame = cache.keys().next().value as ReadFrame
    cache.delete(frame)
  }
}

function queue_start(): void {
  if (working) return
  const job = jobs.shift()
  if (!job) return
  const index = st().doc.frames.indexOf(job.frame as Frame)
  if (index < 0 || job.epoch !== epoch || cache.get(job.frame) !== job.entry || !refs_same(job.refs, job.frame.pk) || job.key !== vis_key(job.frame)) {
    job.entry.pending = 0
    if (job.epoch === epoch && cache.get(job.frame) === job.entry) dirty(D_THUMB)
    queue_start()
    return
  }
  working = 1
  const done = (pixels: Uint8ClampedArray | null): void => {
    working = 0
    job.entry.pending = 0
    if (job.epoch === epoch && cache.get(job.frame) === job.entry && st().doc.frames.includes(job.frame as Frame) && refs_same(job.refs, job.frame.pk) && job.key === vis_key(job.frame)) {
      if (pixels) {
        const [canvas, context] = scratch_get(canvasWidth, canvasHeight)
        context.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), canvasWidth, canvasHeight), 0, 0)
        job.entry.x.clearRect(0, 0, THUMB_W, THUMB_H)
        job.entry.x.drawImage(canvas, (THUMB_W - canvasWidth) / 2, (THUMB_H - canvasHeight) / 2)
      } else draw_thumbnail(st().doc.frames.indexOf(job.frame as Frame), job.entry)
      job.entry.k = job.refs
      job.entry.vk = job.key
      job.entry.rev = revSeq++
      dirty(D_THUMB)
    } else if (job.epoch === epoch && cache.get(job.frame) === job.entry) dirty(D_THUMB)
    queue_start()
  }
  const plan = doc_render_plan(index, 1, 0)
  const ar = plan.width / plan.height
  const canvasWidth = ar > THUMB_W / THUMB_H ? THUMB_W : Math.round(THUMB_H * ar)
  const canvasHeight = ar > THUMB_W / THUMB_H ? Math.round(THUMB_W / ar) : THUMB_H
  if (!render_thumbnail_async(plan, canvasWidth, canvasHeight, done)) done(null)
}

function draw_thumbnail(index: number, entry: Th): void {
  const g = st()
  const ar = g.doc.w / g.doc.h
  const w = ar > THUMB_W / THUMB_H ? THUMB_W : Math.round(THUMB_H * ar)
  const h = ar > THUMB_W / THUMB_H ? Math.round(THUMB_W / ar) : THUMB_H
  const [canvas, context] = scratch_get(w, h)
  doc_compose(index, context, w, h, 1)
  entry.x.clearRect(0, 0, THUMB_W, THUMB_H)
  entry.x.drawImage(canvas, (THUMB_W - w) / 2, (THUMB_H - h) / 2)
}

export function thumb_rev(i: number): number {
  const f = st().doc.frames[i]
  const th = f ? cache.get(f) : undefined
  return th ? th.rev : 0
}

export function thumb_drop(f: ReadFrame): void {
  cache.delete(f)
}

export function thumb_clear(): void {
  epoch++
  jobs.length = 0
  cache.clear()
}
