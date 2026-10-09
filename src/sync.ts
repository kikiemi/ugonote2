import { doc_frame_order } from './doc'
import { responsive_large } from './ui/responsive'
import { LANG, tr, tr_dom } from './lang'
import { r_stage } from './ui/stage_render'
import { r_timeline, r_thumbs, r_frameinfo } from './ui/timeline_render'
export { tl_index_at } from './ui/timeline_render'
import { layer_stack_layout, workbench_render } from './ui/workbench'
import { tool_page_show } from './ui/overlay'
import { animfx_active } from './animfx'
import { report_error } from './diagnostics'
import { ic, q } from './dom'
import { brush_spacing, tip_get } from './brush'
import { B_N, D_ANIM, D_FRAMEINFO, D_GRID, D_LAYER, D_MODE, D_ONION, D_PAGE, D_PEN, D_PLAY, D_SAVE, D_SEL, D_SOUND, D_STAGE, D_THUMB, D_TIMELINE, D_TOOLS, D_TRANS, D_ZOOM, FPS_SPEEDS, INK_KWZ, INK_PPM, INK_STD, K_NONE, MODE_3D, MODE_DSI, MODE_NORMAL, PAL_KWZ, PAL_PPM, PAT_TABLE, T_CIRCLE, T_ERASER, T_FILL, T_HEART, T_LASSO, T_LINE, T_PASTE, T_PEN, T_PIXEL, T_RECT, T_SELECT, T_STAR, fps_speed_tag } from './h'
import { hist_can_redo, hist_can_undo } from './hist'
import { clamp } from './lib'
import { mode_allows_runtime_anim, mode_name, mode_paper_opts } from './mode'
import { proj_dirty, store_blink, store_state } from './persist'
import { pref_kit, pref_theme, pref_uisfx } from './prefs'
import { flo_active } from './sel'
import { TOOL_DEFS } from './ui/tool_defs'
import { anim_playing } from './state/commands/play'
import { dirty, flush_begin, flush_end, st, store_dirty_hook } from './state/store'
import { marks_render, palette_render } from './ui/color_panel'
import { layer_panel_render } from './ui/layer_panel'

type Region = { name: string, mask: number, fn: () => void }

const regions: Region[] = []
let mounted = 0
let chrome_tlopen = -1

export function region_add(name: string, mask: number, fn: () => void): void {
  for (const r of regions) if (r.name === name) throw new Error('region dup: ' + name)
  regions.push({ name, mask, fn })
}

function ink_list(): string[] {
  const g = st()
  if (g.pen.palMode === PAL_PPM) return INK_PPM
  if (g.pen.palMode === PAL_KWZ) return INK_KWZ
  return INK_STD
}

const OPT_MAP: [string, number[]][] = [
  ['blkBrush', [T_PEN]],
  ['blkSize', [T_PEN, T_ERASER, T_LINE, T_RECT, T_CIRCLE, T_STAR, T_HEART]],
  ['blkStroke', [T_PEN]],
  ['blkSym', [T_PEN, T_PIXEL, T_LINE, T_RECT, T_CIRCLE, T_STAR, T_HEART]],
  ['blkAlpha', [T_PEN, T_FILL, T_LINE, T_RECT, T_CIRCLE, T_STAR, T_HEART]],
  ['blkPat', [T_PEN, T_ERASER, T_FILL, T_LINE, T_RECT, T_CIRCLE, T_STAR, T_HEART]],
  ['blkOutline', [T_PEN, T_LINE, T_RECT, T_CIRCLE, T_STAR, T_HEART]],
  ['blkFill', [T_RECT, T_CIRCLE, T_STAR, T_HEART]],
  ['blkFillTool', [T_FILL]],
  ['blkPxn', [T_PIXEL]],
  ['blkSel', [T_SELECT, T_LASSO]],
  ['blkPaste', [T_PASTE]],
]

const KIT_BASIC = [T_PEN, T_ERASER, T_FILL, 10, T_SELECT, T_LASSO, T_PIXEL, 13, 14]

