type fx_hooks_t = {
  toast: (msg: string) => void
  sfx: (name: string) => void
  stage_size: () => { w: number, h: number, x?: number, y?: number }
}

let hooks: fx_hooks_t = { toast: () => {}, sfx: () => {}, stage_size: () => ({ w: 0, h: 0 }) }

export function fx_hooks_set(h: fx_hooks_t): void {
  hooks = h
}

export function fx_toast(msg: string): void {
  hooks.toast(msg)
}

export function fx_sfx(name: string): void {
  hooks.sfx(name)
}

export function fx_stage_size(): { w: number, h: number, x?: number, y?: number } {
  return hooks.stage_size()
}
