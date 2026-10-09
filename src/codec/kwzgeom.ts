export const KWZ_FRAME_W = 320
export const KWZ_FRAME_H = 240
export const KWZ_BORDER = 5
export const KWZ_CANVAS_W = KWZ_FRAME_W - KWZ_BORDER * 2
export const KWZ_CANVAS_H = KWZ_FRAME_H - KWZ_BORDER * 2

export function kwz_pad_plane(src: Uint8Array): Uint8Array {
  if (src.length !== KWZ_CANVAS_W * KWZ_CANVAS_H) throw new RangeError('invalid KWZ canvas plane')
  const out = new Uint8Array(KWZ_FRAME_W * KWZ_FRAME_H)
  for (let y = 0; y < KWZ_CANVAS_H; y++) {
    const a = y * KWZ_CANVAS_W
    out.set(src.subarray(a, a + KWZ_CANVAS_W), (y + KWZ_BORDER) * KWZ_FRAME_W + KWZ_BORDER)
  }
  return out
}
