export type binary_writer_t = { buf: Uint8Array, len: number, dv: DataView, limit?: number }
export type binary_reader_t = { buf: Uint8Array, pos: number, dv: DataView }

const crc_table = new Uint32Array(256)
for (let value = 0; value < 256; value++) {
  let crc = value
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  crc_table[value] = crc >>> 0
}

export function crc32(buffer: Uint8Array, seed: number): number {
  let crc = (seed ^ 0xffffffff) >>> 0
  for (let index = 0; index < buffer.length; index++) crc = (crc_table[(crc ^ buffer[index]) & 255] ^ (crc >>> 8)) >>> 0
  return (crc ^ 0xffffffff) >>> 0
}

export function binary_writer(capacity: number): binary_writer_t {
  const buffer = new Uint8Array(capacity < 64 ? 64 : capacity)
  return { buf: buffer, len: 0, dv: new DataView(buffer.buffer) }
}

function writer_grow(writer: binary_writer_t, needed: number): void {
  if (writer.len + needed > (writer.limit ?? Number.MAX_SAFE_INTEGER)) throw new Error('出力データが大きすぎます。範囲か画像の大きさを小さくしてください')
  if (writer.len + needed <= writer.buf.length) return
  let capacity = writer.buf.length * 2
  while (capacity < writer.len + needed) capacity *= 2
  capacity = Math.min(capacity, writer.limit ?? capacity)
  const buffer = new Uint8Array(capacity)
  buffer.set(writer.buf.subarray(0, writer.len))
  writer.buf = buffer
  writer.dv = new DataView(buffer.buffer)
}

export function writer_u8(writer: binary_writer_t, value: number): void {
  writer_grow(writer, 1)
  writer.buf[writer.len++] = value & 255
}

export function writer_u16(writer: binary_writer_t, value: number): void {
  writer_grow(writer, 2)
  writer.dv.setUint16(writer.len, value, true)
  writer.len += 2
}

export function writer_u32(writer: binary_writer_t, value: number): void {
  writer_grow(writer, 4)
  writer.dv.setUint32(writer.len, value >>> 0, true)
  writer.len += 4
}

export function writer_f32(writer: binary_writer_t, value: number): void {
  writer_grow(writer, 4)
  writer.dv.setFloat32(writer.len, value, true)
  writer.len += 4
}

export function writer_bytes(writer: binary_writer_t, bytes: Uint8Array): void {
  writer_grow(writer, bytes.length)
  writer.buf.set(bytes, writer.len)
  writer.len += bytes.length
}

export function writer_string(writer: binary_writer_t, value: string): void {
  const bytes = new TextEncoder().encode(value)
  writer_u16(writer, bytes.length)
  writer_bytes(writer, bytes)
}

export function writer_finish(writer: binary_writer_t): Uint8Array {
  return writer.buf.slice(0, writer.len)
}

export function binary_reader(buffer: Uint8Array): binary_reader_t {
  return { buf: buffer, pos: 0, dv: new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength) }
}

export function reader_u8(reader: binary_reader_t): number {
  return reader.buf[reader.pos++]
}

export function reader_u16(reader: binary_reader_t): number {
  const value = reader.dv.getUint16(reader.pos, true)
  reader.pos += 2
  return value
}

export function reader_u32(reader: binary_reader_t): number {
  const value = reader.dv.getUint32(reader.pos, true)
  reader.pos += 4
  return value
}

export function reader_f32(reader: binary_reader_t): number {
  const value = reader.dv.getFloat32(reader.pos, true)
  reader.pos += 4
  return value
}

export function reader_bytes(reader: binary_reader_t, length: number): Uint8Array {
  const bytes = reader.buf.slice(reader.pos, reader.pos + length)
  reader.pos += length
  return bytes
}

export function reader_string(reader: binary_reader_t): string {
  const length = reader_u16(reader)
  return new TextDecoder().decode(reader_bytes(reader, length))
}

export function reader_left(reader: binary_reader_t): number {
  return reader.buf.length - reader.pos
}
