type FxHooks = {
  toast: (msg: string) => void
  sfx: (name: string) => void
  stage_size: () => { w: number, h: number }
}

let hooks: FxHooks = { toast: () => {}, sfx: () => {}, stage_size: () => ({ w: 0, h: 0 }) }

export function fx_hooks_set(h: FxHooks): void {
  hooks = h
}

export function fx_toast(msg: string): void {
  hooks.toast(msg)
}

export function fx_sfx(name: string): void {
  hooks.sfx(name)
}

export function fx_stage_size(): { w: number, h: number } {
  return hooks.stage_size()
}
