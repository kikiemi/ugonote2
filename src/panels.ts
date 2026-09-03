import { animfx_active } from './animfx'
import { tip_get } from './brush'
import { report_warning } from './diagnostics'
import { doc_frame_new } from './doc'
import { esc, ic, q, query, toast } from './dom'
import { effect_apply, effect_capture, effect_preview, type EffectCapture } from './effect'
import { flip_import } from './flipin'
import {
  ASPECTS,
  D_ALL,
  D_SAVE,
  D_SOUND,
  D_TOOLS,
  EFFECT_DEFS,
  EF_BLUR,
  HOLD_MAX,
  K_PHOTO,
  L_DRAW_DEFAULT,
  L_P,
  MODE_DEFS,
  MODE_NORMAL,
  PAPER_STD,
  RESOS,
  SE_LABELS,
  TRANSITION_DEFS,
  TR_FADE,
  reso_size,
  type Frame,
} from './h'
import { canvas_make, clamp, file_pick, rle_pack } from './lib'
import { layer_name, mode_allows_layer_alpha, mode_canvas, mode_frame_limit, mode_name, mode_order } from './mode'
import { store_delete, store_list, store_load_key, store_save_slot } from './persist'
import { pref_theme_toggle, pref_uisfx_toggle } from './prefs'
import { snd_bgm_preview, snd_recording, snd_se_preview, snd_stop_all, sfx_play } from './snd'
import { dispatch } from './state/commands/index'
import { anim_playing } from './state/commands/play'
import { dirty, st } from './state/store'
import { region_add } from './sync'
import { transition_insert } from './trans'
import { file_open, file_save, modal_export, rec_kind, rec_toggle, recsync_toggle } from './ui/export_ui'
import { flipnote_maker_pick } from './ui/flipnote_maker'
import { image_file_decode } from './ui/image_file'
import { drawer_set, pop_close } from './ui/overlay'
import { modal_animation_assist } from './ui/animation_assist'
import { modal_addmany, modal_close, modal_confirm, modal_goto, modal_is_open, modal_open, modal_progress, modal_set_cleanup } from './ui/modal'
import { anim_stop } from './ui/playback'
import { snd_assign_preset, snd_clear, snd_load_begin, snd_load_bytes, snd_vol_set } from './ui/sound_io'
import { vid_import } from './vid'
import { zip_read } from './zipr'

export { modal_export } from './ui/export_ui'
export { modal_active, modal_addmany, modal_close, modal_confirm, modal_goto, modal_open, modal_prompt_num, modal_text } from './ui/modal'

