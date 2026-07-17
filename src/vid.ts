import { BufferTarget, EncodedAudioPacketSource, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output } from 'mediabunny'
import { animout_compose, animout_jobs, animout_ticks } from './animout'
import { report_error, report_warning } from './diagnostics'
import { doc_frame_new } from './doc'
import { L_P, type Frame } from './h'
import { canvas_make, clamp, rle_pack } from './lib'
import { mode_frame_limit } from './mode'
import { snd_any_bgm, snd_any_se, snd_export_dest, snd_offline_mix, type SoundExportDestination } from './snd'
import { dispatch } from './state/commands/index'
import { anim_tick_starts } from './state/commands/play'
import { st } from './state/store'

function pick_mime(): string {
  const list = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  for (const m of list) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m
  return ''
}

function pick_mp4_mime(): string {
  const list = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4']
  for (const m of list) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m
  return ''
}

export function vid_supported(): number {
  return typeof MediaRecorder !== 'undefined' && pick_mime() ? 1 : 0
}

export function vid_mp4_mode(): number {
  const wc = (globalThis as { VideoEncoder?: unknown }).VideoEncoder
  if (wc) return 2
  if (pick_mp4_mime()) return 1
  return 0
}

function even(v: number): number {
  const n = Math.round(v)
  return n % 2 ? n + 1 : n
}

function need_audio(): number {
  return snd_any_bgm() || snd_any_se() ? 1 : 0
}

