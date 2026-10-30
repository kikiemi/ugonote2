import { report_warning } from '../diagnostics'
import { q, toast } from '../dom'
import { reso_size } from '../h'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { project_rebuild } from './project_rebuild'
import { modal_confirm } from './modal'

export function apply_canvas(): void {
  const g = st()
  const ratio = q<HTMLSelectElement>('ratio_sel').value
  const res = q<HTMLSelectElement>('reso_sel').value
  const s = ratio === 'free' && res === 'free' ? { w: g.doc.w, h: g.doc.h } : reso_size(ratio, res)
  if (s.w === g.doc.w && s.h === g.doc.h && ratio === g.doc.ratio && res === g.doc.res) {
    toast('いまと同じサイズだよ')
    return
  }
  modal_confirm('キャンバス変更', '全コマを ' + s.w + '×' + s.h + ' に作りかえるよ。<br><b>この操作は「もどす」できない</b>（履歴は消えるよ）。', '作りかえる', () => {
    void project_rebuild(s.w, s.h, ratio, res)
  })
}

export function transform_canvas(kind: 'rotate' | 'scale' | 'fliph' | 'flipv', value: number): void {
  const scope = q('transform_scope').dataset.scope === 'all' ? 'all' : 'current'
  const label = kind === 'scale' ? '拡大・縮小' : kind === 'rotate' ? '回転' : kind === 'fliph' ? '左右反転' : '上下反転'
  const apply = (): void => {
    try { dispatch('project.transform', { kind, angle: kind === 'rotate' ? value : 0, scale: kind === 'scale' ? value : undefined, scope }) }
    catch (error) { report_warning('絵の変形を中止しました', error); toast(error instanceof Error ? error.message : '絵を変形できませんでした') }
  }
  if (scope === 'all') modal_confirm('全コマを' + label, '全部のコマにかかるよ。<br><b>この操作は「もどす」できない</b>（履歴は消えるよ）。', '実行する', apply)
  else apply()
}
