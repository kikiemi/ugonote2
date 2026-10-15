import { q } from '../dom'
import { clamp } from '../lib'
import { pref_layout } from '../prefs'
import { d_sel, d_timeline } from '../h'
import { dirty, st } from '../state/store'
import { overlay_state } from './overlay_state'
import { workspace_media, workspace_layout_choice, type workspace_profile_t } from './workspace_policy'

export function workspace_layout_render(): void {
  const g = st()
  const profile = workspace_media()
  const body = document.body
  const timeline = g.view.tlopen ? '1' : '0'
  const changed = body.dataset.tl !== timeline
  body.dataset.short = String(profile.short)
  body.dataset.phone = String(profile.phone)
  body.dataset.tablet = String(profile.tablet)
  body.dataset.mobile = String(g.mobile)
  body.dataset.wideTools = String(profile.wide)
  body.dataset.extendedTools = String(profile.extended)
  body.dataset.desktop = String(profile.desktop)
  body.dataset.workspace = profile.landscape ? 'landscape' : profile.wide ? 'wide' : 'portrait'
  body.dataset.layout = workspace_layout_choice(profile, pref_layout())
  body.dataset.tl = timeline
  body.dataset.free = g.doc.ratio === 'free' ? '1' : '0'
  body.dataset.vflip = String(g.view.flip ? 1 : 0)
  q('layout_choices').hidden = !profile.choices
  for (const name of ['simple', 'studio']) q('layout_' + name).setAttribute('aria-pressed', String(name.toLowerCase() === body.dataset.layout))
  q('tl_toggle').title = g.view.tlopen ? 'コマ一覧を閉じる' : 'コマ一覧を開く'
  q('tl_toggle').setAttribute('aria-expanded', String(!!g.view.tlopen))
  if (changed && g.view.tlopen) dirty(d_timeline)
  layer_stack_layout()
  drawing_menu_layout(profile)
  if (overlay_state.context_anchor) workspace_context_layout(q('ctx_menu'), overlay_state.context_anchor)
}

function anchored_panel_layout(panel: HTMLElement, anchor: HTMLElement, beside: number): void {
  const rect = anchor.getBoundingClientRect()
  const safe = getComputedStyle(q('app'))
  const left = Math.max(8, parseFloat(safe.getPropertyValue('--safe_left')) || 0)
  const right = innerWidth - Math.max(8, parseFloat(safe.getPropertyValue('--safe_right')) || 0)
  const top = Math.max(8, parseFloat(safe.getPropertyValue('--safe_top')) || 0)
  let bottom = innerHeight - Math.max(8, parseFloat(getComputedStyle(q('tl')).paddingBottom) || 0)
  const drawing = panel.classList.contains('drawing_bench')
  if (drawing && st().view.tlopen) {
    const timeline = q('frame_panel').getBoundingClientRect().top - 8
    if (timeline >= top + 200) bottom = Math.min(bottom, timeline)
  }
  panel.style.width = ''
  panel.style.maxHeight = bottom - top + 'px'
  panel.style.overflowY = 'auto'
  panel.style.transform = 'none'
  const width = Math.min(panel.offsetWidth, drawing ? 440 : 380, right - left)
  panel.style.width = width + 'px'
  const group = beside && anchor.closest('#mobile_tools') ? q('mobile_tools').getBoundingClientRect() : rect
  const space_right = right - group.right - 8
  const space_left = group.left - left - 8
  if (beside && Math.max(space_right, space_left) >= Math.min(width, 220)) {
    const use_right = space_right >= Math.min(width, 220)
    const start = clamp(rect.top, top, Math.max(top, bottom - (drawing ? Math.min(panel.offsetHeight, 260) : 120)))
    panel.style.width = Math.min(width, use_right ? space_right : space_left) + 'px'
    panel.style.maxHeight = bottom - start + 'px'
    panel.style.left = (use_right ? group.right + 8 : group.left - panel.offsetWidth - 8) + 'px'
    panel.style.top = start + 'px'
    return
  }
  const above = Math.max(0, rect.top - top - 8)
  const below = Math.max(0, bottom - rect.bottom - 8)
  const use_above = above >= panel.offsetHeight || above >= below
  panel.style.maxHeight = (use_above ? above : below) + 'px'
  panel.style.left = clamp(rect.right - panel.offsetWidth, left, right - panel.offsetWidth) + 'px'
  panel.style.top = (use_above ? rect.top - panel.offsetHeight - 8 : rect.bottom + 8) + 'px'
}

