import { memory_check, memory_work_budget } from './memory'
import type { audio_mix_t } from './audio_mix'
import { timeline_index, type timeline_t } from './playback_clock'
import { report_warning } from './diagnostics'
import { snd_buf, snd_buf_set } from './engine'
import { wav_encode, clamp } from './lib'
import { pref_uisfx } from './prefs'
import { st } from './state/store'

const audio_context_ctor: (new () => AudioContext) | null =
  typeof AudioContext !== 'undefined' ? AudioContext :
  typeof (globalThis as { webkitAudioContext?: new () => AudioContext }).webkitAudioContext !== 'undefined' ? (globalThis as { webkitAudioContext?: new () => AudioContext }).webkitAudioContext as new () => AudioContext :
  null

export function snd_ok(): number {
  return audio_context_ctor ? 1 : 0
}

export function snd_load_epoch(): number {
  return load_epoch
}

export function snd_load_epoch_bump(): void {
  load_epoch = (load_epoch + 1) >>> 0
  restore_seq++
}

const decoded_audio = new WeakMap<ArrayBuffer, AudioBuffer>()
let ac: AudioContext | null = null
let bgm_gain: GainNode | null = null
let se_gain: GainNode | null = null
let ui_gain: GainNode | null = null
let live_sources: AudioBufferSourceNode[] = []
type recording_session_t = { recorder: MediaRecorder, stream: MediaStream, chunks: Blob[], done: boolean, bytes: ArrayBuffer | null, wait: ((bytes: ArrayBuffer | null) => void) | null }
let rec_session: recording_session_t | null = null
let rec_error = ''
let rec_starting = 0
const ui_cache: Map<string, AudioBuffer> = new Map()
let restore_seq = 0
let load_epoch = 0

function stop_source(source: AudioBufferSourceNode): void {
  try {
    source.stop()
  } catch {}
}

function stop_stream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop()
    } catch {}
  }
}

function disconnect_node(node: AudioNode): void {
  try {
    node.disconnect()
  } catch {}
}

function actx(): AudioContext {
  if (!audio_context_ctor) throw new Error('Web Audio API is not available')
  if (!ac) {
    let context: AudioContext | null = null
    try {
      context = new audio_context_ctor()
      const next_bgm_gain = context.createGain()
      const next_se_gain = context.createGain()
      const next_ui_gain = context.createGain()
      next_bgm_gain.connect(context.destination)
      next_se_gain.connect(context.destination)
      next_ui_gain.connect(context.destination)
      next_ui_gain.gain.value = 0.35
      ac = context
      bgm_gain = next_bgm_gain
      se_gain = next_se_gain
      ui_gain = next_ui_gain
      snd_apply_vol()
    } catch (error) {
      if (context) void context.close().catch(() => {})
      throw error
    }
  }
  if (ac.state !== 'running' && ac.state !== 'closed') {
    try {
      void ac.resume().catch(() => {})
    } catch {}
  }
  return ac
}

function audio_context(context: string): AudioContext | null {
  try {
    return actx()
  } catch (error) {
    report_warning(context, error)
    return null
  }
}

export function snd_apply_vol(): void {
  const g = st()
  if (bgm_gain) bgm_gain.gain.value = g.snd.bgm_vol
  if (se_gain) se_gain.gain.value = g.snd.se_vol
}

function synth(rate: number, dur: number, fn: (t: number, i: number) => number): Float32Array {
  const n = Math.floor(rate * dur)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = fn(i / rate, i)
  return out
}

function env(t: number, dur: number, a: number, pow: number): number {
  if (t < a) return t / a
  const d = (t - a) / Math.max(0.001, dur - a)
  return Math.pow(Math.max(0, 1 - d), pow)
}

function sq(t: number, f: number): number {
  return Math.sin(t * f * Math.PI * 2) > 0 ? 1 : -1
}

