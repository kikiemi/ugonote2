// うごメモで使える色の表と、絵をうごメモの色に分ける道具。

import { kwz_pal } from '../h'

export type rgb_t = readonly [number, number, number]

// KWZ の絵を色ごとに分けたもの。layers はレイヤーごとの点 (0 は空、1 と 2 はそのレイヤーの2色)、colors はレイヤーごとの2色の番号。
export type kwz_planes_t = { layers: [Uint8Array, Uint8Array, Uint8Array], colors: [number, number][] }

// PPM の絵を色ごとに分けたもの。layers はレイヤーごとの点 (1 が点)、pens はレイヤーごとのペンの番号。
export type ppm_planes_t = { layers: [Uint8Array, Uint8Array], pens: [number, number] }

// PPM (DSi) の色。白、黒、赤、青。
export const ppm_colors: readonly rgb_t[] = [
  [255, 255, 255],
  [14, 14, 14],
  [255, 42, 42],
  [10, 57, 255],
]

// KWZ (3DS) の色。白、黒、赤、黄、緑、青。
export const kwz_colors: readonly rgb_t[] = kwz_pal

// KWZ の紙の色の番号を '#RRGGBB' にする (6 は色のない紙なので、すきとおった白)。
export function kwz_paper_hex(index: number): string {
  if (index === 6) return '#FFFFFF00'
  const color = kwz_colors[index] || kwz_colors[0]
  return '#' + ((1 << 24) | (color[0] << 16) | (color[1] << 8) | color[2]).toString(16).slice(1).toUpperCase()
}

