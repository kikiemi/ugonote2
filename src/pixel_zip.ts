import { Deflate as deflate_t, inflateSync as inflate_sync } from 'fflate'
import { crc32 } from './binary'

export const pixel_zip_flag = 0x40000000

export function pixel_zip_pack(pixels: Uint32Array, limit: number): Uint32Array | null {
  const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)
  const chunks: Uint8Array[] = []
  let size = 0, previous = 0
  const encoder = new deflate_t({ level: 1, mem: 5 }, chunk => { chunks.push(chunk); size += chunk.length })
  const filtered = new Uint8Array(Math.min(65536, bytes.length))
  for (let offset = 0; offset < pixels.length;) {
    const count = Math.min(filtered.length / 4, pixels.length - offset)
    for (let i = 0; i < count; i++) {
      const value = pixels[offset + i]
      filtered[i * 4] = (value & 255) - (previous & 255)
      filtered[i * 4 + 1] = (value >>> 8 & 255) - (previous >>> 8 & 255)
      filtered[i * 4 + 2] = (value >>> 16 & 255) - (previous >>> 16 & 255)
      filtered[i * 4 + 3] = (value >>> 24) - (previous >>> 24)
      previous = value
    }
    offset += count
    encoder.push(filtered.subarray(0, count * 4), offset === pixels.length)
    if (size + 16 >= limit) return null
  }
  const packed = new Uint32Array(3 + Math.ceil(size / 4))
  packed[0] = pixels.length | pixel_zip_flag
  packed[1] = size
  packed[2] = crc32(bytes, 0)
  const out = new Uint8Array(packed.buffer, 12)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
  return packed
}

export function pixel_zip_unpack(packed: Uint32Array, pixels: Uint32Array): number {
  const count = packed[0] & 0x3fffffff
  const size = packed[1]
  if (count > pixels.length || packed.length < 4 || !size || packed.length !== 3 + Math.ceil(size / 4)) return -1
  const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, count * 4)
  try {
    inflate_sync(new Uint8Array(packed.buffer, packed.byteOffset + 12, size), { out: bytes })
    for (let i = 4; i < bytes.length; i++) bytes[i] += bytes[i - 4]
    return crc32(bytes, 0) === packed[2] ? count : -1
  } catch { return -1 }
}
