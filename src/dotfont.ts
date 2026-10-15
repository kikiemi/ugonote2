export const dot_font_family = '__dot__'
export const memo_font_family = 'UgoMemo'

export function dot_text_canvas(text: string, scale: number, color: string, outline: number, ocolor: string, vert: number, bold = 0, owidth = 1): HTMLCanvasElement {
  const sc = Math.max(1, Math.round(scale))
  const lines = text.normalize('NFC').replace(/\r/g, '').split('\n')
  const font = '16px "' + dot_font_family + '"'
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = font
  let columns = 1
  let width = 1
  for (const line of lines) {
    columns = Math.max(columns, [...line].length)
    width = Math.max(width, Math.ceil(measure.measureText(line).width))
  }
  const pad = outline ? Math.max(1, Math.ceil(owidth / sc)) : 0
  const row = 20
  const c = document.createElement('canvas')
  c.width = (vert ? lines.length * row : width + 2) + pad * 2
  c.height = (vert ? columns * row : lines.length * row) + pad * 2
  const x = c.getContext('2d')!
  x.font = font
  x.textBaseline = 'alphabetic'
  x.fillStyle = '#000'
  for (let li = 0; li < lines.length; li++) {
    if (vert) {
      const chars = [...lines[li]]
      for (let ci = 0; ci < chars.length; ci++) x.fillText(chars[ci], pad + (lines.length - 1 - li) * row, pad + ci * row + 16)
    } else x.fillText(lines[li], pad, pad + li * row + 16)
  }
  const data = x.getImageData(0, 0, c.width, c.height).data
  x.clearRect(0, 0, c.width, c.height)
  if (outline) {
    x.fillStyle = ocolor
    for (let y = 0; y < c.height; y++) {
      for (let px = 0; px < c.width; px++) {
        if (data[(y * c.width + px) * 4 + 3] < 128) continue
        x.fillRect(px - pad, y - pad, pad * 2 + 1, pad * 2 + 1)
      }
    }
  }
  x.fillStyle = color
  for (let y = 0; y < c.height; y++) {
    for (let px = 0; px < c.width; px++) {
      if (data[(y * c.width + px) * 4 + 3] >= 128) x.fillRect(px, y, bold ? 2 : 1, 1)
    }
  }
  const out = document.createElement('canvas')
  out.width = c.width * sc
  out.height = c.height * sc
  const ox = out.getContext('2d')!
  ox.imageSmoothingEnabled = false
  ox.drawImage(c, 0, 0, out.width, out.height)
  return out
}
