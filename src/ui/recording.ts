import { tr_line } from '../lang'
import { esc, ic, q, query, toast } from '../dom'
import { d_sound } from '../h'
import { snd_recording, snd_record_start, snd_record_stop, snd_record_message, snd_record_complete, snd_load_epoch, sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { anim_playing } from '../state/commands/play'
import { dirty, st } from '../state/store'
import { modal_close, modal_open } from './modal'
import { anim_play, anim_stop, anim_pending } from './playback'
import { drawer_set } from './overlay'
import { snd_record_finish } from './sound_io'

let recording_kind = ''
let rec_sync = 0
let rec_finishing = 0
let rec_monitor: ReturnType<typeof setInterval> | 0 = 0
let rec_sync_epoch = 0

export function rec_toggle(kind: string): void {
  if (rec_finishing) return
  if (rec_sync) {
    recsync_stop()
    return
  }
  if (snd_recording()) {
    if (recording_kind !== kind) {
      toast('べつのスロットで録音中だよ')
      return
    }
    rec_finishing = 1
    snd_record_finish(kind, '録音 ' + new Date().toLocaleTimeString(), err => {
      recording_kind = ''
      rec_finishing = 0
      dirty(d_sound)
      if (err <= 0) toast(err === 0 ? '録音を保存しました' : (snd_record_message() || '録音を保存できませんでした。もう一度試してください。'))
      if (err === 0) sfx_play('save')
    })
    return
  }
  snd_record_start(err => {
    if (err !== 0) {
      toast(snd_record_message() || 'マイクを使えませんでした')
      return
    }
    recording_kind = kind
    dirty(d_sound)
    toast('録音中…もういちど押すと止まるよ')
  })
}

function recsync_bar_close(): void {
  if (rec_monitor) clearInterval(rec_monitor)
  rec_monitor = 0
  rec_sync = 0
  document.body.dataset.recordsync = '0'
  q('record_bar').hidden = true
}

export function recsync_stop(): void {
  if (!rec_sync || rec_finishing) return
  if (rec_sync_epoch !== snd_load_epoch()) {
    recsync_bar_close()
    snd_record_stop(() => {})
    recording_kind = ''
    dirty(d_sound)
    return
  }
  const kind = recording_kind
  rec_finishing = 1
  anim_stop()
  recsync_bar_close()
  snd_record_finish(kind, 'アフレコ ' + new Date().toLocaleTimeString(), err => {
    recording_kind = ''
    rec_finishing = 0
    dirty(d_sound)
    if (err <= 0) toast(err === 0 ? '録音を曲 ' + (Number(kind.slice(3)) + 1) + ' に保存しました' : (snd_record_message() || '録音を保存できませんでした。もう一度試してください。'))
  })
}

export function recsync_toggle(): void {
  if (rec_finishing) return
  if (rec_sync) {
    recsync_stop()
    return
  }
  if (snd_recording()) {
    toast('音のスロットで録音中だよ。先にその録音を止めてね')
    return
  }
  const g = st()
  const preferred = g.snd.bgm[0].bytes ? 1 : 0
  let slots = ''
  for (let i = 0; i < 2; i++) {
    const track = g.snd.bgm[i]
    slots += '<option value="bgm' + i + '"' + (i === preferred ? ' selected' : '') + '>曲 ' + (i + 1) + (track.bytes ? '：' + esc(track.name || '録音済み') + '（上書き）' : '（空き）') + '</option>'
  }
  const box = modal_open(
    '<div class="mhead">' + ic('mic') + '<span>再生しながら録音</span></div>' +
    '<div class="opt_row"><label class="plab" for="rec_sync_slot">保存先</label><select id="rec_sync_slot">' + slots + '</select></div>' +
    '<p class="mbody dim" id="rec_sync_note">マイクの利用を許可してから、録音と再生を始めます。</p>' +
    '<div class="mrow end"><button class="pbtn" id="rec_sync_cancel">やめる</button><button class="pbtn primary" id="rec_sync_begin">録音をはじめる</button></div>',
    1
  )
  query(box, '#rec_sync_cancel').addEventListener('click', () => modal_close())
  query(box, '#rec_sync_begin').addEventListener('click', () => {
    const begin = query<HTMLButtonElement>(box, '#rec_sync_begin')
    if (begin.disabled) return
    const kind = query<HTMLSelectElement>(box, '#rec_sync_slot').value
    const epoch = snd_load_epoch()
    begin.disabled = true
    query(box, '#rec_sync_note').textContent = tr_line('マイクを準備しています…')
    snd_record_start(err => {
      if (err !== 0) {
        if (!box.isConnected) return
        begin.disabled = false
        query(box, '#rec_sync_note').textContent = snd_record_message() || 'マイクを使えませんでした。ブラウザのマイク設定を確認して、もう一度試してください。'
        return
      }
      if (!box.isConnected || epoch !== snd_load_epoch()) {
        snd_record_stop(() => {})
        return
      }
      recording_kind = kind
      rec_sync = 1
      rec_sync_epoch = epoch
      modal_close()
      drawer_set(0)
      if (g.view.tlopen) dispatch('view.toggle_timeline', null)
      anim_stop()
      let played = 0
      anim_play({ full: true, once: true }, () => { played = 1 })
      document.body.dataset.recordsync = '1'
      q('record_bar').hidden = false
      q('record_time').textContent = tr_line('録音中') + ' 0:00'
      const started = performance.now()
      rec_monitor = setInterval(() => {
        if (rec_sync_epoch !== snd_load_epoch()) {
          recsync_bar_close()
          snd_record_stop(() => {})
          recording_kind = ''
          dirty(d_sound)
          return
        }
        const seconds = Math.floor((performance.now() - started) / 1000)
        q('record_time').textContent = tr_line('録音中') + ' ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
        if (snd_record_complete()) { recsync_stop(); return }
        if (anim_playing()) played = 1
        else if (played || (!anim_pending() && performance.now() - started > 2000)) recsync_stop()
      }, 50)
      dirty(d_sound)
    })
  })
}

export function rec_kind(): string {
  return recording_kind
}