export function modal_mixer(): void {
  const g = st()
  const n = g.doc.frames.length
  const page_size = 200
  const page_count = Math.ceil(n / page_size)
  let page = Math.floor(g.doc.cur / page_size)
  let head = '<div class="mixhead"><span class="mixno">#</span>'
  for (let k = 0; k < 4; k++) head += '<span class="mixse">SE' + (k + 1) + '<em>' + esc(g.snd.se[k].name ? (SE_LABELS[g.snd.se[k].name] || g.snd.se[k].name) : 'なし') + '</em></span>'
  head += '</div>'
  const page_nav = page_count > 1
    ? '<div class="mrow"><button class="mbtn" id="mixPrev">前へ</button><span class="dim grow" id="mixPage"></span><button class="mbtn" id="mixNext">次へ</button></div>'
    : ''
  const box = modal_open(
    '<div class="mhead">' + ic('gear') + '<span>SEミキサー（コマ割当）</span></div>' +
    '<p class="mbody dim">再生中、印のついたコマでSEが鳴るよ。</p>' +
    '<div class="mixbody" id="mixRows"></div>' +
    page_nav +
    '<div class="mrow end"><button class="mbtn primary" id="mOk">とじる</button></div>',
    1
  )
  const rows = query(box, '#mixRows')
  const render_page = (): void => {
    const start = page * page_size
    const end = Math.min(n, start + page_size)
    let html = head
    for (let i = start; i < end; i++) {
      html += '<div class="mixrow' + (i === g.doc.cur ? ' cur' : '') + '"><span class="mixno">' + (i + 1) + '</span>'
      for (let k = 0; k < 4; k++) {
        const on = g.doc.frames[i].se & (1 << k) ? ' on' : ''
        html += '<button class="mixc' + on + '" data-i="' + i + '" data-k="' + k + '"></button>'
      }
      html += '</div>'
    }
    rows.innerHTML = html
    rows.scrollTop = 0
    if (page_count <= 1) return
    query(box, '#mixPage').textContent = start + 1 + '〜' + end + ' / ' + n
    const prev = query<HTMLButtonElement>(box, '#mixPrev')
    const next = query<HTMLButtonElement>(box, '#mixNext')
    prev.disabled = page <= 0
    next.disabled = page >= page_count - 1
  }
  render_page()
  query(box, '#mOk').addEventListener('click', () => modal_close())
  if (page_count > 1) {
    query(box, '#mixPrev').addEventListener('click', () => {
      if (page <= 0) return
      page--
      render_page()
    })
    query(box, '#mixNext').addEventListener('click', () => {
      if (page >= page_count - 1) return
      page++
      render_page()
    })
  }
  box.addEventListener('click', e => {
    const t = e.target as HTMLElement
    if (!t.classList.contains('mixc')) return
    const i = Number(t.dataset.i)
    const k = Number(t.dataset.k)
    dispatch('frame.se_toggle', { i, bit: k })
    t.classList.toggle('on', (g.doc.frames[i].se & (1 << k)) ? true : false)
  })
}

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
        ? '<span class="sname">' + esc(row.name || 'むだいのノート') + '</span><span class="sdim">' + fmt_ts(row.ts) + ' ・ ' + Math.max(1, Math.round(row.size / 1024)) + 'KB</span>'
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

function fixed_4_3_res(res: string): number {
  return res === 'dsi' || res === '3ds' ? 1 : 0
}

export function modal_new(): void {
  let ratio = st().doc.mode === 1 ? st().doc.ratio : '16:9'
  let res = 'low'
  let paper = '#FFFFFF'
  let rb = ''
  for (const a of ASPECTS) rb += '<button class="pick rb" data-r="' + a.name + '">' + a.name + '</button>'
  let qb = ''
  for (const r of RESOS) qb += '<button class="pick qb" data-q="' + r.id + '">' + r.label + '</button>'
  let pb = ''
  for (const c of PAPER_STD) pb += '<button class="cbtn pb" data-p="' + c + '" style="background:' + c + '"></button>'
  const box = modal_open(
    '<div class="mhead">' + ic('file') + '<span>新しいノート</span></div>' +
    '<input id="mNewName" class="mtxt" maxlength="40" placeholder="ノートの名前（あとで変えられるよ）">' +
    '<div class="msub">画面の形</div><div class="mrow wrap" id="mR">' + rb + '</div>' +
    '<div class="msub">画質 <span class="dim" id="mSizeNote"></span></div><div class="mrow wrap" id="mQ">' + qb + '</div>' +
    '<div class="msub">紙のいろ</div><div class="mrow wrap" id="mP">' + pb + '</div>' +
    '<p class="mbody warn2">' + ic('warn') + ' いまのノートは自動保存から消えるよ。残したいならスロット保存してからどうぞ。</p>' +
    '<div class="mrow end"><button class="mbtn" id="mNo">やめる</button><button class="mbtn primary" id="mOk">作成する</button></div>',
    1
  )
  const sizeNote = box.querySelector('#mSizeNote') as HTMLElement
  const paint = () => {
    box.querySelectorAll('.rb').forEach(b => (b as HTMLElement).classList.toggle('on', (b as HTMLElement).dataset.r === ratio))
    box.querySelectorAll('.qb').forEach(b => (b as HTMLElement).classList.toggle('on', (b as HTMLElement).dataset.q === res))
    box.querySelectorAll('.pb').forEach(b => (b as HTMLElement).classList.toggle('on', (b as HTMLElement).dataset.p === paper))
    const s = reso_size(ratio, res)
    sizeNote.textContent = s.w + '×' + s.h
  }
  paint()
  box.addEventListener('click', e => {
    const t = e.target as HTMLElement
    if (t.dataset.r) {
      ratio = t.dataset.r
      if (ratio !== '4:3' && fixed_4_3_res(res)) res = 'low'
    }
    if (t.dataset.q) {
      res = t.dataset.q
      if (fixed_4_3_res(res)) ratio = '4:3'
    }
    if (t.dataset.p) paper = t.dataset.p
    if (t.dataset.r || t.dataset.q || t.dataset.p) paint()
  })
  query(box, '#mNo').addEventListener('click', () => modal_close())
  query(box, '#mOk').addEventListener('click', () => {
    const name = (box.querySelector('#mNewName') as HTMLInputElement).value.trim()
    modal_close()
    const sz = reso_size(ratio, res)
    dispatch('project.new', { w: sz.w, h: sz.h, ratio, res, paper, name })
  })
}

