import { t_pen, t_patbrush, t_fill, t_eraser, t_eyedrop, t_pixel, t_line, t_rect, t_circle, t_star, t_heart, t_text, t_select, t_lasso, t_paste, t_hand } from '../h'
import { t_tri, t_rtri, t_diamond, t_pentagon, t_hexagon, t_octagon, t_roundrect, t_arrow, t_bubble, t_cloud, t_moon, t_cross, t_bolt, t_drop, t_sparkle, t_flower, shape_index, shape_tool_list } from '../h'
import { icon_add } from '../dom'
import { shape_pts } from '../gfx'
import { tr } from '../lang'

export type tool_def_t = {
  t: number
  icon: string
  label: string
  key: string
}

export const tool_defs: tool_def_t[] = [
  { t: t_pen, icon: 'pen', label: tr('ペン'), key: 'B' },
  { t: t_patbrush, icon: 'patbrush', label: tr('模様ブラシ'), key: 'Y' },
  { t: t_eraser, icon: 'eraser', label: tr('けしごむ'), key: 'E' },
  { t: t_fill, icon: 'fill', label: tr('ぬりつぶし'), key: 'G' },
  { t: t_eyedrop, icon: 'eyedrop', label: tr('スポイト'), key: 'I' },
  { t: t_pixel, icon: 'pixel', label: tr('ドット'), key: 'P' },
  { t: t_text, icon: 'text', label: tr('もじ'), key: 'T' },
  { t: t_line, icon: 'line', label: tr('直線'), key: 'L' },
  { t: t_rect, icon: 'rect', label: tr('四角'), key: 'U' },
  { t: t_circle, icon: 'circle', label: tr('まる'), key: 'O' },
  { t: t_star, icon: 'star', label: tr('ほし'), key: '' },
  { t: t_heart, icon: 'heart', label: tr('ハート'), key: '' },
  { t: t_tri, icon: 'shape_tri', label: tr('さんかく'), key: '' },
  { t: t_rtri, icon: 'shape_rtri', label: tr('直角三角'), key: '' },
  { t: t_diamond, icon: 'shape_diamond', label: tr('ひしがた'), key: '' },
  { t: t_pentagon, icon: 'shape_pentagon', label: tr('五角形'), key: '' },
  { t: t_hexagon, icon: 'shape_hexagon', label: tr('六角形'), key: '' },
  { t: t_octagon, icon: 'shape_octagon', label: tr('八角形'), key: '' },
  { t: t_roundrect, icon: 'shape_roundrect', label: tr('かどまる'), key: '' },
  { t: t_arrow, icon: 'shape_arrow', label: tr('やじるし'), key: '' },
  { t: t_bubble, icon: 'shape_bubble', label: tr('ふきだし'), key: '' },
  { t: t_cloud, icon: 'shape_cloud', label: tr('くも'), key: '' },
  { t: t_moon, icon: 'shape_moon', label: tr('つき'), key: '' },
  { t: t_cross, icon: 'shape_cross', label: tr('じゅうじ'), key: '' },
  { t: t_bolt, icon: 'shape_bolt', label: tr('いなずま'), key: '' },
  { t: t_drop, icon: 'shape_drop', label: tr('しずく'), key: '' },
  { t: t_sparkle, icon: 'shape_sparkle', label: tr('キラキラ'), key: '' },
  { t: t_flower, icon: 'shape_flower', label: tr('はな'), key: '' },
  { t: t_select, icon: 'select', label: tr('はんい'), key: 'M' },
  { t: t_lasso, icon: 'lasso', label: tr('なげなわ'), key: '' },
  { t: t_paste, icon: 'paste', label: tr('はりつけ'), key: 'V' },
  { t: t_hand, icon: 'hand', label: tr('移動'), key: 'H' },
]

// 右メニューの「図形」ボタンは、最後に使った図形を覚えておいてすぐ描けるようにする。
export const shape_tools = shape_tool_list

// 道具箱で、ほかの図形と同じ1行にならべる図形の数 (のこりは「その他」から選ぶ)。
export const shape_row = 4

// あとから足した図形のアイコンは、描く形と同じ点を 24×24 のわくに入れて作る (矢印は左下から右上へ)。
for (const def of tool_defs) {
  if (!def.icon.startsWith('shape_')) continue
  const kind = shape_index(def.t)
  const pts = kind === shape_index(t_arrow) ? shape_pts(kind, 3, 18, 21, 6) : shape_pts(kind, 3, 3, 21, 21)
  let d = ''
  for (let i = 0; i < pts.length; i += 2) d += (i ? 'L' : 'M') + pts[i].toFixed(1) + ' ' + pts[i + 1].toFixed(1)
  icon_add(def.icon, '<path d="' + d + 'Z"/>')
}
export const shape_memory = { tool: t_line }

export function tool_def(tool: number): tool_def_t | null {
  for (let i = 0; i < tool_defs.length; i++) {
    if (tool_defs[i].t === tool) return tool_defs[i]
  }
  return null
}

