import { dispatch } from '../state/commands/index'
import { playback_driver_start, type playback_options_t } from '../state/commands/play'
import { st } from '../state/store'
import { snd_load_epoch, snd_ready } from '../snd'

let play_request = 0
let pending = false
let pending_epoch = 0

export function anim_pending(): number {
  if (pending && pending_epoch !== snd_load_epoch()) {
    ++play_request
    pending = false
  }
  return pending ? 1 : 0
}

function drive(): void {
  playback_driver_start(now => dispatch('play.tick', now))
}

export function anim_play(options: playback_options_t | null = null, started?: () => void): void {
  if (st().play.on || anim_pending()) return
  const request = ++play_request
  const epoch = snd_load_epoch()
  pending_epoch = epoch
  pending = true
  snd_ready(() => {
    if (request !== play_request) return
    pending = false
    if (epoch !== snd_load_epoch()) return
    if (dispatch('play.start', options) === 0) {
      drive()
      started?.()
    }
  })
}

export function anim_stop(): void {
  ++play_request
  pending = false
  dispatch('play.stop', null)
}

export function anim_toggle(): void {
  if (st().play.on || anim_pending()) anim_stop()
  else anim_play()
}

export function anim_seek(i: number): void {
  dispatch('play.seek', i)
}
