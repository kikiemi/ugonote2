import { kwz_canvas_h, kwz_canvas_w } from '../codec/kwzgeom'
import { ppm_h, ppm_w } from '../codec/ppm'
import { clamp, rle_pack } from '../lib'
import { color_hex, kwz_colors, kwz_layer_pairs, ppm_colors, rgba_word, type rgb_t } from './color'

export type flip_image_format_t = 'ppm' | 'kwz'

export type flip_image_input_t = {
  format: flip_image_format_t
  width: number
  height: number
  pixels: Uint8ClampedArray
  frames: number
  paper: number
  contrast: number
  saturation: number
  dither?: number
}

export type flip_image_frame_t = [null, Uint32Array | null, Uint32Array | null, Uint32Array | null]

export type flip_image_result_t = {
  format: flip_image_format_t
  width: number
  height: number
  paper: number
  paper_hex: string
  frames: flip_image_frame_t[]
  colors: number[]
  ppm_pens: [number, number] | null
}

type prepared_source_t = {
  rgb: Float32Array
  alpha: Float32Array
}

type palette_setup_t = {
  paper: number
  palette: readonly rgb_t[]
  palette_indices: number[]
  layer_of: Int8Array
  word_of: Uint32Array
  ppm_pens: [number, number] | null
}

function srgb_to_linear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function prepare_source(input: flip_image_input_t): prepared_source_t {
  const pixel_count = input.width * input.height
  const rgb = new Float32Array(pixel_count * 3)
  const alpha = new Float32Array(pixel_count)
  const contrast = clamp(input.contrast, 0.5, 1.6)
  const saturation = clamp(input.saturation, 0, 1.8)
  for (let pixel = 0; pixel < pixel_count; pixel++) {
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

function palette_linear(colors: readonly rgb_t[]): Float32Array {
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

function blended(prepared: prepared_source_t, pixel: number, paper: number, palette: Float32Array): [number, number, number] {
  const source = pixel * 3
  const paper_offset = paper * 3
  const alpha = prepared.alpha[pixel]
  const inverse = 1 - alpha
  return [
    prepared.rgb[source] * alpha + palette[paper_offset] * inverse,
    prepared.rgb[source + 1] * alpha + palette[paper_offset + 1] * inverse,
    prepared.rgb[source + 2] * alpha + palette[paper_offset + 2] * inverse,
  ]
}

function ppm_setup(prepared: prepared_source_t, requested_paper: number): palette_setup_t {
  const linear = palette_linear(ppm_colors)
  const papers = requested_paper === 0 || requested_paper === 1 ? [requested_paper] : [0, 1]
  let best_paper = papers[0]
  let best_pair: [number, number] = best_paper === 0 ? [1, 2] : [0, 2]
  let best_score = Number.POSITIVE_INFINITY
  const sample_step = Math.max(1, Math.floor(prepared.alpha.length / 32768))
  for (const paper of papers) {
    const inks = [0, 1, 2, 3].filter(index => index !== paper)
    for (let first = 0; first < inks.length - 1; first++) {
      for (let second = first + 1; second < inks.length; second++) {
        const pair: [number, number] = [inks[first], inks[second]]
        let score = 0
        for (let pixel = 0; pixel < prepared.alpha.length; pixel += sample_step) {
          const [r, g, b] = blended(prepared, pixel, paper, linear)
          score += Math.min(color_error(r, g, b, linear, paper), color_error(r, g, b, linear, pair[0]), color_error(r, g, b, linear, pair[1]))
        }
        if (score < best_score) {
          best_score = score
          best_paper = paper
          best_pair = pair
        }
      }
    }
  }
  const layer_of = new Int8Array(ppm_colors.length).fill(-1)
  layer_of[best_pair[0]] = 1
  layer_of[best_pair[1]] = 2
  const word_of = new Uint32Array(ppm_colors.length)
  for (let index = 0; index < ppm_colors.length; index++) word_of[index] = rgba_word(ppm_colors[index])
  return { paper: best_paper, palette: ppm_colors, palette_indices: [best_paper, best_pair[0], best_pair[1]], layer_of, word_of, ppm_pens: best_pair }
}

function kwz_paper(prepared: prepared_source_t, requested_paper: number): number {
  if (Number.isInteger(requested_paper) && requested_paper >= 0 && requested_paper < kwz_colors.length) return requested_paper
  const linear = palette_linear(kwz_colors)
  const counts = new Float64Array(kwz_colors.length)
  const sample_step = Math.max(1, Math.floor(prepared.alpha.length / 32768))
  for (let pixel = 0; pixel < prepared.alpha.length; pixel += sample_step) {
    let best = 0
    let best_error = Number.POSITIVE_INFINITY
    for (let paper = 0; paper < kwz_colors.length; paper++) {
      const [r, g, b] = blended(prepared, pixel, paper, linear)
      const error = color_error(r, g, b, linear, paper)
      if (error < best_error) {
        best_error = error
        best = paper
      }
    }
    counts[best]++
  }
  let best = 0
  for (let index = 1; index < counts.length; index++) if (counts[index] > counts[best]) best = index
  return best
}

function kwz_setup(prepared: prepared_source_t, requested_paper: number): palette_setup_t {
  const paper = kwz_paper(prepared, requested_paper)
  const layer_of = new Int8Array(kwz_colors.length).fill(-1)
  for (let layer = 0; layer < kwz_layer_pairs.length; layer++) {
    const pair = kwz_layer_pairs[layer]
    if (pair[0] !== paper) layer_of[pair[0]] = layer + 1
    if (pair[1] !== paper) layer_of[pair[1]] = layer + 1
  }
  const word_of = new Uint32Array(kwz_colors.length)
  for (let index = 0; index < kwz_colors.length; index++) word_of[index] = rgba_word(kwz_colors[index])
  return { paper, palette: kwz_colors, palette_indices: [0, 1, 2, 3, 4, 5], layer_of, word_of, ppm_pens: null }
}

function noise_value(x: number, y: number, frame: number): number {
  let value = Math.imul(x + 1, 0x1f123bb5) ^ Math.imul(y + 1, 0x5f356495) ^ Math.imul(frame + 1, 0x6c8e9cf5)
  value ^= value >>> 15
  value = Math.imul(value, 0x2c1b3c6d)
  value ^= value >>> 12
  return ((value >>> 0) / 4294967296 - 0.5) * 0.026
}

function add_spatial(error: Float32Array, width: number, height: number, x: number, y: number, direction: number, er: number, eg: number, eb: number): void {
  const add = (target_x: number, target_y: number, weight: number): void => {
    if (target_x < 0 || target_x >= width || target_y < 0 || target_y >= height) return
    const offset = (target_y * width + target_x) * 3
    error[offset] += er * weight
    error[offset + 1] += eg * weight
    error[offset + 2] += eb * weight
  }
  add(x + direction, y, 7 / 16)
  add(x - direction, y + 1, 3 / 16)
  add(x, y + 1, 5 / 16)
  add(x + direction, y + 1, 1 / 16)
}

function validate_input(input: flip_image_input_t): void {
  const expected = input.format === 'ppm' ? [ppm_w, ppm_h] : [kwz_canvas_w, kwz_canvas_h]
  if (input.width !== expected[0] || input.height !== expected[1]) throw new RangeError('invalid Flipnote image dimensions')
  if (!(input.pixels instanceof Uint8ClampedArray) || input.pixels.length !== input.width * input.height * 4) throw new RangeError('invalid Flipnote image pixels')
  if (!Number.isInteger(input.frames) || input.frames < 1 || input.frames > 16) throw new RangeError('invalid Flipnote image frame count')
}

export function flip_image_convert(input: flip_image_input_t): flip_image_result_t {
  validate_input(input)
  const prepared = prepare_source(input)
  const setup = input.format === 'ppm' ? ppm_setup(prepared, input.paper) : kwz_setup(prepared, input.paper)
  const palette = palette_linear(setup.palette)
  const pixel_count = input.width * input.height
  const base = new Float32Array(pixel_count * 3)
  for (let pixel = 0; pixel < pixel_count; pixel++) {
    const [r, g, b] = blended(prepared, pixel, setup.paper, palette)
    const offset = pixel * 3
    base[offset] = r
    base[offset + 1] = g
    base[offset + 2] = b
  }
  const dither = input.dither !== 0
  const temporal = new Float32Array(pixel_count * 3)
  const spatial = new Float32Array(pixel_count * 3)
  const used = new Uint8Array(setup.palette.length)
  used[setup.paper] = 1
  const frames: flip_image_frame_t[] = []
  for (let frame_index = 0; frame_index < input.frames; frame_index++) {
    spatial.fill(0)
    const layer_words = [new Uint32Array(pixel_count), new Uint32Array(pixel_count), new Uint32Array(pixel_count)]
    for (let y = 0; y < input.height; y++) {
      const direction = ((y + frame_index) & 1) === 0 ? 1 : -1
      const start = direction > 0 ? 0 : input.width - 1
      const end = direction > 0 ? input.width : -1
      for (let x = start; x !== end; x += direction) {
        const pixel = y * input.width + x
        const offset = pixel * 3
        const noise = dither ? noise_value(x, y, frame_index) : 0
        const r = clamp(base[offset] + temporal[offset] + spatial[offset] * 0.58 + noise, -0.3, 1.3)
        const g = clamp(base[offset + 1] + temporal[offset + 1] + spatial[offset + 1] * 0.58 + noise, -0.3, 1.3)
        const b = clamp(base[offset + 2] + temporal[offset + 2] + spatial[offset + 2] * 0.58 + noise, -0.3, 1.3)
        let selected = setup.palette_indices[0]
        let best_error = Number.POSITIVE_INFINITY
        for (const candidate of setup.palette_indices) {
          const error = color_error(r, g, b, palette, candidate)
          if (error < best_error) {
            best_error = error
            selected = candidate
          }
        }
        used[selected] = 1
        const palette_offset = selected * 3
        const er = r - palette[palette_offset]
        const eg = g - palette[palette_offset + 1]
        const eb = b - palette[palette_offset + 2]
        if (dither) {
          temporal[offset] = clamp((temporal[offset] + base[offset] - palette[palette_offset]) * 0.92, -0.78, 0.78)
          temporal[offset + 1] = clamp((temporal[offset + 1] + base[offset + 1] - palette[palette_offset + 1]) * 0.92, -0.78, 0.78)
          temporal[offset + 2] = clamp((temporal[offset + 2] + base[offset + 2] - palette[palette_offset + 2]) * 0.92, -0.78, 0.78)
          add_spatial(spatial, input.width, input.height, x, y, direction, er, eg, eb)
        }
        const layer = setup.layer_of[selected]
        if (layer > 0) layer_words[layer - 1][pixel] = setup.word_of[selected]
      }
    }
    const frame: flip_image_frame_t = [null, rle_pack(layer_words[0]), rle_pack(layer_words[1]), input.format === 'kwz' ? rle_pack(layer_words[2]) : null]
    frames.push(frame)
  }
  const colors: number[] = []
  for (let index = 0; index < used.length; index++) if (used[index]) colors.push(index)
  return { format: input.format, width: input.width, height: input.height, paper: setup.paper, paper_hex: color_hex(setup.palette[setup.paper]), frames, colors, ppm_pens: setup.ppm_pens }
}
