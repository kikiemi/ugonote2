import { list_render } from './render'
import { tr } from '../lang'
import { Fragment, h, type JSX } from 'preact'
import { q } from '../dom'
import { st } from '../state/store'

export function palette_render(inks: readonly string[]): void {
  const p = st().pen
  const cur = p.color.toUpperCase()
  const cells: JSX.Element[] = inks.map(c =>
    h('button', { class: 'palc' + (c.toUpperCase() === cur ? ' on' : ''), 'data-c': c, style: 'background:' + c, title: c, 'aria-label': tr('いろ') + ' ' + c, 'aria-pressed': c.toUpperCase() === cur, key: c })
  )
  list_render(q('palGrid'), h(Fragment, null, cells))
  const cust: JSX.Element[] = p.custom.map((c, i) =>
    h('button', { class: 'palc' + (c.toUpperCase() === cur ? ' on' : ''), 'data-c': c, 'data-ci': i, style: 'background:' + c, title: tr('長押しで削除'), 'aria-label': tr('じぶんの色') + ' ' + c, 'aria-pressed': c.toUpperCase() === cur, key: c + i })
  )
  list_render(q('custGrid'), h(Fragment, null, cust))
}

export function marks_render(): void {
  const marks = st().marks
  const mg = q('markGrid')
  const key = marks.map(mk => mk.id).join(',')
  if (mg.dataset.mkey === key) return
  mg.dataset.mkey = key
  const items: JSX.Element[] = marks.length
    ? marks.map(mk => h('button', { class: 'mkb', 'data-markid': mk.id, title: mk.name, 'data-user-text': '', key: mk.id }, h('img', { src: mk.data, alt: '' })))
    : [h('div', { class: 'phint', key: 'empty' }, tr('まだ登録がありません'))]
  list_render(mg, h(Fragment, null, items))
}
