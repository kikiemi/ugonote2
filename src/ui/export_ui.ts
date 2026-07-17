import { animout_compose, animout_jobs, animout_ticks } from '../animout'
import { kwz_fsid_format, kwz_region_of, ppm_region_of } from '../codec/fname'
import { is_abort_error, report_warning } from '../diagnostics'
import { esc, ic, query, toast } from '../dom'
import { exp_kwz, exp_ppm } from '../exp'
import { fmt_parse } from '../fmt'
import { gif_encode } from '../gif'
import { D_SOUND } from '../h'
import { canvas_make, canvas_to_blob, clamp, download_blob, file_pick } from '../lib'
import { store_export_ugn2 } from '../persist'
import { snd_recording, snd_record_start, sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { anim_playing } from '../state/commands/play'
import { dirty, st } from '../state/store'
import { vid_export, vid_export_mp4, vid_mp4_mode, vid_supported } from '../vid'
import { zip_build, type ZipEntry } from '../zipw'
import { modal_close, modal_confirm, modal_open, modal_progress } from './modal'
import { anim_play, anim_stop } from './playback'
import { snd_record_finish } from './sound_io'

let recKind = ''

export function export_done(blob: Blob, filename: string, note: string): void {
  const canShare = typeof navigator.share === 'function' && typeof navigator.canShare === 'function'
  let sharedFile: File | null = null
  if (canShare) {
    try {
      const candidate = new File([blob], filename, { type: blob.type })
      if (navigator.canShare({ files: [candidate] })) sharedFile = candidate
    } catch {}
  }
  const box = modal_open(
    '<div class="mhead">' + ic('download') + 'できあがり！</div>' +
    '<p class="mbody"><b>' + esc(filename) + '</b>' + (note ? '<br><span class="phint">' + esc(note) + '</span>' : '') + '</p>' +
    '<div class="mrow" style="justify-content:flex-end;gap:8px">' +
    (sharedFile ? '<button class="mbtn" id="exShare">' + ic('upload') + '共有（SNSへ）</button>' : '') +
    '<button class="mbtn primary" id="exDl">' + ic('download') + 'ダウンロード</button>' +
    '</div>' +
    (sharedFile ? '<div class="phint">X・Instagram等へは「共有」から。ダウンロードできない端末でも共有→ファイルに保存が使えます</div>' : ''),
    1
  )
  query(box, '#exDl').addEventListener('click', () => {
    download_blob(blob, filename)
    modal_close()
  })
  const shareButton = box.querySelector('#exShare') as HTMLElement | null
  if (shareButton && sharedFile) {
    const file = sharedFile
    shareButton.addEventListener('click', () => {
      navigator.share({ files: [file], title: filename }).catch(error => {
        if (!is_abort_error(error)) {
          report_warning('共有に失敗しました', error)
          toast('共有できませんでした…')
        }
      })
      modal_close()
    })
  }
}

export function safe_name(): string {
  return (st().doc.name || 'ugonote').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'ugonote'
}

function pad3(n: number): string {
  return n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n
}

function export_png(alpha: number): void {
  dispatch('frame.sync_live', null)
  const g = st()
  const pw = g.doc.w * expScale
  const ph = g.doc.h * expScale
  const [c, x] = canvas_make(pw, ph)
  const job = animout_jobs(g.doc.frames, g.doc.cur, g.doc.cur, g.doc.fps, g.doc.anim, 1)[0]
  animout_compose(job, x, pw, ph, alpha ? 0 : 1, g.doc.fps, g.doc.anim)
  canvas_to_blob(c, 'image/png', undefined, (blob, error) => {
    if (!blob) {
      report_warning('PNG画像を作成できませんでした', error)
      toast('PNGを作れなかった…')
      return
    }
    export_done(blob, safe_name() + '_' + pad3(g.doc.cur + 1) + '.png', '')
    toast('PNGを書き出しました')
    sfx_play('save')
  })
}

function gather_frames(scale: number, withPaper: number, a: number, b: number, onStep: (p: number) => void, done: (list: ImageData[], holds: number[]) => void): void {
  dispatch('frame.sync_live', null)
  const g = st()
  const jobs = animout_jobs(g.doc.frames, a, b, g.doc.fps, g.doc.anim, 1)
  const w = Math.max(2, Math.round(g.doc.w * scale)) & ~1
  const h = Math.max(2, Math.round(g.doc.h * scale)) & ~1
  const [, x] = canvas_make(w, h, 1)
  const list: ImageData[] = []
  const holds: number[] = []
  let index = 0
  const step = (): void => {
    const started = performance.now()
    while (index < jobs.length && performance.now() - started < 24) {
      const job = jobs[index]
      x.clearRect(0, 0, w, h)
      animout_compose(job, x, w, h, withPaper, g.doc.fps, g.doc.anim)
      list.push(x.getImageData(0, 0, w, h))
      holds.push(job.hold)
      index++
    }
    onStep(index / jobs.length)
    if (index < jobs.length) {
      setTimeout(step, 0)
      return
    }
    done(list, holds)
  }
  step()
}

function export_gif(): void {
  const g = st()
  const [ga, gb] = export_range()
  const jobs = animout_jobs(g.doc.frames, ga, gb, g.doc.fps, g.doc.anim, 1)
  const count = jobs.length
  const big = g.doc.w * expScale * g.doc.h * expScale > 700000 || count > 240
  const scale = big ? expScale * 0.5 : expScale
  const prog = modal_progress('GIFを書き出し中')
  prog.note(big ? '大きいので半分サイズで書き出すよ（' + count + '枚）' : count + '枚')
  gather_frames(scale, 1, ga, gb, p => prog.set(p * 0.35), (list, holds) => {
    gif_encode(list, g.doc.fps, holds, 1, p => prog.set(0.35 + p * 0.65), bytes => {
      prog.close()
      export_done(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'image/gif' }), safe_name() + '.gif', '')
      toast('GIFを書き出しました')
      sfx_play('save')
    })
  })
}

