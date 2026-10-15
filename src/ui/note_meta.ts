import { kwz_fsid_format, kwz_region_of, ppm_region_of } from '../codec/fname'
import { esc, ic, query, toast } from '../dom'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { lang, tr } from '../lang'
import { modal_close, modal_open } from './modal'

export function modal_note_meta(): void {
  const m0 = st().doc.meta
  const dstr = (t: number) => (t ? new Date(t * 1000).toLocaleString(lang === 'en' ? 'en-US' : 'ja-JP') : '—')
  const region = ppm_region_of(m0.cur_id) !== '?' ? ppm_region_of(m0.cur_id) : kwz_region_of(kwz_fsid_format(m0.cur_id))
  const row = (label: string, id: string, val: string, ph: string) =>
    '<div class="mrow"><span class="mlab">' + label + '</span><input class="mtxt grow" id="' + id + '" maxlength="28" value="' + esc(val) + '" placeholder="' + ph + '"></div>'
  const box = modal_open(
    '<div class="mhead">' + ic('gear') + '作品情報（実機ヘッダ）</div>' +
    '<div class="msub">なまえ（作者3世代）</div>' +
    row('原作者', 'mt_root_name', m0.root_name, 'さいしょの作者') +
    row('親作者', 'mt_parent_name', m0.parent_name, '編集もとの作者') +
    row('編集者', 'mt_cur_name', m0.cur_name, 'いまの作者（あなた）') +
    '<div class="msub">作者ID <span class="dim">PPM=16桁hex（先頭0/1=日本, 5=米, 9=欧）/ KWZ=20桁hex</span></div>' +
    row('原作者ID', 'mt_root_id', m0.root_id, '') +
    row('親ID', 'mt_parent_id', m0.parent_id, '') +
    row('現ID', 'mt_cur_id', m0.cur_id, '') +
    '<div class="mbody dim">現IDのリージョン判定: <b id="mt_region">' + region + '</b></div>' +
    '<div class="msub">ファイル名履歴 <span class="dim">現在の名前は書き出し時に実機法則で更新されるよ</span></div>' +
    row('原作品', 'mt_root_fn', m0.root_fn, '') +
    row('親作品', 'mt_parent_fn', m0.parent_fn, '') +
    '<div class="mrow"><span class="mlab">現在</span><span class="mono grow"><span data-user-text>' + (m0.cur_fn ? esc(m0.cur_fn) : tr('（書き出し時に生成）')) + '</span>' + (m0.edits ? '　<span class="dim">編集' + m0.edits + '回</span>' : '') + '</span></div>' +
    '<div class="msub">属性</div>' +
    '<div class="mrow wrap">' +
    '<button class="tgl" id="mt_lock">ロック（本人以外編集不可）</button>' +
    '<button class="tgl" id="mt_cmt">コメント属性（flags bit4）</button>' +
    '</div>' +
    '<div class="mbody dim">' + tr('つくった日: ') + dstr(m0.created) + ' / ' + tr('さいごの編集: ') + dstr(m0.modified) + '</div>' +
    '<div class="msub">編集履歴（世代）</div>' +
    '<div class="mbody mono dim">' + tr('元: ') + '<span data-user-text>' + esc(m0.root_name || '—') + '</span> → ' + tr('親: ') + '<span data-user-text>' + esc(m0.parent_name || '—') + '</span> → ' + tr('現: ') + '<span data-user-text>' + esc(m0.cur_name || '—') + '</span></div>' +
    '<div class="mrow"><button class="mbtn" id="mt_spin">この編集を新しい世代にする（現→親へ繰り下げ）</button></div>' +
    '<div class="mrow end"><button class="mbtn" id="mt_no">やめる</button><button class="mbtn primary" id="mt_ok">保存する</button></div>',
    1
  )
  const gv = (id: string) => (box.querySelector('#' + id) as HTMLInputElement).value.trim()
  const tg = (id: string, on: number) => {
    const el = box.querySelector('#' + id) as HTMLElement
    el.classList.toggle('on', on ? true : false)
  }
  let lock = m0.lock
  let cmt = m0.flags & 0x10 ? 1 : 0
  tg('mt_lock', lock)
  tg('mt_cmt', cmt)
  query(box, '#mt_lock').addEventListener('click', () => {
    lock = lock ? 0 : 1
    tg('mt_lock', lock)
  })
  query(box, '#mt_cmt').addEventListener('click', () => {
    cmt = cmt ? 0 : 1
    tg('mt_cmt', cmt)
  })
  const id_in = box.querySelector('#mt_cur_id') as HTMLInputElement
  id_in.addEventListener('input', () => {
    const v = id_in.value.trim()
    const r = ppm_region_of(v) !== '?' ? ppm_region_of(v) : kwz_region_of(kwz_fsid_format(v))
    query(box, '#mt_region').textContent = r
  })
  query(box, '#mt_spin').addEventListener('click', () => {
    const cur = collect()
    cur.parent_name = cur.cur_name
    cur.parent_id = cur.cur_id
    cur.parent_fn = cur.cur_fn
    cur.cur_fn = ''
    cur.edits = 0
    dispatch('doc.set_meta', cur)
    toast('世代を繰り下げました')
    modal_close()
    modal_note_meta()
  })
  const collect = () => {
    const m = { ...m0 }
    m.root_name = gv('mt_root_name').slice(0, 11)
    m.parent_name = gv('mt_parent_name').slice(0, 11)
    m.cur_name = gv('mt_cur_name').slice(0, 11)
    m.root_id = gv('mt_root_id').replace(/[^0-9a-fA-F]/g, '').toUpperCase()
    m.parent_id = gv('mt_parent_id').replace(/[^0-9a-fA-F]/g, '').toUpperCase()
    m.cur_id = gv('mt_cur_id').replace(/[^0-9a-fA-F]/g, '').toUpperCase()
    m.root_fn = gv('mt_root_fn')
    m.parent_fn = gv('mt_parent_fn')
    m.lock = lock
    m.flags = (m.flags & ~0x10) | (cmt ? 0x10 : 0)
    return m
  }
  query(box, '#mt_no').addEventListener('click', () => modal_close())
  query(box, '#mt_ok').addEventListener('click', () => {
    dispatch('doc.set_meta', collect())
    toast('作品情報を保存しました')
    modal_close()
  })
}
