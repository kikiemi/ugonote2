import { pat_canvas } from './gfx'
import { workspace_layout_render } from './ui/workspace_layout'
import { tool_has_options, tool_page_show } from './ui/tool_options'
import { lang, tr, tr_dom, tr_line } from './lang'
import { r_stage } from './ui/stage_render'
import { r_timeline, r_thumbs, r_frameinfo } from './ui/timeline_render'
import { workbench_render } from './ui/workbench'
import { layer_stack_render } from './ui/layer_stack'
import { animfx_active } from './animfx'
import { report_error } from './diagnostics'
import { ic, pressed, q } from './dom'
import { paint_active, paint_bit, paint_pattern, native_pat_order, pat_custom } from './paint'
import { native_paint_bucket } from './penprofile'
import { pen_palette_render } from './ui/pen_palette'
import { d_anim, d_frameinfo, d_grid, d_layer, d_mode, d_onion, d_page, d_pen, d_play, d_save, d_sel, d_sound, d_stage, d_thumb, d_timeline, d_tools, d_trans, d_zoom, ink_kwz, ink_ppm, ink_std, mode_3_d, mode_dsi, mode_normal, pal_kwz, pal_ppm, t_eraser, t_fill, t_paste, t_pixel } from './h'
import { hist_can_redo, hist_can_undo } from './hist'
import { clamp } from './lib'
import { mode_allows_runtime_anim, mode_ink, mode_name, mode_paper_opts, mode_speed_index, mode_speed_tag, mode_speeds } from './mode'
import { proj_dirty, store_blink, store_state } from './persist'
import { pref_hide_controls, pref_theme, pref_uisfx } from './prefs'
import { selection_toolbar_render } from './ui/selection_toolbar'
import { shape_memory, shape_tools, tool_defs, tool_def } from './ui/tool_defs'
import { rail_shapes_render } from './ui/rail_shapes'
import { anim_playing } from './state/commands/play'
import { flush_begin, flush_end, st, store_dirty_hook } from './state/store'
import { marks_render, palette_render } from './ui/color_panel'
import { layer_panel_render } from './ui/layer_panel'

type region_t = { name: string, mask: number, fn: () => void }

const regions: region_t[] = []
let mounted = 0

export function region_add(name: string, mask: number, fn: () => void): void {
  for (const r of regions) if (r.name === name) throw new Error('region dup: ' + name)
  regions.push({ name, mask, fn })
}

function ink_list(): string[] {
  const g = st()
  if (g.pen.pal_mode === pal_ppm) return ink_ppm
  if (g.pen.pal_mode === pal_kwz) return ink_kwz
  return ink_std
}

function r_tools(): void {
  const g = st()
  const m = g.doc.mode
  for (const d of tool_defs) {
    const b = q('tl_' + d.t)
    pressed(b, g.pen.tool === d.t)
    if (d.t === t_paste) b.classList.toggle('off', !g.clip)
    else b.classList.remove('off')
  }
  rail_shapes_render()
  document.body.dataset.tool = String(g.pen.tool)
  q('undo_btn').classList.toggle('off', !hist_can_undo())
  q('redo_btn').classList.toggle('off', !hist_can_redo())
  for (const id of ['dock_settings', 'tool_settings_btn']) {
    const button = q<HTMLButtonElement>(id)
    button.disabled = !tool_has_options(g.pen.tool)
    button.title = tr_line(button.disabled ? 'この道具には追加の設定はありません' : '選んだ道具の設定')
  }
  // 色を使う道具だけ、設定の上に「色」を出す (けしごむは色を使わない)。
  q('tool_color_btn').hidden = g.pen.tool === t_eraser
  tool_page_show(undefined, false)
  q('custom_color_options').hidden = m !== mode_normal
  q('pal_tabs').hidden = m !== mode_normal
  // ノーマルモードだけの機能は、うごメモ系モードでは出さない。
  for (const id of ['mark_btn', 'effect_btn', 'trans_btn', 'shape_marks']) q(id).hidden = m !== mode_normal
  const lock = m !== mode_normal
  q('canvas_size_row').hidden = lock
  const popts = mode_paper_opts(m)
  const use_sw = m !== mode_normal
  q('paper_canvas_custom').hidden = use_sw
  q('paper_custom_label').hidden = use_sw
  const cur = g.doc.paper.toUpperCase()
  const names: Record<string, string> = { '#FFFFFF': 'しろ', '#0E0E0E': 'くろ', '#101010': 'くろ', '#FF1010': 'あか', '#FFE700': 'きいろ', '#008631': 'みどり', '#0038CE': 'あお' }
  let hh = ''
  for (let i = 0; i < popts.length; i++) {
    const c = popts[i]
    const name = names[c] || ['しろ', 'くろ', 'クリーム', 'ミント', 'そら', 'さくら', 'ラベンダー', 'きなり', 'グレー', 'すみ'][i] || c
    hh += '<button class="psw" data-paper="' + c + '" aria-pressed="' + String(c === cur) + '"><span style="background:' + c + '"></span><b>' + name + '</b></button>'
  }
  for (const id of ['paper_sw', 'paper_choices']) {
    const sw = q(id)
    if (sw.dataset.h !== hh) {
      sw.innerHTML = hh
      sw.dataset.h = hh
    }
  }
  const custom = q<HTMLInputElement>('paper_custom')
  if (document.activeElement !== custom) custom.value = cur
  q('paper_chip').style.background = cur
}

