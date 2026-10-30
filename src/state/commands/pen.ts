import { d_tools, d_pen, mode_normal, t_eraser, t_patbrush, t_pen, d_stage, d_sel, d_layer, t_paste, t_eyedrop, size_min, size_max, pxn_min, pxn_max, t_pixel, err_bad, err_noop, l_n } from '../../h'
import { clamp } from '../../lib'
import { pat_custom, paint_active, paint_tile_valid } from '../../paint'
import { mode_color, mode_layers, mode_one_sheet, sheet_layer } from '../../mode'
import { native_eraser_for_pat, native_eraser_for_size, native_eraser_tips_for, native_eraser_valid, native_paint_valid, native_pen_tips_for, n_solid, native_pen_valid, pen_brush_allowed, pen_mode_normalize, pen_native_select, pen_tool, pen_tool_memory } from '../../penprofile'
import { storage_write_json } from '../../storage'
import { fx_toast, fx_sfx } from '../fx_hooks'
import type { globals_t } from '../store'

export type cmds_t = {
  'pen.set_tool': number
  'pen.eyedrop_pick': { r: number, g: number, b: number }
  'pen.set_color': string
  'pen.set_size': number
  'pen.set_brush': number
  'pen.set_native_tip': number
  'pen.toggle_native_expand': null
  'pen.set_native_eraser': number
  'pen.toggle_native_eraser_expand': null
  'pen.set_native_paint': number
  'pen.set_pat': number
  'pen.set_paint_over': number
  'pen.load_paint': unknown
  'pen.load_paint_normal': unknown
  'pen.set_alpha_pct': number
  'pen.set_smooth': number
  'pen.set_layer': number
  'pen.toggle_pressure': null
  'pen.toggle_sym': null
  'pen.toggle_symy': null
  'pen.toggle_outline': null
  'pen.set_owidth': number
  'pen.set_ocolor': string
  'pen.toggle_fill': null
  'pen.toggle_fill_all': null
  'pen.set_pxn': number
  'pen.set_pal_mode': number
  'pen.set_mark': string
  'pen.custom_add': string
  'pen.custom_remove': number
  'pen.custom_set': string[]
}

function custom_save(g: globals_t): void {
  storage_write_json('ug2_pal', g.pen.custom)
}