export function kit_tool_ok(t: number): number {
  if (responsive_large() || !pref_kit()) return 1
  return KIT_BASIC.indexOf(t) >= 0 ? 1 : 0
}

export function tool_has_options(t: number): number {
  for (const [, list] of OPT_MAP) if (list.indexOf(t) >= 0) return 1
  return 0
}

function r_tools(): void {
  const g = st()
  workbench_render(g.pen)
  const m = g.doc.mode
  for (const d of TOOL_DEFS) {
    const b = q('tl_' + d.t)
    b.classList.toggle('on', g.pen.tool === d.t)
    b.setAttribute('aria-pressed', String(g.pen.tool === d.t))
    const modeOff = kit_tool_ok(d.t) ? 0 : 1
    if (d.t === T_PASTE) b.classList.toggle('off', modeOff || !g.clip ? true : false)
    else b.classList.toggle('off', modeOff ? true : false)
  }
  document.body.dataset.tool = String(g.pen.tool)
  q('undoBtn').classList.toggle('off', hist_can_undo() ? false : true)
  q('redoBtn').classList.toggle('off', hist_can_redo() ? false : true)
  for (const [id, list] of OPT_MAP) {
    let show = id === 'blkPxn' || id === 'blkSize' || list.indexOf(g.pen.tool) >= 0 ? 1 : 0
    if (pref_kit() && (id === 'blkPat' || id === 'blkAlpha' || id === 'blkOutline' || id === 'blkStroke' || id === 'blkSym')) show = 0
    q(id).classList.toggle('off', show ? false : true)
  }
  tool_page_show(undefined, false)
  q('markBtn').classList.toggle('off', m === MODE_NORMAL ? false : true)
  q('transBtn').classList.toggle('off', m === MODE_NORMAL ? false : true)
  const lock = m !== MODE_NORMAL
  q('canvasSizeRow').classList.toggle('off', lock)
  q('sizeApply').classList.toggle('off', lock)
  q('rotLBtn').classList.toggle('off', lock)
  q('rotRBtn').classList.toggle('off', lock)
  const popts = mode_paper_opts(m)
  const useSw = m !== MODE_NORMAL
  q('paperCanvasCustom').hidden = useSw
  q('paperCustomLabel').hidden = useSw
  const cur = g.doc.paper.toUpperCase()
  const names: Record<string, string> = { '#FFFFFF': 'しろ', '#0E0E0E': 'くろ', '#101010': 'くろ', '#FF1010': 'あか', '#FFE700': 'きいろ', '#008631': 'みどり', '#0038CE': 'あお' }
  let hh = ''
  for (let i = 0; i < popts.length; i++) {
    const c = popts[i]
    const name = names[c] || ['しろ', 'くろ', 'クリーム', 'ミント', 'そら', 'さくら', 'ラベンダー', 'きなり', 'グレー', 'すみ'][i] || c
    hh += '<button class="psw" data-paper="' + c + '" aria-pressed="' + String(c === cur) + '"><span style="background:' + c + '"></span><b>' + name + '</b></button>'
  }
  for (const id of ['paperSw', 'paperChoices']) {
    const sw = q(id)
    if (sw.dataset.h !== hh) { sw.innerHTML = hh; sw.dataset.h = hh }
  }
  const custom = q<HTMLInputElement>('paperCustom')
  if (document.activeElement !== custom) custom.value = cur
  q('paperChip').style.background = cur
  q('paperModeHint').textContent = useSw ? (m === 1 ? 'DSiの紙は2色。PPMにそのまま保存できます。' : '3DSの紙は6色。KWZにそのまま保存できます。') + ' ぜんぶのコマに使います。' : '好きな色を選べます。ぜんぶのコマに使います。'
}

