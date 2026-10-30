// プロジェクトのコマが、うごメモの色と形だけで描かれていれば、色を近づけなおさずに、そのままうごメモのコマにする。

import type { rle_t } from '../h'
import { rle_unpack } from '../lib'
import { kwz_colors, kwz_layer_pairs, ppm_colors, rgba_word, type rgb_t } from './color'

// コマをほどくための作業用の場所 (点の数ぶん)。コマごとに作りなおさないように、使いまわす。
export type native_frame_scratch_t = {
  words: Uint32Array
}

// PPM のコマ。layers はレイヤーごとの点 (1 が点)、pens はレイヤーごとのペンの番号。
export type native_ppm_frame_t = {
  layers: [Uint8Array, Uint8Array]
  pens: [number, number]
}

// KWZ のコマ。layers はレイヤーごとの点 (0 は空、1 と 2 はそのレイヤーの2色)、colors はレイヤーごとの2色の番号。
export type native_kwz_frame_t = {
  layers: [Uint8Array, Uint8Array, Uint8Array]
  colors: [number, number][]
}

// 色の表を、つめた RGBA の値の表にする。
function words_of(colors: readonly rgb_t[]): Uint32Array {
  const out = new Uint32Array(colors.length)
  for (let index = 0; index < colors.length; index++) out[index] = rgba_word(colors[index])
  return out
}

// うごメモの色の、つめた RGBA の値。
const ppm_words = words_of(ppm_colors)
const kwz_words = words_of(kwz_colors)

// pixel_count 点ぶんの作業用の場所を作る。
export function native_frame_scratch(pixel_count: number): native_frame_scratch_t {
  return { words: new Uint32Array(pixel_count) }
}

// つめたレイヤーを scratch.words へほどく (なければ空にする)。ほどいた点の数が合わなければ 0。
function unpack_layer(packed: rle_t | null, scratch: native_frame_scratch_t): number {
  scratch.words.fill(0)
  if (!packed) return 1
  return rle_unpack(packed, scratch.words) === scratch.words.length ? 1 : 0
}

// words の中の、word とまったく同じ色の番号 (なければ -1)。
function exact_word_index(word: number, words: Uint32Array): number {
  for (let index = 0; index < words.length; index++) if (words[index] === word) return index
  return -1
}

// PPM の色の番号を、ペンの番号にする (1 は紙と反対の色、2 は赤、3 は青。ペンにない色なら 0)。
function ppm_pen_index(color: number, paper: number): number {
  if (color === 2) return 2
  if (color === 3) return 3
  if (color === (paper === 0 ? 1 : 0)) return 1
  return 0
}

// 2つのレイヤーを、そのまま PPM のコマにする。1つのレイヤーには、紙ではない PPM の色が1色だけ、
// すきとおらせずに描かれていなければならない (そうでなければ null)。
function native_ppm_frame(a: rle_t | null, b: rle_t | null, paper: number, scratch: native_frame_scratch_t): native_ppm_frame_t | null {
  if (paper !== 0 && paper !== 1) return null
  const layers: [Uint8Array, Uint8Array] = [new Uint8Array(scratch.words.length), new Uint8Array(scratch.words.length)]
  const pens: [number, number] = [1, 1]
  const packed_layers = [a, b]
  for (let layer = 0; layer < 2; layer++) {
    if (!unpack_layer(packed_layers[layer], scratch)) return null
    let layer_color = -1
    for (let pixel = 0; pixel < scratch.words.length; pixel++) {
      const word = scratch.words[pixel]
      const alpha = word >>> 24
      if (alpha === 0) continue
      if (alpha !== 255) return null
      const color = exact_word_index(word, ppm_words)
      const pen = ppm_pen_index(color, paper)
      if (!pen || color === paper || (layer_color >= 0 && layer_color !== color)) return null
      layer_color = color
      layers[layer][pixel] = 1
    }
    if (layer_color >= 0) pens[layer] = ppm_pen_index(layer_color, paper)
  }
  return { layers: layers, pens: pens }
}

// used の色が、どれも pair の2色のどちらかなら 1。
function all_in_pair(used: number[], pair: readonly number[]): number {
  for (let index = 0; index < used.length; index++) if (used[index] !== pair[0] && used[index] !== pair[1]) return 0
  return 1
}