function media_export(mime: string, scale: number, onProgress: (progress: number) => void, done: (blob: Blob | null) => void): void {
  dispatch('frame.sync_live', null)
  const g = st()
  const fps = g.doc.fps
  const starts = anim_tick_starts()
  const jobs = animout_jobs(g.doc.frames, 0, g.doc.frames.length - 1, fps, g.doc.anim, 0)
  const ticks = animout_ticks(jobs)
  const width = Math.round(g.doc.w * scale)
  const height = Math.round(g.doc.h * scale)
  const [canvas, context] = canvas_make(width, height)
  if (!jobs.length || ticks < 1) {
    done(null)
    return
  }
  animout_compose(jobs[0], context, width, height, 1, fps, g.doc.anim)
  const stream = canvas.captureStream(Math.min(60, Math.max(10, fps * 2)))
  let audio: SoundExportDestination | null = null
  if (need_audio()) {
    audio = snd_export_dest(starts.map(tick => tick / fps), ticks / fps)
    if (audio) for (const track of audio.node.stream.getAudioTracks()) stream.addTrack(track)
  }

  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
  } catch (error) {
    report_error('動画レコーダーを開始できませんでした', error)
    for (const track of stream.getTracks()) track.stop()
    done(null)
    return
  }

  let finished = 0
  const chunks: Blob[] = []
  const finish = (blob: Blob | null): void => {
    if (finished) return
    finished = 1
    if (audio) audio.end()
    for (const track of stream.getTracks()) track.stop()
    done(blob)
  }

  recorder.ondataavailable = event => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  recorder.onstop = () => finish(new Blob(chunks, { type: mime.split(';')[0] }))
  recorder.onerror = event => {
    report_error('動画の録画中にエラーが発生しました', event)
    finish(null)
  }

  try {
    recorder.start(250)
    if (audio && !audio.begin()) audio = null
  } catch (error) {
    report_error('動画の録画を開始できませんでした', error)
    finish(null)
    return
  }

  const startedAt = performance.now() + 60
  let currentJob = -1
  const tick = (): void => {
    if (finished) return
    const elapsed = performance.now() - startedAt
    const wantedJob = Math.min(jobs.length - 1, Math.max(0, Math.floor((elapsed / 1000) * fps)))
    if (wantedJob !== currentJob) {
      currentJob = wantedJob
      animout_compose(jobs[wantedJob], context, width, height, 1, fps, g.doc.anim)
      onProgress((wantedJob + 1) / jobs.length)
    }
    if (elapsed >= ((ticks + 1) / fps) * 1000 + 150) {
      if (recorder.state !== 'inactive') recorder.stop()
      else finish(null)
      return
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

export function vid_export(scale: number, onProgress: (progress: number) => void, done: (blob: Blob | null) => void): void {
  const mime = pick_mime()
  if (!mime) {
    done(null)
    return
  }
  media_export(mime, scale, onProgress, done)
}

type ClosableEncoder = { readonly state: string, close: () => void }

function close_encoder(encoder: ClosableEncoder): void {
  if (encoder.state === 'closed') return
  try {
    encoder.close()
  } catch {}
}

export function vid_export_mp4(scale: number, onProgress: (progress: number) => void, done: (blob: Blob | null, note: string) => void): void {
  const webCodecs = (globalThis as { VideoEncoder?: unknown }).VideoEncoder
  if (!webCodecs) {
    done(null, 'この環境はWebCodecs非対応みたい（WebMをどうぞ）')
    return
  }

  let finished = 0
  const finish = (blob: Blob | null, note: string): void => {
    if (finished) return
    finished = 1
    done(blob, note)
  }

  dispatch('frame.sync_live', null)
  const g = st()
  const fps = g.doc.fps
  const starts = anim_tick_starts()
  const jobs = animout_jobs(g.doc.frames, 0, g.doc.frames.length - 1, fps, g.doc.anim, 1)
  const ticks = animout_ticks(jobs)
  const width = even(g.doc.w * scale)
  const height = even(g.doc.h * scale)
  const [canvas, context] = canvas_make(width, height)
  const kbps = clamp(Math.round((width * height * fps) / 90), 800, 16000)
  const baseConfig = {
    width,
    height,
    bitrate: kbps * 1000,
    framerate: Math.max(1, fps),
    avc: { format: 'avc' as const },
    latencyMode: 'realtime' as const,
  }
  const candidates = ['avc1.42E01F', 'avc1.42E028', 'avc1.4D401F', 'avc1.640028']

  const pick_codec = async (): Promise<string> => {
    if (!VideoEncoder.isConfigSupported) return candidates[0]
    for (const codec of candidates) {
      try {
        const result = await VideoEncoder.isConfigSupported({ codec, ...baseConfig })
        if (result.supported) return codec
      } catch {}
    }
    return ''
  }

  const encode_video = async (
    encoder: VideoEncoder,
    videoError: () => unknown
  ): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      let index = 0
      let outputTick = 0
      const pump = (): void => {
        const error = videoError()
        if (error) {
          reject(error)
          return
        }
        const startedAt = performance.now()
        try {
          while (index < jobs.length && performance.now() - startedAt < 24) {
            const job = jobs[index]
            animout_compose(job, context, width, height, 1, fps, g.doc.anim)
            const videoFrame = new VideoFrame(canvas, {
              timestamp: Math.round(outputTick * (1_000_000 / fps)),
              duration: Math.round(job.hold * (1_000_000 / fps)),
            })
            try {
              encoder.encode(videoFrame, { keyFrame: index % Math.max(1, Math.round(fps * 2)) === 0 })
            } finally {
              videoFrame.close()
            }
            outputTick += job.hold
            index++
            onProgress((index / jobs.length) * 0.7)
          }
        } catch (caught) {
          reject(caught)
          return
        }
        if (index < jobs.length) setTimeout(pump, 0)
        else resolve()
      }
      pump()
    })
    await encoder.flush()
    const error = videoError()
    if (error) throw error
  }

  type AudioPacket = { packet: EncodedPacket, metadata?: EncodedAudioChunkMetadata }

  const encode_audio = async (pcm: Float32Array, audioRate: number): Promise<AudioPacket[]> => {
    if (!Number.isFinite(audioRate) || audioRate <= 0) throw new RangeError('invalid audio sample rate')
    const config: AudioEncoderConfig = { codec: 'mp4a.40.2', sampleRate: audioRate, numberOfChannels: 1, bitrate: 96000 }
    if (AudioEncoder.isConfigSupported) {
      const support = await AudioEncoder.isConfigSupported(config)
      if (!support.supported) throw new Error('AAC encoding is not supported')
    }

    const packets: AudioPacket[] = []
    let encoderError: unknown = null
    const encoder = new AudioEncoder({
      output: (chunk, metadata) => {
        try {
          packets.push({ packet: EncodedPacket.fromEncodedChunk(chunk), metadata })
        } catch (error) {
          if (!encoderError) encoderError = error
        }
      },
      error: error => {
        encoderError = error
      },
    })

    try {
      encoder.configure(config)
      const chunkSize = 9600
      for (let offset = 0; offset < pcm.length; offset += chunkSize) {
        if (encoderError) throw encoderError
        const segment = pcm.subarray(offset, Math.min(pcm.length, offset + chunkSize))
        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: audioRate,
          numberOfFrames: segment.length,
          numberOfChannels: 1,
          timestamp: Math.round((offset / audioRate) * 1_000_000),
          data: segment.slice(),
        })
        try {
          encoder.encode(audioData)
        } finally {
          audioData.close()
        }
      }
      await encoder.flush()
      if (encoderError) throw encoderError
      if (!packets.length) throw new Error('AAC encoder returned no packets')
      return packets
    } finally {
      close_encoder(encoder)
    }
  }

  const run = async (pcm: Float32Array | null, audioRate: number): Promise<void> => {
    try {
      const codec = await pick_codec()
      if (!codec) {
        finish(null, 'H.264が使えない環境みたい（WebMをどうぞ）')
        return
      }

      let note = ''
      let audioPackets: AudioPacket[] | null = null
      if (pcm && typeof AudioEncoder !== 'undefined') {
        try {
          audioPackets = await encode_audio(pcm, audioRate)
        } catch (error) {
          report_warning('AAC音声の生成に失敗しました', error)
          note = '音声エンコードに失敗（映像のみ）'
        }
      } else if (need_audio()) {
        note = 'この環境では音声なしのMP4になりました'
      }

      const target = new BufferTarget()
      const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target })
      const videoSource = new EncodedVideoPacketSource('avc')
      output.addVideoTrack(videoSource)
      const audioSource = audioPackets ? new EncodedAudioPacketSource('aac') : null
      if (audioSource) output.addAudioTrack(audioSource)

      let muxError: unknown = null
      let mux: Promise<unknown> = output.start().catch(error => {
        muxError = error
        report_error('MP4多重化の開始に失敗しました', error)
      })
      const enqueue = (task: () => Promise<unknown>): void => {
        mux = mux
          .then(() => {
            if (muxError) return
            return task()
          })
          .catch(error => {
            if (!muxError) muxError = error
            report_error('MP4パケットの追加に失敗しました', error)
          })
      }

      let videoError: unknown = null
      const videoEncoder = new VideoEncoder({
        output: (chunk, metadata) => enqueue(() => videoSource.add(EncodedPacket.fromEncodedChunk(chunk), metadata)),
        error: error => {
          videoError = error
          report_error('H.264エンコーダーでエラーが発生しました', error)
        },
      })

      try {
        videoEncoder.configure({ codec, ...baseConfig })
        await encode_video(videoEncoder, () => videoError || muxError)
      } finally {
        close_encoder(videoEncoder)
      }
      if (videoError) throw videoError
      if (muxError) throw muxError

      if (audioSource && audioPackets) {
        for (const item of audioPackets) enqueue(() => audioSource.add(item.packet, item.metadata))
      }

      onProgress(0.95)
      await mux
      if (muxError) throw muxError
      await output.finalize()
      if (!target.buffer) throw new Error('MP4 buffer is empty')
      onProgress(1)
      finish(new Blob([target.buffer], { type: 'video/mp4' }), note)
    } catch (error) {
      report_error('MP4の書き出しに失敗しました', error)
      finish(null, 'MP4の書き出しに失敗しました')
    }
  }

  const duration = ticks / fps
  if (!need_audio() || typeof AudioEncoder === 'undefined') {
    void run(null, 0)
    return
  }
  snd_offline_mix(duration, starts.map(tick => tick / fps), (pcm, rate) => {
    void run(pcm, rate)
  })
}

