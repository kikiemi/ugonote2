import { Fragment, h, render, type JSX } from 'preact'
import { ic, q } from '../dom'
import { L_DRAW_DEFAULT, L_DRAW_MAX, L_P, MODE_NORMAL } from '../h'
import { layer_name, mode_allows_layer_alpha, mode_order } from '../mode'
import { st } from '../state/store'

const L_TINTS = ['#8A7B72', '#E0443B', '#2E6BE0', '#20A464', '#D48824', '#8C59C7', '#1F9FA8', '#D05C91', '#667085']

function icon(name: string) {
  return h('span', { dangerouslySetInnerHTML: { __html: ic(name) }, class: 'picwrap' })
}

function layer_row(layer: number, index: number, count: number, alphaOk: number) {
  const g = st()
  const visible = g.doc.lvis[layer]
  const alpha = Math.round((g.doc.lalpha[layer] / 255) * 100)
  const moves = layer === L_P
    ? [h('button', { class: 'lbtn off' }), h('button', { class: 'lbtn off' })]
    : [
        h('button', { class: 'lbtn lup' + (index === 0 ? ' off' : ''), 'data-l': layer, title: '前面へ' }, icon('up')),
        h('button', { class: 'lbtn ldn' + (index === count - 1 ? ' off' : ''), 'data-l': layer, title: '背面へ' }, icon('down')),
      ]
  return h(
    'div',
    { class: 'lrow' + (g.pen.layer === layer ? ' on' : ''), 'data-l': layer, key: layer },
    h('button', { class: 'lbtn leye', 'data-l': layer, title: '表示/非表示' }, icon(visible ? 'eye' : 'eyeoff')),
    h(
      'button',
      { class: 'lpick', 'data-l': layer },
      h('span', { class: 'lchip', style: 'width:12px;height:12px;border-radius:4px;background:' + L_TINTS[layer] }),
      layer_name(layer)
    ),
    h('input', { class: 'lal', 'data-l': layer, type: 'range', min: '0', max: '100', value: String(alpha), title: '不透明度', style: alphaOk ? '' : 'display:none' }),
    ...moves
  )
}

export function layer_panel_render(): void {
  const g = st()
  const order = mode_order(g.doc.mode, g.doc.lord)
  const alphaOk = mode_allows_layer_alpha(g.doc.mode)
  const rows: JSX.Element[] = []
  for (let index = 0; index < order.length; index++) rows.push(layer_row(order[index], index, order.length, alphaOk))
  rows.push(layer_row(L_P, 0, 1, alphaOk))
  render(h(Fragment, null, rows), q('layerRows'))
  q('layerTag').textContent = layer_name(g.pen.layer)
  const normal = g.doc.mode === MODE_NORMAL
  q('laddBtn').classList.toggle('off', !normal || g.doc.lord.length >= L_DRAW_MAX)
  q('ldelBtn').classList.toggle('off', !normal || g.pen.layer <= L_DRAW_DEFAULT)
}
