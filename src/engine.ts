import { L_N } from './h'

const live: HTMLCanvasElement[] = []
const lctx: CanvasRenderingContext2D[] = []

export function live_make(w: number, h: number): void {
  live.length = 0
  lctx.length = 0
  for (let i = 0; i < L_N; i++) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
    x.imageSmoothingEnabled = false
    live.push(c)
    lctx.push(x)
  }
}

export function live_slot(l: number): CanvasRenderingContext2D {
  return lctx[l]
}

export function live_canvas(l: number): HTMLCanvasElement {
  return live[l]
}

export function live_count(): number {
  return live.length
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
