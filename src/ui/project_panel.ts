import { report_warning } from '../diagnostics'
import { esc, ic, q, query, toast } from '../dom'
import { ASPECTS, PAPER_STD, RESOS, reso_size } from '../h'
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
  const loadingBox = modal_open(
    '<div class="mhead">' + ic('folder') + '<span>保存スロット</span></div><p class="mbody dim">読み込み中…</p>',
    1
  )
  store_list(rows => {
    if (!loadingBox.isConnected) return
    const rowMap: Record<string, { name: string, ts: number, thumb: Blob | null, size: number }> = {}
    for (const row of rows) rowMap[row.key] = row
    const objectUrls: string[] = []
    const thumbnailHtml = (thumb: Blob | null): string => {
      if (!thumb) return '<span class="sth empty"></span>'
      try {
        const url = URL.createObjectURL(thumb)
        objectUrls.push(url)
        return '<img class="sth" src="' + url + '">'
      } catch (error) {
        report_warning('保存スロットのサムネイルURLを作成できませんでした', error)
        return '<span class="sth empty"></span>'
      }
    }
    let html = '<div class="mhead">' + ic('folder') + '<span>保存スロット</span></div><div class="slots">'
    const rowHtml = (key: string, label: string): string => {
      const row = rowMap[key]
      const thumbnail = thumbnailHtml(row ? row.thumb : null)
      const metadata = row
        ? '<span class="sname" data-user-text>' + esc(row.name || 'むだいのノート') + '</span><span class="sdim">' + fmt_ts(row.ts) + ' ・ ' + Math.max(1, Math.round(row.size / 1024)) + 'KB</span>'
        : '<span class="sname dim">（空き）</span><span class="sdim"></span>'
      const buttons = key === 'auto'
        ? row ? '<button class="mbtn sm" data-act="load" data-key="auto">開く</button>' : ''
        : row
          ? '<button class="mbtn sm" data-act="load" data-key="' + key + '">開く</button><button class="mbtn sm" data-act="save" data-key="' + key + '">上書き</button><button class="mbtn sm warn" data-act="del" data-key="' + key + '">削除</button>'
          : '<button class="mbtn sm primary" data-act="save" data-key="' + key + '">ここに保存</button>'
      return '<div class="srow">' + thumbnail + '<span class="slabel">' + label + '</span><div class="smeta">' + metadata + '</div><div class="sbtns">' + buttons + '</div></div>'
    }
    html += rowHtml('auto', '自動')
    for (let index = 0; index < 8; index++) html += rowHtml('slot' + index, 'S' + (index + 1))
    html += '</div><div class="mrow end"><button class="mbtn primary" id="mOk">とじる</button></div>'
    const box = modal_open(html, 1)
    modal_set_cleanup(() => {
      for (const url of objectUrls) URL.revokeObjectURL(url)
    })
    query(box, '#mOk').addEventListener('click', () => modal_close())
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

export function modal_new(startFree = false, onDone?: () => void): void {
  let ratio = st().doc.mode === 1 ? st().doc.ratio : '16:9'
  if (ratio === 'free') ratio = '16:9'
  if (startFree) ratio = 'free'
  let res = 'low'
  let paper = '#FFFFFF'
  const dimensions = () => ratio === 'free' ? { w: clamp(Math.round(innerWidth), 16, 4096), h: clamp(Math.round(innerHeight), 16, 4096) } : reso_size(ratio, res)
  let ratios = ''
  let qualities = ''
  let papers = ''
  for (let i = 0; i < ASPECTS.length; i++) {
    const name = ASPECTS[i].name
    const parts = name.split(':')
    const w = Number(parts[0])
    const h = Number(parts[1])
    const scale = 36 / Math.max(w, h)
    ratios += '<button class="newRatio" data-r="' + name + '" aria-pressed="false"><i class="newPaperShape" aria-hidden="true" style="width:' + w * scale + 'px;height:' + h * scale + 'px"></i><b>' + name + '</b></button>'
  }
  for (let i = 0; i < RESOS.length; i++) {
    qualities += '<button class="newResolution" data-q="' + RESOS[i].id + '" aria-pressed="false">' + RESOS[i].label + '</button>'
  }
  for (let i = 0; i < PAPER_STD.length; i++) {
    papers += '<button class="newPaper" data-p="' + PAPER_STD[i] + '" aria-label="紙のいろ ' + (i + 1) + ' ' + PAPER_STD[i] + '" aria-pressed="false" style="background:' + PAPER_STD[i] + '"></button>'
  }
  const box = modal_open(
    '<div class="newNoteHead"><div class="mhead">' + ic('file') + '<span>新しい作品</span></div><span class="newNoteHint">まっさらな紙から、はじめよう</span></div>' +
    '<div class="newNoteBody"><label class="newNoteLabel" for="mNewName">作品のなまえ</label><input id="mNewName" class="mtxt" maxlength="40" placeholder="なまえは、あとからでもOK">' +
    '<div class="msub">紙のかたち</div><div id="mR" class="newRatios">' + ratios +
    '<button class="newRatio newFree" data-r="free" aria-pressed="false">' + ic('fit') + '<span><b>画面全体</b><small>フリーサイズ</small></span></button></div>' +
    '<div id="mQuality"><div class="newQualityHead"><span class="msub">絵の大きさ</span><small id="mSizeNote"></small></div><div id="mQ" class="newResolutions">' + qualities + '</div></div>' +
    '<div class="msub">紙のいろ</div><div id="mP" class="newPapers">' + papers + '</div>' +
    (onDone ? '' : '<p class="newNoteNotice">自動保存は新しい作品に切り替わります。<br>今の作品を残す場合は、先に保存してください。</p>') + '</div>' +
    '<div class="newNoteActions"><button class="mbtn" id="mNo">' + ic('close') + '<span>やめる</span></button><button class="mbtn primary" id="mOk">' + ic('check') + '<span>つくる</span></button></div>', 1
  )
  if (onDone) modal_set_cleanup(onDone)
  box.classList.add('newNoteDialog')
  const paint = (): void => {
    const buttons = box.querySelectorAll<HTMLElement>('[data-r],[data-q],[data-p]')
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i]
      const on = button.dataset.r === ratio || button.dataset.q === res || button.dataset.p === paper
      button.classList.toggle('on', on)
      button.setAttribute('aria-pressed', String(on))
    }
    query(box, '#mQuality').hidden = ratio === 'free'
    const sz = dimensions()
    query(box, '#mSizeNote').textContent = sz.w + ' × ' + sz.h + ' px'
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
  query(box, '#mNo').addEventListener('click', () => modal_close())
  query(box, '#mOk').addEventListener('click', () => {
    const name = (box.querySelector('#mNewName') as HTMLInputElement).value.trim()
    modal_close()
    const sz = dimensions()
    dispatch('project.new', { w: sz.w, h: sz.h, ratio, res: ratio === 'free' ? 'free' : res, paper, name })
    drawer_set(0)
    if (ratio === 'free' && document.body.dataset.focus !== '1') q('focusBtn').click()
    else if (ratio !== 'free' && document.body.dataset.focus === '1') q('focusBtn').click()
  })
}

