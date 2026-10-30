import { EncodedAudioPacketSource, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, WebMOutputFormat, Output, StreamTarget } from 'mediabunny'
import { audio_mix_chunk, type audio_mix_t } from './audio_mix'
import { blob_store, blob_store_write, blob_store_finish } from './blob_store'
import { raster_make, raster_cache } from './raster'
import { render_layers, render_prepare, type render_context_t, type render_plan_t } from './render'
import { cache_clear, memory_check, memory_work_budget } from './memory'
import { task_yield, task_timeout } from './task_queue'

export type video_encode_input_t = { w: number, h: number, fps: number, holds: number[], format: 'mp4' | 'webm', pcm: Float32Array | null, audio_rate: number, sound?: audio_mix_t, budget?: number, plans?: render_plan_t[], frames?: number[] }
export type video_config_t = { video: VideoEncoderConfig, audio: AudioEncoderConfig | null }

function audio_aac_description(rate: number): Uint8Array<ArrayBuffer> {
  const index = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350].indexOf(rate)
  if (index >= 0) return new Uint8Array([0x10 | index >> 1, (index & 1) << 7 | 0x10])
  return new Uint8Array([0x17, 0x80 | rate >> 17, rate >> 9 & 255, rate >> 1 & 255, (rate & 1) << 7 | 0x10])
}

export async function video_encode_config(w: number, h: number, fps: number, format: 'mp4' | 'webm', audio_rate: number): Promise<video_config_t | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined' || audio_rate && (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined')) return null
  const mp4 = format === 'mp4'
  const base: VideoEncoderConfig = { codec: '', width: w, height: h, bitrate: Math.max(800000, Math.min(16000000, Math.round(w * h * fps * 0.12))), framerate: Math.max(1, fps), latencyMode: 'realtime', ...(mp4 ? { avc: { format: 'avc' as const } } : {}) }
  const codecs = mp4 ? ['avc1.42001f', 'avc1.420028', 'avc1.4d002a', 'avc1.640033', 'avc1.42E01F'] : ['vp09.00.10.08', 'vp8']
  let video: VideoEncoderConfig | null = null
  for (const codec of codecs) {
    try { if ((await VideoEncoder.isConfigSupported({ ...base, codec })).supported) { video = { ...base, codec }; break } } catch {}
  }
  if (!video) return null
  let audio: AudioEncoderConfig | null = null
  if (audio_rate) {
    audio = { codec: mp4 ? 'mp4a.40.2' : 'opus', sampleRate: audio_rate, numberOfChannels: 2, bitrate: 128000 }
    try { if (!(await AudioEncoder.isConfigSupported(audio)).supported) return null } catch { return null }
  }
  return { video, audio }
}

