import { q, toast } from '../dom'
import { T_PASTE } from '../h'
import { clamp } from '../lib'
import { modal_active, modal_close } from '../panels'
import { store_save_auto } from '../persist'
import { flo_active } from '../sel'
import { TOOL_DEFS } from './tool_defs'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { anim_playing } from '../state/commands/play'
import { st } from '../state/store'
import { tool_is_stroking, tool_mod_shift } from '../tool'
import { drawer_set, ctx_hide, pop_close, pop_is_open } from './overlay'
import { anim_stop, anim_toggle } from './playback'
import { do_redo, do_undo, tool_pick } from './stage_input'

import { workspace_focus_set } from './workspace_input'

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
  const K = k.length === 1 ? k.toUpperCase() : k
  if ((e.ctrlKey || e.metaKey) && K === 'Z' && !e.shiftKey) {
    e.preventDefault()
    do_undo()
    return
  }
  if ((e.ctrlKey || e.metaKey) && (K === 'Y' || (K === 'Z' && e.shiftKey))) {
    e.preventDefault()
    do_redo()
    return
  }
  if ((e.ctrlKey || e.metaKey) && K === 'C') {
    e.preventDefault()
    dispatch('sel.copy', null)
    return
  }
  if ((e.ctrlKey || e.metaKey) && K === 'X') {
    e.preventDefault()
    dispatch('sel.cut', null)
    return
  }
  if ((e.ctrlKey || e.metaKey) && K === 'V') {
    e.preventDefault()
    tool_pick(T_PASTE)
    return
  }
  if ((e.ctrlKey || e.metaKey) && K === 'S') {
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
    if (!q('ctxMenu').classList.contains('hide')) {
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
    if (document.body.dataset.focus === '1') {
      workspace_focus_set(false)
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
  if (k === 'Enter') {
    if (flo_active()) {
      dispatch('flo.confirm', null)
      return
    }
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
  if (K === 'N') {
    dispatch('frame.add', null)
    return
  }
  if (K === 'D') {
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
  for (const d of TOOL_DEFS) {
    if (d.key && d.key === K) {
      tool_pick(d.t)
      return
    }
  }
}

export function keyup(e: KeyboardEvent): void {
  if (e.key === 'Shift') tool_mod_shift(0)
}

function zoom_step(f: number): void {
  const wrap = q('stageWrap')
  dispatch('view.zoom_at', { sx: wrap.clientWidth / 2, sy: wrap.clientHeight / 2, factor: f })
}