function preset_pcm(name: string, rate: number): Float32Array {
  const r = () => Math.sin(Math.random() * 9999) * 2 - 1
  if (name === 'coin') return synth(rate, 0.35, t => 0.5 * sq(t, t < 0.08 ? 988 : 1319) * env(t, 0.35, 0.002, 2))
  if (name === 'jump') return synth(rate, 0.3, t => 0.5 * sq(t, 300 + t * 2200) * env(t, 0.3, 0.002, 1.5))
  if (name === 'hit') return synth(rate, 0.2, t => 0.7 * r() * env(t, 0.2, 0.001, 3) + 0.3 * Math.sin(t * 140 * Math.PI * 2) * env(t, 0.2, 0.001, 2))
  if (name === 'chime') return synth(rate, 0.9, t => 0.3 * (Math.sin(t * 880 * Math.PI * 2) + Math.sin(t * 1320 * Math.PI * 2) * 0.6 + Math.sin(t * 1760 * Math.PI * 2) * 0.4) * env(t, 0.9, 0.004, 2.5))
  if (name === 'blip') return synth(rate, 0.09, t => 0.5 * Math.sin(t * 1100 * Math.PI * 2) * env(t, 0.09, 0.002, 2))
  if (name === 'splash') return synth(rate, 0.5, t => 0.6 * r() * env(t, 0.5, 0.01, 2) * (0.4 + 0.6 * Math.sin(t * 60 * Math.PI * 2)))
  if (name === 'woosh') return synth(rate, 0.35, t => 0.5 * r() * Math.sin(Math.PI * (t / 0.35)) * Math.sin(t * (200 + 900 * t) * 0.02))
  if (name === 'ding') return synth(rate, 0.7, t => 0.45 * Math.sin(t * 1568 * Math.PI * 2) * env(t, 0.7, 0.002, 3))
  if (name === 'buzz') return synth(rate, 0.4, t => 0.4 * sq(t, 110) * (0.7 + 0.3 * sq(t, 30)) * env(t, 0.4, 0.005, 1))
  if (name === 'zip') return synth(rate, 0.22, t => 0.45 * sq(t, 1800 - t * 6000) * env(t, 0.22, 0.002, 1.5))
  if (name === 'thud') return synth(rate, 0.3, t => 0.8 * Math.sin(t * (90 - t * 120) * Math.PI * 2) * env(t, 0.3, 0.002, 2.5))
  if (name === 'sparkle') return synth(rate, 0.6, t => 0.3 * Math.sin(t * (1200 + 800 * Math.sin(t * 21)) * Math.PI * 2) * env(t, 0.6, 0.003, 2))
  if (name === 'horn') return synth(rate, 0.55, t => 0.4 * (sq(t, 349) * 0.6 + sq(t, 523) * 0.4) * env(t, 0.55, 0.02, 1.2))
  return synth(rate, 0.15, t => 0.4 * Math.sin(t * 700 * Math.PI * 2) * env(t, 0.15, 0.002, 2))
}

export function snd_preset_buffer(name: string): AudioBuffer | null {
  const cx = audio_context('効果音プリセットを準備できませんでした')
  if (!cx) return null
  try {
    const rate = 22050
    const pcm = preset_pcm(name, rate)
    const buf = cx.createBuffer(1, pcm.length, rate)
    buf.getChannelData(0).set(pcm)
    return buf
  } catch (error) {
    report_warning('効果音プリセットを生成できませんでした', error)
    return null
  }
}

export function snd_preset_bytes(name: string): ArrayBuffer {
  const rate = 22050
  return wav_encode([preset_pcm(name, rate)], rate)
}

export function snd_decode(bytes: ArrayBuffer, cb: (buf: AudioBuffer | null) => void): void {
  const cached = decoded_audio.get(bytes)
  if (cached) { cb(cached); return }
  if (!audio_context_ctor) {
    cb(null)
    return
  }
  const cx = audio_context('音声デコーダーを準備できませんでした')
  if (!cx) {
    cb(null)
    return
  }
  let completed = 0
  const finish = (buffer: AudioBuffer | null): void => {
    if (completed) return
    completed = 1
    if (buffer) decoded_audio.set(bytes, buffer)
    cb(buffer)
  }
  try {
    cx.decodeAudioData(
      bytes.slice(0),
      buffer => finish(buffer),
      error => {
        report_warning('音声データをデコードできませんでした', error)
        finish(null)
      }
    )
  } catch (error) {
    report_warning('音声データのデコードを開始できませんでした', error)
    finish(null)
  }
}

function slot_of(kind: string) {
  const g = st()
  if (kind === 'bgm0') return g.snd.bgm[0]
  if (kind === 'bgm1') return g.snd.bgm[1]
  return g.snd.se[parseInt(kind.slice(2), 10) || 0]
}

export function bgm_rate(): number {
  const g = st()
  const base = g.snd.bgm_fps
  if (!base || !Number.isFinite(base)) return 1
  return clamp(g.doc.fps / base, 0.1, 8)
}

