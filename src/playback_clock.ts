export type Timeline = { starts: Float64Array, first: number, last: number, duration: number }
export type TimelinePosition = { frame: number, cycle: number, time: number, done: number }

export function timeline_make(holds: readonly { hold: number }[], fps: number, first: number, last: number): Timeline {
  const starts = new Float64Array(last - first + 2)
  for (let i = first; i <= last; i++) starts[i - first + 1] = starts[i - first] + holds[i].hold / fps
  return { starts, first, last, duration: starts[starts.length - 1] }
}

export function timeline_index(timeline: Timeline, time: number): number {
  let lo = 0
  let hi = timeline.starts.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1
    if (timeline.starts[mid] <= time + 1e-9) lo = mid
    else hi = mid
  }
  return timeline.first + lo
}

export function timeline_position(timeline: Timeline, seconds: number, loop: number): TimelinePosition {
  const elapsed = Math.max(0, seconds)
  if (!loop && elapsed + 1e-9 >= timeline.duration) return { frame: timeline.last, cycle: 0, time: timeline.duration, done: 1 }
  const cycle = loop ? Math.floor((elapsed + 1e-9) / timeline.duration) : 0
  const time = Math.max(0, elapsed - cycle * timeline.duration)
  return { frame: timeline_index(timeline, time), cycle, time, done: 0 }
}