function photo_import(): void {
  file_pick('image/*', file => {
    image_file_decode(file, source => {
      if (!source) {
        toast('画像を読めなかった…')
        return
      }
      try {
        const maxSideScale = Math.min(1, 2048 / Math.max(source.width, source.height))
        const areaScale = Math.min(1, Math.sqrt((4 * 1024 * 1024) / (source.width * source.height)))
        const scale = Math.min(maxSideScale, areaScale)
        const width = Math.max(1, Math.round(source.width * scale))
        const height = Math.max(1, Math.round(source.height * scale))
        const [canvas, context] = canvas_make(width, height)
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        source.draw(context, 0, 0, width, height)
        const globals = st()
        if (q('drawer').classList.contains('on')) drawer_set(0)
        pop_close()
        if (!globals.doc.lvis[L_P]) dispatch('layer.toggle_visible', L_P)
        dispatch('view.set_page', 'canvas')
        if (dispatch('flo.begin_image', { canvas, kind: K_PHOTO, x: globals.doc.w / 2, y: globals.doc.h / 2, continuous: 0 }) < 0) throw new Error('image placement command was rejected')
        toast('ドラッグで位置、ボタンで回転・大きさ、✓で決定')
      } catch (error) {
        report_warning('画像を写真レイヤーへ取り込めませんでした', error)
        toast('画像を取り込めなかった…')
      } finally {
        try {
          source.close()
        } catch {}
      }
    })
  })
}

function video_import(): void {
  file_pick('video/*', f => {
    modal_confirm('動画をコマにする', 'いまの「はやさ」(' + st().doc.fps + 'fps) で切り出して、写真レイヤーに追加するよ。', '取り込む', () => {
      const prog = modal_progress('動画を取り込み中')
      vid_import(f, p => prog.set(p), (err, added) => {
        prog.close()
        if (err !== 0) {
          toast(err === -2 ? 'コマがいっぱいで取り込めないよ' : '動画を読めなかった…')
          return
        }
        toast(added + 'コマ取り込みました')
        sfx_play('paper')
      })
    })
  })
}

function flip_import_ui(): void {
  file_pick('.kwz,.ppm', f => {
    modal_confirm(
      'うごメモ作品を読み込む',
      '<b>' + esc(f.name) + '</b> を読み込みます。<br>いまのノートは<b>置きかわります</b>（もどす不可）。キャンバスは描画領域のサイズ（DSi 256×192 / 3DS 310×230）になります。',
      '読み込む',
      () => {
        const prog = modal_progress('うごメモ作品を読み込み中')
        flip_import(f, (added, kind) => {
          prog.close()
          if (added < 0) return
          if (!added) {
            toast('読み込めなかった…（.kwz / .ppm の中身を確認してください）')
            return
          }
          q('drawerClose').click()
          toast(kind + 'を' + added + 'コマ読み込みました')
          sfx_play('paper')
        })
      }
    )
  })
}

function apply_canvas(): void {
  const g = st()
  const ratio = q<HTMLSelectElement>('ratioSel').value
  const res = q<HTMLSelectElement>('resoSel').value
  const s = reso_size(ratio, res)
  if (s.w === g.doc.w && s.h === g.doc.h && ratio === g.doc.ratio && res === g.doc.res) {
    toast('いまと同じサイズだよ')
    return
  }
  modal_confirm('キャンバス変更', '全コマを ' + s.w + '×' + s.h + ' に作りかえるよ。<br><b>この操作は「もどす」できない</b>（履歴は消えるよ）。', '作りかえる', () => {
    dispatch('project.resize_canvas', { w: s.w, h: s.h, ratio, res })
  })
}

