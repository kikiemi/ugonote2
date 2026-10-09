import { el, pointer_capture, pointer_release, q, toast } from '../dom'
import { DRAG_SLOP, LONGPRESS_MS } from '../h'
import { tr } from '../lang'
import { clamp } from '../lib'
import { modal_prompt_num } from '../panels'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { anim_playing } from '../state/commands/play'
import { st } from '../state/store'
import { tl_index_at } from '../sync'
import { ctx_show, ctx_show_above, pop_close, pop_is_anchored, pop_toggle } from './overlay'
import { anim_seek, anim_toggle } from './playback'
import { last_pointer_type, last_pointer_type_set } from './stage_input'

import { view_fit_if_stale } from './viewport'

let fsRoot: HTMLElement | null = null
const FS_EDGE = 62
const FS_SPEED = 17
type FsDrag = {
  on: number
  scrolling: number
  from: number
  to: number
  timer: ReturnType<typeof setTimeout> | 0
  sx: number
  sy: number
  x: number
  y: number
  sl: number
  ghost: HTMLElement | null
  pointerId: number
  captured: number
  touchId: number | null
  raf: number
  lock: number
}
const FS_DRAG_IDLE: FsDrag = { on: 0, scrolling: 0, from: -1, to: -1, timer: 0, sx: 0, sy: 0, x: 0, y: 0, sl: 0, ghost: null, pointerId: -1, captured: 0, touchId: null, raf: 0, lock: 0 }
let fsDrag: FsDrag = { ...FS_DRAG_IDLE }

function fs_ctx(e: MouseEvent, i: number): void {
  e.preventDefault()
  if (last_pointer_type() === 'touch') return
  dispatch('frame.goto', i)
  ctx_show(e.clientX, e.clientY, [
    { label: '複製', icon: 'dup', fn: () => dispatch('frame.dup', null) },
    { label: 'コピー', icon: 'select', fn: () => dispatch('frame.copy', null) },
    { label: 'はりつけ', icon: 'paste', fn: () => dispatch('frame.paste', null) },
    { label: 'ここからループA', icon: 'ab', fn: () => ab_set_a(i) },
    { label: 'ここまでループB', icon: 'ab', fn: () => ab_set_b(i) },
    { label: '削除', icon: 'trash', fn: () => dispatch('frame.del', null) },
  ])
}

function ab_set_a(i: number): void {
  dispatch('doc.set_loop_a', i)
  toast('ループのはじまり: ' + (i + 1))
}

function ab_set_b(i: number): void {
  dispatch('doc.set_loop_b', i)
  toast('ループのおわり: ' + (i + 1))
}

export function ab_cycle(): void {
  const g = st()
  const cur = g.doc.cur
  if (g.doc.loopA < 0) {
    ab_set_a(cur)
    return
  }
  if (g.doc.loopB < 0) {
    if (cur < g.doc.loopA) {
      ab_set_a(cur)
      return
    }
    ab_set_b(cur)
    return
  }
  dispatch('doc.clear_loop_ab', null)
  toast('A-Bループを解除')
  sfx_play('tap')
}

export function frame_home(): void {
  if (dispatch('frame.goto', 0) === 0) sfx_play('tap')
}

export function frame_last(): void {
  if (dispatch('frame.goto', st().doc.frames.length - 1) === 0) sfx_play('tap')
}

function frame_duplicate(): void {
  dispatch('frame.dup', null)
}

export function loop_toggle(): void {
  dispatch('doc.toggle_loop', null)
  toast(st().doc.loop ? 'ループ再生：オン' : 'ループ再生：オフ')
  sfx_play('tap')
}

function hold_toggle(anchor: HTMLElement): void {
  pop_toggle('popHold', anchor)
}

function fps_toggle(anchor: HTMLElement): void {
  pop_toggle('popFps', anchor)
}

