import { crc32 } from './binary'
import { pixel_source_asset, pixel_source_make } from './pixel_source'
import { memory_check, memory_work_budget } from './memory'
import { task_yield } from './task_queue'
import { ALL_FORMATS, AudioSampleSink, BlobSource, VideoSampleSink, Input } from 'mediabunny'
import { doc_frame_new } from './doc'
import type { loaded_project_t } from './fmt'
import { anim_fx_zero, l_base_n, l_p, mode_normal, mode_dsi, mode_3_d, note_meta_zero, type frame_t } from './h'
import { canvas_make, rle_pack } from './lib'
import { mode_canvas, mode_frame_limit, mode_pal } from './mode'
import { flip_image_convert } from './flipnote/image'
import { color_hex, nearest_color, ppm_colors, kwz_colors } from './flipnote/color'

export type video_import_options_t = { fps: number, w: number, h: number, memory_bytes?: number, mode?: number, paper?: string, size?: 'source' | 'canvas', work_bytes?: number }

export async function vid_import(file: File, options: video_import_options_t, on_progress: (progress: number) => void): Promise<loaded_project_t> {
  const fps = options.fps
  let { w, h } = options
  if (!Number.isFinite(fps) || fps < 0.2 || fps > 30 || !Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw new Error('動画の取り込み設定が正しくありません')
  const mode = options.mode ?? mode_normal
  if (![mode_normal, mode_dsi, mode_3_d].includes(mode)) throw new Error('描画モードが正しくありません')
  const native = mode !== mode_normal
  const geometry = mode_canvas(mode)
  let paper = options.paper || '#FFFFFF'
  let paper_index = 0
  if (native) {
    w = geometry.w; h = geometry.h
    const value = Number.parseInt(paper.slice(1, 7), 16)
    const colors = mode === mode_dsi ? ppm_colors.slice(0, 2) : kwz_colors
    paper_index = nearest_color((value >>> 16) & 255, (value >>> 8) & 255, value & 255, colors)
    paper = color_hex(colors[paper_index])
  }
  let canvas: HTMLCanvasElement | OffscreenCanvas | null = null
  const work_budget = options.work_bytes || memory_work_budget()
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const video = await input.getPrimaryVideoTrack()
    const audio = await input.getPrimaryAudioTrack()
    if (!video || !await video.canDecode()) throw new Error('この端末では動画の映像を読み込めません')
    if (!native && options.size === 'source') { w = await video.getDisplayWidth(); h = await video.getDisplayHeight() }
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 4096 || h > 4096) throw new Error('この大きさは編集できる範囲を超えます。取り込みの大きさを選び直してください')
    if (audio && !await audio.canDecode()) throw new Error('この端末では動画の音声を読み込めません。音声を保つため取り込みを中止しました')
    const tracks = audio ? [video, audio] : [video]
    const origin = Math.max(0, await input.getFirstTimestamp(tracks))
    const end = await input.computeDuration(tracks)
    const duration = end - origin
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('動画の長さを取得できません')
    const limit = mode_frame_limit(mode)
    const budget = Math.max(1024 * 1024, options.memory_bytes || work_budget)
    const count = Math.ceil(duration * fps - 0.000001)
    if (count > limit) {
      const maximum = Math.floor(limit / duration * 100) / 100
      throw new Error('この設定では' + count + 'コマになります（最大' + limit + 'コマ）。' + (maximum >= 0.2 ? '1秒あたりのコマ数を' + maximum + '以下にしてください' : 'このモードで扱える再生時間を超えています'))
    }
    const eager = native || w * h * count * 4 <= Math.min(8 << 20, work_budget / 8)
    memory_check(count * 128 + w * h * (eager ? 16 : 12), work_budget)
    if (eager) canvas = typeof document === 'undefined' ? new OffscreenCanvas(w, h) : canvas_make(w, h, 1)[0]
    const context = canvas?.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    let last_yield = performance.now(), last_progress = -Infinity
    const pause = async (): Promise<void> => {
      if (performance.now() - last_yield < 12) return
      await task_yield()
      last_yield = performance.now()
    }
    const progress = (value: number): void => {
      if (value < 1 && performance.now() - last_progress < 50) return
      last_progress = performance.now(); on_progress(value)
    }
    const frames: frame_t[] = []
    let previous_time = -Infinity
    let previous_packed: frame_t['pk'] | null = null
    let index = 0, packed_bytes = 0
    const images = new Set<Uint32Array>()
    const shared = new Map<number, Uint32Array[]>()
    const timestamps = function* (): Generator<number> {
      for (let i = 0; i < count; i++) yield origin + i / fps
    }
    if (!eager) {
      const asset = pixel_source_asset(file, work_budget)
      for (let i = 0; i < count; i++) {
        const frame = doc_frame_new()
        frame.pk[l_p] = pixel_source_make(asset, w, h, paper, origin + i / fps)
        frames.push(frame)
        progress((i + 1) / count * 0.75)
        await pause()
      }
    } else for await (const sample of new VideoSampleSink(video).samplesAtTimestamps(timestamps())) {
      try {
        const frame = doc_frame_new()
        frame.hold = 1
        const time = sample ? sample.timestamp : -Infinity
        if (previous_packed && time === previous_time) frame.pk = previous_packed.slice()
        else {
          context.clearRect(0, 0, w, h)
          context.fillStyle = paper
          context.fillRect(0, 0, w, h)
          context.imageSmoothingEnabled = true
          context.imageSmoothingQuality = 'high'
          if (sample) sample.drawWithFit(context, { fit: 'contain' })
          const pixels = context.getImageData(0, 0, w, h).data
          if (native) {
            const converted = flip_image_convert({ format: mode === mode_dsi ? 'ppm' : 'kwz', width: w, height: h, pixels, frames: 1, paper: paper_index, contrast: 1, saturation: 1, dither: 0 })
            frame.pk = converted.frames[0]
          } else frame.pk[l_p] = rle_pack(new Uint32Array(pixels.buffer))
          previous_time = time; previous_packed = frame.pk
        }
        for (let l = 0; l < frame.pk.length; l++) {
          const packed = frame.pk[l]
          if (!packed || images.has(packed)) continue
          const key = crc32(new Uint8Array(packed.buffer, packed.byteOffset, packed.byteLength), 0)
          const candidates = shared.get(key) || []
          const match = candidates.find(candidate => candidate.length === packed.length && candidate.every((value, index) => value === packed[index]))
          if (match) frame.pk[l] = match
          else { candidates.push(packed); shared.set(key, candidates) }
        }
        frames.push(frame)
        for (const packed of frame.pk) if (packed && !images.has(packed)) { images.add(packed); packed_bytes += packed.byteLength }
        if (packed_bytes > budget) throw new Error('画質を保ったまま取り込むためのメモリが足りません。コマ数や取り込みの大きさを選び直してください')
        memory_check(packed_bytes + w * h * 16, work_budget)
        index++
        progress(index / count * 0.75)
      } finally { sample?.close() }
      await pause()
    }
    if (frames.length !== count) throw new Error('動画の全コマを読み込めませんでした')
    if (canvas) { canvas.width = 0; canvas = null }
    let audio_bytes: ArrayBuffer | null = null
    if (audio) {
      let rate = 0, channel_count = 0, length = 0
      let header: DataView | null = null
      const audio_sink = new AudioSampleSink(audio)
      let decoded = 0
      for await (const sample of audio_sink.samples(origin, end)) {
        try {
          if (!header) {
            rate = sample.sampleRate; channel_count = sample.numberOfChannels
            if (!Number.isInteger(rate) || rate < 1 || !Number.isInteger(channel_count) || channel_count < 1 || channel_count > 32) throw new Error('動画の音声形式を取得できません')
            length = Math.ceil(count / fps * rate)
            const size = length * channel_count * 2
            if (size > 0xffffffff - 36) throw new Error('動画の音声がノートで扱える範囲を超えます')
            memory_check(packed_bytes + count * 128 + size * 3, work_budget)
            audio_bytes = new ArrayBuffer(44 + size)
            header = new DataView(audio_bytes)
            const bytes = new Uint8Array(audio_bytes)
            bytes.set(new TextEncoder().encode('RIFF'), 0); bytes.set(new TextEncoder().encode('WAVEfmt '), 8); bytes.set(new TextEncoder().encode('data'), 36)
            header.setUint32(4, size + 36, true); header.setUint32(16, 16, true); header.setUint16(20, 1, true)
            header.setUint16(22, channel_count, true); header.setUint32(24, rate, true); header.setUint32(28, rate * channel_count * 2, true)
            header.setUint16(32, channel_count * 2, true); header.setUint16(34, 16, true); header.setUint32(40, size, true)
          }
          if (sample.sampleRate !== rate || sample.numberOfChannels !== channel_count) throw new Error('動画の途中で音声形式が変わりました')
          const offset = Math.round((sample.timestamp - origin) * rate)
          const start = Math.max(0, -offset), stop = Math.min(sample.numberOfFrames, length - offset)
          const plane = new Float32Array(sample.numberOfFrames)
          for (let c = 0; c < channel_count; c++) {
            sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' })
            for (let i = start; i < stop; i++) {
              const value = Math.max(-1, Math.min(1, plane[i]))
              header.setInt16(44 + ((offset + i) * channel_count + c) * 2, value < 0 ? value * 32768 : value * 32767, true)
            }
          }
          decoded++
          progress(0.75 + Math.min(1, (sample.timestamp + sample.duration - origin) / duration) * 0.24)
        } finally { sample.close() }
        await pause()
      }
      if (!decoded) throw new Error('動画の音声を読み込めませんでした。取り込みを中止しました')
    }
    const slots: loaded_project_t['slots'] = []
    for (let i = 0; i < 6; i++) slots.push({ name: i === 0 && audio_bytes ? file.name : '', bytes: i === 0 ? audio_bytes : null })
    progress(1)
    return {
      meta: note_meta_zero(), w, h, fps, loop: 0, pal_mode: mode_pal(mode),
      name: file.name.replace(/\.[^.]+$/, '').slice(0, 40), ratio: native ? geometry.ratio : 'free', res: native ? geometry.res : 'free', paper,
      lvis: new Uint8Array(l_base_n).fill(1), lalpha: new Uint8Array(l_base_n).fill(255), lord: [1, 2, 3],
      mode, anim: anim_fx_zero(), bgm_vol: 1, bgm_fps: audio_bytes ? fps : 0, se_vol: 1,
      frames, cur: 0, loop_a: -1, loop_b: -1, slots,
    }
  } finally {
    if (canvas) canvas.width = 0
    input.dispose()
  }
}
