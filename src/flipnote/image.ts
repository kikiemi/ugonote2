import { KWZ_CANVAS_H, KWZ_CANVAS_W } from '../codec/kwzgeom'
import { PPM_H, PPM_W } from '../codec/ppm'
import { clamp, rle_pack } from '../lib'
import { color_hex, KWZ_COLORS, KWZ_LAYER_PAIRS, PPM_COLORS, rgba_word, type Rgb } from './color'

export type FlipImageFormat = 'ppm' | 'kwz'

export type FlipImageInput = {
  format: FlipImageFormat
  width: number
  height: number
  pixels: Uint8ClampedArray
  frames: number
  paper: number
  contrast: number
  saturation: number
}

export type FlipImageFrame = [null, Uint32Array | null, Uint32Array | null, Uint32Array | null]

export type FlipImageResult = {
  format: FlipImageFormat
  width: number
  height: number
  paper: number
  paperHex: string
  frames: FlipImageFrame[]
  colors: number[]
  ppmPens: [number, number] | null
}

type PreparedSource = {
  rgb: Float32Array
  alpha: Float32Array
}

type PaletteSetup = {
  paper: number
  palette: readonly Rgb[]
  paletteIndices: number[]
  layerOf: Int8Array
  wordOf: Uint32Array
  ppmPens: [number, number] | null
}

function srgb_to_linear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function prepare_source(input: FlipImageInput): PreparedSource {
  const pixelCount = input.width * input.height
  const rgb = new Float32Array(pixelCount * 3)
  const alpha = new Float32Array(pixelCount)
  const contrast = clamp(input.contrast, 0.5, 1.6)
  const saturation = clamp(input.saturation, 0, 1.8)
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const source = pixel * 4
    let r = input.pixels[source] / 255
    let g = input.pixels[source + 1] / 255
    let b = input.pixels[source + 2] / 255
    const lightness = r * 0.2126 + g * 0.7152 + b * 0.0722
    r = lightness + (r - lightness) * saturation
    g = lightness + (g - lightness) * saturation
    b = lightness + (b - lightness) * saturation
    r = clamp((r - 0.5) * contrast + 0.5, 0, 1)
    g = clamp((g - 0.5) * contrast + 0.5, 0, 1)
    b = clamp((b - 0.5) * contrast + 0.5, 0, 1)
    const target = pixel * 3
    rgb[target] = srgb_to_linear(r)
    rgb[target + 1] = srgb_to_linear(g)
    rgb[target + 2] = srgb_to_linear(b)
    alpha[pixel] = input.pixels[source + 3] / 255
  }
  return { rgb, alpha }
}

function palette_linear(colors: readonly Rgb[]): Float32Array {
  const out = new Float32Array(colors.length * 3)
  for (let index = 0; index < colors.length; index++) {
    const color = colors[index]
    out[index * 3] = srgb_to_linear(color[0] / 255)
    out[index * 3 + 1] = srgb_to_linear(color[1] / 255)
    out[index * 3 + 2] = srgb_to_linear(color[2] / 255)
  }
  return out
}

function color_error(r: number, g: number, b: number, palette: Float32Array, index: number): number {
  const offset = index * 3
  const dr = r - palette[offset]
  const dg = g - palette[offset + 1]
  const db = b - palette[offset + 2]
  return dr * dr * 0.25 + dg * dg * 0.62 + db * db * 0.13
}

function blended(prepared: PreparedSource, pixel: number, paper: number, palette: Float32Array): [number, number, number] {
  const source = pixel * 3
  const paperOffset = paper * 3
  const alpha = prepared.alpha[pixel]
  const inverse = 1 - alpha
  return [
    prepared.rgb[source] * alpha + palette[paperOffset] * inverse,
    prepared.rgb[source + 1] * alpha + palette[paperOffset + 1] * inverse,
    prepared.rgb[source + 2] * alpha + palette[paperOffset + 2] * inverse,
  ]
}

