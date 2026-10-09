import { tr_line } from '../lang'
import { responsive_wide } from './responsive'
import { layer_stack_layout } from './workbench'
import { esc, ic, q } from '../dom'
import { clamp } from '../lib'
import { TOOL_DEFS } from './tool_defs'
import { st } from '../state/store'
import { sfx_play } from '../snd'
import { storage_set } from '../storage'
import { home_show, home_preview_stop } from './home'
import { modal_active, modal_background_inert } from './modal'

let drawerFocus: HTMLElement | null = null
let drawerInert: { element: HTMLElement, previous: boolean }[] = []

function drawer_focusable(): HTMLElement[] {
  return Array.from(q('drawer').querySelectorAll<HTMLElement>('button,input,select,textarea,a[href]')).filter(el => !el.hasAttribute('disabled') && !el.closest('[inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
}

function drawer_tab(e: KeyboardEvent): void {
  if (e.key !== 'Tab') return
  const controls = drawer_focusable()
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (!first) return
  if (!controls.includes(document.activeElement as HTMLElement) || (e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last)) {
    e.preventDefault()
    ;(e.shiftKey ? last : first).focus()
  }
}

type CtxItem = { label: string, icon: string, fn: () => void, off?: number }

let openPop = ''
let openAnchor: HTMLElement | null = null
let ctxAnchor: HTMLElement | null = null

const drawingPops = new Set(['popTool', 'popColor'])

function pop_anchor_layout(): void {
  if (!openAnchor || !['popFps', 'popHold', 'popView', 'popOnion', 'popLayer', 'popPaper'].includes(openPop)) return
  const p = q(openPop)
  const rect = openAnchor.getBoundingClientRect()
  const safeTop = Math.max(8, parseFloat(getComputedStyle(q('app')).getPropertyValue('--safe-top')) || 0)
  const safeBottom = parseFloat(getComputedStyle(q('tl')).paddingBottom) || 0
  p.style.width = ''
  p.style.left = '50%'
  p.style.transform = 'translateX(-50%)'
  if (responsive_wide()) {
    const dock = q('mobileTools').getBoundingClientRect()
    const width = Math.min(380, dock.left - 24)
    p.style.left = dock.left - width - 12 + 'px'
    p.style.top = '8px'
    p.style.width = width + 'px'
    p.style.maxHeight = Math.max(120, (st().view.tlopen ? q('framePanel').getBoundingClientRect().top : innerHeight - 64) - 16) + 'px'
    p.style.transform = 'none'
    p.style.overflowY = 'auto'
    return
  }
  if (openPop === 'popLayer') {
    const stack = q('layerStack').getBoundingClientRect()
    if (innerHeight >= innerWidth && getComputedStyle(q('layerStack')).flexDirection === 'row') {
      const top = stack.bottom + 8
      p.style.top = top + 'px'
      p.style.maxHeight = Math.max(120, innerHeight - top - safeBottom - 8) + 'px'
    } else {
      const left = stack.right + 8
      p.style.left = left + 'px'
      p.style.top = safeTop + 'px'
      p.style.width = Math.max(220, Math.min(p.offsetWidth, innerWidth - left - 8)) + 'px'
      p.style.maxHeight = Math.max(120, innerHeight - safeTop - safeBottom - 8) + 'px'
      p.style.transform = 'none'
    }
    return
  }
  if (openPop === 'popOnion' && innerWidth > innerHeight && rect.left >= p.offsetWidth + 16) {
    p.style.maxHeight = Math.max(120, innerHeight - safeTop - safeBottom - 8) + 'px'
    p.style.top = safeTop + 'px'
    p.style.left = rect.left - p.offsetWidth - 8 + 'px'
    p.style.transform = 'none'
  } else {
    p.style.maxHeight = Math.max(120, rect.top - safeTop - 8) + 'px'
    p.style.top = Math.max(safeTop, rect.top - p.offsetHeight - 8) + 'px'
  }
  p.style.overflowY = 'auto'
}

export function drawing_menu_layout(): void {
  layer_stack_layout()
  const dock = q('mobileTools')
  const active = drawingPops.has(openPop) || q('rail').classList.contains('on')
  document.body.dataset.drawingMenu = active ? '1' : '0'
  document.body.dataset.pop = openPop
  const previousLayout = document.body.dataset.drawingLayout
  if (responsive_wide()) {
    document.body.dataset.drawingLayout = active ? 'split' : 'sheet'
    for (const button of dock.querySelectorAll<HTMLElement>('button')) button.setAttribute('aria-expanded', String(button === openAnchor && !!openPop || button.id === 'dockMore' && q('rail').classList.contains('on')))
    if (drawingPops.has(openPop)) q('popScrim').classList.remove('on')
    pop_anchor_layout()
    return
  }
  const full = q('rail').classList.contains('on') && (innerWidth < 960 || innerHeight <= 520 || document.body.dataset.focus === '1')
  const split = !full && active && (!openPop || drawingPops.has(openPop)) && matchMedia('(orientation:landscape) and (min-width:640px) and (min-height:301px)').matches && document.body.dataset.focus !== '1'
  document.body.dataset.drawingLayout = full ? 'full' : split ? 'split' : 'sheet'
  for (const button of q('dockRow').querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-expanded', String(button === openAnchor && drawingPops.has(openPop) || button.id === 'dockMore' && q('rail').classList.contains('on')))
  }
  if (openAnchor) openAnchor.setAttribute('aria-expanded', 'true')
  pop_anchor_layout()
  if (!active) return
  if (full) {
    if (previousLayout !== 'full' && openPop === 'popTool') tool_page_show()
    return
  }
  if (split) {
    const rect = dock.getBoundingClientRect()
    document.documentElement.style.setProperty('--drawing-bay-right', `${innerWidth - rect.left + 14}px`)
    if (previousLayout !== 'split' && openPop === 'popTool') tool_page_show()
    return
  }
  const rect = dock.getBoundingClientRect()
  const portrait = matchMedia('(orientation:portrait)').matches
  document.documentElement.style.setProperty('--drawing-left', '8px')
  document.documentElement.style.setProperty('--drawing-right', `${Math.max(8, innerWidth - rect.left + 8)}px`)
  document.documentElement.style.setProperty('--drawing-bottom', `${portrait ? Math.max(84, innerHeight - rect.top + 8) : 8}px`)

}

export function tool_page_show(page?: string, scroll = true): void {
  const body = q('toolOptions')
  const available = Array.from(body.querySelectorAll<HTMLElement>('.pbk:not(.off)')).map(el => el.dataset.optionsPage)
  const selected = page || body.dataset.toolPage
  const current = selected && available.includes(selected) ? selected : available[0] || 'detail'
  const changed = current !== body.dataset.toolPage
  q('toolSettingsName').textContent = tr_line(current === 'grid' ? 'マス目' : current === 'size' ? 'ふとさ' : TOOL_DEFS.find(tool => tool.t === st().pen.tool)?.label || 'どうぐ')
  body.dataset.toolPage = current
  body.dataset.toolDetail = current === 'detail' ? '1' : '0'
  const target = body.querySelector<HTMLElement>(`[data-options-page="${current}"]:not(.off)`)
  if (scroll || changed) body.scrollTop = target ? target.offsetTop - body.offsetTop : 0
  for (const button of q('popTool').querySelectorAll<HTMLButtonElement>('button[data-tool-page]')) {
    button.hidden = !available.includes(button.dataset.toolPage)
    button.setAttribute('aria-pressed', button.dataset.toolPage === current ? 'true' : 'false')
  }
}

export function pop_rect(id: string): HTMLElement {
  return q(id)
}

let onPopClose: ((id: string) => void) | null = null

export function pop_close_hook(fn: (id: string) => void): void {
  onPopClose = fn
}

export function pop_close(): void {
  const was = openPop
  if (openAnchor) openAnchor.setAttribute('aria-expanded', 'false')
  for (const pop of document.querySelectorAll<HTMLElement>('.pop.on')) pop.classList.remove('on')
  q('popScrim').classList.remove('on')
  openPop = ''
  openAnchor = null
  drawing_menu_layout()
  if (was && onPopClose) onPopClose(was)
}

export function pop_open(id: string, anchor: HTMLElement): void {
  rail_sheet(0)
  if (openPop && openPop !== id) pop_close()
  const p = pop_rect(id)
  p.classList.add('on')
  q('popScrim').classList.add('on')
  openPop = id
  openAnchor = anchor
  drawing_menu_layout()
  if (id === 'popTool') tool_page_show()

}

export function pop_toggle(id: string, anchor: HTMLElement): void {
  const group = (button: HTMLElement | null): string => button?.id === 'dockSize' || button?.id === 'sizeBtn' ? 'size' : button?.id === 'dockGrid' ? 'grid' : 'tool'
  const sameControl = id !== 'popTool' || group(openAnchor) === group(anchor)
  if (openPop === id && sameControl) pop_close()
  else pop_open(id, anchor)
}

export function drawer_set(on: number): void {
  const drawer = q('drawer')
  const was = drawer.classList.contains('on')
  if (on && !was) {
    drawerFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    drawerInert = []
    for (const element of Array.from(drawer.parentElement?.children || [])) {
      if (!(element instanceof HTMLElement) || element === drawer || element.id === 'modalRoot' || element.id === 'tutRoot') continue
      drawerInert.push({ element, previous: element.inert })
      modal_background_inert(element, true)
    }
    drawer.addEventListener('keydown', drawer_tab)
  }
  q('drawer').classList.toggle('on', on ? true : false)
  q('scrim').classList.toggle('on', on ? true : false)
  if (!on) {
    home_preview_stop()
    pop_close()
    rail_sheet(0)
    q('popScrim').classList.remove('on')
    for (const entry of drawerInert) modal_background_inert(entry.element, entry.previous)
    drawerInert = []
    drawer.removeEventListener('keydown', drawer_tab)
    if (!modal_active() && drawerFocus?.isConnected && !drawerFocus.closest('[inert]')) drawerFocus.focus({ preventScroll: true })
    drawerFocus = null
  }
  if (on) {
    home_show()
    pop_close()
    storage_set('ug2_menuseen', '1')
    q('menuBtn').classList.remove('pulse')
    if (!modal_active()) q('drawerClose').focus({ preventScroll: true })
  }
  sfx_play('tap')
}

export function rail_sheet(open: number): void {
  if (open) pop_close()
  q('rail').classList.toggle('on', open ? true : false)
  if (open) q('popScrim').classList.add('on')
  else if (!openPop) q('popScrim').classList.remove('on')
  drawing_menu_layout()
}

export function ctx_hide(): void {
  q('ctxMenu').classList.add('hide')
  if (ctxAnchor) ctxAnchor.setAttribute('aria-expanded', 'false')
  ctxAnchor = null
}

function ctx_prepare(items: CtxItem[]): HTMLElement {
  ctx_hide()
  const m = q('ctxMenu')
  let html = ''
  for (let i = 0; i < items.length; i++) html += '<button class="citem' + (items[i].off ? ' off' : '') + '" data-i="' + i + '">' + ic(items[i].icon) + '<span>' + esc(items[i].label) + '</span></button>'
  m.innerHTML = html
  m.style.maxHeight = ''
  m.style.overflowY = ''
  m.classList.remove('hide')
  m.onclick = e => {
    const t = (e.target as HTMLElement).closest('.citem') as HTMLElement | null
    if (!t || t.classList.contains('off')) return
    const it = items[Number(t.dataset.i)]
    ctx_hide()
    it.fn()
  }
  return m
}

export function ctx_show(x: number, y: number, items: CtxItem[]): void {
  const m = ctx_prepare(items)
  const mw = m.offsetWidth
  const mh = m.offsetHeight
  m.style.left = clamp(x, 4, window.innerWidth - mw - 4) + 'px'
  m.style.top = clamp(y, 4, window.innerHeight - mh - 4) + 'px'
}

export function ctx_show_above(anchor: HTMLElement, items: CtxItem[]): void {
  if (ctxAnchor === anchor && !q('ctxMenu').classList.contains('hide')) {
    ctx_hide()
    return
  }
  const m = ctx_prepare(items)
  ctxAnchor = anchor
  anchor.setAttribute('aria-expanded', 'true')
  if (responsive_wide()) {
    const dock = q('mobileTools').getBoundingClientRect()
    m.style.left = Math.max(8, dock.left - m.offsetWidth - 12) + 'px'
    m.style.top = '8px'
    m.style.maxHeight = innerHeight - 80 + 'px'
    m.style.overflowY = 'auto'
    return
  }
  const r = anchor.getBoundingClientRect()
  m.style.maxHeight = Math.max(96, Math.floor(r.top - 12)) + 'px'
  m.style.overflowY = 'auto'
  const mw = m.offsetWidth
  const mh = m.offsetHeight
  m.style.left = clamp(r.right - mw, 4, window.innerWidth - mw - 4) + 'px'
  m.style.top = Math.max(4, r.top - mh - 8) + 'px'
}

export function pop_is_open(): string {
  return openPop
}

export function pop_is_anchored(anchor: HTMLElement): boolean {
  return !!openPop && openAnchor === anchor
}
