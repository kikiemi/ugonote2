import { MOTION_N, anim_fx_zero, type AnimFx } from './h'
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

export function animfx_normalize(source: Partial<AnimFx> | null | undefined): AnimFx {
  const out = anim_fx_zero()
  if (!source || typeof source !== 'object') return out
  out.wiggle = source.wiggle ? 1 : 0
  out.wiggleAmount = finite_value(source.wiggleAmount, 0, 8, out.wiggleAmount)
  out.wiggleCell = finite_value(source.wiggleCell, 8, 96, out.wiggleCell)
  out.wiggleRate = finite_value(source.wiggleRate, 1, 24, out.wiggleRate)
  out.wigglePhases = Math.round(finite_value(source.wigglePhases, 2, 8, out.wigglePhases))
  out.wiggleSeed = uint_value(source.wiggleSeed, out.wiggleSeed)
  const motion = Number(source.motion)
  out.motion = Number.isInteger(motion) && motion >= 0 && motion < MOTION_N ? motion : out.motion
  out.motionAmount = finite_value(source.motionAmount, 0, 12, out.motionAmount)
  out.motionRate = finite_value(source.motionRate, 0.25, 6, out.motionRate)
  out.motionAnchorX = finite_value(source.motionAnchorX, 0, 1, out.motionAnchorX)
  out.motionAnchorY = finite_value(source.motionAnchorY, 0, 1, out.motionAnchorY)
  out.motionSeed = uint_value(source.motionSeed, out.motionSeed)
  return out
}

export function animfx_same(a: Readonly<AnimFx>, b: Readonly<AnimFx>): number {
  return a.wiggle === b.wiggle &&
    a.wiggleAmount === b.wiggleAmount &&
    a.wiggleCell === b.wiggleCell &&
    a.wiggleRate === b.wiggleRate &&
    a.wigglePhases === b.wigglePhases &&
    a.wiggleSeed === b.wiggleSeed &&
    a.motion === b.motion &&
    a.motionAmount === b.motionAmount &&
    a.motionRate === b.motionRate &&
    a.motionAnchorX === b.motionAnchorX &&
    a.motionAnchorY === b.motionAnchorY &&
    a.motionSeed === b.motionSeed ? 1 : 0
}