function r_pen(): void {
  const g = st()
  const p = g.pen
  const native = g.doc.mode !== mode_normal
  const tile = paint_active(g.doc.mode, p.paint_tile, p.paint_tile_normal)
  const colors = mode_ink(g.doc.mode).slice(0, 8)
  const quick = q('quick_colors')
  const color_key = colors.join(',')
  if (quick.dataset.colors !== color_key) {
    let html = ''
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i]
      html += `<button data-quick-color="${c}" style="--ink:${c}" aria-label="${tr_line('色 ' + c)}" aria-pressed="false"></button>`
    }
    quick.innerHTML = html
    quick.dataset.colors = color_key
  }
  for (const b of quick.querySelectorAll<HTMLElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.quickColor === p.color))
  pen_palette_render(p, g.doc.mode)
  q('color_chip').style.background = p.color
  q('tool_color_chip').style.background = p.color
  const wrap = q('pop_tool')
  const szb = wrap.querySelectorAll('.szb')
  for (let i = 0; i < szb.length; i++) {
    const b = szb[i] as HTMLElement
    b.classList.toggle('on', Number(b.dataset.sz) === p.size)
  }
  const patb = wrap.querySelectorAll('.patb')
  for (let i = 0; i < patb.length; i++) {
    const b = patb[i] as HTMLElement
    const pat = Number(b.dataset.pat)
    pressed(b, pat === p.pat)
    b.style.order = String(g.doc.mode === mode_normal ? pat : native_pat_order.indexOf(pat))
    if (pat === pat_custom) (b as HTMLButtonElement).disabled = !tile
  }
  for (const [id, value] of [['paint_normal', 0], ['paint_over', 1]] as const) q(id).setAttribute('aria-pressed', String(p.paint_over === value))
  q('paint_normal').textContent = tr(native ? 'ふつうのペイント' : '塗り重ね')
  // ケシゴムのもようは「もようの点だけ消す」なので、ふつう・うわがきの切り替えは出さない。
  q('paint_mode').hidden = p.tool === t_eraser || g.doc.mode === mode_dsi && p.tool === t_fill && p.native_paint !== native_paint_bucket
  pat_previews()
  const custom = q<HTMLCanvasElement>('custom_paint_preview')
  custom.hidden = !tile
  q('pat_' + pat_custom).querySelector<HTMLElement>('.ic')!.style.display = tile ? 'none' : ''
  q('pat_' + pat_custom).querySelector<HTMLElement>('.paint_badge')!.hidden = !tile
  if (tile) {
    const x = custom.getContext('2d')!
    x.clearRect(0, 0, 28, 28)
    const scale = Math.min(28 / tile.w, 28 / tile.h)
    const ox = (28 - tile.w * scale) / 2
    const oy = (28 - tile.h * scale) / 2
    x.imageSmoothingEnabled = false
    x.drawImage(pat_canvas(pat_custom, pref_theme() ? '#EDF0F7' : '#3A2E2A'), ox, oy, tile.w * scale, tile.h * scale)
  }
  const ar = q<HTMLInputElement>('opt_alpha')
  const av = Math.round(p.alpha * 100)
  if (document.activeElement !== ar) ar.value = String(av)
  q('opt_alpha_val').textContent = String(av)
  q('opt_alpha_label').textContent = tr(p.tool === t_eraser ? '消す強さ' : '不透明度')
  const smr = q<HTMLInputElement>('opt_smooth')
  if (document.activeElement !== smr) smr.value = String(p.smooth)
  q('opt_smooth_val').textContent = String(p.smooth)
  const owr = q<HTMLInputElement>('opt_o_width')
  if (document.activeElement !== owr) owr.value = String(p.owidth)
  q('opt_o_width_val').textContent = String(p.owidth)
  q<HTMLInputElement>('opt_o_color').value = p.ocolor
  for (const [id, on] of [['opt_outline', p.outline], ['opt_pressure', p.pressure], ['opt_sym_x', p.sym], ['opt_sym_y', p.symy], ['opt_fill', p.fill], ['opt_fill_all', p.fill_all]] as const) q(id).setAttribute('aria-pressed', String(!!on))
  const sn = q<HTMLInputElement>('size_num')
  const srr = q<HTMLInputElement>('size_range')
  if (document.activeElement !== sn) sn.value = String(p.size)
  if (document.activeElement !== srr) srr.value = String(p.size)
  const pn = q<HTMLInputElement>('pxn_num')
  const prr = q<HTMLInputElement>('pxn_range')
  const maximum = Math.min(256, g.doc.w)
  const count = clamp(p.pxn, 2, maximum)
  if (document.activeElement !== pn) pn.value = String(count)
  pn.max = String(maximum)
  prr.max = String(maximum)
  if (document.activeElement !== prr) prr.value = String(count)
  q('pixel_size_val').textContent = (g.doc.w / count).toFixed(1).replace(/\.0$/, '') + ' px / ドット'
  for (const button of q('pixel_choices').querySelectorAll<HTMLButtonElement>('[data-pixel-count]')) {
    const value = Number(button.dataset.pixelCount)
    button.disabled = value > maximum
    button.setAttribute('aria-pressed', String(value === count))
  }
  marks_render()
  for (let t = 0; t < 3; t++) q('pal_tab_' + t).setAttribute('aria-pressed', String(p.pal_mode === t))
  palette_render(ink_list())
  q<HTMLInputElement>('pick_in').value = p.color
  const hx = q<HTMLInputElement>('hex_in')
  if (document.activeElement !== hx) hx.value = p.color
}