function transform_all(kind: string): void {
  const label = kind === 'rotl' ? '左回転' : kind === 'rotr' ? '右回転' : kind === 'fliph' ? '左右反転' : '上下反転'
  modal_confirm('全コマを' + label, '全部のコマにかかるよ。<br><b>この操作は「もどす」できない</b>（履歴は消えるよ）。', '実行する', () => {
    dispatch('project.transform_all', kind)
  })
}

function pack_img_data(img: ImageData): Uint32Array {
  return rle_pack(new Uint32Array(img.data.buffer))
}

function zip_import(): void {
  file_pick('.zip', file => {
    file.arrayBuffer().then(
      buffer => {
        zip_read(buffer).then(
          entries => {
            if (!entries) {
              toast('ZIPを読めなかった…')
              return
            }
            const pngEntries = entries.filter(entry => /\.png$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }))
            if (!pngEntries.length) {
              toast('PNGが入ってないみたい')
              return
            }
            const g = st()
            const initialFrameCount = g.doc.frames.length
            const room = mode_frame_limit(g.doc.mode) - initialFrameCount
            const entryCount = Math.min(room, pngEntries.length)
            if (entryCount < 1) {
              toast('これ以上コマを増やせないよ')
              return
            }
            dispatch('frame.sync_live', null)
            const progress = modal_progress('PNG連番を取り込み中')
            progress.note(entryCount + 'コマ（写真レイヤーへ）')
            const width = g.doc.w
            const height = g.doc.h
            const [, context] = canvas_make(width, height, 1)
            const frames: Frame[] = []
            let entryIndex = 0
            let failedCount = 0

            const finish = (): void => {
              progress.close()
              const current = st()
              if (current.doc.w !== width || current.doc.h !== height || current.doc.frames.length !== initialFrameCount) {
                report_warning('PNG連番の取り込み中にプロジェクト構成が変更されました', 'stale import')
                toast('編集中の内容が変わったため取り込みを中止しました')
                return
              }
              if (!frames.length) {
                toast('読み込めるPNGがありませんでした')
                return
              }
              if (dispatch('frame.append_bulk', { frames, setCur: initialFrameCount + frames.length - 1 }) < 0) {
                toast('PNG連番を追加できなかった…')
                return
              }
              toast(frames.length + 'コマ取り込みました' + (failedCount ? '（' + failedCount + '件は読込失敗）' : ''))
              sfx_play('save')
            }

            const step = (): void => {
              if (entryIndex >= entryCount) {
                finish()
                return
              }
              const entry = pngEntries[entryIndex]
              const data = entry.data.buffer.slice(entry.data.byteOffset, entry.data.byteOffset + entry.data.byteLength) as ArrayBuffer
              const blob = new Blob([data], { type: 'image/png' })
              createImageBitmap(blob).then(
                bitmap => {
                  try {
                    if (bitmap.width < 1 || bitmap.height < 1) throw new RangeError('PNG has no drawable size')
                    context.clearRect(0, 0, width, height)
                    const imageRatio = bitmap.width / bitmap.height
                    const canvasRatio = width / height
                    let drawWidth = width
                    let drawHeight = height
                    if (imageRatio > canvasRatio) drawHeight = Math.round(width / imageRatio)
                    else drawWidth = Math.round(height * imageRatio)
                    context.imageSmoothingEnabled = true
                    context.drawImage(bitmap, Math.round((width - drawWidth) / 2), Math.round((height - drawHeight) / 2), drawWidth, drawHeight)
                    const frame = doc_frame_new()
                    frame.pk[L_P] = pack_img_data(context.getImageData(0, 0, width, height))
                    frames.push(frame)
                  } catch (error) {
                    failedCount++
                    report_warning('PNG連番の画像を変換できませんでした: ' + entry.name, error)
                  } finally {
                    bitmap.close()
                    entryIndex++
                    progress.set(entryIndex / entryCount)
                    step()
                  }
                },
                error => {
                  failedCount++
                  report_warning('PNG連番の画像をデコードできませんでした: ' + entry.name, error)
                  entryIndex++
                  progress.set(entryIndex / entryCount)
                  step()
                }
              )
            }
            step()
          },
          error => {
            report_warning('ZIPファイルを読み込めませんでした', error)
            toast('ZIPを読めなかった…')
          }
        )
      },
      error => {
        report_warning('ZIPファイルの内容を読み出せませんでした', error)
        toast('ZIPを読めなかった…')
      }
    )
  })
}

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

