import { d_stage, d_zoom, d_onion, d_grid, d_page, d_tools, err_bad, err_noop } from '../../h'
import { clamp } from '../../lib'
import { fx_stage_size } from '../fx_hooks'
import type { globals_t } from '../store'

export type cmds_t = {
  'view.fit': null
  'view.fit_if_stale': null
  'view.zoom_at': { sx: number, sy: number, factor: number }
  'view.pan_to': { px: number, py: number }
  'view.set_viewport': { z: number, px: number, py: number }
  'view.toggle_onion': null
  'view.set_onion_count': number
  'view.toggle_onion_direction': 'oprev' | 'onext'
  'view.toggle_grid': null
  'view.set_grid_size': number
  'view.toggle_flip': null
  'view.toggle_timeline': null
  'view.set_timeline_open': number
  'view.set_page': string
}

function fit(g: globals_t, _p: null): number {
  const sz = fx_stage_size()
  const vw = sz.w
  const vh = sz.h
  if (vw < 8 || vh < 8) return 0
  const pad = g.doc.ratio === 'free' ? 0 : 32
  const z = Math.min((vw - pad) / g.doc.w, (vh - pad) / g.doc.h)
  g.view.z = clamp(z, 0.02, 32)
  g.view.px = (sz.x || 0) + (vw - g.doc.w * g.view.z) / 2
  g.view.py = (sz.y || 0) + (vh - g.doc.h * g.view.z) / 2
  g.view.fit_z = g.view.z
  return 0
}

export const view_commands = {
  'view.fit': fit,

  'view.fit_if_stale': (g: globals_t, _p: null): number => {
    if (g.view.fit_z !== 0 && Math.abs(g.view.z - g.view.fit_z) >= 0.001) return err_noop
    return fit(g, null)
  },

  'view.zoom_at': (g: globals_t, p: { sx: number, sy: number, factor: number }): number => {
    if (!Number.isFinite(p.sx) || !Number.isFinite(p.sy) || !Number.isFinite(p.factor) || p.factor <= 0) return err_bad
    const nz = clamp(g.view.z * p.factor, 0.02, 32)
    const k = nz / g.view.z
    if (k === 1) return err_noop
    g.view.px = p.sx - (p.sx - g.view.px) * k
    g.view.py = p.sy - (p.sy - g.view.py) * k
    g.view.z = nz
    return 0
  },

  'view.pan_to': (g: globals_t, p: { px: number, py: number }): number => {
    if (!Number.isFinite(p.px) || !Number.isFinite(p.py)) return err_bad
    g.view.px = p.px
    g.view.py = p.py
    return 0
  },

  'view.set_viewport': (g: globals_t, p: { z: number, px: number, py: number }): number => {
    if (!Number.isFinite(p.z) || !Number.isFinite(p.px) || !Number.isFinite(p.py) || p.z <= 0) return err_bad
    g.view.z = clamp(p.z, 0.02, 32)
    g.view.px = p.px
    g.view.py = p.py
    return 0
  },

  'view.toggle_onion': (g: globals_t, _p: null): number => {
    g.view.onion = g.view.onion ? 0 : 1
    return 0
  },

  'view.set_onion_count': (g: globals_t, v: number): number => {
    if (!Number.isFinite(v)) return err_bad
    const n = clamp(Math.round(v), 0, 10)
    g.view.ocount = n === 0 ? g.view.ocount : n
    g.view.onion = n === 0 ? 0 : 1
    return 0
  },

  'view.toggle_onion_direction': (g: globals_t, key: 'oprev' | 'onext'): number => {
    if (key !== 'oprev' && key !== 'onext') return err_bad
    g.view[key] = g.view[key] ? 0 : 1
    return 0
  },

  'view.toggle_grid': (g: globals_t, _p: null): number => {
    g.view.grid = g.view.grid ? 0 : 1
    return 0
  },

  'view.set_grid_size': (g: globals_t, v: number): number => {
    if (!Number.isFinite(v)) return err_bad
    g.view.gsize = clamp(Math.round(v), 4, 64)
    g.view.grid = 1
    return 0
  },

  'view.toggle_flip': (g: globals_t, _p: null): number => {
    g.view.flip = g.view.flip ? 0 : 1
    return 0
  },

  'view.toggle_timeline': (g: globals_t, _p: null): number => {
    g.view.tlopen = g.view.tlopen ? 0 : 1
    return 0
  },

  'view.set_timeline_open': (g: globals_t, value: number): number => {
    const next = value ? 1 : 0
    if (g.view.tlopen === next) return err_noop
    g.view.tlopen = next
    return 0
  },

  'view.set_page': (g: globals_t, p: string): number => {
    g.view.page = p
    return 0
  },
}

export const view_effects: Partial<Record<keyof cmds_t, number>> = {
  'view.fit': d_stage | d_zoom,
  'view.fit_if_stale': d_stage | d_zoom,
  'view.zoom_at': d_zoom,
  'view.pan_to': d_stage | d_zoom,
  'view.set_viewport': d_stage | d_zoom,
  'view.toggle_onion': d_onion | d_tools,
  'view.set_onion_count': d_onion | d_tools,
  'view.toggle_onion_direction': d_onion | d_tools,
  'view.toggle_grid': d_grid | d_tools,
  'view.set_grid_size': d_grid,
  'view.toggle_flip': d_page | d_tools,
  'view.toggle_timeline': d_page,
  'view.set_timeline_open': d_page,
  'view.set_page': d_page | d_stage | d_zoom,
}

export const view_touch = new Set<keyof cmds_t>([])
