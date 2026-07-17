import { report_warning } from './diagnostics'

export type ZipEntry = {
  name: string
  data: Uint8Array
}

const EOCD_SIZE = 22
const CENTRAL_HEADER_SIZE = 46
const LOCAL_HEADER_SIZE = 30
const MAX_ENTRIES = 10000
const MAX_ENTRY_BYTES = 64 << 20
const MAX_TOTAL_BYTES = 256 << 20

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
  const Decompressor = typeof DecompressionStream === 'undefined' ? null : DecompressionStream
  if (!Decompressor) return null
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new Decompressor('deflate-raw'))
  const buffer = await new Response(stream).arrayBuffer()
  return new Uint8Array(buffer)
}

async function zip_read_inner(buffer: ArrayBuffer): Promise<ZipEntry[] | null> {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < EOCD_SIZE) return null
  let eocdOffset = -1
  const searchStart = Math.max(0, bytes.length - EOCD_SIZE - 65535)
  for (let offset = bytes.length - EOCD_SIZE; offset >= searchStart; offset--) {
    if (u32le(bytes, offset) === 0x06054b50) {
      eocdOffset = offset
      break
    }
  }
  if (eocdOffset < 0) return null

  const diskNumber = u16le(bytes, eocdOffset + 4)
  const centralDisk = u16le(bytes, eocdOffset + 6)
  const diskEntries = u16le(bytes, eocdOffset + 8)
  const entryCount = u16le(bytes, eocdOffset + 10)
  const centralSize = u32le(bytes, eocdOffset + 12)
  let centralOffset = u32le(bytes, eocdOffset + 16)
  const commentLength = u16le(bytes, eocdOffset + 20)
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== entryCount || entryCount > MAX_ENTRIES) return null
  if (!has_range(bytes, eocdOffset + EOCD_SIZE, commentLength)) return null
  if (!has_range(bytes, centralOffset, centralSize) || centralOffset + centralSize > eocdOffset) return null

  const entries: ZipEntry[] = []
  let totalBytes = 0
  for (let index = 0; index < entryCount; index++) {
    if (!has_range(bytes, centralOffset, CENTRAL_HEADER_SIZE) || u32le(bytes, centralOffset) !== 0x02014b50) return null
    const flags = u16le(bytes, centralOffset + 8)
    const method = u16le(bytes, centralOffset + 10)
    const compressedSize = u32le(bytes, centralOffset + 20)
    const uncompressedSize = u32le(bytes, centralOffset + 24)
    const nameLength = u16le(bytes, centralOffset + 28)
    const extraLength = u16le(bytes, centralOffset + 30)
    const commentSize = u16le(bytes, centralOffset + 32)
    const localOffset = u32le(bytes, centralOffset + 42)
    const recordLength = CENTRAL_HEADER_SIZE + nameLength + extraLength + commentSize
    if (!has_range(bytes, centralOffset, recordLength)) return null
    if ((flags & 1) !== 0 || uncompressedSize > MAX_ENTRY_BYTES || totalBytes + uncompressedSize > MAX_TOTAL_BYTES) return null

    const nameBytes = bytes.subarray(centralOffset + CENTRAL_HEADER_SIZE, centralOffset + CENTRAL_HEADER_SIZE + nameLength)
    const name = new TextDecoder().decode(nameBytes)
    if (!has_range(bytes, localOffset, LOCAL_HEADER_SIZE) || u32le(bytes, localOffset) !== 0x04034b50) return null
    const localNameLength = u16le(bytes, localOffset + 26)
    const localExtraLength = u16le(bytes, localOffset + 28)
    const dataOffset = localOffset + LOCAL_HEADER_SIZE + localNameLength + localExtraLength
    if (!has_range(bytes, dataOffset, compressedSize)) return null
    const compressed = bytes.slice(dataOffset, dataOffset + compressedSize)

    let data: Uint8Array
    if (method === 0) {
      if (compressedSize !== uncompressedSize) return null
      data = compressed
    } else if (method === 8) {
      const inflated = await inflate_raw(compressed)
      if (!inflated || inflated.length !== uncompressedSize) return null
      data = inflated
    } else {
      return null
    }
    entries.push({ name, data })
    totalBytes += data.length
    centralOffset += recordLength
  }
  return entries
}

export async function zip_read(buffer: ArrayBuffer): Promise<ZipEntry[] | null> {
  try {
    return await zip_read_inner(buffer)
  } catch (error) {
    report_warning('ZIPファイルを解析できませんでした', error)
    return null
  }
}
