import { q, toast } from '../dom'
import { t_paste } from '../h'
import { clamp } from '../lib'
import { modal_active, modal_close } from './modal'
import { store_save_auto } from '../persist'
import { flo_active } from '../sel'
import { tool_defs } from './tool_defs'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { anim_playing } from '../state/commands/play'
import { st } from '../state/store'
import { tool_is_stroking, tool_mod_shift } from '../tool'
import { drawer_set, ctx_hide, pop_close, pop_is_open } from './overlay'
import { frame_move_nudge, frame_move_on } from './frame_move'
import { anim_stop, anim_toggle } from './playback'
import { do_redo, do_undo, tool_pick } from './stage_input'


function typing_now(): number {
  const a = document.activeElement
  if (!a) return 0
  const t = a.tagName
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' ? 1 : 0
}

export function keydown(e: KeyboardEvent): void {
  const g = st()
  if (modal_active()) {
    if (e.key === 'Escape') modal_close()
    return
  }
  if (q('drawer').classList.contains('on')) {
    if (e.key === 'Escape') drawer_set(0)
    return
  }
  if (e.key === 'Shift') tool_mod_shift(1)
  if (tool_is_stroking() && e.key !== 'Escape' && e.key !== 'Shift') return
  if (typing_now()) {
    if (e.key === 'Escape') (document.activeElement as HTMLElement).blur()
    return
  }
  const k = e.key
  const key_lower = k.length === 1 ? k.toUpperCase() : k
  if (frame_move_on()) {
    frame_move_key(e)
    return
  }
  if ((e.ctrlKey || e.metaKey) && key_lower === 'Z' && !e.shiftKey) {
    e.preventDefault()
    do_undo()
    return
  }
  if ((e.ctrlKey || e.metaKey) && (key_lower === 'Y' || (key_lower === 'Z' && e.shiftKey))) {
    e.preventDefault()
    do_redo()
    return
  }
  if ((e.ctrlKey || e.metaKey) && key_lower === 'C') {
    e.preventDefault()
    dispatch('sel.copy', null)
    return
  }
  if ((e.ctrlKey || e.metaKey) && key_lower === 'X') {
    e.preventDefault()
    dispatch('sel.cut', null)
    return
  }
  if ((e.ctrlKey || e.metaKey) && key_lower === 'V') {
    e.preventDefault()
    tool_pick(t_paste)
    return
  }
  if ((e.ctrlKey || e.metaKey) && key_lower === 'A') {
    e.preventDefault()
    dispatch('sel.all', null)
    return
  }
  if ((e.ctrlKey || e.metaKey) && key_lower === 'S') {
    e.preventDefault()
    store_save_auto()
    toast('保存したよ')
    return
  }
  if (e.ctrlKey || e.metaKey) return
  if (k === 'Escape') {
    if (modal_active()) {
      modal_close()
      return
    }
    if (!q('ctx_menu').classList.contains('hide')) {
      ctx_hide()
      return
    }
    if (pop_is_open()) {
      pop_close()
      return
    }
    if (q('drawer').classList.contains('on')) {
      drawer_set(0)
      return
    }
    if (flo_active()) {
      dispatch('flo.cancel', null)
      return
    }
    if (g.sel.has) {
      dispatch('sel.clear', null)
      return
    }
    if (anim_playing()) anim_stop()
    return
  }
  if (modal_active()) return
  if (k === 'Enter' && flo_active()) {
    e.preventDefault()
    dispatch('flo.confirm', null)
    return
  }
  if (k === ' ') {
    e.preventDefault()
    anim_toggle()
    return
  }
  if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
    e.preventDefault()
    if (flo_active()) {
      const d = e.shiftKey ? 10 : 1
      dispatch('flo.nudge', { dx: k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, dy: k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0 })
      return
    }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (anim_playing()) anim_stop()
      const n = g.doc.frames.length
      const i = clamp(g.doc.cur + (k === 'ArrowRight' ? 1 : -1), 0, n - 1)
      if (i !== g.doc.cur) {
        dispatch('frame.goto', i)
      }
    }
    return
  }
  if (k === 'Delete' || k === 'Backspace') {
    if (g.sel.has) dispatch('sel.delete', null)
    return
  }
  if (key_lower === 'N') {
    dispatch('frame.add', null)
    return
  }
  if (key_lower === 'D') {
    dispatch('frame.dup', null)
    return
  }
  if (k === '[' || k === ']') {
    const f = g.doc.frames[g.doc.cur]
    if (!f) return
    dispatch('frame.set_hold_range', { a: g.doc.cur, b: g.doc.cur, hold: f.hold + (k === ']' ? 1 : -1) })
    return
  }
  if (k === '+' || k === '=') {
    zoom_step(1.2)
    return
  }
  if (k === '-') {
    zoom_step(1 / 1.2)
    return
  }
  if (k === '0') {
    dispatch('view.fit', null)
    return
  }
  if (k === '1' || k === '2' || k === '3') {
    dispatch('pen.set_layer', Number(k))
    sfx_play('tap')
    return
  }
  for (const d of tool_defs) {
    if (d.key && d.key === key_lower) {
      tool_pick(d.t)
      return
    }
  }
}

// コマ全体をうごかしているあいだのキー。Enter で確定、Esc・Ctrl+Z で取り消し、矢印で少しずつ移動。
function frame_move_key(e: KeyboardEvent): void {
  const k = e.key
  if (k === 'Enter') {
    e.preventDefault()
    q('tf_apply').click()
    return
  }
  if (k === 'Escape' || (e.ctrlKey || e.metaKey) && k.toUpperCase() === 'Z') {
    e.preventDefault()
    pop_close()
    return
  }
  const d = e.shiftKey ? 10 : 1
  const step = ({ ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] } as Record<string, number[]>)[k]
  if (!step) return
  e.preventDefault()
  frame_move_nudge(step[0], step[1])
}

export function keyup(e: KeyboardEvent): void {
  if (e.key === 'Shift') tool_mod_shift(0)
}

function zoom_step(f: number): void {
  const wrap = q('stage_wrap')
  dispatch('view.zoom_at', { sx: wrap.clientWidth / 2, sy: wrap.clientHeight / 2, factor: f })
}

