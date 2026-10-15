import type { rle_t } from '../h'
import { rle_unpack } from '../lib'
import { kwz_colors, kwz_layer_pairs, ppm_colors, rgba_word } from './color'

export type native_frame_scratch_t = {
  words: Uint32Array
}

export type native_ppm_frame_t = {
  layers: [Uint8Array, Uint8Array]
  pens: [number, number]
}

export type native_kwz_frame_t = {
  layers: [Uint8Array, Uint8Array, Uint8Array]
  colors: [number, number][]
}

const ppm_words = ppm_colors.map(rgba_word)
const kwz_words = kwz_colors.map(rgba_word)

export function native_frame_scratch(pixel_count: number): native_frame_scratch_t {
  return { words: new Uint32Array(pixel_count) }
}

function unpack_layer(packed: rle_t | null, scratch: native_frame_scratch_t): number {
  scratch.words.fill(0)
  if (!packed) return 1
  return rle_unpack(packed, scratch.words) === scratch.words.length ? 1 : 0
}

function exact_word_index(word: number, words: readonly number[]): number {
  for (let index = 0; index < words.length; index++) if (words[index] === word) return index
  return -1
}

function ppm_pen_index(color: number, paper: number): number {
  if (color === 2) return 2
  if (color === 3) return 3
  if (color === (paper === 0 ? 1 : 0)) return 1
  return 0
}

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
  return { layers, pens }
}

function kwz_pair(layer: number, used: number[], original?: readonly number[]): [number, number] {
  if (original && used.every(color => color === original[0] || color === original[1])) return [original[0], original[1]]
  const preferred = kwz_layer_pairs[layer]
  if (used.length === 0) return [preferred[0], preferred[1]]
  if (used.length === 1) {
    const color = used[0]
    if (preferred[0] === color || preferred[1] === color) return [preferred[0], preferred[1]]
    for (let candidate = 0; candidate < kwz_colors.length; candidate++) if (candidate !== color) return [color, candidate]
  }
  if ((used[0] === preferred[0] && used[1] === preferred[1]) || (used[1] === preferred[0] && used[0] === preferred[1])) return [preferred[0], preferred[1]]
  return used[0] < used[1] ? [used[0], used[1]] : [used[1], used[0]]
}

function native_kwz_frame(a: rle_t | null, b: rle_t | null, c: rle_t | null, scratch: native_frame_scratch_t, original?: readonly number[]): native_kwz_frame_t | null {
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
    const pair = kwz_pair(layer, used, original?.slice(layer * 2, layer * 2 + 2))
    colors.push(pair)
    for (let pixel = 0; pixel < layers[layer].length; pixel++) {
      const color = layers[layer][pixel] - 1
      if (color < 0) continue
      layers[layer][pixel] = color === pair[0] ? 1 : color === pair[1] ? 2 : 0
    }
  }
  return { layers, colors }
}

export function native_ppm_project_frame(packed: readonly (rle_t | null)[], visible: ArrayLike<number>, alpha: ArrayLike<number>, paper: number, scratch: native_frame_scratch_t): native_ppm_frame_t | null {
  if (packed.length < 4 || (visible[0] && packed[0]) || (visible[3] && packed[3])) return null
  for (let layer = 4; layer < packed.length; layer++) if (visible[layer] && packed[layer]) return null
  if ((visible[1] && packed[1] && alpha[1] !== 255) || (visible[2] && packed[2] && alpha[2] !== 255)) return null
  return native_ppm_frame(visible[1] ? packed[1] : null, visible[2] ? packed[2] : null, paper, scratch)
}

export function native_kwz_project_frame(packed: readonly (rle_t | null)[], visible: ArrayLike<number>, alpha: ArrayLike<number>, scratch: native_frame_scratch_t, original?: readonly number[]): native_kwz_frame_t | null {
  if (packed.length < 4 || (visible[0] && packed[0])) return null
  for (let layer = 4; layer < packed.length; layer++) if (visible[layer] && packed[layer]) return null
  for (let layer = 1; layer <= 3; layer++) if (visible[layer] && packed[layer] && alpha[layer] !== 255) return null
  return native_kwz_frame(visible[1] ? packed[1] : null, visible[2] ? packed[2] : null, visible[3] ? packed[3] : null, scratch, original)
}
