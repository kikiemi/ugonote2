import { q, toast } from '../dom'
import { t_eraser, t_fill, t_paste, t_pen, t_pixel } from '../h'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { tool_has_options, tool_page_show } from './tool_options'
import { drawer_set, ctx_hide, pop_close, pop_is_open, pop_open, pop_toggle, rail_sheet } from './overlay'
import { do_redo, do_undo, stage_down, stage_interrupt, tool_pick } from './stage_input'

import { view_fit_if_stale } from './viewport'
import { toolbox_open } from './toolbox'

export function dock_events(): void {
  q('studio_quick').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (!b) return
    if (b.dataset.quickColor) dispatch('pen.set_color', b.dataset.quickColor)
    if (b.dataset.quickSize) dispatch('pen.set_size', Number(b.dataset.quickSize))
  })
  const pick_or_options = (id: string, tool: number): void => {
    const button = q(id)
    if (st().pen.tool === tool && tool_has_options(tool)) {
      tool_page_show(tool === t_pen ? 'brush' : tool === t_eraser ? 'size' : 'pattern')
      pop_toggle('pop_tool', button)
      return
    }
    pop_close()
    rail_sheet(0)
    tool_pick(tool)
  }
  for (const button of q('dock_row').querySelectorAll<HTMLElement>('[data-dock-tool]')) button.addEventListener('click', () => pick_or_options(button.id, Number(button.dataset.dockTool)))
  q('sb_paint_mode').addEventListener('click', () => dispatch('pen.set_paint_over', st().pen.paint_over ? 0 : 1))
  q('sb_fill').addEventListener('click', () => dispatch('sel.paint', null))
  q('sb_invert').addEventListener('click', () => dispatch('sel.invert', null))
  q('sb_register_paint').addEventListener('click', () => dispatch('sel.register_paint', null))
  q('sb_t').addEventListener('click', () => dispatch('sel.transform', null))
  for (const id of ['sb_p', 'dock_paste']) q(id).addEventListener('click', () => tool_pick(t_paste, 0))
  q('sb_c').addEventListener('click', () => dispatch('sel.copy', null))
  q('sb_x').addEventListener('click', () => dispatch('sel.cut', null))
  q('sb_q').addEventListener('click', () => dispatch('sel.clear', null))
  q('dock_eraser').addEventListener('click', () => pick_or_options('dock_eraser', t_eraser))
  q('dock_main').addEventListener('click', () => pick_or_options('dock_main', t_pen))
  q('dock_fill').addEventListener('click', () => pick_or_options('dock_fill', t_fill))
  q('dock_color').addEventListener('click', () => pop_toggle('pop_color', q('dock_color')))
  q('pixel_choices').addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-pixel-count]')
    if (button) dispatch('pen.set_pxn', Number(button.dataset.pixelCount))
  })
  q('adjust_pixel').addEventListener('click', () => { pop_close(); tool_pick(t_pixel) })
  q('dock_settings').addEventListener('click', () => { tool_page_show('tool'); pop_toggle('pop_tool', q('dock_settings')) })
  q('dock_grid').addEventListener('click', () => toolbox_open('blk_grid'))
  q('dock_pattern').addEventListener('click', () => {
    if (![t_pen,t_eraser,t_fill].includes(st().pen.tool)) tool_pick(t_pen)
    tool_page_show('pattern')
    pop_toggle('pop_tool', q('dock_pattern'))
  })
  q('dock_features').addEventListener('click', () => toolbox_open('features'))
  q('dock_more').addEventListener('click', () => { if (q('rail').classList.contains('on')) rail_sheet(0); else toolbox_open() })
  q('toolbox_close').addEventListener('click', () => rail_sheet(0))
  q('live_layer_tabs').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-live-layer]')
    if (!b) return
    const layer = Number(b.dataset.liveLayer)
    if (layer === st().pen.layer) pop_toggle('pop_layer', b)
    else dispatch('pen.set_layer', layer)
  })

}

export function quick_events(): void {
  q('view_btn').addEventListener('click', () => pop_toggle('pop_view', q('view_btn')))
  q('layer_btn').addEventListener('click', () => pop_toggle('pop_layer', q('layer_btn')))
  q('tf_btn').addEventListener('click', () => {
    const g = st()
    q<HTMLInputElement>('tf_dx').min = String(-g.doc.w)
    q<HTMLInputElement>('tf_dx').max = String(g.doc.w)
    q<HTMLInputElement>('tf_dy').min = String(-g.doc.h)
    q<HTMLInputElement>('tf_dy').max = String(g.doc.h)
    pop_toggle('pop_tf', q('tf_btn'))
  })
  q('onion_btn').addEventListener('click', () => toolbox_open('toolbox_onion'))
  q('view_onion_btn').addEventListener('click', () => toolbox_open('toolbox_onion'))
  q('grid_btn').addEventListener('click', () => {
    dispatch('view.toggle_grid', null)
    sfx_play('tap')
  })
  q('vflip_btn').addEventListener('click', () => {
    dispatch('view.toggle_flip', null)
    sfx_play('tap')
  })
  q('fit_btn').addEventListener('click', () => {
    pop_close()
    rail_sheet(0)
    dispatch('view.fit', null)
    sfx_play('tap')
  })

}

