import { D_STAGE, D_ZOOM, D_ONION, D_GRID, D_PAGE, D_TOOLS, ERR_BAD, ERR_NOOP } from '../../h'
import { clamp } from '../../lib'
import { fx_stage_size } from '../fx_hooks'
import type { Globals } from '../store'

export type Cmds = {
  'view.fit': null
  'view.fit_if_stale': null
  'view.zoom_at': { sx: number, sy: number, factor: number }
  'view.pan_to': { px: number, py: number }
  'view.set_viewport': { z: number, px: number, py: number }
  'view.toggle_onion': null
  'view.set_onion_count': number
  'view.toggle_grid': null
  'view.set_grid_size': number
  'view.toggle_flip': null
  'view.toggle_timeline': null
  'view.set_timeline_open': number
  'view.set_page': string
}

function fit(g: Globals, _p: null): number {
  const sz = fx_stage_size()
  const vw = sz.w
  const vh = sz.h
  if (vw < 8 || vh < 8) return 0
  const pad = 24
  const z = Math.min((vw - pad) / g.doc.w, (vh - pad) / g.doc.h)
  g.view.z = clamp(z, 0.02, 32)
  g.view.px = (vw - g.doc.w * g.view.z) / 2
  g.view.py = (vh - g.doc.h * g.view.z) / 2
  g.view.fitZ = g.view.z
  return 0
}

export const VIEW_COMMANDS = {
  'view.fit': fit,

  'view.fit_if_stale': (g: Globals, _p: null): number => {
    if (g.view.fitZ !== 0 && Math.abs(g.view.z - g.view.fitZ) >= 0.001) return ERR_NOOP
    return fit(g, null)
  },

  'view.zoom_at': (g: Globals, p: { sx: number, sy: number, factor: number }): number => {
    if (!Number.isFinite(p.sx) || !Number.isFinite(p.sy) || !Number.isFinite(p.factor) || p.factor <= 0) return ERR_BAD
    const nz = clamp(g.view.z * p.factor, 0.02, 32)
    const k = nz / g.view.z
    if (k === 1) return ERR_NOOP
    g.view.px = p.sx - (p.sx - g.view.px) * k
    g.view.py = p.sy - (p.sy - g.view.py) * k
    g.view.z = nz
    return 0
  },

  'view.pan_to': (g: Globals, p: { px: number, py: number }): number => {
    if (!Number.isFinite(p.px) || !Number.isFinite(p.py)) return ERR_BAD
    g.view.px = p.px
    g.view.py = p.py
    return 0
  },

  'view.set_viewport': (g: Globals, p: { z: number, px: number, py: number }): number => {
    if (!Number.isFinite(p.z) || !Number.isFinite(p.px) || !Number.isFinite(p.py) || p.z <= 0) return ERR_BAD
    g.view.z = clamp(p.z, 0.02, 32)
    g.view.px = p.px
    g.view.py = p.py
    return 0
  },

  'view.toggle_onion': (g: Globals, _p: null): number => {
    g.view.onion = g.view.onion ? 0 : 1
    return 0
  },

  'view.set_onion_count': (g: Globals, v: number): number => {
    if (!Number.isFinite(v)) return ERR_BAD
    const n = clamp(Math.round(v), 0, 3)
    g.view.ocount = n === 0 ? g.view.ocount : n
    g.view.onion = n === 0 ? 0 : 1
    return 0
  },

  'view.toggle_grid': (g: Globals, _p: null): number => {
    g.view.grid = g.view.grid ? 0 : 1
    return 0
  },

  'view.set_grid_size': (g: Globals, v: number): number => {
    if (!Number.isFinite(v)) return ERR_BAD
    g.view.gsize = clamp(Math.round(v), 4, 64)
    return 0
  },

  'view.toggle_flip': (g: Globals, _p: null): number => {
    g.view.flip = g.view.flip ? 0 : 1
    return 0
  },

  'view.toggle_timeline': (g: Globals, _p: null): number => {
    g.view.tlopen = g.view.tlopen ? 0 : 1
    return 0
  },

  'view.set_timeline_open': (g: Globals, value: number): number => {
    const next = value ? 1 : 0
    if (g.view.tlopen === next) return ERR_NOOP
    g.view.tlopen = next
    return 0
  },

  'view.set_page': (g: Globals, p: string): number => {
    g.view.page = p
    return 0
  },
}

export const VIEW_EFFECTS: Partial<Record<keyof Cmds, number>> = {
  'view.fit': D_STAGE | D_ZOOM,
  'view.fit_if_stale': D_STAGE | D_ZOOM,
  'view.zoom_at': D_ZOOM,
  'view.pan_to': D_STAGE | D_ZOOM,
  'view.set_viewport': D_STAGE | D_ZOOM,
  'view.toggle_onion': D_ONION | D_TOOLS,
  'view.set_onion_count': D_ONION | D_TOOLS,
  'view.toggle_grid': D_GRID | D_TOOLS,
  'view.set_grid_size': D_GRID,
  'view.toggle_flip': D_PAGE | D_TOOLS,
  'view.toggle_timeline': D_PAGE,
  'view.set_timeline_open': D_PAGE,
  'view.set_page': D_PAGE | D_STAGE | D_ZOOM,
}

export const VIEW_TOUCH = new Set<keyof Cmds>([])
