import { workspace_layout_render } from './ui/workspace_layout'
import { workspace_timeline_set } from './ui/responsive'
import { q } from './dom'
import { store_save_auto } from './persist'
import { sel_bind } from './sel'
import { sfx_warm } from './snd'
import { tf_cancel, tool_bind_preview, tool_mod_shift } from './tool'
import { drawer_set, ctx_hide, pop_close, pop_close_hook, rail_sheet } from './ui/overlay'
import { stage_cancel, stage_ctx, stage_down, stage_interrupt, stage_lost_capture, stage_move, stage_pointer_out, stage_up, stage_wheel, stage_pen_down, stage_control_move, stage_control_up, stage_control_click } from './ui/stage_input'
import { home_mount } from './ui/home'
import { toolbox_events } from './ui/toolbox'
import { fs_drag_clear, fs_pointer, tl_events } from './ui/timeline_input'
import { rail_events, custom_load, color_pop_events, tool_pop_events, tf_pop_events, layer_pop_events, mark_events, tool_input_interrupt } from './ui/tool_input'
import { dock_events, quick_events, flobar_events, workspace_focus_set, focus_gesture_mount, header_events, pop_chrome_events, outside_close } from './ui/workspace_input'
import { keydown, keyup } from './ui/keyboard_input'
import { view_fit_if_stale } from './ui/viewport'

function input_interrupt(): void {
  fs_drag_clear()
  tool_input_interrupt()
  tool_mod_shift(0)
  stage_interrupt()
}

export function input_mount(): void {
  custom_load()
  const wrap = q('stage_wrap')
  const ants = q<HTMLCanvasElement>('ants_cv').getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  const flo = q<HTMLCanvasElement>('flo_cv').getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
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
    if (id !== 'pop_tf') return
    tf_cancel()
    for (const [rid, v] of [['tf_scale', '100'], ['tf_dx', '0'], ['tf_dy', '0'], ['tf_rot', '0']]) q<HTMLInputElement>(rid).value = v
    q('tf_scale_v').textContent = '100%'
    q('tf_dx_v').textContent = '0'
    q('tf_dy_v').textContent = '0'
    q('tf_rot_v').textContent = '0°'
  })
  quick_events()
  flobar_events()
  tl_events()
  header_events()
  fs_pointer(q('fs'))
  pop_chrome_events()
  dock_events()
  home_mount(() => drawer_set(0), () => { drawer_set(0); workspace_focus_set(false); workspace_timeline_set(1) })
  toolbox_events()
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
  window.addEventListener('resize', () => { view_fit_if_stale(); workspace_layout_render() })
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      view_fit_if_stale()
      workspace_layout_render()
    }).observe(q('stage_wrap'))
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    input_interrupt()
    store_save_auto()
  })
}
