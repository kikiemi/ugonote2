import { workspace_layout_render, workspace_context_layout } from './workspace_layout'
import { overlay_state } from './overlay_state'
import { tool_page_show } from './tool_options'
import { esc, focus_cycle, ic, q } from '../dom'
import { clamp } from '../lib'
import { dirty } from '../state/store'
import { d_sel } from '../h'
import { sfx_play } from '../snd'
import { storage_set } from '../storage'
import { home_show, home_preview_stop } from './home'
import { modal_active, modal_background_inert } from './modal'

let drawer_focus: HTMLElement | null = null
let drawer_inert: { element: HTMLElement, previous: boolean }[] = []

function drawer_tab(e: KeyboardEvent): void {
  focus_cycle(q('drawer'), e)
}

type ctx_item_t = { label: string, icon: string, fn: () => void, off?: number }

export function pop_rect(id: string): HTMLElement {
  return q(id)
}

let on_pop_close: ((id: string) => void) | null = null

export function pop_close_hook(fn: (id: string) => void): void {
  on_pop_close = fn
}

export function pop_close(): void {
  const was = overlay_state.pop
  if (overlay_state.anchor) overlay_state.anchor.setAttribute('aria-expanded', 'false')
  for (const pop of document.querySelectorAll<HTMLElement>('.pop.on')) pop.classList.remove('on')
  q('pop_scrim').classList.remove('on')
  overlay_state.pop = ''
  overlay_state.anchor = null
  workspace_layout_render()
  if (was && on_pop_close) on_pop_close(was)
}

export function pop_open(id: string, anchor: HTMLElement): void {
  // 道具の設定から色を開いたときだけ、色の画面に「設定へもどる」を出す。
  if (id === 'pop_color') q('color_back').hidden = !anchor.closest('#pop_tool')
  if (anchor.closest('#rail')) anchor = q(id === 'pop_color' ? 'dock_color' : id === 'pop_tool' ? 'dock_settings' : 'dock_more')
  else if (anchor.closest('.pop')) anchor = q(id === 'pop_paper' || id === 'pop_color' ? 'dock_color' : id === 'pop_tool' ? 'dock_settings' : 'dock_more')
  rail_sheet(0)
  if (overlay_state.pop && overlay_state.pop !== id) pop_close()
  const p = pop_rect(id)
  p.classList.add('on')
  q('pop_scrim').classList.add('on')
  overlay_state.pop = id
  overlay_state.anchor = anchor
  anchor.setAttribute('aria-expanded', 'true')
  if (id === 'pop_tool') tool_page_show()
  workspace_layout_render()

}

// 道具の設定は、開いたボタンの種類 (道具・道具設定・図形) が同じときだけ、もう一度押すと閉じる。
const pop_tool_groups: Record<string, string> = { dock_settings: 'settings', tool_settings_btn: 'settings', dock_shape: 'shape', tl_shape_more: 'shape' }

export function pop_toggle(id: string, anchor: HTMLElement): void {
  const group = (button: HTMLElement | null): string => pop_tool_groups[button?.id || ''] || 'tool'
  const same_control = id !== 'pop_tool' || group(overlay_state.anchor) === group(anchor)
  if (overlay_state.pop === id && same_control) pop_close()
  else pop_open(id, anchor)
}

export function drawer_set(on: number): void {
  const drawer = q('drawer')
  const was = drawer.classList.contains('on')
  if (on && !was) {
    drawer_focus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    drawer_inert = []
    for (const element of Array.from(drawer.parentElement?.children || [])) {
      if (!(element instanceof HTMLElement) || element === drawer || element.id === 'modal_root' || element.id === 'tut_root') continue
      drawer_inert.push({ element, previous: element.inert })
      modal_background_inert(element, true)
    }
    drawer.addEventListener('keydown', drawer_tab)
  }
  q('drawer').classList.toggle('on', !!on)
  q('scrim').classList.toggle('on', !!on)
  if (!on) {
    home_preview_stop()
    pop_close()
    rail_sheet(0)
    q('pop_scrim').classList.remove('on')
    for (const entry of drawer_inert) modal_background_inert(entry.element, entry.previous)
    drawer_inert = []
    drawer.removeEventListener('keydown', drawer_tab)
    if (!modal_active() && drawer_focus?.isConnected && !drawer_focus.closest('[inert]')) drawer_focus.focus({ preventScroll: true })
    drawer_focus = null
  }
  if (on) {
    home_show()
    pop_close()
    storage_set('ug2_menuseen', '1')
    q('menu_btn').classList.remove('pulse')
    if (!modal_active()) q('drawer_close').focus({ preventScroll: true })
  }
  sfx_play('tap')
}

export function rail_sheet(open: number): void {
  if (open) pop_close()
  q('rail').classList.toggle('on', !!open)
  if (open) q('pop_scrim').classList.add('on')
  else if (!overlay_state.pop) q('pop_scrim').classList.remove('on')
  workspace_layout_render()
}

export function ctx_hide(): void {
  const menu = q('ctx_menu')
  if (!menu.classList.contains('hide')) dirty(d_sel)
  menu.classList.add('hide')
  if (overlay_state.context_anchor) overlay_state.context_anchor.setAttribute('aria-expanded', 'false')
  overlay_state.context_anchor = null
}

function ctx_prepare(items: ctx_item_t[]): HTMLElement {
  ctx_hide()
  const m = q('ctx_menu')
  let html = ''
  for (let i = 0; i < items.length; i++) html += '<button class="citem' + (items[i].off ? ' off' : '') + '" data-i="' + i + '">' + ic(items[i].icon) + '<span>' + esc(items[i].label) + '</span></button>'
  m.innerHTML = html
  m.style.maxHeight = ''
  m.style.overflowY = ''
  m.classList.remove('hide')
  dirty(d_sel)
  m.onclick = e => {
    const t = (e.target as HTMLElement).closest('.citem') as HTMLElement | null
    if (!t || t.classList.contains('off')) return
    const it = items[Number(t.dataset.i)]
    ctx_hide()
    it.fn()
  }
  return m
}

export function ctx_show(x: number, y: number, items: ctx_item_t[]): void {
  const m = ctx_prepare(items)
  const mw = m.offsetWidth
  const mh = m.offsetHeight
  m.style.left = clamp(x, 4, window.innerWidth - mw - 4) + 'px'
  m.style.top = clamp(y, 4, window.innerHeight - mh - 4) + 'px'
}

export function ctx_show_above(anchor: HTMLElement, items: ctx_item_t[]): void {
  if (overlay_state.context_anchor === anchor && !q('ctx_menu').classList.contains('hide')) {
    ctx_hide()
    return
  }
  const m = ctx_prepare(items)
  overlay_state.context_anchor = anchor
  anchor.setAttribute('aria-expanded', 'true')
  workspace_context_layout(m, anchor)
}

export function pop_is_open(): string {
  return overlay_state.pop
}

export function pop_is_anchored(anchor: HTMLElement): boolean {
  return !!overlay_state.pop && overlay_state.anchor === anchor
}
