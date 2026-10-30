import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { pref_layout, pref_layout_set, pref_tablet_timeline, pref_tablet_timeline_set } from '../prefs'
import { q } from '../dom'
import { workspace_layout_render } from './workspace_layout'
import { view_fit_if_stale } from './viewport'
import { workspace_media, workspace_timeline_initial } from './workspace_policy'

let mounted = 0
let landscape_on = 0
let timeline_restore = 0
let wide_on = 0
let wide_restore = 0

export function workspace_layout_set(value: number): void {
  pref_layout_set(value)
  dispatch('view.set_timeline_open', value ? 1 : 0)
  responsive_apply()
}

export function workspace_timeline_set(value: number): void {
  dispatch('view.set_timeline_open', value ? 1 : 0)
  if (workspace_media().tablet) pref_tablet_timeline_set(value)
  view_fit_if_stale()
}

function responsive_apply(): void {
  const g = st()
  const profile = workspace_media()
  workspace_layout_render()
  if (profile.timeline_wide && !wide_on) {
    wide_restore = g.view.tlopen ? 1 : 0
    const saved = profile.tablet ? pref_tablet_timeline() : -1
    dispatch('view.set_timeline_open', workspace_timeline_initial(profile, pref_layout(), saved))
  } else if (!profile.timeline_wide && wide_on) dispatch('view.set_timeline_open', wide_restore)
  wide_on = profile.timeline_wide
  view_fit_if_stale()
  if (wide_on) {
    landscape_on = 0
    timeline_restore = 0
    return
  }
  if (profile.landscape) {
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

export function responsive_mount(close: () => void): void {
  if (mounted) return
  mounted = 1
  q('layout_simple').addEventListener('click', () => { close(); workspace_layout_set(0) })
  q('layout_studio').addEventListener('click', () => { close(); workspace_layout_set(1) })
  window.addEventListener('resize', responsive_apply, { passive: true })
  window.addEventListener('orientationchange', responsive_apply, { passive: true })
  responsive_apply()
}
