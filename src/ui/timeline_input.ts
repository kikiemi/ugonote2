import { thumb_get } from '../thumb'
import { workspace_timeline_set } from './responsive'
import { el, pointer_capture, pointer_release, q, toast } from '../dom'
import { drag_slop, longpress_ms, thumb_w, thumb_h } from '../h'
import { tr } from '../lang'
import { clamp } from '../lib'
import { modal_addmany, modal_prompt_num } from './modal'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { anim_playing } from '../state/commands/play'
import { st } from '../state/store'
import { tl_index_at } from './timeline_render'
import { ctx_show, ctx_show_above, pop_close, pop_is_anchored, pop_toggle } from './overlay'
import { anim_seek, anim_toggle } from './playback'
import { last_pointer_type, last_pointer_type_set } from './stage_input'


let fs_root: HTMLElement | null = null
const fs_edge = 62
const fs_speed = 17
type fs_drag_t = {
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
  pointer_id: number
  captured: number
  touch: number
  from_id: number
  raf: number
}
const fs_drag_idle: fs_drag_t = { on: 0, scrolling: 0, from: -1, to: -1, timer: 0, sx: 0, sy: 0, x: 0, y: 0, sl: 0, ghost: null, pointer_id: -1, captured: 0, touch: 0, from_id: -1, raf: 0 }
let fs_drag: fs_drag_t = { ...fs_drag_idle }

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
  if (g.doc.loop_a < 0) {
    ab_set_a(cur)
    return
  }
  if (g.doc.loop_b < 0) {
    if (cur < g.doc.loop_a) {
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
  pop_toggle('pop_hold', anchor)
}

function fps_toggle(anchor: HTMLElement): void {
  pop_toggle('pop_fps', anchor)
}

function timeline_toggle(): void {
  workspace_timeline_set(st().view.tlopen ? 0 : 1)
  sfx_play('tap')
}

function tl_more_open(): void {
  const g = st()
  const button = q('tl_more_btn')
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
      const frame_id = st().doc.frames[st().doc.cur].id
      modal_prompt_num('コマをうつす', 'このコマを何コマ目に置く？（1〜' + st().doc.frames.length + '）', st().doc.cur + 1, 1, st().doc.frames.length, v => {
        const from = st().doc.frames.findIndex(frame => frame.id === frame_id)
        if (from >= 0 && dispatch('frame.move', { a: from, b: v - 1 }) === 0) sfx_play('move')
      })
    } },
    { label: tr('コマを複製'), icon: 'dup', fn: frame_duplicate },
    { label: tr('まとめて追加'), icon: 'many', fn: modal_addmany },
    { label: tr('コマを削除'), icon: 'trash', fn: () => dispatch('frame.del', null), off: g.doc.frames.length <= 1 ? 1 : 0 },
    { label: tr('はやさ'), icon: 'clock', fn: () => fps_toggle(button) },
    { label: tr('みえかた'), icon: 'onion', fn: () => pop_toggle('pop_view', button) },
    {
      label: tr(g.view.tlopen ? 'コマ一覧を閉じる' : 'コマ一覧を開く'),
      icon: g.view.tlopen ? 'down' : 'up',
      fn: timeline_toggle,
    },
  ]
  ctx_show_above(button, items)
}

export function fs_drag_clear(): void {
  if (fs_drag.pointer_id < 0 && !fs_drag.timer && !fs_drag.ghost && !fs_drag.scrolling) return
  if (fs_drag.timer) clearTimeout(fs_drag.timer)
  if (fs_drag.raf) cancelAnimationFrame(fs_drag.raf)
  const fs = fs_root
  const pointer_id = fs_drag.pointer_id
  const captured = fs_drag.captured
  if (fs) {
    for (const cell of fs.querySelectorAll<HTMLElement>('.fcell')) {
      cell.classList.remove('drop')
      cell.classList.remove('lift')
    }
  }
  if (fs_drag.ghost) fs_drag.ghost.remove()
  fs_drag = { ...fs_drag_idle }
  if (fs && captured && pointer_id >= 0) pointer_release(fs, pointer_id)
}

function fs_cell_index(cell: HTMLElement | null): number {
  if (!cell) return -1
  const raw = cell.dataset.i
  if (raw === undefined || raw === '') return -1
  const index = Number(raw)
  return index >= 0 ? index : -1
}

function fs_marks(): void {
  const fs = fs_root
  if (!fs) return
  for (const cell of fs.querySelectorAll<HTMLElement>('.fcell')) {
    const index = fs_cell_index(cell)
    const lifted = fs_drag.on === 1 && index >= 0 && st().doc.frames[index]?.id === fs_drag.from_id
    const dropped = fs_drag.on === 1 && index >= 0 && index === fs_drag.to && index !== fs_drag.from
    cell.classList.toggle('lift', lifted)
    cell.classList.toggle('drop', dropped)
  }
}