function one_shot(buf: AudioBuffer, dest: AudioNode, when: number, offset: number, rate: number): AudioBufferSourceNode {
  const cx = actx()
  const src = cx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = rate
  src.connect(dest)
  src.start(when, offset)
  return src
}

function live_one_shot(buf: AudioBuffer, dest: AudioNode, when: number, offset: number, rate: number, context: string): AudioBufferSourceNode | null {
  try {
    const src = one_shot(buf, dest, when, offset, rate)
    live_sources.push(src)
    src.onended = () => {
      const i = live_sources.indexOf(src)
      if (i >= 0) live_sources.splice(i, 1)
    }
    return src
  } catch (error) {
    report_warning(context, error)
    return null
  }
}

export function snd_se_preview(i: number): void {
  if (!audio_context_ctor) return
  const buf = snd_buf('se' + i)
  if (!buf) return
  if (!se_gain && !audio_context('効果音の再生を準備できませんでした')) return
  live_one_shot(buf, se_gain as GainNode, 0, 0, 1, '効果音を試聴できませんでした')
}

export function snd_bgm_preview(i: number, on: number): void {
  if (!audio_context_ctor) return
  snd_stop_all()
  if (!on) return
  const buf = snd_buf('bgm' + i)
  if (!buf) return
  if (!audio_context('BGMの試聴を準備できませんでした')) return
  live_one_shot(buf, bgm_gain as GainNode, 0, 0, 1, 'BGMを試聴できませんでした')
}

type sound_playback_t = { timeline: timeline_t, loop: number, offset: number, audio_origin: number, wall_origin: number, next_cycle: number, next_frame: number, scheduled: number, elapsed: number }
let playback: sound_playback_t | null = null

export function snd_play_start(off: number, timeline: timeline_t, loop: number, now: number): void {
  snd_stop_all()
  if (!audio_context_ctor) return
  let any = 0
  for (const name of ['bgm0', 'bgm1', 'se0', 'se1', 'se2', 'se3']) if (snd_buf(name)) any = 1
  if (!any) return
  const cx = audio_context('音声の再生を準備できませんでした')
  if (!cx) return
  playback = { timeline, loop, offset: off, audio_origin: cx.currentTime, wall_origin: now, next_cycle: 0, next_frame: timeline_index(timeline, off), scheduled: -1, elapsed: 0 }
  snd_play_schedule(0)
}

export function snd_play_elapsed(now: number): number | null {
  if (!playback || !ac) return null
  if (ac.state === 'closed') return Math.max(playback.elapsed, (now - playback.wall_origin) / 1000)
  if (ac.state !== 'running') return playback.elapsed
  const stamp = ac.getOutputTimestamp?.()
  const audio_now = stamp?.performanceTime && stamp.contextTime !== undefined && now - stamp.performanceTime < 200 ? stamp.contextTime + (now - stamp.performanceTime) / 1000 : ac.currentTime
  playback.elapsed = Math.max(playback.elapsed, audio_now - playback.audio_origin)
  return playback.elapsed
}

function schedule_bgm(when: number, offset: number, duration: number): void {
  if (!ac) return
  const rate = bgm_rate()
  for (let i = 0; i < 2; i++) {
    const buffer = snd_buf('bgm' + i)
    if (!buffer || offset * rate >= buffer.duration) continue
    const source = live_one_shot(buffer, bgm_gain as GainNode, when, offset * rate, rate, 'BGMを再生できませんでした')
    if (source) { try { source.stop(when + duration) } catch {} }
  }
}

