import { doc_frame_order } from '../doc'
import { list_update } from './render'
import { tr } from '../lang'
import { el, ic, q, query } from '../dom'
import { l_draw_default, l_draw_max, l_p, mode_3_d, mode_normal } from '../h'
import { layer_name, mode_allows_layer_alpha, mode_one_sheet } from '../mode'
import { st } from '../state/store'

const l_tints = ['#8A7B72', '#E0443B', '#2E6BE0', '#20A464', '#D48824', '#8C59C7', '#1F9FA8', '#D05C91', '#667085']

function layer_row_create(layer: number): HTMLElement {
  const row = el('div', 'lrow', `<button class="lbtn leye" title="表示/非表示"></button><button class="lpick" title="${layer === l_p ? '画像を写真レイヤーへ追加' : 'このレイヤーに描く'}"><span class="lchip"></span><span class="lname"></span></button><input class="lal" type="range" min="0" max="100" title="不透明度"><button class="lbtn lup" title="前面へ">${ic('up')}</button><button class="lbtn ldn" title="背面へ">${ic('down')}</button>`)
  row.dataset.l = String(layer)
  for (const node of row.querySelectorAll<HTMLElement>('button,input')) node.dataset.l = String(layer)
  const chip = query<HTMLElement>(row, '.lchip')
  chip.style.cssText = 'width:12px;height:12px;border-radius:4px;background:' + l_tints[layer % l_tints.length]
  query(row, '.lname').textContent = tr(layer_name(layer))
  query(row, '.lpick').classList.toggle('lphoto_pick', layer === l_p)
  return row
}

export function layer_panel_render(): void {
  const g = st()
  const order = doc_frame_order(g.doc.cur)
  const alpha_ok = mode_allows_layer_alpha(g.doc.mode)
  list_update(q('layer_rows'), [...order, l_p], layer => String(layer), layer_row_create, (row, layer, index) => {
    row.classList.toggle('on', g.pen.layer === layer)
    const eye = query<HTMLElement>(row, '.leye')
    const visible = String(!!g.doc.lvis[layer])
    if (eye.dataset.visible !== visible) {
      eye.innerHTML = ic(g.doc.lvis[layer] ? 'eye' : 'eyeoff')
      eye.dataset.visible = visible
    }
    const alpha = query<HTMLInputElement>(row, '.lal')
    alpha.hidden = !alpha_ok
    if (document.activeElement !== alpha) alpha.value = String(Math.round(g.doc.lalpha[layer] / 255 * 100))
    for (const [selector, off] of [['.lup', index === 0], ['.ldn', index === order.length - 1]] as const) {
      const button = query<HTMLButtonElement>(row, selector)
      button.classList.toggle('off', layer === l_p || off)
      button.disabled = layer === l_p || off
      button.style.visibility = layer === l_p ? 'hidden' : ''
    }
  })
  q('layer_tag').textContent = layer_name(g.pen.layer)
  const sheet = mode_one_sheet(g.doc)
  q('penbox_row').hidden = g.doc.mode !== mode_3_d
  for (const [id, on] of [['penbox_normal', sheet], ['penbox_advanced', !sheet]] as const) q(id).setAttribute('aria-pressed', String(!!on))
  for (const row of q('layer_rows').querySelectorAll<HTMLElement>('.lrow')) row.hidden = !!sheet && row.dataset.l !== String(l_p)
  q('lclear_btn').title = tr(sheet ? 'いまのコマの絵をぜんぶ消去' : 'いまのレイヤーを消去')
  q('merge_btn').classList.toggle('off', !!sheet)
  q('lcopy_btn').classList.toggle('off', !!sheet)
  const normal = g.doc.mode === mode_normal
  q('layer_edit').hidden = !normal
  q('ladd_btn').classList.toggle('off', !normal || g.doc.lord.length >= l_draw_max)
  q('ldel_btn').classList.toggle('off', !normal || g.pen.layer <= l_draw_default)
  const draft = q('photo_draft_btn')
  const draft_on = alpha_ok && g.doc.lalpha[l_p] < 250
  draft.classList.toggle('on', !!draft_on)
  draft.classList.toggle('off', !alpha_ok)
  const draft_label = draft.querySelector('span')
  if (draft_label) draft_label.textContent = tr(draft_on ? '100%に戻す' : '下書き35%')
  q('photo_clear_btn').classList.toggle('off', !g.doc.frames[g.doc.cur].pk[l_p])
}
