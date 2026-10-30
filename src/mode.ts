import { kwz_speeds } from './codec/kwzformat'
import { ppm_speeds } from './codec/ppmformat'
import { kwz_canvas_h, kwz_canvas_w } from './codec/kwzgeom'
import { l_draw_max, l_p, max_frames_flipnote, max_frames_normal, mode_3_d, mode_dsi, mode_normal, pal_kwz, pal_ppm, pal_std, ink_kwz, ink_ppm, ink_std, paper_kwz, paper_ppm, paper_std } from './h'
import { kwz_colors, kwz_paper_index, nearest_color } from './flipnote/color'
import { hex_rgb } from './lib'
import { tr } from './lang'

// うごメモ3Dの普通ふでばこは1枚の紙として描く。作品ヘッダの bit4 が立っていれば上級ふでばこ。
export const kwz_flag_advanced = 0x10

export function mode_one_sheet(doc: { mode: number, meta: { flags: number } }): number {
  return doc.mode === mode_3_d && !(doc.meta.flags & kwz_flag_advanced) ? 1 : 0
}

// 普通ふでばこでは色で描くレイヤーが決まる。実機のサンプルメモと同じく A 白/黒、B 青/赤、C 黄/緑。
const sheet_layers = [1, 1, 2, 3, 3, 2]

export function sheet_layer(color: string): number {
  return sheet_layers[kwz_paper_index(color)] || 1
}

// 1点の色から、普通ふでばこで入るレイヤーと実機の色 (kwz の色番号) を返す。
export function sheet_slot(r: number, g: number, b: number): [number, number] {
  const color = nearest_color(r, g, b, kwz_colors)
  return [sheet_layers[color], color]
}

export function mode_canvas(mode: number): { w: number, h: number, ratio: string, res: string } {
  if (mode === mode_dsi) return { w: 256, h: 192, ratio: '4:3', res: 'dsi' }
  if (mode === mode_3_d) return { w: kwz_canvas_w, h: kwz_canvas_h, ratio: '4:3', res: '3ds' }
  return { w: 512, h: 288, ratio: '16:9', res: 'low' }
}

export function mode_frame_limit(mode: number): number {
  return mode === mode_normal ? max_frames_normal : max_frames_flipnote
}

export function mode_layers(mode: number): number {
  if (mode === mode_dsi) return 2
  if (mode === mode_3_d) return 3
  return l_draw_max
}

export function mode_layer_allowed(mode: number, layer: number): number {
  if (layer === l_p) return 1
  return layer >= 1 && layer <= mode_layers(mode) ? 1 : 0
}

export function mode_order(mode: number, order: readonly number[]): number[] {
  const out: number[] = []
  for (const layer of order) if (mode_layer_allowed(mode, layer)) out.push(layer)
  return out
}

export function layer_name(layer: number): string {
  if (layer === l_p) return tr('写真')
  let name = ''
  for (let n = layer; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name
  return name
}

export function mode_pal(mode: number): number {
  if (mode === mode_dsi) return pal_ppm
  if (mode === mode_3_d) return pal_kwz
  return pal_std
}

export function mode_ink(mode: number): string[] {
  if (mode === mode_dsi) return ink_ppm
  if (mode === mode_3_d) return ink_kwz
  return ink_std
}

export function mode_paper_opts(mode: number): string[] {
  if (mode === mode_dsi) return paper_ppm
  if (mode === mode_3_d) return paper_kwz
  return paper_std
}

export function mode_allows_layer_alpha(mode: number): number {
  return mode === mode_normal ? 1 : 0
}

export function mode_allows_runtime_anim(mode: number): number {
  return mode === mode_normal ? 1 : 0
}

export function mode_name(mode: number): string {
  if (mode === mode_dsi) return tr('うごメモ')
  if (mode === mode_3_d) return tr('うごメモ3D')
  return tr('ノーマル')
}

const dsi_speeds = ppm_speeds.slice(1)

export function mode_speeds(mode: number): readonly number[] {
  return mode === mode_dsi ? dsi_speeds : kwz_speeds
}

export function mode_speed_index(mode: number, fps: number): number {
  const speeds = mode_speeds(mode)
  let best = 0
  for (let i = 1; i < speeds.length; i++) if (Math.abs(speeds[i] - fps) < Math.abs(speeds[best] - fps)) best = i
  return best
}

export function mode_speed_tag(mode: number, fps: number): string {
  const speeds = mode_speeds(mode)
  const i = mode_speed_index(mode, fps)
  return Math.abs(speeds[i] - fps) < 0.01 ? 'はやさ ' + (i + 1) : 'カスタム'
}

export function mode_color(mode: number, color: string): string {
  if (mode === mode_normal) return color.toUpperCase()
  const rgb = hex_rgb(color)
  const inks = mode_ink(mode)
  let best = inks[0]
  let error = Infinity
  for (const ink of inks) {
    const c = hex_rgb(ink)
    const dr = rgb[0] - c[0]
    const dg = rgb[1] - c[1]
    const db = rgb[2] - c[2]
    const d = dr * dr + dg * dg + db * db
    if (d < error) { best = ink; error = d }
  }
  return best
}
