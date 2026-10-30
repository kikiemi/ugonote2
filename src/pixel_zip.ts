import { deflateSync as deflate_sync, inflateSync as inflate_sync } from 'fflate'
import { crc32 } from './binary'

export const pixel_zip_flag = 0x40000000

export function pixel_zip_pack(pixels: Uint32Array, limit: number): Uint32Array | null {
  const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)
  const filtered = new Uint8Array(bytes.length)
  let previous = 0
  for (let i = 0; i < pixels.length; i++) {
    const value = pixels[i]
    filtered[i * 4] = (value & 255) - (previous & 255)
    filtered[i * 4 + 1] = (value >>> 8 & 255) - (previous >>> 8 & 255)
    filtered[i * 4 + 2] = (value >>> 16 & 255) - (previous >>> 16 & 255)
    filtered[i * 4 + 3] = (value >>> 24) - (previous >>> 24)
    previous = value
  }
  // fflate 0.8.2 の Deflate (少しずつつめるもの) は、なめらかな塗りなどで、もどせないデータを作ることがあるので、
  // 一度につめて、もどせることも確かめる (もどせなければ、つめない)。
  const zipped = deflate_sync(filtered, { level: 1, mem: 5 })
  const size = zipped.length
  if (size + 16 >= limit) return null
  const packed = new Uint32Array(3 + Math.ceil(size / 4))
  packed[0] = pixels.length | pixel_zip_flag
  packed[1] = size
  packed[2] = crc32(bytes, 0)
  new Uint8Array(packed.buffer, 12).set(zipped)
  return pixel_zip_unpack(packed, new Uint32Array(pixels.length)) === pixels.length ? packed : null
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
