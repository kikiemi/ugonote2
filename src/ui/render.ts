import { tr_dom } from '../lang'

export function html_mount(root: HTMLElement, html: string): void {
  root.innerHTML = html
  tr_dom(root)
}

export function list_update<t>(root: HTMLElement, values: readonly t[], key: (value: t, index: number) => string, create: (value: t) => HTMLElement, update: (node: HTMLElement, value: t, index: number) => void): void {
  const nodes = new Map<string, HTMLElement>()
  for (const child of root.children) if (child instanceof HTMLElement && child.dataset.key !== undefined) nodes.set(child.dataset.key, child)
  let before = root.firstElementChild
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    const id = key(value, i)
    let node = nodes.get(id)
    if (node) nodes.delete(id)
    else {
      node = create(value)
      node.dataset.key = id
    }
    if (node !== before) root.insertBefore(node, before)
    update(node, value, i)
    before = node.nextElementSibling
  }
  for (const node of nodes.values()) node.remove()
}
