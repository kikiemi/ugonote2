import { q } from '../dom'
import { k_none, mode_normal } from '../h'
import type { st } from '../state/store'
import { ctx_hide, pop_close, rail_sheet } from './overlay'
import { toolbar_place } from './toolbar_placement'
import type { toolbar_rect_t } from './toolbar_placement'

export function selection_toolbar_render(g: ReturnType<typeof st>): void {
  const context = g.flo.kind !== k_none ? 'transform' : g.sel.has ? 'selection' : 'draw'
  const previous = document.body.dataset.editContext || 'draw'
  document.body.dataset.editContext = context
  if (context !== 'draw' && previous !== context) {
    pop_close()
    rail_sheet(0)
    ctx_hide()
  }
  const selection = q('sel_bar')
  const transform = q('flo_bar')
  selection.classList.toggle('on', context === 'selection')
  transform.classList.toggle('on', context === 'transform')
  q('sb_p').hidden = !g.clip
  q('sb_invert').title = g.doc.mode === mode_normal ? '選択範囲の色を反転する（透明度はそのまま）' : '選択範囲の塗りと透明を入れ替える'
  q('sb_paint_mode').setAttribute('aria-pressed', String(!!g.pen.paint_over))
  const normal = g.doc.mode === mode_normal
  q('sb_paint_mode').querySelector('i')!.textContent = g.pen.paint_over ? 'うわがき' : normal ? '塗り重ね' : 'ふつう'
  q('sb_paint_mode').title = g.pen.paint_over ? 'うわがきペイント（押すと' + (normal ? '塗り重ね' : 'ふつう') + 'へ）' : (normal ? '塗り重ね' : 'ふつうのペイント') + '（押すとうわがきへ）'
  if (context === 'draw') { if (previous === 'selection') { pop_close(); ctx_hide() }; return }
  if (context === 'transform') {
    const deg = Math.round(g.flo.rot * 180 / Math.PI) % 360
    q('flo_info').textContent = deg + '°・' + Math.round(Math.abs(g.flo.sx) * 100) + '%'
  }
  const wrap = q('stage_wrap').getBoundingClientRect()
  if (!wrap.width || !wrap.height) return
  const fit = q('paper_fit').getBoundingClientRect()
  const left = Math.max(8, fit.left - wrap.left + 8)
  const top = Math.max(8, fit.top - wrap.top + 8)
  const right = Math.min(wrap.width - 8, fit.right - wrap.left - 8)
  const bottom = Math.min(wrap.height - 8, fit.bottom - wrap.top - 8)
  const bounds = { x: left, y: top, w: Math.max(44, right - left), h: Math.max(44, bottom - top) }
  const bar = context === 'transform' ? transform : selection
  bar.style.maxWidth = bounds.w + 'px'
  const width = bar.offsetWidth
  const height = bar.offsetHeight
  const preferred = context === 'transform'
    ? { x: bounds.x + (bounds.w - width) / 2, y: bounds.y }
    : { x: g.view.px + (g.sel.x + g.sel.w / 2) * g.view.z - width / 2, y: g.view.py + g.sel.y * g.view.z - height - 10 }
  const obstacles: toolbar_rect_t[] = []
  for (const element of document.querySelectorAll<HTMLElement>('#hd, #layer_stack, #mobile_tools, #tl_bar, .tl_tail, .tl_transport, #frame_panel, #fs, #frame_no, .pop.on, #rail.on, #ctx_menu:not(.hide)')) {
    if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') continue
    const r = element.getBoundingClientRect()
    if (!r.width || !r.height) continue
    obstacles.push({ x: r.left - wrap.left, y: r.top - wrap.top, w: r.width, h: r.height })
  }
  const point = toolbar_place(bounds, width, height, preferred, obstacles)
  bar.style.left = point.x + 'px'
  bar.style.top = point.y + 'px'
}
