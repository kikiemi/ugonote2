import { timeline_make, timeline_position, type timeline_t } from '../../playback_clock'
import { doc_pack_live, doc_unpack_live } from '../../doc'
import { d_stage, d_frameinfo, d_play, d_timeline, err_bad, err_noop } from '../../h'
import { snd_play_start, snd_play_elapsed, snd_play_schedule, snd_stop_all } from '../../snd'
import { fx_sfx } from '../fx_hooks'
import { st, type deep_ro_t, type globals_t } from '../store'

let playhead = 0
let timeline: timeline_t | null = null
let origin_time = 0
let origin_offset = 0
let visual_base = 0
let clock_loop = 0
let raf = 0
let visual_time = 0
let play_full = 0
let play_once = 0

export type playback_options_t = { full?: boolean, once?: boolean }

export type cmds_t = {
  'play.start': playback_options_t | null
  'play.stop': null
  'play.toggle': null
  'play.tick': number
  'play.seek': number
  'play.retime': null
}

function range_of(g: deep_ro_t<globals_t>): [number, number] {
  const n = g.doc.frames.length
  let a = play_full ? -1 : g.doc.loop_a
  let b = play_full ? -1 : g.doc.loop_b
  if (a < 0 || b < 0 || a >= n || b >= n || a > b) {
    a = 0
    b = n - 1
  }
  return [a, b]
}

function hold_of(g: deep_ro_t<globals_t>, i: number): number {
  const f = g.doc.frames[i]
  return f ? f.hold : 1
}

export function anim_playhead(): number {
  const g = st()
  return g.play.on ? playhead : g.doc.cur
}

export function anim_playing(): number {
  return st().play.on
}

export function anim_play_time(): number {
  return visual_time
}

export function anim_range(): [number, number] {
  return range_of(st())
}

export function anim_hold_of(i: number): number {
  return hold_of(st(), i)
}

export function anim_tick_starts(): number[] {
  const g = st()
  const out: number[] = []
  let ticks = 0
  for (let i = 0; i < g.doc.frames.length; i++) {
    out.push(ticks)
    ticks += hold_of(g, i)
  }
  return out
}

export function anim_tick_count(): number {
  const g = st()
  const [a, b] = range_of(g)
  let ticks = 0
  for (let i = a; i <= b; i++) ticks += hold_of(g, i)
  return ticks
}

function clock_start(g: globals_t): void {
  const [a, b] = range_of(g)
  timeline = timeline_make(g.doc.frames, g.doc.fps, a, b)
  origin_offset = timeline.starts[playhead - a]
  origin_time = performance.now()
  g.play.last = origin_time
  g.play.acc = 0
  visual_base = origin_offset
  visual_time = visual_base
  clock_loop = g.doc.loop && !play_once ? 1 : 0
  snd_play_start(origin_offset, timeline, clock_loop, origin_time)
}

function stop(g: globals_t): void {
  g.play.on = 0
  snd_stop_all()
  g.doc.cur = playhead
  doc_unpack_live(g)
  play_full = 0
  play_once = 0
  timeline = null
  fx_sfx('stop')
}

export const play_commands = {
  'play.start': (g: globals_t, options: playback_options_t | null): number => {
    if (g.play.on || g.doc.frames.length < 1) return err_noop
    doc_pack_live(g)
    play_full = options?.full ? 1 : 0
    play_once = options?.once ? 1 : 0
    g.play.on = 1
    const [a, b] = range_of(g)
    playhead = play_full || g.doc.cur < a || g.doc.cur > b ? a : g.doc.cur
    clock_start(g)
    fx_sfx('play')
    return 0
  },

  'play.stop': (g: globals_t, _p: null): number => {
    if (!g.play.on) return err_noop
    stop(g)
    return 0
  },

  'play.toggle': (g: globals_t, _p: null): number => g.play.on ? play_commands['play.stop'](g, null) : play_commands['play.start'](g, null),

  'play.tick': (g: globals_t, now: number): number => {
    if (!g.play.on) return err_noop
    if (!Number.isFinite(now)) return err_bad
    if (!timeline) return err_noop
    const seconds = snd_play_elapsed(now) ?? Math.max(0, (now - origin_time) / 1000)
    const position = timeline_position(timeline, origin_offset + seconds, clock_loop)
    visual_time = visual_base + seconds
    g.play.last = now
    snd_play_schedule(seconds)
    const moved = playhead !== position.frame
    playhead = position.frame
    if (position.done) {
      stop(g)
      return d_play | d_stage | d_frameinfo | d_timeline
    }
    return moved ? d_stage | d_frameinfo : 0
  },

  'play.retime': (g: globals_t, _p: null): number => {
    if (!g.play.on || !timeline) return err_noop
    const now = performance.now()
    const seconds = snd_play_elapsed(now) ?? Math.max(0, (now - origin_time) / 1000)
    const position = timeline_position(timeline, origin_offset + seconds, clock_loop)
    const old_index = position.frame - timeline.first
    const length = timeline.starts[old_index + 1] - timeline.starts[old_index]
    const progress = Math.max(0, Math.min(1, (position.time - timeline.starts[old_index]) / length))
    visual_base += seconds
    const [first, last] = range_of(g)
    playhead = Math.max(first, Math.min(last, position.frame))
    timeline = timeline_make(g.doc.frames, g.doc.fps, first, last)
    const index = playhead - first
    origin_offset = timeline.starts[index] + (playhead === position.frame ? progress * (timeline.starts[index + 1] - timeline.starts[index]) : 0)
    origin_time = now
    g.play.last = now
    g.play.acc = 0
    clock_loop = g.doc.loop && !play_once ? 1 : 0
    snd_play_start(origin_offset, timeline, clock_loop, now)
    return 0
  },

  'play.seek': (g: globals_t, i: number): number => {
    if (!g.play.on) return err_noop
    if (!Number.isFinite(i)) return err_bad
    const [a, b] = range_of(g)
    const to = Math.trunc(i)
    playhead = to < a ? a : to > b ? b : to
    clock_start(g)
    return 0
  },
}

export const play_effects: Partial<Record<keyof cmds_t, number>> = {
  'play.start': d_play | d_stage | d_frameinfo,
  'play.stop': d_play | d_stage | d_frameinfo | d_timeline,
  'play.toggle': d_play | d_stage | d_frameinfo | d_timeline,
  'play.seek': d_stage | d_frameinfo,
  'play.retime': d_play | d_stage | d_frameinfo,
}

export const play_touch = new Set<keyof cmds_t>([])

export function playback_driver_start(dispatch_tick: (now: number) => void): void {
  const loop = (now: number): void => {
    if (!st().play.on) {
      raf = 0
      return
    }
    dispatch_tick(now)
    raf = requestAnimationFrame(loop)
  }
  if (raf) cancelAnimationFrame(raf)
  raf = requestAnimationFrame(loop)
}