export async function video_encode(input: video_encode_input_t, progress: (value: number) => void, compose?: (index: number, context: render_context_t) => void | Promise<void>): Promise<Blob> {
  const { w, h, fps, holds, pcm, format, sound } = input
  const audio_rate = sound?.rate || (pcm ? input.audio_rate : 0)
  const budget = input.budget || memory_work_budget()
  memory_check(w * h * 16 + (pcm?.byteLength || 0), budget)
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 2 || h < 2 || !Number.isFinite(fps) || fps <= 0 || !holds.length || holds.some(hold => !Number.isFinite(hold) || hold <= 0)) throw new Error('動画の設定が正しくありません')
  const config = await task_timeout(video_encode_config(w, h, fps, format, audio_rate), 15000)
  if (!config) throw new Error('この環境では指定した映像・音声をエンコードできません')
  let last_progress = -Infinity
  const notify = (value: number): void => {
    if (value < 1 && performance.now() - last_progress < 50) return
    last_progress = performance.now()
    progress(value)
  }
  const mp4 = format === 'mp4'
  const store = blob_store(Math.floor(budget / 2))
  const target = new StreamTarget(new WritableStream({ write: chunk => blob_store_write(store, chunk.data, chunk.position) }), { chunked: true, chunkSize: 1 << 20 })
  const output = new Output({ target, format: mp4 ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat() })
  const source = new EncodedVideoPacketSource(mp4 ? 'avc' : config.video.codec.startsWith('vp8') ? 'vp8' : 'vp9')
  output.addVideoTrack(source)
  const audio_source = config.audio ? new EncodedAudioPacketSource(mp4 ? 'aac' : 'opus') : null
  if (audio_source) output.addAudioTrack(audio_source)
  const canvas = raster_make(w, h), context = canvas.getContext('2d') as render_context_t
  if (!context) { canvas.width = 0; throw new Error('動画用の画像を準備できませんでした') }
  const cache = raster_cache(), durations = new Map<number, number>()
  let error: unknown = null
  let pending: Promise<unknown> = output.start()
  const enqueue = (add: () => Promise<unknown>): void => {
    pending = pending.then(() => { if (!error) return add() }).catch(caught => { error = caught })
  }
  const audio_length = sound?.length || (pcm ? pcm.length / 2 : 0)
  let audio_packet_offset: number | null = null
  let audio_metadata: EncodedAudioChunkMetadata | undefined
  let encoder: VideoEncoder | null = null, audio_encoder: AudioEncoder | null = null, complete = 0
  const wait = async (): Promise<void> => {
    if (encoder) await task_timeout(encoder.flush(), 30000)
    await task_timeout(pending, 30000)
    if (error) throw error
    await task_yield()
  }
  try {
    encoder = new VideoEncoder({ output: (chunk, metadata) => {
      const packet = EncodedPacket.fromEncodedChunk(chunk).clone({ duration: durations.get(chunk.timestamp) ?? (chunk.duration || 0) / 1000000 })
      durations.delete(chunk.timestamp)
      enqueue(() => source.add(packet, metadata))
    }, error: caught => { error = caught } })
    encoder.configure(config.video)
    if (config.audio && audio_source) {
      audio_encoder = new AudioEncoder({ output: (chunk, metadata) => {
        if (metadata) {
          audio_metadata = mp4 ? { ...metadata, decoderConfig: { codec: 'mp4a.40.2', sampleRate: audio_rate, numberOfChannels: 2, description: audio_aac_description(audio_rate) } } : metadata
        }
        if (audio_packet_offset === null) audio_packet_offset = Math.round(Math.min(0, chunk.timestamp) * audio_rate / 1000000)
        const frames = mp4 ? 1024 : Math.max(1, Math.round((chunk.duration || 20000) * audio_rate / 1000000))
        const start = Math.max(0, audio_packet_offset)
        const duration = (Math.min(audio_packet_offset + frames, audio_length) - start) / audio_rate
        if (duration > 0) {
          const packet = EncodedPacket.fromEncodedChunk(chunk).clone({ timestamp: start / audio_rate, duration })
          const packet_metadata = audio_metadata
          enqueue(() => audio_source.add(packet, packet_metadata))
          audio_metadata = undefined
        }
        audio_packet_offset += frames
      }, error: caught => { error = caught } })
      audio_encoder.configure(config.audio)
    }
    let tick = 0, audio_offset = 0
    for (let i = 0; i < holds.length; i++) {
      if (error) throw error
      if (compose) await compose(i, context)
      else {
        const plan = input.plans?.[input.frames?.[i] ?? i]
        if (!plan) throw new Error('動画の描画データがありません')
        await render_prepare(plan)
        render_layers(plan, context, w, h, cache, Math.min(16 << 20, budget / 8))
      }
      const timestamp = Math.round(tick * 1000000 / fps), duration = Math.round(holds[i] * 1000000 / fps)
      const frame = new VideoFrame(canvas, { timestamp, duration })
      durations.set(timestamp, holds[i] / fps)
      try { encoder.encode(frame, { keyFrame: i === 0 || Math.floor(tick / (fps * 2)) !== Math.floor((tick - holds[i - 1]) / (fps * 2)) }) } finally { frame.close() }
      tick += holds[i]
      const audio_end = i === holds.length - 1 ? audio_length : Math.min(audio_length, Math.round(tick / fps * audio_rate))
      while (audio_encoder && audio_offset < audio_end) {
        const frames = mp4 ? 1024 : Math.max(1, Math.round(audio_rate / 50))
        const count = Math.min(frames, audio_length - audio_offset)
        let segment: Float32Array<ArrayBuffer>
        if (sound) segment = audio_mix_chunk(sound, audio_offset, count)
        else {
          segment = new Float32Array(count * 2)
          segment.set(pcm!.subarray(audio_offset, audio_offset + count))
          segment.set(pcm!.subarray(audio_length + audio_offset, audio_length + audio_offset + count), count)
        }
        if (count < frames) {
          const padded = new Float32Array(frames * 2)
          padded.set(segment.subarray(0, count)); padded.set(segment.subarray(count), frames)
          segment = padded
        }
        const data = new AudioData({ format: 'f32-planar', sampleRate: audio_rate, numberOfFrames: frames, numberOfChannels: 2, timestamp: Math.round(audio_offset * 1000000 / audio_rate), data: segment })
        try { audio_encoder.encode(data) } finally { data.close() }
        audio_offset += count
        if (audio_encoder.encodeQueueSize >= 4) {
          notify((i + Math.min(1, audio_offset / Math.max(1, audio_end))) / holds.length * 0.95)
          const active = audio_encoder
          let release = (): void => {}
          try {
            await task_timeout(new Promise<void>(resolve => {
              const dequeue = (): void => { if (active.encodeQueueSize < 4) { release(); resolve() } }
              release = () => active.removeEventListener('dequeue', dequeue)
              active.addEventListener('dequeue', dequeue)
              dequeue()
            }), 30000)
          } finally { release() }
          if (error) throw error
          await task_yield()
        }
      }
      notify((i + 1) / holds.length * 0.95)
      if (encoder.encodeQueueSize >= 4 || (i + 1) % 4 === 0) await wait()
    }
    if (audio_encoder) await task_timeout(audio_encoder.flush(), 30000)
    await wait()
    await task_timeout(output.finalize(), 30000)
    complete = 1
    notify(1)
    return blob_store_finish(store, mp4 ? 'video/mp4' : 'video/webm')
  } finally {
    if (encoder && encoder.state !== 'closed') encoder.close()
    if (audio_encoder && audio_encoder.state !== 'closed') audio_encoder.close()
    if (!complete) { void output.cancel().catch(() => {}); store.parts.length = 0 }
    cache_clear(cache)
    canvas.width = 0
  }
}
