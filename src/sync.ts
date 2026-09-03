import { animfx_active, animfx_compose, animfx_driver_sync } from './animfx'
import { report_error } from './diagnostics'
import { doc_compose } from './doc'
import { el, ic, q, query } from './dom'
import { live_canvas } from './engine'
import {
  B_N,
  D_ANIM,
  D_FRAMEINFO,
  D_GRID,
  D_LAYER,
  D_MODE,
  D_ONION,
  D_PAGE,
  D_PEN,
  D_PLAY,
  D_SAVE,
  D_SEL,
  D_SOUND,
  D_STAGE,
  D_THUMB,
  D_TIMELINE,
  D_TOOLS,
  D_TRANS,
  D_ZOOM,
  FPS_SPEEDS,
  INK_KWZ,
  INK_PPM,
  INK_STD,
  K_NONE,
  MODE_3D,
  MODE_DSI,
  MODE_NORMAL,
  PAL_KWZ,
  PAL_PPM,
  PAT_TABLE,
  THUMB_H,
  THUMB_W,
  T_CIRCLE,
  T_ERASER,
  T_FILL,
  T_HEART,
  T_LASSO,
  T_LINE,
  T_PASTE,
  T_PEN,
  T_PIXEL,
  T_RECT,
  T_SELECT,
  T_STAR,
  T_TEXT,
  fps_speed_tag,
  type Rle,
} from './h'
import { hist_can_redo, hist_can_undo } from './hist'
import { canvas_make, clamp } from './lib'
import { mode_allows_runtime_anim, mode_name, mode_paper_opts } from './mode'
import { proj_dirty, store_blink, store_state } from './persist'
import { pref_kit, pref_theme, pref_uisfx } from './prefs'
import { flo_active, flo_render, sel_render } from './sel'
import { TOOL_DEFS } from './shell'
import { anim_hold_of, anim_play_time, anim_playhead, anim_playing } from './state/commands/play'
import { dirty, flush_begin, flush_end, st, store_dirty_hook } from './state/store'
import { thumb_get, thumb_rev } from './thumb'
import { marks_render, palette_render } from './ui/color_panel'
import { layer_panel_render } from './ui/layer_panel'

type Region = { name: string, mask: number, fn: () => void }

const regions: Region[] = []
let mounted = 0
let onionA: HTMLCanvasElement | null = null
let onionAx: CanvasRenderingContext2D | null = null
let chrome_tlopen = -1

export function region_add(name: string, mask: number, fn: () => void): void {
  for (const r of regions) if (r.name === name) throw new Error('region dup: ' + name)
  regions.push({ name, mask, fn })
}

function ink_list(): string[] {
  const g = st()
  if (g.pen.palMode === PAL_PPM) return INK_PPM
  if (g.pen.palMode === PAL_KWZ) return INK_KWZ
  return INK_STD
}

function stage_canvases(): HTMLCanvasElement[] {
  return [q<HTMLCanvasElement>('stage'), q<HTMLCanvasElement>('onionCv'), q<HTMLCanvasElement>('gridCv'), q<HTMLCanvasElement>('antsCv'), q<HTMLCanvasElement>('floCv')]
}