function r_layer(): void {
  layer_panel_render()
  layer_stack_render()
}

function r_play(): void {
  const g = st()
  const on = anim_playing()
  q('play_btn').innerHTML = ic(on ? 'pause' : 'play')
  q('play_btn').setAttribute('aria-label', tr(on ? '停止' : '再生'))
  q('play_btn').classList.toggle('on', !!on)
  pressed(q('loop_btn'), !!g.doc.loop)
  q('loop_btn').title = g.doc.loop ? 'ループ再生をオフにする' : 'ループ再生をオンにする'
  q('loop_state').textContent = tr(g.doc.loop ? 'ループ オン' : 'ループ オフ')
  const speeds = mode_speeds(g.doc.mode)
  const idx = mode_speed_index(g.doc.mode, g.doc.fps)
  const fr = q<HTMLInputElement>('fps_range')
  fr.max = String(speeds.length - 1)
  if (document.activeElement !== fr) fr.value = String(idx)
  q('fps_val').textContent = g.doc.fps + ' コマ/秒'
  q('fps_main').textContent = String(g.doc.fps)
  q('fps_tag').textContent = '・' + mode_speed_tag(g.doc.mode, g.doc.fps)
}

let zoom_t: ReturnType<typeof setTimeout> | 0 = 0

function r_zoom(): void {
  const zl = q('zoom_label')
  zl.textContent = Math.round(st().view.z * 100) + '%'
  zl.classList.add('on')
  if (zoom_t) clearTimeout(zoom_t)
  zoom_t = setTimeout(() => zl.classList.remove('on'), 900)
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
  const bv = q<HTMLInputElement>('bgm_vol')
  const sv = q<HTMLInputElement>('se_vol')
  if (document.activeElement !== bv) bv.value = String(Math.round(g.snd.bgm_vol * 100))
  if (document.activeElement !== sv) sv.value = String(Math.round(g.snd.se_vol * 100))

}

function r_save(): void {
  const sstate = store_state()
  const dot = q('save_dot')
  dot.classList.toggle('busy', sstate === 1)
  dot.classList.toggle('err', sstate === 2)
  dot.classList.toggle('on', sstate === 0 && !!store_blink())
  dot.title = sstate === 1 ? '保存中…' : sstate === 2 ? '保存に失敗（再試行中）' : proj_dirty() ? '未保存の変更あり' : '自動保存ずみ'
}


