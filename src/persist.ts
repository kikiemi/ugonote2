import { report_warning } from './diagnostics'
import { frame_id_seed } from './doc'
import { bytes_rle, fmt_parse, fmt_snapshot, rle_bytes, type LoadedProject } from './fmt'
import { AUTOSAVE_MS, D_SAVE, L_N, anim_fx_zero, type AnimFx, type Frame, type NoteMeta, type Rle } from './h'
import { canvas_to_blob } from './lib'
import { dispatch } from './state/commands/index'
import { dirty, st, store_hook } from './state/store'
import { thumb_get } from './thumb'
import { build_ugn2_async } from './workercli'

let projDirty = 0
let dirtySeq = 0

export function proj_dirty(): number {
  return projDirty
}

const DB_NAME = 'ugonote2'
const ST_PROJ = 'proj'
const ST_AUTO = 'auto'

export type SlotRow = { key: string, name: string, ts: number, thumb: Blob | null, size: number }

let db: IDBDatabase | null = null
let dbOpen: IDBOpenDBRequest | null = null
let dbOpenBlocked = 0
let dbWaiters: ((ok: number) => void)[] = []
let saveState = 0
let backoff = 2000
let retryT: ReturnType<typeof setTimeout> | 0 = 0
let blinkT: ReturnType<typeof setTimeout> | 0 = 0
let blink = 0

export function store_state(): number {
  return saveState
}

export function store_blink(): number {
  return blink
}

function idb_event_error(event: Event): unknown {
  const target = event.target as (IDBRequest | IDBTransaction | null)
  if (!target) return event
  if ('readyState' in target) return target.readyState === 'done' && target.error ? target.error : event
  return target.error || event
}

function open_finish(ok: number): void {
  const waiters = dbWaiters
  dbWaiters = []
  for (const callback of waiters) {
    try {
      callback(ok)
    } catch (error) {
      report_warning('保存データベースの完了処理に失敗しました', error)
    }
  }
}

function open_db(cb: (ok: number) => void): void {
  if (db) {
    cb(1)
    return
  }
  if (!('indexedDB' in window)) {
    cb(0)
    return
  }
  if (dbOpen) {
    if (dbOpenBlocked) cb(0)
    else dbWaiters.push(cb)
    return
  }

  dbWaiters.push(cb)
  let request: IDBOpenDBRequest
  try {
    request = indexedDB.open(DB_NAME, 2)
  } catch (error) {
    report_warning('保存データベースを開けませんでした', error)
    open_finish(0)
    return
  }
  dbOpen = request
  dbOpenBlocked = 0
  request.onupgradeneeded = () => {
    try {
      const current = request.result
      if (!current.objectStoreNames.contains(ST_PROJ)) current.createObjectStore(ST_PROJ)
      if (!current.objectStoreNames.contains(ST_AUTO)) current.createObjectStore(ST_AUTO)
    } catch (error) {
      report_warning('保存データベースを更新できませんでした', error)
      if (request.transaction) abort_transaction(request.transaction, '失敗したデータベース更新を中止できませんでした')
    }
  }
  request.onsuccess = () => {
    db = request.result
    dbOpen = null
    dbOpenBlocked = 0
    db.onversionchange = () => {
      if (db) db.close()
      db = null
    }
    db.onclose = () => {
      db = null
    }
    open_finish(1)
  }
  request.onerror = event => {
    report_warning('保存データベースを開けませんでした', idb_event_error(event))
    dbOpen = null
    dbOpenBlocked = 0
    open_finish(0)
  }
  request.onblocked = event => {
    dbOpenBlocked = 1
    report_warning('保存データベースの更新が別のタブに妨げられています', idb_event_error(event))
    open_finish(0)
  }
}

function idb_transaction(store: string, mode: IDBTransactionMode, context: string): IDBTransaction | null {
  const activeDatabase = db
  if (!activeDatabase) return null
  try {
    return activeDatabase.transaction(store, mode)
  } catch (error) {
    if (db === activeDatabase) {
      try {
        activeDatabase.close()
      } catch (closeError) {
        report_warning('使用不能な保存データベースを閉じられませんでした', closeError)
      }
      db = null
    }
    report_warning(context, error)
    return null
  }
}

function abort_transaction(transaction: IDBTransaction, context: string): void {
  try {
    transaction.abort()
  } catch (error) {
    report_warning(context, error)
  }
}

