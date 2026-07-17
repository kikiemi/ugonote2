import { report_warning } from './diagnostics'
import { snd_buf, snd_buf_set } from './engine'
import { wav_encode, clamp } from './lib'
import { pref_uisfx } from './prefs'
import { st } from './state/store'

const AC: (new () => AudioContext) | null =
  typeof AudioContext !== 'undefined' ? AudioContext :
  typeof (globalThis as { webkitAudioContext?: new () => AudioContext }).webkitAudioContext !== 'undefined' ? (globalThis as { webkitAudioContext?: new () => AudioContext }).webkitAudioContext as new () => AudioContext :
  null

export function snd_ok(): number {
  return AC ? 1 : 0
}

export function snd_load_epoch(): number {
  return loadEpoch
}

export function snd_load_epoch_bump(): void {
  loadEpoch = (loadEpoch + 1) >>> 0
  restoreSeq++
}

let ac: AudioContext | null = null
let bgmGain: GainNode | null = null
let seGain: GainNode | null = null
let uiGain: GainNode | null = null
let liveSources: AudioBufferSourceNode[] = []
let recStream: MediaStream | null = null
let recRec: MediaRecorder | null = null
let recStarting = 0
const uiCache: Map<string, AudioBuffer> = new Map()
let restoreSeq = 0
let loadEpoch = 0

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
  if (!AC) throw new Error('Web Audio API is not available')
  if (!ac) {
    let context: AudioContext | null = null
    try {
      context = new AC()
      const nextBgmGain = context.createGain()
      const nextSeGain = context.createGain()
      const nextUiGain = context.createGain()
      nextBgmGain.connect(context.destination)
      nextSeGain.connect(context.destination)
      nextUiGain.connect(context.destination)
      nextUiGain.gain.value = 0.35
      ac = context
      bgmGain = nextBgmGain
      seGain = nextSeGain
      uiGain = nextUiGain
      snd_apply_vol()
    } catch (error) {
      if (context) void context.close().catch(() => {})
      throw error
    }
  }
  if (ac.state === 'suspended') {
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
  if (bgmGain) bgmGain.gain.value = g.snd.bgmVol
  if (seGain) seGain.gain.value = g.snd.seVol
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
  const R = () => Math.sin(Math.random() * 9999) * 2 - 1
  if (name === 'coin') return synth(rate, 0.35, t => 0.5 * sq(t, t < 0.08 ? 988 : 1319) * env(t, 0.35, 0.002, 2))
  if (name === 'jump') return synth(rate, 0.3, t => 0.5 * sq(t, 300 + t * 2200) * env(t, 0.3, 0.002, 1.5))
  if (name === 'hit') return synth(rate, 0.2, t => 0.7 * R() * env(t, 0.2, 0.001, 3) + 0.3 * Math.sin(t * 140 * Math.PI * 2) * env(t, 0.2, 0.001, 2))
  if (name === 'chime') return synth(rate, 0.9, t => 0.3 * (Math.sin(t * 880 * Math.PI * 2) + Math.sin(t * 1320 * Math.PI * 2) * 0.6 + Math.sin(t * 1760 * Math.PI * 2) * 0.4) * env(t, 0.9, 0.004, 2.5))
  if (name === 'blip') return synth(rate, 0.09, t => 0.5 * Math.sin(t * 1100 * Math.PI * 2) * env(t, 0.09, 0.002, 2))
  if (name === 'splash') return synth(rate, 0.5, t => 0.6 * R() * env(t, 0.5, 0.01, 2) * (0.4 + 0.6 * Math.sin(t * 60 * Math.PI * 2)))
  if (name === 'woosh') return synth(rate, 0.35, t => 0.5 * R() * Math.sin(Math.PI * (t / 0.35)) * Math.sin(t * (200 + 900 * t) * 0.02))
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
  if (!AC) {
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
  const base = g.snd.bgmFps
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
    liveSources.push(src)
    src.onended = () => {
      const i = liveSources.indexOf(src)
      if (i >= 0) liveSources.splice(i, 1)
    }
    return src
  } catch (error) {
    report_warning(context, error)
    return null
  }
}

