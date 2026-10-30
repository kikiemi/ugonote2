import { pixel_source_bind, pixel_source_collect, type pixel_source_record_t } from './pixel_source'
import { memory_check, memory_work_budget } from './memory'
import { render_plan_bytes } from './render'
import { frame_export, type frame_export_input_t } from './frame_export'
import { video_encode, type video_encode_input_t } from './video_encode'
import { task_schedule } from './task_queue'
import { canvas_rebuild_async, type canvas_rebuild_input_t } from './canvas_rebuild'
import type { frame_t } from './h'
import { vid_import, type video_import_options_t } from './vid_import'
import type { render_plan_t } from './render'
import { kwz_build, type kwz_frame_t } from './codec/kwz'
import type { flip_meta_t } from './codec/kwzdec'
import { ppm_build, type ppm_frame_t } from './codec/ppm'
import { report_error, report_warning } from './diagnostics'
import { flip_image_convert, type flip_image_input_t, type flip_image_result_t } from './flipnote/image'
import { fmt_build_blob, type loaded_project_t, type proj_snap_t } from './fmt'
import { app_asset } from './runtime'

type worker_result_t = { sources?: pixel_source_record_t[], id: number, ok: number, bytes?: Uint8Array, image?: flip_image_result_t, pixels?: Uint8ClampedArray, error?: string, progress?: number, project?: loaded_project_t, fallback?: number, unavailable?: number, frames?: frame_t[], blob?: Blob, audio?: { pcm: Float32Array | null, sound?: import('./audio_mix').audio_mix_t } }
type pending_callback_t = (result: worker_result_t) => void

let worker: Worker | null = null
let worker_bad = 0
let worker_url = ''
let worker_timer = 0
let seq = 0
const pending = new Map<number, { done: pending_callback_t, progress?: (value: number) => void, heavy: number }>()

function worker_failure(error: unknown): void {
  clearTimeout(worker_timer)
  if (worker_url) { URL.revokeObjectURL(worker_url); worker_url = '' }
  report_error('変換Workerが停止しました', error)
  if (worker) worker.terminate()
  worker = null
  worker_bad = 1
  const message = error instanceof Error ? error.message : String(error)
  const callbacks = [...pending.values()]
  pending.clear()
  for (const callback of callbacks) {
    try { callback.done({ id: 0, ok: 0, error: message, unavailable: 1 }) } catch (caught) { report_error('Workerの終了処理に失敗しました', caught) }
  }
}

function ensure_worker(): Worker | null {
  if (worker_bad) return null
  if (worker) return worker
  try {
    const inline_source = (globalThis as { __ug2_worker_src?: string }).__ug2_worker_src
    if (inline_source) {
      worker_url = URL.createObjectURL(new Blob([inline_source], { type: 'text/javascript' }))
      worker = new Worker(worker_url)
    } else {
      worker = new Worker(app_asset('worker.js'))
    }
    worker.onmessage = (event: MessageEvent<worker_result_t>) => {
      clearTimeout(worker_timer)
      if (worker_url) { URL.revokeObjectURL(worker_url); worker_url = '' }
      const result = event.data
      if (result.sources) pixel_source_bind(result.sources)
      const callback = pending.get(result.id)
      if (!callback) {
        report_warning('対応する要求がないWorker応答を受け取りました', result.id)
        return
      }
      if (result.progress !== undefined) { callback.progress?.(result.progress); return }
      pending.delete(result.id)
      callback.done(result)
    }
    worker.onmessageerror = event => worker_failure(event.data || 'Worker messageerror')
    worker.onerror = event => {
      event.preventDefault()
      worker_failure(event.error || event.message)
    }
    worker_timer = setTimeout(() => worker_failure(new Error('変換Workerの応答がありません')), 15000)
    return worker
  } catch (error) {
    worker_failure(error)
    return null
  }
}