export function flobar_events(): void {
  q('flo_rot_l').addEventListener('click', () => dispatch('flo.rot', -1))
  q('flo_rot_r').addEventListener('click', () => dispatch('flo.rot', 1))
  q('flo_flip_h').addEventListener('click', () => dispatch('flo.flip', 0))
  q('flo_flip_v').addEventListener('click', () => dispatch('flo.flip', 1))
  q('flo_reset').addEventListener('click', () => dispatch('flo.reset', null))
  q('flo_ok').addEventListener('click', () => dispatch('flo.confirm', null))
  q('flo_no').addEventListener('click', () => dispatch('flo.cancel', null))
}

export function workspace_focus_set(focused: boolean): void {
  stage_interrupt()
  pop_close()
  rail_sheet(0)
  ctx_hide()
  document.body.dataset.focus = focused ? '1' : '0'
  q('focus_btn').setAttribute('aria-pressed', String(focused))
  q('focus_btn').setAttribute('title', focused ? '道具を戻す' : '道具を隠して集中する')
  q('focus_btn').querySelector('span')!.textContent = focused ? '道具を戻す' : '集中'
  view_fit_if_stale()
  if (focused) toast('2本指でタップ、またはEscで道具を戻せます')
}

export function focus_gesture_mount(wrap: HTMLElement): void {
  const points = new Map<number, [number, number]>()
  let started = 0
  let two = false
  let moved = false
  const reset = (): void => { points.clear(); started = 0; two = false; moved = false }
  wrap.addEventListener('pointerdown', e => {
    if (document.body.dataset.focus !== '1' || e.pointerType !== 'touch') return
    if (!points.size) { reset(); started = performance.now() }
    points.set(e.pointerId, [e.clientX, e.clientY])
    if (points.size === 2) two = true
    if (points.size > 2) moved = true
  }, { capture: true })
  window.addEventListener('pointermove', e => {
    const at = points.get(e.pointerId)
    if (at && Math.hypot(e.clientX - at[0], e.clientY - at[1]) > 8) moved = true
  }, { capture: true })
  window.addEventListener('pointerup', e => {
    const at = points.get(e.pointerId)
    if (!at) return
    if (Math.hypot(e.clientX - at[0], e.clientY - at[1]) > 8) moved = true
    points.delete(e.pointerId)
    if (points.size) return
    const exit = two && !moved && performance.now() - started < 350 && document.body.dataset.focus === '1'
    reset()
    if (exit) workspace_focus_set(false)
  }, { capture: true })
  window.addEventListener('pointercancel', reset, { capture: true })
  window.addEventListener('blur', reset)
  window.addEventListener('resize', reset)
}

export function header_events(): void {
  q('focus_btn').addEventListener('click', () => workspace_focus_set(document.body.dataset.focus !== '1'))
  q('dock_focus').addEventListener('click', () => workspace_focus_set(true))
  q('dock_paper').addEventListener('click', () => pop_toggle('pop_paper', q('dock_paper')))
  q('paper_color_btn').addEventListener('click', () => pop_open('pop_paper', q('paper_color_btn')))

  q('menu_focus').addEventListener('click', () => { drawer_set(0); workspace_focus_set(true) })
  q('menu_btn').addEventListener('click', () => drawer_set(q('drawer').classList.contains('on') ? 0 : 1))
  q('drawer_close').addEventListener('click', () => drawer_set(0))
  q('scrim').addEventListener('click', () => drawer_set(0))
  q('undo_btn').addEventListener('click', do_undo)
  q('redo_btn').addEventListener('click', do_redo)
  const ti = q<HTMLInputElement>('title')
  ti.addEventListener('input', () => {
    dispatch('doc.set_name', ti.value)
  })
  ti.addEventListener('keydown', e => {
    if (e.key === 'Enter') ti.blur()
  })
  const menu_title = q<HTMLInputElement>('menu_title')
  menu_title.addEventListener('input', () => dispatch('doc.set_name', menu_title.value))
}

export function pop_chrome_events(): void {
  q('pop_tool').addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('button[data-tool-page]')
    if (button) tool_page_show(button.dataset.toolPage)
  })
  const close_all = (e?: Event): void => {
    if (e?.cancelable) e.preventDefault()
    e?.stopPropagation()
    pop_close()
    rail_sheet(0)
  }
  q('pop_scrim').addEventListener('pointerdown', e => {
    if (document.body.dataset.drawingMenu === '1') {
      e.preventDefault()
      e.stopPropagation()
      stage_down(e)
    } else close_all(e)
  })
  q('pop_scrim').addEventListener('click', e => {
    if (document.body.dataset.drawingMenu === '1') e.preventDefault()
    else close_all(e)
  })
  const pops = document.querySelectorAll('.pop .popx')
  for (let i = 0; i < pops.length; i++) {
    const close = pops[i] as HTMLElement
    close.addEventListener('click', close_all)
  }
}

export function outside_close(): void {
  document.addEventListener(
    'pointerdown',
    e => {
      const t = e.target as HTMLElement
      if (!q('ctx_menu').classList.contains('hide') && !t.closest('#ctx_menu, #tl_more_btn')) ctx_hide()
      if (!pop_is_open()) return
      if (t.closest('.pop, #pop_scrim')) return
      if (t.closest('#stage_wrap')) return
      if (t.closest('#rail, #quick, #tl_bar, #frame_panel, #dock, #hd, #layer_stack, #live_layer_tabs')) return
      pop_close()
    },
    { capture: true }
  )
}

