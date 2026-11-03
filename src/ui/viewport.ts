import { dispatch } from '../state/commands/index'

// 描くところの、前に見た大きさ。
const stage_seen = { w: 0, h: 0 }

let fit_pending = 0
export function view_fit_if_stale(): void {
  if (fit_pending) return
  fit_pending = requestAnimationFrame(() => {
    fit_pending = 0
    dispatch('view.fit_if_stale', null)
  })
}

// 描くところの大きさが変わったとき (画面の大きさや、スタジオでコマ一覧を開け閉めしたとき)。
// 拡大している紙も、コマ一覧の下などに隠れず、同じ所がまんなかに見えるようにする。
export function view_stage_resized(w: number, h: number): void {
  const dw = stage_seen.w ? w - stage_seen.w : 0
  const dh = stage_seen.h ? h - stage_seen.h : 0
  stage_seen.w = w
  stage_seen.h = h
  if (dw || dh) dispatch('view.stage_resized', { dw, dh })
  else view_fit_if_stale()
}