export function snd_play_schedule(seconds: number): void {
  const p = playback
  if (!p || !ac || ac.state !== 'running' || !se_gain || !bgm_gain) return
  const absolute = p.offset + seconds
  const end = absolute + 3
  const timeline = p.timeline
  const cycle_now = p.loop ? Math.floor(absolute / timeline.duration) : 0
  if (!p.loop && absolute >= timeline.duration) return
  if (p.next_cycle < cycle_now || p.next_cycle === cycle_now && timeline.starts[p.next_frame - timeline.first] + cycle_now * timeline.duration < absolute - 0.05) {
    p.next_cycle = cycle_now
    p.next_frame = timeline_index(timeline, absolute - cycle_now * timeline.duration)
  }
  if (p.scheduled < cycle_now) {
    const position = absolute - cycle_now * timeline.duration
    schedule_bgm(ac.currentTime, position, timeline.duration - position)
    p.scheduled = cycle_now
  }
  let count = 0
  while (count++ < 512) {
    const time = p.next_cycle * timeline.duration + timeline.starts[p.next_frame - timeline.first]
    if (time > end || !p.loop && p.next_cycle > 0) break
    if (p.loop && p.next_frame === timeline.first && p.scheduled < p.next_cycle) {
      schedule_bgm(p.audio_origin + time - p.offset, 0, timeline.duration)
      p.scheduled = p.next_cycle
    }
    const when = p.audio_origin + time - p.offset
    if (time >= absolute - 0.05) {
      const frame = st().doc.frames[p.next_frame]
      for (let slot = 0; slot < 4; slot++) {
        if (!(frame.se & (1 << slot))) continue
        const buffer = snd_buf('se' + slot)
        if (buffer) live_one_shot(buffer, se_gain, Math.max(ac.currentTime, when), 0, 1, 'コマ効果音を再生できませんでした')
      }
    }
    p.next_frame++
    if (p.next_frame > timeline.last) {
      p.next_frame = timeline.first
      p.next_cycle++
    }
  }
}

export function snd_stop_all(): void {
  playback = null
  const sources = live_sources
  live_sources = []
  for (const source of sources) stop_source(source)
}

export function snd_slot_pcm(kind: string): { pcm: Float32Array, rate: number } | null {
  const buffer = snd_buf(kind)
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels < 1) return null
  if (buffer.numberOfChannels === 1) return { pcm: buffer.getChannelData(0), rate: buffer.sampleRate }
  const pcm = new Float32Array(buffer.length)
  const channel_gain = 1 / buffer.numberOfChannels
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel)
    for (let index = 0; index < pcm.length; index++) pcm[index] += source[index] * channel_gain
  }
  return { pcm, rate: buffer.sampleRate }
}

export function snd_mix_plan(dur: number, tick_times: number[]): audio_mix_t {
  if (!Number.isFinite(dur) || dur <= 0) throw new Error('音声の長さが正しくありません')
  const g = st(), tracks: audio_mix_t['tracks'] = []
  let bytes = 0
  const add = (kind: string, gain: number, speed: number, starts: number[]): void => {
    const buffer = snd_buf(kind)
    if (!buffer || !starts.length) return
    bytes += buffer.length * 4 * (buffer.numberOfChannels + Math.min(2, buffer.numberOfChannels))
    memory_check(bytes, memory_work_budget(g.mobile))
    const channels: Float32Array[] = []
    for (let channel = 0; channel < Math.min(2, buffer.numberOfChannels); channel++) channels.push(buffer.getChannelData(channel).slice())
    if (buffer.numberOfChannels === 4 || buffer.numberOfChannels === 6) {
      const surround_left = buffer.getChannelData(buffer.numberOfChannels === 4 ? 2 : 4)
      const surround_right = buffer.getChannelData(buffer.numberOfChannels === 4 ? 3 : 5)
      const center = buffer.numberOfChannels === 6 ? buffer.getChannelData(2) : null
      for (let i = 0; i < buffer.length; i++) {
        channels[0][i] = center ? channels[0][i] + Math.SQRT1_2 * (center[i] + surround_left[i]) : (channels[0][i] + surround_left[i]) * 0.5
        channels[1][i] = center ? channels[1][i] + Math.SQRT1_2 * (center[i] + surround_right[i]) : (channels[1][i] + surround_right[i]) * 0.5
      }
    }
    tracks.push({ channels, rate: buffer.sampleRate, gain, speed, starts })
  }
  for (let i = 0; i < 2; i++) add('bgm' + i, g.snd.bgm_vol, bgm_rate(), [0])
  for (let slot = 0; slot < 4; slot++) {
    const starts: number[] = []
    for (let i = 0; i < g.doc.frames.length && i < tick_times.length; i++) if (g.doc.frames[i].se & (1 << slot)) starts.push(tick_times[i])
    add('se' + slot, g.snd.se_vol, 1, starts)
  }
  return { rate: 44100, length: Math.ceil(dur * 44100), tracks }
}

export type sound_export_destination_t = {
  node: MediaStreamAudioDestinationNode
  begin: () => number
  end: () => void
}

