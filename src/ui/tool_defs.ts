import { t_pen, t_fill, t_eraser, t_eyedrop, t_pixel, t_line, t_rect, t_circle, t_star, t_heart, t_text, t_select, t_lasso, t_paste, t_hand } from '../h'
import { tr } from '../lang'

export type tool_def_t = {
  t: number
  icon: string
  label: string
  key: string
}

export const tool_defs: tool_def_t[] = [
  { t: t_pen, icon: 'pen', label: tr('ペン'), key: 'B' },
  { t: t_eraser, icon: 'eraser', label: tr('けしごむ'), key: 'E' },
  { t: t_fill, icon: 'fill', label: tr('ぬりつぶし'), key: 'G' },
  { t: t_eyedrop, icon: 'eyedrop', label: tr('スポイト'), key: 'I' },
  { t: t_pixel, icon: 'pixel', label: tr('ドット'), key: 'P' },
  { t: t_line, icon: 'line', label: tr('直線'), key: 'L' },
  { t: t_rect, icon: 'rect', label: tr('四角'), key: 'U' },
  { t: t_circle, icon: 'circle', label: tr('まる'), key: 'O' },
  { t: t_star, icon: 'star', label: tr('ほし'), key: '' },
  { t: t_heart, icon: 'heart', label: tr('ハート'), key: '' },
  { t: t_text, icon: 'text', label: tr('もじ'), key: 'T' },
  { t: t_select, icon: 'select', label: tr('はんい'), key: 'M' },
  { t: t_lasso, icon: 'lasso', label: tr('なげなわ'), key: '' },
  { t: t_paste, icon: 'paste', label: tr('はりつけ'), key: 'V' },
  { t: t_hand, icon: 'hand', label: tr('移動'), key: 'H' },
]

export function tool_def(tool: number): tool_def_t | null {
  for (let i = 0; i < tool_defs.length; i++) {
    if (tool_defs[i].t === tool) return tool_defs[i]
  }
  return null
}

