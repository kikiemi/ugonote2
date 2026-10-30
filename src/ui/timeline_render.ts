import { tr_line } from '../lang'
import { el, ic, q, query } from '../dom'
import { thumb_h, thumb_w } from '../h'
import { clamp } from '../lib'
import { anim_hold_of, anim_playhead } from '../state/commands/play'
import { st } from '../state/store'
import { thumb_get, thumb_rev } from '../thumb'

const tl_buf = 5

let tl_pool: HTMLElement[] = []
let timeline_cell_step = 93
let tl_head = -1

function fs_track(): HTMLElement {
  const fs = q('fs')
  let t = document.getElementById('fs_track')
  if (!t) {
    t = el('div', '', '')
    t.id = 'fs_track'
    fs.appendChild(t)
    fs.addEventListener('scroll', () => tl_window(0), { passive: true })
  }
  return t
}

function fs_cell(): HTMLElement {
  const d = el('div', 'fcell', '')
  const c = document.createElement('canvas')
  c.width = thumb_w
  c.height = thumb_h
  d.appendChild(c)
  d.appendChild(el('span', 'fno', ''))
  d.appendChild(el('span', 'fhold', ''))
  d.appendChild(el('span', 'fse', ''))
  d.appendChild(el('span', 'abm a', ic('loop') + 'A'))
  d.appendChild(el('span', 'abm b', ic('loop') + 'B'))
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
    cell.style.left = i * timeline_cell_step + 'px'
    cell.style.display = ''
    const num = cell.querySelector('.fno') as HTMLElement
    num.textContent = String(i + 1)
    cell.dataset.tk = ''
  }
  const rev = thumb_rev(i)
  const want_tk = rev + '|' + (i === g.doc.cur ? 'c' : '')
  if (cell.dataset.tk !== want_tk || i === g.doc.cur) {
    const c = cell.querySelector('canvas') as HTMLCanvasElement
    const x = c.getContext('2d') as CanvasRenderingContext2D
    x.clearRect(0, 0, thumb_w, thumb_h)
    const th = thumb_get(i, 1)
    if (th) x.drawImage(th, 0, 0)
    cell.dataset.tk = thumb_rev(i) + '|' + (i === g.doc.cur ? 'c' : '')
  }
  const fh = cell.querySelector('.fhold') as HTMLElement
  const want_h = f.hold > 1 ? '×' + f.hold : ''
  if (fh.textContent !== want_h) fh.textContent = want_h
  // このコマで鳴らす効果音。音の番号を色つきの丸で出す。
  let dots = f.se ? ic('sound') : ''
  if (f.se) for (let k = 0; k < 4; k++) if (f.se & (1 << k)) dots += '<i class="d' + k + '">' + (k + 1) + '</i>'
  const fse = cell.querySelector('.fse') as HTMLElement
  if (fse.dataset.se !== String(f.se)) {
    fse.dataset.se = String(f.se)
    fse.innerHTML = dots
  }
  const a = g.doc.loop_a
  const b = g.doc.loop_b
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
  const first = Math.max(0, Math.floor(fs.scrollLeft / timeline_cell_step) - tl_buf)
  const last = Math.min(n - 1, Math.ceil((fs.scrollLeft + fs.clientWidth) / timeline_cell_step) + tl_buf)
  const need = Math.max(0, last - first + 1)
  while (tl_pool.length < need) {
    const c = fs_cell()
    tl_pool.push(c)
    track.appendChild(c)
  }
  for (let k = 0; k < tl_pool.length; k++) {
    const cell = tl_pool[k]
    const i = first + k
    if (k >= need) {
      cell.style.display = 'none'
      cell.dataset.i = ''
      continue
    }
    if (force) cell.dataset.tk = ''
    fs_assign(cell, i, head)
  }
  tl_head = head
}

export function tl_index_at(client_x: number): number {
  const fs = q('fs')
  const r = fs.getBoundingClientRect()
  const x = client_x - r.left + fs.scrollLeft
  const n = st().doc.frames.length
  return clamp(Math.round(x / timeline_cell_step - 0.5), 0, Math.max(0, n - 1))
}

function tl_scroll_to_head(): void {
  const fs = q('fs')
  const head = anim_playhead()
  const want = head * timeline_cell_step - fs.clientWidth / 2 + timeline_cell_step / 2
  const max = fs.scrollWidth - fs.clientWidth
  const to = clamp(want, 0, Math.max(0, max))
  if (Math.abs(fs.scrollLeft - to) > 1) fs.scrollLeft = to
}

export function r_timeline(): void {
  const g = st()
  const n = g.doc.frames.length
  timeline_cell_step = tl_step()
  fs_track().style.width = Math.max(0, n * timeline_cell_step - 7) + 'px'
  tl_window(1)
  tl_scroll_to_head()
}

export function r_thumbs(): void {
  tl_window(0)
}

export function r_frameinfo(): void {
  const g = st()
  const head = anim_playhead()
  const frame_no = q('frame_no')
  const frame_count = g.doc.frames.length
  const frame_current = head + 1
  const frame_long = frame_current > 99 || frame_count > 99
  const frame_xlong = frame_current > 999 || frame_count > 999
  frame_no.textContent = frame_long ? frame_current + '/' + frame_count : frame_current + ' / ' + frame_count
  frame_no.classList.toggle('long', frame_long)
  frame_no.classList.toggle('xlong', frame_xlong)
  frame_no.title = tr_line(frame_current + ' / ' + frame_count + '。番号を指定して移動')
  frame_no.setAttribute('aria-label', frame_no.title)
  const can_delete = frame_count > 1
  const first_button = q<HTMLButtonElement>('home_btn')
  const last_button = q<HTMLButtonElement>('last_btn')
  first_button.classList.toggle('off', frame_current === 1)
  first_button.disabled = frame_current === 1
  first_button.setAttribute('aria-disabled', frame_current === 1 ? 'true' : 'false')
  last_button.classList.toggle('off', frame_current === frame_count)
  last_button.disabled = frame_current === frame_count
  last_button.setAttribute('aria-disabled', frame_current === frame_count ? 'true' : 'false')
  const delete_button = q<HTMLButtonElement>('del_btn')
  delete_button.classList.toggle('off', !can_delete)
  delete_button.disabled = !can_delete
  delete_button.setAttribute('aria-disabled', can_delete ? 'false' : 'true')
  const hold = anim_hold_of(g.doc.cur)
  q('hold_label').textContent = '×' + hold
  const hr = q<HTMLInputElement>('hold_range')
  if (document.activeElement !== hr) hr.value = String(hold)
  q('hold_val').textContent = '×' + hold
  const a = g.doc.loop_a
  const b = g.doc.loop_b
  q('ab_btn').classList.toggle('on', a >= 0 || b >= 0)
  if (head !== tl_head) {
    tl_scroll_to_head()
    tl_window(0)
  }
}

