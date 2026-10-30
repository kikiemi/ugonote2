import { make_real_key, kwz_real_key_pkcs8_b64, ppm_real_key_pkcs8_b64 } from './keys'

const ppm_key = make_real_key(ppm_real_key_pkcs8_b64, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' })
const kwz_key = make_real_key(kwz_real_key_pkcs8_b64, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' })

async function sign_with(key: ReturnType<typeof make_real_key>, body: Uint8Array, sig_len: number): Promise<Uint8Array> {
  const k = await key.priv()
  if (!k) return new Uint8Array(sig_len)
  const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, ab)
  return new Uint8Array(sig)
}

export function ppm_sign(body: Uint8Array): Promise<Uint8Array> {
  return sign_with(ppm_key, body, 128)
}

export function kwz_sign(body: Uint8Array): Promise<Uint8Array> {
  return sign_with(kwz_key, body, 256)
}
