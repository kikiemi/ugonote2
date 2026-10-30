import { report_warning } from '../diagnostics'
import { esc, ic, pressed, query, toast } from '../dom'
import { aspects, paper_std, resos, reso_size } from '../h'
import { clamp } from '../lib'
import { store_delete, store_list, store_load_key, store_save_slot } from '../persist'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { anim_playing } from '../state/commands/play'
import { st } from '../state/store'
import { drawer_set } from './overlay'
import { modal_close, modal_confirm, modal_open, modal_set_cleanup } from './modal'
import { anim_stop } from './playback'

function fmt_ts(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (v: number) => (v < 10 ? '0' + v : '' + v)
  return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

export function modal_slots(): void {
  const loading_box = modal_open(
    '<div class="mhead">' + ic('folder') + '<span>保存スロット</span></div><p class="mbody dim">読み込み中…</p>',
    1
  )
  store_list(rows => {
    if (!loading_box.isConnected) return
    const row_map: Record<string, { name: string, ts: number, thumb: Blob | null, size: number }> = {}
    for (const row of rows) row_map[row.key] = row
    const object_urls: string[] = []
    const thumbnail_html = (thumb: Blob | null): string => {
      if (!thumb) return '<span class="sth empty"></span>'
      try {
        const url = URL.createObjectURL(thumb)
        object_urls.push(url)
        return '<img class="sth" src="' + url + '">'
      } catch (error) {
        report_warning('保存スロットのサムネイルURLを作成できませんでした', error)
        return '<span class="sth empty"></span>'
      }
    }
    let html = '<div class="mhead">' + ic('folder') + '<span>保存スロット</span></div><div class="slots">'
    const row_html = (key: string, label: string): string => {
      const row = row_map[key]
      const thumbnail = thumbnail_html(row ? row.thumb : null)
      const metadata = row
        ? '<span class="sname" data-user-text>' + esc(row.name || 'むだいのノート') + '</span><span class="sdim">' + fmt_ts(row.ts) + ' ・ ' + Math.max(1, Math.round(row.size / 1024)) + 'KB</span>'
        : '<span class="sname dim">（空き）</span><span class="sdim"></span>'
      const buttons = key === 'auto'
        ? row ? '<button class="pbtn sm" data-act="load" data-key="auto">開く</button>' : ''
        : row
          ? '<button class="pbtn sm" data-act="load" data-key="' + key + '">開く</button><button class="pbtn sm" data-act="save" data-key="' + key + '">上書き</button><button class="pbtn sm warn" data-act="del" data-key="' + key + '">削除</button>'
          : '<button class="pbtn sm" data-act="save" data-key="' + key + '">ここに保存</button>'
      return '<div class="srow">' + thumbnail + '<span class="slabel">' + label + '</span><div class="smeta">' + metadata + '</div><div class="sbtns">' + buttons + '</div></div>'
    }
    html += row_html('auto', '自動')
    for (let index = 0; index < 8; index++) html += row_html('slot' + index, 'S' + (index + 1))
    html += '</div><div class="mrow end"><button class="pbtn" id="m_ok">とじる</button></div>'
    const box = modal_open(html, 1)
    modal_set_cleanup(() => {
      for (const url of object_urls) URL.revokeObjectURL(url)
    })
    query(box, '#m_ok').addEventListener('click', () => modal_close())
    box.addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest('[data-act]') as HTMLElement | null
      if (!target) return
      const action = target.dataset.act
      const key = target.dataset.key as string
      if (action === 'save') {
        const index = Number(key.slice(4))
        store_save_slot(index, ok => {
          toast(ok ? 'スロットに保存しました' : '保存に失敗…')
          if (ok) sfx_play('save')
          modal_slots()
        })
        return
      }
      if (action === 'load') {
        modal_confirm('読み込み', 'いまのノートは自動保存ぶんだけ残るよ。<br>スロットを開く？', '開く', () => {
          if (anim_playing()) anim_stop()
          store_load_key(key, error => {
            if (error !== 0) {
              toast('読み込めなかった…')
              return
            }
            toast('読み込みました')
            sfx_play('paper')
          })
        })
        return
      }
      if (action === 'del') {
        modal_confirm('削除', 'このスロットを消す？（もどせないよ）', '消す', () => {
          store_delete(key, ok => {
            if (!ok) toast('削除できなかった…')
            modal_slots()
          })
        })
      }
    })
  })
}

