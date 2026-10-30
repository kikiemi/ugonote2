import { pixel_source_prepare, pixel_source_ready } from '../pixel_source'
import { memory_budget } from '../memory'
import { animfx_compose, animfx_driver_sync } from '../animfx'
import { doc_compose } from '../doc'
import { q } from '../dom'
import { t_pixel, type rle_t } from '../h'
import { canvas_make, clamp, rle_pack, rle_unpack } from '../lib'
import { pref_theme } from '../prefs'
import { flo_render, sel_render } from '../sel'
import { anim_play_time, anim_playhead, anim_playing } from '../state/commands/play'
import { st } from '../state/store'

let onion_a: HTMLCanvasElement | null = null
let onion_ax: CanvasRenderingContext2D | null = null
let onion_frames: object | null = null

function stage_canvases(): HTMLCanvasElement[] {
  return [q<HTMLCanvasElement>('stage'), q<HTMLCanvasElement>('onion_cv'), q<HTMLCanvasElement>('grid_cv'), q<HTMLCanvasElement>('ants_cv'), q<HTMLCanvasElement>('flo_cv')]
}

export function r_stage(): void {
  const g = st()
  const w = g.doc.w
  const h = g.doc.h
  if (onion_frames !== g.doc.frames) { onion_frames = g.doc.frames; onion_ents = [] }
  const cvs = stage_canvases()
  if (cvs[0].width !== w || cvs[0].height !== h) {
    for (const c of cvs) {
      c.width = w
      c.height = h
    }
    if (onion_a) onion_a.width = 0
    onion_a = null; onion_ax = null
    if (onion_tint) onion_tint.width = 0
    onion_tint = null; onion_tx = null
    sel_render()
    flo_render()
  }
  const pan = q('stage_pan')
  pan.style.setProperty('--paper_line', `${1 / g.view.z}px`)
  pan.style.width = w + 'px'
  pan.style.height = h + 'px'
  pan.style.transform = 'translate(' + g.view.px + 'px,' + g.view.py + 'px) scale(' + g.view.z + ')'
  const sx = cvs[0].getContext('2d') as CanvasRenderingContext2D
  const playing = anim_playing()
  const frame = g.doc.frames[anim_playhead()]
  // Keep the last complete image until asynchronous video decoding finishes.
  // Queue the visible frame before prefetching the next one.
  const ready = pixel_source_ready(frame)
  if (!ready) void pixel_source_prepare(frame).catch(() => {})
  if (playing) {
    const current = anim_playhead(), end = g.doc.loop_b >= 0 ? g.doc.loop_b : g.doc.frames.length - 1
    const next = current < end ? current + 1 : g.doc.loop ? Math.max(0, g.doc.loop_a) : current
    void pixel_source_prepare(g.doc.frames[next]).catch(() => {})
  }
  if (ready && playing) animfx_compose(anim_playhead(), sx, w, h, 1, anim_play_time())
  else if (ready) doc_compose(anim_playhead(), sx, w, h, 1)
  animfx_driver_sync(playing)
  r_onion_draw(cvs[1])
  r_grid_draw(cvs[2])
}

type onion_ent_t = { i: number, k: (rle_t | null)[], vk: string, color: string, w: number, h: number, packed: rle_t | null }

let onion_ents: onion_ent_t[] = []
let onion_tint: HTMLCanvasElement | null = null
let onion_tx: CanvasRenderingContext2D | null = null

function refs_same(a: readonly (rle_t | null)[], b: readonly (rle_t | null)[]): number {
  if (a.length !== b.length) return 0
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return 0
  return 1
}

function onion_vk(): string {
  const g = st()
  return g.doc.mode + '|' + g.doc.paper + '|' + g.doc.lvis.join(',') + '|' + g.doc.lalpha.join(',') + '|' + g.doc.lord.join(',') + '|' + g.doc.w + 'x' + g.doc.h
}

