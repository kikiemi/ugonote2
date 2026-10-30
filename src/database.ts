import { report_warning } from './diagnostics'

const db_name = 'ugonote2'
const st_proj = 'proj'
const st_auto = 'auto'

let db: IDBDatabase | null = null
let db_open: IDBOpenDBRequest | null = null
let db_open_blocked = 0
let db_waiters: ((ok: number) => void)[] = []
export function database_event_error(event: Event): unknown {
  const target = event.target as (IDBRequest | IDBTransaction | null)
  if (!target) return event
  if ('readyState' in target) return target.readyState === 'done' && target.error ? target.error : event
  return target.error || event
}

function open_finish(ok: number): void {
  const waiters = db_waiters
  db_waiters = []
  for (const callback of waiters) {
    try {
      callback(ok)
    } catch (error) {
      report_warning('保存データベースの完了処理に失敗しました', error)
    }
  }
}

export function database_open(cb: (ok: number) => void): void {
  if (db) {
    cb(1)
    return
  }
  if (!('indexedDB' in window)) {
    cb(0)
    return
  }
  if (db_open) {
    if (db_open_blocked) cb(0)
    else db_waiters.push(cb)
    return
  }

  db_waiters.push(cb)
  let request: IDBOpenDBRequest
  try {
    request = indexedDB.open(db_name, 3)
  } catch (error) {
    report_warning('保存データベースを開けませんでした', error)
    open_finish(0)
    return
  }
  db_open = request
  db_open_blocked = 0
  request.onupgradeneeded = () => {
    try {
      const current = request.result
      if (!current.objectStoreNames.contains(st_proj)) current.createObjectStore(st_proj)
      if (!current.objectStoreNames.contains(st_auto)) current.createObjectStore(st_auto)
      if (!current.objectStoreNames.contains('paint')) current.createObjectStore('paint')
    } catch (error) {
      report_warning('保存データベースを更新できませんでした', error)
      if (request.transaction) database_abort(request.transaction, '失敗したデータベース更新を中止できませんでした')
    }
  }
  request.onsuccess = () => {
    db = request.result
    db_open = null
    db_open_blocked = 0
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
    report_warning('保存データベースを開けませんでした', database_event_error(event))
    db_open = null
    db_open_blocked = 0
    open_finish(0)
  }
  request.onblocked = event => {
    db_open_blocked = 1
    report_warning('保存データベースの更新が別のタブに妨げられています', database_event_error(event))
    open_finish(0)
  }
}

export function database_transaction(store: string, mode: IDBTransactionMode, context: string): IDBTransaction | null {
  const active_database = db
  if (!active_database) return null
  try {
    return active_database.transaction(store, mode)
  } catch (error) {
    if (db === active_database) {
      try {
        active_database.close()
      } catch (close_error) {
        report_warning('使用不能な保存データベースを閉じられませんでした', close_error)
      }
      db = null
    }
    report_warning(context, error)
    return null
  }
}

export function database_abort(transaction: IDBTransaction, context: string): void {
  try {
    transaction.abort()
  } catch (error) {
    report_warning(context, error)
  }
}

export function database_read(store_name: string, key: string, cb: (val: unknown) => void): void {
  database_open(ok => {
    if (!ok || !db) {
      cb(null)
      return
    }
    const tx = database_transaction(store_name, 'readonly', '保存データの読み込みを開始できませんでした')
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
      request = tx.objectStore(store_name).get(key)
    } catch (error) {
      report_warning('保存データの読み込みを要求できませんでした: ' + key, error)
      finish(null)
      return
    }
    request.onsuccess = () => finish(request.result ?? null)
    request.onerror = event => {
      report_warning('保存データを読み込めませんでした: ' + key, database_event_error(event))
      finish(null)
    }
    tx.onabort = event => {
      report_warning('保存データの読み込みが中止されました: ' + key, database_event_error(event))
      finish(null)
    }
  })
}

export function database_write(store_name: string, context: string, write: (store: IDBObjectStore) => void, cb: (ok: number) => void): void {
  database_open(ok => {
    if (!ok || !db) {
      cb(0)
      return
    }
    const tx = database_transaction(store_name, 'readwrite', context)
    if (!tx) {
      cb(0)
      return
    }
    let completed = 0
    const finish = (ok_result: number, error?: unknown): void => {
      if (completed) return
      completed = 1
      if (error) report_warning(context, error)
      cb(ok_result)
    }
    try {
      write(tx.objectStore(store_name))
    } catch (error) {
      database_abort(tx, context + '。トランザクションを中止できませんでした')
      finish(0, error)
      return
    }
    tx.oncomplete = () => finish(1)
    tx.onerror = event => finish(0, database_event_error(event))
    tx.onabort = event => finish(0, database_event_error(event))
  })
}

export function database_ready(): number {
  return db ? 1 : 0
}
