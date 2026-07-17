import { Fragment, h, render, type JSX } from 'preact'
import { q } from '../dom'
import { st } from '../state/store'

export function palette_render(inks: readonly string[]): void {
  const p = st().pen
  const cur = p.color.toUpperCase()
  const cells: JSX.Element[] = inks.map(c =>
    h('button', { class: 'palc' + (c.toUpperCase() === cur ? ' on' : ''), 'data-c': c, style: 'background:' + c, title: c, key: c })
  )
  render(h(Fragment, null, cells), q('palGrid'))
  const cust: JSX.Element[] = p.custom.map((c, i) =>
    h('button', { class: 'palc' + (c.toUpperCase() === cur ? ' on' : ''), 'data-c': c, 'data-ci': i, style: 'background:' + c, title: '長押しで削除', key: c + i })
  )
  render(h(Fragment, null, cust), q('custGrid'))
}

export function marks_render(): void {
  const marks = st().marks
  const mg = q('markGrid')
  const key = marks.map(mk => mk.id).join(',')
  if (mg.dataset.mkey === key) return
  mg.dataset.mkey = key
  const items: JSX.Element[] = marks.length
    ? marks.map(mk => h('button', { class: 'mkb', 'data-markid': mk.id, title: mk.name, key: mk.id }, h('img', { src: mk.data, alt: '' })))
    : [h('div', { class: 'phint', key: 'empty' }, 'まだ登録がありません')]
  render(h(Fragment, null, items), mg)
}
