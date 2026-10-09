import { q, toast } from '../dom'
import { T_ERASER, T_FILL, T_PEN, T_PIXEL } from '../h'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { tool_has_options } from '../sync'
import { drawer_set, ctx_hide, pop_close, pop_is_open, pop_open, pop_toggle, rail_sheet, tool_page_show } from './overlay'
import { do_redo, do_undo, stage_down, stage_interrupt, tool_pick } from './stage_input'

import { view_fit_if_stale } from './viewport'

export function dock_events(): void {
  const pick_or_options = (id: string, tool: number): void => {
    const button = q(id)
    if (st().pen.tool === tool && tool_has_options(tool)) {
      tool_page_show(tool === T_PEN ? 'brush' : tool === T_ERASER ? 'size' : 'pattern')
      pop_toggle('popTool', button)
      return
    }
    pop_close()
    rail_sheet(0)
    tool_pick(tool)
  }
  for (const button of q('dockRow').querySelectorAll<HTMLElement>('[data-dock-tool]')) button.addEventListener('click', () => pick_or_options(button.id, Number(button.dataset.dockTool)))
  q('sbT').addEventListener('click', () => dispatch('sel.transform', null))
  q('sbC').addEventListener('click', () => dispatch('sel.copy', null))
  q('sbX').addEventListener('click', () => dispatch('sel.cut', null))
  q('sbQ').addEventListener('click', () => dispatch('sel.clear', null))
  q('dockEraser').addEventListener('click', () => pick_or_options('dockEraser', T_ERASER))
  q('dockMain').addEventListener('click', () => pick_or_options('dockMain', T_PEN))
  q('dockFill').addEventListener('click', () => pick_or_options('dockFill', T_FILL))
  q('dockColor').addEventListener('click', () => pop_toggle('popColor', q('dockColor')))
  q('adjustGrid').addEventListener('click', () => dispatch('view.toggle_grid', null))
  q('gridChoices').addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-grid-size]')
    if (button) dispatch('view.set_grid_size', Number(button.dataset.gridSize))
  })
  for (const id of ['gridStepRange', 'gridStepNum']) q<HTMLInputElement>(id).addEventListener('input', e => dispatch('view.set_grid_size', Number((e.target as HTMLInputElement).value)))
  q('pixelChoices').addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-pixel-count]')
    if (button) dispatch('pen.set_pxn', Number(button.dataset.pixelCount))
  })
  q('adjustPixel').addEventListener('click', () => { pop_close(); tool_pick(T_PIXEL) })
  q('dockSize').addEventListener('click', () => { tool_page_show('size'); pop_toggle('popTool', q('dockSize')) })
  q('dockGrid').addEventListener('click', () => { tool_page_show('grid'); pop_toggle('popTool', q('dockGrid')) })
  q('dockMore').addEventListener('click', () => rail_sheet(q('rail').classList.contains('on') ? 0 : 1))
  q('toolboxClose').addEventListener('click', () => rail_sheet(0))
  q('liveLayerTabs').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-live-layer]')
    if (!b) return
    const layer = Number(b.dataset.liveLayer)
    if (layer === st().pen.layer) pop_toggle('popLayer', b)
    else dispatch('pen.set_layer', layer)
  })

}

export function quick_events(): void {
  q('viewBtn').addEventListener('click', () => pop_toggle('popView', q('viewBtn')))
  q('layerBtn').addEventListener('click', () => pop_toggle('popLayer', q('layerBtn')))
  q('tfBtn').addEventListener('click', () => {
    const g = st()
    q<HTMLInputElement>('tfDx').min = String(-g.doc.w)
    q<HTMLInputElement>('tfDx').max = String(g.doc.w)
    q<HTMLInputElement>('tfDy').min = String(-g.doc.h)
    q<HTMLInputElement>('tfDy').max = String(g.doc.h)
    pop_toggle('popTf', q('tfBtn'))
  })
  q('onionBtn').addEventListener('click', () => pop_toggle('popOnion', q('onionBtn')))
  q('onionChoices').addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-onion-count]')
    if (button) dispatch('view.set_onion_count', Number(button.dataset.onionCount))
  })
  for (const [id, key] of [['onionPrev', 'oprev'], ['onionNext', 'onext'], ['onionSkip', 'oskip']] as const) {
    q(id).addEventListener('click', () => dispatch('view.toggle_onion_direction', key))
  }
  q('gridBtn').addEventListener('click', () => {
    dispatch('view.toggle_grid', null)
    sfx_play('tap')
  })
  q('vflipBtn').addEventListener('click', () => {
    dispatch('view.toggle_flip', null)
    sfx_play('tap')
  })
  q('fitBtn').addEventListener('click', () => {
    pop_close()
    rail_sheet(0)
    dispatch('view.fit', null)
    sfx_play('tap')
  })
  q<HTMLInputElement>('onionCount').addEventListener('input', e => {
    dispatch('view.set_onion_count', Number((e.target as HTMLInputElement).value))
  })
}

