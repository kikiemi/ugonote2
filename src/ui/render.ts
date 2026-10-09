import { h, render, type ComponentChildren } from 'preact'
import { ic } from '../dom'
import { tr_dom } from '../lang'

export function html_mount(root: HTMLElement, html: string): void {
  root.innerHTML = html
  tr_dom(root)
}

export function list_render(root: HTMLElement, children: ComponentChildren): void {
  render(children, root)
}

export function ui_icon(name: string) {
  return h('span', { class: 'picwrap', dangerouslySetInnerHTML: { __html: ic(name) } })
}
