import { KWZ_PAL } from '../h'

export type Rgb = readonly [number, number, number]

export const PPM_COLORS: readonly Rgb[] = [
  [255, 255, 255],
  [14, 14, 14],
  [255, 42, 42],
  [10, 57, 255],
]

export const KWZ_COLORS: readonly Rgb[] = KWZ_PAL

export const KWZ_LAYER_PAIRS: readonly (readonly [number, number])[] = [[1, 0], [2, 4], [3, 5]]

export function exact_color(r: number, g: number, b: number, colors: readonly Rgb[]): number {
  for (let index = 0; index < colors.length; index++) {
    const color = colors[index]
    if (color[0] === r && color[1] === g && color[2] === b) return index
  }
  return -1
}

export function nearest_color(r: number, g: number, b: number, colors: readonly Rgb[]): number {
  let best = 0
  let error = Number.POSITIVE_INFINITY
  for (let index = 0; index < colors.length; index++) {
    const color = colors[index]
    const dr = r - color[0]
    const dg = g - color[1]
    const db = b - color[2]
    const nextError = dr * dr * 2 + dg * dg * 4 + db * db
    if (nextError < error) {
      error = nextError
      best = index
    }
  }
  return best
}

export function color_hex(color: Rgb): string {
  return '#' + ((1 << 24) | (color[0] << 16) | (color[1] << 8) | color[2]).toString(16).slice(1).toUpperCase()
}

export function rgba_word(color: Rgb): number {
  return ((255 << 24) | (color[2] << 16) | (color[1] << 8) | color[0]) >>> 0
}

export function quantize_kwz_planes(image: ImageData): { layers: [Uint8Array, Uint8Array, Uint8Array], colors: [number, number][] } {
  const data = image.data
  const pixelCount = image.width * image.height
  const counts = new Float64Array(KWZ_COLORS.length)
  const indices = new Int8Array(pixelCount).fill(-1)
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const offset = pixel * 4
    if (data[offset + 3] < 128) continue
    const color = nearest_color(data[offset], data[offset + 1], data[offset + 2], KWZ_COLORS)
    indices[pixel] = color
    counts[color]++
  }
  const order: number[] = []
  for (let index = 0; index < KWZ_COLORS.length; index++) if (counts[index] > 0) order.push(index)
  order.sort((a, b) => counts[b] - counts[a])
  const layerOf = new Int8Array(KWZ_COLORS.length).fill(-1)
  const slotOf = new Int8Array(KWZ_COLORS.length)
  const colors: [number, number][] = [[1, 2], [1, 2], [1, 2]]
  for (let index = 0; index < order.length && index < 6; index++) {
    const color = order[index]
    const layer = index >> 1
    const slot = index & 1
    layerOf[color] = layer
    slotOf[color] = slot
    if (slot === 0) colors[layer] = [color, color === 1 ? 2 : 1]
    else colors[layer][1] = color
  }
  const layers: [Uint8Array, Uint8Array, Uint8Array] = [new Uint8Array(pixelCount), new Uint8Array(pixelCount), new Uint8Array(pixelCount)]
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const color = indices[pixel]
    if (color < 0) continue
    const layer = layerOf[color]
    if (layer < 0) continue
    layers[layer][pixel] = slotOf[color] + 1
  }
  return { layers, colors }
}

export function quantize_ppm_planes(image: ImageData, paper: number): { layers: [Uint8Array, Uint8Array], pens: [number, number] } {
  const data = image.data
  const pixelCount = image.width * image.height
  const inverse = paper ? PPM_COLORS[1] : PPM_COLORS[0]
  const candidates: readonly Rgb[] = [inverse, PPM_COLORS[2], PPM_COLORS[3]]
  const counts = new Float64Array(candidates.length)
  const indices = new Int8Array(pixelCount).fill(-1)
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const offset = pixel * 4
    if (data[offset + 3] < 128) continue
    const color = nearest_color(data[offset], data[offset + 1], data[offset + 2], candidates)
    indices[pixel] = color
    counts[color]++
  }
  let first = 0
  for (let index = 1; index < candidates.length; index++) if (counts[index] > counts[first]) first = index
  let second = first === 0 ? 1 : 0
  for (let index = 0; index < candidates.length; index++) if (index !== first && counts[index] > counts[second]) second = index
  const layers: [Uint8Array, Uint8Array] = [new Uint8Array(pixelCount), new Uint8Array(pixelCount)]
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const color = indices[pixel]
    if (color < 0) continue
    if (color === first) layers[0][pixel] = 1
    else if (color === second) layers[1][pixel] = 1
    else {
      const candidate = candidates[color]
      const a = candidates[first]
      const b = candidates[second]
      const da = (candidate[0] - a[0]) ** 2 + (candidate[1] - a[1]) ** 2 + (candidate[2] - a[2]) ** 2
      const db = (candidate[0] - b[0]) ** 2 + (candidate[1] - b[1]) ** 2 + (candidate[2] - b[2]) ** 2
      layers[da <= db ? 0 : 1][pixel] = 1
    }
  }
  return { layers, pens: [first + 1, second + 1] }
}
