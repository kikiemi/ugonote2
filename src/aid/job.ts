// 2つのコマのあいだの絵を AI で作る仕事。GPU があれば画面の側で、なければ Worker の中で動かす。

import type { rle_t } from '../h'
import { rle_pack, rle_unpack } from '../pixel'
import { between_pixels } from './between'
import { flow_read } from './motion'
import { motion_net_fast, motion_net_open, type motion_net_t } from './motion_net'

// レイヤー1枚 (下から順にならべる)。a が前のコマ、b が後のコマの絵。alpha は濃さ (0〜1)。move が 0 なら、見えている絵を作るだけに使う。
export type aid_layer_t = { a: rle_t | null, b: rle_t | null, alpha: number, move: number }
// paper は紙の色 (r, g, b)。times は作る時間 (0〜1)。least より動きで説明できないコマは作らない。
export type aid_input_t = { weights: ArrayBuffer, w: number, h: number, paper: number[], layers: aid_layer_t[], times: number[], least: number }
// packs は move のレイヤーの順に times の数ずつならぶ (作らなかったときは空)。
// score は2枚のちがいが動きで説明できた割合 (同じ絵なら -1)。
export type aid_output_t = { packs: (rle_t | null)[], score: number }

export type aid_progress_t = (value: number) => void

// AI にわたす絵の長い辺の点の数。GPU があるときと CPU で動かすとき。
const gpu_side = 512
const cpu_side = 256

// 開いた AI (1度だけ開く)。
let net_open: Promise<motion_net_t> | null = null

function net_get(weights: ArrayBuffer): Promise<motion_net_t> {
  if (!net_open) net_open = motion_net_open(weights)
  return net_open
}

// つめた絵を点へもどす (なければ透明)。
function unpack_into(pk: rle_t | null, out: Uint32Array): void {
  if (!pk) {
    out.fill(0)
    return
  }
  if (rle_unpack(pk, out) !== out.length) throw new Error('絵を読めませんでした')
}

// 絵が1点でもあるか。
function any_ink(px: Uint32Array): number {
  for (let i = 0; i < px.length; i++) if (px[i] >>> 24) return 1
  return 0
}

// 絵 px を濃さ alpha で out の上に重ねる。
function over_paper(px: Uint32Array, alpha: number, out: Uint32Array): void {
  for (let i = 0; i < out.length; i++) {
    const word = px[i]
    const a = (word >>> 24) / 255 * alpha
    if (a <= 0) continue
    const low = out[i]
    const r = (word & 255) * a + (low & 255) * (1 - a)
    const g = (word >>> 8 & 255) * a + (low >>> 8 & 255) * (1 - a)
    const b = (word >>> 16 & 255) * a + (low >>> 16 & 255) * (1 - a)
    out[i] = (0xff000000 | Math.round(b) << 16 | Math.round(g) << 8 | Math.round(r)) >>> 0
  }
}

// 見えている絵を作る。second が 0 なら前のコマ、1 なら後のコマ。
function seen_image(input: aid_input_t, second: number, scratch: Uint32Array, out: Uint32Array): void {
  const paper = input.paper
  out.fill((0xff000000 | paper[2] << 16 | paper[1] << 8 | paper[0]) >>> 0)
  for (let l = 0; l < input.layers.length; l++) {
    const layer = input.layers[l]
    const pk = second ? layer.b : layer.a
    if (!pk || layer.alpha <= 0) continue
    unpack_into(pk, scratch)
    over_paper(scratch, layer.alpha, out)
  }
}

export async function aid_run(input: aid_input_t, progress: aid_progress_t): Promise<aid_output_t> {
  // Worker が動いていることを、はじめに知らせる。
  progress(0)
  const net = await net_get(input.weights)
  const w = input.w
  const h = input.h
  const a = new Uint32Array(w * h)
  const b = new Uint32Array(w * h)
  const out = new Uint32Array(w * h)
  seen_image(input, 0, out, a)
  seen_image(input, 1, out, b)
  const f = await flow_read(net, a, b, w, h, motion_net_fast(net) ? gpu_side : cpu_side)
  const packs: (rle_t | null)[] = []
  if (f.score < input.least) return { packs, score: f.score }
  // 見えている絵全体の動きで、どのレイヤーも同じように動かす (線と塗りがずれないように)。
  for (let l = 0; l < input.layers.length; l++) {
    const layer = input.layers[l]
    if (!layer.move) continue
    unpack_into(layer.a, a)
    unpack_into(layer.b, b)
    for (let k = 0; k < input.times.length; k++) {
      between_pixels(a, b, f, input.times[k], w, h, out)
      packs.push(any_ink(out) ? rle_pack(out) : null)
    }
    progress((l + 1) / input.layers.length)
  }
  return { packs, score: f.score }
}
