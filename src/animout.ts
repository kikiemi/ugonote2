import { animfx_active, animfx_compose, animfx_compose_cycle, animfx_loop_plan, animfx_time_for_tick, type AnimFxLoop } from './animfx'
import { doc_compose } from './doc'
import { HOLD_MAX, type AnimFx } from './h'
import { clamp } from './lib'

export type AnimOutJob = {
  frame: number
  tick: number
  hold: number
  first: number
  cycleIndex: number
  cycleCount: number
  loop: AnimFxLoop | null
}

function frame_hold(value: number): number {
  return clamp(Math.round(value), 1, HOLD_MAX)
}

export function animout_tick_before(frames: readonly { readonly hold: number }[], frameIndex: number): number {
  let tick = 0
  const end = clamp(Math.trunc(frameIndex), 0, frames.length)
  for (let frame = 0; frame < end; frame++) tick += frame_hold(frames[frame].hold)
  return tick
}

export function animout_jobs(frames: readonly { readonly hold: number }[], aValue: number, bValue: number, fps: number, fx: Readonly<AnimFx>, compressStatic: number): AnimOutJob[] {
  if (!frames.length) return []
  const a = clamp(Math.trunc(aValue), 0, frames.length - 1)
  const b = clamp(Math.trunc(bValue), a, frames.length - 1)
  const active = animfx_active(fx)
  const jobs: AnimOutJob[] = []
  let tick = animout_tick_before(frames, a)
  if (active && a === b) {
    const base = animfx_loop_plan(fps, fx)
    const count = Math.max(frame_hold(frames[a].hold), base.ticks)
    const scale = count / base.ticks
    const loop: AnimFxLoop = {
      ticks: count,
      wiggleCycles: base.wiggleCycles ? Math.max(1, Math.round(base.wiggleCycles * scale)) : 0,
      motionCycles: base.motionCycles ? Math.max(1, Math.round(base.motionCycles * scale)) : 0,
    }
    for (let index = 0; index < count; index++) jobs.push({ frame: a, tick: tick + index, hold: 1, first: index === 0 ? 1 : 0, cycleIndex: index, cycleCount: count, loop })
    return jobs
  }
  for (let frame = a; frame <= b; frame++) {
    const hold = frame_hold(frames[frame].hold)
    if (!active && compressStatic) {
      jobs.push({ frame, tick, hold, first: 1, cycleIndex: 0, cycleCount: 0, loop: null })
    } else {
      for (let offset = 0; offset < hold; offset++) jobs.push({ frame, tick: tick + offset, hold: 1, first: offset === 0 ? 1 : 0, cycleIndex: 0, cycleCount: 0, loop: null })
    }
    tick += hold
  }
  return jobs
}

export function animout_ticks(jobs: readonly AnimOutJob[]): number {
  let ticks = 0
  for (const job of jobs) ticks += job.hold
  return ticks
}

export function animout_compose(job: Readonly<AnimOutJob>, context: CanvasRenderingContext2D, w: number, h: number, withPaper: number, fps: number, fx: Readonly<AnimFx>): void {
  if (!animfx_active(fx)) {
    doc_compose(job.frame, context, w, h, withPaper)
    return
  }
  if (job.loop && job.cycleCount > 0) {
    animfx_compose_cycle(job.frame, context, w, h, withPaper, job.cycleIndex / job.cycleCount, job.loop, fx)
    return
  }
  animfx_compose(job.frame, context, w, h, withPaper, animfx_time_for_tick(job.tick, fps), fx)
}
