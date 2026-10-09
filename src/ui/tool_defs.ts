import { T_PEN, T_FILL, T_ERASER, T_EYEDROP, T_PIXEL, T_LINE, T_RECT, T_CIRCLE, T_STAR, T_HEART, T_TEXT, T_SELECT, T_LASSO, T_PASTE, T_HAND } from '../h'
import { tr } from '../lang'

export const TOOL_DEFS: { t: number, icon: string, label: string, key: string }[] = [
  { t: T_PEN, icon: 'pen', label: tr('ペン'), key: 'B' },
  { t: T_ERASER, icon: 'eraser', label: tr('けしごむ'), key: 'E' },
  { t: T_FILL, icon: 'fill', label: tr('ぬりつぶし'), key: 'G' },
  { t: T_EYEDROP, icon: 'eyedrop', label: tr('スポイト'), key: 'I' },
  { t: T_PIXEL, icon: 'pixel', label: tr('ドット'), key: 'P' },
  { t: T_LINE, icon: 'line', label: tr('直線'), key: 'L' },
  { t: T_RECT, icon: 'rect', label: tr('四角'), key: 'U' },
  { t: T_CIRCLE, icon: 'circle', label: tr('まる'), key: 'O' },
  { t: T_STAR, icon: 'star', label: tr('ほし'), key: '' },
  { t: T_HEART, icon: 'heart', label: tr('ハート'), key: '' },
  { t: T_TEXT, icon: 'text', label: tr('もじ'), key: 'T' },
  { t: T_SELECT, icon: 'select', label: tr('はんい'), key: 'M' },
  { t: T_LASSO, icon: 'lasso', label: tr('なげなわ'), key: '' },
  { t: T_PASTE, icon: 'paste', label: tr('はりつけ'), key: 'V' },
  { t: T_HAND, icon: 'hand', label: tr('移動'), key: 'H' },
]

