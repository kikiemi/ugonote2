import { storage_get, storage_set } from './storage'

let theme = 0
let uisfx = 1
let hide_controls = 1
let layout = -1
let tablet_timeline = -1

export function prefs_load(): void {
  theme = storage_get('ug2_dark') === '1' ? 1 : 0
  hide_controls = storage_get('ug2_hide_controls') === '0' ? 0 : 1
  uisfx = storage_get('ug2_uisfx') === '0' ? 0 : 1
  const saved_timeline = storage_get('ug2_tablet_timeline')
  tablet_timeline = saved_timeline === '0' ? 0 : saved_timeline === '1' ? 1 : -1
  const saved_layout = storage_get('ug2_layout')
  layout = saved_layout === 'simple' ? 0 : saved_layout === 'studio' ? 1 : -1
}

function save(key: string, value: number): void {
  storage_set(key, String(value))
}

export function pref_theme(): number {
  return theme
}

export function pref_theme_toggle(): number {
  theme = theme ? 0 : 1
  save('ug2_dark', theme)
  return theme
}

export function pref_uisfx(): number {
  return uisfx
}

export function pref_uisfx_toggle(): number {
  uisfx = uisfx ? 0 : 1
  save('ug2_uisfx', uisfx)
  return uisfx
}

export function pref_hide_controls(): number {
  return hide_controls
}

export function pref_hide_controls_toggle(): number {
  hide_controls = hide_controls ? 0 : 1
  save('ug2_hide_controls', hide_controls)
  return hide_controls
}

export function pref_layout(): number {
  return layout
}

export function pref_layout_set(v: number): void {
  layout = v ? 1 : 0
  storage_set('ug2_layout', layout ? 'studio' : 'simple')
}

export function pref_tablet_timeline(): number {
  return tablet_timeline
}

export function pref_tablet_timeline_set(value: number): void {
  tablet_timeline = value ? 1 : 0
  save('ug2_tablet_timeline', tablet_timeline)
}
