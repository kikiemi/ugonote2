import { q } from '../dom'
import { clamp } from '../lib'
import { pref_layout } from '../prefs'
import { d_sel, d_timeline } from '../h'
import { dirty, st } from '../state/store'
import { overlay_state } from './overlay_state'
import { workspace_media, workspace_layout_choice, type workspace_profile_t } from './workspace_policy'

export function workspace_layout_render(): void {
  const g = st()
  const profile = workspace_media()
  const body = document.body
  const timeline = g.view.tlopen ? '1' : '0'
  const changed = body.dataset.tl !== timeline
  body.dataset.short = String(profile.short)
  body.dataset.phone = String(profile.phone)
  body.dataset.tablet = String(profile.tablet)
  body.dataset.mobile = String(g.mobile)
  body.dataset.wideTools = String(profile.wide)
  body.dataset.extendedTools = String(profile.extended)
  body.dataset.desktop = String(profile.desktop)
  body.dataset.workspace = profile.landscape ? 'landscape' : profile.wide ? 'wide' : 'portrait'
  body.dataset.layout = workspace_layout_choice(profile, pref_layout())
  body.dataset.tl = timeline
  if (!profile.landscape || changed) q('layer_stack').dataset.open = ''
  // 画面の下でコマ一覧と再生のバーが使っている高さ。広い画面の右メニュー・紙・道具の設定は、この上で止める。
  body.style.setProperty('--tl_space', Math.round(innerHeight - q('tl').getBoundingClientRect().top) + 'px')
  dock_fit(profile.wide)
  body.dataset.free = g.doc.ratio === 'free' ? '1' : '0'
  body.dataset.vflip = String(g.view.flip ? 1 : 0)
  q('layout_choices').hidden = !profile.choices
  for (const name of ['simple', 'studio']) q('layout_' + name).setAttribute('aria-pressed', String(name.toLowerCase() === body.dataset.layout))
  q('tl_toggle').title = g.view.tlopen ? 'コマ一覧を閉じる' : 'コマ一覧を開く'
  q('tl_toggle').setAttribute('aria-expanded', String(!!g.view.tlopen))
  if (changed && g.view.tlopen) dirty(d_timeline)
  layer_stack_layout()
  drawing_menu_layout(profile)
  layer_cover()
  if (overlay_state.context_anchor) workspace_context_layout(q('ctx_menu'), overlay_state.context_anchor)
}

// 広い画面の右メニューがコマ一覧の上に入りきらないときは、ボタンを低くし (1)、それでも入らなければ見出しも省いて (2)、
// スクロールで下のボタンが切れないようにする。
function dock_fit(wide: number): void {
  const dock = q('mobile_tools')
  const row = q('dock_row')
  for (const level of ['0', '1', '2']) {
    document.body.dataset.dockFit = level
    if (!wide || dock.scrollHeight <= dock.clientHeight + 1 && row.scrollHeight <= row.clientHeight + 1) return
  }
}

// パネルのページを1つずつ出す関数。最後の1つで、もとのページへもどす。
function sheet_page_views(panel: HTMLElement, body: HTMLElement): (() => void)[] {
  if (body.id === 'tool_options') {
    const page = body.dataset.toolPage
    const detail = body.dataset.toolDetail
    const show = (name: string | undefined, is_detail: string | undefined) => () => {
      body.dataset.toolPage = name
      body.dataset.toolDetail = is_detail
    }
    const tabs = [...panel.querySelectorAll<HTMLElement>('button[data-tool-page]')].filter(tab => !tab.hidden)
    return [...tabs.map(tab => show(tab.dataset.toolPage, tab.dataset.toolPage === 'detail' ? '1' : '0')), show(page, detail)]
  }
  const pages = [...body.querySelectorAll<HTMLElement>(':scope > [data-sheet-page]')]
  const shown = pages.find(page => !page.hidden)
  const show = (target: HTMLElement | undefined) => () => {
    for (const page of pages) page.hidden = page !== target
  }
  return [...pages.map(show), show(shown)]
}

// 高さを決める条件 (道具・モード・画面の大きさ・出ているページなど)。変わらないあいだは測りなおさない
// (色やふとさを選ぶたびにページを裏で切りかえて測ると、スライダーを動かしている最中にも走ってしまう)。
const sheet_heights = new Map<string, { key: string, height: number }>()

