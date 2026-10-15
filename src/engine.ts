import { pixel_source_is, pixel_source_peek, pixel_source_prepare } from './pixel_source'
import { l_n, type rle_t } from './h'
import { rle_unpack } from './pixel'

const live: (HTMLCanvasElement | null)[] = new Array(l_n).fill(null)
const lctx: (CanvasRenderingContext2D | null)[] = new Array(l_n).fill(null)
const refs: (rle_t | null)[] = new Array(l_n).fill(null)
const changed = new Uint8Array(l_n)
let width = 0
let height = 0

export function live_drop(l: number): void {
  const canvas = live[l]
  if (canvas) { canvas.width = 0; canvas.height = 0 }
  live[l] = null
  lctx[l] = null
  changed[l] = 0
}

export function live_make(w: number, h: number): void {
  for (let l = 0; l < l_n; l++) live_drop(l)
  refs.fill(null)
  width = w
  height = h
}

export function live_bind(packed: readonly (rle_t | null)[]): void {
  for (let l = 0; l < l_n; l++) {
    const next = packed[l] || null
    if (refs[l] !== next || changed[l]) live_drop(l)
    refs[l] = next
  }
}

export function live_slot(l: number): CanvasRenderingContext2D {
  if (!Number.isInteger(l) || l < 0 || l >= l_n) throw new RangeError('Invalid live layer')
  const source = refs[l]
  if (source && pixel_source_is(source) && !pixel_source_peek(source)) { void pixel_source_prepare(source).catch(() => {}); throw new Error('動画のコマを準備中です。表示されてから操作してください') }
  const hit = lctx[l]
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  context.imageSmoothingEnabled = false
  const packed = refs[l]
  if (packed) {
    const image = context.createImageData(width, height)
    if (rle_unpack(packed, new Uint32Array(image.data.buffer)) === width * height) context.putImageData(image, 0, 0)
  }
  live[l] = canvas
  lctx[l] = context
  return context
}

export function live_write(l: number): CanvasRenderingContext2D {
  const context = live_slot(l)
  changed[l] = 1
  return context
}

export function live_changed(l: number): number {
  return changed[l]
}

export function live_accept(l: number, packed: rle_t | null): void {
  refs[l] = packed
  changed[l] = 0
  for (let i = 0; i < l_n; i++) if (i !== l && !changed[i]) live_drop(i)
}

export function live_peek(l: number): HTMLCanvasElement | null {
  return live[l]
}

export function live_canvas(l: number): HTMLCanvasElement {
  return live_slot(l).canvas
}

export function live_count(): number {
  return l_n
}

export function live_bytes(): number {
  let bytes = 0
  for (const canvas of live) if (canvas) bytes += canvas.width * canvas.height * 4
  return bytes
}

let clipboard_image: HTMLCanvasElement | null = null
let floating_image: HTMLCanvasElement | null = null
const snd_bufs = new Map<string, AudioBuffer>()

export function clip_img(): HTMLCanvasElement | null {
  return clipboard_image
}

export function clip_img_set(c: HTMLCanvasElement | null): void {
  clipboard_image = c
}

export function flo_img(): HTMLCanvasElement | null {
  return floating_image
}

export function flo_img_set(c: HTMLCanvasElement | null): void {
  floating_image = c
}

export function snd_buf(kind: string): AudioBuffer | null {
  return snd_bufs.get(kind) || null
}

export function snd_buf_set(kind: string, buf: AudioBuffer | null): void {
  if (buf) snd_bufs.set(kind, buf)
  else snd_bufs.delete(kind)
}
