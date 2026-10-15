import { pixel_source_ready, pixel_source_prepare } from '../pixel_source'
import { memory_check, memory_work_budget } from '../memory'
import { task_schedule } from '../task_queue'
import { modal_note_meta } from './note_meta'
import { animout_compose, animout_jobs, animout_ticks } from '../animout'
import { is_abort_error, report_warning } from '../diagnostics'
import { esc, ic, q, query, toast } from '../dom'
import { exp_kwz, exp_ppm } from '../exp'
import { fmt_parse } from '../fmt'
import { animfx_active } from '../animfx'
import { doc_render_plan } from '../doc'
import { export_frames_async } from '../workercli'
import { canvas_make, canvas_to_blob, clamp, download_blob } from '../lib'
import { store_export_ugn2 } from '../persist'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { anim_playing } from '../state/commands/play'
import { st } from '../state/store'
import { vid_export, vid_export_mp4, vid_mp4_mode, vid_supported } from '../vid'
import { type zip_entry_t } from '../zipw'
import { modal_close, modal_confirm, modal_open, modal_progress } from './modal'
import { anim_stop } from './playback'

export function export_done(blob: Blob, filename: string, note: string): void {
  const can_share = typeof navigator.share === 'function' && typeof navigator.canShare === 'function'
  let shared_file: File | null = null
  if (can_share) {
    try {
      const candidate = new File([blob], filename, { type: blob.type })
      if (navigator.canShare({ files: [candidate] })) shared_file = candidate
    } catch {}
  }
  const box = modal_open(
    '<div class="mhead">' + ic('download') + 'できあがり！</div>' +
    '<p class="mbody"><b>' + esc(filename) + '</b>' + (note ? '<br><span class="phint">' + esc(note) + '</span>' : '') + '</p>' +
    '<div class="mrow" style="justify-content:flex-end;gap:8px">' +
    (shared_file ? '<button class="mbtn" id="ex_share">' + ic('upload') + '共有（SNSへ）</button>' : '') +
    '<button class="mbtn primary" id="ex_dl">' + ic('download') + 'ダウンロード</button>' +
    '</div>' +
    (shared_file ? '<div class="phint">X・Instagram等へは「共有」から。ダウンロードできない端末でも共有→ファイルに保存が使えます</div>' : ''),
    1
  )
  query(box, '#ex_dl').addEventListener('click', () => {
    download_blob(blob, filename)
    modal_close()
  })
  const share_button = box.querySelector('#ex_share') as HTMLElement | null
  if (share_button && shared_file) {
    const file = shared_file
    share_button.addEventListener('click', () => {
      if (share_button.hasAttribute('disabled')) return
      share_button.setAttribute('disabled', '')
      navigator.share({ files: [file], title: filename }).then(
        () => { if (box.isConnected) modal_close() },
        error => {
          if (!is_abort_error(error)) { report_warning('共有に失敗しました', error); toast('共有できませんでした。「ダウンロード」から保存できます') }
        }
      ).finally(() => share_button.removeAttribute('disabled'))
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
  const frame = g.doc.frames[g.doc.cur]
  if (!pixel_source_ready(frame)) {
    void pixel_source_prepare(frame).then(() => { if (st().doc.frames[st().doc.cur] === frame) export_png(alpha); else toast('作品が変わったため書き出しを中止しました') }, error => toast(String(error)))
    return
  }
  const pw = Math.max(1, Math.round(g.doc.w * exp_scale))
  const ph = Math.max(1, Math.round(g.doc.h * exp_scale))
  try { memory_check(pw * ph * 12, memory_work_budget(g.mobile)) } catch (error) { toast(error instanceof Error ? error.message : String(error)); return }
  const [c, x] = canvas_make(pw, ph)
  const job = animout_jobs(g.doc.frames, g.doc.cur, g.doc.cur, g.doc.fps, g.doc.anim, 1)[0]
  animout_compose(job, x, pw, ph, alpha ? 0 : 1, g.doc.fps, g.doc.anim)
  canvas_to_blob(c, 'image/png', undefined, (blob, error) => {
    c.width = 0
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

function gather_frames(scale: number, with_paper: number, a: number, b: number, on_step: (p: number) => void, done: (list: ImageData[], holds: number[]) => void): void {
  dispatch('frame.sync_live', null)
  const g = st()
  const jobs = animout_jobs(g.doc.frames, a, b, g.doc.fps, g.doc.anim, 1)
  const w = Math.max(2, Math.round(g.doc.w * scale)) & ~1
  const h = Math.max(2, Math.round(g.doc.h * scale)) & ~1
  const [canvas, x] = canvas_make(w, h, 1)
  const list: ImageData[] = []
  const holds: number[] = []
  let index = 0
  const step = (): void => {
    const started = performance.now()
    while (index < jobs.length && performance.now() - started < 12) {
      const job = jobs[index]
      if (!pixel_source_ready(g.doc.frames[job.frame])) {
        void pixel_source_prepare(g.doc.frames[job.frame]).then(step, error => { canvas.width = 0; report_warning('GIFのコマを準備できませんでした', error); done([], []) })
        return
      }
      x.clearRect(0, 0, w, h)
      animout_compose(job, x, w, h, with_paper, g.doc.fps, g.doc.anim)
      list.push(x.getImageData(0, 0, w, h))
      holds.push(job.hold)
      index++
    }
    on_step(index / jobs.length)
    if (index < jobs.length) {
      task_schedule(step)
      return
    }
    canvas.width = 0
    done(list, holds)
  }
  step()
}

function export_gif(): void {
  const g = st()
  const [ga, gb] = export_range()
  const jobs = animout_jobs(g.doc.frames, ga, gb, g.doc.fps, g.doc.anim, 1)
  const count = jobs.length
  const scale = exp_scale
  const prog = modal_progress('GIFを書き出し中')
  prog.note(count + '枚')
  const input = { w: Math.max(2, Math.round(g.doc.w * scale)) & ~1, h: Math.max(2, Math.round(g.doc.h * scale)) & ~1, fps: g.doc.fps, holds: jobs.map(job => job.hold), name: safe_name(), format: 'gif' as const, budget: memory_work_budget(g.mobile) }
  const finish = (blob: Blob): void => {
    prog.close()
    export_done(blob, input.name + '.gif', '')
    toast('GIFを書き出しました')
    sfx_play('save')
  }
  const fail = (error: unknown): void => {
    prog.close()
    report_warning('GIFを書き出せませんでした', error)
    toast(error instanceof Error ? error.message : 'GIFを作れなかった…')
  }
  dispatch('frame.sync_live', null)
  if (!animfx_active(g.doc.anim)) {
    const plans = jobs.map(job => doc_render_plan(job.frame, 1, 0))
    void export_frames_async({ ...input, plans, frames: jobs.map((_, index) => index) }, value => prog.set(value)).then(finish, fail)
    return
  }
  try { memory_check(input.w * input.h * (4 * count + 12), input.budget) } catch (error) { fail(error); return }
  gather_frames(scale, 1, ga, gb, value => prog.set(value * 0.35), (images, holds) => {
    void export_frames_async({ ...input, images, holds }, value => prog.set(0.35 + value * 0.65)).then(finish, fail)
  })
}

function export_zip(alpha: number): void {
  dispatch('frame.sync_live', null)
  const g = st()
  const [range_start, range_end] = export_range()
  const jobs = animout_jobs(g.doc.frames, range_start, range_end, g.doc.fps, g.doc.anim, 1)
  const progress = modal_progress('PNG連番ZIPを書き出し中')
  progress.note(jobs.length + '枚' + (alpha ? '・背景透過' : '') + (range_start > 0 || range_end < g.doc.frames.length - 1 ? '・A-B区間' : ''))
  const width = Math.max(1, Math.round(g.doc.w * exp_scale))
  const height = Math.max(1, Math.round(g.doc.h * exp_scale))
  const budget = memory_work_budget(g.mobile)
  try { memory_check(width * height * 12, budget) } catch (error) { progress.close(); toast(error instanceof Error ? error.message : String(error)); return }
  let canvas: HTMLCanvasElement | null = null
  const entries: zip_entry_t[] = []
  const base_name = safe_name()
  let job_index = 0
  let completed = 0, entry_bytes = 0

  const fail = (message: string, error: unknown): void => {
    if (completed) return
    completed = 1
    report_warning(message, error)
    progress.close()
    if (canvas) canvas.width = 0
    entries.length = 0
    toast(error instanceof Error ? error.message : 'PNG連番ZIPを作れなかった…')
  }

  const input = { w: width, h: height, fps: g.doc.fps, holds: jobs.map(job => job.hold), format: 'pngzip' as const, name: base_name, budget }
  const deliver = (blob: Blob): void => {
    if (completed) return
    completed = 1
    progress.close()
    export_done(blob, base_name + '_png.zip', '')
    toast('ZIPを書き出しました')
    sfx_play('save')
    if (canvas) canvas.width = 0
  }
  const finish = (): void => {
    if (completed) return
    void export_frames_async({ ...input, entries }, value => progress.set(0.9 + value * 0.1)).then(deliver, error => fail('PNG連番ZIPを構築できませんでした', error))
  }
  if (!animfx_active(g.doc.anim)) {
    const plans = jobs.map(job => doc_render_plan(job.frame, alpha ? 0 : 1, 0))
    void export_frames_async({ ...input, plans, frames: jobs.map((_, index) => index) }, value => progress.set(value)).then(deliver, error => fail('PNG連番ZIPを構築できませんでした', error))
    return
  }

  const created = canvas_make(width, height)
  canvas = created[0]
  const context = created[1]
  const step = (): void => {
    if (completed) return
    if (job_index >= jobs.length) {
      finish()
      return
    }
    const job = jobs[job_index]
    if (!pixel_source_ready(g.doc.frames[job.frame])) { void pixel_source_prepare(g.doc.frames[job.frame]).then(step, error => fail('PNG連番のコマを準備できませんでした', error)); return }
    try {
      context.clearRect(0, 0, width, height)
      animout_compose(job, context, width, height, alpha ? 0 : 1, g.doc.fps, g.doc.anim)
    } catch (error) {
      fail('PNG連番のコマを描画できませんでした', error)
      return
    }
    canvas_to_blob(canvas!, 'image/png', undefined, (blob, blob_error) => {
      if (completed) return
      if (!blob) {
        fail('PNG連番の画像を作成できませんでした', blob_error)
        return
      }
      blob.arrayBuffer().then(
        buffer => {
          if (completed) return
          entry_bytes += buffer.byteLength
          try { memory_check(entry_bytes * 3 + width * height * 12, budget) } catch (error) { fail('PNG連番のデータが大きすぎます', error); return }
          entries.push({ name: base_name + '_' + pad3(job_index + 1) + '.png', data: new Uint8Array(buffer) })
          job_index++
          progress.set(job_index / jobs.length * 0.9)
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
  const prog = modal_progress('動画（WebM）を書き出し中')
  prog.note('再生時間 ' + secs + '秒分。処理が終わるまでお待ちください。')
  vid_export(exp_scale, p => prog.set(p), blob => {
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
    download_blob(bytes instanceof Blob ? bytes : new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/octet-stream' }), safe_name() + '.ugn2')
    toast('.ugn2に保存しました')
    sfx_play('save')
  })
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
        q('drawer_close').click()
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
  prog.note('映像と音声を準備しています。録画方式になる端末では、この画面を表示したままお待ちください。')
  vid_export_mp4(exp_scale, p => prog.set(p), (blob, note) => {
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

let exp_alpha = 0
let exp_scale = 1

let exp_ab = 0
let export_page = 'flip'

export function export_range(): [number, number] {
  const g = st()
  const n = g.doc.frames.length
  const a = g.doc.loop_a
  const b = g.doc.loop_b
  if (exp_ab && a >= 0 && b >= 0 && a <= b) return [a, b]
  return [0, n - 1]
}

export function modal_export(preferred_flip: '' | 'ppm' | 'kwz' = ''): void {
  const g = st()
  const mp4 = vid_mp4_mode()
  const format = (id: string, icon: string, name: string, hint: string, preferred = false) =>
    `<button id="${id}" class="export_format${preferred ? ' preferred' : ''}"><span class="format_icon">${ic(icon)}</span><span class="format_copy"><b>${name}</b><small>${hint}</small></span>${ic('next')}</button>`
  const box = modal_open(`
    <div class="export_head"><div class="mhead">${ic('download')}書き出す</div><button class="popx" id="ex_close" title="保存メニューにもどる">${ic('check')}<span>もどる</span></button></div>
    <nav id="export_tabs" aria-label="書き出すもの"><button data-export-page="flip">うごメモ</button><button data-export-page="video">動画</button><button data-export-page="image">画像</button><button data-export-page="project">ノート</button></nav>
    <div id="export_content">
      <section data-export-panel="flip">
        <p class="export_intro">うごメモのファイルで残そう。</p>
        ${format('ex_kwz', 'film', 'うごメモ3D', '3DSで使う KWZ ファイル', preferred_flip === 'kwz' || g.doc.mode === 2)}
        ${format('ex_ppm', 'film', 'うごメモDSi', 'DSiで使う PPM ファイル', preferred_flip === 'ppm' || g.doc.mode === 1)}
        ${format('ex_meta', 'file', '作者と作品の情報', '作者名・IDなどを確認する')}
        <p class="phint">うごメモの色数に合わせて、近い色にそろえます。${g.doc.mode === 1 ? 'DSiモードの絵はPPMでそのまま残せます。' : g.doc.mode === 2 ? '3Dモードの絵はKWZでそのまま残せます。' : ''}</p>
      </section>
      <section data-export-panel="video">
        <p class="export_intro">絵を動かして見せよう。</p>
        ${format('ex_gif', 'film', 'GIFアニメ', 'くり返し動く画像')}
        ${format('ex_mp4', 'video', 'MP4の動画', mp4 ? '音と一緒に動画で残す' : 'この端末では未対応')}
        ${format('ex_webm', 'video', 'WebMの動画', '再生を音と一緒に録画する')}
      </section>
      <section data-export-panel="image">
        <p class="export_intro">描いた絵を、画像にしよう。</p>
        ${format('ex_png', 'image', 'このコマの画像', '今の絵をPNGで残す')}
        ${format('ex_zip', 'many', 'ぜんぶのコマ', 'PNGの連番をZIPにまとめる')}
        <button class="tgl" id="ex_alpha">${ic('image')}背景を透過にする</button>
      </section>
      <section data-export-panel="project">
        <p class="export_intro">あとで、つづきを描きたいときに。</p>
        ${format('ex_ugn', 'save', '編集できるノート', '絵・音・設定を .ugn2 に残す')}
        <p class="phint">「ノートをひらく」から、この作品のつづきを描けます。</p>
      </section>
    <div id="export_options"><label>画像・動画の大きさ<select id="ex_scale"><option value="0.25">1/4</option><option value="0.5">1/2</option><option value="1">もとの大きさ</option><option value="2">2倍</option><option value="3">3倍</option></select></label>${g.doc.loop_a >= 0 && g.doc.loop_b >= 0 ? '<button class="tgl" id="ex_ab">A-B区間だけ（GIF・連番ZIP）</button>' : ''}</div>
    </div>
  `, 1)
  box.classList.add('export_box')
  const choose = (page: string): void => {
    export_page = page
    for (const panel of box.querySelectorAll<HTMLElement>('[data-export-panel]')) panel.hidden = panel.dataset.exportPanel !== page
    for (const tab of box.querySelectorAll<HTMLElement>('[data-export-page]')) tab.setAttribute('aria-pressed', String(tab.dataset.exportPage === page))
    query(box, '#export_options').hidden = page !== 'image' && page !== 'video'
    query(box, '#export_content').scrollTop = 0
  }
  for (const tab of box.querySelectorAll<HTMLElement>('[data-export-page]')) tab.addEventListener('click', () => choose(tab.dataset.exportPage!))
  choose(preferred_flip ? 'flip' : export_page)
  const b = (id: string, fn: () => void) => (box.querySelector('#' + id) as HTMLElement).addEventListener('click', fn)
  const scale_sel = box.querySelector('#ex_scale') as HTMLSelectElement
  scale_sel.value = String(exp_scale)
  scale_sel.addEventListener('change', () => {
    exp_scale = clamp(Number(scale_sel.value), 0.25, 3)
  })
  const alpha_btn = box.querySelector('#ex_alpha') as HTMLElement
  alpha_btn.classList.toggle('on', exp_alpha ? true : false)
  b('ex_alpha', () => {
    exp_alpha = exp_alpha ? 0 : 1
    alpha_btn.classList.toggle('on', exp_alpha ? true : false)
    sfx_play('tap')
  })
  const ab_btn_e = box.querySelector('#ex_ab') as HTMLElement | null
  if (ab_btn_e) {
    ab_btn_e.classList.toggle('on', exp_ab ? true : false)
    ab_btn_e.addEventListener('click', () => {
      exp_ab = exp_ab ? 0 : 1
      ab_btn_e.classList.toggle('on', exp_ab ? true : false)
      sfx_play('tap')
    })
  }
  b('ex_gif', () => {
    modal_close()
    export_gif()
  })
  b('ex_mp4', () => {
    modal_close()
    export_mp4()
  })
  b('ex_webm', () => {
    modal_close()
    export_webm()
  })
  b('ex_kwz', () => {
    modal_close()
    export_kwz_ui()
  })
  b('ex_ppm', () => {
    modal_close()
    export_ppm_ui()
  })
  b('ex_meta', () => {
    modal_close()
    modal_note_meta()
  })
  b('ex_png', () => {
    modal_close()
    export_png(exp_alpha)
  })
  b('ex_zip', () => {
    modal_close()
    export_zip(exp_alpha)
  })
  b('ex_ugn', () => {
    modal_close()
    file_save()
  })
  b('ex_close', modal_close)
  const preferred_button = preferred_flip === 'kwz' ? box.querySelector<HTMLElement>('#ex_kwz') : preferred_flip === 'ppm' ? box.querySelector<HTMLElement>('#ex_ppm') : null
  if (preferred_button) preferred_button.focus()
}