let frRatio = '4:3'
let frReso = 'low'

export function modal_firstrun(onDone: () => void): void {
  let rbtns = ''
  for (let i = 0; i < ASPECTS.length; i++) {
    rbtns += '<button class="frb' + (ASPECTS[i].name === frRatio ? ' on' : '') + '" id="fr_ratio_' + i + '" data-r="' + ASPECTS[i].name + '">' + esc(ASPECTS[i].name) + '</button>'
  }
  let qbtns = ''
  const quals = RESOS.filter(r => r.id === 'low' || r.id === 'mid' || r.id === 'hd')
  for (const r of quals) {
    qbtns += '<button class="frb' + (r.id === frReso ? ' on' : '') + '" id="fr_reso_' + r.id + '" data-q="' + r.id + '">' + esc(r.label) + '</button>'
  }
  const box = modal_open(
    '<div class="mhead">' + ic('spark') + 'ようこそ！ さいしょの設定</div>' +
    '<div class="mbody">キャンバスの<b>かたち</b>と<b>きれいさ</b>をえらんでね。<br><span class="dim">あとから ☰メニュー →「キャンバス」でも変えられるよ。</span></div>' +
    '<div class="msub">かたち（比率）</div><div class="frgrid">' + rbtns + '</div>' +
    '<div class="msub">きれいさ（画質）</div><div class="frgrid">' + qbtns + '</div>' +
    '<div class="mbody dim" id="frSizeNote"></div>' +
    '<div class="mrow end"><button class="mbtn primary" id="frOk">' + ic('check') + 'はじめる！</button></div>',
    1
  )
  const note = box.querySelector('#frSizeNote') as HTMLElement
  const upd = () => {
    const sz = reso_size(frRatio, frReso)
    note.textContent = 'キャンバス: ' + sz.w + ' × ' + sz.h + ' ドット'
    const bs = box.querySelectorAll('.frb')
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i] as HTMLElement
      b.classList.toggle('on', b.dataset.r === frRatio || b.dataset.q === frReso)
    }
  }
  upd()
  box.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.frb') as HTMLElement | null
    if (!b) return
    if (b.dataset.r) frRatio = b.dataset.r
    if (b.dataset.q) frReso = b.dataset.q
    upd()
    sfx_play('tap')
  })
  query(box, '#frOk').addEventListener('click', () => {
    modal_close()
    const sz = reso_size(frRatio, frReso)
    dispatch('project.resize_canvas', { w: sz.w, h: sz.h, ratio: frRatio, res: frReso, quiet: 1 })
    sfx_play('save')
    onDone()
  })
}

let efKind = EF_BLUR
let efAmt = 0.5
let efScratch: HTMLCanvasElement | null = null
let efScratchCtx: CanvasRenderingContext2D | null = null

function ef_preview_draw(box: HTMLElement, capture: EffectCapture | null): void {
  const cv = box.querySelector('#efPrev') as HTMLCanvasElement
  const x = cv.getContext('2d') as CanvasRenderingContext2D
  const res = effect_preview(efKind, efAmt, capture)
  x.clearRect(0, 0, cv.width, cv.height)
  if (!res) return
  if (!efScratch || efScratch.width !== res.reg.w || efScratch.height !== res.reg.h) {
    const [c, ctx] = canvas_make(res.reg.w, res.reg.h)
    efScratch = c
    efScratchCtx = ctx
  }
  const scratchContext = efScratchCtx as CanvasRenderingContext2D
  scratchContext.putImageData(res.img, 0, 0)
  const sc = Math.min(cv.width / res.reg.w, cv.height / res.reg.h)
  const dw = res.reg.w * sc
  const dh = res.reg.h * sc
  x.imageSmoothingEnabled = true
  x.fillStyle = '#ffffff'
  x.fillRect(0, 0, cv.width, cv.height)
  x.drawImage(efScratch, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh)
}