function blink_once(): void {
  blink = 1
  dirty(D_SAVE)
  if (blinkT) clearTimeout(blinkT)
  blinkT = setTimeout(() => {
    blink = 0
    blinkT = 0
    dirty(D_SAVE)
  }, 900)
}

const FRAME_BLOB_MAGIC = 0x3352594c

function frame_blob(f: { readonly pk: readonly (Rle | null)[] }): Blob {
  const bytes: Uint8Array[] = []
  let total = 5
  for (let layer = 0; layer < L_N; layer++) {
    const packed = f.pk[layer]
    const data = packed ? rle_bytes(packed) : new Uint8Array(0)
    bytes.push(data)
    total += 4 + data.length
  }
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, FRAME_BLOB_MAGIC, true)
  out[4] = L_N
  let offset = 5
  for (const data of bytes) {
    view.setUint32(offset, data.length, true)
    offset += 4
    out.set(data, offset)
    offset += data.length
  }
  return new Blob([out])
}

function frame_from_bytes(bytes: Uint8Array): (Rle | null)[] {
  const out = new Array<Rle | null>(L_N).fill(null)
  if (bytes.length < 4) return out
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  let count = 4
  if (view.getUint32(0, true) === FRAME_BLOB_MAGIC) {
    if (bytes.length < 5) return out
    count = bytes[4]
    offset = 5
  }
  for (let layer = 0; layer < count; layer++) {
    if (offset + 4 > bytes.length) break
    const length = view.getUint32(offset, true)
    offset += 4
    if (length > bytes.length - offset || (length & 3) !== 0) break
    if (length && layer < L_N) out[layer] = bytes_rle(bytes.subarray(offset, offset + length))
    offset += length
  }
  return out
}

type AutoMeta = {
  name: string
  ts: number
  w: number
  h: number
  fps: number
  loop: number
  palMode: number
  ratio: string
  res: string
  paper: string
  lvis: number[]
  lalpha: number[]
  lord: number[]
  mode: number
  anim: AnimFx
  bgmVol: number
  bgmFps: number
  seVol: number
  cur: number
  loopA: number
  loopB: number
  frames: { id: number, se: number, hold: number }[]
  meta: NoteMeta
}

const savedPk = new WeakMap<object, (Rle | null)[]>()
const savedSnd = new Map<string, ArrayBuffer | null>()
let savedIds: number[] = []
const SND_KINDS = ['bgm0', 'bgm1', 'se0', 'se1', 'se2', 'se3']

function snd_of(kind: string): { bytes: ArrayBuffer | null, name: string } {
  const g = st()
  if (kind === 'bgm0') return g.snd.bgm[0]
  if (kind === 'bgm1') return g.snd.bgm[1]
  return g.snd.se[parseInt(kind.slice(2), 10) || 0]
}

function pk_same(a: readonly (Rle | null)[] | undefined, f: { readonly pk: readonly (Rle | null)[] }): number {
  if (!a) return 0
  if (a.length !== f.pk.length) return 0
  for (let layer = 0; layer < f.pk.length; layer++) if (a[layer] !== f.pk[layer]) return 0
  return 1
}