function sheet_key(panel: HTMLElement): string {
  const g = st()
  const p = g.pen
  const tabs = [...panel.querySelectorAll<HTMLElement>('[data-tool-page], [data-sheet-tab]')].filter(tab => !tab.hidden).map(tab => tab.dataset.toolPage || tab.dataset.sheetTab).join(',')
  return [p.tool, g.doc.mode, panel.style.width, innerWidth, innerHeight, tabs, p.native_tip >= 8, p.native_eraser >= 8, p.custom.length, p.pal_mode, g.doc.lord.length, panel.dataset.sample, panel.dataset.tight].join('|')
}

// いちばん高いページを出したときのパネルの高さ。
function sheet_natural(panel: HTMLElement): number {
  const key = sheet_key(panel)
  const known = sheet_heights.get(panel.id)
  if (known && known.key === key) return known.height
  const height = sheet_measure(panel)
  sheet_heights.set(panel.id, { key, height })
  return height
}

// 縦に入りきらないときは、余白とボタンを小さくした詰めた形にする (1、それでも入らなければ 1 2)。横には広げない。
function sheet_fit(panel: HTMLElement, space: number): number {
  let natural = sheet_natural(panel)
  for (const level of ['1', '1 2']) {
    if (natural <= space) break
    panel.dataset.tight = level
    natural = sheet_natural(panel)
  }
  return natural
}

function sheet_measure(panel: HTMLElement): number {
  const body = panel.querySelector<HTMLElement>('#tool_options, .sheet_body, .pop_body')
  if (!body) return panel.offsetHeight
  const scroll = body.scrollTop
  panel.style.height = ''
  panel.style.maxHeight = 'none'
  body.style.flex = '0 0 0px'
  // 見本などはページによって出たり消えたりするので、ページごとにパネル全体の高さを測る。
  let height = 0
  for (const show of sheet_page_views(panel, body)) {
    show()
    height = Math.max(height, panel.offsetHeight - body.offsetHeight + body.scrollHeight)
  }
  body.style.flex = ''
  body.scrollTop = scroll
  return height
}

function anchored_panel_layout(panel: HTMLElement, anchor: HTMLElement, beside: number): void {
  const rect = anchor.getBoundingClientRect()
  const safe = getComputedStyle(q('app'))
  const left = Math.max(8, parseFloat(safe.getPropertyValue('--safe_left')) || 0)
  const right = innerWidth - Math.max(8, parseFloat(safe.getPropertyValue('--safe_right')) || 0)
  const top = Math.max(8, parseFloat(safe.getPropertyValue('--safe_top')) || 0)
  let bottom = innerHeight - Math.max(8, parseFloat(getComputedStyle(q('tl')).paddingBottom) || 0)
  const drawing = panel.classList.contains('drawing_bench')
  const fixed = panel.classList.contains('sheet')
  // 道具の設定や、横にならべるレイヤーのパネルは、コマ一覧にかぶせない。
  if ((drawing || fixed && beside) && st().view.tlopen) {
    const timeline = q('frame_panel').getBoundingClientRect().top - 8
    if (timeline >= top + 200) bottom = Math.min(bottom, timeline)
  }
  panel.style.width = ''
  panel.style.height = ''
  panel.style.bottom = ''
  panel.dataset.cover = ''
  panel.dataset.side = ''
  panel.dataset.tight = ''
  panel.style.maxHeight = bottom - top + 'px'
  panel.style.overflowY = fixed ? 'hidden' : 'auto'
  panel.style.transform = 'none'
  const width = Math.min(panel.offsetWidth, drawing ? 440 : 380, right - left)
  panel.style.width = width + 'px'
  // 「うごかす」のように紙を見ながら使う画面は、スマホでは右メニューのかわりに画面の下に出す。
  if (panel.classList.contains('bottom_bar') && document.body.dataset.phone === '1') {
    panel.style.width = right - left + 'px'
    panel.style.left = left + 'px'
    panel.style.top = bottom - panel.offsetHeight + 'px'
    return
  }
  // 右メニューやレイヤーの列のボタンから開くときは、ボタンではなく列全体の外に出して、ほかのボタンを隠さない。
  const group = anchor.closest('#mobile_tools, #layer_stack')?.getBoundingClientRect() || rect
  const space_right = right - group.right - 8
  const space_left = group.left - left - 8
  if (beside && Math.max(space_right, space_left) >= Math.min(width, 220)) {
    const use_right = space_right >= Math.min(width, 220)
    panel.style.width = Math.min(width, use_right ? space_right : space_left) + 'px'
    // 横にならべるときは、タブを見出しのすぐ下に出し、高さはいまのページの中身に合わせる (下に余白を残さない)。
    // 上の端は、いちばん高いページも下まで入る位置にそろえるので、ページを切りかえても見出しとタブは動かず、中も切れない。
    panel.dataset.side = fixed ? '1' : ''
    // ほかの画面 (マイマークなど) も、ボタンの高さから下に入りきらなければ上へずらし、中身がぜんぶ見えるようにする。
    const height = fixed ? Math.min(bottom - top, sheet_fit(panel, bottom - top)) : Math.min(panel.offsetHeight, bottom - top)
    const start = clamp(rect.top, top, Math.max(top, bottom - height))
    panel.style.maxHeight = bottom - start + 'px'
    panel.style.left = (use_right ? group.right + 8 : group.left - panel.offsetWidth - 8) + 'px'
    panel.style.top = start + 'px'
    return
  }
  const row = group.width > group.height ? group : rect
  const above = Math.max(0, row.top - top - 8)
  const below = Math.max(0, bottom - row.bottom - 8)
  const wanted = fixed ? Math.min(Math.max(above, below), sheet_fit(panel, Math.max(above, below))) : panel.offsetHeight
  const use_above = above >= wanted || above >= below
  const space = use_above ? above : below
  panel.style.left = clamp(rect.right - panel.offsetWidth, left, right - panel.offsetWidth) + 'px'
  if (fixed && use_above) {
    // スマホでは下の端を右メニューのすぐ上にそろえ、ページの中身に合わせて上へのびちぢみさせる (下のタブは動かない)。
    // 中をスクロールしなくてすむよう上いっぱいまで使い、それでも入らない道具は右メニューにも重ねて画面いっぱいに出す。
    const cover = sheet_natural(panel) > space
    panel.dataset.cover = cover ? '1' : ''
    panel.style.maxHeight = (cover ? bottom - top : space) + 'px'
    panel.style.top = 'auto'
    panel.style.bottom = (cover ? innerHeight - bottom : innerHeight - row.top + 8) + 'px'
    return
  }
  if (fixed) {
    // ボタンの下に出すときも、入りきらなければ上の端まで使い (ボタンの列にかぶせる)、中をスクロールしなくてすむようにする。
    const natural = sheet_natural(panel)
    const cover = natural > space
    const room = cover ? bottom - top : space
    panel.dataset.cover = cover ? '1' : ''
    panel.style.height = Math.min(natural, room) + 'px'
    panel.style.maxHeight = room + 'px'
    panel.style.top = (cover ? top : use_above ? row.top - panel.offsetHeight - 8 : row.bottom + 8) + 'px'
    return
  }
  panel.style.maxHeight = space + 'px'
  panel.style.top = (use_above ? row.top - panel.offsetHeight - 8 : row.bottom + 8) + 'px'
}

