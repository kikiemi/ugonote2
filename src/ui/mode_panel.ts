import { animfx_active } from '../animfx'
import { esc, ic, query, toast } from '../dom'
import { MODE_DEFS, MODE_NORMAL } from '../h'
import { mode_canvas, mode_frame_limit, mode_name } from '../mode'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { drawer_set } from './overlay'
import { modal_close, modal_confirm, modal_open } from './modal'

export function modal_mode(): void {
  const g = st()
  let cards = ''
  for (const d of MODE_DEFS) {
    cards += '<button class="modecard' + (g.doc.mode === d.id ? ' on' : '') + '" id="modeCard_' + d.id + '" data-mode="' + d.id + '"><b>' + esc(d.label) + '</b><span>' + esc(d.sub) + '・最大' + mode_frame_limit(d.id) + 'コマ</span></button>'
  }
  const box = modal_open(
    '<div class="mhead">' + ic('swap') + 'モードをえらぶ</div>' +
    '<div class="modegrid">' + cards + '</div>' +
    '<div class="mbody dim">うごメモ系モードはキャンバスが実機サイズになり、色やレイヤーも実機と同じ制限になります。切りかえるとキャンバスを作りなおすので「もどす」はできません。</div>' +
    '<div class="mrow end"><button class="mbtn" id="modeNo">とじる</button></div>',
    1
  )
  query(box, '#modeNo').addEventListener('click', modal_close)
  box.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.modecard') as HTMLElement | null
    if (!b) return
    const m = Number(b.dataset.mode)
    if (m === g.doc.mode) {
      modal_close()
      return
    }
    const limit = mode_frame_limit(m)
    if (g.doc.frames.length > limit) {
      toast(mode_name(m) + 'は最大' + limit + 'コマです。先にコマを減らしてください')
      return
    }
    const mc = mode_canvas(m)
    const dropsAnim = m !== MODE_NORMAL && animfx_active(g.doc.anim)
    const animNotice = dropsAnim ? '<br><b>設定だけのうごきは解除されます。</b>残したい場合は、先にうごきアシストで実コマへ変換してください。' : m !== MODE_NORMAL ? '<br>うごきアシストは設定だけでは保存せず、必ず実コマへ変換します。' : ''
    modal_close()
    modal_confirm(
      mode_name(m) + 'モードへ',
      'キャンバスを <b>' + mc.w + '×' + mc.h + '</b> に作りかえて、' + mode_name(m) + 'の制限（色・レイヤー）にそろえるよ。<br><b>この操作は「もどす」できない</b>（履歴は消えるよ）。' + animNotice,
      '切りかえる',
      () => {
        if (dispatch('project.set_mode', m) === 0) drawer_set(0)
      }
    )
  })
}

