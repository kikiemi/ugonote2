import { dispatch } from '../state/commands/index'

let fitPending = 0
export function view_fit_if_stale(): void {
  if (fitPending) return
  fitPending = requestAnimationFrame(() => {
    fitPending = 0
    dispatch('view.fit_if_stale', null)
  })
}

