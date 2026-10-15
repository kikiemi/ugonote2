import { list_update } from './render'
import { doc_frame_order } from '../doc'
import { el, ic, q } from '../dom'
import { mode_normal } from '../h'
import { tr, tr_line } from '../lang'
import { layer_name } from '../mode'
import { st } from '../state/store'

export function layer_stack_render(): void {
  const g = st()
  const settings = tr(g.doc.mode === mode_normal ? 'レイヤーの設定・追加' : 'レイヤーの設定')
  q('layer_btn').title = settings
  q('layer_btn').setAttribute('aria-label', settings)
  const order = doc_frame_order(g.doc.cur)
  const tabs = q('live_layer_tabs')
  list_update(tabs, order, layer => String(layer), layer => {
    const button = el('button', 'live_layer', layer === 0 ? ic('image') : '')
    button.id = 'live_layer_' + layer
    button.dataset.liveLayer = String(layer)
    button.setAttribute('aria-haspopup', 'dialog')
    button.setAttribute('aria-controls', 'pop_layer')
    if (layer !== 0) button.textContent = layer_name(layer)
    return button
  }, (button, layer) => {
    const selected = g.pen.layer === layer
    const label = layer === 0 ? tr('写真レイヤー') : tr_line('レイヤー ' + layer_name(layer))
    button.setAttribute('aria-pressed', String(selected))
    button.setAttribute('aria-label', label)
    button.title = label + '・' + tr(selected ? 'もう一度押すと設定' : 'このレイヤーに描く')
  })
}
