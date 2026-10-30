const kwz_b32 = 'cwmfjordvegbalksnthpyxquiz012345'
const nintendo_epoch_unix = 946684800

// 実機は本体の時計 (その土地の時刻) を 2000/1/1 0:00 からの秒数で書く。読むときは逆に戻す。
export function nintendo_ts_from_unix(unix_sec: number): number {
  const local = Math.floor(unix_sec) - new Date(Math.floor(unix_sec) * 1000).getTimezoneOffset() * 60
  const t = local - nintendo_epoch_unix
  if (t < 0) return 0
  return t >>> 0
}

export function unix_from_nintendo_ts(t: number): number {
  const local = (t >>> 0) + nintendo_epoch_unix
  return local + new Date(local * 1000).getTimezoneOffset() * 60
}

function b32_encode(src: Uint8Array): string {
  let out = ''
  let value = 0
  let bits = 0
  for (let i = 0; i < src.length; i++) {
    value = (value << 8) | src[i]
    bits += 8
    while (bits >= 5) {
      out += kwz_b32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += kwz_b32[(value << (5 - bits)) & 31]
  return out
}

export function hex_to_bytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  const out = new Uint8Array(clean.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function bytes_to_hex(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0')
  return s.toUpperCase()
}

export function kwz_filename_make(fsid_hex: string, created_unix: number, edited_unix: number): string {
  const bytes = new Uint8Array(17)
  const id = hex_to_bytes(fsid_hex)
  for (let i = 0; i < 9 && i < id.length; i++) bytes[i] = id[i]
  const dv = new DataView(bytes.buffer)
  dv.setUint32(9, nintendo_ts_from_unix(created_unix), true)
  dv.setUint32(13, nintendo_ts_from_unix(edited_unix), true)
  return b32_encode(bytes)
}

export function kwz_fsid_format(hex18: string): string {
  const h = hex18.replace(/-/g, '').toLowerCase().padEnd(18, '0').slice(0, 18)
  return h.slice(0, 4) + '-' + h.slice(4, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 18)
}

export function ppm_filename_format(mac3hex: string, rand13: string, edits: number): string {
  const m = mac3hex.replace(/[^0-9A-Fa-f]/g, '').toUpperCase().padEnd(6, '0').slice(0, 6)
  const r = rand13.toUpperCase().replace(/[^0-9A-F]/g, '0').padEnd(13, '0').slice(0, 13)
  const n = Math.max(0, Math.min(999, edits | 0))
  return m + '_' + r + '_' + String(n).padStart(3, '0')
}

const ppm_cd = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function ppm_filename_check_digit(name24: string): string {
  let sum = parseInt(name24.slice(0, 2), 16)
  if (!Number.isFinite(sum)) sum = 0
  for (let i = 1; i < 16; i++) sum = (sum + name24.charCodeAt(i)) & 0xff
  return ppm_cd[sum % 36]
}

export function ppm_filename_local(name24: string): string {
  return ppm_filename_check_digit(name24) + name24.slice(1)
}

export function ppm_filename_pack(mac3hex: string, rand13: string, edits: number): Uint8Array {
  const out = new Uint8Array(18)
  const mac = hex_to_bytes(mac3hex.padEnd(6, '0').slice(0, 6))
  for (let i = 0; i < 3; i++) out[i] = mac[i] || 0
  const r = rand13.toUpperCase().padEnd(13, '0').slice(0, 13)
  for (let i = 0; i < 13; i++) out[3 + i] = r.charCodeAt(i) & 0x7f
  out[16] = edits & 0xff
  out[17] = (edits >> 8) & 0xff
  return out
}

export function ppm_filename_unpack(b: Uint8Array): { mac3hex: string, rand13: string, edits: number } {
  const mac = bytes_to_hex(b.subarray(0, 3))
  let r = ''
  for (let i = 0; i < 13; i++) {
    const c = b[3 + i]
    r += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '0'
  }
  const edits = b[16] | (b[17] << 8)
  return { mac3hex: mac, rand13: r, edits }
}

export function ppm_region_of(fsid16hex: string): string {
  const c = fsid16hex.charAt(0)
  if (c === '0' || c === '1') return 'JP'
  if (c === '5') return 'US'
  if (c === '9') return 'EU'
  return '?'
}

export function kwz_region_of(fsid_formatted: string): string {
  const re = /^(00|10|12|14)[0-9a-f]{2}-[0-9a-f]{4}-[0-9a-f]{3}0-[0-9a-f]{4}[0159][0-9a-f]$/
  if (!re.test(fsid_formatted)) return '?'
  const c = fsid_formatted.charAt(19)
  if (c === '0' || c === '1') return 'JP'
  if (c === '5') return 'US'
  if (c === '9') return 'EU'
  return '?'
}

export function rand_hex(n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += '0123456789ABCDEF'[(Math.random() * 16) | 0]
  return s
}
