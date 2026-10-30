import { b_pen, brush_defs, is_shape_tool, mode_dsi, mode_normal, t_circle, t_eraser, t_fill, t_line, t_patbrush, t_pen, t_rect, type pen_t } from './h'
import { mode_color } from './mode'

export const n_solid = 0
export const n_brush = 1
export const n_outline = 2
export const n_dots = 3
export const n_pencil = 4
export const n_spray = 5

export type native_pen_tip_t = { id: number, shape: number, size: number, label: string }

// うごくメモ帳3Dのペン先。大きさは実機のペン先表 (ふつう / 拡張) の値。
const shapes = [n_solid, n_solid, n_solid, n_brush, n_outline, n_dots, n_pencil, n_spray]
const sizes = [[1, 2, 3, 3, 6, 5, 10, 15], [5, 9, 15, 3, 11, 20, 25, 30]]
const labels = ['ペン', 'ペン', 'ペン', 'ふで', 'ふちペン', 'てんてん', 'えんぴつ', 'スプレー']
const quick_sizes = [1, 3, 5, 8, 12, 24]

export const native_pen_tips: native_pen_tip_t[] = []
for (let id = 0; id < 16; id++) {
  const k = id % 8
  const size = sizes[id < 8 ? 0 : 1][k]
  native_pen_tips.push({ id, shape: shapes[k], size, label: labels[k] + (k < 3 ? ' ' + size + ' px' : '') })
}

// うごくメモ帳 (DSi) のペン先。0〜7 がふつうのペン箱、8〜15 が上級のペン箱の並び (中身は dsidraw のブラシ)。
const ds_labels = ['ペン 1px', 'ペン 2px', 'ペン 3px', 'ドット 2px', '2本線', 'スプレー', 'ふるえ線', 'クレヨン', 'ペン 5px', 'ペン 7px', 'ペン 9px', 'ふで', 'ふちペン', 'スプレー 大', 'ふるえ線 太', 'クレヨン 太']
const ds_sizes = [1, 2, 3, 2, 3, 5, 5, 6, 5, 7, 9, 3, 7, 15, 10, 8]
const ds_solid = [1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0]

export const ds_pen_tips: native_pen_tip_t[] = []
for (let id = 0; id < 16; id++) ds_pen_tips.push({ id, shape: ds_solid[id] ? n_solid : n_brush, size: ds_sizes[id], label: ds_labels[id] })

export function native_pen_tips_for(mode: number): native_pen_tip_t[] {
  return mode === mode_dsi ? ds_pen_tips : native_pen_tips
}

export type native_eraser_tip_t = { id: number, size: number, label: string }

// ケシゴムは8種類。拡張 (8〜15) は同じ形で、ペイントのもようの点だけを消す。
const eraser_sizes = [1, 3, 8, 16, 9, 13, 15, 15]
const eraser_labels = ['点', '四角 小', '丸 小', '丸 大', '四角 中', '四角 大', 'たて線', 'よこ線']

export const native_eraser_tips: native_eraser_tip_t[] = []
for (let id = 0; id < 16; id++) native_eraser_tips.push({ id, size: eraser_sizes[id & 7], label: eraser_labels[id & 7] + (id >= 8 ? ' もよう' : '') })

// DSi のケシゴムも同じ並び (点・四角3・丸7・丸15・四角7・四角15・たて線・よこ線)。上級の箱はもようの点だけを消す。
const ds_eraser_sizes = [1, 3, 7, 15, 7, 15, 15, 15]
export const ds_eraser_tips: native_eraser_tip_t[] = []
for (let id = 0; id < 16; id++) ds_eraser_tips.push({ id, size: ds_eraser_sizes[id & 7], label: eraser_labels[id & 7] + (id >= 8 ? ' もよう' : '') })

export function native_eraser_tips_for(mode: number): native_eraser_tip_t[] {
  return mode === mode_dsi ? ds_eraser_tips : native_eraser_tips
}

// ふとさの早見ボタンで選べるケシゴム (点・四角小・丸小・四角中・四角大・丸大)。
const eraser_quick = [1, 3, 8, 9, 13, 16]
const ds_eraser_quick = [1, 3, 7, 15]

export function native_eraser_for_size(mode: number, size: number, current: number): number {
  const shape = (mode === mode_dsi ? ds_eraser_sizes : eraser_sizes).indexOf(size)
  return shape < 0 ? -1 : (current & 8) | shape
}

// ケシゴムでベタ以外のもようを選んだら、もようの点だけを消すケシゴム (拡張側) にする。
export function native_eraser_for_pat(pat: number, current: number): number {
  return pat ? (current & 7) | 8 : current & 7
}

export const native_paint_bucket = 3
export const native_paint_labels = ['小 5px', '中 9px', '大 15px', 'バケツ']
// DSi のペイントは四角いペン先 (ふつうの箱は 3x3、上級の箱は 15x15)。バケツは ugonote2 の追加機能。
export const ds_paint_labels = ['小 3px', '中 7px', '大 15px', 'バケツ']