function post_worker(message: Record<string, unknown>, callback: pending_callback_t, transfers?: Transferable[], progress?: (value: number) => void): number {
  const heavy = message.kind === 'thumbnail' ? 0 : 1
  if (heavy && [...pending.values()].some(task => task.heavy)) {
    task_schedule(() => callback({ id: 0, ok: 0, error: '別の変換を処理中です。終わってからもう一度お試しください' }))
    return 1
  }
  const active_worker = ensure_worker()
  if (!active_worker) return 0
  const id = ++seq
  pending.set(id, { done: callback, progress, heavy })
  try {
    active_worker.postMessage({ ...message, id, sources: pixel_source_collect(message) }, transfers || [])
    return 1
  } catch (error) {
    pending.delete(id)
    worker_failure(error)
    return 0
  }
}

export type kwz_args_t = {
  frames: kwz_frame_t[]
  speed: number
  loop: number
  name: string
  thumb_jpeg: Uint8Array
  thumb_idx?: number
  bgm: Int16Array | null
  se: (Int16Array | null)[]
  meta?: flip_meta_t
}

export type ppm_args_t = {
  frames: ppm_frame_t[]
  speed: number
  loop: number
  name: string
  thumb: Uint8Array
  thumb_idx?: number
  bgm: Int16Array | null
  se: (Int16Array | null)[]
  meta?: flip_meta_t
}

function build_kwz_main(args: kwz_args_t, done: (bytes: Uint8Array | null, error: string) => void): void {
  kwz_build(args).then(
    bytes => done(bytes, ''),
    error => {
      report_error('KWZの生成に失敗しました', error)
      done(null, String(error))
    }
  )
}

function build_ppm_main(args: ppm_args_t, done: (bytes: Uint8Array | null, error: string) => void): void {
  ppm_build(args).then(
    bytes => done(bytes, ''),
    error => {
      report_error('PPMの生成に失敗しました', error)
      done(null, String(error))
    }
  )
}

function build_ugn2_main(snap: proj_snap_t, done: (bytes: Uint8Array | Blob | null) => void): void {
  task_schedule(() => {
    void fmt_build_blob(snap).then(done, error => {
      report_error('UGN2プロジェクトの生成に失敗しました', error)
      done(null)
    })
  })
}

export function build_kwz_async(args: kwz_args_t, done: (bytes: Uint8Array | null, error: string) => void): void {
  const posted = post_worker({ kind: 'kwz', ...args }, result => done(result.ok ? result.bytes || null : null, result.error || ''))
  if (!posted) build_kwz_main(args, done)
}

export function build_ppm_async(args: ppm_args_t, done: (bytes: Uint8Array | null, error: string) => void): void {
  const posted = post_worker({ kind: 'ppm', ...args }, result => done(result.ok ? result.bytes || null : null, result.error || ''))
  if (!posted) build_ppm_main(args, done)
}

export function build_ugn2_async(snap: proj_snap_t, done: (bytes: Uint8Array | Blob | null) => void): void {
  const transfer_set = new Set<ArrayBuffer>()
  for (const frame of snap.frames) for (const packed of frame.pk) if (packed) transfer_set.add(packed.buffer as ArrayBuffer)
  const transfers = [...transfer_set]
  const posted = post_worker({ kind: 'ugn2', snap }, result => done(result.ok ? result.blob || result.bytes || null : null), transfers)
  if (!posted) build_ugn2_main(snap, done)
}

function convert_flip_image_main(input: flip_image_input_t, done: (result: flip_image_result_t | null, error: string) => void): void {
  task_schedule(() => {
    try {
      done(flip_image_convert(input), '')
    } catch (error) {
      report_error('画像をうごメモへ変換できませんでした', error)
      done(null, String(error))
    }
  })
}

export function convert_flip_image_async(input: flip_image_input_t, done: (result: flip_image_result_t | null, error: string) => void): void {
  const worker_input: flip_image_input_t = { ...input, pixels: input.pixels.slice() }
  const posted = post_worker(
    { kind: 'flip-image', input: worker_input },
    result => done(result.ok ? result.image || null : null, result.error || ''),
    [worker_input.pixels.buffer]
  )
  if (!posted) convert_flip_image_main(input, done)
}


