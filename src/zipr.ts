import { report_warning } from './diagnostics'

export type zip_entry_t = {
  name: string
  data: Uint8Array
}

const eocd_size = 22
const central_header_size = 46
const local_header_size = 30
const max_entries = 10000
const max_entry_bytes = 64 << 20
const max_total_bytes = 256 << 20

function has_range(bytes: Uint8Array, offset: number, length: number): boolean {
  return Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length >= 0 && offset + length <= bytes.length
}

function u16le(bytes: Uint8Array, offset: number): number {
  if (!has_range(bytes, offset, 2)) throw new RangeError('ZIP uint16 is outside the input')
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function u32le(bytes: Uint8Array, offset: number): number {
  if (!has_range(bytes, offset, 4)) throw new RangeError('ZIP uint32 is outside the input')
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

async function inflate_raw(data: Uint8Array): Promise<Uint8Array | null> {
  const decompressor = typeof DecompressionStream === 'undefined' ? null : DecompressionStream
  if (!decompressor) return null
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new decompressor('deflate-raw'))
  const buffer = await new Response(stream).arrayBuffer()
  return new Uint8Array(buffer)
}

async function zip_read_inner(buffer: ArrayBuffer): Promise<zip_entry_t[] | null> {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < eocd_size) return null
  let eocd_offset = -1
  const search_start = Math.max(0, bytes.length - eocd_size - 65535)
  for (let offset = bytes.length - eocd_size; offset >= search_start; offset--) {
    if (u32le(bytes, offset) === 0x06054b50) {
      eocd_offset = offset
      break
    }
  }
  if (eocd_offset < 0) return null

  const disk_number = u16le(bytes, eocd_offset + 4)
  const central_disk = u16le(bytes, eocd_offset + 6)
  const disk_entries = u16le(bytes, eocd_offset + 8)
  const entry_count = u16le(bytes, eocd_offset + 10)
  const central_size = u32le(bytes, eocd_offset + 12)
  let central_offset = u32le(bytes, eocd_offset + 16)
  const comment_length = u16le(bytes, eocd_offset + 20)
  if (disk_number !== 0 || central_disk !== 0 || disk_entries !== entry_count || entry_count > max_entries) return null
  if (!has_range(bytes, eocd_offset + eocd_size, comment_length)) return null
  if (!has_range(bytes, central_offset, central_size) || central_offset + central_size > eocd_offset) return null

  const entries: zip_entry_t[] = []
  let total_bytes = 0
  for (let index = 0; index < entry_count; index++) {
    if (!has_range(bytes, central_offset, central_header_size) || u32le(bytes, central_offset) !== 0x02014b50) return null
    const flags = u16le(bytes, central_offset + 8)
    const method = u16le(bytes, central_offset + 10)
    const compressed_size = u32le(bytes, central_offset + 20)
    const uncompressed_size = u32le(bytes, central_offset + 24)
    const name_length = u16le(bytes, central_offset + 28)
    const extra_length = u16le(bytes, central_offset + 30)
    const comment_size = u16le(bytes, central_offset + 32)
    const local_offset = u32le(bytes, central_offset + 42)
    const record_length = central_header_size + name_length + extra_length + comment_size
    if (!has_range(bytes, central_offset, record_length)) return null
    if ((flags & 1) !== 0 || uncompressed_size > max_entry_bytes || total_bytes + uncompressed_size > max_total_bytes) return null

    const name_bytes = bytes.subarray(central_offset + central_header_size, central_offset + central_header_size + name_length)
    const name = new TextDecoder().decode(name_bytes)
    if (!has_range(bytes, local_offset, local_header_size) || u32le(bytes, local_offset) !== 0x04034b50) return null
    const local_name_length = u16le(bytes, local_offset + 26)
    const local_extra_length = u16le(bytes, local_offset + 28)
    const data_offset = local_offset + local_header_size + local_name_length + local_extra_length
    if (!has_range(bytes, data_offset, compressed_size)) return null
    const compressed = bytes.slice(data_offset, data_offset + compressed_size)

    let data: Uint8Array
    if (method === 0) {
      if (compressed_size !== uncompressed_size) return null
      data = compressed
    } else if (method === 8) {
      const inflated = await inflate_raw(compressed)
      if (!inflated || inflated.length !== uncompressed_size) return null
      data = inflated
    } else {
      return null
    }
    entries.push({ name, data })
    total_bytes += data.length
    central_offset += record_length
  }
  return entries
}

export async function zip_read(buffer: ArrayBuffer): Promise<zip_entry_t[] | null> {
  try {
    return await zip_read_inner(buffer)
  } catch (error) {
    report_warning('ZIPファイルを解析できませんでした', error)
    return null
  }
}
