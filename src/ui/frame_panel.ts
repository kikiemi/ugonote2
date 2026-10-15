import { esc, ic, query, toast } from '../dom'
import { hold_max } from '../h'
import { clamp } from '../lib'
import { layer_name, mode_order } from '../mode'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { modal_close, modal_confirm, modal_open } from './modal'

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
    btns += '<button class="mbtn" data-dst="' + layer + '">' + esc(layer_name(layer)) + 'へ</button>'
  }
  if (!btns) {
    toast('コピー先のレイヤーがありません')
    return
  }
  const box = modal_open('<div class="mhead">' + ic('dup') + 'レイヤー' + esc(layer_name(src)) + 'をコピー</div>' + '<div class="mrow wrap">' + btns + '</div><div class="mrow end"><button class="mbtn" id="lc_no">やめる</button></div>', 1)
  query(box, '#lc_no').addEventListener('click', modal_close)
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
  const box = modal_open(
    '<div class="mhead">' + ic('ab') + 'コマの範囲操作</div>' +
    '<div class="mrow"><span class="rlab">はんい</span><input type="number" class="mnum" id="rg_from" min="1" max="' + n + '" value="1"> 〜 <input type="number" class="mnum" id="rg_to" min="1" max="' + n + '" value="' + n + '"></div>' +
    '<div class="mrow wrap">' +
    '<button class="mbtn" id="rg_rev">' + ic('swap') + '逆順にする</button>' +
    '<button class="mbtn" id="rg_dup">' + ic('dup') + 'うしろに複製</button>' +
    '<button class="mbtn" id="rg_ping">' + ic('loop') + '往復にする</button>' +
    '<button class="mbtn warn" id="rg_del">' + ic('trash') + '削除</button>' +
    '</div>' +
    '<div class="mrow rng"><span class="rlab">ホールド一括</span><input type="range" id="rg_hold" min="1" max="' + hold_max + '" step="1" value="1"><b class="rval" id="rg_hold_val">×1</b><button class="mbtn sm" id="rg_hold_go">適用</button></div>' +
    '<div class="mbody dim">往復＝1,2,3 → 1,2,3,2 みたいにピンポンさせるよ。</div>' +
    '<div class="mrow end"><button class="mbtn" id="rg_close">とじる</button></div>',
    1
  )
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
  b2('rg_close', modal_close)
}

