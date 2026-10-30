import { esc, toast } from '../dom'
import { hold_max } from '../h'
import { clamp } from '../lib'
import { layer_name, mode_order } from '../mode'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { modal_close, modal_confirm } from './modal'
import { sheet_open } from './sheet'
import { action_tile } from './templates/parts'

export function op_layer_clear(): void {
  if (dispatch('layer.clear', null) < 0) return
  toast('レイヤーを消しました')
  sfx_play('del')
}

export function op_layer_copy(): void {
  const g = st()
  const src = g.pen.layer
  const order = mode_order(g.doc.mode, g.doc.lord)
  let btns = ''
  for (const layer of order) {
    if (layer === src) continue
    btns += '<button class="act" data-dst="' + layer + '"><b>' + esc(layer_name(layer)) + '</b><span>へコピー</span></button>'
  }
  if (!btns) {
    toast('コピー先のレイヤーがありません')
    return
  }
  const box = sheet_open({ icon: 'dup', title: 'レイヤー' + esc(layer_name(src)) + 'をコピー', pages: [{ id: 'copy', icon: 'dup', label: 'コピー', body: '<section class="opt"><div class="acts layer_targets">' + btns + '</div></section>' }] })
  box.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('[data-dst]') as HTMLElement | null
    if (!b) return
    const dst = Number(b.dataset.dst)
    modal_close()
    if (dispatch('layer.copy_to', dst) < 0) return
    toast(layer_name(src) + 'を' + layer_name(dst) + 'にコピーしました')
    sfx_play('paper')
  })
}

export function modal_range(): void {
  const g = st()
  const n = g.doc.frames.length
  const box = sheet_open({
    icon: 'ab',
    title: 'コマの範囲操作',
    pages: [{
      id: 'range',
      icon: 'ab',
      label: '範囲',
      body: `<section class="opt">
          <div class="opt_head"><b>はんい</b></div>
          <div class="opt_row"><input type="number" class="numin" id="rg_from" min="1" max="${n}" value="1" aria-label="はじめのコマ"><span class="unit">〜</span><input type="number" class="numin" id="rg_to" min="1" max="${n}" value="${n}" aria-label="おわりのコマ"><span class="unit">コマ目</span></div>
        </section>
        <section class="opt">
          <div class="acts">${action_tile('rg_rev', 'swap', '逆順にする')}${action_tile('rg_dup', 'dup', '複製')}${action_tile('rg_ping', 'loop', '往復にする')}${action_tile('rg_del', 'trash', '削除')}</div>
        </section>
        <section class="opt">
          <div class="opt_row"><label class="plab" for="rg_hold">表示時間</label><input type="range" id="rg_hold" min="1" max="${hold_max}" step="1" value="1"><output id="rg_hold_val">×1</output></div>
          <div class="opt_row"><button class="pbtn" id="rg_hold_go">まとめて変える</button></div>
        </section>`,
    }],
  })
  const num = (id: string) => clamp(Math.round(Number((box.querySelector('#' + id) as HTMLInputElement).value) || 1), 1, g.doc.frames.length)
  const get_ab = (): [number, number] => {
    let a = num('rg_from') - 1
    let b = num('rg_to') - 1
    if (a > b) {
      const t = a
      a = b
      b = t
    }
    return [a, b]
  }
  const finish = (message: string) => {
    modal_close()
    sfx_play('paper')
    toast(message)
  }
  const b2 = (id: string, fn: () => void) => (box.querySelector('#' + id) as HTMLElement).addEventListener('click', fn)
  b2('rg_rev', () => {
    const [a, b] = get_ab()
    if (a === b) {
      toast('2コマ以上のはんいでつかってね')
      return
    }
    if (dispatch('frame.reverse_range', { a, b }) < 0) return
    finish('逆順にしました')
  })
  b2('rg_dup', () => {
    const [a, b] = get_ab()
    if (dispatch('frame.duplicate_range', { a, b, ping_pong: 0 }) < 0) {
      toast('これ以上コマを増やせないよ')
      return
    }
    finish('複製しました')
  })
  b2('rg_ping', () => {
    const [a, b] = get_ab()
    if (b - a < 2) {
      toast('3コマ以上のはんいでつかってね')
      return
    }
    if (dispatch('frame.duplicate_range', { a, b, ping_pong: 1 }) < 0) {
      toast('これ以上コマを増やせないよ')
      return
    }
    finish('往復にしました')
  })
  b2('rg_del', () => {
    const [a, b] = get_ab()
    if (b - a + 1 >= st().doc.frames.length) {
      toast('全部のコマは消せないよ')
      return
    }
    modal_confirm('はんいを削除', a + 1 + '〜' + (b + 1) + 'コマ目を消すよ。', '消す', () => {
      if (dispatch('frame.delete_range', { a, b }) < 0) return
      sfx_play('paper')
      toast('消しました')
    })
  })
  const hr = box.querySelector('#rg_hold') as HTMLInputElement
  hr.addEventListener('input', () => ((box.querySelector('#rg_hold_val') as HTMLElement).textContent = '×' + hr.value))
  b2('rg_hold_go', () => {
    const [a, b] = get_ab()
    if (dispatch('frame.set_hold_range', { a, b, hold: Number(hr.value) }) < 0) return
    toast('ホールドをそろえました（もどす不可）')
  })
}

