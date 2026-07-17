import { storage_get, storage_set } from './storage'

let theme = 0
let uisfx = 1
let kit = 0

export function prefs_load(): void {
  theme = storage_get('ug2_dark') === '1' ? 1 : 0
  kit = storage_get('ug2_kit') === '1' ? 1 : 0
  uisfx = storage_get('ug2_uisfx') === '0' ? 0 : 1
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

export function pref_kit(): number {
  return kit
}

export function pref_kit_set(v: number): void {
  kit = v ? 1 : 0
  save('ug2_kit', kit)
}
