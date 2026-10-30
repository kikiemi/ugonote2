export const kwz_frame_w = 320
export const kwz_frame_h = 240
export const kwz_border = 5
export const kwz_canvas_w = kwz_frame_w - kwz_border * 2
export const kwz_canvas_h = kwz_frame_h - kwz_border * 2

export function kwz_pad_plane(src: Uint8Array): Uint8Array {
  if (src.length !== kwz_canvas_w * kwz_canvas_h) throw new RangeError('invalid KWZ canvas plane')
  const out = new Uint8Array(kwz_frame_w * kwz_frame_h)
  for (let y = 0; y < kwz_canvas_h; y++) {
    const a = y * kwz_canvas_w
    out.set(src.subarray(a, a + kwz_canvas_w), (y + kwz_border) * kwz_frame_w + kwz_border)
  }
  return out
}
