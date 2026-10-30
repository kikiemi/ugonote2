import { reader_string, reader_u8, reader_u16, writer_string, writer_u8, writer_u16, type binary_reader_t, type binary_writer_t } from '../binary'

export type kwz_frame_meta_t = {
  depth: readonly number[]
  colors: readonly number[]
  author: string
  reserved: number
  camera: number
}

export function kwz_frame_meta_valid(meta: kwz_frame_meta_t): boolean {
  return !!meta && typeof meta === 'object' && Array.isArray(meta.depth) && meta.depth.length === 3 && meta.depth.every(n => Number.isInteger(n) && n >= 0 && n <= 255) && Array.isArray(meta.colors) && meta.colors.length === 6 && meta.colors.every(n => Number.isInteger(n) && n >= 0 && n <= 15) && /^[0-9a-f]{20}$/i.test(meta.author) && Number.isInteger(meta.reserved) && meta.reserved >= 0 && meta.reserved <= 65535 && Number.isInteger(meta.camera) && meta.camera >= 0 && meta.camera <= 65535
}

export function kwz_frame_meta_clone(meta: kwz_frame_meta_t | undefined): kwz_frame_meta_t | undefined {
  return meta ? { depth: [...meta.depth], colors: [...meta.colors], author: meta.author, reserved: meta.reserved, camera: meta.camera } : undefined
}

export function kwz_frame_meta_write(w: binary_writer_t, meta: kwz_frame_meta_t | undefined): void {
  writer_u8(w, meta ? 1 : 0)
  if (!meta) return
  for (const n of meta.depth) writer_u8(w, n)
  for (const n of meta.colors) writer_u8(w, n)
  writer_string(w, meta.author)
  writer_u16(w, meta.reserved)
  writer_u16(w, meta.camera)
}

export function kwz_frame_meta_read(r: binary_reader_t): kwz_frame_meta_t | undefined {
  const present = reader_u8(r)
  if (!present) return undefined
  if (present !== 1) throw new Error('Invalid KWZ metadata')
  const meta = { depth: [reader_u8(r), reader_u8(r), reader_u8(r)], colors: [reader_u8(r), reader_u8(r), reader_u8(r), reader_u8(r), reader_u8(r), reader_u8(r)], author: reader_string(r), reserved: reader_u16(r), camera: reader_u16(r) }
  if (!kwz_frame_meta_valid(meta)) throw new Error('Invalid KWZ metadata')
  return meta
}
