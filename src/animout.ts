import { animfx_active, animfx_compose, animfx_compose_cycle, animfx_loop_plan, animfx_time_for_tick, type anim_fx_loop_t } from './animfx'
import { doc_compose } from './doc'
import { hold_max, type anim_fx_t } from './h'
import { clamp } from './lib'

export type anim_out_job_t = {
  frame: number
  tick: number
  hold: number
  first: number
  cycle_index: number
  cycle_count: number
  loop: anim_fx_loop_t | null
}

function frame_hold(value: number): number {
  return clamp(Math.round(value), 1, hold_max)
}

export function animout_tick_before(frames: readonly { readonly hold: number }[], frame_index: number): number {
  let tick = 0
  const end = clamp(Math.trunc(frame_index), 0, frames.length)
  for (let frame = 0; frame < end; frame++) tick += frame_hold(frames[frame].hold)
  return tick
}

export function animout_jobs(frames: readonly { readonly hold: number }[], a_value: number, b_value: number, fps: number, fx: Readonly<anim_fx_t>, compress_static: number): anim_out_job_t[] {
  if (!frames.length) return []
  const a = clamp(Math.trunc(a_value), 0, frames.length - 1)
  const b = clamp(Math.trunc(b_value), a, frames.length - 1)
  const active = animfx_active(fx)
  const jobs: anim_out_job_t[] = []
  let tick = animout_tick_before(frames, a)
  if (active && a === b) {
    const base = animfx_loop_plan(fps, fx)
    const count = Math.max(frame_hold(frames[a].hold), base.ticks)
    const scale = count / base.ticks
    const loop: anim_fx_loop_t = {
      ticks: count,
      wiggle_cycles: base.wiggle_cycles ? Math.max(1, Math.round(base.wiggle_cycles * scale)) : 0,
      motion_cycles: base.motion_cycles ? Math.max(1, Math.round(base.motion_cycles * scale)) : 0,
    }
    for (let index = 0; index < count; index++) jobs.push({ frame: a, tick: tick + index, hold: 1, first: index === 0 ? 1 : 0, cycle_index: index, cycle_count: count, loop })
    return jobs
  }
  for (let frame = a; frame <= b; frame++) {
    const hold = frame_hold(frames[frame].hold)
    if (!active && compress_static) {
      jobs.push({ frame, tick, hold, first: 1, cycle_index: 0, cycle_count: 0, loop: null })
    } else {
      for (let offset = 0; offset < hold; offset++) jobs.push({ frame, tick: tick + offset, hold: 1, first: offset === 0 ? 1 : 0, cycle_index: 0, cycle_count: 0, loop: null })
    }
    tick += hold
  }
  return jobs
}

export function animout_ticks(jobs: readonly anim_out_job_t[]): number {
  let ticks = 0
  for (const job of jobs) ticks += job.hold
  return ticks
}

export function animout_compose(job: Readonly<anim_out_job_t>, context: CanvasRenderingContext2D, w: number, h: number, with_paper: number, fps: number, fx: Readonly<anim_fx_t>): void {
  if (!animfx_active(fx)) {
    doc_compose(job.frame, context, w, h, with_paper)
    return
  }
  if (job.loop && job.cycle_count > 0) {
    animfx_compose_cycle(job.frame, context, w, h, with_paper, job.cycle_index / job.cycle_count, job.loop, fx)
    return
  }
  animfx_compose(job.frame, context, w, h, with_paper, animfx_time_for_tick(job.tick, fps), fx)
}