function timeline_toggle(): void {
  dispatch('view.toggle_timeline', null)
  view_fit_if_stale()
  sfx_play('tap')
}

function tl_more_open(): void {
  const g = st()
  const button = q('tlMoreBtn')
  if (pop_is_anchored(button)) {
    pop_close()
    return
  }
  pop_close()
  const items = [
    { label: tr('さいしょのコマへ'), icon: 'skipback', fn: frame_home, off: g.doc.cur === 0 ? 1 : 0 },
    { label: tr('さいごのコマへ'), icon: 'last', fn: frame_last, off: g.doc.cur === g.doc.frames.length - 1 ? 1 : 0 },
    { label: tr(g.doc.loop ? 'ループを解除' : 'ループ再生'), icon: 'loop', fn: loop_toggle },
    { label: tr('A-B区間ループ'), icon: 'ab', fn: ab_cycle },
    { label: tr('このコマの表示時間'), icon: 'clock', fn: () => hold_toggle(button) },
    { label: tr('コマをうつす'), icon: 'swap', off: g.doc.frames.length <= 1 ? 1 : 0, fn: () => {
      const frameId = st().doc.frames[st().doc.cur].id
      modal_prompt_num('コマをうつす', 'このコマを何コマ目に置く？（1〜' + st().doc.frames.length + '）', st().doc.cur + 1, 1, st().doc.frames.length, v => {
        const from = st().doc.frames.findIndex(frame => frame.id === frameId)
        if (from >= 0 && dispatch('frame.move', { a: from, b: v - 1 }) === 0) sfx_play('move')
      })
    } },
    { label: tr('コマを複製'), icon: 'dup', fn: frame_duplicate },
    { label: tr('コマを削除'), icon: 'trash', fn: () => dispatch('frame.del', null), off: g.doc.frames.length <= 1 ? 1 : 0 },
    { label: tr('はやさ'), icon: 'clock', fn: () => fps_toggle(button) },
    {
      label: tr(g.view.tlopen ? 'コマ一覧を閉じる' : 'コマ一覧を開く'),
      icon: g.view.tlopen ? 'down' : 'up',
      fn: timeline_toggle,
    },
  ]
  ctx_show_above(button, items)
}

export function fs_drag_clear(): void {
  if (fsDrag.pointerId < 0 && fsDrag.touchId === null && !fsDrag.timer && !fsDrag.ghost && !fsDrag.scrolling) return
  if (fsDrag.timer) clearTimeout(fsDrag.timer)
  if (fsDrag.raf) cancelAnimationFrame(fsDrag.raf)
  const fs = fsRoot
  const pointerId = fsDrag.pointerId
  const captured = fsDrag.captured
  if (fs) {
    for (const cell of fs.querySelectorAll<HTMLElement>('.fcell')) {
      cell.classList.remove('drop')
      cell.classList.remove('lift')
    }
  }
  if (fsDrag.ghost) fsDrag.ghost.remove()
  if (fs && fsDrag.lock) fs.style.overflowX = ''
  fsDrag = { ...FS_DRAG_IDLE }
  if (fs && captured && pointerId >= 0) pointer_release(fs, pointerId)
}

function fs_cell_index(cell: HTMLElement | null): number {
  if (!cell) return -1
  const raw = cell.dataset.i
  if (raw === undefined || raw === '') return -1
  const index = Number(raw)
  return index >= 0 ? index : -1
}

function fs_marks(): void {
  const fs = fsRoot
  if (!fs) return
  for (const cell of fs.querySelectorAll<HTMLElement>('.fcell')) {
    const index = fs_cell_index(cell)
    const lifted = fsDrag.on === 1 && index >= 0 && index === fsDrag.from
    const dropped = fsDrag.on === 1 && index >= 0 && index === fsDrag.to && index !== fsDrag.from
    cell.classList.toggle('lift', lifted)
    cell.classList.toggle('drop', dropped)
  }
}

