import { dispatch } from '../state/commands/index'
import { playback_driver_start } from '../state/commands/play'

function drive(): void {
  playback_driver_start(now => dispatch('play.tick', now))
}

export function anim_play(): void {
  if (dispatch('play.start', null) === 0) drive()
}

export function anim_stop(): void {
  dispatch('play.stop', null)
}

export function anim_toggle(): void {
  dispatch('play.toggle', null)
  drive()
}

export function anim_seek(i: number): void {
  dispatch('play.seek', i)
}