function r_stage(): void {
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
  let e: OnionEnt | null = null
  for (const o of onionEnts) if (o.i === i && o.color === color) e = o
  const fresh = e && e.vk === vk && f && refs_same(e.k, f.pk) && e.c.width === w
  if (e && fresh) return e.c
  if (!e) {
    const [c, x] = canvas_make(w, h)
    e = { i, k: [], vk: '', color, c, x }
    onionEnts.push(e)
    if (onionEnts.length > 8) onionEnts.shift()
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
  const alphas = [0.36, 0.2, 0.11]
  const one = (i: number, color: string, k: number) => {
    if (i < 0 || i >= g.doc.frames.length || i === g.doc.cur) return
    x.globalAlpha = alphas[k]
    x.drawImage(onion_tinted(i, color, w, h, vk), 0, 0)
  }
  for (let k = g.view.ocount - 1; k >= 0; k--) one(g.doc.cur - 1 - k, '#E0443B', k)
  for (let k = g.view.ocount - 1; k >= 0; k--) one(g.doc.cur + 1 + k, '#2E6BE0', k)
  x.globalAlpha = 1
}

function r_grid_draw(cv: HTMLCanvasElement): void {
  const g = st()
  const x = cv.getContext('2d') as CanvasRenderingContext2D
  const w = g.doc.w
  const h = g.doc.h
  x.clearRect(0, 0, w, h)
  if (!g.view.grid || anim_playing()) return
  const cell = g.pen.tool === T_PIXEL ? g.doc.w / clamp(g.pen.pxn, 2, 256) : g.view.gsize
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
  x.strokeStyle = 'rgba(50,42,38,0.25)'
  x.stroke()
}

const TL_BUF = 5

let tlPool: HTMLElement[] = []
let tlStep = 93
let tlHead = -1

function fs_track(): HTMLElement {
  const fs = q('fs')
  let t = document.getElementById('fsTrack')
  if (!t) {
    t = el('div', '', '')
    t.id = 'fsTrack'
    fs.appendChild(t)
    fs.addEventListener('scroll', () => tl_window(0), { passive: true })
  }
  return t
}

function fs_cell(): HTMLElement {
  const d = el('div', 'fcell', '')
  const c = document.createElement('canvas')
  c.width = THUMB_W
  c.height = THUMB_H
  d.appendChild(c)
  d.appendChild(el('span', 'fno', ''))
  d.appendChild(el('span', 'fhold', ''))
  d.appendChild(el('span', 'fse', ''))
  d.appendChild(el('span', 'abm a', 'A'))
  d.appendChild(el('span', 'abm b', 'B'))
  return d
}

function tl_step(): number {
  const cs = getComputedStyle(q('fs'))
  const w = parseFloat(cs.getPropertyValue('--fcw')) || 86
  const gap = parseFloat(cs.getPropertyValue('--fgap')) || 7
  return w + gap
}

function fs_assign(cell: HTMLElement, i: number, head: number): void {
  const g = st()
  const f = g.doc.frames[i]
  if (!f) {
    cell.style.display = 'none'
    cell.dataset.i = ''
    return
  }
  const moved = cell.dataset.i !== String(i)
  if (moved) {
    cell.dataset.i = String(i)
    cell.style.left = i * tlStep + 'px'
    cell.style.display = ''
    const num = cell.querySelector('.fno') as HTMLElement
    num.textContent = String(i + 1)
    cell.dataset.tk = ''
  }
  const rev = thumb_rev(i)
  const wantTk = rev + '|' + (i === g.doc.cur ? 'c' : '')
  if (cell.dataset.tk !== wantTk || i === g.doc.cur) {
    const c = cell.querySelector('canvas') as HTMLCanvasElement
    const x = c.getContext('2d') as CanvasRenderingContext2D
    x.clearRect(0, 0, THUMB_W, THUMB_H)
    const th = thumb_get(i)
    if (th) x.drawImage(th, 0, 0)
    cell.dataset.tk = thumb_rev(i) + '|' + (i === g.doc.cur ? 'c' : '')
  }
  const fh = cell.querySelector('.fhold') as HTMLElement
  const wantH = f.hold > 1 ? '×' + f.hold : ''
  if (fh.textContent !== wantH) fh.textContent = wantH
  let dots = ''
  if (f.se) for (let k = 0; k < 4; k++) if (f.se & (1 << k)) dots += '<i class="d' + k + '"></i>'
  const fse = cell.querySelector('.fse') as HTMLElement
  if (fse.innerHTML !== dots) fse.innerHTML = dots
  const a = g.doc.loopA
  const b = g.doc.loopB
  cell.classList.toggle('on', i === head)
  cell.classList.toggle('inab', a >= 0 && b >= 0 && i >= a && i <= b)
  query(cell, '.abm.a').classList.toggle('show', i === a)
  query(cell, '.abm.b').classList.toggle('show', i === b)
}

function tl_window(force: number): void {
  const g = st()
  const fs = q('fs')
  const track = fs_track()
  const n = g.doc.frames.length
  const head = anim_playhead()
  const first = Math.max(0, Math.floor(fs.scrollLeft / tlStep) - TL_BUF)
  const last = Math.min(n - 1, Math.ceil((fs.scrollLeft + fs.clientWidth) / tlStep) + TL_BUF)
  const need = Math.max(0, last - first + 1)
  while (tlPool.length < need) {
    const c = fs_cell()
    tlPool.push(c)
    track.appendChild(c)
  }
  for (let k = 0; k < tlPool.length; k++) {
    const cell = tlPool[k]
    const i = first + k
    if (k >= need) {
      cell.style.display = 'none'
      cell.dataset.i = ''
      continue
    }
    if (force) cell.dataset.tk = ''
    fs_assign(cell, i, head)
  }
  tlHead = head
}

export function tl_index_at(clientX: number): number {
  const fs = q('fs')
  const r = fs.getBoundingClientRect()
  const x = clientX - r.left + fs.scrollLeft
  const n = st().doc.frames.length
  return clamp(Math.round(x / tlStep - 0.5), 0, Math.max(0, n - 1))
}

function tl_scroll_to_head(): void {
  const fs = q('fs')
  const head = anim_playhead()
  const want = head * tlStep - fs.clientWidth / 2 + tlStep / 2
  const max = fs.scrollWidth - fs.clientWidth
  const to = clamp(want, 0, Math.max(0, max))
  if (Math.abs(fs.scrollLeft - to) > 1) fs.scrollLeft = to
}

function r_timeline(): void {
  const g = st()
  const n = g.doc.frames.length
  tlStep = tl_step()
  fs_track().style.width = Math.max(0, n * tlStep - 7) + 'px'
  tl_window(1)
  tl_scroll_to_head()
}

function r_thumbs(): void {
  tl_window(0)
}

function r_frameinfo(): void {
  const g = st()
  const head = anim_playhead()
  const frame_no = q('frameNo')
  const frame_count = g.doc.frames.length
  const frame_current = head + 1
  const frame_long = frame_current > 99 || frame_count > 99
  const frame_xlong = frame_current > 999 || frame_count > 999
  frame_no.textContent = frame_long ? frame_current + '/' + frame_count : frame_current + ' / ' + frame_count
  frame_no.classList.toggle('long', frame_long)
  frame_no.classList.toggle('xlong', frame_xlong)
  frame_no.title = frame_current + ' / ' + frame_count + '。番号を指定して移動'
  frame_no.setAttribute('aria-label', frame_no.title)
  const canDelete = frame_count > 1
  const firstButton = q<HTMLButtonElement>('homeBtn')
  const lastButton = q<HTMLButtonElement>('lastBtn')
  firstButton.classList.toggle('off', frame_current === 1)
  firstButton.disabled = frame_current === 1
  firstButton.setAttribute('aria-disabled', frame_current === 1 ? 'true' : 'false')
  lastButton.classList.toggle('off', frame_current === frame_count)
  lastButton.disabled = frame_current === frame_count
  lastButton.setAttribute('aria-disabled', frame_current === frame_count ? 'true' : 'false')
  const deleteButton = q<HTMLButtonElement>('delBtn')
  deleteButton.classList.toggle('off', !canDelete)
  deleteButton.disabled = !canDelete
  deleteButton.setAttribute('aria-disabled', canDelete ? 'false' : 'true')
  const hold = anim_hold_of(g.doc.cur)
  q('holdLabel').textContent = '×' + hold
  const hr = q<HTMLInputElement>('holdRange')
  if (document.activeElement !== hr) hr.value = String(hold)
  q('holdVal').textContent = '×' + hold
  const a = g.doc.loopA
  const b = g.doc.loopB
  q('abBtn').classList.toggle('on', a >= 0 || b >= 0)
  if (head !== tlHead) {
    tl_scroll_to_head()
    tl_window(0)
  }
}

const OPT_MAP: [string, number[]][] = [
  ['blkBrush', [T_PEN]],
  ['blkSize', [T_PEN, T_ERASER, T_LINE, T_RECT, T_CIRCLE, T_STAR, T_HEART]],
  ['blkStroke', [T_PEN]],
  ['blkSym', [T_PEN, T_PIXEL, T_LINE, T_RECT, T_CIRCLE, T_STAR, T_HEART]],
  ['blkAlpha', [T_PEN, T_FILL, T_LINE, T_RECT, T_CIRCLE, T_STAR, T_HEART]],
  ['blkPat', [T_PEN, T_ERASER, T_LINE, T_RECT, T_CIRCLE, T_STAR, T_HEART]],
  ['blkOutline', [T_PEN, T_LINE, T_RECT, T_CIRCLE, T_STAR, T_HEART]],
  ['blkFill', [T_RECT, T_CIRCLE, T_STAR, T_HEART]],
  ['blkFillTool', [T_FILL]],
  ['blkPxn', [T_PIXEL]],
  ['blkSel', [T_SELECT, T_LASSO]],
  ['blkPaste', [T_PASTE]],
]

const KIT_BASIC = [T_PEN, T_ERASER, T_FILL, 10, T_SELECT, 13, 14]

export function kit_tool_ok(t: number): number {
  if (!pref_kit()) return 1
  return KIT_BASIC.indexOf(t) >= 0 ? 1 : 0
}

export function tool_has_options(t: number): number {
  for (const [, list] of OPT_MAP) if (list.indexOf(t) >= 0) return 1
  return 0
}

function r_tools(): void {
  const g = st()
  const m = g.doc.mode
  for (const d of TOOL_DEFS) {
    const b = q('tl_' + d.t)
    b.classList.toggle('on', g.pen.tool === d.t)
    const modeOff = kit_tool_ok(d.t) ? 0 : 1
    if (d.t === T_PASTE) b.classList.toggle('off', modeOff || !g.clip ? true : false)
    else b.classList.toggle('off', modeOff ? true : false)
  }
  document.body.dataset.tool = String(g.pen.tool)
  q('undoBtn').classList.toggle('off', hist_can_undo() ? false : true)
  q('redoBtn').classList.toggle('off', hist_can_redo() ? false : true)
  for (const [id, list] of OPT_MAP) {
    let show = list.indexOf(g.pen.tool) >= 0 ? 1 : 0
    if (pref_kit() && (id === 'blkPat' || id === 'blkAlpha' || id === 'blkOutline' || id === 'blkStroke' || id === 'blkSym')) show = 0
    q(id).classList.toggle('off', show ? false : true)
  }
  q('markBtn').classList.toggle('off', m === MODE_NORMAL ? false : true)
  q('transBtn').classList.toggle('off', m === MODE_NORMAL ? false : true)
  const lock = m !== MODE_NORMAL
  q('canvasSizeRow').classList.toggle('off', lock)
  q('sizeApply').classList.toggle('off', lock)
  q('rotLBtn').classList.toggle('off', lock)
  q('rotRBtn').classList.toggle('off', lock)
  const popts = mode_paper_opts(m)
  const useSw = m !== MODE_NORMAL
  q('paperIn').style.display = useSw ? 'none' : ''
  const sw = q('paperSw')
  sw.style.display = useSw ? '' : 'none'
  if (useSw) {
    const cur = g.doc.paper.toUpperCase()
    let hh = ''
    for (const c of popts) hh += '<button class="psw' + (c === cur ? ' on' : '') + '" data-paper="' + c + '" style="background:' + c + '"></button>'
    if (sw.dataset.h !== hh) {
      sw.innerHTML = hh
      sw.dataset.h = hh
    }
  }
}

function r_pen(): void {
  const g = st()
  const p = g.pen
  q('colorChip').style.background = p.color
  const dot = q('sizeDot')
  const dpx = Math.min(24, Math.max(4, p.size))
  dot.style.width = dpx + 'px'
  dot.style.height = dpx + 'px'
  const wrap = q('popTool')
  const szb = wrap.querySelectorAll('.szb')
  for (let i = 0; i < szb.length; i++) {
    const b = szb[i] as HTMLElement
    b.classList.toggle('on', Number(b.dataset.sz) === p.size)
  }
  const patb = wrap.querySelectorAll('.patb')
  for (let i = 0; i < patb.length; i++) {
    const b = patb[i] as HTMLElement
    b.classList.toggle('on', Number(b.dataset.pat) === p.pat)
  }
  const ar = q<HTMLInputElement>('optAlpha')
  const av = Math.round(p.alpha * 100)
  if (document.activeElement !== ar) ar.value = String(av)
  q('optAlphaVal').textContent = String(av)
  const smr = q<HTMLInputElement>('optSmooth')
  if (document.activeElement !== smr) smr.value = String(p.smooth)
  q('optSmoothVal').textContent = String(p.smooth)
  const owr = q<HTMLInputElement>('optOWidth')
  if (document.activeElement !== owr) owr.value = String(p.owidth)
  q('optOWidthVal').textContent = String(p.owidth)
  q<HTMLInputElement>('optOColor').value = p.ocolor
  q('optOutline').classList.toggle('on', p.outline ? true : false)
  q('optPressure').classList.toggle('on', p.pressure ? true : false)
  q('optSymX').classList.toggle('on', p.sym ? true : false)
  q('optSymY').classList.toggle('on', p.symy ? true : false)
  q('optFill').classList.toggle('on', p.fill ? true : false)
  q('optFillAll').classList.toggle('on', p.fillAll ? true : false)
  for (let b = 0; b < B_N; b++) q('brush_' + b).classList.toggle('on', p.brush === b)
  const sn = q<HTMLInputElement>('sizeNum')
  const srr = q<HTMLInputElement>('sizeRange')
  if (document.activeElement !== sn) sn.value = String(p.size)
  if (document.activeElement !== srr) srr.value = String(p.size)
  const pn = q<HTMLInputElement>('pxnNum')
  const prr = q<HTMLInputElement>('pxnRange')
  if (document.activeElement !== pn) pn.value = String(p.pxn)
  if (document.activeElement !== prr) prr.value = String(p.pxn)
  marks_render()
  for (let t = 0; t < 3; t++) q('palTab_' + t).classList.toggle('on', p.palMode === t)
  palette_render(ink_list())
  q<HTMLInputElement>('pickIn').value = p.color
  const hx = q<HTMLInputElement>('hexIn')
  if (document.activeElement !== hx) hx.value = p.color
}

function r_layer(): void {
  layer_panel_render()
}

function r_play(): void {
  const g = st()
  const on = anim_playing()
  q('playBtn').innerHTML = ic(on ? 'pause' : 'play')
  q('playBtn').classList.toggle('on', on ? true : false)
  q('loopBtn').classList.toggle('on', g.doc.loop ? true : false)
  let idx = 0
  let best = 999
  for (let i = 0; i < FPS_SPEEDS.length; i++) {
    const d = Math.abs(FPS_SPEEDS[i] - g.doc.fps)
    if (d < best) {
      best = d
      idx = i
    }
  }
  const fr = q<HTMLInputElement>('fpsRange')
  if (document.activeElement !== fr) fr.value = String(idx)
  q('fpsVal').textContent = g.doc.fps + 'fps'
  q('fpsMain').textContent = g.doc.fps + 'fps'
  q('fpsTag').textContent = '・' + fps_speed_tag(g.doc.fps)
}

let zoomT: ReturnType<typeof setTimeout> | 0 = 0

function r_zoom(): void {
  const zl = q('zoomLabel')
  zl.textContent = Math.round(st().view.z * 100) + '%'
  zl.classList.add('on')
  if (zoomT) clearTimeout(zoomT)
  zoomT = setTimeout(() => zl.classList.remove('on'), 900)
}

function r_sound(): void {
  const g = st()
  const kinds = ['bgm0', 'bgm1', 'se0', 'se1', 'se2', 'se3']
  for (const k of kinds) {
    const slot = k.startsWith('bgm') ? g.snd.bgm[Number(k[3])] : g.snd.se[Number(k[2])]
    q('sname_' + k).textContent = slot.name || '--'
  }
  for (let i = 0; i < 4; i++) {
    const sel = q<HTMLSelectElement>('spre_se' + i)
    const nm = g.snd.se[i].name
    sel.value = sel.querySelector('option[value="' + nm + '"]') ? nm : ''
  }
  const bv = q<HTMLInputElement>('bgmVol')
  const sv = q<HTMLInputElement>('seVol')
  if (document.activeElement !== bv) bv.value = String(Math.round(g.snd.bgmVol * 100))
  if (document.activeElement !== sv) sv.value = String(Math.round(g.snd.seVol * 100))
  q('uisfxTgl').classList.toggle('on', pref_uisfx() ? true : false)
}

function r_save(): void {
  const sstate = store_state()
  const dot = q('saveDot')
  dot.classList.toggle('busy', sstate === 1)
  dot.classList.toggle('err', sstate === 2)
  dot.classList.toggle('on', sstate === 0 && (store_blink() ? true : false))
  dot.title = sstate === 1 ? '保存中…' : sstate === 2 ? '保存に失敗（再試行中）' : proj_dirty() ? '未保存の変更あり' : '自動保存ずみ'
}

const SHAPE_SET = [T_LINE, T_RECT, T_CIRCLE, T_STAR, T_HEART, T_PIXEL]

function r_selbar(): void {
  const g = st()
  const bar = q('selBar')
  const show = g.sel.has && g.flo.kind === K_NONE ? 1 : 0
  bar.classList.toggle('on', show ? true : false)
  if (!show) return
  const wrap = q('stageWrap')
  const bw = bar.offsetWidth || 180
  let sx = g.view.px + (g.sel.x + g.sel.w / 2) * g.view.z - bw / 2
  let sy = g.view.py + g.sel.y * g.view.z - (bar.offsetHeight || 56) - 10
  sx = clamp(sx, 6, Math.max(6, wrap.clientWidth - bw - 6))
  sy = clamp(sy, 6, Math.max(6, wrap.clientHeight - 60))
  bar.style.left = sx + 'px'
  bar.style.top = sy + 'px'
}

function r_dock(): void {
  const g = st()
  const t = g.pen.tool
  q('mp_draw').classList.toggle('on', t === T_PEN || t === T_ERASER)
  q('mp_fill').classList.toggle('on', t === T_FILL)
  q('mp_shape').classList.toggle('on', SHAPE_SET.indexOf(t) >= 0)
  q('mp_text').classList.toggle('on', t === T_TEXT)
  q('dockEraser').classList.toggle('on', t === T_ERASER)
  q('dockMain').classList.toggle('on', t === T_PEN)
  const d = TOOL_DEFS.find(x => x.t === t)
  const main = q('dockMain')
  main.classList.toggle('hasopts', tool_has_options(t) ? true : false)
  main.title = d && tool_has_options(t) ? d.label + 'の設定' : 'ほかのどうぐ'
  const cur = main.dataset.ic || ''
  if (d && cur !== d.icon) {
    main.dataset.ic = d.icon
    main.innerHTML = ic(d.icon)
  }
  q('dockChip').style.background = g.pen.color
  const dot = q('dockDot')
  const dpx = clamp(g.pen.size, 2, 26)
  dot.style.width = dpx + 'px'
  dot.style.height = dpx + 'px'
  const dc = q('dockColors')
  for (let i = 0; i < dc.children.length; i++) {
    const b = dc.children[i] as HTMLElement
    b.classList.toggle('on', (b.dataset.c || '').toLowerCase() === g.pen.color.toLowerCase())
  }
  const cv = q<HTMLCanvasElement>('lcThumbCv')
  const x = cv.getContext('2d') as CanvasRenderingContext2D
  x.clearRect(0, 0, cv.width, cv.height)
  x.fillStyle = '#ffffff'
  x.fillRect(0, 0, cv.width, cv.height)
  const src = live_canvas(g.pen.layer)
  if (src && src.width > 0) x.drawImage(src, 0, 0, cv.width, cv.height)
}

function r_settings(): void {
  const g = st()
  const gs = q<HTMLInputElement>('setGsize')
  const gn = q<HTMLInputElement>('setGsizeN')
  if (document.activeElement !== gs) gs.value = String(g.view.gsize)
  if (document.activeElement !== gn) gn.value = String(g.view.gsize)
  const so = q<HTMLInputElement>('setOnion')
  const shown = g.view.onion ? g.view.ocount : 0
  if (document.activeElement !== so) so.value = String(shown)
  q('setOnionV').textContent = shown ? String(shown) : 'オフ'
  q('setTheme').classList.toggle('on', pref_theme() ? true : false)
  q('setUisfx').classList.toggle('on', pref_uisfx() ? true : false)
  q('setVflip').classList.toggle('on', g.view.flip ? true : false)
  q('kitAdv').classList.toggle('on', pref_kit() ? false : true)
  q('kitBasic').classList.toggle('on', pref_kit() ? true : false)
}

function r_chrome(): void {
  const g = st()
  document.body.dataset.mode = g.doc.mode === MODE_DSI ? 'dsi' : g.doc.mode === MODE_3D ? '3d' : ''
  q('modeName').textContent = mode_name(g.doc.mode)
  const assist = q('motionAssistBtn')
  const runtime = mode_allows_runtime_anim(g.doc.mode)
  const animated = runtime ? animfx_active(g.doc.anim) : 0
  assist.classList.toggle('on', animated ? true : false)
  assist.title = runtime ? (animated ? '再生時のうごきが有効' : '手描きゆらぎとうごきの設定') : 'うごメモ系モードでは動きを実コマへ変換します'
  const mb = q('modeBadge')
  const mbn = g.doc.mode === MODE_NORMAL ? '' : mode_name(g.doc.mode)
  if (mb.textContent !== mbn) mb.textContent = mbn
  document.body.dataset.theme = pref_theme() ? 'dark' : ''
  document.body.dataset.vflip = g.view.flip ? '1' : '0'
  const tlopen = g.view.tlopen ? 1 : 0
  document.body.dataset.tl = tlopen ? '1' : '0'
  if (chrome_tlopen !== tlopen) {
    chrome_tlopen = tlopen
    if (tlopen) dirty(D_TIMELINE)
  }
  q('themeBtn').querySelector('.ic')?.remove()
  q('themeBtn').insertAdjacentHTML('afterbegin', ic(pref_theme() ? 'sun' : 'moon'))
  q('vflipBtn').classList.toggle('on', g.view.flip ? true : false)
  q('tlToggle').innerHTML = ic(g.view.tlopen ? 'down' : 'up')
  const ti = q<HTMLInputElement>('title')
  if (document.activeElement !== ti && ti.value !== g.doc.name) ti.value = g.doc.name
  const rs = q<HTMLSelectElement>('ratioSel')
  if (document.activeElement !== rs && rs.value !== g.doc.ratio) rs.value = g.doc.ratio
  const zs = q<HTMLSelectElement>('resoSel')
  if (document.activeElement !== zs && zs.value !== g.doc.res) zs.value = g.doc.res
  const [w, h] = [g.doc.w, g.doc.h]
  q('sizeNow').textContent = w + '×' + h
  q<HTMLSelectElement>('ratioSel').value = g.doc.ratio
  q<HTMLSelectElement>('resoSel').value = g.doc.res
  q<HTMLInputElement>('paperIn').value = g.doc.paper
}

function r_onion_ui(): void {
  const g = st()
  q('onionBtn').classList.toggle('on', g.view.onion ? true : false)
  const shown = g.view.onion ? g.view.ocount : 0
  q('onionCountVal').textContent = shown ? String(shown) : 'オフ'
  const oc = q<HTMLInputElement>('onionCount')
  if (document.activeElement !== oc) oc.value = String(shown)
}

function r_grid_ui(): void {
  q('gridBtn').classList.toggle('on', st().view.grid ? true : false)
}

function r_sel(): void {
  const g = st()
  const flo = flo_active()
  q('floBar').classList.toggle('on', flo ? true : false)
  if (flo) {
    const deg = Math.round((g.flo.rot * 180) / Math.PI) % 360
    q('floInfo').textContent = deg + '°・' + Math.round(Math.abs(g.flo.sx) * 100) + '%'
  }
}

function pat_previews(): void {
  const nodes = document.querySelectorAll('[data-patprev]')
  for (let k = 0; k < nodes.length; k++) {
    const c = nodes[k] as HTMLCanvasElement
    const pi = Number(c.dataset.patprev)
    const x = c.getContext('2d') as CanvasRenderingContext2D
    x.clearRect(0, 0, 28, 28)
    x.fillStyle = '#3A2E2A'
    const rows = PAT_TABLE[pi].rows
    const s = 3.5
    for (let y = 0; y < 8; y++) for (let px = 0; px < 8; px++) if ((rows[y] >> (7 - px)) & 1) x.fillRect(px * s, y * s, s, s)
  }
}

let flushing = 0

function flush(): void {
  let bits = flush_begin()
  if (!bits) return
  if (bits & D_TIMELINE) bits |= D_THUMB | D_FRAMEINFO
  flushing = 1
  try {
    for (const region of regions) {
      if (!(bits & region.mask)) continue
      try {
        region.fn()
      } catch (error) {
        report_error('再描画領域 ' + region.name + ' の更新に失敗しました', error)
      }
    }
  } finally {
    flushing = 0
    flush_end()
  }
}

let rafPending = 0

function schedule(): void {
  if (rafPending) return
  rafPending = 1
  requestAnimationFrame(() => {
    rafPending = 0
    flush()
  })
}

export function sync_mount(): void {
  if (mounted) return
  mounted = 1
  region_add('stage', D_STAGE | D_ZOOM | D_GRID | D_ONION, r_stage)
  region_add('timeline', D_TIMELINE, r_timeline)
  region_add('thumbs', D_THUMB, r_thumbs)
  region_add('frameinfo', D_FRAMEINFO, r_frameinfo)
  region_add('tools', D_TOOLS | D_MODE, r_tools)
  region_add('pen', D_PEN | D_MODE, r_pen)
  region_add('layer', D_LAYER | D_MODE, r_layer)
  region_add('play', D_PLAY, r_play)
  region_add('zoom', D_ZOOM, r_zoom)
  region_add('sound', D_SOUND, r_sound)
  region_add('save', D_SAVE, r_save)
  region_add('chrome', D_PAGE | D_MODE | D_ANIM, r_chrome)
  region_add('settings', D_PAGE | D_GRID | D_ONION | D_SOUND, r_settings)
  region_add('selbar', D_SEL | D_ZOOM | D_STAGE | D_TRANS, r_selbar)
  region_add('dock', D_PEN | D_TOOLS | D_PAGE | D_STAGE | D_LAYER, r_dock)
  region_add('onion_ui', D_ONION, r_onion_ui)
  region_add('grid_ui', D_GRID, r_grid_ui)
  region_add('sel', D_SEL | D_TOOLS | D_TRANS, r_sel)
  pat_previews()
  store_dirty_hook(schedule)
  schedule()
}

export function sync_flushing(): number {
  return flushing
}