export function render_thumbnail_async(plan: render_plan_t, w: number, h: number, done: (pixels: Uint8ClampedArray | null) => void): number {
  return post_worker({ kind: 'thumbnail', plan, w, h }, result => done(result.ok && result.pixels ? result.pixels : null))
}

export function import_video_async(file: File, options: video_import_options_t, progress: (value: number) => void): Promise<loaded_project_t> {
  options = { ...options, work_bytes: options.work_bytes || memory_work_budget() }
  return new Promise((resolve, reject) => {
    const fallback = (): void => { void vid_import(file, options, progress).then(resolve, reject) }
    const posted = post_worker({ kind: 'video', file, options }, result => {
      if (result.fallback) fallback()
      else if (result.ok && result.project) resolve(result.project)
      else reject(new Error(result.error || '動画を読み込めませんでした'))
    }, undefined, progress)
    if (!posted) fallback()
  })
}

export function rebuild_canvas_async(input: canvas_rebuild_input_t, progress: (value: number) => void): Promise<frame_t[]> {
  input = { ...input, budget: input.budget || memory_work_budget() }
  return new Promise((resolve, reject) => {
    const fallback = (): void => { void canvas_rebuild_async(input, progress).then(resolve, reject) }
    if (typeof OffscreenCanvas === 'undefined') { fallback(); return }
    const posted = post_worker({ kind: 'resize', input }, result => {
      if (result.ok && result.frames) resolve(result.frames)
      else reject(new Error(result.error || 'キャンバスを作り変えられませんでした'))
    }, undefined, progress)
    if (!posted) fallback()
  })
}

export function encode_video_async(input: video_encode_input_t, progress: (value: number) => void): Promise<Blob> {
  input = { ...input, budget: input.budget || memory_work_budget() }
  return new Promise((resolve, reject) => {
    const audio_bytes = input.sound?.tracks.reduce((bytes, track) => bytes + track.channels.reduce((sum, channel) => sum + channel.byteLength, 0), 0) || input.pcm?.byteLength || 0
    memory_check(render_plan_bytes(input.plans || []) * 2 + audio_bytes * 2 + input.w * input.h * 16, input.budget!)
    const fallback = (): void => { void video_encode(input, progress).then(resolve, reject) }
    if (typeof OffscreenCanvas === 'undefined') { fallback(); return }
    const posted = post_worker({ kind: 'encode-video', input }, result => {
      if (result.unavailable) { const error = new Error(result.error || '変換Workerを開始できませんでした'); error.name = 'WorkerError'; reject(error) }
      else if (result.audio) {
        input.pcm = result.audio.pcm; input.sound = result.audio.sound
        if (/メモリ|大きすぎ|応答がありません/.test(result.error || '')) reject(new Error(result.error))
        else fallback()
      }
      else if (result.ok && result.blob) resolve(result.blob)
      else reject(new Error(result.error || '動画を書き出せませんでした'))
    }, [...new Set<ArrayBuffer>([...(input.pcm ? [input.pcm.buffer as ArrayBuffer] : []), ...(input.sound?.tracks.flatMap(track => track.channels.map(channel => channel.buffer as ArrayBuffer)) || [])])], progress)
    if (!posted) fallback()
  })
}

export function export_frames_async(input: frame_export_input_t, progress: (value: number) => void): Promise<Blob> {
  input = { ...input, budget: input.budget || memory_work_budget() }
  return new Promise((resolve, reject) => {
    memory_check(render_plan_bytes(input.plans || []) * 2 + input.w * input.h * 12, input.budget!)
    const fallback = (): void => { void frame_export(input, progress).then(resolve, reject) }
    if (typeof OffscreenCanvas === 'undefined') { fallback(); return }
    const transfers = new Set<ArrayBuffer>()
    for (const image of input.images || []) transfers.add(image.data.buffer as ArrayBuffer)
    for (const entry of input.entries || []) transfers.add(entry.data.buffer as ArrayBuffer)
    const posted = post_worker({ kind: 'export-frames', input }, result => {
      if (result.ok && result.blob) resolve(result.blob)
      else reject(new Error(result.error || '画像を書き出せませんでした'))
    }, [...transfers], progress)
    if (!posted) fallback()
  })
}