export function snd_export_dest(tick_times: number[], total_dur: number): sound_export_destination_t | null {
  const g = st()
  const cx = audio_context('動画書き出し用のAudioContextを準備できませんでした')
  if (!cx) return null
  try {
    const dest = cx.createMediaStreamDestination()
    const bg = cx.createGain()
    const sg = cx.createGain()
    bg.gain.value = g.snd.bgm_vol
    sg.gain.value = g.snd.se_vol
    bg.connect(dest)
    sg.connect(dest)
    const started: AudioBufferSourceNode[] = []
    let begun = 0
    let ended = 0
    const end = (): void => {
      if (ended) return
      ended = 1
      while (started.length) stop_source(started.pop() as AudioBufferSourceNode)
      disconnect_node(bg)
      disconnect_node(sg)
    }
    const begin = (): number => {
      if (begun || ended || cx.state !== 'running') return 0
      begun = 1
      try {
        const start_time = cx.currentTime + 0.05
        const playback_rate = bgm_rate()
        for (let i = 0; i < 2; i++) {
          const buf = snd_buf('bgm' + i)
          if (!buf) continue
          const src = cx.createBufferSource()
          started.push(src)
          src.buffer = buf
          src.playbackRate.value = playback_rate
          src.connect(bg)
          src.start(start_time, 0, Math.min(buf.duration, total_dur * playback_rate))
        }
        for (let i = 0; i < g.doc.frames.length && i < tick_times.length; i++) {
          const frame = g.doc.frames[i]
          if (!frame || !frame.se) continue
          for (let slot = 0; slot < 4; slot++) {
            if (!(frame.se & (1 << slot))) continue
            const buf = snd_buf('se' + slot)
            if (!buf) continue
            const src = cx.createBufferSource()
            started.push(src)
            src.buffer = buf
            src.connect(sg)
            src.start(start_time + tick_times[i], 0)
          }
        }
        return 1
      } catch (error) {
        report_warning('動画書き出し用の音声を開始できませんでした', error)
        end()
        return 0
      }
    }
    return { node: dest, begin, end }
  } catch (error) {
    report_warning('動画書き出し用の音声経路を生成できませんでした', error)
    return null
  }
}

function recording_error(error: unknown): void {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  rec_error = name === 'NotAllowedError' || name === 'SecurityError' ? 'マイクの利用を許可してください。ブラウザのサイト設定で変更できます。' :
    name === 'NotFoundError' ? 'マイクが見つかりません。接続を確認してください。' :
    name === 'NotReadableError' ? 'マイクを使えません。ほかのアプリで使用中でないか確認してください。' :
    name === 'NotSupportedError' ? 'このブラウザの録音形式に対応していません。' : '録音を完了できませんでした。マイクの接続を確認して、もう一度試してください。'
}

function recording_finish(session: recording_session_t, bytes: ArrayBuffer | null): void {
  if (session.done) return
  session.done = true
  session.bytes = bytes
  session.recorder.ondataavailable = null
  session.recorder.onstop = null
  session.recorder.onerror = null
  stop_stream(session.stream)
  const callback = session.wait
  session.wait = null
  if (callback) callback(bytes)
}

export function snd_record_message(): string {
  return rec_error
}

export function snd_record_complete(): number {
  return rec_session?.done ? 1 : 0
}

