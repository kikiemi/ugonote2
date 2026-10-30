import { report_warning } from './diagnostics'
import { toast } from './dom'
import { dot_font_family, memo_font_family } from './dotfont'

export type font_entry_t = { name: string, family: string }

const list: font_entry_t[] = []
let seq = 0

export function fonts_list(): font_entry_t[] {
  const base: font_entry_t[] = [
    { name: 'まるゴシック（標準）', family: '' },
    { name: 'ドットフォント（くっきり）', family: dot_font_family },
    { name: 'うごメモ風（オリジナル）', family: memo_font_family },
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