export function snd_se_preview(i: number): void {
  if (!AC) return
  const buf = snd_buf('se' + i)
  if (!buf) return
  if (!seGain && !audio_context('効果音の再生を準備できませんでした')) return
  live_one_shot(buf, seGain as GainNode, 0, 0, 1, '効果音を試聴できませんでした')
}

export function snd_bgm_preview(i: number, on: number): void {
  if (!AC) return
  snd_stop_all()
  if (!on) return
  const buf = snd_buf('bgm' + i)
  if (!buf) return
  if (!audio_context('BGMの試聴を準備できませんでした')) return
  live_one_shot(buf, bgmGain as GainNode, 0, 0, 1, 'BGMを試聴できませんでした')
}

export function snd_play_start(off: number): void {
  if (!AC) return
  snd_stop_all()
  const cx = audio_context('BGMの再生を準備できませんでした')
  if (!cx) return
  const r = bgm_rate()
  for (let i = 0; i < 2; i++) {
    const buf = snd_buf('bgm' + i)
    if (!buf) continue
    const bo = off * r
    if (bo < buf.duration) live_one_shot(buf, bgmGain as GainNode, cx.currentTime, bo, r, 'BGMを再生できませんでした')
  }
}

export function snd_frame_tick(i: number): void {
  const g = st()
  if (!AC) return
  const f = g.doc.frames[i]
  if (!f || !f.se) return
  if (!seGain && !audio_context('コマ効果音の再生を準備できませんでした')) return
  for (let k = 0; k < 4; k++) {
    if (!(f.se & (1 << k))) continue
    const buf = snd_buf('se' + k)
    if (buf) live_one_shot(buf, seGain as GainNode, 0, 0, 1, 'コマ効果音を再生できませんでした')
  }
}

export function snd_stop_all(): void {
  const sources = liveSources
  liveSources = []
  for (const source of sources) stop_source(source)
}

export function snd_any_bgm(): number {
  return snd_buf('bgm0') || snd_buf('bgm1') ? 1 : 0
}

export function snd_any_se(): number {
  const g = st()
  for (const f of g.doc.frames) {
    if (!f.se) continue
    for (let k = 0; k < 4; k++) if (f.se & (1 << k) && snd_buf('se' + k)) return 1
  }
  return 0
}

export function snd_slot_pcm(kind: string): { pcm: Float32Array, rate: number } | null {
  const buffer = snd_buf(kind)
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels < 1) return null
  if (buffer.numberOfChannels === 1) return { pcm: buffer.getChannelData(0), rate: buffer.sampleRate }
  const pcm = new Float32Array(buffer.length)
  const channelGain = 1 / buffer.numberOfChannels
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel)
    for (let index = 0; index < pcm.length; index++) pcm[index] += source[index] * channelGain
  }
  return { pcm, rate: buffer.sampleRate }
}

