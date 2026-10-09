import { q } from './dom'
import { store_save_auto } from './persist'
import { sel_bind } from './sel'
import { sfx_warm } from './snd'
import { dispatch } from './state/commands/index'
import { tf_cancel, tool_bind_preview, tool_mod_shift } from './tool'
import { drawer_set, ctx_hide, pop_close, pop_close_hook, rail_sheet, drawing_menu_layout } from './ui/overlay'
import { stage_cancel, stage_ctx, stage_down, stage_interrupt, stage_lost_capture, stage_move, stage_pointer_out, stage_up, stage_wheel } from './ui/stage_input'
import { home_mount } from './ui/home'
import { stage_pen_down, stage_control_move, stage_control_up, stage_control_click } from './ui/stage_input'

import { fs_drag_clear, fs_pointer, tl_events } from './ui/timeline_input'
import { rail_events, custom_load, color_pop_events, tool_pop_events, tf_pop_events, layer_pop_events, mark_events, settings_events } from './ui/tool_input'
import { dock_events, quick_events, flobar_events, workspace_focus_set, focus_gesture_mount, header_events, pop_chrome_events, outside_close } from './ui/workspace_input'
import { keydown, keyup } from './ui/keyboard_input'
import { tool_input_interrupt } from './ui/tool_input'
import { view_fit_if_stale } from './ui/viewport'

export { custom_load } from './ui/tool_input'

function input_interrupt(): void {
  fs_drag_clear()
  tool_input_interrupt()
  tool_mod_shift(0)
  stage_interrupt()
}

export function input_mount(): void {
  custom_load()
  const wrap = q('stageWrap')
  const ants = q<HTMLCanvasElement>('antsCv').getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  const flo = q<HTMLCanvasElement>('floCv').getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  sel_bind(ants, flo)
  tool_bind_preview(ants)
  document.addEventListener('pointerdown', stage_pen_down, { capture: true })
  wrap.addEventListener('pointerdown', stage_down)
  wrap.addEventListener('lostpointercapture', stage_lost_capture)
  window.addEventListener('pointermove', stage_control_move, { capture: true })
  window.addEventListener('pointerup', stage_control_up, { capture: true })
  window.addEventListener('pointercancel', stage_control_up, { capture: true })
  document.addEventListener('click', stage_control_click, { capture: true })
  window.addEventListener('pointermove', stage_move, { capture: true })
  window.addEventListener('pointerup', stage_up, { capture: true })
  window.addEventListener('pointercancel', stage_cancel, { capture: true })
  window.addEventListener('pointerout', stage_pointer_out, { capture: true })
  focus_gesture_mount(wrap)
  wrap.addEventListener('wheel', stage_wheel, { passive: false })
  wrap.addEventListener('contextmenu', stage_ctx)
  wrap.addEventListener('pointerdown', sfx_warm, { once: true })
  rail_events()
  color_pop_events()
  tool_pop_events()
  mark_events()
  layer_pop_events()
  tf_pop_events()
  pop_close_hook(id => {
    if (id !== 'popTf') return
    tf_cancel()
    for (const [rid, v] of [['tfScale', '100'], ['tfDx', '0'], ['tfDy', '0'], ['tfRot', '0']]) q<HTMLInputElement>(rid).value = v
    q('tfScaleV').textContent = '100%'
    q('tfDxV').textContent = '0'
    q('tfDyV').textContent = '0'
    q('tfRotV').textContent = '0°'
  })
  quick_events()
  flobar_events()
  tl_events()
  header_events()
  fs_pointer(q('fs'))
  pop_chrome_events()
  dock_events()
  home_mount(() => drawer_set(0), () => { drawer_set(0); workspace_focus_set(false); dispatch('view.set_timeline_open', 1) })
  settings_events()
  outside_close()
  window.addEventListener('keydown', keydown)
  window.addEventListener('keyup', keyup)
  window.addEventListener('blur', input_interrupt)
  window.addEventListener('pagehide', input_interrupt)
  window.addEventListener('orientationchange', () => {
    input_interrupt()
    pop_close()
    rail_sheet(0)
    ctx_hide()
  }, { passive: true })
  window.addEventListener('resize', () => { view_fit_if_stale(); drawing_menu_layout() })
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      view_fit_if_stale()
      drawing_menu_layout()
    }).observe(q('stageWrap'))
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    input_interrupt()
    store_save_auto()
  })
}