function r_pen(): void {
  const g = st()
  const p = g.pen
  workbench_render(p)
  for (const cv of document.querySelectorAll<HTMLCanvasElement>('[data-brushprev]')) {
    const ink = pref_theme() ? '#EDF0F7' : '#343746'
    if (cv.dataset.drawn === ink) continue
    const tip = tip_get(Number(cv.dataset.brushprev), 6, ink, 0)
    const x = cv.getContext('2d')!
    x.clearRect(0, 0, cv.width, cv.height)
    for (let n = 6; n < 58; n += brush_spacing(Number(cv.dataset.brushprev), 6)) x.drawImage(tip, n - tip.width / 2, 14 + Math.sin(n / 9) * 5 - tip.height / 2)
    cv.dataset.drawn = ink
  }
  q('colorChip').style.background = p.color
  const dot = q('sizeDot')
  const dpx = Math.min(24, Math.max(4, p.size))
  dot.style.width = dpx + 'px'
  dot.style.height = dpx + 'px'
  const wrap = q('popTool')
  const szb = wrap.querySelectorAll('.szb')
  for (let i = 0; i < szb.length; i++) {
    const b = szb[i] as HTMLElement
    b.classList.toggle('on', Number(b.dataset.sz) === p.size)
  }
  const patb = wrap.querySelectorAll('.patb')
  for (let i = 0; i < patb.length; i++) {
    const b = patb[i] as HTMLElement
    b.classList.toggle('on', Number(b.dataset.pat) === p.pat)
  }
  const ar = q<HTMLInputElement>('optAlpha')
  const av = Math.round(p.alpha * 100)
  if (document.activeElement !== ar) ar.value = String(av)
  q('optAlphaVal').textContent = String(av)
  const smr = q<HTMLInputElement>('optSmooth')
  if (document.activeElement !== smr) smr.value = String(p.smooth)
  q('optSmoothVal').textContent = String(p.smooth)
  const owr = q<HTMLInputElement>('optOWidth')
  if (document.activeElement !== owr) owr.value = String(p.owidth)
  q('optOWidthVal').textContent = String(p.owidth)
  q<HTMLInputElement>('optOColor').value = p.ocolor
  q('optOutline').classList.toggle('on', p.outline ? true : false)
  q('optPressure').classList.toggle('on', p.pressure ? true : false)
  q('optSymX').classList.toggle('on', p.sym ? true : false)
  q('optSymY').classList.toggle('on', p.symy ? true : false)
  q('optFill').classList.toggle('on', p.fill ? true : false)
  q('optFillAll').classList.toggle('on', p.fillAll ? true : false)
  for (let b = 0; b < B_N; b++) {
    q('brush_' + b).classList.toggle('on', p.brush === b)
    q('brush_' + b).setAttribute('aria-pressed', String(p.brush === b))
  }
  const sn = q<HTMLInputElement>('sizeNum')
  const srr = q<HTMLInputElement>('sizeRange')
  if (document.activeElement !== sn) sn.value = String(p.size)
  if (document.activeElement !== srr) srr.value = String(p.size)
  const pn = q<HTMLInputElement>('pxnNum')
  const prr = q<HTMLInputElement>('pxnRange')
  const maximum = Math.min(256, g.doc.w)
  const count = clamp(p.pxn, 2, maximum)
  if (document.activeElement !== pn) pn.value = String(count)
  pn.max = String(maximum)
  prr.max = String(maximum)
  if (document.activeElement !== prr) prr.value = String(count)
  q('pixelSizeVal').textContent = (g.doc.w / count).toFixed(1).replace(/\.0$/, '') + ' px / ドット'
  for (const button of q('pixelChoices').querySelectorAll<HTMLButtonElement>('[data-pixel-count]')) {
    const value = Number(button.dataset.pixelCount)
    button.disabled = value > maximum
    button.setAttribute('aria-pressed', String(value === count))
  }
  marks_render()
  for (let t = 0; t < 3; t++) q('palTab_' + t).classList.toggle('on', p.palMode === t)
  palette_render(ink_list())
  q<HTMLInputElement>('pickIn').value = p.color
  const hx = q<HTMLInputElement>('hexIn')
  if (document.activeElement !== hx) hx.value = p.color
}

