import { q, toast } from '../dom'
import { clip_img } from '../engine'
import { k_none, mode_normal, t_lasso, t_paste, t_select } from '../h'
import { mark_capture_from_selection } from '../mark'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { ctx_hide, pop_close, pop_open, rail_sheet } from './overlay'
import { tool_pick } from './stage_input'
import { toolbar_place, type toolbar_rect_t } from './toolbar_placement'

type globals_ro_t = ReturnType<typeof st>

// マイマークの「選択範囲から登録」で、範囲をえらぶのを待っているか (1)。待つあいだは「マーク登録」を目立たせる。
// 登録が終わったら、もとの道具にもどしてマイマークを開く。tool はその前に持っていた道具。
const mark_wait = { on: 0, tool: 0 }

export function mark_wait_start(tool: number): void {
  mark_wait.on = 1
  mark_wait.tool = tool
}

// コピーした絵が変わったかどうか (はりつけボタンの見本を描きなおすのに使う)。
let clip_seen: globals_ro_t['clip'] = null

// はりつけボタンに、コピーした絵の見本を出す。
function clip_thumbs_draw(): void {
  const img = clip_img()
  for (const cv of document.querySelectorAll<HTMLCanvasElement>('.clip_thumb')) {
    const x = cv.getContext('2d')!
    x.clearRect(0, 0, cv.width, cv.height)
    if (!img || !img.width || !img.height) continue
    const scale = Math.min(cv.width / img.width, cv.height / img.height)
    const w = img.width * scale
    const h = img.height * scale
    x.imageSmoothingEnabled = scale < 1
    x.drawImage(img, (cv.width - w) / 2, (cv.height - h) / 2, w, h)
  }
}

function clip_changed(g: globals_ro_t): void {
  if (g.clip === clip_seen) return
  clip_seen = g.clip
  if (g.clip) clip_thumbs_draw()
}

// 一列に収まらないときは、5列2段にならべる。
function bar_rows(bar: HTMLElement, room: number): void {
  bar.dataset.rows = '1'
  const need = bar.id === 'flo_bar' ? q('flo_tools').scrollWidth + q('flo_actions').offsetWidth + 20 : bar.scrollWidth
  bar.dataset.rows = need > room ? '2' : '1'
}

export function selection_toolbar_render(g: globals_ro_t): void {
  const context = g.flo.kind !== k_none ? 'transform' : g.sel.has ? 'selection' : 'draw'
  const previous = document.body.dataset.editContext || 'draw'
  document.body.dataset.editContext = context
  if (context !== 'draw' && previous !== context) {
    pop_close()
    rail_sheet(0)
    ctx_hide()
  }
  clip_changed(g)
  const selection = q('sel_bar')
  const transform = q('flo_bar')
  const normal = g.doc.mode === mode_normal
  selection.classList.toggle('on', context === 'selection')
  transform.classList.toggle('on', context === 'transform')
  q('paste_btn').hidden = !g.clip
  q('sb_mark').hidden = !normal
  // 範囲をえらぶ道具をはなれたら、待つのをやめる。
  if (mark_wait.on && context === 'draw' && g.pen.tool !== t_select && g.pen.tool !== t_lasso) mark_wait.on = 0
  q('sb_mark').classList.toggle('wait', !!mark_wait.on)
  q('sb_invert').title = normal ? '選択範囲の色を反転' : '選択範囲の塗りと透明を入れ替え'
  q('sb_paint_mode').setAttribute('aria-pressed', String(!!g.pen.paint_over))
  if (context === 'draw') {
    if (previous === 'selection') {
      pop_close()
      ctx_hide()
    }
    return
  }
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
  const paper = { x: left, y: top, w: Math.max(44, right - left), h: Math.max(44, bottom - top) }
  const bar = context === 'transform' ? transform : selection
  bar.style.maxWidth = ''
  bar_rows(bar, paper.w)
  bar.style.maxWidth = paper.w + 'px'
  const width = bar.offsetWidth
  const height = bar.offsetHeight
  const obstacles: toolbar_rect_t[] = []
  for (const element of document.querySelectorAll<HTMLElement>('#hd, #layer_stack, #mobile_tools, #tl_bar, .tl_tail, .tl_transport, #frame_panel, #fs, #frame_no, .pop.on, #rail.on, #ctx_menu:not(.hide)')) {
    if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') continue
    const r = element.getBoundingClientRect()
    if (!r.width || !r.height) continue
    obstacles.push({ x: r.left - wrap.left, y: r.top - wrap.top, w: r.width, h: r.height })
  }
  const preferred = context === 'selection'
    ? { x: g.view.px + (g.sel.x + g.sel.w / 2) * g.view.z - width / 2, y: g.view.py + g.sel.y * g.view.z - height - 10 }
    : { x: paper.x + (paper.w - width) / 2, y: paper.y }
  const point = toolbar_place(paper, width, height, preferred, obstacles)
  bar.style.left = point.x + 'px'
  bar.style.top = point.y + 'px'
}

export function selection_toolbar_events(): void {
  const on = (id: string, fn: () => void) => q(id).addEventListener('click', fn)
  on('sb_t', () => dispatch('sel.transform', null))
  on('sb_c', () => dispatch('sel.copy', null))
  on('sb_x', () => dispatch('sel.cut', null))
  on('sb_del', () => dispatch('sel.delete', null))
  on('paste_btn', () => tool_pick(t_paste, 0))
  on('sb_fill', () => dispatch('sel.paint', null))
  on('sb_paint_mode', () => dispatch('pen.set_paint_over', st().pen.paint_over ? 0 : 1))
  on('sb_invert', () => dispatch('sel.invert', null))
  on('sb_register_paint', () => dispatch('sel.register_paint', null))
  on('sb_mark', () => {
    mark_capture_from_selection('マーク', ok => {
      toast(ok ? 'マークに登録しました' : 'いまのレイヤーの、えらんだ所に絵がありません（レイヤーを切りかえてね）')
      if (!ok) return
      sfx_play('save')
      if (!mark_wait.on) return
      mark_wait.on = 0
      dispatch('sel.clear', null)
      tool_pick(mark_wait.tool)
      // 範囲をけした画面が描きなおされてから開く (範囲の操作が終わると、開いている画面は閉じられるため)。
      requestAnimationFrame(() => requestAnimationFrame(() => pop_open('pop_mark', q('dock_more'))))
    })
  })
  on('sb_q', () => dispatch('sel.clear', null))
  on('flo_rot_l', () => dispatch('flo.rot', -1))
  on('flo_rot_r', () => dispatch('flo.rot', 1))
  on('flo_flip_h', () => dispatch('flo.flip', 0))
  on('flo_flip_v', () => dispatch('flo.flip', 1))
  on('flo_reset', () => dispatch('flo.reset', null))
  on('flo_ok', () => dispatch('flo.confirm', null))
  on('flo_no', () => dispatch('flo.cancel', null))
}
