import { doc_compose, doc_frame_new } from './doc'
import { toast } from './dom'
import { TR_FADE, TR_SLIDE_L, TR_SLIDE_R, TR_SLIDE_U, TR_SLIDE_D, TR_ZOOM_IN, TR_ZOOM_OUT, TR_WIPE, L_P, type Frame } from './h'
import { canvas_make, clamp, rle_pack } from './lib'
import { mode_frame_limit } from './mode'
import { sfx_play } from './snd'
import { dispatch } from './state/commands/index'
import { st } from './state/store'

function pack_img(img: ImageData): Uint32Array {
  return rle_pack(new Uint32Array(img.data.buffer))
}

function blend_frame(kind: number, ca: HTMLCanvasElement, cb: HTMLCanvasElement, t: number, w: number, h: number): ImageData {
  const [, x] = canvas_make(w, h, 1)
  x.clearRect(0, 0, w, h)
  if (kind === TR_FADE) {
    x.globalAlpha = 1
    x.drawImage(ca, 0, 0)
    x.globalAlpha = t
    x.drawImage(cb, 0, 0)
  } else if (kind === TR_SLIDE_L || kind === TR_SLIDE_R || kind === TR_SLIDE_U || kind === TR_SLIDE_D) {
    let ox = 0
    let oy = 0
    if (kind === TR_SLIDE_L) ox = -w * t
    if (kind === TR_SLIDE_R) ox = w * t
    if (kind === TR_SLIDE_U) oy = -h * t
    if (kind === TR_SLIDE_D) oy = h * t
    x.drawImage(ca, ox, oy)
    x.drawImage(cb, ox + (kind === TR_SLIDE_L ? w : kind === TR_SLIDE_R ? -w : 0), oy + (kind === TR_SLIDE_U ? h : kind === TR_SLIDE_D ? -h : 0))
  } else if (kind === TR_ZOOM_IN || kind === TR_ZOOM_OUT) {
    x.drawImage(ca, 0, 0)
    const s = kind === TR_ZOOM_IN ? t : 1 - t
    const sw = w * s
    const sh = h * s
    x.globalAlpha = clamp(t, 0, 1)
    x.drawImage(cb, (w - sw) / 2, (h - sh) / 2, sw, sh)
  } else if (kind === TR_WIPE) {
    x.drawImage(ca, 0, 0)
    const cut = Math.round(w * t)
    x.save()
    x.beginPath()
    x.rect(0, 0, cut, h)
    x.clip()
    x.drawImage(cb, 0, 0)
    x.restore()
  }
  x.globalAlpha = 1
  return x.getImageData(0, 0, w, h)
}

export function transition_insert(kind: number, steps: number): void {
  const g = st()
  const n = g.doc.frames.length
  const i = g.doc.cur
  if (i >= n - 1) {
    toast('最後のコマの後ろにはトランジションを作れないよ（次のコマが必要）')
    return
  }
  steps = clamp(steps, 1, 24)
  if (n + steps > mode_frame_limit(g.doc.mode)) {
    toast('コマ数の上限を超えちゃう')
    return
  }
  dispatch('frame.sync_live', null)
  const w = g.doc.w
  const h = g.doc.h
  const [ca, ax] = canvas_make(w, h)
  const [cb, bx] = canvas_make(w, h)
  doc_compose(i, ax, w, h, 0)
  doc_compose(i + 1, bx, w, h, 0)
  const fresh: Frame[] = []
  for (let k = 1; k <= steps; k++) {
    const t = k / (steps + 1)
    const img = blend_frame(kind, ca, cb, t, w, h)
    const fr = doc_frame_new()
    fr.pk[L_P] = pack_img(img)
    fresh.push(fr)
  }
  dispatch('frame.insert_bulk', { at: i + 1, frames: fresh, setCur: i })
  toast(steps + '枚のトランジションを挿入しました（もどす不可）')
  sfx_play('paper')
}