function r_layer(): void {
  layer_panel_render()
  const g = st()
  const tabs = q('liveLayerTabs')
  const html = doc_frame_order(g.doc.cur).map(layer => `<button class="liveLayer" data-live-layer="${layer}" aria-pressed="${g.pen.layer === layer}" aria-haspopup="dialog" title="レイヤー ${layer === 0 ? '写真' : String.fromCharCode(64 + layer)}・選択中にもう一度押すと設定">${layer === 0 ? ic('image') : String.fromCharCode(64 + layer)}</button>`).join('')
  if (tabs.innerHTML !== html) tabs.innerHTML = html
  layer_stack_layout()
}

function r_play(): void {
  const g = st()
  const on = anim_playing()
  q('playBtn').innerHTML = ic(on ? 'pause' : 'play')
  q('playBtn').classList.toggle('on', on ? true : false)
  q('loopBtn').classList.toggle('on', !!g.doc.loop)
  q('loopBtn').setAttribute('aria-pressed', String(!!g.doc.loop))
  q('loopBtn').title = g.doc.loop ? 'ループ再生をオフにする' : 'ループ再生をオンにする'
  q('loopState').textContent = g.doc.loop ? 'オン' : 'オフ'
  let idx = 0
  let best = 999
  for (let i = 0; i < FPS_SPEEDS.length; i++) {
    const d = Math.abs(FPS_SPEEDS[i] - g.doc.fps)
    if (d < best) {
      best = d
      idx = i
    }
  }
  const fr = q<HTMLInputElement>('fpsRange')
  if (document.activeElement !== fr) fr.value = String(idx)
  q('fpsVal').textContent = g.doc.fps + ' コマ/秒'
  q('fpsMain').textContent = String(g.doc.fps)
  q('fpsTag').textContent = '・' + fps_speed_tag(g.doc.fps)
}

let zoomT: ReturnType<typeof setTimeout> | 0 = 0

function r_zoom(): void {
  const zl = q('zoomLabel')
  zl.textContent = Math.round(st().view.z * 100) + '%'
  zl.classList.add('on')
  if (zoomT) clearTimeout(zoomT)
  zoomT = setTimeout(() => zl.classList.remove('on'), 900)
}

function r_sound(): void {
  const g = st()
  const kinds = ['bgm0', 'bgm1', 'se0', 'se1', 'se2', 'se3']
  for (const k of kinds) {
    const slot = k.startsWith('bgm') ? g.snd.bgm[Number(k[3])] : g.snd.se[Number(k[2])]
    q('sname_' + k).textContent = slot.name || '--'
  }
  for (let i = 0; i < 4; i++) {
    const sel = q<HTMLSelectElement>('spre_se' + i)
    const nm = g.snd.se[i].name
    sel.value = sel.querySelector('option[value="' + nm + '"]') ? nm : ''
  }
  const bv = q<HTMLInputElement>('bgmVol')
  const sv = q<HTMLInputElement>('seVol')
  if (document.activeElement !== bv) bv.value = String(Math.round(g.snd.bgmVol * 100))
  if (document.activeElement !== sv) sv.value = String(Math.round(g.snd.seVol * 100))
  q('uisfxTgl').classList.toggle('on', pref_uisfx() ? true : false)
  q('uisfxTgl').setAttribute('aria-pressed', String(!!pref_uisfx()))
  q('soundState').textContent = pref_uisfx() ? 'オン' : 'オフ'
}

function r_save(): void {
  const sstate = store_state()
  const dot = q('saveDot')
  dot.classList.toggle('busy', sstate === 1)
  dot.classList.toggle('err', sstate === 2)
  dot.classList.toggle('on', sstate === 0 && (store_blink() ? true : false))
  dot.title = sstate === 1 ? '保存中…' : sstate === 2 ? '保存に失敗（再試行中）' : proj_dirty() ? '未保存の変更あり' : '自動保存ずみ'
}


