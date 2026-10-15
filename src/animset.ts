import { motion_n, anim_fx_zero, type anim_fx_t } from './h'
import { clamp } from './lib'

function finite_value(value: unknown, lo: number, hi: number, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? clamp(number, lo, hi) : fallback
}

function uint_value(value: unknown, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const integer = Math.trunc(number)
  return integer > 0 ? integer >>> 0 : fallback
}

export function anim_seed_mix(value: number): number {
  let seed = Math.trunc(value) >>> 0
  seed ^= seed >>> 16
  seed = Math.imul(seed, 0x7feb352d)
  seed ^= seed >>> 15
  seed = Math.imul(seed, 0x846ca68b)
  seed ^= seed >>> 16
  return seed >>> 0 || 1
}

export function anim_seed_random(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const value = new Uint32Array(1)
    crypto.getRandomValues(value)
    return value[0] || 1
  }
  return anim_seed_mix(Math.floor(Math.random() * 0xffffffff))
}

export function animfx_normalize(source: Partial<anim_fx_t> | null | undefined): anim_fx_t {
  const out = anim_fx_zero()
  if (!source || typeof source !== 'object') return out
  out.wiggle = source.wiggle ? 1 : 0
  out.wiggle_amount = finite_value(source.wiggle_amount, 0, 8, out.wiggle_amount)
  out.wiggle_cell = finite_value(source.wiggle_cell, 8, 96, out.wiggle_cell)
  out.wiggle_rate = finite_value(source.wiggle_rate, 1, 24, out.wiggle_rate)
  out.wiggle_phases = Math.round(finite_value(source.wiggle_phases, 2, 8, out.wiggle_phases))
  out.wiggle_seed = uint_value(source.wiggle_seed, out.wiggle_seed)
  const motion = Number(source.motion)
  out.motion = Number.isInteger(motion) && motion >= 0 && motion < motion_n ? motion : out.motion
  out.motion_amount = finite_value(source.motion_amount, 0, 12, out.motion_amount)
  out.motion_rate = finite_value(source.motion_rate, 0.25, 6, out.motion_rate)
  out.motion_anchor_x = finite_value(source.motion_anchor_x, 0, 1, out.motion_anchor_x)
  out.motion_anchor_y = finite_value(source.motion_anchor_y, 0, 1, out.motion_anchor_y)
  out.motion_seed = uint_value(source.motion_seed, out.motion_seed)
  return out
}

export function animfx_same(a: Readonly<anim_fx_t>, b: Readonly<anim_fx_t>): number {
  return a.wiggle === b.wiggle &&
    a.wiggle_amount === b.wiggle_amount &&
    a.wiggle_cell === b.wiggle_cell &&
    a.wiggle_rate === b.wiggle_rate &&
    a.wiggle_phases === b.wiggle_phases &&
    a.wiggle_seed === b.wiggle_seed &&
    a.motion === b.motion &&
    a.motion_amount === b.motion_amount &&
    a.motion_rate === b.motion_rate &&
    a.motion_anchor_x === b.motion_anchor_x &&
    a.motion_anchor_y === b.motion_anchor_y &&
    a.motion_seed === b.motion_seed ? 1 : 0
}
