export type audio_mix_track_t = { channels: Float32Array[], rate: number, gain: number, speed: number, starts: number[] }
export type audio_mix_t = { rate: number, length: number, tracks: audio_mix_track_t[] }

export function audio_mix_chunk(mix: audio_mix_t, offset: number, count: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(count * 2)
  for (const track of mix.tracks) {
    const channels = track.channels
    if (!channels.length || !channels[0].length || !track.gain) continue
    const step = track.rate * track.speed / mix.rate
    for (const start of track.starts) {
      const first = Math.max(0, Math.ceil(start * mix.rate - offset))
      const end = Math.min(count, Math.ceil(start * mix.rate + channels[0].length / step - offset))
      for (let i = first; i < end; i++) {
        const position = (offset + i - start * mix.rate) * step
        const index = Math.floor(position), fraction = position - index
        for (let channel = 0; channel < 2; channel++) {
          const source = channels[channels.length === 1 ? 0 : channel]
          const value = source[index] * (1 - fraction) + (source[index + 1] ?? source[index]) * fraction
          out[channel * count + i] += value * track.gain
        }
      }
    }
  }
  return out
}
