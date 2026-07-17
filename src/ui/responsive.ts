import { dispatch } from '../state/commands/index'
import { st } from '../state/store'

let mounted = 0
let landscape_on = 0
let timeline_restore = 0

export function responsive_landscape(): number {
  return window.matchMedia('(orientation: landscape) and (max-height: 520px)').matches ? 1 : 0
}

function responsive_apply(): void {
  const g = st()
  const landscape = responsive_landscape()
  document.body.dataset.mobile = g.mobile ? '1' : '0'
  if (landscape) {
    if (!landscape_on) {
      landscape_on = 1
      timeline_restore = g.view.tlopen ? 1 : 0
      if (g.view.tlopen) dispatch('view.set_timeline_open', 0)
    }
    return
  }
  if (!landscape_on) return
  landscape_on = 0
  if (g.view.tlopen !== timeline_restore) dispatch('view.set_timeline_open', timeline_restore)
  timeline_restore = 0
}

export function responsive_mount(): void {
  if (mounted) return
  mounted = 1
  window.addEventListener('resize', responsive_apply, { passive: true })
  window.addEventListener('orientationchange', responsive_apply, { passive: true })
  responsive_apply()
}
