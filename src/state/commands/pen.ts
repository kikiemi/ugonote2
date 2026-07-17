import { D_TOOLS, D_PEN, D_STAGE, D_SEL, D_LAYER, T_PASTE, T_EYEDROP, SIZE_MIN, SIZE_MAX, PXN_MIN, PXN_MAX, ERR_BAD, ERR_NOOP, L_N } from '../../h'
import { clamp } from '../../lib'
import { mode_layers } from '../../mode'
import { storage_write_json } from '../../storage'
import { fx_toast, fx_sfx } from '../fx_hooks'
import type { Globals } from '../store'

export type Cmds = {
  'pen.set_tool': number
  'pen.eyedrop_pick': { r: number, g: number, b: number }
  'pen.set_color': string
  'pen.set_size': number
  'pen.set_brush': number
  'pen.set_pat': number
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

function custom_save(g: Globals): void {
  storage_write_json('ug2_pal', g.pen.custom)
}

export const PEN_COMMANDS = {
  'pen.set_tool': (g: Globals, t: number): number => {
    if (!Number.isInteger(t)) return ERR_BAD
    if (t === T_PASTE && !g.clip) {
      fx_toast('先に選択ツールでコピーしてね')
      return ERR_NOOP
    }
    if (g.pen.tool !== T_EYEDROP && g.pen.tool !== t) g.pen.prevTool = g.pen.tool
    g.pen.tool = t
    fx_sfx('tap')
    return 0
  },

  'pen.eyedrop_pick': (g: Globals, p: { r: number, g: number, b: number }): number => {
    if (![p.r, p.g, p.b].every(Number.isFinite)) return ERR_BAD
    const r = clamp(Math.round(p.r), 0, 255)
    const gg = clamp(Math.round(p.g), 0, 255)
    const b = clamp(Math.round(p.b), 0, 255)
    g.pen.color = '#' + ((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1).toUpperCase()
    g.pen.tool = g.pen.prevTool
    fx_toast('色をスポイトしました ' + g.pen.color)
    fx_sfx('tap')
    return 0
  },

  'pen.set_color': (g: Globals, c: string): number => {
    g.pen.color = c.toUpperCase()
    return 0
  },

  'pen.set_size': (g: Globals, v: number): number => {
    if (!Number.isFinite(v)) return ERR_BAD
    g.pen.size = clamp(Math.round(v), SIZE_MIN, SIZE_MAX)
    return 0
  },

  'pen.set_brush': (g: Globals, b: number): number => {
    if (!Number.isInteger(b)) return ERR_BAD
    g.pen.brush = b
    g.pen.markId = ''
    return 0
  },

  'pen.set_pat': (g: Globals, p: number): number => {
    if (!Number.isInteger(p)) return ERR_BAD
    g.pen.pat = p
    return 0
  },

  'pen.set_alpha_pct': (g: Globals, v: number): number => {
    if (!Number.isFinite(v)) return ERR_BAD
    g.pen.alpha = clamp(v / 100, 0.1, 1)
    return 0
  },

  'pen.set_smooth': (g: Globals, v: number): number => {
    if (!Number.isFinite(v)) return ERR_BAD
    g.pen.smooth = clamp(Math.round(v), 0, 4)
    return 0
  },

  'pen.set_layer': (g: Globals, l: number): number => {
    if (!Number.isInteger(l) || l < 1 || l > mode_layers(g.doc.mode) || l >= L_N || g.doc.lord.indexOf(l) < 0) return ERR_BAD
    g.pen.layer = l
    return 0
  },

  'pen.toggle_pressure': (g: Globals, _p: null): number => {
    g.pen.pressure = g.pen.pressure ? 0 : 1
    return 0
  },

  'pen.toggle_sym': (g: Globals, _p: null): number => {
    g.pen.sym = g.pen.sym ? 0 : 1
    return 0
  },

  'pen.toggle_symy': (g: Globals, _p: null): number => {
    g.pen.symy = g.pen.symy ? 0 : 1
    return 0
  },

  'pen.toggle_outline': (g: Globals, _p: null): number => {
    g.pen.outline = g.pen.outline ? 0 : 1
    return 0
  },

  'pen.set_owidth': (g: Globals, v: number): number => {
    if (!Number.isFinite(v)) return ERR_BAD
    g.pen.owidth = clamp(Math.round(v), 1, 12)
    return 0
  },

  'pen.set_ocolor': (g: Globals, c: string): number => {
    g.pen.ocolor = c
    return 0
  },

  'pen.toggle_fill': (g: Globals, _p: null): number => {
    g.pen.fill = g.pen.fill ? 0 : 1
    return 0
  },

  'pen.toggle_fill_all': (g: Globals, _p: null): number => {
    g.pen.fillAll = g.pen.fillAll ? 0 : 1
    return 0
  },

  'pen.set_pxn': (g: Globals, v: number): number => {
    if (!Number.isFinite(v)) return ERR_BAD
    g.pen.pxn = clamp(Math.round(v), PXN_MIN, PXN_MAX)
    return 0
  },

  'pen.set_pal_mode': (g: Globals, t: number): number => {
    if (!Number.isInteger(t)) return ERR_BAD
    g.pen.palMode = t
    return 0
  },

  'pen.set_mark': (g: Globals, id: string): number => {
    g.pen.markId = id
    return 0
  },

  'pen.custom_add': (g: Globals, c: string): number => {
    const up = c.toUpperCase()
    if (g.pen.custom.indexOf(up) >= 0) {
      fx_toast('もう登録されてるよ')
      return ERR_NOOP
    }
    if (g.pen.custom.length >= 16) g.pen.custom.shift()
    g.pen.custom.push(up)
    custom_save(g)
    fx_toast('とうろくしました')
    fx_sfx('save')
    return 0
  },

  'pen.custom_remove': (g: Globals, i: number): number => {
    if (!Number.isInteger(i) || i < 0 || i >= g.pen.custom.length) return ERR_BAD
    g.pen.custom.splice(i, 1)
    custom_save(g)
    fx_toast('消しました')
    fx_sfx('del')
    return 0
  },

  'pen.custom_set': (g: Globals, arr: string[]): number => {
    g.pen.custom = arr.slice(0, 16)
    return 0
  },
}

export const PEN_EFFECTS: Partial<Record<keyof Cmds, number>> = {
  'pen.set_tool': D_TOOLS | D_PEN | D_SEL,
  'pen.eyedrop_pick': D_PEN | D_TOOLS,
  'pen.set_color': D_PEN,
  'pen.set_size': D_PEN,
  'pen.set_brush': D_PEN,
  'pen.set_pat': D_PEN,
  'pen.set_alpha_pct': D_PEN,
  'pen.set_smooth': D_PEN,
  'pen.set_layer': D_LAYER | D_PEN | D_TOOLS,
  'pen.toggle_pressure': D_PEN,
  'pen.toggle_sym': D_PEN,
  'pen.toggle_symy': D_PEN,
  'pen.toggle_outline': D_PEN,
  'pen.set_owidth': D_PEN,
  'pen.set_ocolor': D_PEN,
  'pen.toggle_fill': D_PEN,
  'pen.toggle_fill_all': D_PEN,
  'pen.set_pxn': D_PEN | D_STAGE,
  'pen.set_pal_mode': D_PEN,
  'pen.set_mark': D_PEN,
  'pen.custom_add': D_PEN,
  'pen.custom_remove': D_PEN,
  'pen.custom_set': D_PEN,
}

export const PEN_TOUCH = new Set<keyof Cmds>([])
