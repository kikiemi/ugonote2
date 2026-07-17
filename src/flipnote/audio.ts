import { float_to_i16, resample_f32 } from '../codec/adpcm'
import { clamp } from '../lib'
import { bgm_rate, snd_slot_pcm } from '../snd'
import { st } from '../state/store'

export type FlipAudioFormat = 'ppm' | 'kwz'

export type FlipAudio = {
  bgm: Int16Array | null
  se: (Int16Array | null)[]
}

type AudioLimits = {
  rate: number
  bgmSeconds: number
  seSeconds: number
  seCount: number
}

function limits_for(format: FlipAudioFormat): AudioLimits {
  return format === 'ppm'
    ? { rate: 8180, bgmSeconds: 59.9, seSeconds: 1.99, seCount: 3 }
    : { rate: 16364, bgmSeconds: 60, seSeconds: 2, seCount: 4 }
}

function prepared_track(kind: string, rate: number, maxSeconds: number, playbackRate: number): Float32Array | null {
  const slot = snd_slot_pcm(kind)
  if (!slot || slot.pcm.length === 0) return null
  const effectiveRate = slot.rate * playbackRate
  const resampled = resample_f32(slot.pcm, effectiveRate, rate)
  const length = Math.min(resampled.length, Math.floor(rate * maxSeconds))
  return resampled.subarray(0, length) as Float32Array
}

function mix_bgm(first: Float32Array | null, second: Float32Array | null, gain: number): Int16Array | null {
  if ((!first || first.length === 0) && (!second || second.length === 0)) return null
  if (gain <= 0) return null
  const length = Math.max(first ? first.length : 0, second ? second.length : 0)
  const mixed = new Float32Array(length)
  let peak = 0
  for (let index = 0; index < length; index++) {
    const value = (first && index < first.length ? first[index] : 0) + (second && index < second.length ? second[index] : 0)
    mixed[index] = value
    const absolute = Math.abs(value)
    if (absolute > peak) peak = absolute
  }
  let scale = clamp(gain, 0, 1)
  if (peak * scale > 0.98) scale = 0.98 / peak
  return float_to_i16(mixed, scale)
}

export function prepare_flip_audio(format: FlipAudioFormat): FlipAudio {
  const limits = limits_for(format)
  const globals = st()
  const playbackRate = bgm_rate()
  const bgm = mix_bgm(
    prepared_track('bgm0', limits.rate, limits.bgmSeconds, playbackRate),
    prepared_track('bgm1', limits.rate, limits.bgmSeconds, playbackRate),
    globals.snd.bgmVol
  )
  const se: (Int16Array | null)[] = []
  for (let index = 0; index < limits.seCount; index++) {
    const track = prepared_track('se' + index, limits.rate, limits.seSeconds, 1)
    se.push(track && globals.snd.seVol > 0 ? float_to_i16(track, clamp(globals.snd.seVol, 0, 1)) : null)
  }
  return { bgm, se }
}