export function fixed_4_3_res(res: string): number {
  return res === 'dsi' || res === '3ds' ? 1 : 0
}

export function modal_new(start_free = false, on_done?: () => void): void {
  let ratio = st().doc.mode === 1 ? st().doc.ratio : '16:9'
  if (ratio === 'free') ratio = '16:9'
  if (start_free) ratio = 'free'
  let res = 'low'
  let paper = '#FFFFFF'
  const dimensions = () => ratio === 'free' ? { w: clamp(Math.round(innerWidth), 16, 4096), h: clamp(Math.round(innerHeight), 16, 4096) } : reso_size(ratio, res)
  let ratios = ''
  let qualities = ''
  let papers = ''
  for (let i = 0; i < aspects.length; i++) {
    const name = aspects[i].name
    const parts = name.split(':')
    const w = Number(parts[0])
    const h = Number(parts[1])
    const scale = 36 / Math.max(w, h)
    ratios += '<button class="new_ratio" data-r="' + name + '" aria-pressed="false"><i class="new_paper_shape" aria-hidden="true" style="width:' + w * scale + 'px;height:' + h * scale + 'px"></i><b>' + name + '</b></button>'
  }
  for (let i = 0; i < resos.length; i++) {
    qualities += '<button class="new_resolution" data-q="' + resos[i].id + '" aria-pressed="false">' + resos[i].label + '</button>'
  }
  for (let i = 0; i < paper_std.length; i++) {
    papers += '<button class="new_paper" data-p="' + paper_std[i] + '" aria-label="紙のいろ ' + (i + 1) + ' ' + paper_std[i] + '" aria-pressed="false" style="background:' + paper_std[i] + '"></button>'
  }
  const box = modal_open(
    '<div class="new_note_head"><div class="mhead">' + ic('file') + '<span>新しい作品</span></div></div>' +
    '<div class="new_note_body"><label class="new_note_label" for="m_new_name">作品のなまえ</label><input id="m_new_name" class="mtxt" maxlength="40" placeholder="なまえは、あとからでもOK">' +
    '<div class="msub">紙のかたち</div><div id="m_r" class="new_ratios">' + ratios +
    '<button class="new_ratio new_free" data-r="free" aria-pressed="false">' + ic('fit') + '<span><b>画面全体</b><small>フリーサイズ</small></span></button></div>' +
    '<div id="m_quality"><div class="new_quality_head"><span class="msub">絵の大きさ</span><small id="m_size_note"></small></div><div id="m_q" class="new_resolutions">' + qualities + '</div></div>' +
    '<div class="msub">紙のいろ</div><div id="m_p" class="new_papers">' + papers + '</div>' +
    (on_done ? '' : '<p class="new_note_notice">自動保存は新しい作品に切り替わります。<br>今の作品を残す場合は、先に保存してください。</p>') + '</div>' +
    '<div class="new_note_actions"><button class="pbtn" id="m_no">やめる</button><button class="pbtn primary" id="m_ok">つくる</button></div>', 1
  )
  if (on_done) modal_set_cleanup(on_done)
  box.classList.add('new_note_dialog')
  const paint = (): void => {
    const buttons = box.querySelectorAll<HTMLElement>('[data-r],[data-q],[data-p]')
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i]
      const on = button.dataset.r === ratio || button.dataset.q === res || button.dataset.p === paper
      pressed(button, on)
    }
    query(box, '#m_quality').hidden = ratio === 'free'
    const sz = dimensions()
    query(box, '#m_size_note').textContent = sz.w + ' × ' + sz.h + ' px'
  }
  paint()
  box.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-r],[data-q],[data-p]')
    if (!t) return
    if (t.dataset.r) {
      ratio = t.dataset.r
      if (ratio !== '4:3' && fixed_4_3_res(res)) res = 'low'
    }
    if (t.dataset.q) {
      res = t.dataset.q
      if (fixed_4_3_res(res)) ratio = '4:3'
    }
    if (t.dataset.p) paper = t.dataset.p
    paint()
  })
  query(box, '#m_no').addEventListener('click', () => modal_close())
  query(box, '#m_ok').addEventListener('click', () => {
    const name = (box.querySelector('#m_new_name') as HTMLInputElement).value.trim()
    modal_close()
    const sz = dimensions()
    dispatch('project.new', { w: sz.w, h: sz.h, ratio, res: ratio === 'free' ? 'free' : res, paper, name })
    drawer_set(0)
  })
}