// レイヤーの2色を決める。使った色 (used) が、元の2色 (original) か決まった組 (pairs) でまにあえば、その組にする。
// まにあわなければ、1色なら番号のいちばん小さいほかの色と組にし、2色なら番号の小さい順にならべる。
function kwz_pair(layer: number, used: number[], original: readonly number[] | undefined, pairs: readonly (readonly [number, number])[]): [number, number] {
  if (original && all_in_pair(used, original)) return [original[0], original[1]]
  const preferred = pairs[layer]
  if (used.length === 0) return [preferred[0], preferred[1]]
  if (used.length === 1) {
    const color = used[0]
    if (preferred[0] === color || preferred[1] === color) return [preferred[0], preferred[1]]
    for (let candidate = 0; candidate < kwz_colors.length; candidate++) if (candidate !== color) return [color, candidate]
  }
  if ((used[0] === preferred[0] && used[1] === preferred[1]) || (used[1] === preferred[0] && used[0] === preferred[1])) return [preferred[0], preferred[1]]
  return used[0] < used[1] ? [used[0], used[1]] : [used[1], used[0]]
}

// 3つのレイヤーを、そのまま KWZ のコマにする。1つのレイヤーには、KWZ の色が2色まで、
// すきとおらせずに描かれていなければならない (そうでなければ null)。
function native_kwz_frame(a: rle_t | null, b: rle_t | null, c: rle_t | null, scratch: native_frame_scratch_t, original: readonly number[] | undefined, pairs: readonly (readonly [number, number])[]): native_kwz_frame_t | null {
  const layers: [Uint8Array, Uint8Array, Uint8Array] = [new Uint8Array(scratch.words.length), new Uint8Array(scratch.words.length), new Uint8Array(scratch.words.length)]
  const colors: [number, number][] = []
  const packed_layers = [a, b, c]
  for (let layer = 0; layer < 3; layer++) {
    if (!unpack_layer(packed_layers[layer], scratch)) return null
    const used: number[] = []
    for (let pixel = 0; pixel < scratch.words.length; pixel++) {
      const word = scratch.words[pixel]
      const alpha = word >>> 24
      if (alpha === 0) continue
      if (alpha !== 255) return null
      const color = exact_word_index(word, kwz_words)
      if (color < 0) return null
      if (!used.includes(color)) {
        if (used.length === 2) return null
        used.push(color)
      }
      layers[layer][pixel] = color + 1
    }
    const pair = kwz_pair(layer, used, original ? original.slice(layer * 2, layer * 2 + 2) : undefined, pairs)
    colors.push(pair)
    for (let pixel = 0; pixel < layers[layer].length; pixel++) {
      const color = layers[layer][pixel] - 1
      if (color < 0) continue
      layers[layer][pixel] = color === pair[0] ? 1 : color === pair[1] ? 2 : 0
    }
  }
  return { layers: layers, colors: colors }
}

// プロジェクトのコマ (レイヤーごとのつめた RGBA) を、そのまま PPM のコマにする (できなければ null)。
// 見えていてよいのはレイヤー 1 と 2 だけで、どちらもすきとおらせていないこと。
export function native_ppm_project_frame(packed: readonly (rle_t | null)[], visible: ArrayLike<number>, alpha: ArrayLike<number>, paper: number, scratch: native_frame_scratch_t): native_ppm_frame_t | null {
  if (packed.length < 4 || (visible[0] && packed[0]) || (visible[3] && packed[3])) return null
  for (let layer = 4; layer < packed.length; layer++) if (visible[layer] && packed[layer]) return null
  if ((visible[1] && packed[1] && alpha[1] !== 255) || (visible[2] && packed[2] && alpha[2] !== 255)) return null
  return native_ppm_frame(visible[1] ? packed[1] : null, visible[2] ? packed[2] : null, paper, scratch)
}

// プロジェクトのコマを、そのまま KWZ のコマにする (できなければ null)。見えていてよいのはレイヤー 1〜3 だけで、
// すきとおらせていないこと。original はそのコマの元の色 (読みこんだうごメモのもの)、pairs は決まったレイヤーの色。
export function native_kwz_project_frame(packed: readonly (rle_t | null)[], visible: ArrayLike<number>, alpha: ArrayLike<number>, scratch: native_frame_scratch_t, original?: readonly number[], pairs: readonly (readonly [number, number])[] = kwz_layer_pairs): native_kwz_frame_t | null {
  if (packed.length < 4 || (visible[0] && packed[0])) return null
  for (let layer = 4; layer < packed.length; layer++) if (visible[layer] && packed[layer]) return null
  for (let layer = 1; layer <= 3; layer++) if (visible[layer] && packed[layer] && alpha[layer] !== 255) return null
  return native_kwz_frame(visible[1] ? packed[1] : null, visible[2] ? packed[2] : null, visible[3] ? packed[3] : null, scratch, original, pairs)
}
