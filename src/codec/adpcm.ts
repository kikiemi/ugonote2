export const ima_steps = new Int32Array([
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
  3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
])
const idx4 = new Int32Array([-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8])
const idx2 = new Int32Array([-1, 2, -1, 2])

function cl(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v
}

const resample_taps = 24
const resample_phases = 1024
const resample_kernels = new Map<string, Float64Array>()

function resample_kernel(src_rate: number, dst_rate: number): Float64Array {
  const key = src_rate + ':' + dst_rate
  const cached = resample_kernels.get(key)
  if (cached) {
    resample_kernels.delete(key)
    resample_kernels.set(key, cached)
    return cached
  }
  const half = resample_taps / 2
  const cutoff = Math.min(1, dst_rate / src_rate) * 0.94
  const kernels = new Float64Array(resample_phases * resample_taps)
  for (let phase_index = 0; phase_index < resample_phases; phase_index++) {
    const phase = phase_index / resample_phases
    let sum = 0
    for (let tap = 0; tap < resample_taps; tap++) {
      const distance = tap - (half - 1) - phase
      const scaled = distance * cutoff
      const sinc = Math.abs(scaled) < 1e-9 ? 1 : Math.sin(Math.PI * scaled) / (Math.PI * scaled)
      const window = Math.abs(distance) < half ? (Math.abs(distance) < 1e-9 ? 1 : Math.sin(Math.PI * distance / half) / (Math.PI * distance / half)) : 0
      const value = cutoff * sinc * window
      kernels[phase_index * resample_taps + tap] = value
      sum += value
    }
    if (Math.abs(sum) > 1e-12) for (let tap = 0; tap < resample_taps; tap++) kernels[phase_index * resample_taps + tap] /= sum
  }
  resample_kernels.set(key, kernels)
  if (resample_kernels.size > 8) resample_kernels.delete(resample_kernels.keys().next().value as string)
  return kernels
}

export function resample_f32(src: Float32Array, src_rate: number, dst_rate: number): Float32Array {
  if (src.length === 0) return new Float32Array(0)
  if (!Number.isFinite(src_rate) || !Number.isFinite(dst_rate) || src_rate <= 0 || dst_rate <= 0) throw new RangeError('invalid sample rate')
  const output_length = Math.max(1, Math.round((src.length * dst_rate) / src_rate))
  if (src_rate === dst_rate) return src.slice()
  const half = resample_taps / 2
  const kernels = resample_kernel(src_rate, dst_rate)
  const out = new Float32Array(output_length)
  const step = src_rate / dst_rate
  for (let index = 0; index < output_length; index++) {
    const position = index * step
    const base = Math.floor(position)
    const fraction = position - base
    const phase = Math.min(resample_phases - 1, Math.round(fraction * resample_phases))
    const kernel_offset = phase * resample_taps
    let value = 0
    for (let tap = 0; tap < resample_taps; tap++) {
      const source_index = cl(base + tap - (half - 1), 0, src.length - 1)
      value += src[source_index] * kernels[kernel_offset + tap]
    }
    out[index] = cl(value, -1, 1)
  }
  return out
}

export function float_to_i16(src: Float32Array, gain = 1): Int16Array {
  const out = new Int16Array(src.length)
  let seed = 0x6d2b79f5
  let error = 0
  const random = (): number => {
    seed = Math.imul(seed ^ (seed >>> 15), seed | 1)
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), seed | 61)
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296
  }
  for (let index = 0; index < src.length; index++) {
    const dither = (random() - random()) / 65536
    const shaped = cl(src[index] * gain + error * 0.35 + dither, -1, 1)
    const sample = cl(Math.round(shaped * 32767), -32768, 32767)
    out[index] = sample
    error = shaped - sample / 32767
  }
  return out
}

export function resample_i16(src: Float32Array, src_rate: number, dst_rate: number, gain = 1): Int16Array {
  return float_to_i16(resample_f32(src, src_rate, dst_rate), gain)
}

function dec4(sample: number, pred: number, idx: number): [number, number] {
  const step = ima_steps[idx]
  let diff = step >> 3
  if (sample & 1) diff += step >> 2
  if (sample & 2) diff += step >> 1
  if (sample & 4) diff += step
  if (sample & 8) diff = -diff
  return [cl(pred + diff, -32768, 32767), cl(idx + idx4[sample], 0, 88)]
}