function r_dock(): void {
  const g = st()
  const t = g.pen.tool
  for (const button of q('dock_row').querySelectorAll<HTMLElement>('[data-dock-tool]')) {
    const selected = Number(button.dataset.dockTool) === t
    pressed(button, selected)
  }
  q('dock_chip').style.background = g.pen.color
  // うごメモ・うごメモ3Dにはドット絵の道具がないので、右メニューから外す (道具箱には残す)。
  q('dock_tool_' + t_pixel).hidden = g.doc.mode !== mode_normal
  // 図形のボタンは、最後に使った図形の絵にする。
  const shape = shape_tools.includes(t)
  if (shape) shape_memory.tool = t
  const dock_shape = q('dock_shape')
  const shape_def = tool_def(shape_memory.tool)
  if (shape_def && dock_shape.dataset.dockShape !== String(shape_memory.tool)) {
    dock_shape.dataset.dockShape = String(shape_memory.tool)
    dock_shape.querySelector('.ic')!.outerHTML = ic(shape_def.icon)
    dock_shape.title = tr('図形') + ' (' + tr(shape_def.label) + ')'
  }
  pressed(dock_shape, shape)
  for (const button of q('shape_choices').querySelectorAll<HTMLElement>('[data-shape]')) button.setAttribute('aria-pressed', String(Number(button.dataset.shape) === t))
}

function r_settings(): void {
  pressed(q('uisfx_tgl'), !!pref_uisfx())
  const hidden = !!pref_hide_controls()
  pressed(q('hide_controls_btn'), hidden)
  q('toolbox_mirror').setAttribute('aria-pressed', String(!!st().view.flip))
  q('toolbox_mirror').classList.toggle('on', !!st().view.flip)
}

function r_chrome(): void {
  const g = st()
  document.body.dataset.mode = g.doc.mode === mode_dsi ? 'dsi' : g.doc.mode === mode_3_d ? '3d' : ''
  for (const id of ['mode_name', 'project_mode_name']) q(id).textContent = mode_name(g.doc.mode)
  const assist = q('motion_assist_btn')
  const runtime = mode_allows_runtime_anim(g.doc.mode)
  const animated = runtime ? animfx_active(g.doc.anim) : 0
  assist.classList.toggle('on', !!animated)
  assist.title = runtime ? (animated ? '再生時のうごきが有効' : '手描きゆらぎとうごきの設定') : 'うごメモ系モードでは動きを実コマへ変換します'
  const mb = q('mode_badge')
  const mbn = g.doc.mode === mode_normal ? '' : mode_name(g.doc.mode)
  if (mb.textContent !== mbn) mb.textContent = mbn
  document.body.dataset.theme = pref_theme() ? 'dark' : ''
  pressed(q('theme_btn'), !!pref_theme())
  q('theme_btn').querySelector('.ic')?.remove()
  q('theme_btn').insertAdjacentHTML('afterbegin', ic(pref_theme() ? 'sun' : 'moon'))
  q('vflip_btn').classList.toggle('on', !!g.view.flip)
  const ti = q<HTMLInputElement>('title')
  if (document.activeElement !== ti && ti.value !== g.doc.name) ti.value = g.doc.name
  const menu_title = q<HTMLInputElement>('menu_title')
  if (document.activeElement !== menu_title) menu_title.value = g.doc.name
  const rs = q<HTMLSelectElement>('ratio_sel')
  if (document.activeElement !== rs && rs.value !== g.doc.ratio) rs.value = g.doc.ratio
  const zs = q<HTMLSelectElement>('reso_sel')
  if (document.activeElement !== zs && zs.value !== g.doc.res) zs.value = g.doc.res
  const [w, h] = [g.doc.w, g.doc.h]
  q('size_now').textContent = w + '×' + h
  q<HTMLSelectElement>('ratio_sel').value = g.doc.ratio
  q<HTMLSelectElement>('reso_sel').value = g.doc.res
  q<HTMLInputElement>('paper_in').value = g.doc.paper
}