export function native_paint_labels_for(mode: number): string[] {
  return mode === mode_dsi ? ds_paint_labels : native_paint_labels
}

export function native_pen_tip(id: number, mode = 0): native_pen_tip_t {
  const tips = native_pen_tips_for(mode)
  return tips[id] || tips[2]
}

export function native_pen_valid(id: number): boolean {
  return Number.isInteger(id) && id >= 0 && id < native_pen_tips.length
}

export function native_eraser_valid(id: number): boolean {
  return Number.isInteger(id) && id >= 0 && id < native_eraser_tips.length
}

export function native_paint_valid(id: number): boolean {
  return Number.isInteger(id) && id >= 0 && id <= native_paint_bucket
}

// ペンと模様ブラシは同じペン先・ふとさで描く (模様ブラシは、もようの点だけを塗る)。
export function pen_tool(tool: number): boolean {
  return tool === t_pen || tool === t_patbrush
}

export function pen_quick_sizes(mode: number, tool: number): number[] {
  if (mode !== mode_normal && tool === t_eraser) return mode === mode_dsi ? ds_eraser_quick : eraser_quick
  if (mode === mode_normal || !pen_tool(tool)) return quick_sizes
  const sizes: number[] = []
  for (const tip of native_pen_tips_for(mode)) if (tip.shape === n_solid) sizes.push(tip.size)
  return sizes
}

export function pen_brush_allowed(mode: number, id: number): boolean {
  return mode === mode_normal ? brush_defs.some(b => b.id === id) : id === b_pen
}

// 図形 (直線・四角・まる) もペンのペン先で描き、ケシゴムは形で選ぶ。実機のペンにないフチドリは出さない。
// もようは ugonote2 の追加機能として、模様ブラシと図形で選べる (ペンはいつもベタで、実機と同じ線)。
export function pen_option_allowed(mode: number, tool: number, id: string): boolean {
  const pen_like = pen_tool(tool) || tool === t_line || tool === t_rect || tool === t_circle
  if (id === 'blk_native_eraser' || id === 'blk_native_paint') return mode !== mode_normal
  if (id === 'blk_brush' && !pen_tool(tool)) return mode !== mode_normal
  if (mode === mode_normal) return true
  if (id === 'blk_size' && tool !== t_patbrush && (pen_like || tool === t_eraser || tool === t_fill)) return false
  if (pen_like && id === 'blk_outline') return false
  return id !== 'blk_stroke' && id !== 'blk_alpha'
}

// もようは道具ごとに覚える (0: 模様ブラシ, 1: ぬる, 2: けしごむ, 3: 図形)。ペンはいつもベタで描く。
export function pen_pat_slot(tool: number): number {
  if (tool === t_patbrush) return 0
  if (tool === t_fill) return 1
  if (tool === t_eraser) return 2
  return is_shape_tool(tool) ? 3 : -1
}

// 不透明度はケシゴムだけ別に覚える (0: 描く道具, 1: けしごむ)。消す強さを下げてもペンが薄くならないようにする。
export function pen_tool_memory(p: pen_t, from: number, to: number): void {
  const a = pen_pat_slot(from)
  const b = pen_pat_slot(to)
  if (a >= 0) p.pat_mem[a] = p.pat
  if (b >= 0 && b !== a) p.pat = p.pat_mem[b] ?? 0
  if (to === t_pen) p.pat = 0
  // 模様ブラシは丸いペン先だけを使い、太さはペンと別に覚える。
  if ((from === t_patbrush) !== (to === t_patbrush)) {
    const keep = p.tip_mem
    p.tip_mem = { size: p.size, native_tip: p.native_tip, brush: p.brush }
    p.size = keep.size
    p.native_tip = keep.native_tip
    p.brush = keep.brush
  }
  const c = from === t_eraser ? 1 : 0
  const d = to === t_eraser ? 1 : 0
  if (c !== d) {
    p.alpha_mem[c] = p.alpha
    p.alpha = p.alpha_mem[d]
  }
}

export function pen_native_select(p: pen_t, id: number, mode: number): void {
  p.native_tip = id
  p.size = native_pen_tip(id, mode).size
  p.brush = b_pen
  p.mark_id = ''
}

export function pen_mode_normalize(p: pen_t, mode: number): void {
  if (mode === mode_normal) return
  p.native_tip = native_pen_valid(p.native_tip) ? p.native_tip : 2
  if (p.tool === t_patbrush && native_pen_tip(p.native_tip, mode).shape !== n_solid) p.native_tip = 9
  p.native_eraser = native_eraser_valid(p.native_eraser) ? p.native_eraser : 2
  p.native_paint = native_paint_valid(p.native_paint) ? p.native_paint : native_paint_bucket
  if (pen_tool(p.tool)) pen_native_select(p, p.native_tip, mode)
  else {
    p.brush = b_pen
    p.mark_id = ''
  }
  if (p.tool === t_eraser) p.size = native_eraser_tips_for(mode)[p.native_eraser].size
  p.alpha = 1
  p.pressure = 0
  p.smooth = 0
  p.ocolor = mode_color(mode, p.ocolor)
}