export function snd_record_start(cb: (error: number) => void): void {
  if (rec_session || rec_starting) {
    rec_error = '録音の準備中、または録音中です。'
    cb(-1)
    return
  }
  rec_error = ''
  if (!audio_context_ctor || typeof MediaRecorder === 'undefined' || !audio_context('録音用のAudioContextを準備できませんでした')) {
    rec_error = 'このブラウザでは録音を使えません。'
    cb(-1)
    return
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    rec_error = 'この画面ではマイクを使えません。公開サイトをブラウザで開いてください。'
    cb(-1)
    return
  }
  rec_starting = 1
  let request: Promise<MediaStream>
  try {
    request = navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (error) {
    rec_starting = 0
    recording_error(error)
    report_warning('マイクの利用を要求できませんでした', error)
    cb(-1)
    return
  }
  request.then(stream => {
    rec_starting = 0
    let session: recording_session_t
    try {
      const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']
      const mime = typeof MediaRecorder.isTypeSupported === 'function' ? types.find(type => MediaRecorder.isTypeSupported(type)) : ''
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      session = { recorder, stream, chunks: [], done: false, bytes: null, wait: null }
      recorder.ondataavailable = event => { if (event.data.size) session.chunks.push(event.data) }
      recorder.onerror = event => {
        recording_error(event.error || event)
        report_warning('録音中にエラーが発生しました', event.error || event)
        recording_finish(session, null)
      }
      recorder.onstop = () => {
        const blob = new Blob(session.chunks, { type: recorder.mimeType || session.chunks[0]?.type || mime })
        if (!blob.size) {
          rec_error = '録音した音が空でした。少し長めに録音して、もう一度試してください。'
          recording_finish(session, null)
          return
        }
        blob.arrayBuffer().then(bytes => recording_finish(session, bytes), error => {
          recording_error(error)
          report_warning('録音データを読み出せませんでした', error)
          recording_finish(session, null)
        })
      }
      recorder.start(250)
    } catch (error) {
      stop_stream(stream)
      recording_error(error)
      report_warning('録音を開始できませんでした', error)
      cb(-1)
      return
    }
    rec_session = session
    cb(0)
  }, error => {
    rec_starting = 0
    recording_error(error)
    report_warning('マイクを開始できませんでした', error)
    cb(-1)
  })
}

export function snd_record_stop(cb: (bytes: ArrayBuffer | null) => void): void {
  const session = rec_session
  if (!session) {
    cb(null)
    return
  }
  rec_session = null
  if (session.done) {
    cb(session.bytes)
    return
  }
  session.wait = cb
  if (session.recorder.state === 'inactive') return
  try {
    session.recorder.stop()
  } catch (error) {
    recording_error(error)
    report_warning('録音を停止できませんでした', error)
    recording_finish(session, null)
  }
}

export function snd_recording(): number {
  return rec_session ? 1 : 0
}

function ui_buf(name: string): AudioBuffer {
  const hit = ui_cache.get(name)
  if (hit) return hit
  const cx = actx()
  const rate = 22050
  let pcm: Float32Array
  if (name === 'tap') pcm = synth(rate, 0.05, t => 0.5 * Math.sin(t * 1000 * Math.PI * 2) * env(t, 0.05, 0.002, 2))
  else if (name === 'pen') pcm = synth(rate, 0.05, t => 0.3 * (Math.sin(Math.random() * 99) * 2 - 1) * env(t, 0.05, 0.001, 3))
  else if (name === 'save') pcm = synth(rate, 0.28, t => 0.4 * Math.sin(t * (t < 0.12 ? 660 : 990) * Math.PI * 2) * env(t, 0.28, 0.003, 2))
  else if (name === 'del') pcm = synth(rate, 0.16, t => 0.4 * sq(t, 300 - t * 700) * env(t, 0.16, 0.002, 2))
  else if (name === 'dup') pcm = synth(rate, 0.16, t => 0.4 * Math.sin(t * (t < 0.07 ? 780 : 1040) * Math.PI * 2) * env(t, 0.16, 0.002, 2))
  else if (name === 'move') pcm = synth(rate, 0.12, t => 0.3 * (Math.sin(Math.random() * 99) * 2 - 1) * Math.sin(Math.PI * t / 0.12))
  else if (name === 'paper') pcm = synth(rate, 0.13, t => (0.10 * (Math.sin(Math.random() * 99) * 2 - 1) + 0.08 * Math.sin(t * 240 * Math.PI * 2)) * env(t, 0.13, 0.03, 2.2))
  else if (name === 'play') pcm = synth(rate, 0.22, t => 0.4 * Math.sin(t * (523 + Math.floor(t / 0.07) * 130) * Math.PI * 2) * env(t, 0.22, 0.003, 1.6))
  else if (name === 'stop') pcm = synth(rate, 0.14, t => 0.4 * Math.sin(t * 330 * Math.PI * 2) * env(t, 0.14, 0.002, 2))
  else pcm = synth(rate, 0.05, t => 0.35 * Math.sin(t * 900 * Math.PI * 2) * env(t, 0.05, 0.002, 2))
  const buf = cx.createBuffer(1, pcm.length, rate)
  buf.getChannelData(0).set(pcm)
  ui_cache.set(name, buf)
  return buf
}

let scr: { src: AudioBufferSourceNode, bp: BiquadFilterNode, gain: GainNode } | null = null
let scr_last_move = 0
let scr_idle_t: ReturnType<typeof setInterval> | 0 = 0
let noise_buf: AudioBuffer | null = null

const scratch_hz: { [k: number]: number } = { 0: 1900, 1: 900, 2: 2600, 3: 650, 4: 1200, 5: 780, 6: 1500, 7: 1100, 8: 520, 9: 1400, 10: 2200, 11: 1000, 12: 850 }

export function scratch_start(brush: number, eraser: number): void {
  if (!pref_uisfx()) return
  if (!snd_ok()) return
  const c = audio_context('描画音のAudioContextを準備できませんでした')
  if (!c) return
  try {
    if (!noise_buf) {
      const len = Math.floor(c.sampleRate * 0.4)
      noise_buf = c.createBuffer(1, len, c.sampleRate)
      const d = noise_buf.getChannelData(0)
      let last = 0
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1
        last = last * 0.6 + w * 0.4
        d[i] = last
      }
    }
    scratch_stop()
    const src = c.createBufferSource()
    src.buffer = noise_buf
    src.loop = true
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = eraser ? 1400 : scratch_hz[brush] || 1200
    bp.Q.value = 1.1
    const gain = c.createGain()
    gain.gain.value = 0
    src.connect(bp)
    bp.connect(gain)
    gain.connect(c.destination)
    src.start()
    scr = { src, bp, gain }
    scr_last_move = performance.now()
    if (scr_idle_t) clearInterval(scr_idle_t)
    scr_idle_t = setInterval(() => {
      if (!scr) return
      if (performance.now() - scr_last_move > 110) {
        try {
          const current = audio_context('描画音のAudioContextを再取得できませんでした')
          if (!current) {
            scratch_stop()
            return
          }
          scr.gain.gain.setTargetAtTime(0, current.currentTime, 0.04)
        } catch {
          scratch_stop()
        }
      }
    }, 70)
  } catch {
    scratch_stop()
  }
}

