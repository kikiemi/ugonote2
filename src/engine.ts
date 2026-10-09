import { L_N, type Rle } from './h'
import { rle_unpack } from './pixel'

const live: (HTMLCanvasElement | null)[] = new Array(L_N).fill(null)
const lctx: (CanvasRenderingContext2D | null)[] = new Array(L_N).fill(null)
const refs: (Rle | null)[] = new Array(L_N).fill(null)
const changed = new Uint8Array(L_N)
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
  for (let l = 0; l < L_N; l++) live_drop(l)
  refs.fill(null)
  width = w
  height = h
}

export function live_bind(packed: readonly (Rle | null)[]): void {
  for (let l = 0; l < L_N; l++) {
    const next = packed[l] || null
    if (refs[l] !== next || changed[l]) live_drop(l)
    refs[l] = next
  }
}

export function live_slot(l: number): CanvasRenderingContext2D {
  if (!Number.isInteger(l) || l < 0 || l >= L_N) throw new RangeError('Invalid live layer')
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

export function live_accept(l: number, packed: Rle | null): void {
  refs[l] = packed
  changed[l] = 0
  for (let i = 0; i < L_N; i++) if (i !== l && !changed[i]) live_drop(i)
}

export function live_peek(l: number): HTMLCanvasElement | null {
  return live[l]
}

export function live_canvas(l: number): HTMLCanvasElement {
  return live_slot(l).canvas
}

export function live_count(): number {
  return L_N
}

export function live_bytes(): number {
  let bytes = 0
  for (const canvas of live) if (canvas) bytes += canvas.width * canvas.height * 4
  return bytes
}

let clipImg: HTMLCanvasElement | null = null
let floImg: HTMLCanvasElement | null = null
const sndBufs = new Map<string, AudioBuffer>()

export function clip_img(): HTMLCanvasElement | null {
  return clipImg
}

export function clip_img_set(c: HTMLCanvasElement | null): void {
  clipImg = c
}

export function flo_img(): HTMLCanvasElement | null {
  return floImg
}

export function flo_img_set(c: HTMLCanvasElement | null): void {
  floImg = c
}

export function snd_buf(kind: string): AudioBuffer | null {
  return sndBufs.get(kind) || null
}

export function snd_buf_set(kind: string, buf: AudioBuffer | null): void {
  if (buf) sndBufs.set(kind, buf)
  else sndBufs.delete(kind)
}
