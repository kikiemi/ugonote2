import { esc, ic, q } from '../dom'
import { clamp } from '../lib'
import { sfx_play } from '../snd'
import { storage_set } from '../storage'

type CtxItem = { label: string, icon: string, fn: () => void, off?: number }

let openPop = ''

export function pop_rect(id: string): HTMLElement {
  return q(id)
}

let onPopClose: ((id: string) => void) | null = null

export function pop_close_hook(fn: (id: string) => void): void {
  onPopClose = fn
}

export function pop_close(): void {
  const was = openPop
  for (const pop of document.querySelectorAll<HTMLElement>('.pop.on')) pop.classList.remove('on')
  q('popScrim').classList.remove('on')
  openPop = ''
  if (was && onPopClose) onPopClose(was)
}

export function pop_open(id: string, anchor: HTMLElement): void {
  if (openPop && openPop !== id) pop_close()
  const p = pop_rect(id)
  p.classList.add('on')
  q('popScrim').classList.add('on')
  openPop = id
  const vw = window.innerWidth
  const vh = window.innerHeight
  const ar = anchor.getBoundingClientRect()
  const pw = p.offsetWidth
  const ph = p.offsetHeight
  let x: number
  let y = clamp(ar.top - 8, 8, Math.max(8, vh - ph - 8))
  if (ar.left > vw / 2) x = Math.max(8, ar.left - pw - 10)
  else x = Math.min(vw - pw - 8, ar.right + 10)
  if (ar.bottom >= vh - 90) {
    y = Math.max(8, ar.top - ph - 10)
    x = clamp(ar.left + ar.width / 2 - pw / 2, 8, Math.max(8, vw - pw - 8))
  }
  p.style.left = x + 'px'
  p.style.top = y + 'px'
}

export function pop_toggle(id: string, anchor: HTMLElement): void {
  if (openPop === id) pop_close()
  else pop_open(id, anchor)
}

export function drawer_set(on: number): void {
  q('drawer').classList.toggle('on', on ? true : false)
  q('scrim').classList.toggle('on', on ? true : false)
  if (!on) {
    pop_close()
    rail_sheet(0)
    q('popScrim').classList.remove('on')
  }
  if (on) {
    pop_close()
    storage_set('ug2_menuseen', '1')
    q('menuBtn').classList.remove('pulse')
  }
  sfx_play('tap')
}

export function rail_sheet(open: number): void {
  q('rail').classList.toggle('on', open ? true : false)
  if (open) q('popScrim').classList.add('on')
  else if (!openPop) q('popScrim').classList.remove('on')
}

export function ctx_hide(): void {
  q('ctxMenu').classList.add('hide')
}

function ctx_prepare(items: CtxItem[]): HTMLElement {
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
  const m = ctx_prepare(items)
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
