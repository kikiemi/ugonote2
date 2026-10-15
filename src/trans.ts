import { doc_compose, doc_frame_new } from './doc'
import { toast } from './dom'
import { tr_fade, tr_slide_l, tr_slide_r, tr_slide_u, tr_slide_d, tr_zoom_in, tr_zoom_out, tr_wipe, l_p, type frame_t } from './h'
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
  if (kind === tr_fade) {
    x.globalAlpha = 1
    x.drawImage(ca, 0, 0)
    x.globalAlpha = t
    x.drawImage(cb, 0, 0)
  } else if (kind === tr_slide_l || kind === tr_slide_r || kind === tr_slide_u || kind === tr_slide_d) {
    let ox = 0
    let oy = 0
    if (kind === tr_slide_l) ox = -w * t
    if (kind === tr_slide_r) ox = w * t
    if (kind === tr_slide_u) oy = -h * t
    if (kind === tr_slide_d) oy = h * t
    x.drawImage(ca, ox, oy)
    x.drawImage(cb, ox + (kind === tr_slide_l ? w : kind === tr_slide_r ? -w : 0), oy + (kind === tr_slide_u ? h : kind === tr_slide_d ? -h : 0))
  } else if (kind === tr_zoom_in || kind === tr_zoom_out) {
    x.drawImage(ca, 0, 0)
    const s = kind === tr_zoom_in ? t : 1 - t
    const sw = w * s
    const sh = h * s
    x.globalAlpha = clamp(t, 0, 1)
    x.drawImage(cb, (w - sw) / 2, (h - sh) / 2, sw, sh)
  } else if (kind === tr_wipe) {
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
  const fresh: frame_t[] = []
  for (let k = 1; k <= steps; k++) {
    const t = k / (steps + 1)
    const img = blend_frame(kind, ca, cb, t, w, h)
    const fr = doc_frame_new()
    fr.pk[l_p] = pack_img(img)
    fresh.push(fr)
  }
  dispatch('frame.insert_bulk', { at: i + 1, frames: fresh, set_cur: i })
  toast(steps + '枚のトランジションを挿入しました（もどす不可）')
  sfx_play('paper')
}