export const pen_commands = {
  'pen.set_tool': (g: globals_t, t: number): number => {
    if (!Number.isInteger(t)) return err_bad
    if (t === t_paste && !g.clip) {
      fx_toast('先に選択ツールでコピーしてね')
      return err_noop
    }
    if (g.pen.tool !== t_eyedrop && g.pen.tool !== t) g.pen.prev_tool = g.pen.tool
    pen_tool_memory(g.pen, g.pen.tool, t)
    g.pen.tool = t
    pen_mode_normalize(g.pen, g.doc.mode)
    fx_sfx('tap')
    return 0
  },

  'pen.eyedrop_pick': (g: globals_t, p: { r: number, g: number, b: number }): number => {
    if (![p.r, p.g, p.b].every(Number.isFinite)) return err_bad
    const r = clamp(Math.round(p.r), 0, 255)
    const gg = clamp(Math.round(p.g), 0, 255)
    const b = clamp(Math.round(p.b), 0, 255)
    g.pen.color = mode_color(g.doc.mode, '#' + ((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1).toUpperCase())
    if (mode_one_sheet(g.doc)) g.pen.layer = sheet_layer(g.pen.color)
    pen_tool_memory(g.pen, g.pen.tool, g.pen.prev_tool)
    g.pen.tool = g.pen.prev_tool
    pen_mode_normalize(g.pen, g.doc.mode)
    fx_toast('色をスポイトしました ' + g.pen.color)
    fx_sfx('tap')
    return 0
  },

  'pen.set_color': (g: globals_t, c: string): number => {
    if (!/^#[0-9a-f]{6}$/i.test(c)) return err_bad
    g.pen.color = mode_color(g.doc.mode, c)
    if (mode_one_sheet(g.doc)) g.pen.layer = sheet_layer(g.pen.color)
    return 0
  },

  'pen.set_size': (g: globals_t, v: number): number => {
    if (!Number.isFinite(v)) return err_bad
    if (g.doc.mode !== mode_normal && pen_tool(g.pen.tool)) {
      const tip = native_pen_tips_for(g.doc.mode).find(t => t.shape === n_solid && t.size === v)
      if (!tip) return err_bad
      pen_native_select(g.pen, tip.id, g.doc.mode)
      return 0
    }
    if (g.doc.mode !== mode_normal && g.pen.tool === t_eraser) {
      const tip = native_eraser_for_size(g.doc.mode, v, g.pen.native_eraser)
      if (tip < 0) return err_bad
      g.pen.native_eraser = tip
      g.pen.size = v
      return 0
    }
    g.pen.size = clamp(Math.round(v), size_min, size_max)
    return 0
  },

  'pen.set_brush': (g: globals_t, b: number): number => {
    if (!pen_brush_allowed(g.doc.mode, b)) return err_bad
    g.pen.brush = b
    g.pen.mark_id = ''
    return 0
  },

  'pen.set_native_tip': (g: globals_t, id: number): number => {
    if (g.doc.mode === mode_normal || !native_pen_valid(id)) return err_bad
    pen_native_select(g.pen, id, g.doc.mode)
    return 0
  },

  'pen.toggle_native_expand': (g: globals_t, _p: null): number => {
    if (g.doc.mode === mode_normal || !native_pen_valid(g.pen.native_tip)) return err_bad
    pen_native_select(g.pen, g.pen.native_tip ^ 8, g.doc.mode)
    return 0
  },

  'pen.set_native_eraser': (g: globals_t, id: number): number => {
    if (g.doc.mode === mode_normal || !native_eraser_valid(id)) return err_bad
    g.pen.native_eraser = id
    g.pen.size = native_eraser_tips_for(g.doc.mode)[id].size
    return 0
  },

  'pen.toggle_native_eraser_expand': (g: globals_t, _p: null): number => {
    if (g.doc.mode === mode_normal || !native_eraser_valid(g.pen.native_eraser)) return err_bad
    g.pen.native_eraser ^= 8
    return 0
  },

  'pen.set_native_paint': (g: globals_t, id: number): number => {
    if (g.doc.mode === mode_normal || !native_paint_valid(id)) return err_bad
    g.pen.native_paint = id
    return 0
  },

  'pen.set_pat': (g: globals_t, p: number): number => {
    if (!Number.isInteger(p) || p < 0 || p > pat_custom) return err_bad
    if (p === pat_custom && !paint_active(g.doc.mode, g.pen.paint_tile, g.pen.paint_tile_normal)) return err_noop
    // ペンはいつもベタ。ペンのままもようを選んだときは模様ブラシに持ちかえる。
    if (g.pen.tool === t_pen && p) {
      g.pen.prev_tool = t_pen
      pen_tool_memory(g.pen, t_pen, t_patbrush)
      g.pen.tool = t_patbrush
    }
    g.pen.pat = p
    if (g.doc.mode !== mode_normal && g.pen.tool === t_eraser) g.pen.native_eraser = native_eraser_for_pat(p, g.pen.native_eraser)
    return 0
  },

  'pen.set_paint_over': (g: globals_t, v: number): number => {
    if (v !== 0 && v !== 1) return err_bad
    g.pen.paint_over = v
    return 0
  },

  'pen.load_paint': (g: globals_t, v: unknown): number => {
    if (!paint_tile_valid(v)) return err_bad
    g.pen.paint_tile = { w: v.w, h: v.h, b: v.b.slice() }
    return 0
  },

  'pen.load_paint_normal': (g: globals_t, v: unknown): number => {
    if (!paint_tile_valid(v)) return err_bad
    g.pen.paint_tile_normal = { w: v.w, h: v.h, b: v.b.slice(), rgba: v.rgba?.slice() }
    return 0
  },

  'pen.set_alpha_pct': (g: globals_t, v: number): number => {
    if (!Number.isFinite(v)) return err_bad
    g.pen.alpha = g.doc.mode === mode_normal ? clamp(v / 100, 0.1, 1) : 1
    return 0
  },

  'pen.set_smooth': (g: globals_t, v: number): number => {
    if (!Number.isFinite(v)) return err_bad
    g.pen.smooth = g.doc.mode === mode_normal ? clamp(Math.round(v), 0, 4) : 0
    return 0
  },

  'pen.set_layer': (g: globals_t, l: number): number => {
    if (!Number.isInteger(l) || l < 1 || l > mode_layers(g.doc.mode) || l >= l_n || g.doc.lord.indexOf(l) < 0) return err_bad
    g.pen.layer = l
    return 0
  },

  'pen.toggle_pressure': (g: globals_t, _p: null): number => {
    g.pen.pressure = g.doc.mode === mode_normal && !g.pen.pressure ? 1 : 0
    return 0
  },

  'pen.toggle_sym': (g: globals_t, _p: null): number => {
    g.pen.sym = g.pen.sym ? 0 : 1
    return 0
  },

  'pen.toggle_symy': (g: globals_t, _p: null): number => {
    g.pen.symy = g.pen.symy ? 0 : 1
    return 0
  },

  'pen.toggle_outline': (g: globals_t, _p: null): number => {
    g.pen.outline = g.pen.outline ? 0 : 1
    return 0
  },

  'pen.set_owidth': (g: globals_t, v: number): number => {
    if (!Number.isFinite(v)) return err_bad
    g.pen.owidth = clamp(Math.round(v), 1, 12)
    return 0
  },

  'pen.set_ocolor': (g: globals_t, c: string): number => {
    if (!/^#[0-9a-f]{6}$/i.test(c)) return err_bad
    g.pen.ocolor = mode_color(g.doc.mode, c)
    return 0
  },

  'pen.toggle_fill': (g: globals_t, _p: null): number => {
    g.pen.fill = g.pen.fill ? 0 : 1
    return 0
  },

  'pen.toggle_fill_all': (g: globals_t, _p: null): number => {
    g.pen.fill_all = g.pen.fill_all ? 0 : 1
    return 0
  },

  'pen.set_pxn': (g: globals_t, v: number): number => {
    if (!Number.isFinite(v)) return err_bad
    g.pen.pxn = clamp(Math.round(v), pxn_min, Math.min(pxn_max, g.doc.w))
    if (g.pen.tool === t_pixel) g.view.grid = 1
    return 0
  },

  'pen.set_pal_mode': (g: globals_t, t: number): number => {
    if (!Number.isInteger(t)) return err_bad
    g.pen.pal_mode = g.doc.mode === mode_normal ? t : g.doc.mode
    return 0
  },

  'pen.set_mark': (g: globals_t, id: string): number => {
    g.pen.mark_id = id
    return 0
  },

  'pen.custom_add': (g: globals_t, c: string): number => {
    const up = c.toUpperCase()
    if (g.pen.custom.indexOf(up) >= 0) {
      fx_toast('もう登録されてるよ')
      return err_noop
    }
    if (g.pen.custom.length >= 16) g.pen.custom.shift()
    g.pen.custom.push(up)
    custom_save(g)
    fx_toast('とうろくしました')
    fx_sfx('save')
    return 0
  },

  'pen.custom_remove': (g: globals_t, i: number): number => {
    if (!Number.isInteger(i) || i < 0 || i >= g.pen.custom.length) return err_bad
    g.pen.custom.splice(i, 1)
    custom_save(g)
    fx_toast('消しました')
    fx_sfx('del')
    return 0
  },

  'pen.custom_set': (g: globals_t, arr: string[]): number => {
    g.pen.custom = arr.slice(0, 16)
    return 0
  },
}

export const pen_effects: Partial<Record<keyof cmds_t, number>> = {
  'pen.set_tool': d_tools | d_pen | d_sel,
  'pen.eyedrop_pick': d_pen | d_tools | d_layer,
  'pen.set_color': d_pen | d_layer,
  'pen.set_size': d_pen,
  'pen.set_brush': d_pen,
  'pen.set_native_tip': d_pen,
  'pen.toggle_native_expand': d_pen,
  'pen.set_native_eraser': d_pen,
  'pen.toggle_native_eraser_expand': d_pen,
  'pen.set_native_paint': d_pen,
  'pen.set_paint_over': d_pen | d_sel,
  'pen.load_paint': d_pen,
  'pen.load_paint_normal': d_pen,
  'pen.set_pat': d_pen | d_tools,
  'pen.set_alpha_pct': d_pen,
  'pen.set_smooth': d_pen,
  'pen.set_layer': d_layer | d_pen | d_tools,
  'pen.toggle_pressure': d_pen,
  'pen.toggle_sym': d_pen,
  'pen.toggle_symy': d_pen,
  'pen.toggle_outline': d_pen,
  'pen.set_owidth': d_pen,
  'pen.set_ocolor': d_pen,
  'pen.toggle_fill': d_pen,
  'pen.toggle_fill_all': d_pen,
  'pen.set_pxn': d_pen | d_stage,
  'pen.set_pal_mode': d_pen,
  'pen.set_mark': d_pen,
  'pen.custom_add': d_pen,
  'pen.custom_remove': d_pen,
  'pen.custom_set': d_pen,
}

export const pen_touch = new Set<keyof cmds_t>([])
