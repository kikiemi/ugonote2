import { memory_budget } from '../memory'
import { animfx_compose, animfx_driver_sync } from '../animfx'
import { doc_compose } from '../doc'
import { q } from '../dom'
import { T_PIXEL, type Rle } from '../h'
import { canvas_make, clamp } from '../lib'
import { pref_theme } from '../prefs'
import { flo_render, sel_render } from '../sel'
import { anim_play_time, anim_playhead, anim_playing } from '../state/commands/play'
import { st } from '../state/store'

let onionA: HTMLCanvasElement | null = null
let onionAx: CanvasRenderingContext2D | null = null

function stage_canvases(): HTMLCanvasElement[] {
  return [q<HTMLCanvasElement>('stage'), q<HTMLCanvasElement>('onionCv'), q<HTMLCanvasElement>('gridCv'), q<HTMLCanvasElement>('antsCv'), q<HTMLCanvasElement>('floCv')]
}

export function r_stage(): void {
  const g = st()
  const w = g.doc.w
  const h = g.doc.h
  const cvs = stage_canvases()
  if (cvs[0].width !== w || cvs[0].height !== h) {
    for (const c of cvs) {
      c.width = w
      c.height = h
    }
    onionA = null
    sel_render()
    flo_render()
  }
  const pan = q('stagePan')
  pan.style.setProperty('--paper-line', `${1 / g.view.z}px`)
  pan.style.width = w + 'px'
  pan.style.height = h + 'px'
  pan.style.transform = 'translate(' + g.view.px + 'px,' + g.view.py + 'px) scale(' + g.view.z + ')'
  const sx = cvs[0].getContext('2d') as CanvasRenderingContext2D
  const playing = anim_playing()
  if (playing) animfx_compose(anim_playhead(), sx, w, h, 1, anim_play_time())
  else doc_compose(anim_playhead(), sx, w, h, 1)
  animfx_driver_sync(playing)
  r_onion_draw(cvs[1])
  r_grid_draw(cvs[2])
}

type OnionEnt = { i: number, k: (Rle | null)[], vk: string, color: string, c: HTMLCanvasElement, x: CanvasRenderingContext2D }

let onionEnts: OnionEnt[] = []

function refs_same(a: readonly (Rle | null)[], b: readonly (Rle | null)[]): number {
  if (a.length !== b.length) return 0
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return 0
  return 1
}

function onion_vk(): string {
  const g = st()
  return g.doc.mode + '|' + g.doc.paper + '|' + g.doc.lvis.join(',') + '|' + g.doc.lalpha.join(',') + '|' + g.doc.lord.join(',') + '|' + g.doc.w + 'x' + g.doc.h
}

function onion_tinted(i: number, color: string, w: number, h: number, vk: string): HTMLCanvasElement {
  const g = st()
  const f = g.doc.frames[i]
  vk += '|' + (f.kwz?.depth.join(',') || '')
  let e: OnionEnt | null = null
  for (const o of onionEnts) if (o.i === i && o.color === color) e = o
  const fresh = e && e.vk === vk && f && refs_same(e.k, f.pk) && e.c.width === w
  if (e && fresh) return e.c
  if (!e) {
    const [c, x] = canvas_make(w, h)
    e = { i, k: [], vk: '', color, c, x }
    onionEnts.push(e)
    const capacity = Math.max(0, Math.min(20, Math.floor(memory_budget(g.mobile, 'onion') / (w * h * 4))))
    while (onionEnts.length > capacity) onionEnts.shift()
  }
  if (e.c.width !== w || e.c.height !== h) {
    e.c.width = w
    e.c.height = h
  }
  const ax = onionAx as CanvasRenderingContext2D
  ax.clearRect(0, 0, w, h)
  doc_compose(i, ax, w, h, 0)
  e.x.clearRect(0, 0, w, h)
  e.x.globalCompositeOperation = 'source-over'
  e.x.drawImage(onionA as HTMLCanvasElement, 0, 0)
  e.x.globalCompositeOperation = 'source-in'
  e.x.fillStyle = color
  e.x.fillRect(0, 0, w, h)
  e.x.globalCompositeOperation = 'source-over'
  e.k = f ? [...f.pk] : []
  e.vk = vk
  return e.c
}

function r_onion_draw(cv: HTMLCanvasElement): void {
  const g = st()
  const x = cv.getContext('2d') as CanvasRenderingContext2D
  const w = g.doc.w
  const h = g.doc.h
  x.clearRect(0, 0, w, h)
  if (!g.view.onion || anim_playing()) return
  if (!onionA || onionA.width !== w || onionA.height !== h) {
    const [a, ax] = canvas_make(w, h)
    onionA = a
    onionAx = ax
    onionEnts = []
  }
  const vk = onion_vk()
  const one = (i: number, color: string, k: number) => {
    if (i < 0 || i >= g.doc.frames.length || i === g.doc.cur) return
    x.globalAlpha = 0.36 / (1 + k * 0.65)
    x.drawImage(onion_tinted(i, color, w, h, vk), 0, 0)
  }
  const distance = g.view.oskip ? 2 : 1
  for (let k = g.view.ocount - 1; k >= 0; k--) {
    if (g.view.oprev) one(g.doc.cur - distance - k, '#E0443B', k)
    if (g.view.onext) one(g.doc.cur + distance + k, '#2E6BE0', k)
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
  const cell = g.pen.tool === T_PIXEL ? g.doc.w / clamp(g.pen.pxn, 2, Math.min(256, g.doc.w)) : g.view.gsize
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