export function store_save_auto(): void {
  const g = st()
  if (!g.booted) return
  if (saveState === 1) return
  saveState = 1
  dirty(D_SAVE)
  const seqAtStart = dirtySeq

  const meta: AutoMeta = {
    name: g.doc.name, ts: Date.now(),
    w: g.doc.w, h: g.doc.h, fps: g.doc.fps, loop: g.doc.loop, palMode: g.pen.palMode,
    ratio: g.doc.ratio, res: g.doc.res, paper: g.doc.paper,
    lvis: [...g.doc.lvis], lalpha: [...g.doc.lalpha], lord: [...g.doc.lord],
    mode: g.doc.mode, anim: { ...g.doc.anim }, bgmVol: g.snd.bgmVol, bgmFps: g.snd.bgmFps, seVol: g.snd.seVol,
    cur: g.doc.cur, loopA: g.doc.loopA, loopB: g.doc.loopB,
    frames: g.doc.frames.map(f => ({ id: f.id, se: f.se, hold: f.hold })),
    meta: { ...g.doc.meta },
  }
  const changed: { id: number, blob: Blob, f: object, pk: (Rle | null)[] }[] = []
  for (const f of g.doc.frames) {
    if (pk_same(savedPk.get(f), f)) continue
    changed.push({ id: f.id, blob: frame_blob(f), f, pk: [...f.pk] as (Rle | null)[] })
  }
  const ids = meta.frames.map(x => x.id)
  const id_set = new Set(ids)
  const gone = savedIds.filter(id => !id_set.has(id))
  const sndChanged: { kind: string, name: string, bytes: ArrayBuffer | null, blob: Blob | null }[] = []
  for (const kind of SND_KINDS) {
    const slot = snd_of(kind)
    if (savedSnd.get(kind) === slot.bytes) continue
    sndChanged.push({ kind, name: slot.name, bytes: slot.bytes, blob: slot.bytes ? new Blob([slot.bytes]) : null })
  }

  open_db(ok => {
    if (!ok || !db) {
      fail()
      return
    }
    const tx = idb_transaction(ST_AUTO, 'readwrite', '自動保存用トランザクションを開始できませんでした')
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
      const store = tx.objectStore(ST_AUTO)
      store.put(meta, 'meta')
      for (const item of changed) store.put(item.blob, 'f' + item.id)
      for (const id of gone) store.delete('f' + id)
      for (const item of sndChanged) {
        if (item.blob) store.put({ name: item.name, blob: item.blob }, 's' + item.kind)
        else store.delete('s' + item.kind)
      }
    } catch (error) {
      abort_transaction(tx, '失敗した自動保存トランザクションを中止できませんでした')
      fail_transaction(error)
      return
    }
    tx.oncomplete = () => {
      if (completed) return
      completed = 1
      for (const item of changed) savedPk.set(item.f, item.pk)
      for (const item of sndChanged) savedSnd.set(item.kind, item.bytes)
      savedIds = ids
      saveState = 0
      backoff = 2000
      if (retryT) {
        clearTimeout(retryT)
        retryT = 0
      }
      if (dirtySeq === seqAtStart) projDirty = 0
      blink_once()
      dirty(D_SAVE)
    }
    tx.onerror = event => fail_transaction(idb_event_error(event))
    tx.onabort = event => fail_transaction(idb_event_error(event))
  })

  function fail(): void {
    saveState = 2
    dirty(D_SAVE)
    if (retryT) clearTimeout(retryT)
    retryT = setTimeout(() => {
      retryT = 0
      store_save_auto()
    }, backoff)
    backoff = Math.min(30000, backoff * 2)
  }
}

function idb_get(storeName: string, key: string, cb: (val: unknown) => void): void {
  open_db(ok => {
    if (!ok || !db) {
      cb(null)
      return
    }
    const tx = idb_transaction(storeName, 'readonly', '保存データの読み込みを開始できませんでした')
    if (!tx) {
      cb(null)
      return
    }
    let completed = 0
    const finish = (value: unknown): void => {
      if (completed) return
      completed = 1
      cb(value)
    }
    let request: IDBRequest
    try {
      request = tx.objectStore(storeName).get(key)
    } catch (error) {
      report_warning('保存データの読み込みを要求できませんでした: ' + key, error)
      finish(null)
      return
    }
    request.onsuccess = () => finish(request.result ?? null)
    request.onerror = event => {
      report_warning('保存データを読み込めませんでした: ' + key, idb_event_error(event))
      finish(null)
    }
    tx.onabort = event => {
      report_warning('保存データの読み込みが中止されました: ' + key, idb_event_error(event))
      finish(null)
    }
  })
}

function idb_write(storeName: string, context: string, write: (store: IDBObjectStore) => void, cb: (ok: number) => void): void {
  open_db(ok => {
    if (!ok || !db) {
      cb(0)
      return
    }
    const tx = idb_transaction(storeName, 'readwrite', context)
    if (!tx) {
      cb(0)
      return
    }
    let completed = 0
    const finish = (okResult: number, error?: unknown): void => {
      if (completed) return
      completed = 1
      if (error) report_warning(context, error)
      cb(okResult)
    }
    try {
      write(tx.objectStore(storeName))
    } catch (error) {
      abort_transaction(tx, context + '。トランザクションを中止できませんでした')
      finish(0, error)
      return
    }
    tx.oncomplete = () => finish(1)
    tx.onerror = event => finish(0, idb_event_error(event))
    tx.onabort = event => finish(0, idb_event_error(event))
  })
}

