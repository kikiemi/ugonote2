import { q, ic } from '../dom'
import { lang, tr_line } from '../lang'
import { t_pen, t_eraser, t_fill, t_line, t_rect, t_circle, t_star, t_heart, t_pixel, t_select, t_lasso, t_paste, mode_normal } from '../h'
import { st } from '../state/store'
import { tool_def } from './tool_defs'

export const opt_map: [string, number[]][] = [
  ['blk_brush', [t_pen]],
  ['blk_size', [t_pen, t_eraser, t_line, t_rect, t_circle, t_star, t_heart]],
  ['blk_stroke', [t_pen]],
  ['blk_sym', [t_pen, t_pixel, t_line, t_rect, t_circle, t_star, t_heart]],
  ['blk_alpha', [t_pen, t_fill, t_line, t_rect, t_circle, t_star, t_heart]],
  ['blk_pat', [t_pen, t_eraser, t_fill, t_line, t_rect, t_circle, t_star, t_heart]],
  ['blk_outline', [t_pen, t_line, t_rect, t_circle, t_star, t_heart]],
  ['blk_fill', [t_rect, t_circle, t_star, t_heart]],
  ['blk_fill_tool', [t_fill]],
  ['blk_pxn', [t_pixel]],
  ['blk_sel', [t_select, t_lasso]],
  ['blk_paste', [t_paste]],
]

export function tool_has_options(t: number): number {
  for (const [, list] of opt_map) if (list.indexOf(t) >= 0) return 1
  return 0
}

function tool_settings_page(tool: number): string {
  switch (tool) {
    case t_pen: return 'brush'
    case t_eraser: return 'size'
    case t_pixel: return 'grid'
    default: return 'detail'
  }
}

function tool_detail_label(tool: number): string {
  switch (tool) {
    case t_select:
    case t_lasso: return '選択操作'
    case t_paste: return '貼り付け'
    case t_fill: return '塗り方'
    default: return '線・効果'
  }
}

function tool_page_hint(page: string, tool: number): string {
  switch (page) {
    case 'brush': return '種類を選んで試し描きできます'
    case 'size': return '丸い見本・数字で太さを調整'
    case 'pattern': return '塗る模様と塗り方を選びます'
    case 'grid': return 'ドットの粗さを選びます'
  }
  switch (tool) {
    case t_select:
    case t_lasso: return '選んだ範囲に操作を適用します'
    case t_paste: return 'コピーした絵を置いて確定します'
    case t_fill: return '塗りつぶす範囲を選びます'
  }
  if (st().doc.mode === mode_normal) return '縁取り・透明度などを調整します'
  return '縁取り・対称描画を調整します'
}

export function tool_page_show(page?: string, scroll = true): void {
  const body = q('tool_options')
  const pages = body.querySelectorAll<HTMLElement>('.pbk:not(.off)')
  const available: (string | undefined)[] = []
  for (let i = 0; i < pages.length; i++) available.push(pages[i].dataset.optionsPage)
  const t = st().pen.tool
  const selected = page === 'tool' ? tool_settings_page(t) : page || body.dataset.toolPage
  const current = selected && available.includes(selected) ? selected : available[0] || 'detail'
  const changed = current !== body.dataset.toolPage
  const tool = tool_def(t)
  q('tool_detail_name').textContent = tr_line(tool_detail_label(t))
  q('tool_help').textContent = tr_line(tool_page_hint(current, t))
  let icon = tool?.icon || 'tools'
  switch (current) {
    case 'grid':
      icon = 'pixel'
      break
    case 'size':
      icon = 'adjust'
      break
    case 'pattern':
      icon = 'paint'
      break
  }
  q('tool_settings_name').textContent = current === 'grid' ? tr_line('ドットの設定') : (tool?.label || tr_line('どうぐ')) + (lang === 'en' ? ' settings' : 'の設定')
  q('tool_settings_name').parentElement!.querySelector('.ic')!.outerHTML = ic(icon)
  body.dataset.toolPage = current
  body.dataset.toolDetail = current === 'detail' ? '1' : '0'
  const target = body.querySelector<HTMLElement>(`[data-options-page="${current}"]:not(.off)`)
  if (scroll || changed) body.scrollTop = target ? target.offsetTop - body.offsetTop : 0
  for (const button of q('pop_tool').querySelectorAll<HTMLButtonElement>('button[data-tool-page]')) {
    button.hidden = !available.includes(button.dataset.toolPage)
    button.setAttribute('aria-pressed', button.dataset.toolPage === current ? 'true' : 'false')
  }
}

