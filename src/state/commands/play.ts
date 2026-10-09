import { timeline_make, timeline_position, type Timeline } from '../../playback_clock'
import { doc_pack_live, doc_unpack_live } from '../../doc'
import { D_STAGE, D_FRAMEINFO, D_PLAY, D_TIMELINE, ERR_BAD, ERR_NOOP } from '../../h'
import { snd_play_start, snd_play_elapsed, snd_play_schedule, snd_stop_all } from '../../snd'
import { fx_sfx } from '../fx_hooks'
import { st, type DeepRO, type Globals } from '../store'

let playhead = 0
let timeline: Timeline | null = null
let originTime = 0
let originOffset = 0
let visualBase = 0
let clockLoop = 0
let raf = 0
let visualTime = 0
let playFull = 0
let playOnce = 0

export type PlaybackOptions = { full?: boolean, once?: boolean }

export type Cmds = {
  'play.start': PlaybackOptions | null
  'play.stop': null
  'play.toggle': null
  'play.tick': number
  'play.seek': number
  'play.retime': null
}

function range_of(g: DeepRO<Globals>): [number, number] {
  const n = g.doc.frames.length
  let a = playFull ? -1 : g.doc.loopA
  let b = playFull ? -1 : g.doc.loopB
  if (a < 0 || b < 0 || a >= n || b >= n || a > b) {
    a = 0
    b = n - 1
  }
  return [a, b]
}

function hold_of(g: DeepRO<Globals>, i: number): number {
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
  return visualTime
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

function clock_start(g: Globals): void {
  const [a, b] = range_of(g)
  timeline = timeline_make(g.doc.frames, g.doc.fps, a, b)
  originOffset = timeline.starts[playhead - a]
  originTime = performance.now()
  g.play.last = originTime
  g.play.acc = 0
  visualBase = originOffset
  visualTime = visualBase
  clockLoop = g.doc.loop && !playOnce ? 1 : 0
  snd_play_start(originOffset, timeline, clockLoop, originTime)
}

function stop(g: Globals): void {
  g.play.on = 0
  snd_stop_all()
  g.doc.cur = playhead
  doc_unpack_live(g)
  playFull = 0
  playOnce = 0
  timeline = null
  fx_sfx('stop')
}

export const PLAY_COMMANDS = {
  'play.start': (g: Globals, options: PlaybackOptions | null): number => {
    if (g.play.on || g.doc.frames.length < 1) return ERR_NOOP
    doc_pack_live(g)
    playFull = options?.full ? 1 : 0
    playOnce = options?.once ? 1 : 0
    g.play.on = 1
    const [a, b] = range_of(g)
    playhead = playFull || g.doc.cur < a || g.doc.cur > b ? a : g.doc.cur
    clock_start(g)
    fx_sfx('play')
    return 0
  },

  'play.stop': (g: Globals, _p: null): number => {
    if (!g.play.on) return ERR_NOOP
    stop(g)
    return 0
  },

  'play.toggle': (g: Globals, _p: null): number => g.play.on ? PLAY_COMMANDS['play.stop'](g, null) : PLAY_COMMANDS['play.start'](g, null),

  'play.tick': (g: Globals, now: number): number => {
    if (!g.play.on) return ERR_NOOP
    if (!Number.isFinite(now)) return ERR_BAD
    if (!timeline) return ERR_NOOP
    const seconds = snd_play_elapsed(now) ?? Math.max(0, (now - originTime) / 1000)
    const position = timeline_position(timeline, originOffset + seconds, clockLoop)
    visualTime = visualBase + seconds
    g.play.last = now
    snd_play_schedule(seconds)
    const moved = playhead !== position.frame
    playhead = position.frame
    if (position.done) {
      stop(g)
      return D_PLAY | D_STAGE | D_FRAMEINFO | D_TIMELINE
    }
    return moved ? D_STAGE | D_FRAMEINFO : 0
  },

  'play.retime': (g: Globals, _p: null): number => {
    if (!g.play.on || !timeline) return ERR_NOOP
    const now = performance.now()
    const seconds = snd_play_elapsed(now) ?? Math.max(0, (now - originTime) / 1000)
    const position = timeline_position(timeline, originOffset + seconds, clockLoop)
    const oldIndex = position.frame - timeline.first
    const length = timeline.starts[oldIndex + 1] - timeline.starts[oldIndex]
    const progress = Math.max(0, Math.min(1, (position.time - timeline.starts[oldIndex]) / length))
    visualBase += seconds
    const [first, last] = range_of(g)
    playhead = Math.max(first, Math.min(last, position.frame))
    timeline = timeline_make(g.doc.frames, g.doc.fps, first, last)
    const index = playhead - first
    originOffset = timeline.starts[index] + (playhead === position.frame ? progress * (timeline.starts[index + 1] - timeline.starts[index]) : 0)
    originTime = now
    g.play.last = now
    g.play.acc = 0
    clockLoop = g.doc.loop && !playOnce ? 1 : 0
    snd_play_start(originOffset, timeline, clockLoop, now)
    return 0
  },

  'play.seek': (g: Globals, i: number): number => {
    if (!g.play.on) return ERR_NOOP
    if (!Number.isFinite(i)) return ERR_BAD
    const [a, b] = range_of(g)
    const to = Math.trunc(i)
    playhead = to < a ? a : to > b ? b : to
    clock_start(g)
    return 0
  },
}

export const PLAY_EFFECTS: Partial<Record<keyof Cmds, number>> = {
  'play.start': D_PLAY | D_STAGE | D_FRAMEINFO,
  'play.stop': D_PLAY | D_STAGE | D_FRAMEINFO | D_TIMELINE,
  'play.toggle': D_PLAY | D_STAGE | D_FRAMEINFO | D_TIMELINE,
  'play.seek': D_STAGE | D_FRAMEINFO,
  'play.retime': D_PLAY | D_STAGE | D_FRAMEINFO,
}

export const PLAY_TOUCH = new Set<keyof Cmds>([])

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