function mark_all_saved(): void {
  const g = st()
  for (const f of g.doc.frames) savedPk.set(f, [...f.pk] as (Rle | null)[])
  savedIds = g.doc.frames.map(f => f.id)
  for (const k of SND_KINDS) savedSnd.set(k, snd_of(k).bytes)
}

async function restore_auto(): Promise<number> {
  const meta = await new Promise<AutoMeta | null>(res => idb_get(ST_AUTO, 'meta', v => res(v as AutoMeta | null)))
  if (!meta || !meta.frames || !meta.frames.length) return 0
  if (!db) return 0
  const frames: Frame[] = []
  let maxId = 0
  for (const fm of meta.frames) {
    const blob = await new Promise<Blob | null>(res => idb_get(ST_AUTO, 'f' + fm.id, v => res(v as Blob | null)))
    const pk = blob ? frame_from_bytes(new Uint8Array(await blob.arrayBuffer())) : new Array<Rle | null>(L_N).fill(null)
    frames.push({ id: fm.id, se: fm.se, hold: fm.hold, pk })
    if (fm.id > maxId) maxId = fm.id
  }
  frame_id_seed(maxId + 1)
  const slots: { name: string, bytes: ArrayBuffer | null }[] = []
  for (const k of SND_KINDS) {
    const rec = await new Promise<{ name: string, blob: Blob } | null>(res => idb_get(ST_AUTO, 's' + k, v => res(v as { name: string, blob: Blob } | null)))
    slots.push(rec && rec.blob ? { name: rec.name, bytes: await rec.blob.arrayBuffer() } : { name: '', bytes: null })
  }
  const d: LoadedProject = {
    meta: meta.meta,
    w: meta.w, h: meta.h, fps: meta.fps, loop: meta.loop, palMode: meta.palMode,
    name: meta.name, ratio: meta.ratio, res: meta.res, paper: meta.paper,
    lvis: new Uint8Array(meta.lvis), lalpha: new Uint8Array(meta.lalpha), lord: [...meta.lord],
    mode: meta.mode, anim: meta.anim || anim_fx_zero(), bgmVol: meta.bgmVol, bgmFps: meta.bgmFps, seVol: meta.seVol,
    frames, cur: meta.cur, loopA: meta.loopA, loopB: meta.loopB, slots,
  }
  if (dispatch('project.apply_loaded', d) < 0) return 0
  mark_all_saved()
  return 1
}

export function store_boot(cb: (loaded: number) => void): void {
  store_hook(() => store_save_auto(), AUTOSAVE_MS, () => {
    projDirty = 1
    dirtySeq++
    dirty(D_SAVE)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && projDirty) store_save_auto()
  })
  restore_auto()
    .then(loaded => {
      if (loaded) {
        cb(1)
        return
      }
      idb_get(ST_PROJ, 'auto', val => {
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
      const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer])
      const record = { name: snap.name, ts: Date.now(), thumb, blob }
      idb_write(ST_PROJ, '保存スロットへ書き込めませんでした', store => store.put(record, 'slot' + index), ok => {
        if (ok) blink_once()
        cb(ok)
      })
    })
  })
}

export function store_export_ugn2(cb: (bytes: Uint8Array | null) => void): void {
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
  idb_get(ST_PROJ, key, value => {
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
  idb_write(ST_PROJ, '保存スロットを削除できませんでした', store => store.delete(key), cb)
}

function list_project_rows(rows: SlotRow[], cb: (rows: SlotRow[]) => void): void {
  const tx = idb_transaction(ST_PROJ, 'readonly', '保存スロットの一覧取得を開始できませんでした')
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
    request = tx.objectStore(ST_PROJ).openCursor()
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
  request.onerror = event => finish(idb_event_error(event))
  tx.onerror = event => finish(idb_event_error(event))
  tx.onabort = event => finish(idb_event_error(event))
}

export function store_list(cb: (rows: SlotRow[]) => void): void {
  open_db(ok => {
    if (!ok || !db) {
      cb([])
      return
    }
    const rows: SlotRow[] = []
    idb_get(ST_AUTO, 'meta', value => {
      const auto = value as AutoMeta | null
      if (auto) rows.push({ key: 'auto', name: auto.name, ts: auto.ts, thumb: null, size: 0 })
      list_project_rows(rows, cb)
    })
  })
}