export function modal_effect(): void {
  const g = st()
  if (g.doc.mode !== MODE_NORMAL) {
    toast('エフェクトはノーマルモード専用だよ')
    return
  }
  let btns = ''
  for (const d of EFFECT_DEFS) btns += '<button class="efb" id="efb_' + d.id + '" data-ef="' + d.id + '" title="' + d.desc + '">' + ic(d.icon) + '<span>' + d.label + '</span></button>'
  const box = modal_open(
    '<div class="mhead">' + ic('effect') + 'エフェクト</div>' +
    '<div class="mbody dim">' + (g.sel.has ? '選択範囲' : 'いまのレイヤー全体') + 'にかかります</div>' +
    '<div class="efgrid">' + btns + '</div>' +
    '<div class="mrow rng"><span class="rlab">つよさ</span><input type="range" id="efAmtR" min="0" max="100" step="5" value="' + Math.round(efAmt * 100) + '"><b class="rval" id="efAmtV">' + Math.round(efAmt * 100) + '</b></div>' +
    '<canvas id="efPrev" width="280" height="180" class="efprev"></canvas>' +
    '<div class="mrow end"><button class="mbtn" id="efNo">やめる</button><button class="mbtn primary" id="efGo">かける</button></div>',
    1
  )
  const sync_btns = () => {
    for (const d of EFFECT_DEFS) (box.querySelector('#efb_' + d.id) as HTMLElement).classList.toggle('on', efKind === d.id)
  }
  const capture = effect_capture(320)
  let previewRaf = 0
  const preview = (): void => {
    if (previewRaf) return
    previewRaf = requestAnimationFrame(() => {
      previewRaf = 0
      if (box.isConnected) ef_preview_draw(box, capture)
    })
  }
  sync_btns()
  ef_preview_draw(box, capture)
  box.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.efb') as HTMLElement | null
    if (!b) return
    efKind = Number(b.dataset.ef)
    sync_btns()
    preview()
    sfx_play('tap')
  })
  const ar = box.querySelector('#efAmtR') as HTMLInputElement
  ar.addEventListener('input', () => {
    efAmt = clamp(Number(ar.value) / 100, 0, 1)
    query(box, '#efAmtV').textContent = ar.value
    preview()
  })
  query(box, '#efNo').addEventListener('click', modal_close)
  query(box, '#efGo').addEventListener('click', () => {
    modal_close()
    effect_apply(efKind, efAmt)
  })
}

let trKind = TR_FADE
let trSteps = 3

export function modal_transition(): void {
  const g = st()
  if (g.doc.mode !== MODE_NORMAL) {
    toast('トランジションはノーマルモード専用だよ')
    return
  }
  let btns = ''
  for (const d of TRANSITION_DEFS) btns += '<button class="trb" id="trb_' + d.id + '" data-tr="' + d.id + '">' + esc(d.label) + '</button>'
  const box = modal_open(
    '<div class="mhead">' + ic('transition') + 'トランジション</div>' +
    '<div class="mbody dim">いまのコマ（' + (g.doc.cur + 1) + '）と次のコマの間に、中間のコマを自動で作って入れます。<br><b>この操作は「もどす」できません</b>。</div>' +
    '<div class="trgrid">' + btns + '</div>' +
    '<div class="mrow rng"><span class="rlab">枚数</span><input type="range" id="trStepsR" min="1" max="12" step="1" value="' + trSteps + '"><b class="rval" id="trStepsV">' + trSteps + '枚</b></div>' +
    '<div class="mrow end"><button class="mbtn" id="trNo">やめる</button><button class="mbtn primary" id="trGo">入れる</button></div>',
    1
  )
  const sync_btns = () => {
    for (const d of TRANSITION_DEFS) (box.querySelector('#trb_' + d.id) as HTMLElement).classList.toggle('on', trKind === d.id)
  }
  sync_btns()
  box.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.trb') as HTMLElement | null
    if (!b) return
    trKind = Number(b.dataset.tr)
    sync_btns()
    sfx_play('tap')
  })
  const sr = box.querySelector('#trStepsR') as HTMLInputElement
  sr.addEventListener('input', () => {
    trSteps = clamp(Math.round(Number(sr.value)), 1, 12)
    query(box, '#trStepsV').textContent = trSteps + '枚'
  })
  query(box, '#trNo').addEventListener('click', modal_close)
  query(box, '#trGo').addEventListener('click', () => {
    modal_close()
    dispatch('flo.cancel', null)
    dispatch('sel.clear', null)
    transition_insert(trKind, trSteps)
  })
}

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
        dispatch('project.set_mode', m)
      }
    )
  })
}

