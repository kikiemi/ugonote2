import { q, toast } from '../dom'
import { reso_size } from '../h'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { modal_confirm } from './modal'

export function apply_canvas(): void {
  const g = st()
  const ratio = q<HTMLSelectElement>('ratioSel').value
  const res = q<HTMLSelectElement>('resoSel').value
  const s = ratio === 'free' && res === 'free' ? { w: g.doc.w, h: g.doc.h } : reso_size(ratio, res)
  if (s.w === g.doc.w && s.h === g.doc.h && ratio === g.doc.ratio && res === g.doc.res) {
    toast('いまと同じサイズだよ')
    return
  }
  modal_confirm('キャンバス変更', '全コマを ' + s.w + '×' + s.h + ' に作りかえるよ。<br><b>この操作は「もどす」できない</b>（履歴は消えるよ）。', '作りかえる', () => {
    dispatch('project.resize_canvas', { w: s.w, h: s.h, ratio, res })
  })
}

export function transform_all(kind: string): void {
  const label = kind === 'rotl' ? '左回転' : kind === 'rotr' ? '右回転' : kind === 'fliph' ? '左右反転' : '上下反転'
  modal_confirm('全コマを' + label, '全部のコマにかかるよ。<br><b>この操作は「もどす」できない</b>（履歴は消えるよ）。', '実行する', () => {
    dispatch('project.transform_all', kind)
  })
}