export function flobar_events(): void {
  q('floRotL').addEventListener('click', () => dispatch('flo.rot', -1))
  q('floRotR').addEventListener('click', () => dispatch('flo.rot', 1))
  q('floFlipH').addEventListener('click', () => dispatch('flo.flip', 0))
  q('floFlipV').addEventListener('click', () => dispatch('flo.flip', 1))
  q('floReset').addEventListener('click', () => dispatch('flo.reset', null))
  q('floOk').addEventListener('click', () => dispatch('flo.confirm', null))
  q('floNo').addEventListener('click', () => dispatch('flo.cancel', null))
}

export function workspace_focus_set(focused: boolean): void {
  stage_interrupt()
  pop_close()
  rail_sheet(0)
  ctx_hide()
  document.body.dataset.focus = focused ? '1' : '0'
  q('focusBtn').setAttribute('aria-pressed', String(focused))
  q('focusBtn').setAttribute('title', focused ? '道具を戻す' : '道具を隠して集中する')
  q('focusBtn').querySelector('span')!.textContent = focused ? '道具を戻す' : '集中'
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
  q('focusBtn').addEventListener('click', () => workspace_focus_set(document.body.dataset.focus !== '1'))
  q('dockFocus').addEventListener('click', () => workspace_focus_set(true))
  q('dockPaper').addEventListener('click', () => pop_toggle('popPaper', q('dockPaper')))
  q('paperColorBtn').addEventListener('click', () => pop_open('popPaper', q('paperColorBtn')))

  q('menuFocus').addEventListener('click', () => { drawer_set(0); workspace_focus_set(true) })
  q('menuBtn').addEventListener('click', () => drawer_set(q('drawer').classList.contains('on') ? 0 : 1))
  q('appSettingsBtn').addEventListener('click', () => { drawer_set(0); pop_open('popSettings', q('focusBtn')) })
  q('drawerClose').addEventListener('click', () => drawer_set(0))
  q('scrim').addEventListener('click', () => drawer_set(0))
  q('undoBtn').addEventListener('click', do_undo)
  q('redoBtn').addEventListener('click', do_redo)
  const ti = q<HTMLInputElement>('title')
  ti.addEventListener('input', () => {
    dispatch('doc.set_name', ti.value)
  })
  ti.addEventListener('keydown', e => {
    if (e.key === 'Enter') ti.blur()
  })
  const menuTitle = q<HTMLInputElement>('menuTitle')
  menuTitle.addEventListener('input', () => dispatch('doc.set_name', menuTitle.value))
}

export function pop_chrome_events(): void {
  q('popTool').addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('button[data-tool-page]')
    if (button) tool_page_show(button.dataset.toolPage)
  })
  const close_all = (e?: Event): void => {
    if (e?.cancelable) e.preventDefault()
    e?.stopPropagation()
    pop_close()
    rail_sheet(0)
  }
  q('popScrim').addEventListener('pointerdown', e => {
    const draw = document.body.dataset.drawingMenu === '1'
    close_all(e)
    if (draw) stage_down(e)
  })
  q('popScrim').addEventListener('click', close_all)
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
      if (!q('ctxMenu').classList.contains('hide') && !t.closest('#ctxMenu, #tlMoreBtn')) ctx_hide()
      if (!pop_is_open()) return
      if (t.closest('.pop, #popScrim')) return
      if (t.closest('#stageWrap')) return
      if (t.closest('#rail, #quick, #tlBar, #framePanel, #dock, #hd, #layerStack, #liveLayerTabs')) return
      pop_close()
    },
    { capture: true }
  )
}

