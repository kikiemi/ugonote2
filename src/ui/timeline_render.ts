import { tr_line } from '../lang'
import { el, q, query } from '../dom'
import { THUMB_H, THUMB_W } from '../h'
import { clamp } from '../lib'
import { anim_hold_of, anim_playhead } from '../state/commands/play'
import { st } from '../state/store'
import { thumb_get, thumb_rev } from '../thumb'

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
    const th = thumb_get(i, 1)
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

export function r_timeline(): void {
  const g = st()
  const n = g.doc.frames.length
  tlStep = tl_step()
  fs_track().style.width = Math.max(0, n * tlStep - 7) + 'px'
  tl_window(1)
  tl_scroll_to_head()
}

export function r_thumbs(): void {
  tl_window(0)
}

export function r_frameinfo(): void {
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
  frame_no.title = tr_line(frame_current + ' / ' + frame_count + '。番号を指定して移動')
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

