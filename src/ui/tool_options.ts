import { q, ic } from '../dom'
import { lang, tr_line } from '../lang'
import { t_pen, t_patbrush, t_eraser, t_fill, t_line, t_rect, t_circle, t_pixel, mode_normal, shape_tool_list, is_shape_tool } from '../h'
import { st } from '../state/store'
import { pen_option_allowed } from '../penprofile'
import { tool_def } from './tool_defs'

// 道具ごとに出す設定。はんい・なげなわ・はりつけは操作バーで使うので、設定はない。
// ペンはもようを持たず (もようは模様ブラシ)、ドットの粗さはドットだけの設定。
const shapes = shape_tool_list
// 中を塗れる図形 (直線のほかすべて)。
const closed_shapes = shape_tool_list.slice(1)
export const opt_map: [string, readonly number[]][] = [
  ['blk_shape', shapes],
  ['blk_pat', [t_patbrush, t_eraser, t_fill, ...shapes]],
  ['blk_brush', [t_pen, t_line, t_rect, t_circle]],
  ['blk_native_eraser', [t_eraser]],
  ['blk_native_paint', [t_fill]],
  ['blk_size', [t_pen, t_patbrush, t_eraser, ...shapes]],
  ['blk_stroke', [t_pen, t_patbrush]],
  ['blk_sym', [t_pen, t_patbrush, t_pixel, ...shapes]],
  ['blk_alpha', [t_pen, t_patbrush, t_eraser, t_fill, ...shapes]],
  ['blk_outline', [t_pen, t_patbrush, ...shapes]],
  ['blk_fill', closed_shapes],
  ['blk_fill_tool', [t_fill]],
  ['blk_pxn', [t_pixel]],
]

export function tool_has_options(t: number): number {
  for (const [, list] of opt_map) if (list.indexOf(t) >= 0) return 1
  return 0
}

// いまの道具とモードで出す設定のまとまりを、その場でそろえる (道具を持ちかえた直後に設定を開いても正しいページになる)。
export function tool_blocks_sync(): void {
  const g = st()
  for (const [id, list] of opt_map) q(id).classList.toggle('off', !(list.indexOf(g.pen.tool) >= 0 && pen_option_allowed(g.doc.mode, g.pen.tool, id)))
}

// 設定を開いたときに最初に出すページ。
function tool_first_page(tool: number): string {
  if (is_shape_tool(tool)) return 'shape'
  switch (tool) {
    case t_pen: return 'brush'
    case t_patbrush: return 'pattern'
    case t_eraser: return 'size'
    case t_pixel: return 'grid'
    case t_fill: return st().doc.mode === mode_normal ? 'detail' : 'pattern'
    default: return 'detail'
  }
}

function tool_detail_label(tool: number): string {
  switch (tool) {
    case t_fill: return '塗り方'
    case t_eraser: return '消し方'
    default: return '線・効果'
  }
}

// page: ページの名前。'tool' はその道具の最初のページ、省略するといまのページのまま。
export function tool_page_show(page?: string, scroll = true): void {
  tool_blocks_sync()
  const body = q('tool_options')
  const t = st().pen.tool
  const available: string[] = []
  for (const block of body.querySelectorAll<HTMLElement>('.pbk:not(.off)')) {
    const name = block.dataset.optionsPage
    if (name && !available.includes(name)) available.push(name)
  }
  const wanted = page === 'tool' ? tool_first_page(t) : page || body.dataset.toolPage
  const current = wanted && available.includes(wanted) ? wanted : available[0] || 'detail'
  const changed = current !== body.dataset.toolPage
  const def = tool_def(t)
  const heading = q('tool_settings_name')
  heading.textContent = (def?.label || tr_line('どうぐ')) + (lang === 'en' ? ' settings' : 'の設定')
  heading.parentElement!.querySelector('.ic')!.outerHTML = ic(def?.icon || 'tools')
  q('tool_detail_name').textContent = tr_line(tool_detail_label(t))
  body.dataset.toolPage = current
  body.dataset.toolDetail = current === 'detail' ? '1' : '0'
  if (scroll || changed) {
    const target = body.querySelector<HTMLElement>(`[data-options-page="${current}"]:not(.off)`)
    body.scrollTop = target ? target.offsetTop - body.offsetTop : 0
  }
  for (const button of q('pop_tool').querySelectorAll<HTMLButtonElement>('button[data-tool-page]')) {
    button.hidden = !available.includes(button.dataset.toolPage!)
    button.setAttribute('aria-pressed', String(button.dataset.toolPage === current))
  }
}
