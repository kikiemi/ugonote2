// 2枚の絵のあいだの絵 (中割り) を作る。絵は動きに合わせてずらしてからまぜる。
// 片方にしかない線は、近いほうの絵だけから取る (うすい線が2本ならぶ二重の絵にならないように)。

import { flow_through, type flow_t } from './motion'

// 動きの緩急。
export const ease_even = 0
export const ease_slow_end = 1
export const ease_slow_start = 2
export const ease_slow_both = 3

// 2枚の色か濃さがこれ以上ちがう所は、近いほうの絵へ切りかえはじめる (線がうすくならないよう、すぐ切りかえる)。
const split_from = 0.04
// 切りかえおわるまでのちがいの幅。
const split_width = 0.08

const move = new Float32Array(2)
const near_a = new Float32Array(4)
const near_b = new Float32Array(4)
const mixed = new Float32Array(4)

// 時間 t (0〜1) のときの、動きの進み具合 (0〜1)。
export function ease_at(kind: number, t: number): number {
  if (kind === ease_slow_end) return 1 - (1 - t) * (1 - t)
  if (kind === ease_slow_start) return t * t
  if (kind === ease_slow_both) return t * t * (3 - 2 * t)
  return t
}

// 点 (x, y) の色を、まわりの 4 点からなめらかに求めて out へ入れる (r, g, b にアルファをかけた形、0〜1)。
function sample_rgba(px: Uint32Array, w: number, h: number, x: number, y: number, out: Float32Array): void {
  out[0] = 0
  out[1] = 0
  out[2] = 0
  out[3] = 0
  const u = x - 0.5
  const v = y - 0.5
  const x0 = Math.floor(u)
  const y0 = Math.floor(v)
  const fx = u - x0
  const fy = v - y0
  for (let k = 0; k < 4; k++) {
    const sx = x0 + (k & 1)
    const sy = y0 + (k >> 1)
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue
    const word = px[sy * w + sx]
    if (!word) continue
    const weight = (k & 1 ? fx : 1 - fx) * (k >> 1 ? fy : 1 - fy) * (word >>> 24) / 255
    out[0] += (word & 255) / 255 * weight
    out[1] += (word >>> 8 & 255) / 255 * weight
    out[2] += (word >>> 16 & 255) / 255 * weight
    out[3] += weight
  }
}

// sample_rgba の形の色を、RGBA の点にする。
function sample_word(s: Float32Array): number {
  const alpha = s[3]
  if (alpha < 1 / 255) return 0
  const red = Math.round(Math.min(1, s[0] / alpha) * 255)
  const green = Math.round(Math.min(1, s[1] / alpha) * 255)
  const blue = Math.round(Math.min(1, s[2] / alpha) * 255)
  return (Math.round(alpha * 255) << 24 | blue << 16 | green << 8 | red) >>> 0
}

// a から b へ t (0〜1) だけ進んだ絵を out へ作る。f は動きのマップ。
export function between_pixels(a: Uint32Array, b: Uint32Array, f: flow_t, t: number, w: number, h: number, out: Uint32Array): void {
  const nearest = t <= 0.5 ? 0 : 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      flow_through(f, x + 0.5, y + 0.5, t, move)
      sample_rgba(a, w, h, x + 0.5 - move[0] * t, y + 0.5 - move[1] * t, near_a)
      sample_rgba(b, w, h, x + 0.5 + move[0] * (1 - t), y + 0.5 + move[1] * (1 - t), near_b)
      let gap = 0
      for (let c = 0; c < 4; c++) gap = Math.max(gap, Math.abs(near_a[c] - near_b[c]))
      const split = Math.max(0, Math.min(1, (gap - split_from) / split_width))
      const mix = t * (1 - split) + nearest * split
      for (let c = 0; c < 4; c++) mixed[c] = near_a[c] * (1 - mix) + near_b[c] * mix
      out[y * w + x] = sample_word(mixed)
    }
  }
}
