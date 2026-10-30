import { dispatch } from '../state/commands/index'

let fit_pending = 0
export function view_fit_if_stale(): void {
  if (fit_pending) return
  fit_pending = requestAnimationFrame(() => {
    fit_pending = 0
    dispatch('view.fit_if_stale', null)
  })
}

