import { animfx_active } from '../animfx'
import { esc, ic, toast } from '../dom'
import { mode_defs, mode_normal } from '../h'
import { mode_canvas, mode_frame_limit, mode_name } from '../mode'
import { st } from '../state/store'
import { project_rebuild } from './project_rebuild'
import { drawer_set } from './overlay'
import { modal_close, modal_confirm } from './modal'
import { sheet_open } from './sheet'

export function modal_mode(): void {
  const g = st()
  let cards = ''
  for (const d of mode_defs) {
    cards += '<button class="modecard" id="mode_card_' + d.id + '" data-mode="' + d.id + '" aria-pressed="' + (g.doc.mode === d.id) + '"><span><b>' + esc(d.label) + '</b><small>' + esc(d.sub) + '・最大' + mode_frame_limit(d.id) + 'コマ</small></span>' + ic('check') + '</button>'
  }
  const box = sheet_open({ icon: 'swap', title: '描画モード', pages: [{ id: 'mode', icon: 'swap', label: '描画モード', body: '<div class="modegrid">' + cards + '</div>' }] })
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
    const drops_anim = m !== mode_normal && animfx_active(g.doc.anim)
    const anim_notice = drops_anim ? '<br><b>設定だけのうごきは解除されます。</b>残したい場合は、先にうごきアシストで実コマへ変換してください。' : m !== mode_normal ? '<br>うごきアシストは設定だけでは保存せず、必ず実コマへ変換します。' : ''
    modal_close()
    modal_confirm(
      mode_name(m) + 'モードへ',
      'キャンバスを <b>' + mc.w + '×' + mc.h + '</b> に作りかえて、' + mode_name(m) + 'の制限（色・レイヤー）にそろえるよ。<br><b>この操作は「もどす」できない</b>（履歴は消えるよ）。' + anim_notice,
      '切りかえる',
      () => {
        void project_rebuild(mc.w, mc.h, mc.ratio, mc.res, m).then(result => { if (result === 0) drawer_set(0) })
      }
    )
  })
}