function r_selbar(): void {
  const g = st()
  const bar = q('selBar')
  const show = g.sel.has && g.flo.kind === K_NONE ? 1 : 0
  bar.classList.toggle('on', show ? true : false)
  if (!show) return
  const wrap = q('stageWrap')
  const bw = bar.offsetWidth || 180
  let sx = g.view.px + (g.sel.x + g.sel.w / 2) * g.view.z - bw / 2
  let sy = g.view.py + g.sel.y * g.view.z - (bar.offsetHeight || 56) - 10
  sx = clamp(sx, 6, Math.max(6, wrap.clientWidth - bw - 6))
  sy = clamp(sy, 6, Math.max(6, wrap.clientHeight - 60))
  bar.style.left = sx + 'px'
  bar.style.top = sy + 'px'
}

function r_dock(): void {
  const g = st()
  const t = g.pen.tool
  const mainTool = T_PEN
  const mainDef = TOOL_DEFS.find(def => def.t === mainTool)
  if (mainDef) q('dockMain').innerHTML = ic(mainDef.icon) + '<i>' + tr(mainDef.label) + '</i>'
  q('dockMain').title = tr(mainDef?.label || 'ペン')
  q('dockEraser').classList.toggle('on', t === T_ERASER)
  q('dockMain').classList.toggle('on', t === mainTool)
  q('dockFill').classList.toggle('on', t === T_FILL)
  for (const [id, tool] of [['dockMain', mainTool], ['dockEraser', T_ERASER], ['dockFill', T_FILL]] as const) q(id).setAttribute('aria-pressed', String(t === tool))
  for (const button of q('dockRow').querySelectorAll<HTMLElement>('[data-dock-tool]')) {
    const selected = Number(button.dataset.dockTool) === t
    button.classList.toggle('on', selected)
    button.setAttribute('aria-pressed', String(selected))
  }
  q('dockChip').style.background = g.pen.color
  const dot = q('dockDot')
  const dpx = clamp(g.pen.size, 2, 26)
  dot.style.width = dpx + 'px'
  dot.style.height = dpx + 'px'

}

function r_settings(): void {
  const g = st()
  const gs = q<HTMLInputElement>('setGsize')
  const gn = q<HTMLInputElement>('setGsizeN')
  if (document.activeElement !== gs) gs.value = String(g.view.gsize)
  if (document.activeElement !== gn) gn.value = String(g.view.gsize)
  const so = q<HTMLInputElement>('setOnion')
  const shown = g.view.onion ? g.view.ocount : 0
  if (document.activeElement !== so) so.value = String(shown)
  q('setOnionV').textContent = shown ? String(shown) : 'オフ'
  q('setTheme').classList.toggle('on', pref_theme() ? true : false)
  q('setUisfx').classList.toggle('on', pref_uisfx() ? true : false)
  q('setVflip').classList.toggle('on', g.view.flip ? true : false)
  q('kitAdv').classList.toggle('on', pref_kit() ? false : true)
  q('kitBasic').classList.toggle('on', pref_kit() ? true : false)
}