function fs_ghost_place(): void {
  if (!fs_drag.ghost) return
  fs_drag.ghost.style.left = fs_drag.x - 35 + 'px'
  fs_drag.ghost.style.top = fs_drag.y - 60 + 'px'
}

function fs_hover(): void {
  fs_drag.to = tl_index_at(fs_drag.x)
  fs_marks()
}

function fs_autoscroll(): void {
  fs_drag.raf = 0
  const fs = fs_root
  if (!fs || !fs_drag.on) return
  const max = fs.scrollWidth - fs.clientWidth
  if (max > 0) {
    const r = fs.getBoundingClientRect()
    const left = fs_drag.x - r.left
    const right = r.right - fs_drag.x
    let dx = 0
    if (left < fs_edge) dx = -Math.ceil(((fs_edge - Math.max(left, -fs_edge)) / fs_edge) * fs_speed)
    else if (right < fs_edge) dx = Math.ceil(((fs_edge - Math.max(right, -fs_edge)) / fs_edge) * fs_speed)
    if (dx) {
      const before = fs.scrollLeft
      fs.scrollLeft = clamp(before + dx, 0, max)
      if (fs.scrollLeft !== before) fs_drag.sl = fs.scrollLeft
    }
  }
  fs_hover()
  fs_drag.raf = requestAnimationFrame(fs_autoscroll)
}

function fs_drag_begin(): void {
  const from = st().doc.frames.findIndex(frame => frame.id === fs_drag.from_id)
  if (from < 0) {
    fs_drag_clear()
    return
  }
  fs_drag.from = from
  fs_drag.timer = 0
  fs_drag.on = 1
  const canvas = thumb_get(from, 1)
  const ghost = el('div', '', '')
  ghost.id = 'fs_ghost'
  ghost.draggable = false
  const ghost_canvas = document.createElement('canvas')
  ghost_canvas.width = canvas ? canvas.width : thumb_w
  ghost_canvas.height = canvas ? canvas.height : thumb_h
  ghost_canvas.draggable = false
  if (canvas) ghost_canvas.getContext('2d')!.drawImage(canvas, 0, 0)
  ghost.appendChild(ghost_canvas)
  document.body.appendChild(ghost)
  fs_drag.ghost = ghost
  fs_ghost_place()
  fs_marks()
  fs_drag.raf = requestAnimationFrame(fs_autoscroll)
  sfx_play('move')
}

function fs_drag_track(x: number, y: number): void {
  if (!fs_drag.on) {
    const fs = fs_root
    if (fs && fs.scrollLeft !== fs_drag.sl) {
      fs_drag_clear()
      return
    }
    if (Math.hypot(x - fs_drag.sx, y - fs_drag.sy) > drag_slop) fs_drag_clear()
    return
  }
  fs_drag.x = x
  fs_drag.y = y
  fs_ghost_place()
  fs_hover()
}

function fs_drag_finish(canceled: number): void {
  const id = fs_drag.from_id
  const to = fs_drag.to
  const was_drag = fs_drag.on
  const scrolling = fs_drag.scrolling
  fs_drag_clear()
  if (canceled || scrolling) return
  const from = st().doc.frames.findIndex(frame => frame.id === id)
  if (from < 0) return
  if (was_drag) {
    if (to !== from) dispatch('frame.move', { a: from, b: to })
    return
  }
  if (anim_playing()) {
    anim_seek(from)
    return
  }
  if (from !== st().doc.cur) {
    dispatch('frame.goto', from)
    sfx_play('tap')
  }
}

function fs_press(fs: HTMLElement, cell: HTMLElement, x: number, y: number): number {
  const from = fs_cell_index(cell)
  if (from < 0) return 0
  fs_drag.from = from
  fs_drag.from_id = st().doc.frames[from].id
  fs_drag.to = from
  fs_drag.on = 0
  fs_drag.scrolling = 0
  fs_drag.sx = x
  fs_drag.sy = y
  fs_drag.x = x
  fs_drag.y = y
  fs_drag.sl = fs.scrollLeft
  return 1
}

function fs_closest_cell(node: EventTarget | null): HTMLElement | null {
  const target = node as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return null
  return target.closest('.fcell') as HTMLElement | null
}