function fs_ghost_place(): void {
  if (!fsDrag.ghost) return
  fsDrag.ghost.style.left = fsDrag.x - 35 + 'px'
  fsDrag.ghost.style.top = fsDrag.y - 60 + 'px'
}

function fs_hover(): void {
  fsDrag.to = tl_index_at(fsDrag.x)
  fs_marks()
}

function fs_autoscroll(): void {
  fsDrag.raf = 0
  const fs = fsRoot
  if (!fs || !fsDrag.on) return
  const max = fs.scrollWidth - fs.clientWidth
  if (max > 0) {
    const r = fs.getBoundingClientRect()
    const left = fsDrag.x - r.left
    const right = r.right - fsDrag.x
    let dx = 0
    if (left < FS_EDGE) dx = -Math.ceil(((FS_EDGE - Math.max(left, -FS_EDGE)) / FS_EDGE) * FS_SPEED)
    else if (right < FS_EDGE) dx = Math.ceil(((FS_EDGE - Math.max(right, -FS_EDGE)) / FS_EDGE) * FS_SPEED)
    if (dx) {
      const before = fs.scrollLeft
      fs.scrollLeft = clamp(before + dx, 0, max)
      if (fs.scrollLeft !== before) fsDrag.sl = fs.scrollLeft
    }
  }
  fs_hover()
  fsDrag.raf = requestAnimationFrame(fs_autoscroll)
}

function fs_drag_begin(cell: HTMLElement): void {
  const canvas = cell.querySelector<HTMLCanvasElement>('canvas')
  if (!canvas) {
    fs_drag_clear()
    return
  }
  fsDrag.timer = 0
  fsDrag.on = 1
  const fs = fsRoot
  if (fs && fsDrag.touchId !== null) {
    fsDrag.lock = 1
    fs.style.overflowX = 'hidden'
  }
  const ghost = el('div', '', '')
  ghost.id = 'fsGhost'
  ghost.draggable = false
  const ghostCanvas = canvas.cloneNode(true) as HTMLCanvasElement
  ghostCanvas.draggable = false
  const context = ghostCanvas.getContext('2d')
  if (context) context.drawImage(canvas, 0, 0)
  ghost.appendChild(ghostCanvas)
  document.body.appendChild(ghost)
  fsDrag.ghost = ghost
  fs_ghost_place()
  fs_marks()
  fsDrag.raf = requestAnimationFrame(fs_autoscroll)
  sfx_play('move')
}

function fs_drag_track(x: number, y: number): void {
  if (!fsDrag.on) {
    const fs = fsRoot
    if (fs && fs.scrollLeft !== fsDrag.sl) {
      fs_drag_clear()
      return
    }
    if (Math.hypot(x - fsDrag.sx, y - fsDrag.sy) > DRAG_SLOP) fs_drag_clear()
    return
  }
  fsDrag.x = x
  fsDrag.y = y
  fs_ghost_place()
  fs_hover()
}

function fs_drag_finish(cell: HTMLElement | null, canceled: number): void {
  const from = fsDrag.from
  const to = fsDrag.to
  const wasDrag = fsDrag.on
  fs_drag_clear()
  if (canceled) return
  if (wasDrag) {
    if (to !== from) dispatch('frame.move', { a: from, b: to })
    return
  }
  const index = fs_cell_index(cell)
  if (index < 0) return
  if (anim_playing()) {
    anim_seek(index)
    return
  }
  if (index !== st().doc.cur) {
    dispatch('frame.goto', index)
    sfx_play('tap')
  }
}

function fs_press(fs: HTMLElement, cell: HTMLElement, x: number, y: number): number {
  const from = fs_cell_index(cell)
  if (from < 0) return 0
  fsDrag.from = from
  fsDrag.to = from
  fsDrag.on = 0
  fsDrag.scrolling = 0
  fsDrag.sx = x
  fsDrag.sy = y
  fsDrag.x = x
  fsDrag.y = y
  fsDrag.sl = fs.scrollLeft
  return 1
}