function bind(id: string, fn: () => void): void {
  q(id).addEventListener('click', fn)
}

function sound_file_load(kind: string, label: string): void {
  file_pick('audio/*', file => {
    const ticket = snd_load_begin(kind)
    file.arrayBuffer().then(
      buffer => snd_load_bytes(kind, buffer, file.name.slice(0, 24), error => {
        if (error <= 0) toast(error === 0 ? label + 'を読み込みました' : '読めない形式みたい…')
      }, ticket),
      error => {
        report_warning('音声ファイルを読み出せませんでした', error)
        toast('読めない形式みたい…')
      }
    )
  })
}

export function panels_mount(): void {
  for (let b = 0; b < 13; b++) {
    const btn = document.getElementById('brush_' + b)
    if (!btn) continue
    const cv = document.createElement('canvas')
    cv.className = 'tipPrev'
    cv.width = 72
    cv.height = 72
    const x = cv.getContext('2d') as CanvasRenderingContext2D
    try {
      const tip = tip_get(b === 0 ? 0 : b, 26, '#3a3a3a', 0)
      const s2 = Math.min(64 / tip.width, 64 / tip.height, 2)
      const dw = tip.width * s2
      const dh = tip.height * s2
      if (b === 0) {
        x.strokeStyle = '#3a3a3a'
        x.lineWidth = 7
        x.lineCap = 'round'
        x.beginPath()
        x.moveTo(14, 50)
        x.quadraticCurveTo(30, 12, 58, 30)
        x.stroke()
      } else {
        x.drawImage(tip, (72 - dw) / 2, (72 - dh) / 2, dw, dh)
      }
    } catch (error) {
      report_warning('ブラシ見本の描画に失敗しました', error)
    }
    btn.appendChild(cv)
  }

  bind('newBtn', modal_new)
  bind('slotsBtn', modal_slots)
  bind('openBtn', file_open)
  bind('openFlipBtn', flip_import_ui)
  bind('saveFileBtn', file_save)
  bind('exportBtn', () => modal_export())
  bind('photoBtn', photo_import)
  bind('photoQuickBtn', photo_import)
  bind('photoLayerBtn', photo_import)
  bind('photoDraftBtn', () => {
    const g = st()
    if (!mode_allows_layer_alpha(g.doc.mode)) {
      toast('このモードでは写真の透明度を変えられないよ')
      return
    }
    if (!g.doc.lvis[L_P]) dispatch('layer.toggle_visible', L_P)
    const draft = g.doc.lalpha[L_P] >= 250
    dispatch('layer.set_alpha', { l: L_P, a255: draft ? Math.round(255 * 0.35) : 255 })
    toast(draft ? '写真を下書き表示にしました' : '写真を100%表示に戻しました')
    sfx_play('tap')
  })
  bind('photoClearBtn', () => {
    if (dispatch('layer.clear_at', L_P) < 0) {
      toast('このコマに写真はないよ')
      return
    }
    toast('写真レイヤーを消しました')
    sfx_play('del')
  })
  bind('videoBtn', video_import)
  bind('zipInBtn', zip_import)
  bind('flipInBtn', flip_import_ui)
  bind('mixerBtn', modal_mixer)
  bind('flipImageBtn', flipnote_maker_pick)
  bind('motionAssistBtn', modal_animation_assist)
  bind('effectBtn', modal_effect)
  bind('transBtn', modal_transition)
  bind('modeBtn', modal_mode)
  bind('syncRecBtn', recsync_toggle)
  bind('sizeApply', apply_canvas)
  bind('rotLBtn', () => transform_all('rotl'))
  bind('rotRBtn', () => transform_all('rotr'))
  bind('flipHBtn', () => transform_all('fliph'))
  bind('flipVBtn', () => transform_all('flipv'))
  bind('mergeBtn', () => dispatch('layer.merge_down', null))
  bind('lclearBtn', op_layer_clear)
  bind('lcopyBtn', op_layer_copy)
  bind('laddBtn', () => dispatch('layer.add', null))
  bind('ldelBtn', () => {
    const layer = st().pen.layer
    if (st().doc.mode !== MODE_NORMAL || layer <= L_DRAW_DEFAULT) return
    modal_confirm('レイヤーを削除', 'レイヤー' + esc(layer_name(layer)) + 'を全コマから削除する？', '削除', () => dispatch('layer.delete', layer))
  })
  bind('addManyBtn', modal_addmany)
  bind('rangeBtn', modal_range)
  bind('gotoBtn', modal_goto)
  bind('themeBtn', () => {
    pref_theme_toggle()
    dirty(D_ALL)
    sfx_play('tap')
  })
  bind('uisfxTgl', () => {
    pref_uisfx_toggle()
    dirty(D_SAVE | D_TOOLS)
    sfx_play('tap')
  })
  q<HTMLInputElement>('paperIn').addEventListener('input', e => {
    dispatch('doc.set_paper', (e.target as HTMLInputElement).value)
  })
  q('paperSw').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('[data-paper]') as HTMLElement | null
    if (!b) return
    dispatch('doc.set_paper', b.dataset.paper as string)
    sfx_play('tap')
  })
  const ratioSel = q<HTMLSelectElement>('ratioSel')
  const resoSel = q<HTMLSelectElement>('resoSel')
  const size_update = () => {
    const s2 = reso_size(ratioSel.value, resoSel.value)
    q('sizeNow').textContent = '→ ' + s2.w + '×' + s2.h
  }
  ratioSel.addEventListener('change', () => {
    if (ratioSel.value !== '4:3' && fixed_4_3_res(resoSel.value)) resoSel.value = 'low'
    size_update()
  })
  resoSel.addEventListener('change', () => {
    if (fixed_4_3_res(resoSel.value)) ratioSel.value = '4:3'
    size_update()
  })
  for (let i = 0; i < 2; i++) {
    const kind = 'bgm' + i
    bind('sload_' + kind, () => sound_file_load(kind, 'BGM'))
    bind('srec_' + kind, () => rec_toggle(kind))
    bind('splay_' + kind, () => snd_bgm_preview(i, 1))
    bind('sclr_' + kind, () => {
      snd_clear(kind)
      snd_stop_all()
    })
  }
  for (let i = 0; i < 4; i++) {
    const kind = 'se' + i
    q<HTMLSelectElement>('spre_' + kind).addEventListener('change', e => {
      const v = (e.target as HTMLSelectElement).value
      if (!v) return
      snd_assign_preset(i, v)
      snd_se_preview(i)
    })
    bind('sload_' + kind, () => sound_file_load(kind, 'SE'))
    bind('srec_' + kind, () => rec_toggle(kind))
    bind('splay_' + kind, () => snd_se_preview(i))
    bind('sclr_' + kind, () => snd_clear(kind))
  }
  q<HTMLInputElement>('bgmVol').addEventListener('input', e => snd_vol_set('bgm', Number((e.target as HTMLInputElement).value) / 100))
  q<HTMLInputElement>('seVol').addEventListener('input', e => snd_vol_set('se', Number((e.target as HTMLInputElement).value) / 100))
  region_add('sound_rec', D_SOUND, () => {
    const kinds = ['bgm0', 'bgm1', 'se0', 'se1', 'se2', 'se3']
    for (const k of kinds) q('srec_' + k).classList.toggle('rec', snd_recording() && rec_kind() === k ? true : false)
    q('syncRecBtn').classList.toggle('on', snd_recording() && (rec_kind() === 'bgm0' || rec_kind() === 'bgm1') ? true : false)
  })
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal_is_open()) {
      const back = q('modalRoot').firstElementChild
      if (back && !back.querySelector('.pfill')) modal_close()
    }
  })
}
