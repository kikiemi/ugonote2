import { database_read, database_write } from './database'
import { report_warning } from './diagnostics'
import { mode_normal, type paint_tile_t } from './h'
import { paint_tile_decode, paint_tile_encode, paint_tile_valid } from './paint'
import { storage_read_json, storage_remove } from './storage'

const paint_store = 'paint'
const versions = [0, 0]

function paint_slot(mode: number): number {
  return mode === mode_normal ? 0 : 1
}

function paint_key(slot: number): string {
  return slot ? 'native' : 'normal'
}

function paint_legacy(slot: number): string {
  return slot ? 'ug2_paint' : 'ug2_paint_normal'
}

function paint_write(slot: number, tile: paint_tile_t, done: (ok: number) => void): void {
  const blob = new Blob([paint_tile_encode(tile)], { type: 'application/octet-stream' })
  database_write(paint_store, '登録したペイントを保存できませんでした', store => store.put(blob, paint_key(slot)), ok => {
    if (ok) storage_remove(paint_legacy(slot))
    done(ok)
  })
}

export function paint_store_save(mode: number, tile: paint_tile_t, done: (ok: number) => void): void {
  const slot = paint_slot(mode)
  versions[slot]++
  paint_write(slot, tile, done)
}

export function paint_store_load(mode: number, done: (tile: paint_tile_t | null) => void): void {
  const slot = paint_slot(mode)
  const version = versions[slot]
  database_read(paint_store, paint_key(slot), async value => {
    let tile: paint_tile_t | null = null
    if (value instanceof Blob) {
      try {
        if (value.size <= 512 * 512 * 4 + 9) tile = paint_tile_decode(new Uint8Array(await value.arrayBuffer()))
      } catch (error) {
        report_warning('登録したペイントを読み込めませんでした', error)
      }
    }
    if (versions[slot] !== version) {
      done(null)
      return
    }
    if (tile) {
      done(tile)
      return
    }
    const legacy = storage_read_json(paint_legacy(slot))
    if (!paint_tile_valid(legacy)) {
      done(null)
      return
    }
    tile = slot ? { w: legacy.w, h: legacy.h, b: legacy.b.slice() } : legacy
    done(tile)
    if (versions[slot] === version) paint_write(slot, tile, () => {})
  })
}