function fs_touch_of(list: TouchList): Touch | null {
  for (let i = 0; i < list.length; i++) if (list[i].identifier === fsDrag.touchId) return list[i]
  return null
}

function fs_closest_cell(node: EventTarget | null): HTMLElement | null {
  const target = node as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return null
  return target.closest('.fcell') as HTMLElement | null
}

export function fs_pointer(fs: HTMLElement): void {
  fsRoot = fs
  fs.addEventListener('pointerdown', e => {
    last_pointer_type_set(e.pointerType)
    if (e.pointerType === 'touch') return
    const cell = fs_closest_cell(e.target)
    if (!cell || e.button === 2) return
    if (fsDrag.on && fsDrag.touchId !== null) return
    fs_drag_clear()
    if (!fs_press(fs, cell, e.clientX, e.clientY)) return
    const from = fsDrag.from
    fsDrag.pointerId = e.pointerId
    fsDrag.timer = setTimeout(() => {
      if (fsDrag.pointerId !== e.pointerId || fsDrag.from !== from) return
      fsDrag.captured = pointer_capture(fs, e.pointerId)
      fs_drag_begin(cell)
    }, LONGPRESS_MS)
  })
  fs.addEventListener(
    'touchstart',
    e => {
      if (e.touches.length > 1) {
        fs_drag_clear()
        return
      }
      const t = e.changedTouches[0]
      if (!t) return
      const cell = fs_closest_cell(t.target)
      if (!cell) return
      if (e.cancelable) e.preventDefault()
      fs_drag_clear()
      if (!fs_press(fs, cell, t.clientX, t.clientY)) return
      const from = fsDrag.from
      const id = t.identifier
      fsDrag.touchId = id
      fsDrag.timer = setTimeout(() => {
        if (fsDrag.touchId !== id || fsDrag.from !== from) return
        if (fs.scrollLeft !== fsDrag.sl) {
          fs_drag_clear()
          return
        }
        fs_drag_begin(cell)
      }, LONGPRESS_MS)
    },
    { passive: false }
  )
  window.addEventListener(
    'touchmove',
    e => {
      if (fsDrag.touchId === null || fsDrag.from < 0) return
      const t = fs_touch_of(e.touches)
      if (!t) return
      if (e.cancelable) e.preventDefault()
      if (!fsDrag.on) {
        const dx = t.clientX - fsDrag.sx
        const dy = t.clientY - fsDrag.sy
        if (!fsDrag.scrolling && Math.hypot(dx, dy) > DRAG_SLOP) {
          if (fsDrag.timer) clearTimeout(fsDrag.timer)
          fsDrag.timer = 0
          fsDrag.scrolling = 1
        }
        if (fsDrag.scrolling) {
          const max = Math.max(0, fs.scrollWidth - fs.clientWidth)
          fs.scrollLeft = clamp(fsDrag.sl - dx, 0, max)
          fsDrag.x = t.clientX
          fsDrag.y = t.clientY
          return
        }
      }
      fs_drag_track(t.clientX, t.clientY)
    },
    { passive: false, capture: true }
  )
  const touch_finish = (e: TouchEvent): void => {
    if (fsDrag.touchId === null || fsDrag.from < 0) return
    const t = fs_touch_of(e.changedTouches)
    if (!t) {
      if (!fs_touch_of(e.touches)) fs_drag_clear()
      return
    }
    if (e.cancelable) e.preventDefault()
    if (fsDrag.scrolling) {
      fs_drag_clear()
      return
    }
    if (fsDrag.on) fs_drag_track(t.clientX, t.clientY)
    fs_drag_finish(fs_closest_cell(t.target), e.type === 'touchcancel' ? 1 : 0)
  }
  window.addEventListener('touchstart', e => {
    if (fsDrag.touchId !== null && e.touches.length > 1) fs_drag_clear()
  }, { passive: true, capture: true })
  window.addEventListener('touchend', touch_finish, { passive: false, capture: true })
  window.addEventListener('touchcancel', touch_finish, { passive: false, capture: true })
  const move = (e: PointerEvent): void => {
    if (fsDrag.touchId !== null || e.pointerId !== fsDrag.pointerId || fsDrag.from < 0) return
    fs_drag_track(e.clientX, e.clientY)
  }
  const finish = (e: PointerEvent): void => {
    if (fsDrag.touchId !== null || e.pointerId !== fsDrag.pointerId || fsDrag.from < 0) return
    fs_drag_finish(fs_closest_cell(e.target), e.type === 'pointercancel' ? 1 : 0)
  }
  const lost = (e: PointerEvent): void => {
    if (fsDrag.touchId === null && e.pointerId === fsDrag.pointerId && fsDrag.from >= 0) fs_drag_clear()
  }
  const pointerOut = (e: PointerEvent): void => {
    if (fsDrag.touchId !== null || e.pointerId !== fsDrag.pointerId || e.relatedTarget !== null || fsDrag.captured) return
    fs_drag_clear()
  }
  window.addEventListener('pointermove', move, { capture: true })
  window.addEventListener('pointerup', finish, { capture: true })
  window.addEventListener('pointercancel', finish, { capture: true })
  window.addEventListener('pointerout', pointerOut, { capture: true })
  fs.addEventListener('lostpointercapture', lost)
  fs.addEventListener('contextmenu', e => {
    const cell = fs_closest_cell(e.target)
    if (!cell) return
    fs_ctx(e, Number(cell.dataset.i))
  })
  fs.addEventListener('dragstart', e => {
    e.preventDefault()
  })
  fs.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault()
      fs.scrollLeft += e.deltaY
    }
  })
}

