import { list_update } from './render'
import { tr } from '../lang'
import { el, q } from '../dom'
import { st } from '../state/store'

function color_cells(id: string, inks: readonly string[], custom: number): void {
  const current = st().pen.color.toUpperCase()
  list_update(q(id), inks, (color, index) => color + (custom ? index : ''), () => el('button', 'palc', ''), (node, color, index) => {
    node.dataset.c = color
    if (custom) node.dataset.ci = String(index)
    node.classList.toggle('on', color.toUpperCase() === current)
    node.style.background = color
    node.title = custom ? tr('長押しで削除') : color
    node.setAttribute('aria-label', tr(custom ? 'じぶんの色' : 'いろ') + ' ' + color)
    node.setAttribute('aria-pressed', String(color.toUpperCase() === current))
  })
}

export function palette_render(inks: readonly string[]): void {
  color_cells('pal_grid', inks, 0)
  color_cells('cust_grid', st().pen.custom, 1)
}

export function marks_render(): void {
  marks_render_into('mark_grid')
  marks_render_into('shape_mark_grid')
}

function marks_render_into(id: string): void {
  const marks = st().marks
  const items = marks.length ? marks : [{ id: 'empty', name: '', data: '' }]
  list_update(q(id), items, mark => mark.data ? 'mark:' + mark.id : 'empty', mark => el(mark.data ? 'button' : 'div', mark.data ? 'mkb' : 'phint', mark.data ? '<img alt="">' : ''), (node, mark) => {
    if (!mark.data) {
      node.textContent = tr('まだ登録がありません')
      return
    }
    node.dataset.markid = mark.id
    node.dataset.userText = ''
    node.title = mark.name
    const img = node.querySelector('img')!
    if (img.getAttribute('src') !== mark.data) img.src = mark.data
  })
}
