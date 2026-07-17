import { doc_compose } from './doc'
import { THUMB_W, THUMB_H, type Frame, type Rle } from './h'
import { canvas_make } from './lib'
import { st, type DeepRO } from './state/store'

type ReadFrame = DeepRO<Frame>

type Th = {
  c: HTMLCanvasElement
  x: CanvasRenderingContext2D
  k: (Rle | null)[]
  vk: string
  rev: number
}

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
  return st().mobile ? 180 : 400
}

function vis_key(): string {
  const g = st()
  return g.doc.mode + '|' + g.doc.paper + '|' + g.doc.lvis.join(',') + '|' + g.doc.lalpha.join(',') + '|' + g.doc.lord.join(',') + '|' + g.doc.w + 'x' + g.doc.h
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

export function thumb_get(i: number): HTMLCanvasElement | null {
  const g = st()
  const f = g.doc.frames[i]
  if (!f) return null
  const vk = vis_key()
  let th = cache.get(f)
  const fresh = th && th.vk === vk && refs_same(th.k, f.pk)
  if (th && fresh) {
    cache.delete(f)
    cache.set(f, th)
    return th.c
  }
  if (!th) {
    const [c, x] = canvas_make(THUMB_W, THUMB_H)
    th = { c, x, k: [], vk: '', rev: 0 }
  } else {
    cache.delete(f)
  }
  th.rev = revSeq++
  const ar = g.doc.w / g.doc.h
  const tar = THUMB_W / THUMB_H
  let dw = THUMB_W
  let dh = THUMB_H
  if (ar > tar) dh = Math.round(THUMB_W / ar)
  else dw = Math.round(THUMB_H * ar)
  th.x.clearRect(0, 0, THUMB_W, THUMB_H)
  const [tc, tx] = scratch_get(dw, dh)
  doc_compose(i, tx, dw, dh, 1)
  th.x.drawImage(tc, (THUMB_W - dw) / 2, (THUMB_H - dh) / 2)
  th.k = [...f.pk]
  th.vk = vk
  cache.set(f, th)
  if (cache.size > cache_cap()) {
    const first = cache.keys().next().value as ReadFrame
    cache.delete(first)
  }
  return th.c
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
  cache.clear()
}