function r_chrome(): void {
  const g = st()
  document.body.dataset.free = g.doc.ratio === 'free' ? '1' : '0'
  document.body.dataset.mode = g.doc.mode === MODE_DSI ? 'dsi' : g.doc.mode === MODE_3D ? '3d' : ''
  q('modeName').textContent = mode_name(g.doc.mode)
  const assist = q('motionAssistBtn')
  const runtime = mode_allows_runtime_anim(g.doc.mode)
  const animated = runtime ? animfx_active(g.doc.anim) : 0
  assist.classList.toggle('on', animated ? true : false)
  assist.title = runtime ? (animated ? '再生時のうごきが有効' : '手描きゆらぎとうごきの設定') : 'うごメモ系モードでは動きを実コマへ変換します'
  const mb = q('modeBadge')
  const mbn = g.doc.mode === MODE_NORMAL ? '' : mode_name(g.doc.mode)
  if (mb.textContent !== mbn) mb.textContent = mbn
  document.body.dataset.theme = pref_theme() ? 'dark' : ''
  document.body.dataset.vflip = g.view.flip ? '1' : '0'
  const tlopen = g.view.tlopen ? 1 : 0
  document.body.dataset.tl = tlopen ? '1' : '0'
  if (chrome_tlopen !== tlopen) {
    chrome_tlopen = tlopen
    if (tlopen) dirty(D_TIMELINE)
  }
  q('themeBtn').classList.toggle('on', !!pref_theme())
  q('themeBtn').setAttribute('aria-pressed', String(!!pref_theme()))
  q('themeState').textContent = pref_theme() ? 'オン' : 'オフ'
  q('themeBtn').querySelector('.ic')?.remove()
  q('themeBtn').insertAdjacentHTML('afterbegin', ic(pref_theme() ? 'sun' : 'moon'))
  q('vflipBtn').classList.toggle('on', g.view.flip ? true : false)
  q('tlToggle').innerHTML = ic('grid') + '<b>コマ一覧</b>'
  q('tlToggle').title = g.view.tlopen ? 'コマ一覧を閉じる' : 'コマ一覧を開く'
  q('tlToggle').setAttribute('aria-expanded', String(!!g.view.tlopen))
  const ti = q<HTMLInputElement>('title')
  if (document.activeElement !== ti && ti.value !== g.doc.name) ti.value = g.doc.name
  const menuTitle = q<HTMLInputElement>('menuTitle')
  if (document.activeElement !== menuTitle) menuTitle.value = g.doc.name
  const rs = q<HTMLSelectElement>('ratioSel')
  if (document.activeElement !== rs && rs.value !== g.doc.ratio) rs.value = g.doc.ratio
  const zs = q<HTMLSelectElement>('resoSel')
  if (document.activeElement !== zs && zs.value !== g.doc.res) zs.value = g.doc.res
  const [w, h] = [g.doc.w, g.doc.h]
  q('sizeNow').textContent = w + '×' + h
  q<HTMLSelectElement>('ratioSel').value = g.doc.ratio
  q<HTMLSelectElement>('resoSel').value = g.doc.res
  q<HTMLInputElement>('paperIn').value = g.doc.paper
}

