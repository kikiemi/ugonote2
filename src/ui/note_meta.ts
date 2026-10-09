import { kwz_fsid_format, kwz_region_of, ppm_region_of } from '../codec/fname'
import { esc, ic, query, toast } from '../dom'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { LANG, tr } from '../lang'
import { modal_close, modal_open } from './modal'

export function modal_note_meta(): void {
  const m0 = st().doc.meta
  const dstr = (t: number) => (t ? new Date(t * 1000).toLocaleString(LANG === 'en' ? 'en-US' : 'ja-JP') : '—')
  const region = ppm_region_of(m0.cur_id) !== '?' ? ppm_region_of(m0.cur_id) : kwz_region_of(kwz_fsid_format(m0.cur_id))
  const row = (label: string, id: string, val: string, ph: string) =>
    '<div class="mrow"><span class="mlab">' + label + '</span><input class="mtxt grow" id="' + id + '" maxlength="28" value="' + esc(val) + '" placeholder="' + ph + '"></div>'
  const box = modal_open(
    '<div class="mhead">' + ic('gear') + '作品情報（実機ヘッダ）</div>' +
    '<div class="msub">なまえ（作者3世代）</div>' +
    row('原作者', 'mtRootName', m0.root_name, 'さいしょの作者') +
    row('親作者', 'mtParentName', m0.parent_name, '編集もとの作者') +
    row('編集者', 'mtCurName', m0.cur_name, 'いまの作者（あなた）') +
    '<div class="msub">作者ID <span class="dim">PPM=16桁hex（先頭0/1=日本, 5=米, 9=欧）/ KWZ=20桁hex</span></div>' +
    row('原作者ID', 'mtRootId', m0.root_id, '') +
    row('親ID', 'mtParentId', m0.parent_id, '') +
    row('現ID', 'mtCurId', m0.cur_id, '') +
    '<div class="mbody dim">現IDのリージョン判定: <b id="mtRegion">' + region + '</b></div>' +
    '<div class="msub">ファイル名履歴 <span class="dim">現在の名前は書き出し時に実機法則で更新されるよ</span></div>' +
    row('原作品', 'mtRootFn', m0.root_fn, '') +
    row('親作品', 'mtParentFn', m0.parent_fn, '') +
    '<div class="mrow"><span class="mlab">現在</span><span class="mono grow"><span data-user-text>' + (m0.cur_fn ? esc(m0.cur_fn) : tr('（書き出し時に生成）')) + '</span>' + (m0.edits ? '　<span class="dim">編集' + m0.edits + '回</span>' : '') + '</span></div>' +
    '<div class="msub">属性</div>' +
    '<div class="mrow wrap">' +
    '<button class="tgl" id="mtLock">ロック（本人以外編集不可）</button>' +
    '<button class="tgl" id="mtCmt">コメント属性（flags bit4）</button>' +
    '</div>' +
    '<div class="mbody dim">' + tr('つくった日: ') + dstr(m0.created) + ' / ' + tr('さいごの編集: ') + dstr(m0.modified) + '</div>' +
    '<div class="msub">編集履歴（世代）</div>' +
    '<div class="mbody mono dim">' + tr('元: ') + '<span data-user-text>' + esc(m0.root_name || '—') + '</span> → ' + tr('親: ') + '<span data-user-text>' + esc(m0.parent_name || '—') + '</span> → ' + tr('現: ') + '<span data-user-text>' + esc(m0.cur_name || '—') + '</span></div>' +
    '<div class="mrow"><button class="mbtn" id="mtSpin">この編集を新しい世代にする（現→親へ繰り下げ）</button></div>' +
    '<div class="mrow end"><button class="mbtn" id="mtNo">やめる</button><button class="mbtn primary" id="mtOk">保存する</button></div>',
    1
  )
  const gv = (id: string) => (box.querySelector('#' + id) as HTMLInputElement).value.trim()
  const tg = (id: string, on: number) => {
    const el = box.querySelector('#' + id) as HTMLElement
    el.classList.toggle('on', on ? true : false)
  }
  let lock = m0.lock
  let cmt = m0.flags & 0x10 ? 1 : 0
  tg('mtLock', lock)
  tg('mtCmt', cmt)
  query(box, '#mtLock').addEventListener('click', () => {
    lock = lock ? 0 : 1
    tg('mtLock', lock)
  })
  query(box, '#mtCmt').addEventListener('click', () => {
    cmt = cmt ? 0 : 1
    tg('mtCmt', cmt)
  })
  const idIn = box.querySelector('#mtCurId') as HTMLInputElement
  idIn.addEventListener('input', () => {
    const v = idIn.value.trim()
    const r = ppm_region_of(v) !== '?' ? ppm_region_of(v) : kwz_region_of(kwz_fsid_format(v))
    query(box, '#mtRegion').textContent = r
  })
  query(box, '#mtSpin').addEventListener('click', () => {
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
    m.root_name = gv('mtRootName').slice(0, 11)
    m.parent_name = gv('mtParentName').slice(0, 11)
    m.cur_name = gv('mtCurName').slice(0, 11)
    m.root_id = gv('mtRootId').replace(/[^0-9a-fA-F]/g, '').toUpperCase()
    m.parent_id = gv('mtParentId').replace(/[^0-9a-fA-F]/g, '').toUpperCase()
    m.cur_id = gv('mtCurId').replace(/[^0-9a-fA-F]/g, '').toUpperCase()
    m.root_fn = gv('mtRootFn')
    m.parent_fn = gv('mtParentFn')
    m.lock = lock
    m.flags = (m.flags & ~0x10) | (cmt ? 0x10 : 0)
    return m
  }
  query(box, '#mtNo').addEventListener('click', () => modal_close())
  query(box, '#mtOk').addEventListener('click', () => {
    dispatch('doc.set_meta', collect())
    toast('作品情報を保存しました')
    modal_close()
  })
}
