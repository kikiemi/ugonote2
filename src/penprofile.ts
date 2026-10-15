import { b_pen, brush_defs, mode_normal, t_pen, type pen_t } from './h'
import { mode_color } from './mode'

export const n_solid = 0
export const n_brush = 1
export const n_outline = 2
export const n_dots = 3
export const n_pencil = 4
export const n_spray = 5

export type native_pen_tip_t = { id: number, shape: number, size: number, label: string }

const shapes = [n_solid, n_solid, n_solid, n_brush, n_outline, n_dots, n_pencil, n_spray]
const sizes = [[1, 2, 3, 5, 3, 12, 16, 16], [5, 10, 15, 10, 9, 24, 24, 32]]
const labels = ['ペン', 'ペン', 'ペン', 'ふで', 'ふちペン', 'てんてん', 'えんぴつ', 'スプレー']
const quick_sizes = [1, 3, 5, 8, 12, 24]

export const native_pen_tips: native_pen_tip_t[] = []
for (let id = 0; id < 16; id++) {
  const k = id % 8
  const size = sizes[id < 8 ? 0 : 1][k]
  native_pen_tips.push({ id, shape: shapes[k], size, label: labels[k] + (k < 3 ? ' ' + size + ' px' : '') })
}

export function native_pen_tip(id: number): native_pen_tip_t {
  return native_pen_tips[id] || native_pen_tips[2]
}

export function native_pen_valid(id: number): boolean {
  return Number.isInteger(id) && id >= 0 && id < native_pen_tips.length
}

export function pen_quick_sizes(mode: number, tool: number): number[] {
  if (mode === mode_normal || tool !== t_pen) return quick_sizes
  const sizes: number[] = []
  for (let i = 0; i < native_pen_tips.length; i++) {
    const tip = native_pen_tips[i]
    if (tip.shape === n_solid) sizes.push(tip.size)
  }
  return sizes
}

export function pen_brush_allowed(mode: number, id: number): boolean {
  return mode === mode_normal ? brush_defs.some(b => b.id === id) : id === b_pen
}

export function pen_option_allowed(mode: number, tool: number, id: string): boolean {
  if (mode === mode_normal) return true
  if (id === 'blk_size' && tool === t_pen) return false
  return id !== 'blk_stroke' && id !== 'blk_alpha'
}

export function pen_native_select(p: pen_t, id: number): void {
  p.native_tip = id
  p.size = native_pen_tip(id).size
  p.brush = b_pen
  p.mark_id = ''
}

export function pen_mode_normalize(p: pen_t, mode: number): void {
  if (mode === mode_normal) return
  p.native_tip = native_pen_valid(p.native_tip) ? p.native_tip : 2
  if (p.tool === t_pen) pen_native_select(p, p.native_tip)
  else { p.brush = b_pen; p.mark_id = '' }
  p.alpha = 1
  p.pressure = 0
  p.smooth = 0
  p.ocolor = mode_color(mode, p.ocolor)
}
