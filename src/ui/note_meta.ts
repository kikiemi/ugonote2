import { kwz_fsid_format, kwz_region_of, ppm_region_of } from '../codec/fname'
import { esc, ic, query, toast } from '../dom'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { lang, tr } from '../lang'
import { modal_close } from './modal'
import { sheet_open } from './sheet'

function region_of(id: string): string {
  return ppm_region_of(id) !== '?' ? ppm_region_of(id) : kwz_region_of(kwz_fsid_format(id))
}

// うごメモのファイルに書きこむ作者・ID・ファイル名の画面。
export function modal_note_meta(): void {
  const m0 = st().doc.meta
  const date = (t: number) => (t ? new Date(t * 1000).toLocaleString(lang === 'en' ? 'en-US' : 'ja-JP') : '—')
  const field = (label: string, id: string, value: string, placeholder = '') =>
    `<div class="opt_row"><label class="plab" for="${id}">${label}</label><input class="mtxt" id="${id}" maxlength="28" value="${esc(value)}" placeholder="${placeholder}"></div>`
  const info = (label: string, value: string, id = '') =>
    `<div class="opt_row info"><span class="plab">${label}</span><output${id ? ` id="${id}"` : ''}>${value}</output></div>`
  const box = sheet_open({
    icon: 'file',
    title: '作者・作品の情報',
    pages: [
      {
        id: 'names',
        icon: 'pen',
        label: '作者',
        body: `<section class="opt">
          ${field('原作者', 'mt_root_name', m0.root_name)}
          ${field('親作者', 'mt_parent_name', m0.parent_name)}
          ${field('編集者', 'mt_cur_name', m0.cur_name)}
        </section>
        <section class="opt"><button class="pbtn" id="mt_spin">${ic('down')}編集者を親作者にして、新しい世代にする</button></section>`,
      },
      {
        id: 'ids',
        icon: 'gear',
        label: 'ID',
        body: `<section class="opt">
          ${field('原作者', 'mt_root_id', m0.root_id, '16桁・20桁')}
          ${field('親作者', 'mt_parent_id', m0.parent_id, '16桁・20桁')}
          ${field('編集者', 'mt_cur_id', m0.cur_id, '16桁・20桁')}
          ${info('地域', region_of(m0.cur_id), 'mt_region')}
        </section>`,
      },
      {
        id: 'file',
        icon: 'file',
        label: 'ファイル',
        body: `<section class="opt">
          ${field('原作品', 'mt_root_fn', m0.root_fn)}
          ${field('親作品', 'mt_parent_fn', m0.parent_fn)}
          ${info('この作品', '<span class="mono" data-user-text>' + (m0.cur_fn ? esc(m0.cur_fn) : tr('（書き出し時に生成）')) + '</span>')}
          ${info('編集回数', String(m0.edits))}
          ${info('作成日', date(m0.created))}
          ${info('更新日', date(m0.modified))}
        </section>
        <section class="opt">
          <button class="sw" id="mt_lock" aria-pressed="false">${ic('lock')}<span>ロック</span><i class="toggle_knob" aria-hidden="true"></i></button>
          <button class="sw" id="mt_cmt" aria-pressed="false">${ic('layers')}<span>上級ふでばこ</span><i class="toggle_knob" aria-hidden="true"></i></button>
        </section>`,
      },
    ],
    actions: '<button class="pbtn" id="mt_no">やめる</button><button class="pbtn primary" id="mt_ok">保存する</button>',
  })
  const value = (id: string) => query<HTMLInputElement>(box, '#' + id).value.trim()
  const toggle = (id: string, on: number) => query(box, '#' + id).setAttribute('aria-pressed', String(!!on))
  let lock = m0.lock
  let advanced = m0.flags & 0x10 ? 1 : 0
  toggle('mt_lock', lock)
  toggle('mt_cmt', advanced)
  query(box, '#mt_lock').addEventListener('click', () => toggle('mt_lock', lock = lock ? 0 : 1))
  query(box, '#mt_cmt').addEventListener('click', () => toggle('mt_cmt', advanced = advanced ? 0 : 1))
  query<HTMLInputElement>(box, '#mt_cur_id').addEventListener('input', () => {
    query(box, '#mt_region').textContent = region_of(value('mt_cur_id'))
  })
  const collect = () => {
    const m = { ...m0 }
    m.root_name = value('mt_root_name').slice(0, 11)
    m.parent_name = value('mt_parent_name').slice(0, 11)
    m.cur_name = value('mt_cur_name').slice(0, 11)
    m.root_id = value('mt_root_id').replace(/[^0-9a-fA-F]/g, '').toUpperCase()
    m.parent_id = value('mt_parent_id').replace(/[^0-9a-fA-F]/g, '').toUpperCase()
    m.cur_id = value('mt_cur_id').replace(/[^0-9a-fA-F]/g, '').toUpperCase()
    m.root_fn = value('mt_root_fn')
    m.parent_fn = value('mt_parent_fn')
    m.lock = lock
    m.flags = (m.flags & ~0x10) | (advanced ? 0x10 : 0)
    return m
  }
  query(box, '#mt_spin').addEventListener('click', () => {
    const m = collect()
    m.parent_name = m.cur_name
    m.parent_id = m.cur_id
    m.parent_fn = m.cur_fn
    m.cur_fn = ''
    m.edits = 0
    dispatch('doc.set_meta', m)
    toast('世代を繰り下げました')
    modal_close()
    modal_note_meta()
  })
  query(box, '#mt_no').addEventListener('click', () => modal_close())
  query(box, '#mt_ok').addEventListener('click', () => {
    dispatch('doc.set_meta', collect())
    toast('作品情報を保存しました')
    modal_close()
  })
}