function r_onion_ui(): void {
  const g = st()
  q('onionBtn').classList.toggle('on', g.view.onion && (g.view.oprev || g.view.onext) ? true : false)
  for (const [id, key] of [['onionPrev', 'oprev'], ['onionNext', 'onext'], ['onionSkip', 'oskip']] as const) {
    q(id).classList.toggle('on', !!g.view[key])
    q(id).setAttribute('aria-pressed', String(!!g.view[key]))
  }
  const shown = g.view.onion ? g.view.ocount : 0
  q('onionCountVal').textContent = shown ? String(shown) : 'オフ'
  q('onionBtn').setAttribute('aria-pressed', String(!!shown && !!(g.view.oprev || g.view.onext)))
  q('onionBtn').querySelector('i')!.textContent = shown ? '前の絵 ' + shown : '前の絵'
  for (const button of q('onionChoices').querySelectorAll<HTMLElement>('[data-onion-count]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.onionCount) === shown))
  }
  const oc = q<HTMLInputElement>('onionCount')
  if (document.activeElement !== oc) oc.value = String(shown)
}

function r_grid_ui(): void {
  const g = st()
  const pixel = g.pen.tool === T_PIXEL
  q('gridBtn').classList.toggle('on', !!g.view.grid)
  q('gridBtn').setAttribute('aria-pressed', String(!!g.view.grid))
  q('adjustGrid').setAttribute('aria-pressed', String(!!g.view.grid))
  q('adjustGrid').textContent = g.view.grid ? '表示オン' : '表示オフ'
  q('gridStepHint').textContent = pixel ? 'ドットでは下の粗さに合わせたマス目になります' : '用紙のマス目。絵には保存されません'
  for (const id of ['gridStepRange', 'gridStepNum']) {
    const input = q<HTMLInputElement>(id)
    input.disabled = pixel
    if (document.activeElement !== input) input.value = String(g.view.gsize)
  }
  for (const button of q('gridChoices').querySelectorAll<HTMLButtonElement>('[data-grid-size]')) {
    button.disabled = pixel
    button.setAttribute('aria-pressed', String(!pixel && Number(button.dataset.gridSize) === g.view.gsize))
  }
}


function r_sel(): void {
  const g = st()
  const flo = flo_active()
  q('floBar').classList.toggle('on', flo ? true : false)
  if (flo) {
    const deg = Math.round((g.flo.rot * 180) / Math.PI) % 360
    q('floInfo').textContent = deg + '°・' + Math.round(Math.abs(g.flo.sx) * 100) + '%'
  }
}

function pat_previews(): void {
  const nodes = document.querySelectorAll('[data-patprev]')
  for (let k = 0; k < nodes.length; k++) {
    const c = nodes[k] as HTMLCanvasElement
    const pi = Number(c.dataset.patprev)
    const x = c.getContext('2d') as CanvasRenderingContext2D
    x.clearRect(0, 0, 28, 28)
    x.fillStyle = '#3A2E2A'
    const rows = PAT_TABLE[pi].rows
    const s = 3.5
    for (let y = 0; y < 8; y++) for (let px = 0; px < 8; px++) if ((rows[y] >> (7 - px)) & 1) x.fillRect(px * s, y * s, s, s)
  }
}

let flushing = 0

function flush(): void {
  let bits = flush_begin()
  if (!bits) return
  if (bits & D_TIMELINE) bits |= D_THUMB | D_FRAMEINFO
  flushing = 1
  let translate = 0
  try {
    for (const region of regions) {
      if (!(bits & region.mask)) continue
      try {
        region.fn()
        if (LANG === 'en' && !['stage', 'timeline', 'thumbs', 'frameinfo', 'sel', 'zoom'].includes(region.name)) translate = 1
      } catch (error) {
        report_error('再描画領域 ' + region.name + ' の更新に失敗しました', error)
      }
    }
    if (translate) tr_dom(q('app'))
  } finally {
    flushing = 0
    flush_end()
  }
}

let rafPending = 0

function schedule(): void {
  if (rafPending) return
  rafPending = 1
  requestAnimationFrame(() => {
    rafPending = 0
    flush()
  })
}

export function sync_mount(): void {
  if (mounted) return
  mounted = 1
  region_add('stage', D_STAGE | D_ZOOM | D_GRID | D_ONION, r_stage)
  region_add('timeline', D_TIMELINE, r_timeline)
  region_add('thumbs', D_THUMB, r_thumbs)
  region_add('frameinfo', D_FRAMEINFO, r_frameinfo)
  region_add('tools', D_TOOLS | D_MODE, r_tools)
  region_add('pen', D_PEN | D_MODE, r_pen)
  region_add('layer', D_LAYER | D_MODE, r_layer)
  region_add('play', D_PLAY, r_play)
  region_add('zoom', D_ZOOM, r_zoom)
  region_add('sound', D_SOUND, r_sound)
  region_add('save', D_SAVE, r_save)
  region_add('chrome', D_PAGE | D_MODE | D_ANIM, r_chrome)
  region_add('settings', D_PAGE | D_GRID | D_ONION | D_SOUND, r_settings)
  region_add('selbar', D_SEL | D_ZOOM | D_STAGE | D_TRANS, r_selbar)
  region_add('dock', D_PEN | D_TOOLS | D_PAGE | D_STAGE | D_LAYER, r_dock)
  region_add('onion_ui', D_ONION, r_onion_ui)
  region_add('grid_ui', D_GRID | D_PEN | D_TOOLS, r_grid_ui)
  region_add('sel', D_SEL | D_TOOLS | D_TRANS, r_sel)
  pat_previews()
  store_dirty_hook(schedule)
  schedule()
}

export function sync_flushing(): number {
  return flushing
}