function ppm_setup(prepared: PreparedSource, requestedPaper: number): PaletteSetup {
  const linear = palette_linear(PPM_COLORS)
  const papers = requestedPaper === 0 || requestedPaper === 1 ? [requestedPaper] : [0, 1]
  let bestPaper = papers[0]
  let bestPair: [number, number] = bestPaper === 0 ? [1, 2] : [0, 2]
  let bestScore = Number.POSITIVE_INFINITY
  const sampleStep = Math.max(1, Math.floor(prepared.alpha.length / 32768))
  for (const paper of papers) {
    const inks = [0, 1, 2, 3].filter(index => index !== paper)
    for (let first = 0; first < inks.length - 1; first++) {
      for (let second = first + 1; second < inks.length; second++) {
        const pair: [number, number] = [inks[first], inks[second]]
        let score = 0
        for (let pixel = 0; pixel < prepared.alpha.length; pixel += sampleStep) {
          const [r, g, b] = blended(prepared, pixel, paper, linear)
          score += Math.min(color_error(r, g, b, linear, paper), color_error(r, g, b, linear, pair[0]), color_error(r, g, b, linear, pair[1]))
        }
        if (score < bestScore) {
          bestScore = score
          bestPaper = paper
          bestPair = pair
        }
      }
    }
  }
  const layerOf = new Int8Array(PPM_COLORS.length).fill(-1)
  layerOf[bestPair[0]] = 1
  layerOf[bestPair[1]] = 2
  const wordOf = new Uint32Array(PPM_COLORS.length)
  for (let index = 0; index < PPM_COLORS.length; index++) wordOf[index] = rgba_word(PPM_COLORS[index])
  return { paper: bestPaper, palette: PPM_COLORS, paletteIndices: [bestPaper, bestPair[0], bestPair[1]], layerOf, wordOf, ppmPens: bestPair }
}

function kwz_paper(prepared: PreparedSource, requestedPaper: number): number {
  if (Number.isInteger(requestedPaper) && requestedPaper >= 0 && requestedPaper < KWZ_COLORS.length) return requestedPaper
  const linear = palette_linear(KWZ_COLORS)
  const counts = new Float64Array(KWZ_COLORS.length)
  const sampleStep = Math.max(1, Math.floor(prepared.alpha.length / 32768))
  for (let pixel = 0; pixel < prepared.alpha.length; pixel += sampleStep) {
    let best = 0
    let bestError = Number.POSITIVE_INFINITY
    for (let paper = 0; paper < KWZ_COLORS.length; paper++) {
      const [r, g, b] = blended(prepared, pixel, paper, linear)
      const error = color_error(r, g, b, linear, paper)
      if (error < bestError) {
        bestError = error
        best = paper
      }
    }
    counts[best]++
  }
  let best = 0
  for (let index = 1; index < counts.length; index++) if (counts[index] > counts[best]) best = index
  return best
}

function kwz_setup(prepared: PreparedSource, requestedPaper: number): PaletteSetup {
  const paper = kwz_paper(prepared, requestedPaper)
  const layerOf = new Int8Array(KWZ_COLORS.length).fill(-1)
  for (let layer = 0; layer < KWZ_LAYER_PAIRS.length; layer++) {
    const pair = KWZ_LAYER_PAIRS[layer]
    if (pair[0] !== paper) layerOf[pair[0]] = layer + 1
    if (pair[1] !== paper) layerOf[pair[1]] = layer + 1
  }
  const wordOf = new Uint32Array(KWZ_COLORS.length)
  for (let index = 0; index < KWZ_COLORS.length; index++) wordOf[index] = rgba_word(KWZ_COLORS[index])
  return { paper, palette: KWZ_COLORS, paletteIndices: [0, 1, 2, 3, 4, 5], layerOf, wordOf, ppmPens: null }
}

function noise_value(x: number, y: number, frame: number): number {
  let value = Math.imul(x + 1, 0x1f123bb5) ^ Math.imul(y + 1, 0x5f356495) ^ Math.imul(frame + 1, 0x6c8e9cf5)
  value ^= value >>> 15
  value = Math.imul(value, 0x2c1b3c6d)
  value ^= value >>> 12
  return ((value >>> 0) / 4294967296 - 0.5) * 0.026
}

function add_spatial(error: Float32Array, width: number, height: number, x: number, y: number, direction: number, er: number, eg: number, eb: number): void {
  const add = (targetX: number, targetY: number, weight: number): void => {
    if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) return
    const offset = (targetY * width + targetX) * 3
    error[offset] += er * weight
    error[offset + 1] += eg * weight
    error[offset + 2] += eb * weight
  }
  add(x + direction, y, 7 / 16)
  add(x - direction, y + 1, 3 / 16)
  add(x, y + 1, 5 / 16)
  add(x + direction, y + 1, 1 / 16)
}

