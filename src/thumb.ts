import { render_thumbnail_async } from './workercli'
import { memory_budget } from './memory'
import { doc_compose, doc_render_plan } from './doc'
import { d_thumb, thumb_w, thumb_h, type frame_t, type rle_t } from './h'
import { canvas_make } from './lib'
import { dirty, st, type deep_ro_t } from './state/store'

type read_frame_t = deep_ro_t<frame_t>

type th_t = {
  c: HTMLCanvasElement
  x: CanvasRenderingContext2D
  k: (rle_t | null)[]
  vk: string
  rev: number
  pending: number
}

type thumbnail_job_t = { frame: read_frame_t, entry: th_t, refs: (rle_t | null)[], key: string, epoch: number }
const jobs: thumbnail_job_t[] = []
let working = 0
let epoch = 0
let rev_seq = 1
const cache = new Map<read_frame_t, th_t>()
let scratch: HTMLCanvasElement | null = null
let scratch_ctx: CanvasRenderingContext2D | null = null

function refs_same(a: readonly (rle_t | null)[], b: readonly (rle_t | null)[]): number {
  if (a.length !== b.length) return 0
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return 0
  return 1
}

function cache_cap(): number {
  return Math.max(1, Math.floor(memory_budget(st().mobile, 'thumb') / (thumb_w * thumb_h * 4)))
}

function vis_key(frame: read_frame_t): string {
  const g = st()
  return g.doc.mode + '|' + (frame.paper || g.doc.paper) + '|' + (frame.kwz?.depth.join(',') || '') + '|' + g.doc.lvis.join(',') + '|' + g.doc.lalpha.join(',') + '|' + g.doc.lord.join(',') + '|' + g.doc.w + 'x' + g.doc.h
}

function scratch_get(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  if (!scratch || !scratch_ctx) {
    const created = canvas_make(w, h)
    scratch = created[0]
    scratch_ctx = created[1]
  } else if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w
    scratch.height = h
  }
  return [scratch, scratch_ctx]
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
    const [c, x] = canvas_make(thumb_w, thumb_h)
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
  th.rev = rev_seq++
  const ready = draw_thumbnail(i, th)
  if (ready) { th.k = [...f.pk]; th.vk = vk }
  cache.set(f, th)
  cache_trim()
  return th.c
}

function cache_trim(): void {
  while (cache.size > cache_cap()) {
    const frame = cache.keys().next().value as read_frame_t
    thumb_drop(frame)
  }
}

function queue_start(): void {
  if (working) return
  const job = jobs.shift()
  if (!job) return
  const index = st().doc.frames.indexOf(job.frame as frame_t)
  if (index < 0 || job.epoch !== epoch || cache.get(job.frame) !== job.entry || !refs_same(job.refs, job.frame.pk) || job.key !== vis_key(job.frame)) {
    job.entry.pending = 0
    if (job.epoch === epoch && cache.get(job.frame) === job.entry) dirty(d_thumb)
    queue_start()
    return
  }
  working = 1
  const done = (pixels: Uint8ClampedArray | null): void => {
    working = 0
    job.entry.pending = 0
    if (job.epoch === epoch && cache.get(job.frame) === job.entry && st().doc.frames.includes(job.frame as frame_t) && refs_same(job.refs, job.frame.pk) && job.key === vis_key(job.frame)) {
      if (pixels) {
        const [canvas, context] = scratch_get(canvas_width, canvas_height)
        context.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), canvas_width, canvas_height), 0, 0)
        job.entry.x.clearRect(0, 0, thumb_w, thumb_h)
        job.entry.x.drawImage(canvas, (thumb_w - canvas_width) / 2, (thumb_h - canvas_height) / 2)
      }
      const ready = pixels || draw_thumbnail(st().doc.frames.indexOf(job.frame as frame_t), job.entry)
      if (ready) { job.entry.k = job.refs; job.entry.vk = job.key }
      job.entry.rev = rev_seq++
      dirty(d_thumb)
    } else if (job.epoch === epoch && cache.get(job.frame) === job.entry) dirty(d_thumb)
    queue_start()
  }
  const plan = doc_render_plan(index, 1, 0)
  const ar = plan.width / plan.height
  const canvas_width = ar > thumb_w / thumb_h ? thumb_w : Math.round(thumb_h * ar)
  const canvas_height = ar > thumb_w / thumb_h ? Math.round(thumb_w / ar) : thumb_h
  if (!render_thumbnail_async(plan, canvas_width, canvas_height, done)) done(null)
}

function draw_thumbnail(index: number, entry: th_t): number {
  const g = st()
  const ar = g.doc.w / g.doc.h
  const w = ar > thumb_w / thumb_h ? thumb_w : Math.round(thumb_h * ar)
  const h = ar > thumb_w / thumb_h ? Math.round(thumb_w / ar) : thumb_h
  const [canvas, context] = scratch_get(w, h)
  const ready = doc_compose(index, context, w, h, 1)
  entry.x.clearRect(0, 0, thumb_w, thumb_h)
  entry.x.drawImage(canvas, (thumb_w - w) / 2, (thumb_h - h) / 2)
  return ready
}

export function thumb_rev(i: number): number {
  const f = st().doc.frames[i]
  const th = f ? cache.get(f) : undefined
  return th ? th.rev : 0
}

export function thumb_drop(f: read_frame_t): void {
  const entry = cache.get(f)
  if (entry) { entry.c.width = 0; entry.c.height = 0 }
  cache.delete(f)
}

export function thumb_clear(): void {
  epoch++
  jobs.length = 0
  for (const frame of cache.keys()) thumb_drop(frame)
  if (scratch) { scratch.width = 0; scratch.height = 0 }
}
