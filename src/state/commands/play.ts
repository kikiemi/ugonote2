import { doc_pack_live, doc_unpack_live } from '../../doc'
import { D_STAGE, D_FRAMEINFO, D_PLAY, D_TIMELINE, ERR_BAD, ERR_NOOP } from '../../h'
import { snd_play_start, snd_frame_tick, snd_stop_all } from '../../snd'
import { fx_sfx } from '../fx_hooks'
import { st, type DeepRO, type Globals } from '../store'

let playhead = 0
let holdLeft = 1
let raf = 0
let visualTime = 0

export type Cmds = {
  'play.start': null
  'play.stop': null
  'play.toggle': null
  'play.tick': number
  'play.seek': number
}

function range_of(g: DeepRO<Globals>): [number, number] {
  const n = g.doc.frames.length
  let a = g.doc.loopA
  let b = g.doc.loopB
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

function ticks_between(g: DeepRO<Globals>, a: number, i: number): number {
  let ticks = 0
  for (let k = a; k < i; k++) ticks += hold_of(g, k)
  return ticks
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

function advance(g: Globals): number {
  const [a, b] = range_of(g)
  holdLeft--
  if (holdLeft > 0) return 0
  playhead++
  if (playhead > b || playhead >= g.doc.frames.length) {
    if (g.doc.loop) {
      playhead = a
      snd_play_start(0)
    } else {
      playhead = b
      stop(g)
      return -1
    }
  }
  holdLeft = hold_of(g, playhead)
  snd_frame_tick(playhead)
  return 1
}

function stop(g: Globals): void {
  g.play.on = 0
  snd_stop_all()
  g.doc.cur = playhead
  doc_unpack_live(g)
  fx_sfx('stop')
}

export const PLAY_COMMANDS = {
  'play.start': (g: Globals, _p: null): number => {
    if (g.play.on || g.doc.frames.length < 1) return ERR_NOOP
    doc_pack_live(g)
    g.play.on = 1
    const [a, b] = range_of(g)
    playhead = g.doc.cur < a || g.doc.cur > b ? a : g.doc.cur
    holdLeft = hold_of(g, playhead)
    g.play.acc = 0
    g.play.last = performance.now()
    visualTime = ticks_between(g, a, playhead) / g.doc.fps
    snd_play_start(visualTime)
    snd_frame_tick(playhead)
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
    const step = 1000 / g.doc.fps
    const elapsed = now - g.play.last
    g.play.last = now
    if (elapsed < 0 || elapsed > step * 60) {
      g.play.acc = 0
      const [a] = range_of(g)
      visualTime = ticks_between(g, a, playhead) / g.doc.fps
      snd_play_start(visualTime)
      return 0
    }
    visualTime += elapsed / 1000
    g.play.acc += elapsed
    let moved = 0
    let guard = 0
    while (g.play.acc >= step && guard < 60) {
      g.play.acc -= step
      guard++
      const r = advance(g)
      if (r < 0) return D_PLAY | D_STAGE | D_FRAMEINFO | D_TIMELINE
      if (r > 0) moved = 1
    }
    return moved ? D_STAGE | D_FRAMEINFO : 0
  },

  'play.seek': (g: Globals, i: number): number => {
    if (!g.play.on) return ERR_NOOP
    if (!Number.isFinite(i)) return ERR_BAD
    const [a, b] = range_of(g)
    const to = Math.trunc(i)
    playhead = to < a ? a : to > b ? b : to
    holdLeft = hold_of(g, playhead)
    g.play.acc = 0
    g.play.last = performance.now()
    visualTime = ticks_between(g, a, playhead) / g.doc.fps
    snd_play_start(visualTime)
    snd_frame_tick(playhead)
    return 0
  },
}

export const PLAY_EFFECTS: Partial<Record<keyof Cmds, number>> = {
  'play.start': D_PLAY | D_STAGE | D_FRAMEINFO,
  'play.stop': D_PLAY | D_STAGE | D_FRAMEINFO | D_TIMELINE,
  'play.toggle': D_PLAY | D_STAGE | D_FRAMEINFO | D_TIMELINE,
  'play.seek': D_STAGE | D_FRAMEINFO,
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
