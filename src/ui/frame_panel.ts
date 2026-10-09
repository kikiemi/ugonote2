import { esc, ic, query, toast } from '../dom'
import { HOLD_MAX } from '../h'
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
  const box = modal_open('<div class="mhead">' + ic('dup') + 'レイヤー' + esc(layer_name(src)) + 'をコピー</div>' + '<div class="mrow wrap">' + btns + '</div><div class="mrow end"><button class="mbtn" id="lcNo">やめる</button></div>', 1)
  query(box, '#lcNo').addEventListener('click', modal_close)
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
    '<div class="mrow"><span class="rlab">はんい</span><input type="number" class="mnum" id="rgFrom" min="1" max="' + n + '" value="1"> 〜 <input type="number" class="mnum" id="rgTo" min="1" max="' + n + '" value="' + n + '"></div>' +
    '<div class="mrow wrap">' +
    '<button class="mbtn" id="rgRev">' + ic('swap') + '逆順にする</button>' +
    '<button class="mbtn" id="rgDup">' + ic('dup') + 'うしろに複製</button>' +
    '<button class="mbtn" id="rgPing">' + ic('loop') + '往復にする</button>' +
    '<button class="mbtn warn" id="rgDel">' + ic('trash') + '削除</button>' +
    '</div>' +
    '<div class="mrow rng"><span class="rlab">ホールド一括</span><input type="range" id="rgHold" min="1" max="' + HOLD_MAX + '" step="1" value="1"><b class="rval" id="rgHoldVal">×1</b><button class="mbtn sm" id="rgHoldGo">適用</button></div>' +
    '<div class="mbody dim">往復＝1,2,3 → 1,2,3,2 みたいにピンポンさせるよ。</div>' +
    '<div class="mrow end"><button class="mbtn" id="rgClose">とじる</button></div>',
    1
  )
  const num = (id: string) => clamp(Math.round(Number((box.querySelector('#' + id) as HTMLInputElement).value) || 1), 1, g.doc.frames.length)
  const getAB = (): [number, number] => {
    let a = num('rgFrom') - 1
    let b = num('rgTo') - 1
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
  b2('rgRev', () => {
    const [a, b] = getAB()
    if (a === b) {
      toast('2コマ以上のはんいでつかってね')
      return
    }
    if (dispatch('frame.reverse_range', { a, b }) < 0) return
    finish('逆順にしました')
  })
  b2('rgDup', () => {
    const [a, b] = getAB()
    if (dispatch('frame.duplicate_range', { a, b, pingPong: 0 }) < 0) {
      toast('これ以上コマを増やせないよ')
      return
    }
    finish('複製しました')
  })
  b2('rgPing', () => {
    const [a, b] = getAB()
    if (b - a < 2) {
      toast('3コマ以上のはんいでつかってね')
      return
    }
    if (dispatch('frame.duplicate_range', { a, b, pingPong: 1 }) < 0) {
      toast('これ以上コマを増やせないよ')
      return
    }
    finish('往復にしました')
  })
  b2('rgDel', () => {
    const [a, b] = getAB()
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
  const hr = box.querySelector('#rgHold') as HTMLInputElement
  hr.addEventListener('input', () => ((box.querySelector('#rgHoldVal') as HTMLElement).textContent = '×' + hr.value))
  b2('rgHoldGo', () => {
    const [a, b] = getAB()
    if (dispatch('frame.set_hold_range', { a, b, hold: Number(hr.value) }) < 0) return
    toast('ホールドをそろえました（もどす不可）')
  })
  b2('rgClose', modal_close)
}