export function ppm_adpcm_encode(pcm: Int16Array): Uint8Array {
  if (pcm.length === 0) return new Uint8Array(0)
  const out = new Uint8Array(4 + Math.ceil(pcm.length / 2))
  let pred = pcm[0]
  let average_delta = 0
  const inspect = Math.min(pcm.length - 1, 96)
  for (let index = 1; index <= inspect; index++) average_delta += Math.abs(pcm[index] - pcm[index - 1])
  if (inspect > 0) average_delta /= inspect
  let idx = 0
  while (idx < 88 && ima_steps[idx] < average_delta * 0.8) idx++
  out[0] = pred & 255
  out[1] = (pred >> 8) & 255
  out[2] = idx
  let ptr = 4
  let low = 1
  for (let index = 0; index < pcm.length; index++) {
    const target = pcm[index]
    let best = 0
    let best_error = Number.POSITIVE_INFINITY
    let best_pred = pred
    let best_idx = idx
    for (let sample = 0; sample < 16; sample++) {
      const [next_pred, next_idx] = dec4(sample, pred, idx)
      const error = Math.abs(target - next_pred)
      if (error < best_error) {
        best_error = error
        best = sample
        best_pred = next_pred
        best_idx = next_idx
      }
    }
    pred = best_pred
    idx = best_idx
    if (low) out[ptr] = best & 15
    else out[ptr++] |= (best & 15) << 4
    low ^= 1
  }
  return out
}

export function ppm_adpcm_decode(track: Uint8Array): Int16Array {
  if (track.length < 4) return new Int16Array(0)
  let pred = ((track[0] | (track[1] << 8)) << 16) >> 16
  let idx = cl(track[2], 0, 88)
  const src = track.subarray(4)
  const out = new Int16Array(src.length * 2)
  let low = 1
  let sp = 0
  for (let d = 0; d < out.length; d++) {
    const sample = low ? src[sp] & 0xf : src[sp++] >> 4
    low ^= 1
    const [p2, i2] = dec4(sample, pred, idx)
    pred = p2
    idx = i2
    out[d] = pred
  }
  return out
}

export function kwz_adpcm_encode(pcm16: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm16.length + 8)
  let pred = 0
  let idx = 40
  let byte = 0
  let bit_pos = 0
  let ptr = 0
  const flush = () => {
    out[ptr++] = byte
    byte = 0
    bit_pos = 0
  }
  for (let i = 0; i < pcm16.length; i++) {
    const target = cl(pcm16[i] >> 4, -2048, 2047)
    if (idx < 18 || bit_pos > 4) {
      const step = ima_steps[idx]
      const base = step >> 3
      let best = 0
      let best_err = 0x7fffffff
      let best_pred = pred
      let best_idx = idx
      for (let s = 0; s < 4; s++) {
        let diff = base
        if (s & 1) diff += step
        if (s & 2) diff = -diff
        const p2 = cl(pred + diff, -2048, 2047)
        const i2 = cl(idx + idx2[s], 0, 79)
        const e = Math.abs(target - p2)
        if (e < best_err) {
          best_err = e
          best = s
          best_pred = p2
          best_idx = i2
        }
      }
      pred = best_pred
      idx = best_idx
      byte |= best << bit_pos
      bit_pos += 2
    } else {
      const step = ima_steps[idx]
      let best = 0
      let best_err = 0x7fffffff
      let best_pred = pred
      let best_idx = idx
      for (let s = 0; s < 16; s++) {
        let diff = step >> 3
        if (s & 1) diff += step >> 2
        if (s & 2) diff += step >> 1
        if (s & 4) diff += step
        if (s & 8) diff = -diff
        const p2 = cl(pred + diff, -2048, 2047)
        const i2 = cl(idx + idx4[s], 0, 79)
        const e = Math.abs(target - p2)
        if (e < best_err) {
          best_err = e
          best = s
          best_pred = p2
          best_idx = i2
        }
      }
      pred = best_pred
      idx = best_idx
      byte |= best << bit_pos
      bit_pos += 4
    }
    if (bit_pos >= 8) flush()
  }
  if (bit_pos > 0) flush()
  return out.subarray(0, ptr)
}

export function kwz_adpcm_decode(src: Uint8Array): Int16Array {
  const out = new Int16Array(src.length * 4)
  let pred = 0
  let idx = 40
  let d = 0
  for (let s = 0; s < src.length; s++) {
    let byte = src[s]
    let bit = 0
    while (bit < 8) {
      if (idx < 18 || bit > 4) {
        const sample = byte & 0x3
        const step = ima_steps[idx]
        let diff = step >> 3
        if (sample & 1) diff += step
        if (sample & 2) diff = -diff
        pred = cl(pred + diff, -2048, 2047)
        idx = cl(idx + idx2[sample], 0, 79)
        byte >>= 2
        bit += 2
      } else {
        const sample = byte & 0xf
        const step = ima_steps[idx]
        let diff = step >> 3
        if (sample & 1) diff += step >> 2
        if (sample & 2) diff += step >> 1
        if (sample & 4) diff += step
        if (sample & 8) diff = -diff
        pred = cl(pred + diff, -2048, 2047)
        idx = cl(idx + idx4[sample], 0, 79)
        byte >>= 4
        bit += 4
      }
      out[d++] = pred * 16
    }
  }
  return out.subarray(0, d)
}