export function tl_events(): void {
  const g = st()
  q('prevBtn').addEventListener('click', () => {
    if (dispatch('frame.step', -1) === 0) sfx_play('tap')
  })
  q('nextBtn').addEventListener('click', () => {
    if (dispatch('frame.step', 1) === 0) sfx_play('tap')
  })
  q('homeBtn').addEventListener('click', frame_home)
  q('lastBtn').addEventListener('click', frame_last)
  q('frameNo').addEventListener('click', () => {
    dispatch('play.stop', null)
    modal_prompt_num('コマへジャンプ', '何コマ目にとぶ？（1〜' + g.doc.frames.length + '）', g.doc.cur + 1, 1, g.doc.frames.length, v => {
      dispatch('frame.goto', v - 1)
    })
  })
  q('playBtn').addEventListener('click', () => anim_toggle())
  q('loopBtn').addEventListener('click', loop_toggle)
  q('abBtn').addEventListener('click', ab_cycle)
  q('fpsBtn').addEventListener('click', () => fps_toggle(q('fpsBtn')))
  q('holdBtn').addEventListener('click', () => hold_toggle(q('holdBtn')))
  q('addBtn').addEventListener('click', () => dispatch('frame.add', null))
  q('dupBtn').addEventListener('click', frame_duplicate)
  q('delBtn').addEventListener('click', () => dispatch('frame.del', null))
  q('tlToggle').addEventListener('click', timeline_toggle)
  q('tlClose').addEventListener('click', () => { if (st().view.tlopen) timeline_toggle() })
  q('tlMoreBtn').addEventListener('click', tl_more_open)
  q<HTMLInputElement>('fpsRange').addEventListener('input', e => {
    dispatch('doc.set_fps_idx', Number((e.target as HTMLInputElement).value))
  })
  q<HTMLInputElement>('holdRange').addEventListener('input', e => {
    const cur = g.doc.cur
    dispatch('frame.set_hold_range', { a: cur, b: cur, hold: Number((e.target as HTMLInputElement).value) })
  })
}