export function vid_import(file: File, onProgress: (progress: number) => void, done: (error: number, added: number) => void): void {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'

  let completed = 0
  let watchdog: ReturnType<typeof setTimeout> | 0 = 0
  const cleanup = (): void => {
    clearTimeout(watchdog)
    watchdog = 0
    video.onerror = null
    video.onloadedmetadata = null
    video.onloadeddata = null
    video.onseeked = null
    video.pause()
    video.removeAttribute('src')
    URL.revokeObjectURL(url)
  }
  const settle = (error: number, added: number): void => {
    if (completed) return
    completed = 1
    cleanup()
    done(error, added)
  }
  const fail = (context: string, error: unknown): void => {
    if (completed) return
    report_warning(context, error)
    settle(-1, 0)
  }

  video.onerror = () => fail('動画ファイルを読み込めませんでした', video.error || 'media error')
  video.onloadedmetadata = () => {
    try {
      const duration = video.duration
      if (!Number.isFinite(duration) || duration <= 0) {
        fail('動画の長さを取得できませんでした', duration)
        return
      }

      dispatch('frame.sync_live', null)
      const g = st()
      const fps = g.doc.fps
      const baseCount = g.doc.frames.length
      const room = mode_frame_limit(g.doc.mode) - baseCount
      const count = Math.min(room, Math.max(1, Math.round(duration * fps)), 600)
      if (count < 1) {
        settle(-2, 0)
        return
      }

      const mediaWidth = video.videoWidth
      const mediaHeight = video.videoHeight
      if (!Number.isFinite(mediaWidth) || !Number.isFinite(mediaHeight) || mediaWidth < 1 || mediaHeight < 1) {
        fail('動画の画面サイズを取得できませんでした', { mediaWidth, mediaHeight })
        return
      }

      const width = g.doc.w
      const height = g.doc.h
      const [, context] = canvas_make(width, height, 1)
      const videoRatio = mediaWidth / mediaHeight
      const canvasRatio = width / height
      let drawWidth = width
      let drawHeight = height
      if (videoRatio > canvasRatio) drawHeight = Math.round(width / videoRatio)
      else drawWidth = Math.round(height * videoRatio)
      const drawX = Math.round((width - drawWidth) / 2)
      const drawY = Math.round((height - drawHeight) / 2)
      const frames: Frame[] = []
      const lastSeekTime = Math.max(0, duration - 0.001)
      let index = 0
      let capturePending = 0

      const arm_watchdog = (): void => {
        clearTimeout(watchdog)
        watchdog = setTimeout(() => fail('動画のフレーム取得がタイムアウトしました', { index, count }), 8000)
      }
      const finish = (): void => {
        if (completed) return
        const result = dispatch('frame.append_bulk', { frames, setCur: baseCount + frames.length - 1 })
        if (result < 0) {
          fail('動画から作成したコマを追加できませんでした', result)
          return
        }
        settle(0, frames.length)
      }
      const grab = (): void => {
        if (completed || !capturePending) return
        capturePending = 0
        clearTimeout(watchdog)
        watchdog = 0
        try {
          context.clearRect(0, 0, width, height)
          context.imageSmoothingEnabled = true
          context.drawImage(video, drawX, drawY, drawWidth, drawHeight)
          const frame = doc_frame_new()
          const image = context.getImageData(0, 0, width, height)
          let hasPixels = 0
          for (let offset = 3; offset < image.data.length; offset += 4) {
            if (image.data[offset]) {
              hasPixels = 1
              break
            }
          }
          if (hasPixels) frame.pk[L_P] = pack_from(image)
          frames.push(frame)
          index++
          onProgress(index / count)
          if (index >= count) {
            finish()
            return
          }
          seek_to(index)
        } catch (error) {
          fail('動画のフレームを画像へ変換できませんでした', error)
        }
      }
      const seek_to = (frameIndex: number): void => {
        capturePending = 1
        arm_watchdog()
        const target = Math.min(lastSeekTime, (frameIndex + 0.5) / fps)
        if (Math.abs(video.currentTime - target) < 0.0001 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          queueMicrotask(grab)
          return
        }
        video.currentTime = target
      }

      video.onseeked = grab
      video.onloadeddata = grab
      seek_to(0)
    } catch (error) {
      fail('動画の取り込みを開始できませんでした', error)
    }
  }
  video.src = url
}

function pack_from(img: ImageData): Uint32Array {
  return rle_pack(new Uint32Array(img.data.buffer))
}
