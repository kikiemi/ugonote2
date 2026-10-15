import { pixel_source_collect, pixel_source_restore, pixel_source_packets, type pixel_source_asset_t } from './pixel_source'
import { database_ready, database_open, database_transaction, database_abort, database_event_error, database_read, database_write } from './database'
import { kwz_frame_meta_clone, type kwz_frame_meta_t } from './codec/kwzmeta'
import { report_warning } from './diagnostics'
import { frame_id_seed } from './doc'
import { bytes_rle, fmt_parse, fmt_snapshot, rle_bytes, type loaded_project_t } from './fmt'
import { autosave_ms, d_save, l_n, anim_fx_zero, type anim_fx_t, type frame_t, type note_meta_t, type rle_t } from './h'
import { canvas_to_blob } from './lib'
import { dispatch } from './state/commands/index'
import { dirty, st, store_hook } from './state/store'
import { thumb_get } from './thumb'
import { build_ugn2_async } from './workercli'

let project_dirty = 0
let dirty_seq = 0

export function proj_dirty(): number {
  return project_dirty
}

const st_proj = 'proj'
const st_auto = 'auto'

export type slot_row_t = { key: string, name: string, ts: number, thumb: Blob | null, size: number }

let save_state = 0
let backoff = 2000
let retry_t: ReturnType<typeof setTimeout> | 0 = 0
let blink_t: ReturnType<typeof setTimeout> | 0 = 0
let blink = 0

export function store_state(): number {
  return save_state
}

export function store_blink(): number {
  return blink
}

function blink_once(): void {
  blink = 1
  dirty(d_save)
  if (blink_t) clearTimeout(blink_t)
  blink_t = setTimeout(() => {
    blink = 0
    blink_t = 0
    dirty(d_save)
  }, 900)
}

const frame_blob_magic = 0x3352594c

function frame_blob(f: { readonly pk: readonly (rle_t | null)[] }): Blob {
  const bytes: Uint8Array[] = []
  let total = 5
  for (let layer = 0; layer < l_n; layer++) {
    const packed = f.pk[layer]
    const data = packed ? rle_bytes(packed) : new Uint8Array(0)
    bytes.push(data)
    total += 4 + data.length
  }
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, frame_blob_magic, true)
  out[4] = l_n
  let offset = 5
  for (const data of bytes) {
    view.setUint32(offset, data.length, true)
    offset += 4
    out.set(data, offset)
    offset += data.length
  }
  return new Blob([out])
}

function frame_from_bytes(bytes: Uint8Array): (rle_t | null)[] {
  const out = new Array<rle_t | null>(l_n).fill(null)
  if (bytes.length < 4) return out
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  let count = 4
  if (view.getUint32(0, true) === frame_blob_magic) {
    if (bytes.length < 5) return out
    count = bytes[4]
    offset = 5
  }
  for (let layer = 0; layer < count; layer++) {
    if (offset + 4 > bytes.length) break
    const length = view.getUint32(offset, true)
    offset += 4
    if (length > bytes.length - offset || (length & 3) !== 0) break
    if (length && layer < l_n) out[layer] = bytes_rle(bytes.subarray(offset, offset + length))
    offset += length
  }
  return out
}

type auto_meta_t = {
  sources?: pixel_source_asset_t[]
  name: string
  ts: number
  w: number
  h: number
  fps: number
  loop: number
  pal_mode: number
  ratio: string
  res: string
  paper: string
  lvis: number[]
  lalpha: number[]
  lord: number[]
  mode: number
  anim: anim_fx_t
  bgm_vol: number
  bgm_fps: number
  se_vol: number
  cur: number
  loop_a: number
  loop_b: number
  frames: { id: number, se: number, hold: number, paper?: string, kwz?: kwz_frame_meta_t }[]
  meta: note_meta_t
}

const saved_pk = new WeakMap<object, (rle_t | null)[]>()
const saved_snd = new Map<string, ArrayBuffer | null>()
let saved_ids: number[] = []
const snd_kinds = ['bgm0', 'bgm1', 'se0', 'se1', 'se2', 'se3']

