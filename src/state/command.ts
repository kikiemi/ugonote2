import { report_warning } from '../diagnostics'
import { ERR_BAD } from '../h'
import { dirty, in_flush, proj_touch, st_mut_for_dispatch, type Globals } from './store'

export type CmdFn<P> = (g: Globals, payload: P) => number
type Table<M> = { [K in keyof M]: CmdFn<M[K]> }

let depth = 0
const recent: string[] = []

export function make_dispatch<M extends Record<string, unknown>>(
  table: Table<M>,
  effects: Partial<Record<keyof M, number>>,
  touches: ReadonlySet<keyof M>
): <K extends keyof M & string>(name: K, payload: M[K]) => number {
  return function dispatch<K extends keyof M & string>(name: K, payload: M[K]): number {
    if (in_flush()) {
      report_warning('再描画中のコマンドを拒否しました', name)
      return ERR_BAD
    }
    recent.push(name)
    if (recent.length > 12) recent.shift()
    depth++
    if (depth > 32) {
      depth--
      report_warning('コマンドの連鎖が深すぎるため打ち切りました', recent.join(' -> '))
      return ERR_BAD
    }
    try {
      const fn = table[name]
      if (!fn) return ERR_BAD
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