export function snd_offline_mix(dur: number, tickTimes: number[], cb: (pcm: Float32Array | null, rate: number) => void): void {
  const rate = 44100
  let completed = 0
  const finish = (pcm: Float32Array | null): void => {
    if (completed) return
    completed = 1
    cb(pcm, rate)
  }
  const OAC =
    typeof OfflineAudioContext !== 'undefined'
      ? OfflineAudioContext
      : (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
  if (!OAC || !Number.isFinite(dur) || dur <= 0) {
    finish(null)
    return
  }

  try {
    const g = st()
    const cx = new OAC(1, Math.max(1, Math.ceil(dur * rate)), rate)
    const bg = cx.createGain()
    const sg = cx.createGain()
    bg.gain.value = g.snd.bgmVol
    sg.gain.value = g.snd.seVol
    bg.connect(cx.destination)
    sg.connect(cx.destination)
    let any = 0
    const playbackRate = bgm_rate()
    for (let i = 0; i < 2; i++) {
      const buf = snd_buf('bgm' + i)
      if (!buf) continue
      const src = cx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = playbackRate
      src.connect(bg)
      src.start(0, 0, Math.min(buf.duration, dur * playbackRate))
      any = 1
    }
    for (let i = 0; i < g.doc.frames.length && i < tickTimes.length; i++) {
      const frame = g.doc.frames[i]
      if (!frame || !frame.se) continue
      const startTime = clamp(tickTimes[i], 0, dur)
      for (let slot = 0; slot < 4; slot++) {
        if (!(frame.se & (1 << slot))) continue
        const buf = snd_buf('se' + slot)
        if (!buf) continue
        const src = cx.createBufferSource()
        src.buffer = buf
        src.connect(sg)
        src.start(startTime, 0)
        any = 1
      }
    }
    if (!any) {
      finish(null)
      return
    }
    cx.startRendering().then(
      buffer => finish(buffer.getChannelData(0)),
      error => {
        report_warning('音声のオフライン合成に失敗しました', error)
        finish(null)
      }
    )
  } catch (error) {
    report_warning('音声のオフライン合成を準備できませんでした', error)
    finish(null)
  }
}

export type SoundExportDestination = {
  node: MediaStreamAudioDestinationNode
  begin: () => number
  end: () => void
}

export function snd_export_dest(tickTimes: number[], totalDur: number): SoundExportDestination | null {
  const g = st()
  const cx = audio_context('動画書き出し用のAudioContextを準備できませんでした')
  if (!cx) return null
  try {
    const dest = cx.createMediaStreamDestination()
    const bg = cx.createGain()
    const sg = cx.createGain()
    bg.gain.value = g.snd.bgmVol
    sg.gain.value = g.snd.seVol
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
      if (begun || ended) return 0
      begun = 1
      try {
        const startTime = cx.currentTime + 0.05
        const playbackRate = bgm_rate()
        for (let i = 0; i < 2; i++) {
          const buf = snd_buf('bgm' + i)
          if (!buf) continue
          const src = cx.createBufferSource()
          started.push(src)
          src.buffer = buf
          src.playbackRate.value = playbackRate
          src.connect(bg)
          src.start(startTime, 0, Math.min(buf.duration, totalDur * playbackRate))
        }
        for (let i = 0; i < g.doc.frames.length && i < tickTimes.length; i++) {
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
            src.start(startTime + tickTimes[i], 0)
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

export function snd_record_start(cb: (error: number) => void): void {
  if (!AC || recRec || recStarting) {
    cb(-1)
    return
  }
  if (!audio_context('録音用のAudioContextを準備できませんでした')) {
    cb(-1)
    return
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    cb(-1)
    return
  }

  recStarting = 1
  let request: Promise<MediaStream>
  try {
    request = navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (error) {
    recStarting = 0
    report_warning('マイクの利用を要求できませんでした', error)
    cb(-1)
    return
  }
  request.then(
    stream => {
      recStarting = 0
      let recorder: MediaRecorder
      try {
        recorder = new MediaRecorder(stream)
        recorder.start()
      } catch (error) {
        stop_stream(stream)
        report_warning('録音を開始できませんでした', error)
        cb(-1)
        return
      }
      recStream = stream
      recRec = recorder
      cb(0)
    },
    error => {
      recStarting = 0
      report_warning('マイクを開始できませんでした', error)
      cb(-1)
    }
  )
}

export function snd_record_stop(cb: (bytes: ArrayBuffer | null) => void): void {
  const recorder = recRec
  const stream = recStream
  if (!recorder) {
    cb(null)
    return
  }

  recRec = null
  recStream = null
  const chunks: Blob[] = []
  let completed = 0
  const finish = (bytes: ArrayBuffer | null): void => {
    if (completed) return
    completed = 1
    recorder.ondataavailable = null
    recorder.onstop = null
    recorder.onerror = null
    if (stream) stop_stream(stream)
    cb(bytes)
  }

  recorder.ondataavailable = event => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  recorder.onerror = event => {
    report_warning('録音中にエラーが発生しました', event.error || event)
    finish(null)
  }
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
    blob.arrayBuffer().then(
      buffer => finish(buffer),
      error => {
        report_warning('録音データを読み出せませんでした', error)
        finish(null)
      }
    )
  }

  try {
    recorder.stop()
  } catch (error) {
    report_warning('録音を停止できませんでした', error)
    finish(null)
  }
}

export function snd_recording(): number {
  return recRec ? 1 : 0
}

function ui_buf(name: string): AudioBuffer {
  const hit = uiCache.get(name)
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
  uiCache.set(name, buf)
  return buf
}

let scr: { src: AudioBufferSourceNode, bp: BiquadFilterNode, gain: GainNode } | null = null
let scrLastMove = 0
let scrIdleT: ReturnType<typeof setInterval> | 0 = 0
let noiseBuf: AudioBuffer | null = null

const SCRATCH_HZ: { [k: number]: number } = { 0: 1900, 1: 900, 2: 2600, 3: 650, 4: 1200, 5: 780, 6: 1500, 7: 1100, 8: 520, 9: 1400, 10: 2200, 11: 1000, 12: 850 }

export function scratch_start(brush: number, eraser: number): void {
  if (!pref_uisfx()) return
  if (!snd_ok()) return
  const c = audio_context('描画音のAudioContextを準備できませんでした')
  if (!c) return
  try {
    if (!noiseBuf) {
      const len = Math.floor(c.sampleRate * 0.4)
      noiseBuf = c.createBuffer(1, len, c.sampleRate)
      const d = noiseBuf.getChannelData(0)
      let last = 0
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1
        last = last * 0.6 + w * 0.4
        d[i] = last
      }
    }
    scratch_stop()
    const src = c.createBufferSource()
    src.buffer = noiseBuf
    src.loop = true
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = eraser ? 1400 : SCRATCH_HZ[brush] || 1200
    bp.Q.value = 1.1
    const gain = c.createGain()
    gain.gain.value = 0
    src.connect(bp)
    bp.connect(gain)
    gain.connect(c.destination)
    src.start()
    scr = { src, bp, gain }
    scrLastMove = performance.now()
    if (scrIdleT) clearInterval(scrIdleT)
    scrIdleT = setInterval(() => {
      if (!scr) return
      if (performance.now() - scrLastMove > 110) {
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
  scrLastMove = performance.now()
  try {
    const v = Math.min(0.16, speed * 0.012)
    scr.gain.gain.setTargetAtTime(v, c.currentTime, 0.03)
    scr.src.playbackRate.setTargetAtTime(1 + Math.min(1.2, speed * 0.04), c.currentTime, 0.05)
  } catch {
    scratch_stop()
  }
}

export function scratch_stop(): void {
  if (scrIdleT) {
    clearInterval(scrIdleT)
    scrIdleT = 0
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
  const seq = ++restoreSeq
  for (const k of kinds) {
    const sl = slot_of(k)
    snd_buf_set(k, null)
    const bytes = sl.bytes
    if (bytes) {
      snd_decode(bytes, buf => {
        if (seq === restoreSeq && slot_of(k).bytes === bytes && buf) snd_buf_set(k, buf)
      })
    }
  }
}

export function sfx_play(name: string): void {
  if (!pref_uisfx()) return
  if (!ac) return
  try {
    one_shot(ui_buf(name), uiGain as GainNode, 0, 0, 1)
  } catch {}
}

export function sfx_warm(): void {
  if (!AC) return
  audio_context('操作音のAudioContextを準備できませんでした')
}