function snd_of(kind: string): { bytes: ArrayBuffer | null, name: string } {
  const g = st()
  if (kind === 'bgm0') return g.snd.bgm[0]
  if (kind === 'bgm1') return g.snd.bgm[1]
  return g.snd.se[parseInt(kind.slice(2), 10) || 0]
}

function pk_same(a: readonly (rle_t | null)[] | undefined, f: { readonly pk: readonly (rle_t | null)[] }): number {
  if (!a) return 0
  if (a.length !== f.pk.length) return 0
  for (let layer = 0; layer < f.pk.length; layer++) if (a[layer] !== f.pk[layer]) return 0
  return 1
}

export function store_save_auto(): void {
  const g = st()
  if (!g.booted) return
  if (save_state === 1) return
  save_state = 1
  dirty(d_save)
  const seq_at_start = dirty_seq

  const meta: auto_meta_t = {
    sources: pixel_source_collect(g.doc.frames).map(({ id, file }) => ({ id, file })),
    name: g.doc.name, ts: Date.now(),
    w: g.doc.w, h: g.doc.h, fps: g.doc.fps, loop: g.doc.loop, pal_mode: g.pen.pal_mode,
    ratio: g.doc.ratio, res: g.doc.res, paper: g.doc.paper,
    lvis: [...g.doc.lvis], lalpha: [...g.doc.lalpha], lord: [...g.doc.lord],
    mode: g.doc.mode, anim: { ...g.doc.anim }, bgm_vol: g.snd.bgm_vol, bgm_fps: g.snd.bgm_fps, se_vol: g.snd.se_vol,
    cur: g.doc.cur, loop_a: g.doc.loop_a, loop_b: g.doc.loop_b,
    frames: g.doc.frames.map(f => ({ id: f.id, se: f.se, hold: f.hold, paper: f.paper, kwz: kwz_frame_meta_clone(f.kwz) })),
    meta: { ...g.doc.meta },
  }
  const changed: { id: number, blob: Blob, f: object, pk: (rle_t | null)[] }[] = []
  for (const f of g.doc.frames) {
    if (pk_same(saved_pk.get(f), f)) continue
    changed.push({ id: f.id, blob: frame_blob(f), f, pk: [...f.pk] as (rle_t | null)[] })
  }
  const ids = meta.frames.map(x => x.id)
  const id_set = new Set(ids)
  const gone = saved_ids.filter(id => !id_set.has(id))
  const snd_changed: { kind: string, name: string, bytes: ArrayBuffer | null, blob: Blob | null }[] = []
  for (const kind of snd_kinds) {
    const slot = snd_of(kind)
    if (saved_snd.get(kind) === slot.bytes) continue
    snd_changed.push({ kind, name: slot.name, bytes: slot.bytes, blob: slot.bytes ? new Blob([slot.bytes]) : null })
  }

  database_open(ok => {
    if (!ok || !database_ready()) {
      fail()
      return
    }
    const tx = database_transaction(st_auto, 'readwrite', '自動保存用トランザクションを開始できませんでした')
    if (!tx) {
      fail()
      return
    }
    let completed = 0
    const fail_transaction = (error: unknown): void => {
      if (completed) return
      completed = 1
      if (error) report_warning('自動保存の書き込みに失敗しました', error)
      fail()
    }
    try {
      const store = tx.objectStore(st_auto)
      store.put(meta, 'meta')
      for (const item of changed) store.put(item.blob, 'f' + item.id)
      for (const id of gone) store.delete('f' + id)
      for (const item of snd_changed) {
        if (item.blob) store.put({ name: item.name, blob: item.blob }, 's' + item.kind)
        else store.delete('s' + item.kind)
      }
    } catch (error) {
      database_abort(tx, '失敗した自動保存トランザクションを中止できませんでした')
      fail_transaction(error)
      return
    }
    tx.oncomplete = () => {
      if (completed) return
      completed = 1
      for (const item of changed) saved_pk.set(item.f, item.pk)
      for (const item of snd_changed) saved_snd.set(item.kind, item.bytes)
      saved_ids = ids
      save_state = 0
      backoff = 2000
      if (retry_t) {
        clearTimeout(retry_t)
        retry_t = 0
      }
      if (dirty_seq === seq_at_start) project_dirty = 0
      blink_once()
      dirty(d_save)
    }
    tx.onerror = event => fail_transaction(database_event_error(event))
    tx.onabort = event => fail_transaction(database_event_error(event))
  })

  function fail(): void {
    save_state = 2
    dirty(d_save)
    if (retry_t) clearTimeout(retry_t)
    retry_t = setTimeout(() => {
      retry_t = 0
      store_save_auto()
    }, backoff)
    backoff = Math.min(30000, backoff * 2)
  }
}

