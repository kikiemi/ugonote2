import { modal_note_meta } from './note_meta'
export { rec_kind, rec_toggle, recsync_stop, recsync_toggle } from './recording'
import { animout_compose, animout_jobs, animout_ticks } from '../animout'
import { is_abort_error, report_warning } from '../diagnostics'
import { esc, ic, q, query, toast } from '../dom'
import { exp_kwz, exp_ppm } from '../exp'
import { fmt_parse } from '../fmt'
import { gif_encode } from '../gif'
import { canvas_make, canvas_to_blob, clamp, download_blob, file_pick } from '../lib'
import { store_export_ugn2 } from '../persist'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { anim_playing } from '../state/commands/play'
import { st } from '../state/store'
import { vid_export, vid_export_mp4, vid_mp4_mode, vid_supported } from '../vid'
import { zip_build, type ZipEntry } from '../zipw'
import { modal_close, modal_confirm, modal_open, modal_progress } from './modal'
import { anim_stop } from './playback'

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
  file_pick('.ugn2', file_open_selected)
}

export function file_open_selected(file: File): void {
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
        q('drawerClose').click()
        toast('開きました')
        sfx_play('paper')
      })
    },
    error => {
      report_warning('UGN2ファイルを読み出せませんでした', error)
      toast('ファイルを読めなかった…')
    }
  )
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
let exportPage = 'flip'

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
  const format = (id: string, icon: string, name: string, hint: string, preferred = false) =>
    `<button id="${id}" class="exportFormat${preferred ? ' preferred' : ''}"><span class="formatIcon">${ic(icon)}</span><span class="formatCopy"><b>${name}</b><small>${hint}</small></span>${ic('next')}</button>`
  const box = modal_open(`
    <div class="exportHead"><div class="mhead">${ic('download')}作品を持ち出す</div><button class="popx" id="exClose" title="保存メニューにもどる">${ic('check')}<span>もどる</span></button></div>
    <nav id="exportTabs" aria-label="書き出すもの"><button data-export-page="flip">うごメモ</button><button data-export-page="video">動画</button><button data-export-page="image">画像</button><button data-export-page="project">ノート</button></nav>
    <div id="exportContent">
      <section data-export-panel="flip">
        <p class="exportIntro">うごメモのファイルで残そう。</p>
        ${format('exKwz', 'film', 'うごメモ3D', '3DSで使う KWZ ファイル', preferredFlip === 'kwz' || g.doc.mode === 2)}
        ${format('exPpm', 'film', 'うごメモDSi', 'DSiで使う PPM ファイル', preferredFlip === 'ppm' || g.doc.mode === 1)}
        ${format('exMeta', 'file', '作者と作品の情報', '作者名・IDなどを確認する')}
        <p class="phint">うごメモの色数に合わせて、近い色にそろえます。${g.doc.mode === 1 ? 'DSiモードの絵はPPMでそのまま残せます。' : g.doc.mode === 2 ? '3Dモードの絵はKWZでそのまま残せます。' : ''}</p>
      </section>
      <section data-export-panel="video">
        <p class="exportIntro">絵を動かして見せよう。</p>
        ${format('exGif', 'film', 'GIFアニメ', 'くり返し動く画像')}
        ${format('exMp4', 'video', 'MP4の動画', mp4 ? '音と一緒に動画で残す' : 'この端末では未対応')}
        ${format('exWebm', 'video', 'WebMの動画', '再生を音と一緒に録画する')}
      </section>
      <section data-export-panel="image">
        <p class="exportIntro">描いた絵を、画像にしよう。</p>
        ${format('exPng', 'image', 'このコマの画像', '今の絵をPNGで残す')}
        ${format('exZip', 'many', 'ぜんぶのコマ', 'PNGの連番をZIPにまとめる')}
        <button class="tgl" id="exAlpha">${ic('image')}背景を透過にする</button>
      </section>
      <section data-export-panel="project">
        <p class="exportIntro">あとで、つづきを描きたいときに。</p>
        ${format('exUgn', 'save', '編集できるノート', '絵・音・設定を .ugn2 に残す')}
        <p class="phint">「ノートをひらく」から、この作品のつづきを描けます。</p>
      </section>
    <div id="exportOptions"><label>画像・動画の大きさ<select id="exScale"><option value="1">もとの大きさ</option><option value="2">2倍</option><option value="3">3倍</option></select></label>${g.doc.loopA >= 0 && g.doc.loopB >= 0 ? '<button class="tgl" id="exAB">A-B区間だけ（GIF・連番ZIP）</button>' : ''}</div>
    </div>
  `, 1)
  box.classList.add('exportBox')
  const choose = (page: string): void => {
    exportPage = page
    for (const panel of box.querySelectorAll<HTMLElement>('[data-export-panel]')) panel.hidden = panel.dataset.exportPanel !== page
    for (const tab of box.querySelectorAll<HTMLElement>('[data-export-page]')) tab.setAttribute('aria-pressed', String(tab.dataset.exportPage === page))
    query(box, '#exportOptions').hidden = page !== 'image' && page !== 'video'
    query(box, '#exportContent').scrollTop = 0
  }
  for (const tab of box.querySelectorAll<HTMLElement>('[data-export-page]')) tab.addEventListener('click', () => choose(tab.dataset.exportPage!))
  choose(preferredFlip ? 'flip' : exportPage)
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
