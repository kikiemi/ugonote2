import { makeRealKey, KWZ_REAL_KEY_PKCS8_B64, KWZ_REAL_PUB_SPKI_B64, PPM_REAL_KEY_PKCS8_B64, PPM_REAL_PUB_SPKI_B64 } from './keys'

const ppmKey = makeRealKey(PPM_REAL_KEY_PKCS8_B64, PPM_REAL_PUB_SPKI_B64, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' })
const kwzKey = makeRealKey(KWZ_REAL_KEY_PKCS8_B64, KWZ_REAL_PUB_SPKI_B64, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' })

async function sign_with(key: ReturnType<typeof makeRealKey>, body: Uint8Array, sigLen: number): Promise<Uint8Array> {
  const k = await key.priv()
  if (!k) return new Uint8Array(sigLen)
  const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, ab)
  return new Uint8Array(sig)
}

async function verify_with(key: ReturnType<typeof makeRealKey>, body: Uint8Array, sig: Uint8Array): Promise<number> {
  const k = await key.pub()
  if (!k) return 0
  const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
  const sb = sig.buffer.slice(sig.byteOffset, sig.byteOffset + sig.byteLength) as ArrayBuffer
  return (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, sb, ab)) ? 1 : 0
}

export function ppm_sign(body: Uint8Array): Promise<Uint8Array> {
  return sign_with(ppmKey, body, 128)
}

export function ppm_verify_own(body: Uint8Array, sig: Uint8Array): Promise<number> {
  return verify_with(ppmKey, body, sig)
}

export function kwz_sign(body: Uint8Array): Promise<Uint8Array> {
  return sign_with(kwzKey, body, 256)
}

export function kwz_verify_own(body: Uint8Array, sig: Uint8Array): Promise<number> {
  return verify_with(kwzKey, body, sig)
}