export function fs_pointer(fs: HTMLElement): void {
  fs_root = fs
  const touches = new Set<number>()
  window.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return
    touches.add(e.pointerId)
    if (touches.size > 1) fs_drag_clear()
  }, { capture: true })
  fs.addEventListener('pointerdown', e => {
    last_pointer_type_set(e.pointerType)
    if (e.button !== 0 || touches.size > 1) return
    const cell = fs_closest_cell(e.target)
    if (!cell) return
    e.preventDefault()
    fs_drag_clear()
    if (!fs_press(fs, cell, e.clientX, e.clientY)) return
    fs_drag.pointer_id = e.pointerId
    fs_drag.touch = e.pointerType === 'touch' ? 1 : 0
    fs_drag.captured = pointer_capture(fs, e.pointerId)
    const id = fs_drag.from_id
    fs_drag.timer = setTimeout(() => {
      if (fs_drag.pointer_id !== e.pointerId || fs_drag.from_id !== id) return
      if (fs.scrollLeft !== fs_drag.sl) {
        fs_drag_clear()
        return
      }
      fs_drag_begin()
    }, longpress_ms)
  })
  const move = (e: PointerEvent): void => {
    if (e.pointerId !== fs_drag.pointer_id || fs_drag.from < 0) return
    if (e.cancelable) e.preventDefault()
    if (fs_drag.touch && !fs_drag.on) {
      const dx = e.clientX - fs_drag.sx
      const dy = e.clientY - fs_drag.sy
      if (!fs_drag.scrolling && Math.hypot(dx, dy) > drag_slop) {
        if (fs_drag.timer) clearTimeout(fs_drag.timer)
        fs_drag.timer = 0
        fs_drag.scrolling = 1
      }
      if (fs_drag.scrolling) {
        fs.scrollLeft = clamp(fs_drag.sl - dx, 0, Math.max(0, fs.scrollWidth - fs.clientWidth))
        fs_drag.x = e.clientX
        fs_drag.y = e.clientY
        return
      }
    }
    fs_drag_track(e.clientX, e.clientY)
  }
  const finish = (e: PointerEvent): void => {
    touches.delete(e.pointerId)
    if (e.pointerId !== fs_drag.pointer_id || fs_drag.from < 0) return
    if (e.cancelable) e.preventDefault()
    if (fs_drag.on) fs_drag_track(e.clientX, e.clientY)
    const rect = fs.getBoundingClientRect()
    const outside = e.clientX < rect.left || e.clientX >= rect.right || e.clientY < rect.top || e.clientY >= rect.bottom
    fs_drag_finish(e.type === 'pointercancel' || outside ? 1 : 0)
  }
  const lost = (e: PointerEvent): void => {
    if (e.pointerId === fs_drag.pointer_id && fs_drag.from >= 0) fs_drag_clear()
  }
  const pointer_out = (e: PointerEvent): void => {
    if (e.pointerId !== fs_drag.pointer_id || e.relatedTarget !== null || fs_drag.captured) return
    fs_drag_clear()
  }
  window.addEventListener('pointermove', move, { capture: true, passive: false })
  window.addEventListener('pointerup', finish, { capture: true })
  window.addEventListener('pointercancel', finish, { capture: true })
  window.addEventListener('pointerout', pointer_out, { capture: true })
  window.addEventListener('blur', () => { touches.clear(); fs_drag_clear() })
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
  q('prev_btn').addEventListener('click', () => {
    if (dispatch('frame.step', -1) === 0) sfx_play('tap')
  })
  q('next_btn').addEventListener('click', () => {
    if (dispatch('frame.step', 1) === 0) sfx_play('tap')
  })
  q('home_btn').addEventListener('click', frame_home)
  q('last_btn').addEventListener('click', frame_last)
  q('frame_no').addEventListener('click', () => {
    dispatch('play.stop', null)
    modal_prompt_num('コマへジャンプ', '何コマ目にとぶ？（1〜' + g.doc.frames.length + '）', g.doc.cur + 1, 1, g.doc.frames.length, v => {
      dispatch('frame.goto', v - 1)
    })
  })
  q('play_btn').addEventListener('click', () => anim_toggle())
  q('loop_btn').addEventListener('click', loop_toggle)
  q('ab_btn').addEventListener('click', ab_cycle)
  q('fps_btn').addEventListener('click', () => fps_toggle(q('fps_btn')))
  q('hold_btn').addEventListener('click', () => hold_toggle(q('hold_btn')))
  q('add_btn').addEventListener('click', () => dispatch('frame.add', null))
  q('dup_btn').addEventListener('click', frame_duplicate)
  q('del_btn').addEventListener('click', () => dispatch('frame.del', null))
  q('tl_toggle').addEventListener('click', timeline_toggle)
  q('tl_close').addEventListener('click', () => { if (st().view.tlopen) timeline_toggle() })
  q('tl_more_btn').addEventListener('click', tl_more_open)
  q<HTMLInputElement>('fps_range').addEventListener('input', e => {
    dispatch('doc.set_fps_idx', Number((e.target as HTMLInputElement).value))
  })
  q<HTMLInputElement>('hold_range').addEventListener('input', e => {
    const cur = g.doc.cur
    dispatch('frame.set_hold_range', { a: cur, b: cur, hold: Number((e.target as HTMLInputElement).value) })
  })
}

