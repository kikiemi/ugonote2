import { dispatch } from '../state/commands/index'
import { playback_driver_start, type PlaybackOptions } from '../state/commands/play'
import { st } from '../state/store'
import { snd_load_epoch, snd_ready } from '../snd'

let playRequest = 0
let pending = false
let pendingEpoch = 0

export function anim_pending(): number {
  if (pending && pendingEpoch !== snd_load_epoch()) {
    ++playRequest
    pending = false
  }
  return pending ? 1 : 0
}

function drive(): void {
  playback_driver_start(now => dispatch('play.tick', now))
}

export function anim_play(options: PlaybackOptions | null = null, started?: () => void): void {
  if (st().play.on || anim_pending()) return
  const request = ++playRequest
  const epoch = snd_load_epoch()
  pendingEpoch = epoch
  pending = true
  snd_ready(() => {
    if (request !== playRequest) return
    pending = false
    if (epoch !== snd_load_epoch()) return
    if (dispatch('play.start', options) === 0) {
      drive()
      started?.()
    }
  })
}

export function anim_stop(): void {
  ++playRequest
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