function validate_input(input: FlipImageInput): void {
  const expected = input.format === 'ppm' ? [PPM_W, PPM_H] : [KWZ_CANVAS_W, KWZ_CANVAS_H]
  if (input.width !== expected[0] || input.height !== expected[1]) throw new RangeError('invalid Flipnote image dimensions')
  if (!(input.pixels instanceof Uint8ClampedArray) || input.pixels.length !== input.width * input.height * 4) throw new RangeError('invalid Flipnote image pixels')
  if (!Number.isInteger(input.frames) || input.frames < 1 || input.frames > 16) throw new RangeError('invalid Flipnote image frame count')
}

export function flip_image_convert(input: FlipImageInput): FlipImageResult {
  validate_input(input)
  const prepared = prepare_source(input)
  const setup = input.format === 'ppm' ? ppm_setup(prepared, input.paper) : kwz_setup(prepared, input.paper)
  const palette = palette_linear(setup.palette)
  const pixelCount = input.width * input.height
  const base = new Float32Array(pixelCount * 3)
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const [r, g, b] = blended(prepared, pixel, setup.paper, palette)
    const offset = pixel * 3
    base[offset] = r
    base[offset + 1] = g
    base[offset + 2] = b
  }
  const temporal = new Float32Array(pixelCount * 3)
  const spatial = new Float32Array(pixelCount * 3)
  const used = new Uint8Array(setup.palette.length)
  used[setup.paper] = 1
  const frames: FlipImageFrame[] = []
  for (let frameIndex = 0; frameIndex < input.frames; frameIndex++) {
    spatial.fill(0)
    const layerWords = [new Uint32Array(pixelCount), new Uint32Array(pixelCount), new Uint32Array(pixelCount)]
    for (let y = 0; y < input.height; y++) {
      const direction = ((y + frameIndex) & 1) === 0 ? 1 : -1
      const start = direction > 0 ? 0 : input.width - 1
      const end = direction > 0 ? input.width : -1
      for (let x = start; x !== end; x += direction) {
        const pixel = y * input.width + x
        const offset = pixel * 3
        const noise = noise_value(x, y, frameIndex)
        const r = clamp(base[offset] + temporal[offset] + spatial[offset] * 0.58 + noise, -0.3, 1.3)
        const g = clamp(base[offset + 1] + temporal[offset + 1] + spatial[offset + 1] * 0.58 + noise, -0.3, 1.3)
        const b = clamp(base[offset + 2] + temporal[offset + 2] + spatial[offset + 2] * 0.58 + noise, -0.3, 1.3)
        let selected = setup.paletteIndices[0]
        let bestError = Number.POSITIVE_INFINITY
        for (const candidate of setup.paletteIndices) {
          const error = color_error(r, g, b, palette, candidate)
          if (error < bestError) {
            bestError = error
            selected = candidate
          }
        }
        used[selected] = 1
        const paletteOffset = selected * 3
        const er = r - palette[paletteOffset]
        const eg = g - palette[paletteOffset + 1]
        const eb = b - palette[paletteOffset + 2]
        temporal[offset] = clamp((temporal[offset] + base[offset] - palette[paletteOffset]) * 0.92, -0.78, 0.78)
        temporal[offset + 1] = clamp((temporal[offset + 1] + base[offset + 1] - palette[paletteOffset + 1]) * 0.92, -0.78, 0.78)
        temporal[offset + 2] = clamp((temporal[offset + 2] + base[offset + 2] - palette[paletteOffset + 2]) * 0.92, -0.78, 0.78)
        add_spatial(spatial, input.width, input.height, x, y, direction, er, eg, eb)
        const layer = setup.layerOf[selected]
        if (layer > 0) layerWords[layer - 1][pixel] = setup.wordOf[selected]
      }
    }
    const frame: FlipImageFrame = [null, rle_pack(layerWords[0]), rle_pack(layerWords[1]), input.format === 'kwz' ? rle_pack(layerWords[2]) : null]
    frames.push(frame)
  }
  const colors: number[] = []
  for (let index = 0; index < used.length; index++) if (used[index]) colors.push(index)
  return { format: input.format, width: input.width, height: input.height, paper: setup.paper, paperHex: color_hex(setup.palette[setup.paper]), frames, colors, ppmPens: setup.ppmPens }
}