function pop_anchor_layout(): void {
  if (!overlay_state.anchor) return
  if (!overlay_state.pop) return
  const panel = q(overlay_state.pop)
  const layer_side = getComputedStyle(q('live_layer_tabs')).flexDirection === 'column' || document.body.dataset.workspace === 'landscape'
  const beside = panel.classList.contains('drawing_bench') || overlay_state.pop === 'pop_mark' || overlay_state.pop === 'pop_tf' || overlay_state.pop === 'pop_layer' && layer_side ? 1 : 0
  anchored_panel_layout(q(overlay_state.pop), overlay_state.anchor, beside)
}

function drawing_menu_layout(profile: workspace_profile_t): void {
  const dock = q('mobile_tools')
  const drawing = overlay_state.pop === 'pop_tool' || overlay_state.pop === 'pop_color' || overlay_state.pop === 'pop_tf'
  const rail = q('rail').classList.contains('on')
  document.body.dataset.toolbox = rail ? '1' : '0'
  q('view_onion_btn').setAttribute('aria-expanded', String(!!rail))
  const active = drawing || rail
  document.body.dataset.drawingMenu = active ? '1' : '0'
  document.body.dataset.pop = overlay_state.pop
  dirty(d_sel)
  if (drawing) {
    document.body.dataset.drawingLayout = 'anchored'
    for (const button of dock.querySelectorAll<HTMLElement>('button')) button.setAttribute('aria-expanded', String(button === overlay_state.anchor))
    pop_anchor_layout()
    return
  }
  if (profile.wide) {
    document.body.dataset.drawingLayout = rail ? 'split' : 'sheet'
  } else {
    const full = rail && (innerWidth < 960 || innerHeight <= 520)
    const split = !full && rail && innerWidth > innerHeight && innerWidth >= 640 && innerHeight >= 301
    document.body.dataset.drawingLayout = full ? 'full' : split ? 'split' : 'sheet'
    if (split) {
      const rect = dock.getBoundingClientRect()
      document.documentElement.style.setProperty('--drawing_bay_right', `${innerWidth - rect.left + 14}px`)
    }
  }
  toolbox_fit(rail)
  for (const button of dock.querySelectorAll<HTMLElement>('button')) button.setAttribute('aria-expanded', String(button === overlay_state.anchor && !!overlay_state.pop || button.getAttribute('aria-controls') === 'rail' && rail))
  if (overlay_state.anchor) overlay_state.anchor.setAttribute('aria-expanded', 'true')
  pop_anchor_layout()
}

