import { kwz_build, type KwzFrame } from './codec/kwz'
import type { FlipMeta } from './codec/kwzdec'
import { ppm_build, type PpmFrame } from './codec/ppm'
import { report_error, report_warning } from './diagnostics'
import { flip_image_convert, type FlipImageInput, type FlipImageResult } from './flipnote/image'
import { fmt_build, type ProjSnap } from './fmt'

type WorkerResult = { id: number, ok: number, bytes?: Uint8Array, image?: FlipImageResult, error?: string }
type PendingCallback = (result: WorkerResult) => void

let worker: Worker | null = null
let workerBad = 0
let seq = 0
const pending = new Map<number, PendingCallback>()

function worker_failure(error: unknown): void {
  report_error('変換Workerが停止しました', error)
  if (worker) worker.terminate()
  worker = null
  workerBad = 1
  const message = error instanceof Error ? error.message : String(error)
  for (const callback of pending.values()) callback({ id: 0, ok: 0, error: message })
  pending.clear()
}

function ensure_worker(): Worker | null {
  if (workerBad) return null
  if (worker) return worker
  try {
    const inlineSource = (globalThis as { __UG2_WORKER_SRC?: string }).__UG2_WORKER_SRC
    if (inlineSource) {
      const url = URL.createObjectURL(new Blob([inlineSource], { type: 'text/javascript' }))
      worker = new Worker(url)
      URL.revokeObjectURL(url)
    } else {
      worker = new Worker('./dist/worker.js')
    }
    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      const result = event.data
      const callback = pending.get(result.id)
      if (!callback) {
        report_warning('対応する要求がないWorker応答を受け取りました', result.id)
        return
      }
      pending.delete(result.id)
      callback(result)
    }
    worker.onmessageerror = event => worker_failure(event.data || 'Worker messageerror')
    worker.onerror = event => {
      event.preventDefault()
      worker_failure(event.error || event.message)
    }
    return worker
  } catch (error) {
    worker_failure(error)
    return null
  }
}

function post_worker(message: Record<string, unknown>, callback: PendingCallback, transfers?: Transferable[]): number {
  const activeWorker = ensure_worker()
  if (!activeWorker) return 0
  const id = ++seq
  pending.set(id, callback)
  try {
    activeWorker.postMessage({ ...message, id }, transfers || [])
    return 1
  } catch (error) {
    pending.delete(id)
    worker_failure(error)
    return 0
  }
}

export type KwzArgs = {
  frames: KwzFrame[]
  speed: number
  loop: number
  name: string
  thumbJpeg: Uint8Array
  thumbIdx?: number
  bgm: Int16Array | null
  se: (Int16Array | null)[]
  meta?: FlipMeta
}

export type PpmArgs = {
  frames: PpmFrame[]
  speed: number
  loop: number
  name: string
  thumb: Uint8Array
  thumbIdx?: number
  bgm: Int16Array | null
  se: (Int16Array | null)[]
  meta?: FlipMeta
}

function build_kwz_main(args: KwzArgs, done: (bytes: Uint8Array | null, error: string) => void): void {
  kwz_build(args).then(
    bytes => done(bytes, ''),
    error => {
      report_error('KWZの生成に失敗しました', error)
      done(null, String(error))
    }
  )
}

function build_ppm_main(args: PpmArgs, done: (bytes: Uint8Array | null, error: string) => void): void {
  ppm_build(args).then(
    bytes => done(bytes, ''),
    error => {
      report_error('PPMの生成に失敗しました', error)
      done(null, String(error))
    }
  )
}

function build_ugn2_main(snap: ProjSnap, done: (bytes: Uint8Array | null) => void): void {
  setTimeout(() => {
    try {
      done(fmt_build(snap))
    } catch (error) {
      report_error('UGN2プロジェクトの生成に失敗しました', error)
      done(null)
    }
  }, 0)
}

export function build_kwz_async(args: KwzArgs, done: (bytes: Uint8Array | null, error: string) => void): void {
  const posted = post_worker({ kind: 'kwz', ...args }, result => done(result.ok ? result.bytes || null : null, result.error || ''))
  if (!posted) build_kwz_main(args, done)
}

export function build_ppm_async(args: PpmArgs, done: (bytes: Uint8Array | null, error: string) => void): void {
  const posted = post_worker({ kind: 'ppm', ...args }, result => done(result.ok ? result.bytes || null : null, result.error || ''))
  if (!posted) build_ppm_main(args, done)
}

export function build_ugn2_async(snap: ProjSnap, done: (bytes: Uint8Array | null) => void): void {
  const transfers: ArrayBuffer[] = []
  for (const frame of snap.frames) for (const packed of frame.pk) if (packed) transfers.push(packed.buffer as ArrayBuffer)
  const posted = post_worker({ kind: 'ugn2', snap }, result => done(result.ok && result.bytes ? result.bytes : null), transfers)
  if (!posted) build_ugn2_main(snap, done)
}

function convert_flip_image_main(input: FlipImageInput, done: (result: FlipImageResult | null, error: string) => void): void {
  setTimeout(() => {
    try {
      done(flip_image_convert(input), '')
    } catch (error) {
      report_error('画像をうごメモへ変換できませんでした', error)
      done(null, String(error))
    }
  }, 0)
}

export function convert_flip_image_async(input: FlipImageInput, done: (result: FlipImageResult | null, error: string) => void): void {
  const workerInput: FlipImageInput = { ...input, pixels: input.pixels.slice() }
  const posted = post_worker(
    { kind: 'flip-image', input: workerInput },
    result => done(result.ok ? result.image || null : null, result.error || ''),
    [workerInput.pixels.buffer]
  )
  if (!posted) convert_flip_image_main(input, done)
}