// '#RRGGBB' の紙の色を、いちばん近い KWZ の色の番号にする (すきとおった色なら 6)。
export function kwz_paper_index(paper: string): number {
  if (/^#[0-9a-f]{6}00$/i.test(paper)) return 6
  const value = Number.parseInt(paper.slice(1), 16)
  return nearest_color((value >>> 16) & 255, (value >>> 8) & 255, value & 255, kwz_colors)
}

// KWZ に書き出すときの、レイヤーごとの2色 (色の番号)。A 黒/白、B 赤/緑、C 黄/青。
export const kwz_layer_pairs: readonly (readonly [number, number])[] = [[1, 0], [2, 4], [3, 5]]
// 普通ふでばこのメモ (実機のサンプル) のレイヤー色。A 白/黒、B 青/赤、C 黄/緑。
export const kwz_sheet_pairs: readonly (readonly [number, number])[] = [[0, 1], [5, 2], [3, 4]]

// colors の中の、(r, g, b) とまったく同じ色の番号 (なければ -1)。
export function exact_color(r: number, g: number, b: number, colors: readonly rgb_t[]): number {
  for (let index = 0; index < colors.length; index++) {
    const color = colors[index]
    if (color[0] === r && color[1] === g && color[2] === b) return index
  }
  return -1
}

// colors の中で、(r, g, b) にいちばん近い色の番号。ちがいは、赤 2、緑 4、青 1 の重みで見る。
export function nearest_color(r: number, g: number, b: number, colors: readonly rgb_t[]): number {
  let best = 0
  let error = Number.POSITIVE_INFINITY
  for (let index = 0; index < colors.length; index++) {
    const color = colors[index]
    const dr = r - color[0]
    const dg = g - color[1]
    const db = b - color[2]
    const next_error = dr * dr * 2 + dg * dg * 4 + db * db
    if (next_error < error) {
      error = next_error
      best = index
    }
  }
  return best
}

// 色を '#RRGGBB' にする。
export function color_hex(color: rgb_t): string {
  return '#' + ((1 << 24) | (color[0] << 16) | (color[1] << 8) | color[2]).toString(16).slice(1).toUpperCase()
}

// 色を、つめた RGBA の1つの値 (下の桁から R, G, B, A。A は 255) にする。
export function rgba_word(color: rgb_t): number {
  return ((255 << 24) | (color[2] << 16) | (color[1] << 8) | color[0]) >>> 0
}

// 色の番号を、点の多い順にならべかえる (同じ数なら、もとの順のまま)。
function sort_by_count(order: number[], counts: Float64Array): void {
  for (let i = 1; i < order.length; i++) {
    const color = order[i]
    let j = i - 1
    while (j >= 0 && counts[order[j]] < counts[color]) {
      order[j + 1] = order[j]
      j--
    }
    order[j + 1] = color
  }
}

// 絵を KWZ の色にして、3つのレイヤーへ分ける。点の多い色から順に、2色ずつレイヤーへ入れる。
// sheet を渡すと、色ごとに決まったレイヤーへ入れる (普通ふでばこ)。
export function quantize_kwz_planes(image: ImageData, sheet?: readonly (readonly [number, number])[]): kwz_planes_t {
  const data = image.data
  const pixel_count = image.width * image.height
  const counts = new Float64Array(kwz_colors.length)
  const indices = new Int8Array(pixel_count).fill(-1)
  for (let pixel = 0; pixel < pixel_count; pixel++) {
    const offset = pixel * 4
    if (data[offset + 3] < 128) continue
    const color = nearest_color(data[offset], data[offset + 1], data[offset + 2], kwz_colors)
    indices[pixel] = color
    counts[color]++
  }
  const order: number[] = []
  for (let index = 0; index < kwz_colors.length; index++) if (counts[index] > 0) order.push(index)
  sort_by_count(order, counts)
  const layer_of = new Int8Array(kwz_colors.length).fill(-1)
  const slot_of = new Int8Array(kwz_colors.length)
  const colors: [number, number][] = [[1, 2], [1, 2], [1, 2]]
  if (sheet) {
    for (let layer = 0; layer < 3; layer++) {
      colors[layer] = [sheet[layer][0], sheet[layer][1]]
      for (let slot = 0; slot < 2; slot++) {
        layer_of[sheet[layer][slot]] = layer
        slot_of[sheet[layer][slot]] = slot
      }
    }
    order.length = 0
  }
  for (let index = 0; index < order.length && index < 6; index++) {
    const color = order[index]
    const layer = index >> 1
    const slot = index & 1
    layer_of[color] = layer
    slot_of[color] = slot
    if (slot === 0) colors[layer] = [color, color === 1 ? 2 : 1]
    else colors[layer][1] = color
  }
  const layers: [Uint8Array, Uint8Array, Uint8Array] = [new Uint8Array(pixel_count), new Uint8Array(pixel_count), new Uint8Array(pixel_count)]
  for (let pixel = 0; pixel < pixel_count; pixel++) {
    const color = indices[pixel]
    if (color < 0) continue
    const layer = layer_of[color]
    if (layer < 0) continue
    layers[layer][pixel] = slot_of[color] + 1
  }
  return { layers: layers, colors: colors }
}

// 絵を PPM の色 (紙と反対の色、赤、青) にして、2つのレイヤーへ分ける。
// 点の多い2色をペンの色にし、のこりの1色の点は、色の近いほうのレイヤーへ入れる。
export function quantize_ppm_planes(image: ImageData, paper: number): ppm_planes_t {
  const data = image.data
  const pixel_count = image.width * image.height
  const inverse = paper ? ppm_colors[1] : ppm_colors[0]
  const candidates: readonly rgb_t[] = [inverse, ppm_colors[2], ppm_colors[3]]
  const counts = new Float64Array(candidates.length)
  const indices = new Int8Array(pixel_count).fill(-1)
  for (let pixel = 0; pixel < pixel_count; pixel++) {
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
  const layers: [Uint8Array, Uint8Array] = [new Uint8Array(pixel_count), new Uint8Array(pixel_count)]
  for (let pixel = 0; pixel < pixel_count; pixel++) {
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
  return { layers: layers, pens: [first + 1, second + 1] }
}