function export_zip(alpha: number): void {
  dispatch('frame.sync_live', null)
  const g = st()
  const [rangeStart, rangeEnd] = export_range()
  const jobs = animout_jobs(g.doc.frames, rangeStart, rangeEnd, g.doc.fps, g.doc.anim, 1)
  const progress = modal_progress('PNG連番ZIPを書き出し中')
  progress.note(jobs.length + '枚' + (alpha ? '・背景透過' : '') + (rangeStart > 0 || rangeEnd < g.doc.frames.length - 1 ? '・A-B区間' : ''))
  const width = g.doc.w * expScale
  const height = g.doc.h * expScale
  const [canvas, context] = canvas_make(width, height)
  const entries: ZipEntry[] = []
  const baseName = safe_name()
  let jobIndex = 0
  let completed = 0

  const fail = (message: string, error: unknown): void => {
    if (completed) return
    completed = 1
    report_warning(message, error)
    progress.close()
    toast('PNG連番ZIPを作れなかった…')
  }

  const finish = (): void => {
    if (completed) return
    try {
      const bytes = zip_build(entries)
      completed = 1
      progress.close()
      export_done(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/zip' }), baseName + '_png.zip', '')
      toast('ZIPを書き出しました')
      sfx_play('save')
    } catch (error) {
      fail('PNG連番ZIPを構築できませんでした', error)
    }
  }

  const step = (): void => {
    if (completed) return
    if (jobIndex >= jobs.length) {
      finish()
      return
    }
    const job = jobs[jobIndex]
    try {
      context.clearRect(0, 0, width, height)
      animout_compose(job, context, width, height, alpha ? 0 : 1, g.doc.fps, g.doc.anim)
    } catch (error) {
      fail('PNG連番のコマを描画できませんでした', error)
      return
    }
    canvas_to_blob(canvas, 'image/png', undefined, (blob, blobError) => {
      if (completed) return
      if (!blob) {
        fail('PNG連番の画像を作成できませんでした', blobError)
        return
      }
      blob.arrayBuffer().then(
        buffer => {
          if (completed) return
          entries.push({ name: baseName + '_' + pad3(jobIndex + 1) + '.png', data: new Uint8Array(buffer) })
          jobIndex++
          progress.set(jobIndex / jobs.length)
          step()
        },
        error => fail('PNG連番の画像データを読み出せませんでした', error)
      )
    })
  }

  step()
}

function export_webm(): void {
  const g = st()
  if (!vid_supported()) {
    toast('このブラウザは動画書き出しに対応してないみたい…')
    return
  }
  if (anim_playing()) anim_stop()
  const jobs = animout_jobs(g.doc.frames, 0, g.doc.frames.length - 1, g.doc.fps, g.doc.anim, 0)
  const secs = Math.ceil(animout_ticks(jobs) / g.doc.fps)
  const prog = modal_progress('動画（WebM）を録画中')
  prog.note('実時間で録るよ。だいたい' + secs + '秒まってね。')
  vid_export(expScale, p => prog.set(p), blob => {
    prog.close()
    if (!blob) {
      toast('動画を作れなかった…')
      return
    }
    export_done(blob, safe_name() + '.webm', '')
    toast('動画を書き出しました')
    sfx_play('save')
  })
}

export function file_save(): void {
  dispatch('frame.sync_live', null)
  store_export_ugn2(bytes => {
    if (!bytes) {
      toast('保存に失敗しました…')
      return
    }
    download_blob(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/octet-stream' }), safe_name() + '.ugn2')
    toast('.ugn2に保存しました')
    sfx_play('save')
  })
}

export function file_open(): void {
  file_pick('.ugn2', file => {
    file.arrayBuffer().then(
      buffer => {
        modal_confirm('ファイルを開く', 'いまのノートは自動保存ぶんだけ残るよ。<br>「' + esc(file.name) + '」を開く？', '開く', () => {
          const project = fmt_parse(new Uint8Array(buffer))
          if (!project) {
            toast('開けなかった…（こわれてるかも）')
            return
          }
          if (dispatch('project.apply_loaded', project) < 0) {
            toast('開けなかった…（内容が正しくないみたい）')
            return
          }
          toast('開きました')
          sfx_play('paper')
        })
      },
      error => {
        report_warning('UGN2ファイルを読み出せませんでした', error)
        toast('ファイルを読めなかった…')
      }
    )
  })
}

export function rec_toggle(kind: string): void {
  if (snd_recording()) {
    if (recKind !== kind) {
      toast('べつのスロットで録音中だよ')
      return
    }
    snd_record_finish(kind, '録音 ' + new Date().toLocaleTimeString(), err => {
      recKind = ''
      dirty(D_SOUND)
      if (err <= 0) toast(err === 0 ? '録音を保存しました' : '録音を保存できなかった…')
      if (err === 0) sfx_play('save')
    })
    return
  }
  snd_record_start(err => {
    if (err !== 0) {
      toast('マイクが使えないみたい…')
      return
    }
    recKind = kind
    dirty(D_SOUND)
    toast('録音中…もういちど押すと止まるよ')
  })
}

export function recsync_toggle(): void {
  const g = st()
  if (snd_recording()) {
    const kind = recKind || (g.snd.bgm[0].bytes ? 'bgm1' : 'bgm0')
    snd_record_finish(kind, 'アフレコ ' + new Date().toLocaleTimeString(), err => {
      recKind = ''
      if (anim_playing()) anim_stop()
      dirty(D_SOUND)
      if (err <= 0) toast(err === 0 ? 'アフレコをBGMに保存しました' : '録音を保存できなかった…')
    })
    return
  }
  modal_confirm('再生しながら録音', '再生にあわせてマイクで録音して、空いてるBGMスロットに入れるよ。', 'はじめる', () => {
    snd_record_start(err => {
      if (err !== 0) {
        toast('マイクが使えないみたい…')
        return
      }
      recKind = g.snd.bgm[0].bytes ? 'bgm1' : 'bgm0'
      anim_play()
      dirty(D_SOUND)
      toast('録音中！もういちど押すと止まるよ')
    })
  })
}

function export_mp4(): void {
  if (anim_playing()) anim_stop()
  const mode = vid_mp4_mode()
  if (!mode) {
    toast('この環境はMP4に未対応。WebMをつかってね')
    return
  }
  const prog = modal_progress('MP4を書き出し中')
  prog.note(mode === 2 ? 'H.264でエンコード中…' : '実時間キャプチャで録画中…')
  vid_export_mp4(expScale, p => prog.set(p), (blob, note) => {
    prog.close()
    if (!blob) {
      toast(note || 'MP4を作れなかった…')
      return
    }
    export_done(blob, safe_name() + '.mp4', note || '')
    toast(note ? 'MP4を書き出し（' + note + '）' : 'MP4を書き出しました')
    sfx_play('save')
  })
}

function export_kwz_ui(): void {
  if (anim_playing()) anim_stop()
  const prog = modal_progress('KWZ（うごメモ3D）を書き出し中')
  prog.note('3レイヤー・6色に量子化するよ')
  exp_kwz(p => prog.set(p), (bytes, note, filename) => {
    prog.close()
    if (!bytes) {
      toast(note || 'KWZを作れなかった…')
      return
    }
    export_done(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/octet-stream' }), filename, note || '')
    toast(note ? 'KWZを書き出し（' + note + '）' : 'KWZを書き出しました')
    sfx_play('save')
  })
}

function export_ppm_ui(): void {
  if (anim_playing()) anim_stop()
  const prog = modal_progress('PPM（うごメモDSi）を書き出し中')
  prog.note('2レイヤー・3色に量子化するよ')
  exp_ppm(p => prog.set(p), (bytes, note, filename) => {
    prog.close()
    if (!bytes) {
      toast(note || 'PPMを作れなかった…')
      return
    }
    export_done(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/octet-stream' }), filename, note || '')
    toast(note ? 'PPMを書き出し（' + note + '）' : 'PPMを書き出しました')
    sfx_play('save')
  })
}

let expAlpha = 0
let expScale = 1

let expAB = 0

export function export_range(): [number, number] {
  const g = st()
  const n = g.doc.frames.length
  const a = g.doc.loopA
  const b = g.doc.loopB
  if (expAB && a >= 0 && b >= 0 && a <= b) return [a, b]
  return [0, n - 1]
}

export function modal_export(preferredFlip: '' | 'ppm' | 'kwz' = ''): void {
  const g = st()
  const mp4 = vid_mp4_mode()
  const box = modal_open(
    '<div class="mhead">' + ic('download') + '書き出し</div>' +
    '<div class="msub">うごき</div>' +
    '<div class="mrow wrap">' +
    '<button class="mbtn" id="exGif">' + ic('film') + 'GIF</button>' +
    '<button class="mbtn" id="exMp4">' + ic('video') + 'MP4' + (mp4 ? '' : '（未対応）') + '</button>' +
    '<button class="mbtn" id="exWebm">' + ic('video') + 'WebM</button>' +
    '<span class="mlab">きれいさ</span><select id="exScale" class="msel"><option value="1">×1</option><option value="2">×2</option><option value="3">×3</option></select>' +
    '</div>' +
    (g.doc.mode === 1 ? '<div class="mbody dim">いまは<b>うごメモモード</b>：PPM書き出しがドットそのままで一番きれいだよ</div>' : g.doc.mode === 2 ? '<div class="mbody dim">いまは<b>うごメモ3Dモード</b>：KWZ書き出しがドットそのままで一番きれいだよ</div>' : '') +
    '<div class="msub">うごメモ</div>' +
    '<div class="mrow wrap">' +
    '<button class="mbtn' + (preferredFlip === 'kwz' ? ' primary' : '') + '" id="exKwz">' + ic('file') + 'KWZ（3DS）</button>' +
    '<button class="mbtn' + (preferredFlip === 'ppm' ? ' primary' : '') + '" id="exPpm">' + ic('file') + 'PPM（DSi）</button>' +
    '<button class="mbtn" id="exMeta">' + ic('gear') + '作品情報…</button>' +
    '</div>' +
    '<div class="mbody dim">うごメモは色数がすくない形式だから、近い色にまるめられるよ。</div>' +
    '<div class="msub">画像</div>' +
    '<div class="mrow wrap">' +
    '<button class="mbtn" id="exPng">' + ic('image') + 'このコマをPNG</button>' +
    '<button class="mbtn" id="exZip">' + ic('file') + 'PNG連番ZIP</button>' +
    '<button class="tgl" id="exAlpha">背景を透過にする</button>' +
    (g.doc.loopA >= 0 && g.doc.loopB >= 0 ? '<button class="tgl" id="exAB">A-B区間だけ（GIF/連番ZIP）</button>' : '') +
    '</div>' +
    '<div class="msub">プロジェクト</div>' +
    '<div class="mrow wrap">' +
    '<button class="mbtn" id="exUgn">' + ic('save') + 'ノートを保存（.ugn2）</button>' +
    '</div>' +
    '<div class="mrow end"><button class="mbtn" id="exClose">とじる</button></div>',
    1
  )
  const b = (id: string, fn: () => void) => (box.querySelector('#' + id) as HTMLElement).addEventListener('click', fn)
  const scaleSel = box.querySelector('#exScale') as HTMLSelectElement
  scaleSel.value = String(expScale)
  scaleSel.addEventListener('change', () => {
    expScale = clamp(Math.round(Number(scaleSel.value)), 1, 3)
  })
  const alphaBtn = box.querySelector('#exAlpha') as HTMLElement
  alphaBtn.classList.toggle('on', expAlpha ? true : false)
  b('exAlpha', () => {
    expAlpha = expAlpha ? 0 : 1
    alphaBtn.classList.toggle('on', expAlpha ? true : false)
    sfx_play('tap')
  })
  const abBtnE = box.querySelector('#exAB') as HTMLElement | null
  if (abBtnE) {
    abBtnE.classList.toggle('on', expAB ? true : false)
    abBtnE.addEventListener('click', () => {
      expAB = expAB ? 0 : 1
      abBtnE.classList.toggle('on', expAB ? true : false)
      sfx_play('tap')
    })
  }
  b('exGif', () => {
    modal_close()
    export_gif()
  })
  b('exMp4', () => {
    modal_close()
    export_mp4()
  })
  b('exWebm', () => {
    modal_close()
    export_webm()
  })
  b('exKwz', () => {
    modal_close()
    export_kwz_ui()
  })
  b('exPpm', () => {
    modal_close()
    export_ppm_ui()
  })
  b('exMeta', () => {
    modal_close()
    modal_note_meta()
  })
  b('exPng', () => {
    modal_close()
    export_png(expAlpha)
  })
  b('exZip', () => {
    modal_close()
    export_zip(expAlpha)
  })
  b('exUgn', () => {
    modal_close()
    file_save()
  })
  b('exClose', modal_close)
  const preferredButton = preferredFlip === 'kwz' ? box.querySelector<HTMLElement>('#exKwz') : preferredFlip === 'ppm' ? box.querySelector<HTMLElement>('#exPpm') : null
  if (preferredButton) preferredButton.focus()
}

export function rec_kind(): string {
  return recKind
}

function modal_note_meta(): void {
  const m0 = st().doc.meta
  const dstr = (t: number) => (t ? new Date(t * 1000).toLocaleString('ja-JP') : '—')
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
    '<div class="mrow"><span class="mlab">現在</span><span class="mono grow">' + esc(m0.cur_fn || '（書き出し時に生成）') + (m0.edits ? '　<span class="dim">編集' + m0.edits + '回</span>' : '') + '</span></div>' +
    '<div class="msub">属性</div>' +
    '<div class="mrow wrap">' +
    '<button class="tgl" id="mtLock">ロック（本人以外編集不可）</button>' +
    '<button class="tgl" id="mtCmt">コメント属性（flags bit4）</button>' +
    '</div>' +
    '<div class="mbody dim">つくった日: ' + dstr(m0.created) + '　/　さいごの編集: ' + dstr(m0.modified) + '</div>' +
    '<div class="msub">編集履歴（世代）</div>' +
    '<div class="mbody mono dim">元: ' + esc(m0.root_name || '—') + ' → 親: ' + esc(m0.parent_name || '—') + ' → 現: ' + esc(m0.cur_name || '—') + '</div>' +
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
