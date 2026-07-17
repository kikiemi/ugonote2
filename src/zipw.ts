import { binary_writer, crc32, writer_bytes, writer_finish, writer_u16, writer_u32 } from './binary'

export type ZipEntry = { name: string, data: Uint8Array }

function dos_stamp(): [number, number] {
  const d = new Date()
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = (((d.getFullYear() - 1980) & 127) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return [time, date]
}

export function zip_build(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder()
  const [time, date] = dos_stamp()
  let total = 22
  for (const e of entries) total += 30 + 46 + enc.encode(e.name).length * 2 + e.data.length
  const w = binary_writer(total)
  const centrals: { nameB: Uint8Array, crc: number, size: number, off: number }[] = []
  for (const e of entries) {
    const nameB = enc.encode(e.name)
    const crc = crc32(e.data, 0)
    const off = w.len
    writer_u32(w, 0x04034b50)
    writer_u16(w, 20)
    writer_u16(w, 0x0800)
    writer_u16(w, 0)
    writer_u16(w, time)
    writer_u16(w, date)
    writer_u32(w, crc)
    writer_u32(w, e.data.length)
    writer_u32(w, e.data.length)
    writer_u16(w, nameB.length)
    writer_u16(w, 0)
    writer_bytes(w, nameB)
    writer_bytes(w, e.data)
    centrals.push({ nameB, crc, size: e.data.length, off })
  }
  const cdOff = w.len
  for (const c of centrals) {
    writer_u32(w, 0x02014b50)
    writer_u16(w, 20)
    writer_u16(w, 20)
    writer_u16(w, 0x0800)
    writer_u16(w, 0)
    writer_u16(w, time)
    writer_u16(w, date)
    writer_u32(w, c.crc)
    writer_u32(w, c.size)
    writer_u32(w, c.size)
    writer_u16(w, c.nameB.length)
    writer_u16(w, 0)
    writer_u16(w, 0)
    writer_u16(w, 0)
    writer_u16(w, 0)
    writer_u32(w, 0)
    writer_u32(w, c.off)
    writer_bytes(w, c.nameB)
  }
  const cdSize = w.len - cdOff
  writer_u32(w, 0x06054b50)
  writer_u16(w, 0)
  writer_u16(w, 0)
  writer_u16(w, centrals.length)
  writer_u16(w, centrals.length)
  writer_u32(w, cdSize)
  writer_u32(w, cdOff)
  writer_u16(w, 0)
  return writer_finish(w)
}
