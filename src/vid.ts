import { pixel_source_prepare, pixel_source_ready } from './pixel_source'
import { memory_check, memory_work_budget } from './memory'
import { task_timeout } from './task_queue'
import { video_encode, video_encode_config, type video_encode_input_t } from './video_encode'
import { encode_video_async } from './workercli'
import { doc_render_plan } from './doc'
import { animfx_active } from './animfx'
import { snd_buf } from './engine'
import { animout_compose, animout_jobs, animout_ticks } from './animout'
import { report_error } from './diagnostics'
import { canvas_make } from './lib'
import { snd_export_dest, snd_mix_plan, snd_ready, type sound_export_destination_t } from './snd'
import { dispatch } from './state/commands/index'
import { anim_tick_starts } from './state/commands/play'
import { st, project_revision } from './state/store'

function pick_mime(): string {
  const list = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  for (const m of list) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m
  return ''
}

function pick_mp4_mime(): string {
  const list = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2']
  for (const m of list) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m
  return ''
}

export function vid_supported(): number {
  return typeof VideoEncoder !== 'undefined' || typeof MediaRecorder !== 'undefined' && pick_mime() ? 1 : 0
}

export function vid_mp4_mode(): number {
  const wc = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
  if (wc) return 2
  if (pick_mp4_mime()) return 1
  return 0
}

function even(v: number): number {
  const n = Math.round(v)
  return n % 2 ? n + 1 : n
}

function need_audio(): number {
  const g = st()
  if (g.snd.bgm.some(slot => slot.bytes)) return 1
  for (const frame of g.doc.frames) for (let i = 0; i < 4; i++) if ((frame.se & (1 << i)) && g.snd.se[i].bytes) return 1
  return 0
}

function audio_ready(): number {
  const g = st()
  for (let i = 0; i < 2; i++) if (g.snd.bgm[i].bytes && !snd_buf('bgm' + i)) return 0
  for (const frame of g.doc.frames) for (let i = 0; i < 4; i++) if ((frame.se & (1 << i)) && g.snd.se[i].bytes && !snd_buf('se' + i)) return 0
  return 1
}

function media_export(mime: string, scale: number, on_progress: (progress: number) => void, done: (blob: Blob | null) => void): void {
  if (!audio_ready()) {
    done(null)
    return
  }
  dispatch('frame.sync_live', null)
  const g = st()
  const fps = g.doc.fps
  const starts = anim_tick_starts()
  const jobs = animout_jobs(g.doc.frames, 0, g.doc.frames.length - 1, fps, g.doc.anim, 0)
  const ticks = animout_ticks(jobs)
  const width = even(g.doc.w * scale)
  const height = even(g.doc.h * scale)
  const budget = memory_work_budget(g.mobile)
  try { memory_check(width * height * 16, budget) } catch { done(null); return }
  const [canvas, context] = canvas_make(width, height)
  if (!jobs.length || ticks < 1) {
    canvas.width = 0
    done(null)
    return
  }
  animout_compose(jobs[0], context, width, height, 1, fps, g.doc.anim)
  if (typeof canvas.captureStream !== 'function') {
    canvas.width = 0
    done(null)
    return
  }
  const stream = canvas.captureStream(Math.min(60, Math.max(10, fps * 2)))
  let audio: sound_export_destination_t | null = null
  if (need_audio()) {
    audio = snd_export_dest(starts.map(tick => tick / fps), ticks / fps)
    if (!audio) {
      for (const track of stream.getTracks()) track.stop()
      done(null)
      return
    }
    for (const track of audio.node.stream.getAudioTracks()) stream.addTrack(track)
  }

  let recorder: MediaRecorder | null = null
  const choices = mime.startsWith('video/mp4') ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'] : [mime]
  let failure: unknown = null
  for (const candidate of choices) {
    if (!MediaRecorder.isTypeSupported(candidate)) continue
    try { recorder = new MediaRecorder(stream, { mimeType: candidate, videoBitsPerSecond: Math.max(800000, Math.min(16000000, Math.round(width * height * fps * 0.12))) }); break }
    catch (error) { failure = error }
  }
  if (!recorder) {
    report_error('動画レコーダーを開始できませんでした', failure)
    if (audio) audio.end()
    for (const track of stream.getTracks()) track.stop()
    canvas.width = 0
    done(null)
    return
  }
  const active_recorder = recorder

  let finished = 0, bytes = 0
  let stop_timer = 0
  const chunks: Blob[] = []
  const finish = (blob: Blob | null): void => {
    if (finished) return
    finished = 1
    clearTimeout(stop_timer)
    document.removeEventListener('visibilitychange', visibility)
    if (audio) audio.end()
    if (active_recorder.state !== 'inactive') { try { active_recorder.stop() } catch {} }
    for (const track of stream.getTracks()) track.stop()
    canvas.width = 0
    chunks.length = 0
    done(blob)
  }

  const visibility = (): void => { if (document.hidden) finish(null) }
  document.addEventListener('visibilitychange', visibility)
  active_recorder.ondataavailable = event => {
    if (finished) return
    bytes += event.data.size
    if (bytes > budget / 2) { finish(null); return }
    if (event.data.size > 0) chunks.push(event.data)
  }
  active_recorder.onstop = () => finish(bytes ? new Blob(chunks, { type: mime.split(';')[0] }) : null)
  active_recorder.onerror = event => {
    report_error('動画の録画中にエラーが発生しました', event)
    finish(null)
  }

  const started_at = performance.now() + 50
  try {
    active_recorder.start(250)
    if (audio && !audio.begin()) {
      finish(null)
      if (active_recorder.state !== 'inactive') active_recorder.stop()
      return
    }
  } catch (error) {
    report_error('動画の録画を開始できませんでした', error)
    finish(null)
    return
  }

  let current_job = -1
  const tick = (): void => {
    if (finished) return
    const elapsed = performance.now() - started_at
    const wanted_job = Math.min(jobs.length - 1, Math.max(0, Math.floor((elapsed / 1000) * fps)))
    if (wanted_job !== current_job) {
      current_job = wanted_job
      try {
        if (!pixel_source_ready(g.doc.frames[jobs[wanted_job].frame])) throw new Error('動画のコマの準備が録画に追いつきません。WebCodecs対応環境で書き出してください')
        animout_compose(jobs[wanted_job], context, width, height, 1, fps, g.doc.anim)
        const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
        if (typeof track?.requestFrame === 'function') track.requestFrame()
      } catch (error) { report_error('動画のコマを描画できませんでした', error); finish(null); return }
      if (wanted_job + 1 < jobs.length) void pixel_source_prepare(g.doc.frames[jobs[wanted_job + 1].frame]).catch(() => {})
      on_progress((wanted_job + 1) / jobs.length)
    }
    if (elapsed >= (ticks / fps) * 1000) {
      if (active_recorder.state !== 'inactive') {
        stop_timer = setTimeout(() => finish(null), 15000)
        try { active_recorder.stop() } catch { finish(null) }
      } else finish(null)
      return
    }
    setTimeout(tick, 16)
  }
  setTimeout(tick, 0)
}