// 道具箱のどのページかが縦に入りきらないときは、余白とタイルを小さくした詰めた形にする (1、それでも入らなければ 1 2)。横には広げない。
// 画面の大きさなどが変わらないあいだは測りなおさない。
let toolbox_key = ''

function toolbox_fit(open: boolean): void {
  const body = document.body
  if (!open) {
    toolbox_key = ''
    body.dataset.toolboxFit = ''
    return
  }
  const key = [innerWidth, innerHeight, body.dataset.tl, body.dataset.layout, body.dataset.drawingLayout, body.dataset.extendedTools].join('|')
  if (key === toolbox_key) return
  toolbox_key = key
  body.dataset.toolboxFit = ''
  const box = q('rail').querySelector<HTMLElement>('.toolbox_body')!
  const pages = [...q('rail').querySelectorAll<HTMLElement>('[data-toolbox-panel]')]
  const shown = pages.map(page => page.hidden)
  const tall = (): boolean => pages.some(page => {
    for (const other of pages) other.hidden = other !== page
    return box.scrollHeight > box.clientHeight + 1
  })
  for (const level of ['1', '1 2']) {
    if (!tall()) break
    body.dataset.toolboxFit = level
  }
  pages.forEach((page, i) => { page.hidden = shown[i] })
}

// 横向きでならべたレイヤーの箱が左の列のボタンに重なるときは、そのボタンを隠す (箱のふちから半端にのぞかないように)。
export function layer_cover(): void {
  const stack = q('layer_stack')
  const open = document.body.dataset.workspace === 'landscape' && (stack.dataset.open === '1' || overlay_state.pop === 'pop_layer')
  const box = stack.getBoundingClientRect()
  for (const button of document.querySelectorAll<HTMLElement>('.tl_tail .tb, #hd .hbtn')) {
    const r = button.getBoundingClientRect()
    const covered = open && r.left < box.right && box.left < r.right && r.top < box.bottom && box.top < r.bottom
    button.style.visibility = covered ? 'hidden' : ''
  }
}

function layer_stack_layout(): void {
  const stack = q('layer_stack')
  const tabs = q('live_layer_tabs')
  const horizontal = getComputedStyle(tabs).flexDirection === 'row'
  if (horizontal) stack.style.removeProperty('--layer_limit')
  else {
    const area = stack.getBoundingClientRect()
    const column = tabs.getBoundingClientRect()
    let bottom = innerHeight - 8
    for (const element of document.querySelectorAll<HTMLElement>('#frame_panel,#fs,#tl_bar button,#hd button,#mobile_tools button')) {
      if (element.hidden || !element.getClientRects().length) continue
      const rect = element.getBoundingClientRect()
      if (rect.width && rect.height && rect.left < column.right && rect.right > column.left && rect.bottom > area.top) bottom = Math.min(bottom, rect.top - 8)
    }
    stack.style.setProperty('--layer_limit', Math.max(0, bottom - area.top) + 'px')
  }
  const overflow = horizontal ? tabs.scrollWidth > tabs.clientWidth + 1 : tabs.scrollHeight > tabs.clientHeight + 1
  stack.dataset.scroll = overflow ? horizontal ? 'x' : 'y' : ''
  const selected = tabs.querySelector<HTMLElement>('[aria-pressed="true"]')
  if (!overflow || !selected) return
  const visible = tabs.getBoundingClientRect()
  const active = selected.getBoundingClientRect()
  if (horizontal) {
    if (active.left < visible.left) tabs.scrollLeft += active.left - visible.left
    else if (active.right > visible.right) tabs.scrollLeft += active.right - visible.right
  } else {
    if (active.top < visible.top) tabs.scrollTop += active.top - visible.top
    else if (active.bottom > visible.bottom) tabs.scrollTop += active.bottom - visible.bottom
  }
}

export function workspace_context_layout(m: HTMLElement, anchor: HTMLElement): void {
  anchored_panel_layout(m, anchor, 0)
}
