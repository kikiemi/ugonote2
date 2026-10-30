import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type VideoSample } from 'mediabunny'
import { cache_make, cache_get, cache_put, memory_check, memory_work_budget } from './memory'

export const pixel_source_flag = 0x20000000
export type pixel_source_asset_t = { id: number, file: Blob, budget?: number }
export type pixel_source_record_t = pixel_source_asset_t & { packets: Uint32Array[] }
type decoder_t = { input: Input, sink: VideoSampleSink, stream: AsyncGenerator<VideoSample, void, unknown> | null, sample: VideoSample | null, next: VideoSample | null, time: number, first: number }

const bindings = new WeakMap<Uint32Array, pixel_source_asset_t>()
const pixels = cache_make<Uint32Array, Uint32Array>(() => {})
const pending = new Map<Uint32Array, Promise<void>>()
const failures = new WeakMap<Uint32Array, unknown>()
const decoders = new Map<pixel_source_asset_t, decoder_t>()
let next_id = 1
let queue = Promise.resolve()
let listener: (error?: unknown) => void = () => {}
let decoder_timer: ReturnType<typeof setTimeout> | 0 = 0

export function pixel_source_listen(callback: (error?: unknown) => void): void { listener = callback }

export function pixel_source_is(packed: Uint32Array): number {
  return packed.length && (packed[0] & 0xe0000000) === pixel_source_flag ? 1 : 0
}

export function pixel_source_valid(packed: Uint32Array, count: number): number {
  if ((packed.length < 22 || (packed.length - 22) % 16 !== 0) || (packed[0] & 0x1fffffff) !== count || packed[2] * packed[3] !== count || !packed[1]) return 0
  if (![packed[2], packed[3], packed[4], packed[5]].every(value => value > 0 && value <= 4096)) return 0
  const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength)
  for (let offset = 32; offset < packed.byteLength; offset += 8) if (!Number.isFinite(view.getFloat64(offset, true))) return 0
  return view.getFloat64(32, true) >= 0 ? 1 : 0
}

export function pixel_source_asset(file: Blob, budget = memory_work_budget()): pixel_source_asset_t { return { id: next_id++, file, budget } }

export function pixel_source_make(asset: pixel_source_asset_t, w: number, h: number, paper: string, time: number): Uint32Array {
  const packed = new Uint32Array(22)
  packed.set([w * h | pixel_source_flag, asset.id, w, h, w, h, Number.parseInt(paper.slice(1, 7), 16), paper.length === 9 ? Number.parseInt(paper.slice(7, 9), 16) : 255])
  const view = new DataView(packed.buffer)
  view.setFloat64(32, time, true)
  view.setFloat64(40, 1, true); view.setFloat64(64, 1, true)
  bindings.set(packed, asset)
  return packed
}

export function pixel_source_transform(packed: Uint32Array, w: number, h: number, a: number, b: number, c: number, d: number, e: number, f: number): Uint32Array {
  const asset = bindings.get(packed)
  if (!asset) throw new Error('元の動画が見つかりません')
  const out = new Uint32Array(packed.length + 16)
  out.set(packed)
  const source = new DataView(packed.buffer, packed.byteOffset, packed.byteLength), view = new DataView(out.buffer)
  out[0] = w * h | pixel_source_flag; out[2] = w; out[3] = h
  const m = Array.from({ length: 6 }, (_, i) => source.getFloat64(40 + i * 8, true))
  const values = [a * m[0] + c * m[1], b * m[0] + d * m[1], a * m[2] + c * m[3], b * m[2] + d * m[3], a * m[4] + c * m[5] + e, b * m[4] + d * m[5] + f]
  for (let i = 0; i < values.length; i++) view.setFloat64(40 + i * 8, values[i], true)
  for (let offset = 88; offset < packed.byteLength; offset += 16) {
    const x = source.getFloat64(offset, true), y = source.getFloat64(offset + 8, true)
    view.setFloat64(offset, a * x + c * y + e, true); view.setFloat64(offset + 8, b * x + d * y + f, true)
  }
  const corners = [[0, 0], [packed[2], 0], [packed[2], packed[3]], [0, packed[3]]]
  for (let i = 0; i < 4; i++) {
    const [x, y] = corners[i], offset = packed.byteLength + i * 16
    view.setFloat64(offset, a * x + c * y + e, true); view.setFloat64(offset + 8, b * x + d * y + f, true)
  }
  bindings.set(out, asset)
  return out
}

export function pixel_source_packets(value: unknown): Uint32Array[] {
  const result = new Set<Uint32Array>(), seen = new Set<object>()
  function walk(item: unknown): void {
    if (!item || typeof item !== 'object' || seen.has(item)) return
    seen.add(item)
    if (ArrayBuffer.isView(item)) { if (item instanceof Uint32Array && pixel_source_is(item)) result.add(item); return }
    if (item instanceof Blob || item instanceof ArrayBuffer) return
    if (Array.isArray(item)) for (const child of item) walk(child)
    else for (const child of Object.values(item)) walk(child)
  }
  walk(value)
  return [...result]
}

export function pixel_source_collect(value: unknown): pixel_source_record_t[] {
  const groups = new Map<pixel_source_asset_t, pixel_source_record_t>()
  for (const packed of pixel_source_packets(value)) {
    const asset = bindings.get(packed)
    if (!asset) throw new Error('元の動画が見つかりません')
    let record = groups.get(asset)
    if (!record) { record = { ...asset, packets: [] }; groups.set(asset, record) }
    record.packets.push(packed)
  }
  return [...groups.values()]
}