function r_onion_ui(): void {
  const g = st()
  q('onion_btn').classList.toggle('on', !!(g.view.onion && (g.view.oprev || g.view.onext)))
  for (const [id, key] of [['onion_prev', 'oprev'], ['onion_next', 'onext']] as const) {
    pressed(q(id), !!g.view[key])
  }
  q('onion_more').hidden = !g.view.onion
  const shown = g.view.onion ? g.view.ocount : 0
  q('onion_btn').setAttribute('aria-pressed', String(!!shown && !!(g.view.oprev || g.view.onext)))
  q('onion_btn').querySelector('i')!.textContent = shown ? '前の絵 ' + shown : '前の絵'
  for (const button of q('onion_choices').querySelectorAll<HTMLElement>('[data-onion-count]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.onionCount) === shown))
  }
  const oc = q<HTMLInputElement>('onion_count')
  if (document.activeElement !== oc) oc.value = String(shown)
  q('onion_count_val').textContent = tr_line(shown ? shown + '枚' : 'オフ')
}

function r_grid_ui(): void {
  const g = st()
  document.body.dataset.grid = String(g.view.grid ? 1 : 0)
  const pixel = g.pen.tool === t_pixel
  pressed(q('grid_btn'), !!g.view.grid)
  q('adjust_grid').setAttribute('aria-pressed', String(!!g.view.grid))
  const input = q<HTMLInputElement>('grid_step_num')
  input.disabled = pixel
  if (document.activeElement !== input) input.value = String(g.view.gsize)
  q('grid_step_val').textContent = g.view.gsize + 'px'
  for (const button of q('grid_choices').querySelectorAll<HTMLButtonElement>('[data-grid-size]')) {
    button.disabled = pixel
    button.setAttribute('aria-pressed', String(!pixel && Number(button.dataset.gridSize) === g.view.gsize))
  }
}


function pat_previews(): void {
  const nodes = document.querySelectorAll('[data-patprev]')
  for (let k = 0; k < nodes.length; k++) {
    const c = nodes[k] as HTMLCanvasElement
    const pi = Number(c.dataset.patprev)
    const x = c.getContext('2d') as CanvasRenderingContext2D
    x.clearRect(0, 0, 28, 28)
    x.fillStyle = pref_theme() ? '#EDF0F7' : '#3A2E2A'
    const g = st()
    const tile = paint_pattern(g.doc.mode, pi, paint_active(g.doc.mode, g.pen.paint_tile, g.pen.paint_tile_normal))
    const s = 2
    for (let y = 0; y < 14; y++)
      for (let px = 0; px < 14; px++) if (paint_bit(tile, px, y)) x.fillRect(px * s, y * s, s, s)
  }
}

function flush(): void {
  let bits = flush_begin()
  if (!bits) return
  if (bits & d_timeline) bits |= d_thumb | d_frameinfo
  let translate = 0
  try {
    for (const region of regions) {
      if (!(bits & region.mask)) continue
      try {
        region.fn()
        if (lang === 'en' && !['stage', 'timeline', 'thumbs', 'frameinfo', 'sel', 'zoom'].includes(region.name)) translate = 1
      } catch (error) {
        report_error('再描画領域 ' + region.name + ' の更新に失敗しました', error)
      }
    }
    if (translate) tr_dom(q('app'))
  } finally {
    flush_end()
  }
}

let raf_pending = 0

function schedule(): void {
  if (raf_pending) return
  raf_pending = 1
  requestAnimationFrame(() => {
    raf_pending = 0
    flush()
  })
}

export function sync_mount(): void {
  if (mounted) return
  mounted = 1
  region_add('stage', d_stage | d_zoom | d_grid | d_onion, r_stage)
  region_add('timeline', d_timeline, r_timeline)
  region_add('thumbs', d_thumb, r_thumbs)
  region_add('frameinfo', d_frameinfo, r_frameinfo)
  region_add('tools', d_tools | d_mode, r_tools)
  region_add('workbench', d_pen | d_tools | d_mode, () => workbench_render(st().pen))
  region_add('pen', d_pen | d_mode, r_pen)
  region_add('layer', d_layer | d_mode, r_layer)
  region_add('play', d_play, r_play)
  region_add('zoom', d_zoom, r_zoom)
  region_add('sound', d_sound, r_sound)
  region_add('save', d_save, r_save)
  region_add('chrome', d_page | d_mode | d_anim, r_chrome)
  region_add('settings', d_page | d_grid | d_onion | d_sound, r_settings)
  region_add('dock', d_pen | d_tools | d_page | d_stage | d_layer | d_mode, r_dock)
  region_add('onion_ui', d_onion, r_onion_ui)
  region_add('grid_ui', d_grid | d_pen | d_tools, r_grid_ui)
  region_add('workspace', d_page | d_mode | d_layer | d_tools, workspace_layout_render)
  region_add('selection_toolbar', d_sel | d_tools | d_trans | d_zoom | d_stage | d_page | d_timeline, () => selection_toolbar_render(st()))
  pat_previews()
  store_dirty_hook(schedule)
  schedule()
}