function onion_tinted(i: number, color: string, w: number, h: number, vk: string): HTMLCanvasElement {
  const g = st(), frame = g.doc.frames[i]
  vk += '|' + (frame.kwz?.depth.join(',') || '')
  if (!onion_tint || onion_tint.width !== w || onion_tint.height !== h) {
    if (onion_tint) onion_tint.width = 0
    const surface = canvas_make(w, h)
    onion_tint = surface[0]; onion_tx = surface[1]
  }
  const context = onion_tx!
  let entry = onion_ents.find(entry => entry.i === i && entry.color === color)
  if (entry && entry.vk === vk && refs_same(entry.k, frame.pk) && entry.w === w && entry.h === h && entry.packed) {
    const image = context.createImageData(w, h)
    rle_unpack(entry.packed, new Uint32Array(image.data.buffer))
    context.putImageData(image, 0, 0)
    return onion_tint
  }
  if (!entry) { entry = { i, k: [], vk: '', color, w, h, packed: null }; onion_ents.push(entry) }
  const source = onion_ax!
  source.clearRect(0, 0, w, h)
  const ready = doc_compose(i, source, w, h, 0)
  context.clearRect(0, 0, w, h)
  context.globalCompositeOperation = 'source-over'
  context.drawImage(onion_a!, 0, 0)
  context.globalCompositeOperation = 'source-in'
  context.fillStyle = color; context.fillRect(0, 0, w, h)
  context.globalCompositeOperation = 'source-over'
  if (ready) {
    entry.packed = rle_pack(new Uint32Array(context.getImageData(0, 0, w, h).data.buffer))
    entry.k = [...frame.pk]; entry.vk = vk; entry.w = w; entry.h = h
  }
  let bytes = onion_ents.reduce((bytes, entry) => bytes + (entry.packed?.byteLength || 0), 0)
  const budget = memory_budget(g.mobile, 'onion')
  while (onion_ents.length > 1 && (onion_ents.length > 20 || bytes > budget)) bytes -= onion_ents.shift()!.packed?.byteLength || 0
  return onion_tint
}

function r_onion_draw(cv: HTMLCanvasElement): void {
  const g = st()
  const x = cv.getContext('2d') as CanvasRenderingContext2D
  const w = g.doc.w
  const h = g.doc.h
  x.clearRect(0, 0, w, h)
  if (!g.view.onion || anim_playing()) return
  if (!onion_a || onion_a.width !== w || onion_a.height !== h) {
    const [a, ax] = canvas_make(w, h)
    onion_a = a
    onion_ax = ax
    onion_ents = []
  }
  const vk = onion_vk()
  const one = (i: number, color: string, k: number) => {
    if (i < 0 || i >= g.doc.frames.length || i === g.doc.cur) return
    x.globalAlpha = 0.36 / (1 + k * 0.65)
    x.drawImage(onion_tinted(i, color, w, h, vk), 0, 0)
  }
  for (let k = g.view.ocount - 1; k >= 0; k--) {
    if (g.view.oprev) one(g.doc.cur - 1 - k, '#E0443B', k)
    if (g.view.onext) one(g.doc.cur + 1 + k, '#2E6BE0', k)
  }
  x.globalAlpha = 1
}

function r_grid_draw(cv: HTMLCanvasElement): void {
  const g = st()
  const x = cv.getContext('2d') as CanvasRenderingContext2D
  const w = g.doc.w
  const h = g.doc.h
  x.clearRect(0, 0, w, h)
  if (!g.view.grid || anim_playing()) return
  const cell = g.pen.tool === t_pixel ? g.doc.w / clamp(g.pen.pxn, 2, Math.min(256, g.doc.w)) : g.view.gsize
  const lw = Math.max(0.4, 1 / g.view.z)
  x.lineWidth = lw
  x.beginPath()
  for (let gx = cell; gx < w - 0.5; gx += cell) {
    const px = Math.round(gx) + 0.5 * (lw < 1.5 ? 1 : 0)
    x.moveTo(px, 0)
    x.lineTo(px, h)
  }
  for (let gy = cell; gy < h - 0.5; gy += cell) {
    const py = Math.round(gy) + 0.5 * (lw < 1.5 ? 1 : 0)
    x.moveTo(0, py)
    x.lineTo(w, py)
  }
  x.setLineDash([3 / g.view.z, 3 / g.view.z])
  x.strokeStyle = pref_theme() ? 'rgba(115,145,181,0.24)' : 'rgba(104,135,188,0.24)'
  x.stroke()
  x.setLineDash([])
}

