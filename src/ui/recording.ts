import { tr_line } from '../lang'
import { esc, ic, q, query, toast } from '../dom'
import { D_SOUND } from '../h'
import { snd_recording, snd_record_start, snd_record_stop, snd_record_message, snd_record_complete, snd_load_epoch, sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { anim_playing } from '../state/commands/play'
import { dirty, st } from '../state/store'
import { modal_close, modal_open } from './modal'
import { anim_play, anim_stop, anim_pending } from './playback'
import { drawer_set } from './overlay'
import { snd_record_finish } from './sound_io'

let recKind = ''
let recSync = 0
let recFinishing = 0
let recMonitor: ReturnType<typeof setInterval> | 0 = 0
let recSyncEpoch = 0

export function rec_toggle(kind: string): void {
  if (recFinishing) return
  if (recSync) {
    recsync_stop()
    return
  }
  if (snd_recording()) {
    if (recKind !== kind) {
      toast('べつのスロットで録音中だよ')
      return
    }
    recFinishing = 1
    snd_record_finish(kind, '録音 ' + new Date().toLocaleTimeString(), err => {
      recKind = ''
      recFinishing = 0
      dirty(D_SOUND)
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
    recKind = kind
    dirty(D_SOUND)
    toast('録音中…もういちど押すと止まるよ')
  })
}

function recsync_bar_close(): void {
  if (recMonitor) clearInterval(recMonitor)
  recMonitor = 0
  recSync = 0
  document.body.dataset.recordsync = '0'
  q('recordBar').hidden = true
}

export function recsync_stop(): void {
  if (!recSync || recFinishing) return
  if (recSyncEpoch !== snd_load_epoch()) {
    recsync_bar_close()
    snd_record_stop(() => {})
    recKind = ''
    dirty(D_SOUND)
    return
  }
  const kind = recKind
  recFinishing = 1
  anim_stop()
  recsync_bar_close()
  snd_record_finish(kind, 'アフレコ ' + new Date().toLocaleTimeString(), err => {
    recKind = ''
    recFinishing = 0
    dirty(D_SOUND)
    if (err <= 0) toast(err === 0 ? '録音を曲 ' + (Number(kind.slice(3)) + 1) + ' に保存しました' : (snd_record_message() || '録音を保存できませんでした。もう一度試してください。'))
  })
}

export function recsync_toggle(): void {
  if (recFinishing) return
  if (recSync) {
    recsync_stop()
    return
  }
  if (snd_recording()) {
    toast('音のスロットで録音中だよ。先にその録音を止めてね')
    return
  }
  const g = st()
  const preferred = g.snd.bgm[0].bytes ? 1 : 0
  const box = modal_open(
    '<div class="mhead">' + ic('mic') + '<span>再生しながら録音</span></div>' +
    '<p class="mbody">キャンバスを最初から最後まで再生しながら、マイクの音を録音します。</p>' +
    '<label class="mrow">保存先<select id="recSyncSlot">' + [0, 1].map(i => '<option value="bgm' + i + '"' + (i === preferred ? ' selected' : '') + '>曲 ' + (i + 1) + (g.snd.bgm[i].bytes ? '：' + esc(g.snd.bgm[i].name || '録音済み') + '（上書き）' : '（空き）') + '</option>').join('') + '</select></label>' +
    '<p class="mbody dim" id="recSyncNote">マイクの利用を許可してから、録音と再生を始めます。</p>' +
    '<div class="mrow end"><button class="mbtn" id="recSyncCancel">やめる</button><button class="mbtn primary" id="recSyncBegin">録音をはじめる</button></div>',
    1
  )
  query(box, '#recSyncCancel').addEventListener('click', () => modal_close())
  query(box, '#recSyncBegin').addEventListener('click', () => {
    const begin = query<HTMLButtonElement>(box, '#recSyncBegin')
    if (begin.disabled) return
    const kind = query<HTMLSelectElement>(box, '#recSyncSlot').value
    const epoch = snd_load_epoch()
    begin.disabled = true
    query(box, '#recSyncNote').textContent = tr_line('マイクを準備しています…')
    snd_record_start(err => {
      if (err !== 0) {
        if (!box.isConnected) return
        begin.disabled = false
        query(box, '#recSyncNote').textContent = snd_record_message() || 'マイクを使えませんでした。ブラウザのマイク設定を確認して、もう一度試してください。'
        return
      }
      if (!box.isConnected || epoch !== snd_load_epoch()) {
        snd_record_stop(() => {})
        return
      }
      recKind = kind
      recSync = 1
      recSyncEpoch = epoch
      modal_close()
      drawer_set(0)
      if (g.view.tlopen) dispatch('view.toggle_timeline', null)
      anim_stop()
      let played = 0
      anim_play({ full: true, once: true }, () => { played = 1 })
      document.body.dataset.recordsync = '1'
      q('recordBar').hidden = false
      q('recordTime').textContent = tr_line('録音中') + ' 0:00'
      const started = performance.now()
      recMonitor = setInterval(() => {
        if (recSyncEpoch !== snd_load_epoch()) {
          recsync_bar_close()
          snd_record_stop(() => {})
          recKind = ''
          dirty(D_SOUND)
          return
        }
        const seconds = Math.floor((performance.now() - started) / 1000)
        q('recordTime').textContent = tr_line('録音中') + ' ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
        if (snd_record_complete()) { recsync_stop(); return }
        if (anim_playing()) played = 1
        else if (played || (!anim_pending() && performance.now() - started > 2000)) recsync_stop()
      }, 50)
      dirty(D_SOUND)
    })
  })
}

export function rec_kind(): string {
  return recKind
}

