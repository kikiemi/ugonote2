import { report_warning } from './diagnostics'
import { toast } from './dom'
import { DOT_FONT_FAMILY } from './dotfont'

export type FontEntry = { name: string, family: string }

const list: FontEntry[] = []
let seq = 0

export function fonts_list(): FontEntry[] {
  const base: FontEntry[] = [
    { name: 'まるゴシック（標準）', family: '' },
    { name: 'ドットフォント（くっきり）', family: DOT_FONT_FAMILY },
  ]
  return base.concat(list)
}

export function font_import(file: File, cb: (ok: number) => void): void {
  file
    .arrayBuffer()
    .then(buf => {
      const fam = 'ug2f_' + ++seq
      const face = new FontFace(fam, buf)
      return face.load().then(loaded => {
        document.fonts.add(loaded)
        const name = file.name.replace(/\.[^.]+$/, '').slice(0, 24) || fam
        list.push({ name, family: fam })
        cb(1)
      })
    })
    .catch(error => {
      report_warning('フォントの読み込みに失敗しました', error)
      toast('フォントを読み込めなかった…（ttf/otf/woff/woff2）')
      cb(0)
    })
}
