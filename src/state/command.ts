import { pixel_source_ready, pixel_source_prepare } from '../pixel_source'
import { report_warning } from '../diagnostics'
import { err_bad } from '../h'
import { dirty, in_flush, proj_touch, st_mut_for_dispatch, type globals_t } from './store'

export type cmd_fn_t<p> = (g: globals_t, payload: p) => number
type table_t<m> = { [k in keyof m]: cmd_fn_t<m[k]> }

let depth = 0
const recent: string[] = []

export function make_dispatch<m extends Record<string, unknown>>(
  table: table_t<m>,
  effects: Partial<Record<keyof m, number>>,
  touches: ReadonlySet<keyof m>
): <k extends keyof m & string>(name: k, payload: m[k]) => number {
  return function dispatch<k extends keyof m & string>(name: k, payload: m[k]): number {
    if (in_flush()) {
      report_warning('再描画中のコマンドを拒否しました', name)
      return err_bad
    }
    const current = st_mut_for_dispatch(), frame = current.doc.frames[current.doc.cur]
    if (frame && (name.startsWith('sel.') && name !== 'sel.clear' || name.startsWith('flo.') && name !== 'flo.cancel' || name === 'project.transform') && !pixel_source_ready(frame)) {
      void pixel_source_prepare(frame).then(() => { if (current.doc.frames[current.doc.cur] === frame) dispatch(name, payload) }, error => report_warning('動画のコマを準備できませんでした', error))
      return 0
    }
    recent.push(name)
    if (recent.length > 12) recent.shift()
    depth++
    if (depth > 32) {
      depth--
      report_warning('コマンドの連鎖が深すぎるため打ち切りました', recent.join(' -> '))
      return err_bad
    }
    try {
      const fn = table[name]
      if (!fn) return err_bad
      const r = fn(st_mut_for_dispatch(), payload)
      if (r < 0) return r
      dirty(r | (effects[name] || 0))
      if (touches.has(name)) proj_touch()
      return 0
    } finally {
      depth--
    }
  }
}
