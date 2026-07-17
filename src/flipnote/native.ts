import type { Rle } from '../h'
import { rle_unpack } from '../lib'
import { KWZ_COLORS, KWZ_LAYER_PAIRS, PPM_COLORS, rgba_word } from './color'

export type NativeFrameScratch = {
  words: Uint32Array
  occupied: Uint8Array
}

export type NativePpmFrame = {
  layers: [Uint8Array, Uint8Array]
  pens: [number, number]
}

export type NativeKwzFrame = {
  layers: [Uint8Array, Uint8Array, Uint8Array]
  colors: [number, number][]
}

const PPM_WORDS = PPM_COLORS.map(rgba_word)
const KWZ_WORDS = KWZ_COLORS.map(rgba_word)

export function native_frame_scratch(pixelCount: number): NativeFrameScratch {
  return { words: new Uint32Array(pixelCount), occupied: new Uint8Array(pixelCount) }
}

function unpack_layer(packed: Rle | null, scratch: NativeFrameScratch): number {
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

function native_ppm_frame(a: Rle | null, b: Rle | null, paper: number, scratch: NativeFrameScratch): NativePpmFrame | null {
  if (paper !== 0 && paper !== 1) return null
  scratch.occupied.fill(0)
  const layers: [Uint8Array, Uint8Array] = [new Uint8Array(scratch.words.length), new Uint8Array(scratch.words.length)]
  const pens: [number, number] = [1, 1]
  const packedLayers = [a, b]
  for (let layer = 0; layer < 2; layer++) {
    if (!unpack_layer(packedLayers[layer], scratch)) return null
    let layerColor = -1
    for (let pixel = 0; pixel < scratch.words.length; pixel++) {
      const word = scratch.words[pixel]
      const alpha = word >>> 24
      if (alpha === 0) continue
      if (alpha !== 255 || scratch.occupied[pixel]) return null
      const color = exact_word_index(word, PPM_WORDS)
      const pen = ppm_pen_index(color, paper)
      if (!pen || color === paper || (layerColor >= 0 && layerColor !== color)) return null
      layerColor = color
      layers[layer][pixel] = 1
      scratch.occupied[pixel] = 1
    }
    if (layerColor >= 0) pens[layer] = ppm_pen_index(layerColor, paper)
  }
  return { layers, pens }
}

function kwz_pair(layer: number, used: number[]): [number, number] {
  const preferred = KWZ_LAYER_PAIRS[layer]
  if (used.length === 0) return [preferred[0], preferred[1]]
  if (used.length === 1) {
    const color = used[0]
    if (preferred[0] === color || preferred[1] === color) return [preferred[0], preferred[1]]
    for (let candidate = 0; candidate < KWZ_COLORS.length; candidate++) if (candidate !== color) return [color, candidate]
  }
  if ((used[0] === preferred[0] && used[1] === preferred[1]) || (used[1] === preferred[0] && used[0] === preferred[1])) return [preferred[0], preferred[1]]
  return used[0] < used[1] ? [used[0], used[1]] : [used[1], used[0]]
}

function native_kwz_frame(a: Rle | null, b: Rle | null, c: Rle | null, scratch: NativeFrameScratch): NativeKwzFrame | null {
  scratch.occupied.fill(0)
  const layers: [Uint8Array, Uint8Array, Uint8Array] = [new Uint8Array(scratch.words.length), new Uint8Array(scratch.words.length), new Uint8Array(scratch.words.length)]
  const colors: [number, number][] = []
  const packedLayers = [a, b, c]
  for (let layer = 0; layer < 3; layer++) {
    if (!unpack_layer(packedLayers[layer], scratch)) return null
    const used: number[] = []
    for (let pixel = 0; pixel < scratch.words.length; pixel++) {
      const word = scratch.words[pixel]
      const alpha = word >>> 24
      if (alpha === 0) continue
      if (alpha !== 255 || scratch.occupied[pixel]) return null
      const color = exact_word_index(word, KWZ_WORDS)
      if (color < 0) return null
      if (!used.includes(color)) {
        if (used.length === 2) return null
        used.push(color)
      }
      layers[layer][pixel] = color + 1
      scratch.occupied[pixel] = 1
    }
    const pair = kwz_pair(layer, used)
    colors.push(pair)
    for (let pixel = 0; pixel < layers[layer].length; pixel++) {
      const color = layers[layer][pixel] - 1
      if (color < 0) continue
      layers[layer][pixel] = color === pair[0] ? 1 : color === pair[1] ? 2 : 0
    }
  }
  return { layers, colors }
}

export function native_ppm_project_frame(packed: readonly (Rle | null)[], visible: ArrayLike<number>, alpha: ArrayLike<number>, paper: number, scratch: NativeFrameScratch): NativePpmFrame | null {
  if (packed.length !== 4 || (visible[0] && packed[0]) || (visible[3] && packed[3])) return null
  if ((visible[1] && packed[1] && alpha[1] !== 255) || (visible[2] && packed[2] && alpha[2] !== 255)) return null
  return native_ppm_frame(visible[1] ? packed[1] : null, visible[2] ? packed[2] : null, paper, scratch)
}

export function native_kwz_project_frame(packed: readonly (Rle | null)[], visible: ArrayLike<number>, alpha: ArrayLike<number>, scratch: NativeFrameScratch): NativeKwzFrame | null {
  if (packed.length !== 4 || (visible[0] && packed[0])) return null
  for (let layer = 1; layer <= 3; layer++) if (visible[layer] && packed[layer] && alpha[layer] !== 255) return null
  return native_kwz_frame(visible[1] ? packed[1] : null, visible[2] ? packed[2] : null, visible[3] ? packed[3] : null, scratch)
}