export function pixel_source_bind(records: pixel_source_record_t[]): void {
  for (const record of records) {
    if (!(record.file instanceof Blob) || !record.file.size) throw new Error('元の動画を読み込めません')
    const asset = pixel_source_asset(record.file, Math.min(record.budget || memory_work_budget(), memory_work_budget()))
    for (const packed of record.packets) {
      if (!pixel_source_is(packed) || !pixel_source_valid(packed, packed[2] * packed[3])) throw new Error('動画のコマ情報が正しくありません')
      packed[1] = asset.id
      bindings.set(packed, asset)
    }
  }
}

export function pixel_source_restore(value: unknown, records: pixel_source_asset_t[]): void {
  const packets = pixel_source_packets(value)
  const groups = records.map(record => ({ ...record, packets: packets.filter(packed => packed[1] === record.id) }))
  if (packets.some(packed => !groups.some(group => group.packets.includes(packed)))) throw new Error('元の動画が保存されていません')
  pixel_source_bind(groups)
}

export function pixel_source_peek(packed: Uint32Array): Uint32Array | null { return cache_get(pixels, packed) }

export function pixel_source_ready(value: unknown): number {
  return pixel_source_packets(value).every(packed => pixel_source_peek(packed)) ? 1 : 0
}

function decoder_close(decoder: decoder_t): void {
  decoder.sample?.close(); decoder.next?.close()
  if (decoder.stream) void decoder.stream.return().catch(() => {})
  decoder.input.dispose()
}

async function decoder_sample(decoder: decoder_t, time: number): Promise<VideoSample | null> {
  time = Math.max(time, decoder.first)
  if (!decoder.stream || time < decoder.time - 0.000001 || time - decoder.time > 1) {
    decoder.sample?.close(); decoder.next?.close()
    if (decoder.stream) await decoder.stream.return()
    decoder.stream = decoder.sink.samples(time)
    decoder.sample = null; decoder.next = null
  }
  decoder.time = time
  for (;;) {
    if (!decoder.next) { const item = await decoder.stream.next(); if (item.done) break; decoder.next = item.value }
    if (decoder.next.timestamp > time + 0.000001) break
    decoder.sample?.close(); decoder.sample = decoder.next; decoder.next = null
  }
  return decoder.sample?.clone() || null
}

async function decode(packed: Uint32Array): Promise<void> {
  if (pixel_source_peek(packed)) return
  const asset = bindings.get(packed)
  if (!asset) throw new Error('元の動画が見つかりません')
  const budget = asset.budget || memory_work_budget()
  memory_check(packed[2] * packed[3] * 12, budget)
  let decoder = decoders.get(asset)
  if (!decoder) {
    const input = new Input({ source: new BlobSource(asset.file), formats: ALL_FORMATS })
    try {
      const track = await input.getPrimaryVideoTrack()
      if (!track || !await track.canDecode()) throw new Error('この端末では動画のコマを読み込めません')
      while (decoders.size >= 2) { const old = decoders.keys().next().value!; decoder_close(decoders.get(old)!); decoders.delete(old) }
      decoder = { input, sink: new VideoSampleSink(track), stream: null, sample: null, next: null, time: -Infinity, first: await track.getFirstTimestamp() }
      decoders.set(asset, decoder)
    } catch (error) { input.dispose(); throw error }
  }
  clearTimeout(decoder_timer)
  const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength)
  const sample = await decoder_sample(decoder, view.getFloat64(32, true))
  let canvas: HTMLCanvasElement | OffscreenCanvas | null = null
  try {
    if (!sample) throw new Error('動画のコマを読み込めませんでした。動画を取り込み直してください')
    const w = packed[2], h = packed[3], bw = packed[4], bh = packed[5]
    canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!context) throw new Error('動画の作業領域を準備できませんでした')
    const m = Array.from({ length: 6 }, (_, i) => view.getFloat64(40 + i * 8, true))
    for (let offset = 88; offset < packed.byteLength; offset += 64) {
      context.beginPath()
      for (let i = 0; i < 4; i++) {
        const x = view.getFloat64(offset + i * 16, true), y = view.getFloat64(offset + i * 16 + 8, true)
        if (i) context.lineTo(x, y); else context.moveTo(x, y)
      }
      context.closePath(); context.clip()
    }
    context.setTransform(m[0], m[1], m[2], m[3], m[4], m[5])
    context.beginPath(); context.rect(0, 0, bw, bh); context.clip()
    context.fillStyle = '#' + packed[6].toString(16).padStart(6, '0') + packed[7].toString(16).padStart(2, '0'); context.fillRect(0, 0, bw, bh)
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
    if (sample) {
      const scale = Math.min(bw / sample.displayWidth, bh / sample.displayHeight)
      sample.draw(context, (bw - sample.displayWidth * scale) / 2, (bh - sample.displayHeight * scale) / 2, sample.displayWidth * scale, sample.displayHeight * scale)
    }
    const image = context.getImageData(0, 0, w, h)
    const decoded = new Uint32Array(image.data.buffer)
    cache_put(pixels, packed, decoded, decoded.byteLength, Math.max(decoded.byteLength, budget / 8))
  } finally {
    sample?.close()
    if (canvas) canvas.width = 0
    decoder_timer = setTimeout(() => { for (const decoder of decoders.values()) decoder_close(decoder); decoders.clear() }, 5000)
  }
}

export function pixel_source_prepare(value: unknown): Promise<void> {
  const tasks = pixel_source_packets(value).map(packed => {
    if (pixel_source_peek(packed)) return Promise.resolve()
    if (failures.has(packed)) return Promise.reject(failures.get(packed))
    let task = pending.get(packed)
    if (!task) {
      task = queue.then(() => decode(packed))
      queue = task.catch(() => {})
      pending.set(packed, task)
      task.then(() => { pending.delete(packed); listener() }, error => { pending.delete(packed); failures.set(packed, error); listener(error) })
    }
    return task
  })
  return Promise.all(tasks).then(() => {})
}