function video_export(format: 'mp4' | 'webm', scale: number, on_progress: (progress: number) => void, done: (blob: Blob | null, note: string) => void): void {
  let finished = 0
  const finish = (blob: Blob | null, note: string): void => { if (!finished) { finished = 1; done(blob, note) } }
  const fallback = (): void => {
    const mime = format === 'mp4' ? pick_mp4_mime() : pick_mime()
    if (!mime) { finish(null, 'この環境は動画の書き出しに未対応です'); return }
    void task_timeout(ready, 10000).then(() => {
      try { media_export(mime, scale, on_progress, blob => finish(blob, blob ? '' : '動画を書き出せませんでした。録画中はこの画面を表示してください')) }
      catch (error) { report_error('動画の録画に失敗しました', error); finish(null, '動画を録画できませんでした') }
    }, () => finish(null, '音声を開始できませんでした。音を再生してからもう一度お試しください'))
  }
  if (!audio_ready()) { finish(null, '音声の準備ができていません'); return }
  dispatch('frame.sync_live', null)
  const g = st(), revision = project_revision(), fps = g.doc.fps, fx = { ...g.doc.anim }
  const starts = anim_tick_starts()
  const jobs = animout_jobs(g.doc.frames, 0, g.doc.frames.length - 1, fps, fx, 1)
  const ticks = animout_ticks(jobs)
  const width = even(g.doc.w * scale), height = even(g.doc.h * scale)
  const audio = need_audio(), budget = memory_work_budget(g.mobile)
  const ready = audio ? new Promise<void>(resolve => snd_ready(resolve)) : Promise.resolve()
  const plans = animfx_active(fx) ? null : g.doc.frames.map((_, i) => doc_render_plan(i, 1, 0))
  const run = async (): Promise<void> => {
    try {
      memory_check(width * height * 16, budget)
      const supported = await task_timeout(video_encode_config(width, height, fps, format, audio ? 44100 : 0), 15000)
      if (revision !== project_revision()) throw new Error('作品が変わったため書き出しを中止しました')
      if (!supported) { await pixel_source_prepare(g.doc.frames[jobs[0].frame]); fallback(); return }
      const input: video_encode_input_t = { w: width, h: height, fps, holds: jobs.map(job => job.hold), format, pcm: null, audio_rate: audio ? 44100 : 0, budget }
      if (audio) input.sound = snd_mix_plan(ticks / fps, starts.map(tick => tick / fps))
      let blob: Blob
      if (plans) {
        input.plans = plans
        input.frames = jobs.map(job => job.frame)
        try { blob = await encode_video_async(input, on_progress) }
        catch (error) {
          if (!(error instanceof Error) || error.name !== 'WorkerError') throw error
          if (revision !== project_revision()) throw new Error('作品が変わったため書き出しを中止しました')
          if (audio) input.sound = snd_mix_plan(ticks / fps, starts.map(tick => tick / fps))
          blob = await video_encode(input, on_progress)
        }
      } else blob = await video_encode(input, on_progress, async (index, context) => { await pixel_source_prepare(g.doc.frames[jobs[index].frame]); if (revision !== project_revision()) throw new Error('作品が変わったため書き出しを中止しました'); animout_compose(jobs[index], context as CanvasRenderingContext2D, width, height, 1, fps, fx) })
      finish(blob, '')
    } catch (error) {
      report_error('動画の書き出しに失敗しました', error)
      const note = error instanceof Error ? error.message : String(error)
      if (/メモリ|大きすぎ|別の変換|作品が変わった/.test(note)) finish(null, note)
      else fallback()
    }
  }
  void run()
}

export function vid_export(scale: number, on_progress: (progress: number) => void, done: (blob: Blob | null) => void): void {
  video_export('webm', scale, on_progress, blob => done(blob))
}

export function vid_export_mp4(scale: number, on_progress: (progress: number) => void, done: (blob: Blob | null, note: string) => void): void {
  video_export('mp4', scale, on_progress, done)
}
