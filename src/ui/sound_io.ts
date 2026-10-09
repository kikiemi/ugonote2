import { snd_buf_set } from '../engine'
import { snd_apply_vol, snd_decode, snd_load_epoch, snd_preset_buffer, snd_preset_bytes, snd_record_stop } from '../snd'
import { dispatch } from '../state/commands/index'

export type SndLoadTicket = Readonly<{ kind: string, epoch: number, seq: number }>

const loadSeq = new Map<string, number>()

function seq_next(kind: string): number {
  const seq = (loadSeq.get(kind) || 0) + 1
  loadSeq.set(kind, seq)
  return seq
}

function ticket_current(ticket: SndLoadTicket): boolean {
  return ticket.epoch === snd_load_epoch() && ticket.seq === loadSeq.get(ticket.kind)
}

export function snd_load_begin(kind: string): SndLoadTicket {
  return { kind, epoch: snd_load_epoch(), seq: seq_next(kind) }
}

export function snd_load_bytes(kind: string, bytes: ArrayBuffer, name: string, cb: (err: number) => void, ticket = snd_load_begin(kind)): void {
  if (ticket.kind !== kind || !ticket_current(ticket)) {
    cb(1)
    return
  }
  snd_decode(bytes, buf => {
    if (!ticket_current(ticket)) {
      cb(1)
      return
    }
    if (!buf || dispatch('snd.slot_apply', { kind, bytes, name }) < 0) {
      cb(-1)
      return
    }
    snd_buf_set(kind, buf)
    cb(0)
  })
}

export function snd_clear(kind: string): void {
  seq_next(kind)
  if (dispatch('snd.slot_clear', kind) < 0) return
  snd_buf_set(kind, null)
}

export function snd_assign_preset(seIdx: number, name: string): void {
  const kind = 'se' + seIdx
  seq_next(kind)
  const buf = snd_preset_buffer(name)
  if (!buf) return
  if (dispatch('snd.slot_apply', { kind, bytes: snd_preset_bytes(name), name }) < 0) return
  snd_buf_set(kind, buf)
}

export function snd_record_finish(kind: string, name: string, cb: (err: number) => void): void {
  const ticket = snd_load_begin(kind)
  snd_record_stop(bytes => {
    if (!bytes) {
      cb(-1)
      return
    }
    snd_load_bytes(kind, bytes, name, cb, ticket)
  })
}

export function snd_vol_set(kind: string, v: number): void {
  const val = Math.max(0, Math.min(1, v))
  if (kind === 'bgm') dispatch('snd.set_bgm_vol', val)
  else dispatch('snd.set_se_vol', val)
  snd_apply_vol()
}