function mark_all_saved(): void {
  const g = st()
  for (const f of g.doc.frames) { if (pixel_source_packets(f).length) saved_pk.delete(f); else saved_pk.set(f, [...f.pk] as (rle_t | null)[]) }
  saved_ids = g.doc.frames.map(f => f.id)
  for (const k of snd_kinds) saved_snd.set(k, snd_of(k).bytes)
}

async function restore_auto(): Promise<number> {
  const meta = await new Promise<auto_meta_t | null>(res => database_read(st_auto, 'meta', v => res(v as auto_meta_t | null)))
  if (!meta || !meta.frames || !meta.frames.length) return 0
  if (!database_ready()) return 0
  const frames: frame_t[] = []
  let max_id = 0
  for (const fm of meta.frames) {
    const blob = await new Promise<Blob | null>(res => database_read(st_auto, 'f' + fm.id, v => res(v as Blob | null)))
    const pk = blob ? frame_from_bytes(new Uint8Array(await blob.arrayBuffer())) : new Array<rle_t | null>(l_n).fill(null)
    frames.push({ id: fm.id, se: fm.se, hold: fm.hold, paper: fm.paper, kwz: kwz_frame_meta_clone(fm.kwz), pk })
    if (fm.id > max_id) max_id = fm.id
  }
  pixel_source_restore(frames, meta.sources || [])
  frame_id_seed(max_id + 1)
  const slots: { name: string, bytes: ArrayBuffer | null }[] = []
  for (const k of snd_kinds) {
    const rec = await new Promise<{ name: string, blob: Blob } | null>(res => database_read(st_auto, 's' + k, v => res(v as { name: string, blob: Blob } | null)))
    slots.push(rec && rec.blob ? { name: rec.name, bytes: await rec.blob.arrayBuffer() } : { name: '', bytes: null })
  }
  const d: loaded_project_t = {
    meta: meta.meta,
    w: meta.w, h: meta.h, fps: meta.fps, loop: meta.loop, pal_mode: meta.pal_mode,
    name: meta.name, ratio: meta.ratio, res: meta.res, paper: meta.paper,
    lvis: new Uint8Array(meta.lvis), lalpha: new Uint8Array(meta.lalpha), lord: [...meta.lord],
    mode: meta.mode, anim: meta.anim || anim_fx_zero(), bgm_vol: meta.bgm_vol, bgm_fps: meta.bgm_fps, se_vol: meta.se_vol,
    frames, cur: meta.cur, loop_a: meta.loop_a, loop_b: meta.loop_b, slots,
  }
  if (dispatch('project.apply_loaded', d) < 0) return 0
  mark_all_saved()
  return 1
}

export function store_boot(cb: (loaded: number) => void): void {
  store_hook(() => store_save_auto(), autosave_ms, () => {
    project_dirty = 1
    dirty_seq++
    dirty(d_save)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && project_dirty) store_save_auto()
  })
  restore_auto()
    .then(loaded => {
      if (loaded) {
        cb(1)
        return
      }
      database_read(st_proj, 'auto', val => {
        const rec = val as { bytes?: ArrayBuffer } | null
        if (!rec || !rec.bytes) {
          cb(0)
          return
        }
        const d = fmt_parse(new Uint8Array(rec.bytes))
        if (!d) {
          cb(0)
          return
        }
        if (dispatch('project.apply_loaded', d) < 0) {
          cb(0)
          return
        }
        mark_all_saved()
        cb(1)
      })
    })
    .catch(error => {
      report_warning('自動保存データの復元に失敗しました', error)
      cb(0)
    })
}