function pop_anchor_layout(): void {
  if (!overlay_state.anchor) return
  if (!overlay_state.pop) return
  const panel = q(overlay_state.pop)
  const beside = panel.classList.contains('drawing_bench') || overlay_state.pop === 'pop_mark' || overlay_state.pop === 'pop_tf' || overlay_state.pop === 'pop_layer' && getComputedStyle(q('live_layer_tabs')).flexDirection === 'column' ? 1 : 0
  anchored_panel_layout(q(overlay_state.pop), overlay_state.anchor, beside)
}

function drawing_menu_layout(profile: workspace_profile_t): void {
  const dock = q('mobile_tools')
  const drawing = overlay_state.pop === 'pop_tool' || overlay_state.pop === 'pop_color'
  const rail = q('rail').classList.contains('on')
  document.body.dataset.toolbox = rail ? '1' : '0'
  q('view_onion_btn').setAttribute('aria-expanded', String(!!rail))
  const active = drawing || rail
  document.body.dataset.drawingMenu = active ? '1' : '0'
  document.body.dataset.pop = overlay_state.pop
  dirty(d_sel)
  if (drawing) {
    document.body.dataset.drawingLayout = 'anchored'
    for (const button of dock.querySelectorAll<HTMLElement>('button')) button.setAttribute('aria-expanded', String(button === overlay_state.anchor))
    pop_anchor_layout()
    return
  }
  if (profile.wide) {
    document.body.dataset.drawingLayout = rail ? 'split' : 'sheet'
  } else {
    const full = rail && (innerWidth < 960 || innerHeight <= 520 || document.body.dataset.focus === '1')
    const split = !full && rail && innerWidth > innerHeight && innerWidth >= 640 && innerHeight >= 301 && document.body.dataset.focus !== '1'
    document.body.dataset.drawingLayout = full ? 'full' : split ? 'split' : 'sheet'
    if (split) {
      const rect = dock.getBoundingClientRect()
      document.documentElement.style.setProperty('--drawing_bay_right', `${innerWidth - rect.left + 14}px`)
    }
  }
  for (const button of dock.querySelectorAll<HTMLElement>('button')) button.setAttribute('aria-expanded', String(button === overlay_state.anchor && !!overlay_state.pop || button.getAttribute('aria-controls') === 'rail' && rail))
  if (overlay_state.anchor) overlay_state.anchor.setAttribute('aria-expanded', 'true')
  pop_anchor_layout()
}

function layer_stack_layout(): void {
  const stack = q('layer_stack')
  const tabs = q('live_layer_tabs')
  const horizontal = getComputedStyle(tabs).flexDirection === 'row'
  if (horizontal) stack.style.removeProperty('--layer_limit')
  else {
    const area = stack.getBoundingClientRect()
    const column = tabs.getBoundingClientRect()
    let bottom = innerHeight - 8
    for (const element of document.querySelectorAll<HTMLElement>('#frame_panel,#fs,#tl_bar button,#hd button,#mobile_tools button')) {
      if (element.hidden || !element.getClientRects().length) continue
      const rect = element.getBoundingClientRect()
      if (rect.width && rect.height && rect.left < column.right && rect.right > column.left && rect.bottom > area.top) bottom = Math.min(bottom, rect.top - 8)
    }
    stack.style.setProperty('--layer_limit', Math.max(0, bottom - area.top) + 'px')
  }
  const overflow = horizontal ? tabs.scrollWidth > tabs.clientWidth + 1 : tabs.scrollHeight > tabs.clientHeight + 1
  stack.dataset.scroll = overflow ? horizontal ? 'x' : 'y' : ''
  const selected = tabs.querySelector<HTMLElement>('[aria-pressed="true"]')
  if (!overflow || !selected) return
  const visible = tabs.getBoundingClientRect()
  const active = selected.getBoundingClientRect()
  if (horizontal) {
    if (active.left < visible.left) tabs.scrollLeft += active.left - visible.left
    else if (active.right > visible.right) tabs.scrollLeft += active.right - visible.right
  } else {
    if (active.top < visible.top) tabs.scrollTop += active.top - visible.top
    else if (active.bottom > visible.bottom) tabs.scrollTop += active.bottom - visible.bottom
  }
}

export function workspace_context_layout(m: HTMLElement, anchor: HTMLElement): void {
  anchored_panel_layout(m, anchor, 0)
}