export function scratch_move(speed: number): void {
  if (!scr) return
  if (!pref_uisfx()) {
    scratch_stop()
    return
  }
  if (!snd_ok()) return
  const c = audio_context('描画音のAudioContextを再取得できませんでした')
  if (!c) return
  scr_last_move = performance.now()
  try {
    const v = Math.min(0.16, speed * 0.012)
    scr.gain.gain.setTargetAtTime(v, c.currentTime, 0.03)
    scr.src.playbackRate.setTargetAtTime(1 + Math.min(1.2, speed * 0.04), c.currentTime, 0.05)
  } catch {
    scratch_stop()
  }
}

export function scratch_stop(): void {
  if (scr_idle_t) {
    clearInterval(scr_idle_t)
    scr_idle_t = 0
  }
  if (!scr) return
  const current = scr
  scr = null
  const context = ac && ac.state !== 'closed' ? ac : null
  try {
    if (context) current.gain.gain.setTargetAtTime(0, context.currentTime, 0.03)
  } catch {}
  setTimeout(() => stop_source(current.src), 120)
}

export function snd_restore_slots(): void {
  const kinds = ['bgm0', 'bgm1', 'se0', 'se1', 'se2', 'se3']
  const seq = ++restore_seq
  for (const k of kinds) {
    const sl = slot_of(k)
    snd_buf_set(k, null)
    const bytes = sl.bytes
    if (bytes) {
      snd_decode(bytes, buf => {
        if (seq === restore_seq && slot_of(k).bytes === bytes && buf) snd_buf_set(k, buf)
      })
    }
  }
}

export function sfx_play(name: string): void {
  if (!pref_uisfx()) return
  if (!audio_context('操作音のAudioContextを準備できませんでした')) return
  try {
    one_shot(ui_buf(name), ui_gain as GainNode, 0, 0, 1)
  } catch {}
}

export function sfx_warm(): void {
  if (!audio_context_ctor) return
  audio_context('操作音のAudioContextを準備できませんでした')
}
export function snd_ready(cb: () => void): void {
  const cx = audio_context('再生用のAudioContextを準備できませんでした')
  if (!cx || cx.state === 'running') {
    cb()
    return
  }
  try {
    cx.resume().then(cb, error => {
      report_warning('再生用のAudioContextを再開できませんでした', error)
      cb()
    })
  } catch (error) {
    report_warning('再生用のAudioContextを再開できませんでした', error)
    cb()
  }
}
if (typeof document !== 'undefined') {
  const unlock = (): void => {
    if (ac && ac.state !== 'running') sfx_warm()
  }
  document.addEventListener('touchend', unlock, { capture: true, passive: true })
  document.addEventListener('pointerup', unlock, { capture: true, passive: true })
  document.addEventListener('keydown', unlock, { capture: true })
}
