// うごメモに書き出す音。BGM と効果音を、うごメモの音の速さ (1秒の数) と長さにそろえる。

import { float_to_i16, resample_f32 } from '../codec/adpcm'
import { clamp } from '../lib'
import { bgm_rate, snd_slot_pcm } from '../snd'
import { st } from '../state/store'

export type flip_audio_format_t = 'ppm' | 'kwz'

// 書き出す音。bgm は BGM (なければ null)、se は効果音ごとの音 (なければ null)。
export type flip_audio_t = {
  bgm: Int16Array | null
  se: (Int16Array | null)[]
}

// 形式ごとの、音の速さ (1秒の数)、BGM と効果音の長さの上限 (秒)、効果音の数。
type audio_limits_t = {
  rate: number
  bgm_seconds: number
  se_seconds: number
  se_count: number
}

// format の形式の、音の速さと長さの上限。
function limits_for(format: flip_audio_format_t): audio_limits_t {
  return format === 'ppm'
    ? { rate: 8180, bgm_seconds: 59.9, se_seconds: 1.99, se_count: 3 }
    : { rate: 16364, bgm_seconds: 60, se_seconds: 2, se_count: 4 }
}

// kind の音を、playback_rate 倍の速さで鳴らしたときの音にして、rate にそろえ、max_seconds までで切る (音がなければ null)。
function prepared_track(kind: string, rate: number, max_seconds: number, playback_rate: number): Float32Array | null {
  const slot = snd_slot_pcm(kind)
  if (!slot || slot.pcm.length === 0) return null
  const effective_rate = slot.rate * playback_rate
  const resampled = resample_f32(slot.pcm, effective_rate, rate)
  const length = Math.min(resampled.length, Math.floor(rate * max_seconds))
  return resampled.subarray(0, length) as Float32Array
}

// 2つの BGM を足して、音量 gain をかける (どちらもないか、音量が 0 なら null)。
// いちばん大きい所が 0.98 をこえるときは、音がわれないように小さくする。
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

// いまの BGM と効果音を、format の形式で書き出す音にする。BGM は、コマの速さをかえたぶん速く (おそく) する。
export function prepare_flip_audio(format: flip_audio_format_t): flip_audio_t {
  const limits = limits_for(format)
  const globals = st()
  const playback_rate = bgm_rate()
  const bgm = mix_bgm(
    prepared_track('bgm0', limits.rate, limits.bgm_seconds, playback_rate),
    prepared_track('bgm1', limits.rate, limits.bgm_seconds, playback_rate),
    globals.snd.bgm_vol
  )
  const se: (Int16Array | null)[] = []
  for (let index = 0; index < limits.se_count; index++) {
    const track = prepared_track('se' + index, limits.rate, limits.se_seconds, 1)
    se.push(track && globals.snd.se_vol > 0 ? float_to_i16(track, clamp(globals.snd.se_vol, 0, 1)) : null)
  }
  return { bgm, se }
}