function thumb_blob(cb: (blob: Blob | null) => void): void {
  const canvas = thumb_get(st().doc.cur)
  if (!canvas) {
    cb(null)
    return
  }
  canvas_to_blob(canvas, 'image/png', undefined, (blob, error) => {
    if (!blob) report_warning('サムネイル画像を作成できませんでした', error)
    cb(blob)
  })
}

export function store_save_slot(index: number, cb: (ok: number) => void): void {
  if (!Number.isInteger(index) || index < 0 || index >= 8) {
    cb(0)
    return
  }
  const snap = fmt_snapshot()
  thumb_blob(thumb => {
    build_ugn2_async(snap, bytes => {
      if (!bytes) {
        cb(0)
        return
      }
      const blob = bytes instanceof Blob ? bytes : new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer])
      const record = { name: snap.name, ts: Date.now(), thumb, blob }
      database_write(st_proj, '保存スロットへ書き込めませんでした', store => store.put(record, 'slot' + index), ok => {
        if (ok) blink_once()
        cb(ok)
      })
    })
  })
}

export function store_export_ugn2(cb: (bytes: Uint8Array | Blob | null) => void): void {
  build_ugn2_async(fmt_snapshot(), cb)
}

export function store_load_key(key: string, cb: (err: number) => void): void {
  if (key === 'auto') {
    restore_auto().then(
      loaded => cb(loaded ? 0 : -1),
      error => {
        report_warning('自動保存データを読み込めませんでした', error)
        cb(-1)
      }
    )
    return
  }
  database_read(st_proj, key, value => {
    const record = value as { bytes?: ArrayBuffer, blob?: Blob } | null
    const apply = (buffer: ArrayBuffer | null): void => {
      if (!buffer) {
        cb(-1)
        return
      }
      const project = fmt_parse(new Uint8Array(buffer))
      if (!project || dispatch('project.apply_loaded', project) < 0) {
        cb(-1)
        return
      }
      mark_all_saved()
      cb(0)
    }
    if (!record || !record.blob) {
      apply(record && record.bytes ? record.bytes : null)
      return
    }
    record.blob.arrayBuffer().then(
      apply,
      error => {
        report_warning('保存スロットのデータを読み出せませんでした: ' + key, error)
        cb(-1)
      }
    )
  })
}

export function store_delete(key: string, cb: (ok: number) => void): void {
  database_write(st_proj, '保存スロットを削除できませんでした', store => store.delete(key), cb)
}

function list_project_rows(rows: slot_row_t[], cb: (rows: slot_row_t[]) => void): void {
  const tx = database_transaction(st_proj, 'readonly', '保存スロットの一覧取得を開始できませんでした')
  if (!tx) {
    cb(rows)
    return
  }
  let completed = 0
  const finish = (error?: unknown): void => {
    if (completed) return
    completed = 1
    if (error) report_warning('保存スロットの一覧を取得できませんでした', error)
    cb(rows)
  }
  let request: IDBRequest<IDBCursorWithValue | null>
  try {
    request = tx.objectStore(st_proj).openCursor()
  } catch (error) {
    finish(error)
    return
  }
  request.onsuccess = () => {
    try {
      const cursor = request.result
      if (!cursor) {
        finish()
        return
      }
      const value = cursor.value as { name?: string, ts?: number, thumb?: Blob | string, blob?: Blob, bytes?: ArrayBuffer }
      rows.push({
        key: String(cursor.key),
        name: value.name || '',
        ts: value.ts || 0,
        thumb: value.thumb instanceof Blob ? value.thumb : null,
        size: value.blob ? value.blob.size : value.bytes ? value.bytes.byteLength : 0,
      })
      cursor.continue()
    } catch (error) {
      finish(error)
    }
  }
  request.onerror = event => finish(database_event_error(event))
  tx.onerror = event => finish(database_event_error(event))
  tx.onabort = event => finish(database_event_error(event))
}

export function store_list(cb: (rows: slot_row_t[]) => void): void {
  database_open(ok => {
    if (!ok || !database_ready()) {
      cb([])
      return
    }
    const rows: slot_row_t[] = []
    database_read(st_auto, 'meta', value => {
      const auto = value as auto_meta_t | null
      if (auto) rows.push({ key: 'auto', name: auto.name, ts: auto.ts, thumb: null, size: 0 })
      list_project_rows(rows, cb)
    })
  })
}
