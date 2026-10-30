import { mode_3_d, mode_normal, pat_table, type paint_tile_t } from './h'

export const pat_custom = pat_table.length
export const paint_tile_max = 512
export const native_pat_order = [1, 2, 3, 4, 5, 6, 7, 8, 0, pat_custom]

function tile_rows(w: number, rows: number[]): paint_tile_t {
  const b: number[] = []
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < w; x++) b.push((rows[y] >> (w - x - 1)) & 1)
  return { w, h: rows.length, b }
}

const normal: paint_tile_t[] = []
for (const p of pat_table) normal.push(tile_rows(8, p.rows))

// うごくメモ帳3Dのペイント模様。x, y は実機のフレーム座標 (320×240) で判定する。
function native_bit(pat: number, x: number, y: number): number {
  switch (pat) {
    case 1: return x % 3 === 1 && y % 3 === 1 ? 1 : 0
    case 2: return (x | y) & 1 ? 0 : 1
    case 3: return (0x8000 >>> ((x & 3) + (y & 3) * 4)) & 0xa1a4 ? 1 : 0
    case 4: return y & 1
    case 5: return x & 1
    case 6: return (x ^ y) & 1
    case 7: return (x | y) & 1
    case 8: return x % 3 === 1 && y % 3 === 1 ? 0 : 1
  }
  return 1
}

const native_period = [1, 3, 2, 4, 2, 2, 2, 2, 3]

// off はキャンバスの左上が実機フレームのどこにあたるか。3Dは周囲5pxを除いた310×230を描画面にしている。
function native_tiles(off: number): paint_tile_t[] {
  const tiles: paint_tile_t[] = []
  for (let pat = 0; pat < native_period.length; pat++) {
    const n = native_period[pat]
    const b: number[] = []
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) b.push(native_bit(pat, x + off, y + off))
    tiles.push({ w: n, h: n, b })
  }
  return tiles
}

const native_dsi = native_tiles(0)
const native_3d = native_tiles(5)

export type paint_pattern_t = { readonly w: number, readonly h: number, readonly b: readonly number[], readonly rgba?: readonly number[] }

export function paint_active(mode: number, native: paint_pattern_t | null, normal: paint_pattern_t | null): paint_pattern_t | null {
  return mode === mode_normal ? normal : native
}

export function paint_pattern(mode: number, pat: number, custom: paint_pattern_t | null): paint_pattern_t {
  if (pat === pat_custom && custom) return custom
  const native = mode === mode_3_d ? native_3d : native_dsi
  return (mode === mode_normal ? normal : native)[pat] || native[0]
}

export function paint_index(tile: paint_pattern_t, x: number, y: number): number {
  const px = ((x % tile.w) + tile.w) % tile.w
  const py = ((y % tile.h) + tile.h) % tile.h
  return py * tile.w + px
}

export function paint_bit(tile: paint_pattern_t, x: number, y: number): number {
  return tile.b[paint_index(tile, x, y)]
}

export function paint_tile_valid(value: unknown): value is paint_tile_t {
  if (!value || typeof value !== 'object') return false
  const tile = value as paint_tile_t
  return Number.isInteger(tile.w) && Number.isInteger(tile.h) && tile.w > 0 && tile.h > 0 && tile.w <= paint_tile_max && tile.h <= paint_tile_max && Array.isArray(tile.b) && tile.b.length === tile.w * tile.h && tile.b.every(b => b === 0 || b === 1) && (tile.rgba === undefined || Array.isArray(tile.rgba) && tile.rgba.length === tile.w * tile.h * 4 && tile.rgba.every(v => Number.isInteger(v) && v >= 0 && v <= 255))
}

const paint_magic = 0x31425450
const paint_header = 9

export function paint_tile_encode(tile: paint_tile_t): Uint8Array<ArrayBuffer> {
  if (!paint_tile_valid(tile)) throw new Error('Invalid paint tile')
  const count = tile.w * tile.h
  const rgba = tile.rgba !== undefined
  const bytes = new Uint8Array(paint_header + (rgba ? count * 4 : Math.ceil(count / 8)))
  const view = new DataView(bytes.buffer)
  view.setUint32(0, paint_magic, true)
  view.setUint16(4, tile.w, true)
  view.setUint16(6, tile.h, true)
  bytes[8] = rgba ? 1 : 0
  if (rgba) bytes.set(tile.rgba!, paint_header)
  else for (let i = 0; i < count; i++) bytes[paint_header + (i >> 3)] |= tile.b[i] << (i & 7)
  return bytes
}

export function paint_tile_decode(bytes: Uint8Array): paint_tile_t | null {
  if (bytes.length < paint_header) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== paint_magic || bytes[8] > 1) return null
  const w = view.getUint16(4, true)
  const h = view.getUint16(6, true)
  if (!w || !h || w > paint_tile_max || h > paint_tile_max) return null
  const count = w * h
  const rgba = bytes[8] === 1
  if (bytes.length !== paint_header + (rgba ? count * 4 : Math.ceil(count / 8))) return null
  const b = new Array<number>(count)
  if (rgba) {
    const colors = Array.from(bytes.subarray(paint_header))
    for (let i = 0; i < count; i++) b[i] = colors[i * 4 + 3] ? 1 : 0
    return { w, h, b, rgba: colors }
  }
  for (let i = 0; i < count; i++) b[i] = (bytes[paint_header + (i >> 3)] >> (i & 7)) & 1
  return { w, h, b }
}
