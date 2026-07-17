import { KWZ_CANVAS_H, KWZ_CANVAS_W } from './codec/kwzgeom'
import { L_DRAW_MAX, L_P, MAX_FRAMES_FLIPNOTE, MAX_FRAMES_NORMAL, MODE_3D, MODE_DSI, MODE_NORMAL, PAL_KWZ, PAL_PPM, PAL_STD, INK_KWZ, INK_PPM, INK_STD, PAPER_KWZ, PAPER_PPM, PAPER_STD } from './h'
import { tr } from './lang'

export function mode_canvas(mode: number): { w: number, h: number, ratio: string, res: string } {
  if (mode === MODE_DSI) return { w: 256, h: 192, ratio: '4:3', res: 'dsi' }
  if (mode === MODE_3D) return { w: KWZ_CANVAS_W, h: KWZ_CANVAS_H, ratio: '4:3', res: '3ds' }
  return { w: 512, h: 288, ratio: '16:9', res: 'low' }
}

export function mode_frame_limit(mode: number): number {
  return mode === MODE_NORMAL ? MAX_FRAMES_NORMAL : MAX_FRAMES_FLIPNOTE
}

export function mode_layers(mode: number): number {
  if (mode === MODE_DSI) return 2
  if (mode === MODE_3D) return 3
  return L_DRAW_MAX
}

export function mode_layer_allowed(mode: number, layer: number): number {
  if (layer === L_P) return 1
  return layer >= 1 && layer <= mode_layers(mode) ? 1 : 0
}

export function mode_order(mode: number, order: readonly number[]): number[] {
  const out: number[] = []
  for (const layer of order) if (mode_layer_allowed(mode, layer)) out.push(layer)
  return out
}

export function layer_name(layer: number): string {
  if (layer === L_P) return tr('写真')
  if (layer >= 1 && layer <= 26) return String.fromCharCode(64 + layer)
  return String(layer)
}

export function mode_pal(mode: number): number {
  if (mode === MODE_DSI) return PAL_PPM
  if (mode === MODE_3D) return PAL_KWZ
  return PAL_STD
}

export function mode_ink(mode: number): string[] {
  if (mode === MODE_DSI) return INK_PPM
  if (mode === MODE_3D) return INK_KWZ
  return INK_STD
}

export function mode_paper_opts(mode: number): string[] {
  if (mode === MODE_DSI) return PAPER_PPM
  if (mode === MODE_3D) return PAPER_KWZ
  return PAPER_STD
}

export function mode_allows_layer_alpha(mode: number): number {
  return mode === MODE_NORMAL ? 1 : 0
}

export function mode_allows_runtime_anim(mode: number): number {
  return mode === MODE_NORMAL ? 1 : 0
}

export function mode_name(mode: number): string {
  if (mode === MODE_DSI) return tr('うごメモ')
  if (mode === MODE_3D) return tr('うごメモ3D')
  return tr('ノーマル')
}
